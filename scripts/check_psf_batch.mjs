// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 kyorohiro.
// Offline diagnostics only. Each synchronous CPU/WASM machine lives in a child
// process so a native call cannot block the parent's timeout or cancellation.
import {fork} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {lstat,mkdir,open,rename,rm} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {collectPsfBatchInputs} from './psf_batch_inputs.mjs';

export const PSF_BATCH_DEFAULTS=Object.freeze({seconds:2,timeoutMs:10000,batchTimeoutMs:300000,maxEntries:512,chunkFrames:4410});
const WORKER=new URL('./psf_batch_worker.mjs',import.meta.url);
const RESULT_BYTES=128*1024,STDERR_BYTES=8192,REPORT_BYTES=80*1024*1024;
const usage='Usage: node scripts/check_psf_batch.mjs DIRECTORY [--entry relative/song.minipsf] [--seconds 0.05..30] [--timeout-ms 100..120000] [--batch-timeout-ms 100..3600000] [--max-entries 1..512] [--out REPORT.json]';
const message=error=>String(error?.message??error).slice(0,4096);
function optionsOf(options) {
  const result={...PSF_BATCH_DEFAULTS,...options};
  if(typeof result.seconds!=='number'||!Number.isFinite(result.seconds)||result.seconds<.05||result.seconds>30)throw new RangeError('seconds must be 0.05..30');
  for(const[name,min,max]of[['timeoutMs',20,120000],['batchTimeoutMs',20,3600000],['maxEntries',1,512],['chunkFrames',1,44100]])
    if(!Number.isSafeInteger(result[name])||result[name]<min||result[name]>max)throw new RangeError(`${name} must be an integer ${min}..${max}`);
  if(result.entry!==undefined) {
    if(typeof result.entry!=='string'||!result.entry||/[\x00-\x1f:]/.test(result.entry)||/^[\\/]/.test(result.entry))throw new TypeError('entry must be a relative PSF path');
    result.entry=result.entry.replaceAll('\\','/');
    if(result.entry.split('/').some(part=>!part||part==='.'||part==='..'))throw new TypeError('entry must stay inside the selected folder');
  }
  return result;
}

function notify(callback,event){try{callback?.(event);}catch{/* Progress logging cannot strand a worker. */}}
function runEntry(job,{workerFile,timeoutMs,signal,stopReason,onProgress}) {
  return new Promise(resolveResult=>{
    const started=Date.now();let child,answer=null,forced=null,lastProgress={phase:'startup'},stderr=Buffer.alloc(0),stderrTruncated=false,spawnError=null,timer;
    const force=(status,code,text)=>{
      if(forced)return;forced={status,error:{code,message:text}};
      // SIGKILL, rather than an in-worker timer, also stops synchronous WASM.
      if(child)child.kill('SIGKILL');
    };
    const abort=()=>{const reason=stopReason();force(reason==='batch-timeout'?'timeout':'aborted',reason,reason==='batch-timeout'?'Batch wall-time budget expired.':'Batch interrupted.');};
    const complete=(code=null,exitSignal=null)=>{
      clearTimeout(timer);signal.removeEventListener('abort',abort);
      const worker={elapsedMs:Date.now()-started,pid:child?.pid??null,exitCode:code,signal:exitSignal,stderrTruncated};
      let result;
      if(forced)result={entry:job.entry,phase:lastProgress.phase,...forced,progress:lastProgress};
      else if(spawnError||code!==0||!answer)result={entry:job.entry,status:'crash',phase:lastProgress.phase,error:{code:'worker-crash',message:spawnError?message(spawnError):`Worker exited ${code??exitSignal??'without a result'}.`},progress:lastProgress};
      else result=answer;
      if(stderr.length&&(result.status==='crash'||result.status==='timeout'))worker.stderr=stderr.toString('utf8');
      resolveResult({...result,worker});
    };
    if(signal.aborted){abort();complete();return;}
    try {
      child=fork(workerFile instanceof URL?fileURLToPath(workerFile):resolve(workerFile),[],{
        execArgv:['--max-old-space-size=256','--unhandled-rejections=strict'],
        stdio:['ignore','ignore','pipe','ipc'],serialization:'json',
      });
    } catch(error){spawnError=error;complete();return;}
    child.stderr.on('data',chunk=>{
      const remaining=STDERR_BYTES-stderr.length;
      if(remaining>0)stderr=Buffer.concat([stderr,chunk.subarray(0,remaining)]);
      if(chunk.length>remaining)stderrTruncated=true;
    });
    child.on('message',data=>{
      if(forced)return;
      let size;try{size=Buffer.byteLength(JSON.stringify(data));}catch{size=Infinity;}
      if(size>RESULT_BYTES){force('crash','worker-protocol','Worker diagnostic exceeded its bounded message budget.');return;}
      if(data?.type==='progress'&&typeof data.phase==='string') {
        lastProgress={phase:data.phase.slice(0,80)};
        for(const key of ['renderedFrames','nativeFrames'])if(Number.isSafeInteger(data[key])&&data[key]>=0)lastProgress[key]=data[key];
        notify(onProgress,{entry:job.entry,...lastProgress});
      } else if(data?.type==='result'&&!answer&&data.result?.entry===job.entry&&['rendered','error'].includes(data.result.status))answer=data.result;
      else force('crash','worker-protocol','Worker returned an invalid diagnostic message.');
    });
    child.once('error',error=>{spawnError=error;});
    // close waits for process exit and closed pipes: no old machine survives
    // when the next entry starts or a checkpoint is reported as complete.
    child.once('close',complete);
    signal.addEventListener('abort',abort,{once:true});
    timer=setTimeout(()=>force('timeout','worker-timeout',`Entry wall-time budget of ${timeoutMs} ms expired.`),timeoutMs);
    if(signal.aborted)abort();
    else child.send(job,error=>{if(error){spawnError=error;force('crash','worker-crash',message(error));}});
  });
}

function summarize(report) {
  const count=status=>report.results.filter(result=>result.status===status).length;
  return {rendered:count('rendered'),errors:count('error')+(report.error?1:0),timeouts:count('timeout'),crashes:count('crash'),aborted:count('aborted'),
    silent:report.results.filter(result=>result.status==='rendered'&&result.metrics?.pcm?.silent).length,
    remaining:Math.max(0,report.entriesSelected-report.results.length)};
}

/** Programmatic entry point. workerFile is a test seam, never a CLI flag.
 * The JS heap limit does not claim to cap WASM memory or process RSS.
 * No AudioContext, browser, audio-device API or waveform file is used. */
export async function diagnosePsfFolder(directory,options={}) {
  if(typeof directory!=='string'||!directory)throw new TypeError('Expected a PSF folder path');
  const config=optionsOf(options),started=Date.now(),controller=new AbortController();let stoppedBecause=null;
  const report={schemaVersion:1,scope:'Short offline PSF1/MiniPSF execution diagnostics; not listening or fidelity verification',status:'running',
    startedAt:new Date(started).toISOString(),directory:resolve(directory),configuration:{seconds:config.seconds,timeoutMs:config.timeoutMs,batchTimeoutMs:config.batchTimeoutMs,maxEntries:config.maxEntries,chunkFrames:config.chunkFrames},
    limits:{inputFiles:512,readableInputBytes:64*1024*1024,fileBytes:4*1024*1024,directoryEntries:16384,depth:64,workerJsHeapMiB:256,workerResultBytes:RESULT_BYTES,reportBytes:REPORT_BYTES,processRssCapped:false},
    scanComplete:false,files:[],warnings:[],entriesInSet:0,entriesSelected:0,excludedByLimit:0,inputBytes:0,results:[],
    physicalOutputUsed:false,listeningPerformed:false,gamePayloadIncluded:false};
  report.summary=summarize(report);
  const stop=reason=>{if(!stoppedBecause){stoppedBecause=reason;controller.abort();}};
  const externalAbort=()=>stop('aborted');
  options.signal?.addEventListener('abort',externalAbort,{once:true});
  if(options.signal?.aborted)externalAbort();
  const totalTimer=setTimeout(()=>stop('batch-timeout'),config.batchTimeoutMs);
  const checkpoint=async()=>{report.summary=summarize(report);await options.onCheckpoint?.(report);};
  try {
    let inputs;
    try {inputs=await collectPsfBatchInputs(directory,{signal:controller.signal});}
    catch(error) {
      if(!controller.signal.aborted)throw error;
      report.status=stoppedBecause==='batch-timeout'?'incomplete':'aborted';report.stoppedBecause=stoppedBecause;return report;
    }
    report.directory=inputs.root;report.files=inputs.files.map(({path,bytes})=>({path,bytes}));report.inputBytes=inputs.inputBytes;
    report.budgetedInputBytes=inputs.budgetedInputBytes??inputs.inputBytes;report.warnings=inputs.warnings;report.scanComplete=true;
    report.entriesInSet=inputs.entries.length;
    let selected=config.entry===undefined?inputs.entries:inputs.entries.filter(entry=>entry===config.entry);
    if(!selected.length)throw new Error(config.entry===undefined?'No PSF or MiniPSF song entries found.':`Unknown PSF entry: ${config.entry}`);
    report.excludedByLimit=Math.max(0,selected.length-config.maxEntries);selected=selected.slice(0,config.maxEntries);report.entriesSelected=selected.length;
    await options.onInputs?.(inputs);
    await checkpoint();
    for(const entry of selected) {
      if(controller.signal.aborted)break;
      const result=await runEntry({root:inputs.root,files:inputs.files,entry,seconds:config.seconds,chunkFrames:config.chunkFrames},{
        workerFile:options.workerFile??WORKER,timeoutMs:config.timeoutMs,signal:controller.signal,stopReason:()=>stoppedBecause??'aborted',onProgress:options.onProgress,
      });
      report.results.push(result);await checkpoint();
    }
    report.status=controller.signal.aborted?(stoppedBecause==='batch-timeout'?'incomplete':'aborted'):'complete';
    if(stoppedBecause)report.stoppedBecause=stoppedBecause;
  } catch(error) {
    report.status=controller.signal.aborted?(stoppedBecause==='batch-timeout'?'incomplete':'aborted'):'error';
    if(stoppedBecause)report.stoppedBecause=stoppedBecause;
    report.error={code:'batch-error',message:message(error)};
  } finally {
    clearTimeout(totalTimer);options.signal?.removeEventListener('abort',externalAbort);
    report.finishedAt=new Date().toISOString();report.elapsedMs=Date.now()-started;await checkpoint();
  }
  return report;
}

async function checkOutput(path,inputs) {
  if(!/\.json$/i.test(path))throw new Error('--out must name a JSON report, not a PSF/library input');
  const output=await lstat(path).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
  if(output?.isSymbolicLink()||output&&!output.isFile())throw new Error('--out must be a regular JSON file');
  if(output)for(const file of inputs.files) {
    if(file.identity&&String(output.dev)===String(file.identity.dev)&&String(output.ino)===String(file.identity.ino))throw new Error('--out must not overwrite an input PSF/library');
  }
}
async function writeReport(path,report) {
  const json=JSON.stringify(report,null,2)+'\n';
  if(Buffer.byteLength(json)>REPORT_BYTES)throw new Error('Diagnostic JSON exceeded its bounded report budget.');
  await mkdir(dirname(path),{recursive:true});
  const temporary=join(dirname(path),`.${process.pid}-${randomUUID()}.psf-report.tmp`);let handle;
  try {handle=await open(temporary,'wx',0o600);await handle.writeFile(json);await handle.close();handle=null;await rename(temporary,path);}
  finally {await handle?.close();await rm(temporary,{force:true});}
}

export async function runPsfBatch(args,{stdout=console.log,stderr=console.error}={}) {
  if(args.length===1&&args[0]==='--help'){stdout(usage);return 0;}
  let controller,interrupt=null,out,outputChecked=false;
  const interrupted=signal=>{interrupt=signal;controller?.abort();};
  const sigint=()=>interrupted('SIGINT'),sigterm=()=>interrupted('SIGTERM');
  try {
    const[directory,...rest]=args;if(!directory||directory.startsWith('--'))throw new Error(usage);
    const config={},names=new Set();
    const flags={'--entry':'entry','--seconds':'seconds','--timeout-ms':'timeoutMs','--batch-timeout-ms':'batchTimeoutMs','--max-entries':'maxEntries','--out':'out'};
    for(let index=0;index<rest.length;index++) {
      const [flag,inline]=rest[index].split(/=(.*)/s),key=flags[flag],value=inline??rest[++index];
      if(!key||names.has(key)||!value||value.startsWith('--'))throw new Error(usage);names.add(key);
      if(key==='out')out=resolve(value);
      else if(key==='entry')config.entry=value;
      else {if(!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(value))throw new Error(usage);config[key]=Number(value);}
    }
    optionsOf(config);
    if(config.timeoutMs!==undefined&&config.timeoutMs<100||config.batchTimeoutMs!==undefined&&config.batchTimeoutMs<100)throw new Error('CLI timeouts must be at least 100 ms');
    if(out)await checkOutput(out,{files:[]});
    controller=new AbortController();process.once('SIGINT',sigint);process.once('SIGTERM',sigterm);
    const report=await diagnosePsfFolder(directory,{...config,signal:controller.signal,
      onInputs:async inputs=>{if(out){await checkOutput(out,inputs);outputChecked=true;}},
      onProgress:event=>{if(event.phase==='load')stderr(`PSF ${event.entry}: load`);},
      onCheckpoint:out?async report=>{if(outputChecked||!report.scanComplete)await writeReport(out,report);}:undefined,
    });
    const json=JSON.stringify(report,null,2);
    if(Buffer.byteLength(json)>REPORT_BYTES)throw new Error('Diagnostic JSON exceeded its bounded report budget.');
    stdout(json);
    if(interrupt)return interrupt==='SIGINT'?130:143;
    return report.status==='complete'&&!report.summary.errors&&!report.summary.timeouts&&!report.summary.crashes&&!report.summary.aborted?0:1;
  }catch(error){stderr(message(error));return interrupt?(interrupt==='SIGINT'?130:143):1;}
  finally {process.removeListener('SIGINT',sigint);process.removeListener('SIGTERM',sigterm);}
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))process.exitCode=await runPsfBatch(process.argv.slice(2));

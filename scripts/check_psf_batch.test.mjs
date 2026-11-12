// SPDX-License-Identifier: BSD-3-Clause
// Original PSF programs + real isolated Node/WASM workers. No audio device.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,link} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {diagnosePsfFolder,runPsfBatch} from './check_psf_batch.mjs';
import {createPsfPlaybackFixture,playbackExe} from '../test/helpers/spu_psf_playback_fixture.mjs';
import {psfFromExe} from '../test/helpers/spu_psf_fixture.mjs';

const fixture=createPsfPlaybackFixture(),seconds=.05,frames=2205;
const workerUrl=new URL('./psf_batch_worker.mjs',import.meta.url).href;
const cli=fileURLToPath(new URL('./check_psf_batch.mjs',import.meta.url));
const renderedOptions={seconds,timeoutMs:10000};
async function folder(t) {
  const directory=await mkdtemp(join(tmpdir(),'psf-batch-test-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));return directory;
}
async function put(directory,path,bytes) {
  const target=join(directory,path);await mkdir(dirname(target),{recursive:true});await writeFile(target,bytes);return target;
}
async function mixed(t) {
  const directory=await folder(t),text=new Uint8Array(8);
  new DataView(text.buffer).setUint32(0,0x1000ffff,true); // silent CPU loop
  const bad=fixture.standalone.slice();bad[12]^=1;
  await put(directory,'tunes/a.psf',fixture.standalone);
  await put(directory,'tunes/b.minipsf',fixture.mini);
  await put(directory,'tunes/lib/driver.psflib',fixture.library);
  await put(directory,'tunes/c-silent.psf',psfFromExe(playbackExe(text)));
  await put(directory,'tunes/d-crc.psf',bad);
  await put(directory,'tunes/e-missing.minipsf',psfFromExe(fixture.exe,'_lib=missing.psflib\n'));
  await put(directory,'tunes/f-version.psf',psfFromExe(fixture.exe,'',{version:2}));
  return directory;
}
async function waitFor(read,predicate,label) {
  const deadline=Date.now()+5000;
  while(Date.now()<deadline) {
    const value=await read();if(predicate(value))return value;
    await new Promise(resolve=>setTimeout(resolve,10));
  }
  throw new Error('Timed out waiting for '+label);
}
const maybeRead=path=>readFile(path,'utf8').catch(error=>{if(error.code==='ENOENT')return null;throw error;});
const reaped=pid=>assert.throws(()=>process.kill(pid,0),error=>error.code==='ESRCH','worker must be killed and reaped before the batch resolves');
async function timeoutWorker(t,directory,{crash=false}={}) {
  const path=join(await folder(t),'worker.mjs'),pidFile=join(directory,'worker.pid');
  await writeFile(path,`import {writeFileSync} from 'node:fs';
process.once('message',async job=>{
  if(job.entry==='a.psf'){
    writeFileSync(${JSON.stringify(pidFile)},String(process.pid));
    process.send({type:'progress',phase:'create'});
    ${crash?"process.exit(23);":"while(true){}"}
  }else{
    const {diagnosePsfBatchEntry}=await import(${JSON.stringify(workerUrl)});
    const result=await diagnosePsfBatchEntry(job);
    process.send({type:'result',result},()=>process.disconnect());
  }
});`);
  return {path,pidFile};
}

test('real mixed PSF/MiniPSF batch continues after CRC, missing library and unsupported version; silence succeeds',async t=>{
  const directory=await mixed(t),report=await diagnosePsfFolder(directory,renderedOptions);
  assert.equal(report.status,'complete');assert.equal(report.entriesInSet,6);assert.equal(report.entriesSelected,6);
  assert.deepEqual(report.results.map(r=>r.entry),['tunes/a.psf','tunes/b.minipsf','tunes/c-silent.psf','tunes/d-crc.psf','tunes/e-missing.minipsf','tunes/f-version.psf']);
  assert.deepEqual(report.results.map(r=>r.status),['rendered','rendered','rendered','error','error','error']);
  assert.equal(report.summary.rendered,3);assert.equal(report.summary.errors,3);assert.equal(report.summary.remaining,0);
  for(const result of report.results.slice(0,3)) {
    assert.equal(result.backend.abi,4);assert.equal(result.metrics.targetFrames,frames);
    assert.equal(result.metrics.renderedFrames,frames);assert.equal(result.metrics.sampleRate,44100);
    assert.equal(result.metrics.pcm.samples,frames*2);assert.equal(result.metrics.pcm.nonFiniteSamples,0);
    assert.equal(result.metrics.nativeFrames.final,frames);assert.equal(result.metrics.nativeFrames.monotonic,true);
    assert.equal(result.metrics.nativeFrames.matchedProgress,true);assert.equal(result.activity.channels.length,24);
    assert.match(result.spuRam.before.sha256,/^[a-f0-9]{64}$/);assert.match(result.spuRam.after.sha256,/^[a-f0-9]{64}$/);
    assert(result.metrics.pcm.channels.every(channel=>channel.finiteSamples===frames));
  }
  const [plain,mini,silent,crc,missing,version]=report.results;
  assert(plain.metrics.pcm.channels[0].peak>.001);assert.equal(plain.metrics.pcm.silent,false);
  assert.notEqual(plain.metrics.pcm.sha256,mini.metrics.pcm.sha256,'MiniPSF instruction overlay must affect actual PCM');
  assert(mini.loadedFiles.includes('tunes/lib/driver.psflib'));
  assert(plain.spuRam.changedBytes>0);assert(plain.activity.activeMask&1);
  assert.equal(silent.metrics.pcm.silent,true);assert.equal(silent.metrics.pcm.channels[0].peak,0);
  assert.equal(silent.metrics.pcm.sha256,createHash('sha256').update(Buffer.alloc(frames*2*4)).digest('hex'));
  assert.equal(silent.spuRam.changedBytes,0);assert.equal(silent.activity.activeMask,0);
  assert.match(crc.error.message,/CRC/i);assert.match(missing.error.message,/missing.*lib|lib.*missing/i);
  assert.match(version.error.message,/version|PSF2|PSF.*2/i);
  assert.equal(new Set([crc.error.code,missing.error.code,version.error.code]).size,3,'failures have distinct classifications');
  assert.doesNotMatch(JSON.stringify(report),/"adpcm"|"pcmData"|"ramBytes"/,'no sample or raw RAM payload in the report');
  assert.equal(typeof globalThis.AudioContext,'undefined');
});

test('entry selection and first-N limit keep the full inventory and isolate corrupt unrelated siblings',async t=>{
  const directory=await mixed(t);
  const selected=await diagnosePsfFolder(directory,{...renderedOptions,entry:'tunes/b.minipsf'});
  assert.equal(selected.entriesInSet,6);assert.equal(selected.entriesSelected,1);
  assert.equal(selected.results[0].status,'rendered');assert.equal(selected.results[0].entry,'tunes/b.minipsf');
  const limited=await diagnosePsfFolder(directory,{...renderedOptions,maxEntries:2});
  assert.equal(limited.entriesInSet,6);assert.equal(limited.entriesSelected,2);assert.equal(limited.excludedByLimit,4);
  assert.equal(limited.summary.remaining,0);assert.equal(limited.summary.rendered,2);
});

test('CLI emits final JSON, progress separately, complete failure status and safe output validation',async t=>{
  const directory=await mixed(t),out=join(directory,'report.json'),stdout=[],stderr=[];
  const io={stdout:value=>stdout.push(value),stderr:value=>stderr.push(value)};
  assert.equal(await runPsfBatch([directory,'--entry','tunes/c-silent.psf','--seconds','0.05','--out',out],io),0);
  assert.deepEqual(JSON.parse(stdout.pop()),JSON.parse(await readFile(out,'utf8')));
  assert(stderr.length>0);assert.equal(await runPsfBatch([directory,'--seconds','0.05'],io),1);
  assert.equal(JSON.parse(stdout.pop()).summary.errors,3);
  const input=join(directory,'tunes/a.psf'),alias=join(directory,'alias.json');await link(input,alias);
  for(const args of [[],[directory,'--seconds','0'],[directory,'--timeout-ms','99'],
    [directory,'--batch-timeout-ms','99'],[directory,'--max-entries','513'],
    [directory,'--entry'],[directory,'--bad','x'],[directory,'--out',input],[directory,'--out',alias]]) {
    assert.equal(await runPsfBatch(args,io),1);
  }
  assert.deepEqual(await readFile(input),Buffer.from(fixture.standalone),'--out cannot overwrite an input, including a hardlink');
});

test('a synchronous hung initializer is hard-killed and reaped, then the next real worker renders',async t=>{
  const directory=await folder(t);await put(directory,'a.psf',fixture.standalone);await put(directory,'b.psf',fixture.standalone);
  const worker=await timeoutWorker(t,directory);
  const report=await diagnosePsfFolder(directory,{seconds,timeoutMs:1000,workerFile:worker.path});
  assert.equal(report.status,'complete');assert.deepEqual(report.results.map(r=>r.status),['timeout','rendered']);
  assert.equal(report.results[0].error.code,'worker-timeout');assert.equal(report.results[0].phase,'create');
  assert.equal(report.summary.timeouts,1);assert.equal(report.summary.rendered,1);assert.equal(report.summary.remaining,0);
  reaped(Number(await readFile(worker.pidFile,'utf8')));
});

test('a crashed worker is isolated and does not prevent the next real worker from rendering',async t=>{
  const directory=await folder(t);await put(directory,'a.psf',fixture.standalone);await put(directory,'b.psf',fixture.standalone);
  const worker=await timeoutWorker(t,directory,{crash:true});
  const report=await diagnosePsfFolder(directory,{...renderedOptions,workerFile:worker.path});
  assert.deepEqual(report.results.map(r=>r.status),['crash','rendered']);assert.equal(report.summary.crashes,1);
  reaped(Number(await readFile(worker.pidFile,'utf8')));
});

test('abort reaps the active process and counts unstarted selected entries; preabort starts no workers',async t=>{
  const directory=await folder(t);await put(directory,'a.psf',fixture.standalone);await put(directory,'b.psf',fixture.standalone);
  const worker=await timeoutWorker(t,directory),controller=new AbortController();
  const pending=diagnosePsfFolder(directory,{seconds,timeoutMs:10000,workerFile:worker.path,signal:controller.signal});
  const pid=Number(await waitFor(()=>maybeRead(worker.pidFile),value=>value!==null,'worker PID'));
  controller.abort();const report=await pending;
  assert.equal(report.status,'aborted');assert.equal(report.results[0].status,'aborted');
  assert.equal(report.summary.aborted,1);assert.equal(report.summary.remaining,1);reaped(pid);
  await rm(worker.pidFile);
  const stopped=new AbortController();stopped.abort();
  const early=await diagnosePsfFolder(directory,{...renderedOptions,workerFile:worker.path,signal:stopped.signal});
  assert.equal(early.status,'aborted');assert.deepEqual(early.results,[]);assert.equal(await maybeRead(worker.pidFile),null);
});

test('batch wall-time budget aborts an active worker without starting the rest',async t=>{
  const directory=await folder(t);await put(directory,'a.psf',fixture.standalone);await put(directory,'b.psf',fixture.standalone);
  const worker=await timeoutWorker(t,directory);
  const report=await diagnosePsfFolder(directory,{seconds,timeoutMs:10000,batchTimeoutMs:500,workerFile:worker.path});
  assert.equal(report.status,'incomplete');assert.equal(report.stoppedBecause,'batch-timeout');
  assert.equal(report.results[0].error.code,'batch-timeout');assert.equal(report.summary.remaining,1);
  reaped(Number(await readFile(worker.pidFile,'utf8')));
});

test('CLI checkpoints are complete JSON before completion and SIGINT exits 130 with a final partial report',async t=>{
  const directory=await folder(t),out=join(directory,'checkpoint.json');
  for(let index=0;index<8;index++)await put(directory,`${index}.psf`,fixture.standalone);
  const child=spawn(process.execPath,[cli,directory,'--seconds','0.05','--out',out],{stdio:['ignore','pipe','pipe']});
  t.after(()=>{if(child.exitCode===null)child.kill('SIGKILL');});
  let stdout='',stderr='';child.stdout.on('data',bytes=>stdout+=bytes);child.stderr.on('data',bytes=>stderr+=bytes);
  const closed=once(child,'close');
  const partial=await waitFor(async()=>{const text=await maybeRead(out);return text===null?null:JSON.parse(text);},
    value=>value&&value.results.length>0&&value.results.length<8,'atomic partial JSON checkpoint');
  assert(partial.summary.remaining>0);child.kill('SIGINT');
  const [code,signal]=await closed;assert.equal(signal,null);assert.equal(code,130,stderr);
  const final=JSON.parse(await readFile(out,'utf8'));
  assert.equal(final.status,'aborted');assert(final.summary.remaining>0);assert.deepEqual(JSON.parse(stdout),final);
});

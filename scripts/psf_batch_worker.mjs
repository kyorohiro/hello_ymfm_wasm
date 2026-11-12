// SPDX-License-Identifier: BSD-3-Clause
// One isolated numeric PSF1 diagnostic. No audio device, browser or PCM files.
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {loadPsfBatchEntry} from './psf_batch_inputs.mjs';
import {preparePsfSongSource} from '../docs/synth-spu/psf_song_source.js';
import {createPsfPlaybackCore} from '../docs/synth-spu/psf_playback_core.js';

const RATE=44100,SPU_BYTES=512*1024;
const CODES=new Set(['missing-library','ambiguous-library','invalid-container','unsupported-psf-version',
  'invalid-entry-point','unsupported-runtime','render-failed','non-finite-pcm','native-frame-stalled','input-changed']);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const diagnostic=(code,message)=>Object.assign(new Error(message),{code});
const messageOf=error=>String(error?.message??error).slice(0,2048);

export function classifyPsfBatchError(error,phase){
  if(CODES.has(error?.code))return error.code;
  const message=messageOf(error);
  if(/file (?:size )?changed|input.changed|identity changed|no longer matches/i.test(message))return'input-changed';
  if(/missing (?:PSFLib|library)|missing-library/i.test(message))return'missing-library';
  if(/ambiguous (?:PSFLib|library)|ambiguous-library/i.test(message))return'ambiguous-library';
  if(/unsupported version|PSF1 only|PSF2/i.test(message))return'unsupported-psf-version';
  if(/entry point|valid loaded entry|choose a PSF entry/i.test(message))return'invalid-entry-point';
  if(/non.finite (?:PCM|sample)/i.test(message))return'non-finite-pcm';
  if(/native frame|CPU did not advance/i.test(message))return'native-frame-stalled';
  if(/does not support|unsupported|unknown (?:HLE|BIOS)|unhandled|not implemented|components are out of date/i.test(message))return'unsupported-runtime';
  return phase==='load'||phase==='prepare'?'invalid-container':phase==='create'?'unsupported-runtime':'render-failed';
}

function boundedList(values,budget){
  const entries=[];let bytes=2;
  for(const value of values){const length=Buffer.byteLength(JSON.stringify(value))+1;if(bytes+length>budget)break;entries.push(value);bytes+=length;}
  return{entries,total:values.length,truncated:entries.length!==values.length};
}
function ramSummary(bytes){
  if(!(bytes instanceof Uint8Array)||bytes.length!==SPU_BYTES)throw diagnostic('render-failed','SPU diagnostic RAM copy must be exactly 512 KiB.');
  let nonZeroBytes=0;for(const byte of bytes)if(byte)nonZeroBytes++;
  return{sha256:sha(bytes),nonZeroBytes};
}

function projectSnapshot(state){
  if(!Number.isSafeInteger(state?.nativeFrames)||state.nativeFrames<0||state.channels?.length!==24)
    throw diagnostic('native-frame-stalled','PSF diagnostic observation has an invalid native frame or channel count.');
  const observation=state.observation;
  return{nativeFrames:state.nativeFrames,control:observation.control,keyGateMask:observation.keyGateMask,
    activeMask:observation.activeMask,noiseMask:observation.noiseMask,pmonMask:observation.pmonMask,reverbMask:observation.reverbMask,
    main:{rawVolumeLeft:state.main.rawVolumeLeft,rawVolumeRight:state.main.rawVolumeRight},
    reverb:{preset:state.reverb.preset,enabled:state.reverb.enabled,baseAddress:state.reverb.baseAddress,
      rawVolumeLeft:state.reverb.rawVolumeLeft,rawVolumeRight:state.reverb.rawVolumeRight,registers:state.reverb.registers.slice(0,32)},
    channels:state.channels.map((voice,channel)=>({channel,startAddress:voice.startAddress,repeatAddress:voice.repeatAddress,
      pitch:voice.pitch,adsr1:voice.adsr1,adsr2:voice.adsr2,envelope:voice.envelope,gate:voice.gate,active:voice.active,
      ended:voice.ended,noise:voice.noise,pmon:voice.hardwarePmon,reverb:voice.reverb,rawRegisters:voice.rawRegisters.slice(0,8)}))};
}
function createActivity(){return{sampling:'chunk-boundaries',observations:0,gateMask:0,activeMask:0,nonZeroEnvelopeMask:0,activeEnvelopeMask:0,
  channels:Array.from({length:24},(_,channel)=>({channel,gateObserved:false,activeObserved:false,nonZeroEnvelopeObserved:false,
    maxEnvelope:0,minPitch:null,maxPitch:null,noiseObserved:false,pmonObserved:false,reverbSendObserved:false,endedObserved:false}))};}
function includeActivity(activity,state){
  activity.observations++;
  for(const voice of state.channels){const summary=activity.channels[voice.channel],mask=1<<voice.channel;
    if(voice.gate){summary.gateObserved=true;activity.gateMask|=mask;}
    if(voice.active){summary.activeObserved=true;activity.activeMask|=mask;}
    if(voice.envelope>0){summary.nonZeroEnvelopeObserved=true;activity.nonZeroEnvelopeMask|=mask;if(voice.active)activity.activeEnvelopeMask|=mask;}
    summary.maxEnvelope=Math.max(summary.maxEnvelope,voice.envelope);
    summary.minPitch=summary.minPitch===null?voice.pitch:Math.min(summary.minPitch,voice.pitch);
    summary.maxPitch=summary.maxPitch===null?voice.pitch:Math.max(summary.maxPitch,voice.pitch);
    summary.noiseObserved||=voice.noise;summary.pmonObserved||=voice.pmon;summary.reverbSendObserved||=voice.reverb;summary.endedObserved||=voice.ended;
  }
}
function createPcmMetrics(){
  const hash=createHash('sha256'),channels=Array.from({length:2},()=>({samples:0,finiteSamples:0,nonFiniteSamples:0,nonZeroSamples:0,peak:0,sum:0,squares:0}));
  return{
    add(pcm,frames){
      if(!(pcm instanceof Float32Array)||pcm.length!==frames*2)throw diagnostic('render-failed','PSF core returned an invalid interleaved PCM length.');
      // Hash the original IEEE-754 bits in explicit little-endian order,
      // preserving -0 and even a non-finite diagnostic payload exactly.
      const words=new Uint32Array(pcm.buffer,pcm.byteOffset,pcm.length),bytes=Buffer.allocUnsafe(pcm.byteLength);
      for(let i=0;i<pcm.length;i++){
        bytes.writeUInt32LE(words[i],i*4);const value=pcm[i],channel=channels[i&1];channel.samples++;
        if(!Number.isFinite(value)){channel.nonFiniteSamples++;continue;}
        channel.finiteSamples++;if(value!==0)channel.nonZeroSamples++;
        channel.peak=Math.max(channel.peak,Math.abs(value));channel.sum+=value;channel.squares+=value*value;
      }
      hash.update(bytes);
    },
    finish(){const samples=channels.reduce((total,ch)=>total+ch.samples,0),nonFiniteSamples=channels.reduce((total,ch)=>total+ch.nonFiniteSamples,0);
      return{format:'float32le-stereo-interleaved',sha256:hash.digest('hex'),samples,nonFiniteSamples,
        silent:samples?nonFiniteSamples===0&&channels.every(ch=>ch.nonZeroSamples===0):null,
        channels:channels.map(({sum,squares,...channel})=>({...channel,mean:channel.finiteSamples?sum/channel.finiteSamples:null,rms:channel.finiteSamples?Math.sqrt(squares/channel.finiteSamples):null}))};},
    get nonFiniteSamples(){return channels.reduce((total,ch)=>total+ch.nonFiniteSamples,0);},
  };
}

/** Diagnose one entry. The orchestrator owns hard wall time and process kill;
 * synchronous WASM execution cannot be interrupted by a same-process timer. */
export async function diagnosePsfBatchEntry(job,{onProgress=()=>{}}={}){
  const started=performance.now(),pcm=createPcmMetrics(),activity=createActivity();
  let phase='load',phaseStarted=started,core=null,beforeRam=null,lastNative=null,error=null,notifiedFrames=0;
  const result={entry:typeof job?.entry==='string'?job.entry.slice(0,1024):'',title:'',status:'error',phase,
    loadedFiles:[],sources:[],metadata:{sourceCount:0,sourcesTruncated:false,loadedFileCount:0,loadedFilesTruncated:false,titleTruncated:false},
    backend:{abi:4,engine:'play-hle+mame-ps1-spu',sampleRate:RATE},
    metrics:{targetFrames:0,renderedFrames:0,sampleRate:RATE,pcm:null,
      nativeFrames:{initial:null,final:null,expectedFinal:null,monotonic:true,matchedProgress:true,observations:0},elapsedMs:{}},
    snapshots:{first:null,final:null},activity,spuRam:{before:null,after:null,changedBytes:null}};
  const notify=()=>{try{onProgress({type:'progress',phase,renderedFrames:result.metrics.renderedFrames,targetFrames:result.metrics.targetFrames});}catch{/* Progress is not part of machine execution. */}};
  function changePhase(next){result.metrics.elapsedMs[phase]=(result.metrics.elapsedMs[phase]??0)+(performance.now()-phaseStarted);phase=next;phaseStarted=performance.now();notify();}
  function observe({final=false}={}){
    const state=projectSnapshot(core.observe()),native=result.metrics.nativeFrames;
    if(native.initial===null)native.initial=state.nativeFrames;
    native.observations++;native.final=state.nativeFrames;native.expectedFinal=native.initial+result.metrics.renderedFrames;
    if(lastNative!==null&&state.nativeFrames<lastNative)native.monotonic=false;
    if(state.nativeFrames!==native.expectedFinal)native.matchedProgress=false;
    lastNative=state.nativeFrames;
    if(!result.snapshots.first)result.snapshots.first=state;
    result.snapshots.final=state;includeActivity(activity,state);
    if(!final&&(!native.monotonic||!native.matchedProgress))throw diagnostic('native-frame-stalled',`PSF native frame ${state.nativeFrames} does not match rendered progress ${native.expectedFinal}.`);
  }
  try{
    notify();
    const seconds=job?.seconds??2,chunkFrames=job?.chunkFrames??4410;
    if(typeof job?.root!=='string'||!Array.isArray(job.files)||typeof job.entry!=='string'||
       !Number.isFinite(seconds)||seconds<=0||!Number.isSafeInteger(Math.round(seconds*RATE))||
       !Number.isSafeInteger(chunkFrames)||chunkFrames<1||chunkFrames>RATE)
      throw diagnostic('invalid-container','Invalid isolated PSF diagnostic job.');
    result.metrics.targetFrames=Math.round(seconds*RATE);
    if(!result.metrics.targetFrames)throw diagnostic('invalid-container','PSF diagnostic duration must include at least one native frame.');
    const input=await loadPsfBatchEntry(job.root,job.files,job.entry);result.entry=input.entry;
    const title=String(input.title??'');result.title=title.slice(0,512);result.metadata.titleTruncated=title.length>result.title.length;
    const sources=boundedList(input.sources.map(({path,bytes,sha256})=>({path,bytes,sha256})),40*1024);
    result.sources=sources.entries;result.metadata.sourceCount=sources.total;result.metadata.sourcesTruncated=sources.truncated;
    changePhase('prepare');
    const image=await preparePsfSongSource(input.set,input.entry),loaded=boundedList(image.loadedFiles,24*1024);
    result.loadedFiles=loaded.entries;result.metadata.loadedFileCount=loaded.total;result.metadata.loadedFilesTruncated=loaded.truncated;
    changePhase('create');
    const wasmBinary=new Uint8Array(await readFile(new URL('../docs/generated/psf-player/psf_player.wasm',import.meta.url)));
    Object.assign(result.backend,{wasmBytes:wasmBinary.byteLength,wasmSha256:sha(wasmBinary)});
    core=await createPsfPlaybackCore({image,wasmBinary,moduleOptions:{print:()=>{},printErr:()=>{}}});
    if(core.sampleRate!==RATE||core.backend.abi!==4)throw diagnostic('unsupported-runtime','PSF batch worker needs the current ABI4 44100 Hz backend.');
    observe();beforeRam=core.copySpuRam();result.spuRam.before=ramSummary(beforeRam);
    changePhase('render');
    while(result.metrics.renderedFrames<result.metrics.targetFrames){
      const count=Math.min(chunkFrames,result.metrics.targetFrames-result.metrics.renderedFrames),output=core.render(count);
      pcm.add(output,count);result.metrics.renderedFrames+=count;observe();
      // Tiny diagnostic chunks must not generate unbounded IPC promises.
      // Report at most ten times per native second, plus the final boundary.
      if(result.metrics.renderedFrames-notifiedFrames>=RATE/10||result.metrics.renderedFrames===result.metrics.targetFrames){notify();notifiedFrames=result.metrics.renderedFrames;}
      if(pcm.nonFiniteSamples)throw diagnostic('non-finite-pcm','PSF core produced non-finite PCM samples.');
    }
    result.status='rendered';
  }catch(cause){error={code:classifyPsfBatchError(cause,phase),message:messageOf(cause)};}
  finally{
    // Even a failed native render may have advanced part of its final chunk.
    // Preserve successful-chunk PCM metrics and report that final native image
    // separately, without inventing output for the incomplete chunk.
    if(core){
      try{observe({final:true});}catch(cause){if(!error)error={code:classifyPsfBatchError(cause,phase),message:messageOf(cause)};}
      try{const after=core.copySpuRam();result.spuRam.after=ramSummary(after);if(beforeRam){let changed=0;for(let i=0;i<after.length;i++)if(after[i]!==beforeRam[i])changed++;result.spuRam.changedBytes=changed;}}
      catch(cause){if(!error)error={code:classifyPsfBatchError(cause,phase),message:messageOf(cause)};}
      try{core.dispose();}catch(cause){if(!error)error={code:classifyPsfBatchError(cause,phase),message:messageOf(cause)};}
    }
    const native=result.metrics.nativeFrames;
    native.unaccountedFrames=native.initial===null||native.final===null?null:native.final-native.initial-result.metrics.renderedFrames;
    result.metrics.elapsedMs[phase]=(result.metrics.elapsedMs[phase]??0)+(performance.now()-phaseStarted);
    result.metrics.elapsedMs.total=performance.now()-started;result.metrics.pcm=pcm.finish();result.phase=phase;
    if(error){result.status='error';result.error=error;}
  }
  return result;
}

// A temporary test worker may import this module before delegating its first
// IPC job. No listeners, output or subprocess are created on ordinary import.
if(process.send){
  process.once('message',async job=>{
    const send=value=>new Promise(resolve=>{if(!process.connected)return resolve();try{process.send(value,()=>resolve());}catch{resolve();}});
    const result=await diagnosePsfBatchEntry(job,{onProgress:progress=>{void send(progress);}});
    await send({type:'result',result});
    if(process.connected)process.disconnect();process.exitCode=0;
  });
}

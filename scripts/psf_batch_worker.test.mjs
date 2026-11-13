import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {fork} from 'node:child_process';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createPsfSpuFeatureFixture} from '../test/helpers/spu_psf_playback_fixture.mjs';
import {collectPsfBatchInputs,loadPsfBatchEntry} from './psf_batch_inputs.mjs';
import {preparePsfSongSource} from '../docs/synth-spu/psf_song_source.js';
import {createPsfPlaybackCore} from '../docs/synth-spu/psf_playback_core.js';
import {diagnosePsfBatchEntry,classifyPsfBatchError} from './psf_batch_worker.mjs';

async function fixture(t,options={}){
  const root=await mkdtemp(join(tmpdir(),'psf-batch-worker-test-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const fixture=createPsfSpuFeatureFixture(options);await writeFile(join(root,'original.psf'),fixture.standalone);
  return{fixture,...await collectPsfBatchInputs(root),entry:'original.psf',seconds:.02,chunkFrames:37};
}
const floatHash=pcm=>{const words=new Uint32Array(pcm.buffer,pcm.byteOffset,pcm.length),bytes=Buffer.allocUnsafe(pcm.byteLength);for(let i=0;i<words.length;i++)bytes.writeUInt32LE(words[i],i*4);return createHash('sha256').update(bytes).digest('hex');};

test('worker PCM hash is chunk-independent and equals direct ABI5 output, without preview or sample payloads',async t=>{
  const job=await fixture(t,{transfer:'dma-roundtrip',pmon:true,carrier:23,reverb:true}),progress=[];
  const result=await diagnosePsfBatchEntry(job,{onProgress:value=>progress.push(value)}),other=await diagnosePsfBatchEntry({...job,chunkFrames:441});
  assert.equal(result.status,'rendered');assert.equal(result.metrics.renderedFrames,882);assert.equal(result.metrics.pcm.silent,false);assert.deepEqual(result.metrics.pcm,other.metrics.pcm);
  const input=await loadPsfBatchEntry(job.root,job.files,job.entry),image=await preparePsfSongSource(input.set,input.entry);
  const wasmBinary=new Uint8Array(await readFile(new URL('../docs/generated/psf-player/psf_player.wasm',import.meta.url)));
  const core=await createPsfPlaybackCore({image,wasmBinary});
  try{assert.equal(result.metrics.pcm.sha256,floatHash(core.render(882)));}finally{core.dispose();}
  assert.equal(result.metrics.nativeFrames.final,882);assert.equal(result.metrics.nativeFrames.matchedProgress,true);assert.equal(result.metrics.nativeFrames.unaccountedFrames,0);
  assert.equal(result.activity.channels[22].activeObserved,true,'zero-volume PMON source still processes');assert.equal(result.activity.channels[23].activeObserved,true);
  assert.equal(result.snapshots.first.channels.length,24);assert.equal(result.snapshots.final.channels[23].rawRegisters.length,8);
  assert(result.spuRam.changedBytes>0);assert.notEqual(result.spuRam.before.sha256,result.spuRam.after.sha256);
  assert.equal(result.sources.length,1);assert.equal(result.sources[0].bytes,job.fixture.standalone.length);assert.deepEqual(result.loadedFiles,['original.psf']);
  assert.deepEqual([...new Set(progress.map(value=>value.phase))],['load','prepare','create','render']);
  const serialized=JSON.stringify(result);assert(Buffer.byteLength(serialized)<128*1024);
  for(const snapshot of Object.values(result.snapshots)){assert.equal('samples'in snapshot,false);assert(snapshot.channels.every(voice=>!('waveform'in voice)&&!('pcm'in voice)));}
});

test('silent PCM is rendered successfully while native voices and RAM remain diagnostic',async t=>{
  const job=await fixture(t,{mainLeft:0,mainRight:0});const result=await diagnosePsfBatchEntry(job);
  assert.equal(result.status,'rendered');assert.equal(result.metrics.pcm.silent,true);assert.equal(result.metrics.pcm.nonFiniteSamples,0);
  assert(result.metrics.pcm.channels.every(ch=>ch.samples===882&&ch.nonZeroSamples===0&&ch.peak===0&&ch.rms===0));
  assert(result.activity.activeEnvelopeMask>0);assert(result.spuRam.changedBytes>0);
});

test('a later unsupported CPU write preserves successful PCM chunks and reports final partial native progress',async t=>{
  const job=await fixture(t,{steps:[{delay:65535,writes:[[0,0x8000]]}]});
  const result=await diagnosePsfBatchEntry({...job,chunkFrames:64});assert.equal(result.status,'error');assert.equal(result.phase,'render');
  assert.equal(result.error.code,'unsupported-runtime');assert.match(result.error.message,/volume sweeps/);
  assert(result.metrics.renderedFrames>0&&result.metrics.renderedFrames<result.metrics.targetFrames);
  assert.equal(result.metrics.pcm.samples,result.metrics.renderedFrames*2);assert(result.metrics.pcm.channels[0].peak>0);
  assert(result.metrics.nativeFrames.final>=result.metrics.renderedFrames);assert(result.metrics.nativeFrames.unaccountedFrames>=0);
  assert(result.snapshots.final);assert(result.spuRam.after);assert(result.spuRam.changedBytes>0);
});

test('stable error codes preserve explicit input failures and classify staged runtime messages',()=>{
  for(const [error,phase,code]of [
    [Object.assign(Error('changed'),{code:'input-changed'}),'load','input-changed'],
    [Error('PSF: missing PSFLib lib/driver.psflib'),'load','missing-library'],
    [Error('PSF: ambiguous library path: lib/x'),'prepare','ambiguous-library'],
    [Error('PSF: unsupported version 2 (PSF1 only)'),'load','unsupported-psf-version'],
    [Error('PSF song has no valid loaded entry point.'),'prepare','invalid-entry-point'],
    [Error('PSF fixed SPU does not support volume sweeps.'),'render','unsupported-runtime'],
    [Error('PSF core produced non-finite PCM samples.'),'render','non-finite-pcm'],
    [Error('PSF CPU did not advance within its render budget.'),'render','native-frame-stalled'],
    [Error('PSF: compressed program CRC-32 mismatch'),'load','invalid-container'],
    [Error('Original numeric failure'),'render','render-failed'],
  ])assert.equal(classifyPsfBatchError(error,phase),code);
});

test('forked worker sends progress then result, exits cleanly, and writes no stdout or stderr',async t=>{
  const job=await fixture(t);const worker=fork(fileURLToPath(new URL('./psf_batch_worker.mjs',import.meta.url)),[],{execArgv:['--max-old-space-size=256'],stdio:['ignore','pipe','pipe','ipc']});
  t.after(()=>{if(worker.exitCode===null)worker.kill('SIGKILL');});const messages=[],stdout=[],stderr=[];
  worker.stdout.on('data',chunk=>stdout.push(chunk));worker.stderr.on('data',chunk=>stderr.push(chunk));worker.on('message',message=>messages.push(message));
  const exit=new Promise((resolve,reject)=>{const timer=setTimeout(()=>{worker.kill('SIGKILL');reject(Error('Numeric worker did not exit'));},10000);worker.once('error',reject);worker.once('exit',(code,signal)=>{clearTimeout(timer);resolve({code,signal});});});
  const{fixture:unused,...messageJob}=job;worker.send(messageJob);assert.deepEqual(await exit,{code:0,signal:null});assert.equal(Buffer.concat(stdout).length,0);assert.equal(Buffer.concat(stderr).length,0);
  assert(messages.some(message=>message.type==='progress'&&message.phase==='render'));assert.equal(messages.at(-1).type,'result');assert.equal(messages.at(-1).result.status,'rendered');
});

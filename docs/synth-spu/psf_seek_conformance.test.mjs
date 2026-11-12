// SPDX-License-Identifier: BSD-3-Clause
// Original MIPS only. Numeric PSF seek evidence, without an audio device.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createPsfPlaybackCore} from './psf_playback_core.js';
import {createPsfSongPreview} from './psf_song_preview.js';
import {preparePsfSongSource} from './psf_song_source.js';
import {readPsfFileSet} from '../playground/playground_ps1_psf.js';
import {createPsfSpuFeatureFixture} from '../../test/helpers/spu_psf_playback_fixture.mjs';

const RATE=44100,SPU_BYTES=512*1024,CPU_BYTES=2*1024*1024;
const wasmBinary=new Uint8Array(await readFile(new URL('../generated/psf-player/psf_player.wasm',import.meta.url)));
const deferred=()=>{let resolve;const promise=new Promise(yes=>resolve=yes);return {promise,resolve};};
function authoredFixture() {
  const control=0xc080|(37<<8);
  return createPsfSpuFeatureFixture({transfer:'dma-roundtrip',pmon:true,carrier:23,reverb:true,noiseClock:37,
    steps:[
      {delay:65535,writes:[[0x196,0x40],[0x1aa,0xc080|(53<<8)],[0x184,0x1000]]},
      {delay:65535,writes:[[0x1aa,control|0x10],[0x1a6,0x2008/8],[0x1a8,0x1122],[0x1aa,control],[0x180,0x1fff],[0x182,0x3000]]},
      {delay:65535,writes:[[0x18e,0x80],[0x186,0x0800]]},
      {delay:65535,writes:[[0x18a,0x80],[0x180,0x3fff]]},
    ]});
}
async function source(fixture=authoredFixture()) {
  const set=await readPsfFileSet(fixture.standaloneFiles),entry='spu-conformance.psf';
  return {fixture,set,entry,image:await preparePsfSongSource(set,entry)};
}
/** The diagnostics are private test probes; no public core/API changes. */
async function machine(image,{signal}={}) {
  let module,handle=0;const stats={renders:[],stems:[],observes:0,ramCopies:0,disposals:0};
  const core=await createPsfPlaybackCore({image,signal,wasmBinary,moduleOptions:{onRuntimeInitialized(){
    module=this;const create=this._psf_create;this._psf_create=(...args)=>{handle=create(...args);return handle;};
  }}});
  assert.equal(module._psf_trace_start(handle,8192),1);
  function memory(reader,length) {const pointer=module._malloc(length);try{assert.equal(reader(handle,0,pointer,length),1);return module.HEAPU8.slice(pointer,pointer+length);}finally{module._free(pointer);}}
  function diagnostics() {
    assert.equal(stats.disposals,0);const scratch=module._malloc(16),trace=[];
    try{assert.equal(module._psf_trace_overflow(handle),0);for(let index=0;index<module._psf_trace_count(handle);index++){assert.equal(module._psf_trace_read(handle,index,scratch),1);trace.push(Array.from({length:4},(_,word)=>new DataView(module.HEAPU8.buffer,scratch,16).getUint32(word*4,true)));}}
    finally{module._free(scratch);}
    return {frames:module._psf_spu_frames(handle),registers:Uint16Array.from({length:512},(_,index)=>module._psf_spu_read(handle,index*2)),
      gates:module._psf_spu_key_gates(handle),active:module._psf_spu_active_mask(handle),
      cpu:memory(module._psf_cpu_read_ram,CPU_BYTES),ram:memory(module._psf_spu_read_ram,SPU_BYTES),trace,state:core.observe()};
  }
  const api={backend:core.backend,sampleRate:RATE,get position(){return core.position;},
    render(frames){stats.renders.push(frames);return core.render(frames);},
    renderWithVoices(frames){stats.stems.push(frames);return core.renderWithVoices(frames);},
    observe(){stats.observes++;return core.observe();},copySpuRam(){stats.ramCopies++;return core.copySpuRam();},
    dispose(){if(stats.disposals)return;stats.disposals++;core.dispose();}};
  return {api,stats,diagnostics};
}
function discard(core,frames,chunk=2048) {for(let consumed=0;consumed<frames;){const count=Math.min(chunk,frames-consumed);core.render(count);consumed+=count;}}
function wholePrefix(core,frames) {discard(core,frames,RATE);}
function compare(a,b,label) {assert.deepEqual(a.diagnostics(),b.diagnostics(),label+' includes full CPU/SPU RAM, registers, bus writes and all 24 voices');}

test('bounded seek discard reproduces the complete native machine and future PCM/stems from ordinary playback',async()=>{
  const {image}=await source();
  for(const target of [0,1,2205,12345,44101]) {
    const normal=await machine(image),candidate=await machine(image);
    try {
      wholePrefix(normal.api,target);discard(candidate.api,target);
      compare(candidate,normal,'target '+target);assert.equal(Math.round(candidate.api.position*RATE),target);
      const expected=normal.api.renderWithVoices(4096),actual=candidate.api.renderWithVoices(4096);
      assert.deepEqual(actual,expected,'subsequent full mix and 24 dry voices are sample exact at '+target);
      assert(actual.pcm.some(value=>value!==0),'fixture has actual sound rather than an all-zero comparison');
      compare(candidate,normal,'continuation '+target);
      assert(candidate.stats.renders.every(frames=>frames<=2048));
      assert.equal(candidate.stats.observes,0);assert.equal(candidate.stats.ramCopies,0,'discard takes no Capture RAM copies');
    } finally {normal.api.dispose();candidate.api.dispose();}
  }
});

function host(createCore,options={}) {
  const starts=[],timers=new Map();let serial=0,closes=0;
  const context={currentTime:0,state:'running',close(){closes++;},
    createGain(){return {gain:{value:1},connect(){},disconnect(){}};},
    createBuffer(channels,frames,rate){const data=Array.from({length:channels},()=>new Float32Array(frames));return {sampleRate:rate,length:frames,getChannelData:channel=>data[channel]};},
    createBufferSource(){const node={buffer:null,stopped:false,connect(){},disconnect(){},stop(){this.stopped=true;},start(at,offset,duration){starts.push({node,at,offset,duration});}};return node;}};
  const audio={context,gain:{editor:true},resume:async()=>{}};
  const controller=createPsfSongPreview({getAudio:()=>audio,createCore,beforePlay:()=>{},
    schedule(callback){const id=++serial;timers.set(id,callback);return id;},cancel:id=>timers.delete(id),
    createOutput:()=>({open(){},fadeOut:async()=>{},dispose(){}}),startDelaySeconds:0,chunkFrames:2048,lookaheadSeconds:.1,...options});
  return {controller,starts,timers,context,get closes(){return closes;}};
}

test('real candidate forward/backward seeks keep the target Capture and schedule exact selected dry PCM on Resume',async()=>{
  const prepared=await source(),machines=[];
  const h=host(async({signal})=>{const value=await machine(prepared.image,{signal});machines.push(value);return value.api;});
  h.controller.setSource(prepared.set,prepared.entry);h.controller.setLiveVoice(23);await h.controller.setMonitorEnabled(true);
  try {
    for(const target of [12345,2205,44101]) {
      assert.equal(await h.controller.seek(target/RATE),true);const view=h.controller.read(),candidate=machines.at(-1),normal=await machine(prepared.image);
      try {
        wholePrefix(normal.api,target);assert.equal(view.paused,true);assert.equal(view.playing,false);assert.equal(Math.round(view.positionSeconds*RATE),target);assert.equal(view.liveVoice,23);assert.equal(view.monitorEnabled,true);assert.equal(view.captureFrame,target);assert.equal(view.liveState.nativeFrames,target);
        compare(candidate,normal,'paused transport target '+target);const payload=h.controller.capturePaused();assert.equal(payload.voice,23);assert.equal(payload.frame,target);assert.deepEqual(payload.ram,normal.diagnostics().ram);
        assert.equal(candidate.stats.stems.length,0,'discard does not calculate or retain 24-channel stems');assert.equal(candidate.stats.observes,1);assert.equal(candidate.stats.ramCopies,1);
        const startCount=h.starts.length;assert.equal(await h.controller.resume(),true);assert(h.starts.length>startCount);const first=h.starts[startCount],expected=normal.api.renderWithVoices(first.node.buffer.length);
        for(const side of [0,1])assert.deepEqual(first.node.buffer.getChannelData(side),Float32Array.from({length:first.node.buffer.length},(_,frame)=>expected.voices[frame*48+23*2+side]),'Resume starts at the selected target stem');
        assert.equal(h.controller.pause(),true);assert.equal(Math.round(h.controller.read().positionSeconds*RATE),target);
      } finally {normal.api.dispose();}
    }
    assert.equal(machines.filter(value=>!value.stats.disposals).length,1,'only the current machine survives completed seeks');
  } finally {await h.controller.dispose();}
  assert(machines.every(value=>value.stats.disposals===1));assert.equal(h.closes,0,'seek never owns the editor context');
});

test('cancel and failed candidate discard preserve the actual paused CPU/SPU machine and its Capture',async()=>{
  const prepared=await source(),machines=[];let block=false,entered,release,failCandidate=false;
  const h=host(async({signal})=>{const value=await machine(prepared.image,{signal});machines.push(value);if(failCandidate){const render=value.api.render;value.api.render=frames=>{render(frames);throw Error('Original test candidate failure');};}return value.api;},
    {yieldSeek:()=>{if(!block)return Promise.resolve();entered.resolve();return release.promise;}});
  h.controller.setSource(prepared.set,prepared.entry);
  try {
    assert.equal(await h.controller.seek(2205/RATE),true);const original=machines.at(-1),before=original.diagnostics(),capture=h.controller.capturePaused();
    block=true;entered=deferred();release=deferred();const seeking=h.controller.seek(.5);await entered.promise;assert.equal(h.controller.read().seeking,true);assert.equal(h.starts.length,0,'discard PCM is never scheduled');
    const cancelling=h.controller.cancelSeek();release.resolve();assert.equal(await cancelling,true);assert.equal(await seeking,false);block=false;
    assert.equal(h.controller.read().paused,true);assert.equal(Math.round(h.controller.read().positionSeconds*RATE),2205);assert.deepEqual(original.diagnostics(),before);assert.deepEqual(h.controller.capturePaused().ram,capture.ram);assert.equal(original.stats.disposals,0);
    failCandidate=true;assert.equal(await h.controller.seek(.75),false);assert.match(h.controller.read().seekMessage,/candidate failure/);assert.equal(h.controller.read().paused,true);assert.deepEqual(original.diagnostics(),before);assert.deepEqual(h.controller.capturePaused().ram,capture.ram);assert.equal(h.starts.length,0);
    assert(machines.slice(1).every(value=>value.stats.disposals===1),'cancelled/failed candidate cores are released');
  } finally {await h.controller.dispose();}
});

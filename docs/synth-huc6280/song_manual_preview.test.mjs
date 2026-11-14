// SPDX-License-Identifier: BSD-3-Clause
// Real stateful WASM into inert buffers. No AudioContext/device is created.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import factory from '../../tetorica_src/runtime/generated/huc6280_wasm.js';
import {Huc6280AudioEngine} from '../../tetorica_src/runtime/huc6280audioengine.js';
import {createHuc6280SongPreview} from './song_preview.js';
import {fakeAudio,vgm,init,voice,write,wait,block,streamSetup,streamStart,deferred} from './song_test_helpers.mjs';

const wasmBinary=await readFile(new URL('../../tetorica_src/runtime/generated/huc6280_wasm.wasm',import.meta.url));
const turn=()=>new Promise(resolve=>setImmediate(resolve));
const period=r=>(r[2]|(r[3]&15)<<8)||4096;
const waveSong=()=>vgm([...init,...voice(),...wait(44100),...wait(44100)]);
function setup(options={}){
  const graph=fakeAudio(),writes=[],engines=[];let live=0,maxLive=0,opens=0;
  const preview=createHuc6280SongPreview({getAudio:()=>{opens++;return graph.audio;},schedule:graph.schedule,cancel:graph.cancel,nowMs:()=>0,yieldTask:async()=>{},cacheIntervalSeconds:.02,
    createEngine:async()=>{
      const e=await Huc6280AudioEngine.create({moduleFactory:()=>factory({wasmBinary}),clock:3579545,outputSampleRate:44100,masterVolume:1});
      engines.push(e);
      let generated=0;const process=e.processFrames,write=e.writeHuc6280,dispose=e.dispose;live++;maxLive=Math.max(maxLive,live);
      e.processFrames=function(frames){const pcm=process.call(this,frames);generated+=frames;return pcm;};
      e.writeHuc6280=function(register,value){writes.push({frame:generated,channel:this.selectedChannel,register,value});return write.call(this,register,value);};
      e.dispose=function(){if(this.handle)live--;return dispose.call(this);};return e;
    },...options});
  return{...graph,preview,writes,engines,get maxLive(){return maxLive;},get opens(){return opens;},get live(){return live;},
    async close(){preview.dispose();await preview.whenIdle();assert.equal(live,0);}};
}
function advance(f,seconds){for(let i=0;i<Math.ceil(seconds/.008);i++)f.tick(.008);}
const nativeWrites=f=>f.writes.filter(w=>w.register!==0);
async function playReady(f){
  assert(await f.preview.play());
  // A busy event loop can cooperatively split frame-zero initialization.
  // Wait for its first PCM without advancing the fake audible clock.
  for(let i=0;i<100&&!f.preview.read().bufferedFrames;i++){f.tick(0);await turn();}
  assert(f.preview.read().bufferedFrames>0);
}

test('manual writes enter the producer boundary without changing old PCM or publishing unheard settings',async()=>{
  const f=setup();try{
    assert.equal(f.preview.noteOn('idle',60,0),false);assert.equal(f.opens,0);
    await f.preview.load(waveSong());await playReady(f);
    // Cooperative parsing can yield before the first checkpoint under load.
    for(let i=0;i<50&&!f.preview.read().seekCache.count;i++)f.tick(.008);
    const state=f.preview.read(),epoch=state.manualEpoch,cached=state.seekCache.count;
    assert(state.manualReady);assert(cached>0);assert.equal(state.liveState.registers[0][4]&31,31);
    const original=f.buffers.map(b=>b.data.map(side=>side.slice())),sources=f.sources().slice();
    const result=f.preview.applyEdit({channel:0,changes:{volume:10}},{epoch});assert(result);
    const changed=f.preview.read();assert(changed.manualTainted);assert(changed.manualLastFrame>changed.positionFrames);
    assert.equal(changed.liveState.registers[0][4]&31,31,'the heard clock does not jump to the producer');
    for(let i=0;i<original.length;i++)assert.deepEqual(f.buffers[i].data,original[i]);
    assert(sources.every(node=>!node.stopped),'manual edits do not discard scheduled PCM');
    advance(f,.12);assert.equal(f.preview.read().liveState.registers[0][4]&31,10);
    assert.equal(f.preview.read().seekCache.count,cached,'edited native state never enters the clean source cache');
    assert(f.buffers.some(b=>b.data[0].some(v=>Math.abs(v)>.001)),'actual native PCM is nonzero');
    assert.equal(f.maxLive,1,'manual operation shares the reference core');
  }finally{await f.close();}
});

test('later VGM gates and frequencies supersede only the corresponding hand ownership',async()=>{
  for(const gate of [false,true]){
    const bytes=vgm([...init,...voice(),...wait(8820),...write(0,0),...write(2,200),...write(3,1),...(gate?write(4,153):[]),...wait(35280)]);
    const f=setup();try{
      await f.preview.load(bytes);await playReady(f);const epoch=f.preview.read().manualEpoch;
      assert(f.preview.noteOn('hand',69,0,{epoch}));f.preview.setPitch(1,{epoch});
      advance(f,.3);let state=f.preview.read();assert.equal(period(state.liveState.registers[0]),456);
      const before=nativeWrites(f).length;f.preview.setPitch(0,{epoch});
      assert.equal(nativeWrites(f).length,before,'old Pitch reset cannot overwrite later VGM frequency');
      const off=f.preview.noteOff('hand',{epoch});advance(f,.1);state=f.preview.read();
      assert.equal(Boolean(state.liveState.registers[0][4]&128),gate,'a later VGM control owns its gate; frequency alone keeps the manual gate');
      if(gate)assert.equal(off,false);
      assert.equal(period(state.liveState.registers[0]),456);
    }finally{await f.close();}
  }
});

test('clean cached Seek restores the original PCM; cancelled Seek retains the edited run and fences old keys',async()=>{
  let held=null,entered=false;
  const f=setup({yieldTask:async()=>{if(held){entered=true;await held.promise;}}}),baseline=setup();
  try{
    const bytes=waveSong();await f.preview.load(bytes);await f.preview.seek(.5);await f.preview.resume();advance(f,.04);
    const epoch=f.preview.read().manualEpoch;f.preview.applyEdit({channel:0,changes:{volume:7}},{epoch});
    f.preview.noteOn('hand-before-seek',64,0,{epoch});advance(f,.12);assert.equal(f.preview.read().liveState.registers[0][4]&31,7);
    held=deferred();const seek=f.preview.seek(1.5);
    for(let i=0;i<100&&!entered;i++)await turn();assert(entered);
    assert.equal(f.preview.noteOn('late',72,0,{epoch}),false);const cancelling=f.preview.cancelSeek();held.resolve();held=null;
    assert.equal(await seek,false);assert.equal(await cancelling,true);assert(f.preview.read().manualTainted);assert(f.preview.read().playing);
    advance(f,.12);assert.equal(f.preview.read().liveState.registers[0][4]&31,7);assert.equal(f.preview.read().manualHeldCount,0);
    const start=f.buffers.length;assert(await f.preview.seek(.7));const restored=f.preview.read();
    assert(!restored.manualTainted);assert(restored.seekCache.hits>0);assert.equal(restored.liveState.registers[0][4]&31,31);
    await baseline.preview.load(bytes);await baseline.preview.seek(.7);
    assert.deepEqual(f.buffers[start].data,baseline.buffers[0].data,'clean cached target uses original exact native PCM');
    assert(f.maxLive<=2);assert.equal(f.preview.noteOff('hand-before-seek',{epoch}),false);
  }finally{held?.resolve();await f.close();await baseline.close();}
});

test('pause/source validation clears hand owners, and stale epochs cannot reach Resume or another song',async()=>{
  const f=setup();try{
    await f.preview.load(waveSong());await playReady(f);let epoch=f.preview.read().manualEpoch;
    f.preview.noteOn('held',60,0,{epoch});assert.equal(f.preview.read().manualHeldCount,1);
    f.preview.pause();assert.equal(f.preview.read().manualHeldCount,0);assert.notEqual(f.preview.read().manualEpoch,epoch);
    assert.equal(f.preview.setPitch(1,{epoch}),false);await f.preview.resume();assert.equal(f.preview.noteOn('old',69,0,{epoch}),false);
    epoch=f.preview.read().manualEpoch;f.preview.noteOn('validation',64,0,{epoch});
    await assert.rejects(f.preview.load(new Uint8Array([1,2,3]),'invalid'));
    assert(f.preview.read().playing);assert.equal(f.preview.read().manualHeldCount,0,'failed source validation cannot leave a discarded hand key sounding');
    assert.equal(f.preview.noteOn('late-validation',60,0,{epoch}),false,'a failed load still retires earlier input tickets');
    await f.preview.load(waveSong(),'replacement');assert.equal(f.preview.noteOn('old-source',60,0,{epoch}),false);
  }finally{await f.close();}
});

test('Auto Off acknowledges a manual DDA level once at heard time, without inventing a PCM sample or following later automatic writes',async()=>{
  const f=setup();try{
    await f.preview.load(vgm([...init,...voice(0,{dda:true}),...block([0,31,4,26,8,22,12,18]),...streamSetup(),...streamStart(8,{mode:129}),...wait(44100)]));
    await playReady(f);const epoch=f.preview.read().manualEpoch,selection=f.preview.getManualSelection(0);
    assert(selection.editable);assert(!selection.playable);assert.match(selection.reason,/DDA|DAC|PCM/i);
    f.preview.setLiveEnabled(false);const frozen=f.preview.read().liveState;
    assert(f.preview.applyEdit({channel:0,changes:{volume:9}},{epoch}));
    assert.equal(f.preview.read().liveState,frozen,'no future state is published');
    assert.throws(()=>f.preview.noteOn('not-a-sample',60,0,{epoch}),/DDA|DAC|PCM/i);
    advance(f,.2);const acknowledged=f.preview.read();assert(!acknowledged.liveEnabled);assert.equal(acknowledged.liveState.registers[0][4]&31,9);
    assert(acknowledged.liveState.positionFrames>=acknowledged.manualLastFrame);
    advance(f,.1);assert.equal(f.preview.read().liveState,acknowledged.liveState,'normal DAC writes remain frozen');
    f.preview.setLiveEnabled(true);assert.equal(f.preview.read().liveState.registers[0][4]&31,9);
    assert(f.preview.read().liveState.ddaWrites[0]>0);
  }finally{await f.close();}
});

test('a nonfatal Live failure disables manual input without blocking Pause, Seek or source replacement',async()=>{
  const f=setup();
  try{
    await f.preview.load(waveSong());await playReady(f);f.preview.noteOn('before-error',60,0);
    // Register10 is inert in the real chip but outside the supported Live map.
    f.engines[0].writeHuc6280(10,0);advance(f,.04);assert(f.preview.read().liveError);assert(!f.preview.read().manualReady);
    assert.doesNotThrow(()=>f.preview.pause());assert(f.preview.read().paused);
    assert(await f.preview.seek(.5));assert(!f.preview.read().liveError);assert(f.preview.read().paused);
    assert(await f.preview.load(waveSong(),'new'));assert(await f.preview.play());
  }finally{await f.close();assert(f.engines.every(e=>e.handle===0));}
});

// SPDX-License-Identifier: BSD-3-Clause
// Rebuild/rollback tests use inert graphs or native PCM arrays, never a device.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import factory from '../generated/huc6280_wasm.js';
import {Huc6280AudioEngine} from '../js/huc6280audioengine.js';
import {VgmPlayer} from '../js/vgmplayer.js';
import {createHuc6280SongPreview} from './song_preview.js';
import {vgm,write,wait,fakeAudio,counterEngine,deferred} from './song_test_helpers.mjs';
import {createSeekFixture} from './song_seek_fixtures.mjs';
const turn=()=>new Promise(resolve=>setImmediate(resolve));
const near=(a,b)=>assert(Math.abs(a-b)<1e-9,`${a} ~= ${b}`);
function mockEngine(){const engine=counterEngine();engine.muted=Array(6).fill(false);engine.setChannelMuted=(ch,muted)=>engine.muted[ch]=muted;return engine;}
function setup(options={}){
  const graph=fakeAudio(),engines=[],states=[],statuses=[];let audioCalls=0;
  const preview=createHuc6280SongPreview({getAudio:()=>{audioCalls++;return graph.audio;},createEngine:async()=>{const engine=mockEngine();engines.push(engine);return engine;},
    onState:state=>states.push(state),onStatus:text=>statuses.push(text),schedule:graph.schedule,cancel:graph.cancel,nowMs:()=>0,yieldTask:async()=>{},...options});
  return{...graph,preview,engines,states,statuses,get audioCalls(){return audioCalls;}};
}
async function paused(f){await f.preview.load(createSeekFixture('wave'),'original.vgm');await f.preview.play();const node=f.sources()[0];f.context.currentTime=node.at+100/44100;f.preview.pause();return f.preview.read();}

test('Seek validates options/targets, works without header duration, stays paused from Stop and forces exact frame-zero/target/EOF snapshots',async()=>{
  for(const options of[{seekChunkFrames:0},{seekChunkFrames:2049},{seekTimeoutMilliseconds:0}])assert.throws(()=>setup(options),RangeError);
  const f=setup();assert.equal(await f.preview.seek(.2),false);assert.equal(f.audioCalls,0);await f.preview.load(createSeekFixture('wave'));
  assert.equal(f.preview.read().durationSeconds,2.5);assert(f.preview.read().canSeek);await assert.rejects(f.preview.seek(NaN),/finite/);
  assert(await f.preview.seek(.5));let state=f.preview.read();assert(state.paused);assert.equal(state.positionFrames,22050);assert.equal(f.sources().length,0);assert.equal(state.liveState.registers[0][2],98);
  f.preview.setLiveEnabled(false);assert(await f.preview.seek(-1));state=f.preview.read();assert(state.paused);assert.equal(state.positionFrames,0);assert.equal(state.liveState.registers[0][2],254);assert.equal(state.liveState.positionFrames,0);
  assert(await f.preview.seek(999));state=f.preview.read();assert(state.paused);assert.equal(state.positionFrames,110250);assert.equal(state.liveState.positionFrames,110250);assert.equal(state.bufferedFrames,0);
  assert(await f.preview.resume());assert.equal(f.preview.read().playback,'ended');assert.equal(f.preview.read().positionFrames,110250);f.preview.dispose();
});

test('Seek preserves playing versus paused, releases old only at commit, and seeks from ended become paused',async()=>{
  const f=setup();await f.preview.load(createSeekFixture('wave'));await f.preview.play();const old=f.engines[0];
  assert(await f.preview.seek(.2));assert.equal(f.preview.read().playback,'playing');assert.equal(f.preview.read().positionFrames,8820);assert.equal(old.disposals,1);
  assert(await f.preview.seek(2.5));assert.equal(f.preview.read().playback,'ended');assert.equal(f.preview.read().positionFrames,110250);
  assert(await f.preview.seek(.1));assert.equal(f.preview.read().playback,'paused');assert.equal(f.preview.read().positionFrames,4410);f.preview.dispose();
});

test('cancelling a rebuild restores exact paused PCM references/offset and never schedules candidate audio',async()=>{
  const gate=deferred();let blocked=false;const f=setup({yieldTask:async()=>{if(blocked)await gate.promise;}}),before=await paused(f);
  const old=f.engines[0],oldBuffer=f.sources()[0].buffer,oldSourceCount=f.sources().length;blocked=true;
  const seeking=f.preview.seek(1);await turn();assert(f.preview.read().seeking);assert(f.preview.read().seekProgressFrames>0);assert.equal(old.disposals,0);
  assert.equal(f.sources().length,oldSourceCount,'candidate generates no source nodes during rebuild');const cancellation=f.preview.cancelSeek();assert.equal(f.preview.read().seekCancelling,true);gate.resolve();assert.equal(await seeking,false);assert.equal(await cancellation,true);await f.preview.whenIdle();
  const after=f.preview.read();assert(after.paused);assert.equal(after.positionFrames,before.positionFrames);assert.equal(after.bufferedFrames,before.bufferedFrames);assert.equal(after.liveState,before.liveState);
  assert.equal(old.disposals,0);assert.equal(f.engines[1].disposals,1);blocked=false;await f.preview.resume();const resumed=f.sources()[oldSourceCount];assert.equal(resumed.buffer,oldBuffer);near(resumed.offset,100/44100);f.preview.dispose();
});

test('cancelling while previously playing restores the same unheard segment after a long wall-clock gap',async()=>{
  const gate=deferred();let blocked=false;const f=setup({yieldTask:async()=>{if(blocked)await gate.promise;}});await f.preview.load(createSeekFixture('wave'));await f.preview.play();
  const first=f.sources()[0];f.context.currentTime=first.at+100/44100;const count=f.sources().length;blocked=true;const pending=f.preview.seek(1);await turn();f.context.currentTime+=20;
  const cancelling=f.preview.cancelSeek();gate.resolve();await pending;await cancelling;assert(f.preview.read().playing);assert.equal(f.preview.read().positionFrames,100);
  const restored=f.sources()[count];assert.equal(restored.buffer,first.buffer);near(restored.offset,100/44100);assert(restored.at>=f.context.currentTime);f.preview.dispose();
});

test('superseding seeks serialize candidate initialization/disposal while retaining at most the old run plus one candidate',async()=>{
  const gate=deferred(),created=[];let creates=0,alive=0,maxAlive=0;
  const f=setup({createEngine:async()=>{const engine=mockEngine(),dispose=engine.dispose;alive++;maxAlive=Math.max(maxAlive,alive);engine.dispose=function(){if(!this.disposals)alive--;dispose.call(this);};created.push(engine);if(++creates===2)await gate.promise;return engine;}});
  await paused(f);const first=f.preview.seek(1.4);await turn();assert.equal(creates,2);const second=f.preview.seek(.4);await turn();assert.equal(creates,2);
  gate.resolve();assert.equal(await first,false);assert(await second);assert.equal(creates,3);assert.equal(maxAlive,2);assert.equal(created[1].disposals,1);assert.equal(created[0].disposals,1);
  assert.equal(f.preview.read().positionFrames,17640);assert(f.preview.read().paused);f.preview.dispose();assert.equal(alive,0);
});

test('Stop fences pending mutable host preparation; whenIdle waits until cleanup and a late completion cannot create/resume a run',async()=>{
  const gate=deferred(),effects=[];let guard;
  const f=setup({beforePlay:async({isCurrent})=>{guard=isCurrent;await gate.promise;effects.push(isCurrent()?'STALE SIDE EFFECT':'old cleanup settled');}});
  await f.preview.load(createSeekFixture('wave'));const pending=f.preview.seek(.2);await turn();assert(f.preview.read().seekPreparing);assert(guard());
  f.preview.stop();assert.equal(guard(),false);assert(f.preview.read().busy);let idle=false;const waiting=f.preview.whenIdle().then(()=>idle=true);await turn();assert.equal(idle,false);
  gate.resolve();assert.equal(await pending,false);await waiting;assert.deepEqual(effects,['old cleanup settled']);assert.equal(f.engines.length,0);assert.equal(f.sources().length,0);assert.equal(f.preview.read().playback,'stopped');assert.equal(f.preview.read().busy,false);f.preview.dispose();
});

test('candidate initialization/render failure and timeout retain the previous accepted paused run, PCM, frame and snapshot',async()=>{
  for(const mode of['init','pcm','timeout']){
    let creates=0,blocked=false,clock=0;
    const f=setup({nowMs:()=>clock,seekTimeoutMilliseconds:50,yieldTask:async()=>{if(mode==='timeout'&&blocked)clock+=100;},createEngine:async()=>{
      if(++creates>1&&mode==='init')throw Error('seek init failed');const engine=mockEngine();f.engines.push(engine);if(creates>1&&mode==='pcm')engine.processFrames=()=>({left:Float32Array.of(NaN),right:Float32Array.of(0)});return engine;
    }});const before=await paused(f),old=f.engines[0];blocked=true;
    assert.equal(await f.preview.seek(.7),false,mode);const after=f.preview.read();assert(after.paused);assert.equal(after.positionFrames,100);assert.equal(after.bufferedFrames,before.bufferedFrames);assert.equal(after.liveState,before.liveState);assert.equal(old.disposals,0);
    assert.match(after.seekMessage,mode==='init'?/init failed/:mode==='pcm'?/non-finite/:/timed out/);assert.equal(f.context.closes,0);f.preview.dispose();
  }
});

test('source replacement/clear/dispose fences old seeks; rejected new sources preserve the restored original song',async()=>{
  for(const action of['load','invalid','clear','dispose']){
    const gate=deferred();let blocked=false;const f=setup({yieldTask:async()=>{if(blocked)await gate.promise;}});await paused(f);blocked=true;
    const pending=f.preview.seek(1);await turn();let replacement;
    if(action==='load')replacement=f.preview.load(createSeekFixture('noise'),'new.vgm');
    if(action==='invalid')replacement=assert.rejects(f.preview.load(vgm([0x50,...wait(1)]),'invalid.vgm'),/does not support/);
    if(action==='clear')f.preview.clear();if(action==='dispose')f.preview.dispose();
    gate.resolve();assert.equal(await pending,false);await replacement;await f.preview.whenIdle();const state=f.preview.read();assert.equal(state.seeking,false);
    if(action==='load'){assert.equal(state.name,'new.vgm');assert.equal(state.playback,'stopped');}
    else if(action==='invalid'){assert.equal(state.name,'original.vgm');assert(state.paused);assert.equal(state.positionFrames,100);}
    else{assert.equal(state.hasSource,false);assert.equal(state.playback,'stopped');}
    f.preview.dispose();
  }
});

test('latest mixer flags and forced AutoOff snapshot apply to a rebuilt target without changing source registers',async()=>{
  let f,changed=false;f=setup({yieldTask:async()=>{if(!changed){changed=true;f.preview.setChannelEnabled(0,false);}}});
  await paused(f);f.preview.setLiveEnabled(false);assert(await f.preview.seek(.8));const state=f.preview.read();assert(state.paused);assert.equal(state.liveEnabled,false);assert.equal(state.liveState.positionFrames,35280);assert.equal(state.liveState.registers[0][2],98);
  assert.equal(state.channelMuteMask,1);assert.equal(f.engines.at(-1).muted[0],true);assert.equal(f.preview.read().name,'original.vgm');f.preview.dispose();
});

test('EOF seek clamps to the actual floored output frame count at non-44100Hz rates',async()=>{
  const f=setup({createEngine:async()=>{const engine=mockEngine();engine.sampleRate=()=>48000;return engine;}});
  await f.preview.load(vgm([...write(0,0),...wait(501)]));assert(await f.preview.seek(1));assert.equal(f.preview.read().positionFrames,Math.floor(501*48000/44100));assert(f.preview.read().paused);assert.equal(f.preview.read().bufferedFrames,0);f.preview.dispose();
});

test('seek progress yields cooperatively more often than it publishes UI updates',async()=>{
  let clock=0,yields=0;const updates=[];
  const f=setup({seekChunkFrames:128,nowMs:()=>clock,yieldTask:async()=>{clock++;yields++;},onState:state=>{
    if(state.seeking&&state.seekProgressFrames>0)updates.push({time:clock,frame:state.seekProgressFrames});
  }});
  await f.preview.load(createSeekFixture('wave'));assert(await f.preview.seek(2.4));assert(yields>50);assert(updates.length<yields/4);
  for(let i=1;i<updates.length-1;i++)assert(updates[i].time-updates[i-1].time>=50,'periodic progress is capped at20Hz');
  assert.equal(updates.at(-1).frame,Math.round(2.4*44100),'target completion can force its final update');f.preview.dispose();
});

const wasmBinary=await readFile(new URL('../generated/huc6280_wasm.wasm',import.meta.url));
const native=()=>Huc6280AudioEngine.create({moduleFactory:()=>factory({wasmBinary}),clock:3579545,outputSampleRate:44100,masterVolume:1});
function straight(engine,bytes){const player=new VgmPlayer(engine);player.setPrefetchFactor(1);player.load(bytes,{logger:null});player.reset();player.play();const result=[];
  while(player.isPlaying()||player.queuedFrames){const l=new Float32Array(1024),r=new Float32Array(1024),frames=player.process(l,r,1024);for(let i=0;i<frames;i++)result.push(l[i],r[i]);}return result;}
test('real WASM Wave/LFO/Noise/DDA seek targets reproduce the exact uninterrupted PCM tail at frame0, interior boundaries and EOF',async()=>{
  for(const kind of['wave','lfo','noise','dda']){
    const bytes=createSeekFixture(kind,.7),core=await native(),expected=straight(core,bytes);core.dispose();
    for(const target of[0,1,11025,12345,30870]){
      const graph=fakeAudio(),preview=createHuc6280SongPreview({getAudio:()=>graph.audio,createEngine:native,schedule:graph.schedule,cancel:graph.cancel,yieldTask:async()=>{},nowMs:()=>0});
      try{await preview.load(bytes,kind);preview.setLiveEnabled(false);assert(await preview.seek(target/44100));assert.equal(preview.read().positionFrames,target);assert(preview.read().paused);assert.equal(preview.read().liveState.positionFrames,target);assert.equal(graph.sources().length,0);
        assert(await preview.resume());for(let i=0;i<200&&preview.read().playing;i++)graph.tick(.008);assert.equal(preview.read().playback,'ended');
        const actual=[];for(const buffer of graph.buffers)for(let i=0;i<buffer.length;i++)actual.push(buffer.data[0][i],buffer.data[1][i]);assert.deepEqual(actual,expected.slice(target*2),`${kind} target${target}`);
      }finally{preview.dispose();}
    }
  }
});

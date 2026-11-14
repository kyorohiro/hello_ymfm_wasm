// SPDX-License-Identifier: BSD-3-Clause
// Inert Web Audio graph only: these tests never open an audio device.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import factory from '../generated/huc6280_wasm.js';
import {Huc6280AudioEngine} from '../js/huc6280audioengine.js';
import {VgmPlayer} from '../js/vgmplayer.js';
import {createHuc6280SongPreview} from './song_preview.js';
import {vgm,write,wait,fixtures,fakeAudio,counterEngine,deferred,block,streamSetup,streamStart} from './song_test_helpers.mjs';
const near = (actual,expected) => assert(Math.abs(actual-expected) < 1e-9,`${actual} ~= ${expected}`);
const turn = () => new Promise(resolve => setImmediate(resolve));
function setup(options = {}) {
  const graph = fakeAudio(), engines = [], states = [], statuses = []; let audioCalls = 0, beforeCalls = 0;
  const preview = createHuc6280SongPreview({getAudio:() => {audioCalls++;return graph.audio;},
    beforePlay:() => {beforeCalls++;}, onState:state=>states.push(state), onStatus:text=>statuses.push(text),
    createEngine:async()=>{const engine=counterEngine();engines.push(engine);return engine;},
    schedule:graph.schedule,cancel:graph.cancel,nowMs:()=>0,...options});
  return {...graph,preview,engines,states,statuses,get audioCalls(){return audioCalls;},get beforeCalls(){return beforeCalls;}};
}
const song = () => vgm([...write(0,0),...write(1,255),...wait(22050)]);

test('construction and complete-file load are passive; invalid/cancelled replacement preserves accepted song and running transport',async()=>{
  const f=setup();assert.equal(f.audioCalls,0);assert.equal(f.preview.read().hasSource,false);
  await f.preview.load(song(),'accepted.vgm');assert.equal(f.audioCalls,0);assert.equal(f.engines.length,0);
  assert.equal(f.preview.getState().canPlay,true);assert.equal(await f.preview.play(),true);
  assert.equal(f.audioCalls,1);assert.equal(f.beforeCalls,1);const initial=f.preview.read();assert(initial.playing);
  const invalid=vgm([...write(0,0),...wait(1),0x50]);
  await assert.rejects(f.preview.load(invalid,'bad.vgm'),/does not support/);
  assert.equal(f.preview.read().name,'accepted.vgm');assert(f.preview.read().playing);assert.equal(f.engines[0].disposals,0);
  const cancelled=new AbortController();cancelled.abort();
  await assert.rejects(f.preview.load(song(),'cancelled.vgm',{signal:cancelled.signal}),{name:'AbortError'});
  assert.equal(f.preview.read().name,'accepted.vgm');assert(f.preview.read().playing);
  assert.equal(f.audioCalls,1);assert.match(f.statuses[0],/Previous song kept/);f.preview.dispose();
});

test('reference PCM enters only songInputNode at unity before existing Master; it never closes or writes the author',async()=>{
  const f=setup();await f.preview.load(song());await f.preview.play();
  const source=f.sources()[0],gain=source.connections[0];
  assert.equal(gain.gain.value,1);assert.deepEqual(gain.connections,[f.audio.songInputNode]);
  assert.deepEqual(f.audio.songInputNode.connections,[f.audio.master]);assert.equal(f.audio.master.gain.value,.7);
  assert.equal(f.engines.length,1);assert(f.engines[0].writes.length>0);
  f.preview.stop();assert.equal(f.engines[0].disposals,1);assert.equal(f.context.closes,0);
  assert.equal(f.audio.songInputNode.disconnected,0);assert.equal(f.audio.master.disconnected,0);
  assert.equal(f.preview.read().hasSource,true);assert.equal(f.preview.read().positionFrames,0);
  f.preview.dispose();
});

test('Pause freezes the consumed frame; Resume retains the exact PCM tail and core position across repeated pauses',async()=>{
  const f=setup();await f.preview.load(song());await f.preview.play();
  const initial=f.sources()[0];f.context.currentTime=initial.at+100/44100;
  assert.equal(f.preview.read().positionFrames,100);const buffered=f.preview.read().bufferedFrames;
  assert.equal(f.preview.pause(),true);assert.equal(f.timers.size,0);assert.equal(f.preview.read().paused,true);
  assert.equal(f.preview.read().positionFrames,100);assert.equal(f.preview.read().bufferedFrames,buffered);
  const coreCursor=f.engines[0].cursor;f.context.currentTime+=2;assert.equal(f.preview.read().positionFrames,100);
  const before=f.sources().length;assert.equal(await f.preview.resume(),true);
  const resumed=f.sources()[before];assert.equal(resumed.buffer,initial.buffer);near(resumed.offset,100/44100);
  assert.equal(resumed.buffer.data[0][100],Math.fround(100/44100));assert.equal(f.engines.length,1);assert.equal(f.engines[0].resets,1);
  assert(f.engines[0].cursor>=coreCursor,'resuming continues the same native cursor');
  let generated=0;for(const buffer of f.buffers) {assert.equal(buffer.data[0][0],Math.fround(generated/44100));generated+=buffer.length;}
  assert.equal(f.engines[0].cursor,generated,'retained and newly generated PCM contains no replayed frames');
  f.context.currentTime=resumed.at+50/44100;assert.equal(f.preview.pause(),true);assert.equal(f.preview.read().positionFrames,150);
  f.context.currentTime+=1;const next=f.sources().length;await f.preview.play();
  near(f.sources()[next].offset,150/44100);assert.equal(f.sources()[next].buffer,initial.buffer);
  f.preview.stop();assert.equal(f.engines[0].disposals,1);f.preview.dispose();
});

test('a scheduling gap advances only through PCM actually scheduled, with no parser catch-up or dropped tail',async()=>{
  const f=setup();await f.preview.load(song());await f.preview.play();
  const rendered=f.buffers.reduce((sum,buffer)=>sum+buffer.length,0);
  f.context.currentTime=10;assert.equal(f.preview.read().positionFrames,rendered);
  f.tick(0);const next=f.sources().find(node=>node.at>=10);
  assert(next);assert.equal(f.preview.read().positionFrames,rendered);
  f.context.currentTime=next.at+100/44100;assert.equal(f.preview.read().positionFrames,rendered+100);
  assert.equal(next.buffer.data[0][0],Math.fround(rendered/44100));f.preview.dispose();
});

test('EOF waits until final scheduled PCM is consumed; one pass retains source and can restart from sample zero',async()=>{
  const f=setup();await f.preview.load(vgm([...write(0,0),...wait(1000)],{loop:true}),'once');await f.preview.play();
  assert(f.preview.read().playing);assert.equal(f.engines[0].disposals,0);
  assert.equal(f.buffers.reduce((sum,buffer)=>sum+buffer.length,0),1000);
  assert.match(f.preview.read().warnings[0],/once/);
  f.context.currentTime=1;f.tick(0);assert.equal(f.preview.read().playback,'ended');
  assert.equal(f.preview.read().positionFrames,1000);assert.equal(f.preview.read().bufferedFrames,0);assert.equal(f.engines[0].disposals,1);
  assert.equal(f.preview.read().canPlay,true);await f.preview.play();assert.equal(f.engines.length,2);
  assert.equal(f.preview.read().positionFrames,0);assert.equal(f.sources().at(-1).offset,0);f.preview.dispose();
});

test('Stop fences asynchronous engine initialization and host hooks without attaching stale reference audio',async()=>{
  const pending=deferred();let currentHook;const f=setup({createEngine:()=>pending.promise,beforePlay:({isCurrent})=>{currentHook=isCurrent;}});
  await f.preview.load(song());const starting=f.preview.play();await turn();assert.equal(f.preview.read().playback,'starting');assert(currentHook());
  f.preview.stop();assert.equal(currentHook(),false);const late=counterEngine();pending.resolve(late);
  assert.equal(await starting,false);assert.equal(late.disposals,1);assert.equal(f.sources().length,0);assert.equal(f.preview.read().playback,'stopped');
  f.preview.dispose();
});

test('a cancelled old Play cannot dispose or stop a newer run, and stale failures do not overwrite its state',async()=>{
  const first=deferred();let count=0;const created=[];
  const f=setup({createEngine:async()=>{if(++count===1)return first.promise;const engine=counterEngine();created.push(engine);return engine;}});
  await f.preview.load(song());const old=f.preview.play();await turn();f.preview.stop();
  assert.equal(await f.preview.play(),true);first.reject(new Error('late native failure'));assert.equal(await old,false);
  assert(f.preview.read().playing);assert.equal(created[0].disposals,0);assert.equal(f.preview.read().errorMessage,'');f.preview.dispose();
});

test('Pause/Resume output replacement and native errors clean only reference resources and retain retryable source',async()=>{
  const f=setup();await f.preview.load(song());await f.preview.play();f.preview.pause();
  f.audio.songInputNode=f.context.createGain();assert.equal(await f.preview.resume(),false);
  assert.equal(f.preview.read().playback,'error');assert.match(f.preview.read().errorMessage,/output changed/);
  assert.equal(f.engines[0].disposals,1);assert(f.preview.read().hasSource);assert.equal(f.context.closes,0);f.preview.dispose();
  const broken=counterEngine();broken.processFrames=()=>({left:Float32Array.of(NaN),right:Float32Array.of(0)});
  const bad=setup({createEngine:async()=>broken});await bad.preview.load(song());assert.equal(await bad.preview.play(),false);
  assert.match(bad.preview.read().errorMessage,/non-finite/);assert.equal(broken.disposals,1);bad.preview.dispose();
});

test('load supersession, Stop during validation, clear and dispose settle cancelled operations and never open audio',async()=>{
  let yielding=deferred(),yields=0;const f=setup({yieldTask:async()=>{yields++;await yielding.promise;}});
  const dense=vgm(Array.from({length:3000},()=>[...write(0,0),...wait(1)]).flat());
  const old=f.preview.load(dense,'old');const rejected=assert.rejects(old,{name:'AbortError'});await turn();assert.equal(yields,1);
  await f.preview.load(song(),'new');yielding.resolve();await rejected;assert.equal(f.preview.read().name,'new');
  yielding=deferred();const stopped=f.preview.load(dense,'stopped');const stoppedRejected=assert.rejects(stopped,{name:'AbortError'});await turn();
  f.preview.stop();yielding.resolve();await stoppedRejected;assert.equal(f.preview.read().name,'new');
  f.preview.clear();assert.equal(f.preview.read().hasSource,false);assert.equal(f.preview.read().canPlay,false);assert.equal(f.audioCalls,0);
  f.preview.dispose();assert.throws(()=>f.preview.clear(),/disposed/);await assert.rejects(f.preview.play(),/disposed/);
});

test('Live follows consumed PCM rather than prefetched writes and publishes periodically at no more than20Hz',async()=>{
  const bytes=vgm([...write(0,0),...write(4,159),...write(2,100),...wait(500),...write(2,200),...wait(5000)]);
  const f=setup();await f.preview.load(bytes);await f.preview.play();
  assert.equal(f.preview.read().liveEnabled,true);assert(f.preview.read().liveActive);
  const initial=f.preview.read().liveState;assert.equal(initial.registers[0][2],100);
  assert(f.preview.read().bufferedFrames>500,'futureperiod already rendered');
  const first=f.sources()[0];f.context.currentTime=first.at+499/44100;
  assert.equal(f.preview.read().liveState,initial,'read does not repaint from rendered state');
  assert.equal(f.preview.pause(),true);assert.equal(f.preview.read().liveState.positionFrames,499);assert.equal(f.preview.read().liveState.registers[0][2],100);
  await f.preview.resume();const next=f.sources().at(-1);let start=f.context.currentTime;
  const updateCount=f.states.filter(state=>state.liveState).length;
  for(let i=0;i<20;i++)f.tick(.008);
  const count=f.states.filter(state=>state.liveState).length-updateCount;
  assert(count<=4,'periodic public snapshots are limited to20Hz');
  assert.equal(f.preview.read().liveState.registers[0][2],200);assert(f.preview.read().liveState.positionFrames<=f.preview.read().positionFrames);
  f.preview.dispose();
});

test('Live AutoOff retains a full-chip snapshot for CH switching, On refreshes, and Pause force-freezes even while Off',async()=>{
  const bytes=vgm([...write(0,0),...write(4,159),...write(2,100),...write(0,5),...write(4,150),...write(7,0x91),
    ...wait(500),...write(0,0),...write(2,200),...write(0,5),...write(7,0x95),...wait(5000)]);
  const f=setup();await f.preview.load(bytes);await f.preview.play();f.preview.setLiveEnabled(false);
  const frozen=f.preview.read().liveState;assert.equal(frozen.registers[0][2],100);assert.equal(frozen.registers[5][7],0x91);
  for(let i=0;i<12;i++)f.tick(.008);
  assert.equal(f.preview.read().liveState,frozen);assert(f.preview.read().liveActive,'the full frozen view remains selectable');
  const at=f.preview.read().positionFrames;assert(at>500);f.preview.pause();
  assert.equal(f.preview.read().liveState.positionFrames,at);assert.equal(f.preview.read().liveState.registers[0][2],200);
  assert.equal(f.preview.read().liveState.registers[5][7],0x95);assert.equal(f.preview.read().liveEnabled,false);
  f.preview.setLiveEnabled(true);assert.equal(f.preview.read().liveState.positionFrames,at);
  f.preview.stop();assert.equal(f.preview.read().liveState,null);assert.equal(f.preview.read().liveActive,false);
  await f.preview.play();await f.preview.load(song(),'replacement');assert.equal(f.preview.read().liveState,null);f.preview.dispose();
});

const wasmBinary=await readFile(new URL('../generated/huc6280_wasm.wasm',import.meta.url));
const nativeEngine=()=>Huc6280AudioEngine.create({moduleFactory:()=>factory({wasmBinary}),clock:3579545,outputSampleRate:44100,masterVolume:1});
function render(engine,bytes,chunk=256) {
  const player=new VgmPlayer(engine);player.setPrefetchFactor(1);player.load(bytes,{logger:{warn:message=>{throw Error(message);}}});player.reset();player.play();
  const output=[];
  while(player.isPlaying()||player.queuedFrames) {
    const left=new Float32Array(chunk),right=new Float32Array(chunk),frames=player.process(left,right,chunk);
    for(let i=0;i<frames;i++)output.push(left[i],right[i]);
  }
  return output;
}
test('real WASM Wave/Noise/LFO/directDAC/stream PCM travels unchanged through the borrowed-context reference route',async()=>{
  const peaks={};
  for(const[name,bytes]of Object.entries(fixtures())) {
    const expectedCore=await nativeEngine(),expected=render(expectedCore,bytes);expectedCore.dispose();
    const graph=fakeAudio(),preview=createHuc6280SongPreview({getAudio:()=>graph.audio,createEngine:nativeEngine,schedule:graph.schedule,cancel:graph.cancel});
    await preview.load(bytes,name);assert.equal(await preview.play(),true);
    const initial=graph.sources()[0];graph.context.currentTime=initial.at+100/44100;
    assert.equal(preview.pause(),true);assert.equal(preview.read().positionFrames,100,name+' consumes exact native frames');
    graph.context.currentTime+=.5;assert.equal(await preview.resume(),true);
    assert.equal(preview.read().positionFrames,100,name+' retains native phase while paused');
    for(let i=0;i<100&&preview.read().playback==='playing';i++)graph.tick(.008);
    assert.equal(preview.read().playback,'ended',name);
    const actual=[];for(const buffer of graph.buffers)for(let i=0;i<buffer.length;i++)actual.push(buffer.data[0][i],buffer.data[1][i]);
    assert.deepEqual(actual,expected,name+' native PCM remains exact');assert(actual.every(Number.isFinite));
    peaks[name]=actual.reduce((peak,value)=>Math.max(peak,Math.abs(value)),0);assert(peaks[name]>.001,name+' is audible offline');preview.dispose();
  }
  assert(peaks.noise>0);assert(peaks.lfo>0);
});

test('real native streamed bytes match equivalent direct DAC timing, including reverse/stride/base and fast blocks',async()=>{
  const data=[0,31,8,23],hardware=[...write(1,255),...write(0,0),...write(5,255),...write(4,223)];
  const equivalent=values=>vgm([...hardware,...values.flatMap(value=>[...write(6,value),...wait(4)])]);
  const cases=[
    {bytes:vgm([...hardware,...block(data),...streamSetup(),...streamStart(4),...wait(16)]),values:data},
    {bytes:vgm([...hardware,...block([99,0,99,31,99,8,99,23]),...streamSetup(0,0,11025,2,1),...streamStart(4,{mode:0x11}),...wait(16)]),values:[...data].reverse()},
    {bytes:vgm([...hardware,...block([0,31]),...block([8,23]),...streamSetup(),0x95,0,1,0,0,...wait(8)]),values:[8,23]},
  ];
  for(const{bytes,values}of cases) {
    const a=await nativeEngine(),b=await nativeEngine();try {assert.deepEqual(render(a,bytes),render(b,equivalent(values)));}finally{a.dispose();b.dispose();}
  }
});

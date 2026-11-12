import test from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import {createGameboySongPreview,prepareGameboySongSource} from './song_preview.js';
import {createDmgSongFixture} from '../../test/helpers/dmg_synth_song_fixture.mjs';

function fixtureVgm(commands=[0xb3,22,128,0x61,0x44,0xac,0x66],{clock=4194304,otherClock=0}={}) {
  const bytes=new Uint8Array(256+commands.length),view=new DataView(bytes.buffer);
  bytes.set([86,103,109,32]);view.setUint32(4,bytes.length-4,true);view.setUint32(8,0x171,true);
  view.setUint32(0x34,256-0x34,true);view.setUint32(0x80,clock,true);view.setUint32(0x2c,otherClock,true);bytes.set(commands,256);return bytes;
}
function hostFixture() {
  const timers=new Map(),starts=[],gains=[];let timerId=0;
  const context={currentTime:0,sampleRate:48000,state:'running',resumes:0,closes:0,
    async resume(){this.resumes++;},close(){this.closes++;this.state='closed';},
    createGain(){const node={context,gain:{value:1},connect(output){this.output=output;},disconnect(){this.disconnected=true;}};gains.push(node);return node;},
    createBuffer(channels,length,sampleRate){const pcm=Array.from({length:channels},()=>new Float32Array(length));return{length,sampleRate,copyToChannel(value,ch){pcm[ch].set(value);},getChannelData(ch){return pcm[ch];}};},
    createBufferSource(){return{buffer:null,connect(output){this.output=output;},disconnect(){this.disconnected=true;},start(at,offset){this.at=at;this.offset=offset;starts.push(this);},stop(){this.stopped=true;}};},
  };
  const host={context,songInputNode:{context,gain:{value:.28}}};
  return {host,context,starts,gains,timers,
    schedule(fn,ms){const id=++timerId;timers.set(id,{fn,at:context.currentTime+ms/1000});return id;},cancel(id){timers.delete(id);},
    advance(seconds){const end=context.currentTime+seconds;let count=0;for(;;){const next=[...timers].sort((a,b)=>a[1].at-b[1].at)[0];if(!next||next[1].at>end)break;assert(++count<10000);timers.delete(next[0]);context.currentTime=next[1].at;next[1].fn();}context.currentTime=end;},
  };
}
function fakeEngine() {
  let frame=0;
  return{disposed:0,writes:[],sampleRate:()=>44100,reset(){frame=0;},writeGameboyApu(...args){this.writes.push(args);},
    processFrames(frames){const left=Float32Array.from({length:frames},()=>((frame++%1000)/1000-.5)*.1);return{left,right:left.slice()};},
    dispose(){this.disposed++;},get frames(){return frame;}};
}
function setup(options={}) {
  const host=hostFixture(),engines=[],states=[],statuses=[];let audioRequests=0,ownershipRequests=0;
  const preview=createGameboySongPreview({getAudio:()=>{audioRequests++;return host.host;},beforePlay:()=>{ownershipRequests++;},
    createEngine:async()=>{const engine=fakeEngine();engines.push(engine);return engine;},
    onState:state=>states.push(state),onStatus:value=>statuses.push(value),schedule:host.schedule,cancel:host.cancel,nowMs:()=>0,...options});
  return{...host,preview,engines,states,statuses,get audioRequests(){return audioRequests;},get ownershipRequests(){return ownershipRequests;}};
}

test('VGM and VGZ validate passively, retain owned bytes, and reject unsupported/dual/variant/streams before requesting audio',async()=>{
  const bytes=fixtureVgm(),gz=gzipSync(bytes);
  assert.deepEqual((await prepareGameboySongSource(gz)).bytes,bytes);
  assert.equal((await prepareGameboySongSource(bytes)).totalSamples,44100);
  const f=setup();await f.preview.load(bytes,'valid.vgm');bytes.fill(0);
  assert.equal(f.audioRequests,0);assert.equal(f.ownershipRequests,0);
  const bad=[fixtureVgm(undefined,{clock:0}),fixtureVgm(undefined,{clock:4194304|0x40000000}),
    fixtureVgm(undefined,{clock:(4194304|0x80000000)>>>0}),fixtureVgm(undefined,{clock:4000000}),fixtureVgm(undefined,{otherClock:7670454}),
    fixtureVgm([0xb3,0x80,1,0x61,1,0,0x66]),fixtureVgm([0xb3,48,1,0x61,1,0,0x66]),
    fixtureVgm([0x90,0,0x13,0,0,0x66]),fixtureVgm([0x67,0x66,0,0,0,0,0,0x66]),
    fixtureVgm([0x64,0x62,1,0,0x66]),fixtureVgm([0xb3,22,128,0x61,1]),fixtureVgm([0xb3,22,128,0x61,1,0]),
    fixtureVgm([0xb3,22,128,0x66]),new Uint8Array(20)];
  for(const value of bad){await assert.rejects(f.preview.load(value,'bad.vgm'));assert.equal(f.preview.read().name,'valid.vgm');}
  assert.equal(f.audioRequests,0);assert.equal(f.ownershipRequests,0);
  assert(await f.preview.play());assert.equal(f.audioRequests,1);f.preview.dispose();
});

test('validation is cooperatively cancellable, and a cancelled load never replaces the previous song',async()=>{
  const controller=new AbortController(),commands=[];
  for(let i=0;i<5000;i++)commands.push(0xb3,21,i&255);
  commands.push(0x61,1,0,0x66);
  await assert.rejects(prepareGameboySongSource(fixtureVgm(commands),{signal:controller.signal,yieldTask:async()=>controller.abort()}),{name:'AbortError'});
  const f=setup();await f.preview.load(fixtureVgm(),'kept.vgm');
  const pending=f.preview.load(fixtureVgm(commands),'cancelled.vgm');f.preview.stop();
  await assert.rejects(pending,{name:'AbortError'});assert.equal(f.preview.read().name,'kept.vgm');assert.equal(f.preview.read().busy,false);
  f.preview.dispose();
});

test('buffers use one unity gain into the existing calibrated bus; Pause preserves exact PCM offset without another APU/render',async()=>{
  const f=setup();await f.preview.load(createDmgSongFixture().bytes,'reference.vgm');assert(await f.preview.play());
  assert.equal(f.engines.length,1);assert.equal(f.gains.length,1);assert.equal(f.gains[0].gain.value,1);
  assert.equal(f.gains[0].output,f.host.songInputNode);assert.equal(f.host.songInputNode.gain.value,.28);
  assert(f.starts.every(node=>node.buffer.sampleRate===44100));assert.equal(f.starts[0].at,.01);
  const initial=f.preview.read();assert(initial.renderedFrames>initial.positionFrames);assert(initial.bufferedFrames<=.2*44100+2048);
  f.advance(.123);assert(f.preview.pause());const paused=f.preview.read();
  assert.equal(paused.positionFrames,Math.floor((.123-.01)*44100));assert.equal(paused.liveState.positionFrames,paused.positionFrames);
  const retained=f.starts.find(node=>node.at+node.buffer.length/44100>.123),beforeFrame=f.engines[0].frames;
  f.advance(10);assert.deepEqual(f.preview.read().liveState,paused.liveState);assert.equal(f.engines[0].frames,beforeFrame);assert.equal(f.timers.size,0);
  const count=f.starts.length;assert(await f.preview.resume());
  const resumed=f.starts[count];assert.equal(resumed.buffer,retained.buffer);
  const firstFrame=Math.round((retained.at-.01)*44100);
  assert.equal(resumed.offset,(paused.positionFrames-firstFrame)/44100);
  assert.equal(resumed.at,f.context.currentTime+.01);assert.equal(f.engines.length,1);
  assert.equal(f.preview.read().positionFrames,paused.positionFrames);
  f.preview.dispose();assert.equal(f.engines[0].disposed,1);assert.equal(f.context.closes,0);assert.equal(f.timers.size,0);
});

test('Live Off freezes all channels; Pause updates to the consumed position and CH changes never touch the song APU',async()=>{
  const f=setup();await f.preview.load(createDmgSongFixture().bytes);await f.preview.play();
  f.advance(.2);const frozen=f.preview.setLiveEnabled(false).liveState;
  f.advance(.8);let state=f.preview.read();assert.equal(state.playing,true);assert.equal(state.liveActive,true);assert.deepEqual(state.liveState,frozen);
  f.preview.setLiveEnabled(false);assert.deepEqual(f.preview.read().liveState,frozen,'repeating Off must not refresh a frozen view');
  f.preview.pause();state=f.preview.read();assert.equal(state.liveEnabled,false);assert.equal(state.liveState.positionFrames,state.positionFrames);
  assert.equal(state.liveState.voice[1]>>6,3,'the audible future duty is visible at Pause, not the old frozen instant');
  const before=f.engines[0].writes.length,snapshot=state.liveState;
  for(let ch=0;ch<4;ch++){f.preview.setLiveVoice(ch);assert.deepEqual(f.preview.read().liveState,snapshot);}
  assert.equal(f.engines[0].writes.length,before);f.preview.stop();assert.equal(f.preview.read().liveState,null);f.preview.dispose();
});

test('starting with Live Off still provides the initial full snapshot; following can later resume at the audible frame',async()=>{
  const f=setup();f.preview.setLiveEnabled(false);await f.preview.load(createDmgSongFixture().bytes);await f.preview.play();
  const first=f.preview.read().liveState;assert(first);assert.equal(first.positionFrames,0);
  f.advance(1);assert.deepEqual(f.preview.read().liveState,first);
  const current=f.preview.setLiveEnabled(true);assert(current.liveState.positionFrames>first.positionFrames);assert.equal(current.liveState.voice[1]>>6,3);f.preview.dispose();
});

test('invalid source selection keeps the running song, and EOF releases only the reference APU with no leaked refill timer',async()=>{
  const f=setup();await f.preview.load(createDmgSongFixture().bytes,'kept');await f.preview.play();f.advance(.2);
  const engine=f.engines[0];await assert.rejects(f.preview.load(fixtureVgm(undefined,{clock:0}),'bad'));
  assert.equal(f.preview.read().name,'kept');assert.equal(f.preview.read().playing,true);assert.equal(engine.disposed,0);
  f.advance(3);const ended=f.preview.read();assert.equal(ended.playback,'ended');assert.equal(ended.positionFrames,Math.round(2.1*44100));
  assert.equal(engine.disposed,1);assert.equal(f.timers.size,0);assert.equal(f.context.closes,0);
  await f.preview.play();assert.equal(f.engines.length,2);assert.equal(f.preview.read().positionFrames,0);f.preview.dispose();
});

test('Stop during audio preparation or late engine creation cannot attach retired nodes or silence a newer run',async()=>{
  let resolveAudio,resolveEngine,calls=0;
  const host=hostFixture(),engines=[];
  const preview=createGameboySongPreview({getAudio:()=>new Promise(resolve=>{resolveAudio=resolve;}),beforePlay:()=>{},
    createEngine:async()=>{calls++;return fakeEngine();},schedule:host.schedule,cancel:host.cancel,nowMs:()=>0});
  await preview.load(fixtureVgm());const pending=preview.play();preview.stop();resolveAudio(host.host);assert.equal(await pending,false);assert.equal(calls,0);preview.dispose();
  let notifyStarted;const started=new Promise(resolve=>{notifyStarted=resolve;});
  const f=setup({createEngine:()=>{const engine=fakeEngine();engines.push(engine);if(engines.length===1){notifyStarted();return new Promise(resolve=>{resolveEngine=()=>resolve(engine);});}return Promise.resolve(engine);}});
  await f.preview.load(fixtureVgm());const old=f.preview.play();await started;
  assert.equal(typeof resolveEngine,'function');f.preview.stop();assert(await f.preview.play());
  const current=f.preview.read(),starts=f.starts.length;resolveEngine();assert.equal(await old,false);
  assert.equal(engines[0].disposed,1);assert.equal(engines[1].disposed,0);assert.equal(f.starts.length,starts);assert.equal(f.preview.read().playback,current.playback);
  f.preview.dispose();assert.equal(engines[1].disposed,1);
});

test('a delayed ownership hook gets an invalidation guard, and failures dispose reference resources without closing the borrowed context',async()=>{
  let finish,guard;
  const f=setup({beforePlay:options=>{guard=options.isCurrent;return new Promise(resolve=>{finish=resolve;});}});
  await f.preview.load(fixtureVgm());const playing=f.preview.play();assert(guard());f.preview.stop();assert(!guard());finish();assert.equal(await playing,false);assert.equal(f.engines.length,0);f.preview.dispose();
  const bad=setup({createEngine:async()=>{throw new Error('Bad reference WASM');}});await bad.preview.load(fixtureVgm());assert.equal(await bad.preview.play(),false);
  assert.equal(bad.preview.read().playback,'error');assert.match(bad.preview.read().errorMessage,/reference WASM/);assert.equal(bad.context.closes,0);bad.preview.dispose();
  const nonfinite=setup({createEngine:async()=>({...fakeEngine(),processFrames(frames){return{left:new Float32Array(frames).fill(NaN),right:new Float32Array(frames)};}})});
  await nonfinite.preview.load(fixtureVgm());assert.equal(await nonfinite.preview.play(),false);assert.match(nonfinite.preview.read().errorMessage,/non-finite/);assert.equal(nonfinite.timers.size,0);assert.equal(nonfinite.context.closes,0);nonfinite.preview.dispose();
});

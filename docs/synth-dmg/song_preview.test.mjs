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

const turn=()=>new Promise(resolve=>setImmediate(resolve));
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};}

test('seek preserves paused/playing phases, refreshes Live Off at exact boundaries, and starts stopped/ended at Pause',async()=>{
  const f=setup({yieldTask:async()=>{}});await f.preview.load(createDmgSongFixture().bytes,'seek.vgm');
  f.preview.setLiveEnabled(false);f.preview.setLiveVoice(3);
  assert(await f.preview.seek(.9));let state=f.preview.read();
  assert.equal(state.playback,'paused');assert.equal(state.positionFrames,39690);assert.equal(state.liveState.positionFrames,39690);
  assert.equal(state.liveState.voice[1]>>6,3);assert.equal(state.liveVoice,3);assert.equal(state.liveEnabled,false);
  assert.equal(f.starts.length,0,'stopped seek must not create a scheduled audio source');
  assert(state.renderedFrames>state.positionFrames);assert(f.engines[0].frames>state.positionFrames);
  const native=f.engines[0].frames;f.advance(10);assert.equal(f.engines[0].frames,native,'paused seek does not continue rendering');
  assert(await f.preview.resume());f.advance(.12);assert(f.starts.length>0);
  const old=f.engines[0];assert(await f.preview.seek(.2));state=f.preview.read();assert(state.playing);assert.equal(state.positionFrames,8820);assert.equal(old.disposed,1);
  f.preview.pause();assert(await f.preview.seek(0));state=f.preview.read();assert(state.paused);assert.equal(state.positionFrames,0);assert.equal(state.liveState.registers[22],128,'frame-zero setup writes are observed');
  assert(await f.preview.seek(999));state=f.preview.read();assert.equal(state.positionFrames,92610);assert.equal(state.playback,'paused');
  assert(state.liveState.voice.slice(0,20).every((value,index)=>![2,7,10,17].includes(index)||value===0),'EOF-boundary DAC-off writes are included');
  await f.preview.resume();assert.equal(f.preview.read().playback,'ended');
  assert(await f.preview.seek(.1));assert.equal(f.preview.read().playback,'paused');f.preview.dispose();
});

test('seek validates numeric input before pausing, discards PCM cooperatively and never schedules discarded samples',async()=>{
  let f,yields=0;f=setup({seekChunkFrames:1000,yieldTask:async()=>{yields++;assert.equal(f.starts.length,0);assert(f.preview.read().seeking);}});
  await f.preview.load(fixtureVgm());
  await assert.rejects(f.preview.seek(NaN),/finite/);assert.equal(f.preview.read().playback,'stopped');assert.equal(f.engines.length,0);
  assert(await f.preview.seek(.25));assert(yields>=2);assert.equal(f.starts.length,0);
  assert(f.states.some(state=>state.seeking&&state.seekProgressFrames>0&&state.seekProgressFrames<11025));
  assert.equal(f.preview.read().positionFrames,11025);assert(f.preview.read().canSeek);
  const resumeCount=f.starts.length;await f.preview.resume();
  const first=f.starts[resumeCount].buffer.getChannelData(0)[0];
  assert.equal(first,Math.fround(((11025%1000)/1000-.5)*.1),'first output is the target sample, never a discarded prefix');
  f.preview.dispose();
});

test('cancelled or failed candidate restores the old Pause state, PCM queue and frozen snapshot without touching the author context',async()=>{
  const gate=deferred();let wait=false;
  const f=setup({yieldTask:()=>wait?gate.promise:Promise.resolve()});await f.preview.load(createDmgSongFixture().bytes);await f.preview.play();
  f.advance(.14);f.preview.pause();f.preview.setLiveEnabled(false);const original=f.preview.read(),old=f.engines[0],prefix=f.starts.length;
  wait=true;const seeking=f.preview.seek(1);await turn();assert(f.preview.read().seeking);assert.equal(old.disposed,0);
  const cancel=f.preview.cancelSeek();gate.resolve();assert.equal(await seeking,false);assert.equal(await cancel,true);
  const restored=f.preview.read();assert.equal(restored.playback,'paused');assert.equal(restored.positionFrames,original.positionFrames);assert.deepEqual(restored.liveState,original.liveState);assert.equal(old.disposed,0);assert.equal(f.starts.length,prefix);
  assert.equal(f.engines[1].disposed,1);assert(await f.preview.resume());assert.equal(f.engines.length,2,'Resume reuses the old APU instead of rebuilding');
  const bad=setup({yieldTask:async()=>{},createEngine:async()=>{throw Error('seek init failed');}});await bad.preview.load(fixtureVgm());
  assert.equal(await bad.preview.seek(.2),false);assert.equal(bad.preview.read().playback,'stopped');assert.match(bad.preview.read().seekMessage,/seek init failed/);assert.equal(bad.context.closes,0);
  f.preview.dispose();bad.preview.dispose();
});

test('latest seek waits for the old candidate and preserves the original playing phase; Stop prevents late commit or rollback',async()=>{
  const gate=deferred();let creates=0,entered;
  const entry=new Promise(resolve=>entered=resolve),engines=[];
  const f=setup({yieldTask:async()=>{},createEngine:async()=>{const engine=fakeEngine();engines.push(engine);if(++creates===2){entered();await gate.promise;}return engine;}});
  await f.preview.load(createDmgSongFixture().bytes);await f.preview.play();f.advance(.12);
  const one=f.preview.seek(1.1);await entry;const two=f.preview.seek(.4);await turn();assert.equal(creates,2,'second seek cannot initialize a simultaneous candidate');
  gate.resolve();assert.equal(await one,false);assert.equal(await two,true);assert.equal(f.preview.read().playback,'playing');assert.equal(f.preview.read().positionFrames,17640);assert.equal(engines[1].disposed,1);assert.equal(engines[0].disposed,1);assert.equal(engines[2].disposed,0);
  f.preview.dispose();assert.equal(engines[2].disposed,1);
  const held=deferred();let started;
  const begun=new Promise(resolve=>started=resolve),pending=setup({yieldTask:async()=>{},createEngine:async()=>{started();await held.promise;return fakeEngine();}});
  await pending.preview.load(fixtureVgm());const old=pending.preview.seek(.2);await begun;pending.preview.stop();held.resolve();assert.equal(await old,false);await pending.preview.whenIdle();assert.equal(pending.preview.read().playback,'stopped');assert.equal(pending.starts.length,0);pending.preview.dispose();
});

test('Stop keeps mutable host preparation fenced until whenIdle and no old hook can affect a newer owner',async()=>{
  const gate=deferred(),effects=[];let guard;
  const f=setup({beforePlay:async({isCurrent})=>{guard=isCurrent;await gate.promise;effects.push('old cleanup settled');},yieldTask:async()=>{}});
  await f.preview.load(fixtureVgm());const seeking=f.preview.seek(.3);await turn();assert.equal(f.preview.read().seekPreparing,true);assert(guard());
  f.preview.stop();assert(!guard());assert.equal(f.preview.read().busy,true);assert.equal(f.preview.read().canSeek,false);
  let idle=false;const waiting=f.preview.whenIdle().then(()=>idle=true);await turn();assert.equal(idle,false);
  gate.resolve();assert.equal(await seeking,false);await waiting;assert.deepEqual(effects,['old cleanup settled']);assert.equal(f.preview.read().seekPreparing,false);assert.equal(f.preview.read().busy,false);assert.equal(f.engines.length,0);assert.equal(f.preview.read().playback,'stopped');f.preview.dispose();
});

test('loading another source cancels a seek, and a timeout restores the old phase rather than adopting a partial candidate',async()=>{
  const gate=deferred();let block=false;
  const f=setup({yieldTask:()=>block?gate.promise:Promise.resolve()});await f.preview.load(fixtureVgm(),'old');await f.preview.play();f.advance(.1);f.preview.pause();block=true;
  const seek=f.preview.seek(.6);await turn();const load=f.preview.load(fixtureVgm(),'new');gate.resolve();assert.equal(await seek,false);await load;
  assert.equal(f.preview.read().name,'new');assert.equal(f.preview.read().playback,'stopped');assert.equal(f.starts.filter(node=>!node.stopped&&!node.disconnected).length,0);f.preview.dispose();
  let milliseconds=0;const timeout=setup({nowMs:()=>milliseconds,seekTimeoutMilliseconds:5,yieldTask:async()=>{milliseconds+=6;}});await timeout.preview.load(fixtureVgm());
  assert.equal(await timeout.preview.seek(.3),false);assert.equal(timeout.preview.read().playback,'stopped');assert.match(timeout.preview.read().seekMessage,/timed out/);assert.equal(timeout.engines[0].disposed,1);timeout.preview.dispose();
});

test('cancel from a playing seek restores its original audible position and Live Off frozen observation',async()=>{
  const gate=deferred();let blocked=false;
  const f=setup({yieldTask:()=>blocked?gate.promise:Promise.resolve()});await f.preview.load(createDmgSongFixture().bytes);await f.preview.play();
  f.advance(.13);const frozen=f.preview.setLiveEnabled(false).liveState;f.advance(.6);const before=f.preview.read();
  blocked=true;const seeking=f.preview.seek(1.2);await turn();const at=f.preview.read().positionFrames;
  assert.equal(at,before.positionFrames);const cancellation=f.preview.cancelSeek();gate.resolve();await cancellation;assert.equal(await seeking,false);
  const after=f.preview.read();assert.equal(after.playback,'playing');assert.equal(after.positionFrames,before.positionFrames);assert.deepEqual(after.liveState,frozen);
  assert.equal(after.liveEnabled,false);assert.equal(f.engines[0].disposed,0);assert.equal(f.engines[1].disposed,1);f.preview.dispose();
});

function mutingEngine(){
  const engine=fakeEngine(),reset=engine.reset,process=engine.processFrames;
  Object.assign(engine,{mask:0,muteCalls:[],renders:[],resets:0,
    reset(){this.resets++;this.mask=0;return reset.call(this);},
    setChannelMuted(channel,muted){this.muteCalls.push({channel,muted});this.mask=muted?this.mask|(1<<channel):this.mask&~(1<<channel);},
    processFrames(frames){this.renders.push({first:this.frames,frames,mask:this.mask});const pcm=process.call(this,frames);const gain=Array.from({length:4},(_,ch)=>this.mask&(1<<ch)?0:ch+1).reduce((a,b)=>a+b,0)/10;for(const side of [pcm.left,pcm.right])for(let i=0;i<side.length;i++)side[i]*=gain;return pcm;},
  });return engine;
}

test('reference channel On/Off validates strictly, stays passive and returns a detached persistent session selection',async()=>{
  const f=setup();assert.deepEqual(f.preview.read().channelEnabled,[true,true,true,true]);
  const copy=f.preview.read().channelEnabled;copy.fill(false);assert.equal(f.preview.read().channelMuteMask,0);
  for(const channel of [-1,4,.5,NaN,'0'])assert.throws(()=>f.preview.setChannelEnabled(channel,false),/channel/);
  for(const enabled of [0,1,null,undefined,'false'])assert.throws(()=>f.preview.setChannelEnabled(0,enabled),/boolean/);
  assert.deepEqual(f.preview.setChannelEnabled(2,false).channelEnabled,[true,true,false,true]);
  assert.equal(f.audioRequests,0);assert.equal(f.ownershipRequests,0);assert.equal(f.engines.length,0);
  await f.preview.load(fixtureVgm(),'one');f.preview.stop();await f.preview.load(fixtureVgm(),'two');
  assert.deepEqual(f.preview.read().channelEnabled,[true,true,false,true]);assert.equal(f.preview.read().channelMuteMask,4);
  f.preview.dispose();assert.throws(()=>f.preview.setChannelEnabled(0,false),/disposed/);
});

test('reference channel mute changes only future mix; generated buffers, phase, register timeline and native cursor are retained',async()=>{
  const engine=mutingEngine(),f=setup({createEngine:async()=>engine});await f.preview.load(createDmgSongFixture().bytes);await f.preview.play();
  const before=f.preview.read(),frames=engine.frames,writes=engine.writes.length,resets=engine.resets;
  const scheduled=f.starts.map(node=>({node,buffer:node.buffer,left:node.buffer.getChannelData(0).slice()}));
  for(let channel=0;channel<4;channel++)f.preview.setChannelEnabled(channel,false);
  const muted=f.preview.read();assert.equal(muted.playback,before.playback);assert.equal(muted.positionFrames,before.positionFrames);assert.equal(muted.renderedFrames,before.renderedFrames);
  assert.deepEqual(muted.liveState,before.liveState);assert.equal(engine.frames,frames);assert.equal(engine.writes.length,writes);assert.equal(engine.resets,resets);
  assert.equal(f.starts.length,scheduled.length);for(const {node,buffer,left}of scheduled){assert.equal(node.stopped,undefined);assert.equal(node.buffer,buffer);assert.deepEqual(buffer.getChannelData(0),left);}
  f.advance(.45);assert(engine.renders.some(render=>render.mask===15));
  const future=f.starts.filter(node=>node.at>.35);assert(future.length>0);assert(future.every(node=>node.buffer.getChannelData(0).every(value=>value===0)));
  f.preview.pause();const paused=f.preview.read(),native=engine.frames;f.preview.setChannelEnabled(2,true);
  assert.equal(engine.mask,11);assert.equal(engine.frames,native);assert.equal(f.preview.read().positionFrames,paused.positionFrames);assert.deepEqual(f.preview.read().liveState,paused.liveState);
  await f.preview.resume();assert.equal(engine.resets,resets);f.preview.dispose();
});

test('latest channel flags reach asynchronous play and seek initialization and every discard/prefill batch',async()=>{
  const init=deferred(),engines=[];let started;
  const beginning=new Promise(resolve=>started=resolve),f=setup({yieldTask:async()=>{},createEngine:async()=>{const engine=mutingEngine();engines.push(engine);if(engines.length===1){started();await init.promise;}return engine;}});
  await f.preview.load(createDmgSongFixture().bytes);const playing=f.preview.play();await beginning;
  f.preview.setChannelEnabled(1,false);f.preview.setChannelEnabled(3,false);init.resolve();assert(await playing);
  assert(engines[0].renders.every(render=>render.mask===10));f.preview.stop();assert.equal(f.preview.read().channelMuteMask,10);
  let batches=0;const candidate=mutingEngine(),seek=setup({createEngine:async()=>candidate,yieldTask:async()=>{if(++batches===1)seek.preview.setChannelEnabled(0,false);}});
  await seek.preview.load(createDmgSongFixture().bytes);seek.preview.setChannelEnabled(2,false);assert(await seek.preview.seek(1.1));
  const switched=candidate.renders.findIndex(render=>render.mask===5);assert(switched>0);assert(candidate.renders.slice(0,switched).every(render=>render.mask===4));assert(candidate.renders.slice(switched).every(render=>render.mask===5));
  assert.equal(seek.preview.read().channelMuteMask,5);assert.equal(seek.preview.read().positionFrames,48510);assert.equal(seek.preview.read().playback,'paused');
  assert.equal(candidate.mask,5);seek.preview.dispose();f.preview.dispose();
});

test('retired engine creation never changes a newer run mask; unsupported engines fail only for requested nondefault mixing',async()=>{
  const held=deferred(),engines=[];let entered;
  const started=new Promise(resolve=>entered=resolve),f=setup({createEngine:async()=>{const engine=mutingEngine();engines.push(engine);if(engines.length===1){entered();await held.promise;}return engine;}});
  await f.preview.load(fixtureVgm());const old=f.preview.play();await started;f.preview.stop();f.preview.setChannelEnabled(3,false);assert(await f.preview.play());
  const calls=engines[1].muteCalls.length;held.resolve();assert.equal(await old,false);assert.equal(engines[0].disposed,1);assert.equal(engines[0].muteCalls.length,0);assert.equal(engines[1].muteCalls.length,calls);assert.equal(engines[1].mask,8);f.preview.dispose();
  const legacy=setup();await legacy.preview.load(fixtureVgm());assert(await legacy.preview.play());
  const before=legacy.preview.read();assert.throws(()=>legacy.preview.setChannelEnabled(0,false),/does not support channel/);assert.deepEqual(legacy.preview.read().channelEnabled,before.channelEnabled);assert.equal(legacy.preview.read().playback,'playing');legacy.preview.dispose();
  const configured=setup();configured.preview.setChannelEnabled(1,false);await configured.preview.load(fixtureVgm());assert.equal(await configured.preview.play(),false);assert.match(configured.preview.read().errorMessage,/does not support channel/);assert.equal(configured.engines[0].disposed,1);assert.equal(configured.starts.length,0);configured.preview.dispose();
});

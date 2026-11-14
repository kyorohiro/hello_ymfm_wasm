import test from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import {createGameboySongPreview,prepareGameboySongSource} from './song_preview.js';
import {createDmgSongFixture} from '../../test/helpers/dmg_synth_song_fixture.mjs';
import {createDefaultPreset} from './preset.js';
import {gameboyCodeLiveView} from './code_live.js';

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
    refill(){const next=[...timers].sort((a,b)=>a[1].at-b[1].at)[0];assert(next,'A playing reference must retain its next refill');timers.delete(next[0]);next[1].fn();},
    advance(seconds){const end=context.currentTime+seconds;let count=0;for(;;){const next=[...timers].sort((a,b)=>a[1].at-b[1].at)[0];if(!next||next[1].at>end)break;assert(++count<10000);timers.delete(next[0]);context.currentTime=next[1].at;next[1].fn();}context.currentTime=end;},
  };
}
function fakeEngine() {
  let frame=0;
  return{disposed:0,writes:[],writeFrames:[],sampleRate:()=>44100,reset(){frame=0;},writeGameboyApu(...args){this.writes.push(args);this.writeFrames.push({frame,args});},
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
async function firstScheduledSource(f) {
  // play() commits the run, but a bounded parser slice can yield before PCM.
  // Drive its actual scheduled refill while leaving the fake audio clock still.
  for(let pump=0;pump<100;pump++){
    const source=f.starts.find(node=>!node.stopped);if(source)return source;
    const state=f.preview.read();assert.equal(state.playback,'playing',state.errorMessage||'Waiting for initial DMG PCM');
    f.refill();await new Promise(resolve=>setImmediate(resolve));
  }
  assert.fail('DMG reference did not schedule PCM after 100 cooperative refills');
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
  await firstScheduledSource(f);
  assert.equal(f.engines.length,1);assert.equal(f.gains.length,1);assert.equal(f.gains[0].gain.value,1);
  assert.equal(f.gains[0].output,f.host.songInputNode);assert.equal(f.host.songInputNode.gain.value,.28);
  assert(f.starts.every(node=>node.buffer.sampleRate===44100));assert.equal(f.starts[0].at,.01);
  const initial=f.preview.read();assert(initial.renderedFrames>initial.positionFrames);assert(initial.bufferedFrames<=.05*44100);
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

test('a parser budget yield before the first PCM continues the same run at frame zero on its scheduled refill',async()=>{
  const engine=fakeEngine(),write=engine.writeGameboyApu;let first=true,creations=0;
  engine.writeGameboyApu=function(...args){
    if(first){first=false;const end=performance.now()+8;while(performance.now()<end){}}
    return write.apply(this,args);
  };
  const f=setup({createEngine:async()=>{creations++;return engine;}});
  try{
    await f.preview.load(createDmgSongFixture().bytes);assert(await f.preview.play());
    assert.equal(f.starts.length,0,'the slow first register write exhausts VgmPlayer\'s 4 ms parser budget before a wait produces PCM');
    assert.equal(engine.frames,0);assert.equal(f.preview.read().bufferedFrames,0);
    const source=await firstScheduledSource(f);
    assert.equal(creations,1,'refill continues the existing core rather than retrying Play');
    assert.equal(f.audioRequests,1);assert.equal(f.context.currentTime,0);assert.equal(f.preview.read().positionFrames,0);
    assert.equal(source.at,.01);assert.equal(source.offset,0);
    const pcm=source.buffer.getChannelData(0);
    for(let i=0;i<pcm.length;i++)assert.equal(pcm[i],Math.fround(((i%1000)/1000-.5)*.1),'the first generated PCM starts at source frame zero');
  }finally{f.preview.dispose();}
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

test('low-latency refills keep every sample and bound generated lookahead without publishing Live faster than 20 Hz',async()=>{
  const f=setup();await f.preview.load(createDmgSongFixture().bytes);await f.preview.play();
  await firstScheduledSource(f);
  const started=f.states.length,first=f.starts[0].at;
  for(let i=0;i<700;i++){
    f.advance(.001);const state=f.preview.read();
    assert(state.bufferedFrames<=.05*44100,'scheduled audio stays below 50 ms');
    assert(f.engines[0].frames-state.positionFrames<=.06*44100,'including the player queue, native generation stays below 60 ms');
  }
  assert(f.states.length-started<=14,'the 8 ms refill must not repaint Live on every pump');
  let cursor=0;
  for(const node of f.starts){
    assert(Math.abs(node.at-(first+cursor/44100))<1e-9,'every segment follows the preceding sample without skipping song time');
    assert.equal(node.stopped,undefined);assert.equal(node.offset,0);
    const pcm=node.buffer.getChannelData(0);
    for(let i=0;i<pcm.length;i++)assert.equal(pcm[i],Math.fround((((cursor+i)%1000)/1000-.5)*.1));
    cursor+=pcm.length;
  }
  assert.equal(cursor,f.preview.read().renderedFrames);f.preview.dispose();
});

test('manual fields display immediately while the generated timeline and queued PCM retain their original sample positions',async()=>{
  const f=setup();await f.preview.load(createDmgSongFixture().bytes);await f.preview.play();f.advance(.12);
  const before=f.preview.read(),engine=f.engines[0],native=engine.frames;
  const retained=f.starts.map(node=>({node,pcm:node.buffer.getChannelData(0).slice()}));
  assert(before.canInteract);assert(before.interaction.runId>0);
  assert(f.preview.applyEdit({channel:0,changes:{'pulse.duty':.125}}));
  const after=f.preview.read();assert.equal(after.playback,'playing');assert.equal(after.positionFrames,before.positionFrames);assert.equal(engine.frames,native);
  assert.equal(after.interaction.registers[1]>>6,0);assert.equal(after.liveState.registers[1]>>6,0,'the deliberately edited field stays ready for the next key-repeat step');
  for(let i=0;i<48;i++)if(i!==1)assert.equal(after.liveState.registers[i],before.liveState.registers[i]);
  assert.deepEqual(engine.writeFrames.at(-1),{frame:native,args:[1,0]});
  for(const {node,pcm}of retained){assert.equal(node.stopped,undefined);assert.deepEqual(node.buffer.getChannelData(0),pcm);}
  while(f.preview.read().positionFrames<native)f.advance(.001);
  assert.equal(f.preview.read().liveState.registers[1]>>6,0);
  f.advance(1);assert.equal(f.preview.read().liveState.registers[1]>>6,3,'a later VGM register write wins naturally');
  f.preview.dispose();
});

test('Auto update Off patches only the deliberately edited field and leaves the rest of its frozen four-channel snapshot intact',async()=>{
  const f=setup();await f.preview.load(createDmgSongFixture().bytes);await f.preview.play();f.advance(.88);
  const frozen=f.preview.setLiveEnabled(false).liveState;
  while(f.preview.read().interaction.registers[1]>>6!==3)f.advance(.001);
  const native=f.preview.read().interaction.registers;
  assert.equal(frozen.registers[1]>>6,1);assert.equal(native[1]>>6,3,'native state has already processed a future VGM event');
  assert(f.preview.applyEdit({channel:0,changes:{'pulse.volume':5}}));
  const next=f.preview.read();
  assert.equal(next.liveState.positionFrames,frozen.positionFrames);assert.equal(next.liveState.registers[2]>>4,5);
  assert.equal(next.interaction.registers[2],0x50);
  for(let i=0;i<48;i++)if(i!==2){assert.equal(next.liveState.registers[i],frozen.registers[i]);assert.equal(next.liveState.voice[i],frozen.voice[i]);}
  assert(Object.isFrozen(next.liveState));assert(Object.isFrozen(next.liveState.registers));assert(Object.isFrozen(next.liveState.voice));
  assert.throws(()=>{next.liveState.voice[1]=0;},TypeError);
  f.advance(.25);assert.deepEqual(f.preview.read().liveState,next.liveState);
  const following=f.preview.setLiveEnabled(true);assert.equal(following.liveState.registers[1]>>6,3);assert.equal(following.liveState.registers[2]>>4,5);
  f.preview.dispose();
});

test('Pause and seek retire manual note identities without replacing retained PCM, and presets are pinned to their original run',async()=>{
  const f=setup({yieldTask:async()=>{}});await f.preview.load(createDmgSongFixture().bytes);await f.preview.play();f.advance(.12);
  const firstRun=f.preview.read().interaction.runId;assert(f.preview.noteOn('keyboard',60,{channel:0}));
  assert.equal(f.preview.read().interaction.voices.length,1);f.preview.pause();
  const paused=f.preview.read(),native=f.engines[0].frames;
  assert.deepEqual(paused.interaction.voices,[]);assert.equal(paused.canInteract,false);
  assert.equal(f.preview.noteOn('not-paused-trial',64,{channel:0}),false);assert.equal(f.preview.applyEdit({channel:0,changes:{'pulse.duty':.5}}),false);
  assert.equal(f.preview.noteOff('keyboard'),false);assert.equal(f.engines[0].frames,native);
  assert(await f.preview.resume());assert.equal(f.preview.read().interaction.runId,firstRun);
  assert(f.preview.noteOn('before-seek',62,{channel:1}));assert(await f.preview.seek(.4));
  assert.deepEqual(f.preview.read().interaction.voices,[]);assert(f.preview.read().playing);
  const second=f.preview.read(),writes=f.engines[1].writes.length;
  assert(second.interaction.runId>firstRun);
  assert.equal(f.preview.applyPreset({}, {runId:firstRun}),false,'a delayed stale preset skips even validation and native writes');
  assert.equal(f.engines[1].writes.length,writes);assert.deepEqual(f.preview.read().interaction,second.interaction);
  f.preview.stop();assert.equal(f.preview.read().interaction,null);assert(await f.preview.play());
  assert(f.preview.read().interaction.runId>second.interaction.runId);
  assert.equal(f.preview.applyPreset({}, {runId:second.interaction.runId}),false);f.preview.dispose();
});

test('a full-preset forwarding result patches only its planned fields in Auto update Off without unfreezing the song',async()=>{
  const f=setup();await f.preview.load(createDmgSongFixture().bytes);await f.preview.play();f.advance(.15);
  const frozen=f.preview.setLiveEnabled(false).liveState,previous=createDefaultPreset(),preset=structuredClone(previous);
  preset.pulse.duty=.75;
  const runId=f.preview.read().interaction.runId,result=f.preview.applyPreset(preset,{previous,replace:false,runId});
  assert(result);assert(result.edits.length>0);
  const next=f.preview.read();assert.equal(next.liveEnabled,false);assert.equal(next.liveState.positionFrames,frozen.positionFrames);
  assert.equal(next.liveState.registers[1]>>6,3);assert.equal(next.liveState.registers[6]>>6,3);
  for(let index=0;index<48;index++)if(index!==1&&index!==6){assert.equal(next.liveState.registers[index],frozen.registers[index]);assert.equal(next.liveState.voice[index],frozen.voice[index]);}
  assert.equal(next.playback,'playing');assert.equal(next.interaction.runId,runId);f.preview.dispose();
});

test('generated EOF disables new interactions, permits safe releases, and retains exact original duration without a synthetic tail',async()=>{
  const commands=[0xb3,22,128,0xb3,20,0x77,0xb3,21,0xff,0xb3,1,0x40,0xb3,2,0x70,0xb3,3,0x0b,0xb3,4,0x86,0x61,0xac,0x14,0x66];
  const f=setup();await f.preview.load(fixtureVgm(commands));await f.preview.play();f.advance(.02);
  assert(f.preview.noteOn('tail-key',60,{channel:0}));
  for(let i=0;i<200&&f.preview.read().canInteract;i++)f.advance(.001);
  const finishing=f.preview.read(),writes=f.engines[0].writes.length;
  assert(finishing.playing);assert(!finishing.canInteract);assert.match(finishing.interactionMessage,/Finishing song/);
  assert(finishing.positionFrames<5292);assert(5292-finishing.positionFrames<.06*44100);
  assert.equal(f.preview.noteOn('too-late',64,{channel:0}),false);assert.equal(f.preview.applyEdit({channel:0,changes:{'pulse.duty':.75}}),false);
  assert.equal(f.engines[0].writes.length,writes);assert.equal(f.preview.noteOff('tail-key'),true);
  f.advance(.2);const ended=f.preview.read();assert.equal(ended.playback,'ended');assert.equal(ended.positionFrames,5292);
  assert.equal(f.engines[0].frames,5292);assert.equal(f.engines[0].disposed,1);assert.equal(f.timers.size,0);
  assert.equal(f.starts.reduce((frames,node)=>frames+node.buffer.length,0),5292);assert.equal(f.preview.releaseKeyboard(),false);f.preview.dispose();
});

test('VGM power-off intervals disable high-level interaction without touching the chip or preventing its later power-on',async()=>{
  const commands=[0xb3,22,128,0xb3,20,0x77,0xb3,21,0xff,0xb3,1,0x40,0xb3,2,0x70,0xb3,3,0x0b,0xb3,4,0x86,
    0x61,0x3a,0x11,0xb3,22,0,0x61,0x3a,0x11,0xb3,22,128,0xb3,2,0x70,0x61,0x3a,0x11,0x66];
  const f=setup();await f.preview.load(fixtureVgm(commands));await f.preview.play();assert(f.preview.read().canInteract);
  assert(f.preview.noteOn('before-power-off',60,{channel:0}));
  assert(f.preview.setPitch(1));
  for(let i=0;i<150&&f.preview.read().interaction.initialized;i++)f.advance(.001);
  const off=f.preview.read(),writes=f.engines[0].writes.length;
  assert(off.playing);assert.equal(off.interaction.initialized,false);assert.equal(off.canInteract,false);assert.match(off.interactionMessage,/powered off the APU/);
  assert.deepEqual(off.interaction.voices,[]);
  assert.equal(f.preview.noteOn('off',60,{channel:0}),false);assert.equal(f.preview.applyEdit({channel:0,changes:{'pulse.duty':.5}}),false);
  assert.equal(f.preview.applyPreset(createDefaultPreset(),{runId:off.interaction.runId}),false);
  assert.equal(f.preview.noteOff('before-power-off'),false);assert.equal(f.engines[0].writes.length,writes);
  assert.equal(off.interaction.pitch,1);assert(f.preview.setPitch(0));assert.equal(f.preview.read().interaction.pitch,0);
  assert.equal(f.engines[0].writes.length,writes,'wheel release clears its software value without touching a powered-off chip');
  for(let i=0;i<150&&!f.preview.read().interaction.initialized;i++)f.advance(.001);
  assert(f.preview.read().canInteract);assert(f.preview.noteOn('powered-on',64,{channel:0}));
  const regs=f.preview.read().interaction.registers,period=regs[3]|((regs[4]&7)<<8);
  assert.equal(period,Math.round(2048-4194304/(32*440*2**((64-69)/12))),'a fresh key after power-on is no longer bent');
  assert(f.preview.noteOff('powered-on'));f.preview.dispose();
});

test('rapid sparse edits keep the latest desired display at one audio frame and retain at most one pending entry per field',async()=>{
  const f=setup();await f.preview.load(createDmgSongFixture().bytes);await f.preview.play();f.advance(.12);
  const before=f.preview.read(),native=f.engines[0].frames;
  for(let i=0;i<1000;i++){
    const shift=i<4?i:i%16;
    f.preview.applyEdit({channel:3,changes:{'noise.shift':shift}});
    const state=f.preview.read();assert.equal(state.liveState.registers[18]>>4,shift);
    assert.equal(f.states.at(-1).liveState.registers[18]>>4,shift,'the actual synchronous onState editor update must not restore an old value');
    assert.equal(state.pendingDisplayEdits,1);assert.equal(state.positionFrames,before.positionFrames);
    for(let index=0;index<48;index++)if(index!==18)assert.equal(state.liveState.registers[index],before.liveState.registers[index]);
  }
  f.preview.applyEdit({channel:3,changes:{'noise.shift':3}});f.preview.applyEdit({channel:0,changes:{'pulse.duty':.125}});
  assert.equal(f.preview.read().pendingDisplayEdits,2);assert.equal(f.engines[0].frames,native,'display retention never renders or drops PCM');
  while(f.preview.read().positionFrames<native)f.advance(.001);
  assert.equal(f.preview.read().pendingDisplayEdits,0);assert.equal(f.preview.read().liveState.registers[18]>>4,3);
  f.advance(1);assert.equal(f.preview.read().liveState.registers[18]>>4,1,'a later recorded Noise write takes over after pending display expires');f.preview.dispose();
});

test('a VGM overwrite at the same generated frame becomes visible exactly when the manual pending field expires',async()=>{
  const initial=[0xb3,22,128,0xb3,20,0x77,0xb3,21,0xff,0xb3,1,0x40,0xb3,2,0x70,0xb3,3,0x0b,0xb3,4,0x86];
  const f=setup();await f.preview.load(fixtureVgm([...initial,0x61,0,16,0xb3,1,0xc0,0x61,0,32,0x66]));await f.preview.play();
  while(f.engines[0].frames<4096)f.advance(.001);
  assert.equal(f.engines[0].frames,4096);assert.equal(f.preview.read().interaction.registers[1]>>6,1);
  f.preview.applyEdit({channel:0,changes:{'pulse.duty':.125}});assert.equal(f.preview.read().liveState.registers[1]>>6,0);
  f.advance(.008);assert.equal(f.preview.read().interaction.registers[1]>>6,3,'the VGM has already overwritten the native value at the same boundary');
  assert(f.engines[0].writeFrames.some(event=>event.frame===4096&&event.args[0]===1&&event.args[1]===0xc0));
  assert.equal(f.preview.read().pendingDisplayEdits,1);assert.equal(f.preview.read().liveState.registers[1]>>6,0);
  while(f.preview.read().positionFrames<4096)f.advance(.001);
  assert.equal(f.preview.read().pendingDisplayEdits,0);assert.equal(f.preview.read().liveState.registers[1]>>6,3);f.preview.dispose();
});

test('pending manual fields survive Auto update Off to On, while Pause returns the exact raw audible snapshot',async()=>{
  const f=setup();await f.preview.load(createDmgSongFixture().bytes);await f.preview.play();f.advance(.12);
  const before=f.preview.setLiveEnabled(false).liveState;
  f.preview.applyEdit({channel:3,changes:{'noise.shift':2}});
  let state=f.preview.read();assert.equal(state.liveEnabled,false);assert.equal(state.liveState.registers[18]>>4,2);assert.equal(state.pendingDisplayEdits,1);
  state=f.preview.setLiveEnabled(true);assert.equal(state.liveState.registers[18]>>4,2);assert.equal(state.liveState.positionFrames,before.positionFrames);
  for(let index=0;index<48;index++)if(index!==18)assert.equal(state.liveState.registers[index],before.registers[index]);
  assert(f.preview.pause());state=f.preview.read();assert(state.paused);assert.equal(state.pendingDisplayEdits,0);
  assert.equal(state.liveState.registers[18]>>4,4,'Pause and Capture must inspect the actual heard settings, not the pending display intent');
  assert.equal(state.liveState.positionFrames,state.positionFrames);assert.equal(state.interaction.registers[18]>>4,2,'returning to an exact snapshot does not undo the actual native edit');
  assert(await f.preview.resume());assert.equal(f.preview.read().liveState.registers[18]>>4,4);
  const head=f.engines[0].frames;while(f.preview.read().positionFrames<head)f.advance(.001);
  assert.equal(f.preview.read().liveState.registers[18]>>4,2);f.preview.dispose();
});

test('preset edits use the same bounded pending fields, and seek/Stop/source replacement cannot carry those fields into a new run',async()=>{
  const f=setup({yieldTask:async()=>{}}),source=createDmgSongFixture().bytes;await f.preview.load(source);await f.preview.play();f.advance(.12);
  const before=f.preview.read(),previous=createDefaultPreset(),preset=structuredClone(previous);preset.pulse.duty=.75;
  const result=f.preview.applyPreset(preset,{previous,replace:false,runId:before.interaction.runId});assert(result);
  let state=f.preview.read();assert.equal(state.pendingDisplayEdits,2);assert.equal(state.liveState.registers[1]>>6,3);assert.equal(state.liveState.registers[6]>>6,3);
  for(let index=0;index<48;index++)if(index!==1&&index!==6)assert.equal(state.liveState.registers[index],before.liveState.registers[index]);
  assert(await f.preview.seek(.2));state=f.preview.read();assert.equal(state.pendingDisplayEdits,0);assert.equal(state.liveState.registers[1]>>6,1);
  f.preview.applyEdit({channel:3,changes:{'noise.shift':1}});assert.equal(f.preview.read().pendingDisplayEdits,1);
  f.preview.stop();assert.equal(f.preview.read().pendingDisplayEdits,0);assert(await f.preview.play());assert.equal(f.preview.read().pendingDisplayEdits,0);
  f.preview.applyEdit({channel:3,changes:{'noise.shift':2}});assert.equal(f.preview.read().pendingDisplayEdits,1);
  await f.preview.load(source,'replacement.vgm');assert.equal(f.preview.read().pendingDisplayEdits,0);assert(await f.preview.play());assert.equal(f.preview.read().liveState.registers[18]>>4,4);f.preview.dispose();
});

test('pending Sweep codes stay grouped and match native On/Off/period/shift order at one audible frame',async()=>{
  for(const auto of [true,false]){
    const f=setup();await f.preview.load(createDmgSongFixture().bytes);await f.preview.play();f.advance(.12);
    if(!auto)f.preview.setLiveEnabled(false);
    const before=f.preview.read(),native=f.engines[0].frames;
    const apply=(changes,expected)=>{
      assert(f.preview.applyEdit({channel:0,changes}));const state=f.preview.read();
      assert.equal(state.interaction.voice[0],expected,'reference APU receives the intended NR10 codes');
      assert.equal(state.liveState.voice[0],expected,'the immediate editor update must agree with the native write');
      assert.equal(state.liveState.registers[0],expected);assert.equal(state.positionFrames,before.positionFrames);
      assert.equal(gameboyCodeLiveView(state.liveState,0).preset.pulse.sweep.enabled,Boolean(expected&0x77));
      for(let i=1;i<48;i++)assert.equal(state.liveState.registers[i],before.liveState.registers[i]);
      assert(state.pendingDisplayEdits<=3);assert.equal(f.engines[0].frames,native);
    };
    apply({'pulse.sweep.enabled':true,'pulse.sweep.period':3,'pulse.sweep.shift':3},0x33);
    apply({'pulse.sweep.enabled':false},0);
    apply({'pulse.sweep.enabled':true},0);
    apply({'pulse.sweep.enabled':true,'pulse.sweep.period':3,'pulse.sweep.shift':3},0x33);
    apply({'pulse.sweep.enabled':false},0);
    apply({'pulse.sweep.period':2},0x20);
    apply({'pulse.sweep.enabled':false},0);
    apply({'pulse.sweep.shift':2},2);
    apply({'pulse.sweep.period':3},0x32);
    if(!auto)f.preview.setLiveEnabled(true);
    assert.equal(f.preview.read().liveState.voice[0],0x32);
    while(f.preview.read().positionFrames<native)f.advance(.001);
    assert.equal(f.preview.read().pendingDisplayEdits,0);assert.equal(f.preview.read().liveState.voice[0],0x32);f.preview.dispose();
  }
});

test('a period-only edit from disabled NR10 immediately derives enabled Sweep without inventing other pending fields',async()=>{
  const f=setup();await f.preview.load(createDmgSongFixture().bytes);await f.preview.play();f.advance(.12);
  assert.equal(f.preview.read().liveState.voice[0],0);
  f.preview.applyEdit({channel:0,changes:{'pulse.sweep.period':3}});
  const state=f.preview.read();assert.equal(state.liveState.voice[0],0x30);assert.equal(state.interaction.voice[0],0x30);
  assert.equal(gameboyCodeLiveView(state.liveState,0).preset.pulse.sweep.enabled,true);assert.equal(state.pendingDisplayEdits,1);f.preview.dispose();
});

// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {createPsfSongPreview} from './psf_song_preview.js';

const RATE=44100;
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
async function until(predicate){for(let i=0;i<300;i++){if(predicate())return;await Promise.resolve();}throw Error('Pending fixture did not settle');}
const source=()=>({records:new Map([['song.psf',{tags:new Map([['title','Seek fixture']])}],['other.psf',{tags:new Map()}]])});
function machine() {
  let frame=0,disposals=0;const renders=[],stems=[],observations=[],copies=[];
  const value={sampleRate:RATE,renders,stems,observations,copies,get frame(){return frame;},get disposals(){return disposals;},
    render(frames){renders.push(frames);const pcm=new Float32Array(frames*2);for(let i=0;i<frames;i++){pcm[i*2]=frame;pcm[i*2+1]=-frame;frame++;}return pcm;},
    renderWithVoices(frames){const start=frame,pcm=value.render(frames),voices=new Float32Array(frames*48);stems.push(frames);
      for(let i=0;i<frames;i++)for(let ch=0;ch<24;ch++){voices[i*48+ch*2]=100000*(ch+1)+start+i;voices[i*48+ch*2+1]=-voices[i*48+ch*2];}return {pcm,voices};},
    observe(){observations.push(frame);return {nativeFrames:frame,observation:{kind:'psf',nativeFrames:frame},
      channels:Array.from({length:24},(_,channel)=>({channel,pitch:frame+channel,gate:true,active:true,envelope:frame})),noise:{clock:37},pmon:{enabled:false},reverb:{preset:'room'}};},
    copySpuRam(){copies.push(frame);const bytes=new Uint8Array(524288);new DataView(bytes.buffer).setUint32(0,frame,true);return bytes;},
    dispose(){disposals++;},
  };return value;
}
function harness(options={}) {
  const machines=[],starts=[],buffers=[],gates=[],faders=[],updates=[],requests=[],timers=new Map();let clock=0,serial=0,before=0;
  const context={currentTime:0,state:'running',sampleRate:RATE,
    createGain(){const gain={gain:{value:1},connect(){},disconnect(){this.disconnected=true;}};gates.push(gain);return gain;},
    createBuffer(channels,length,sampleRate){const data=Array.from({length:channels},()=>new Float32Array(length)),buffer={length,sampleRate,getChannelData:ch=>data[ch]};buffers.push(buffer);return buffer;},
    createBufferSource(){const node={connect(){},disconnect(){},stop(){this.stopped=true;},start(at,offset,duration){starts.push({node,at,offset,duration});}};return node;},
  },audio={context,gain:{author:true},resume:async()=>{}};
  const controller=createPsfSongPreview({getAudio:()=>audio,beforeSeek:()=>{before++;},
    createCore:async request=>{requests.push(request);const core=machine();machines.push(core);return core;},
    onUpdate:state=>updates.push(state),schedule:fn=>{timers.set(++serial,fn);return serial;},cancel:id=>timers.delete(id),
    createOutput:hooks=>{const events=[],output={fadeOut:async()=>{events.push(['fade']);},open:options=>events.push(['open',options]),dispose:()=>events.push(['dispose'])};faders.push({hooks,events});return output;},
    chunkFrames:4,lookaheadSeconds:4/RATE,startDelaySeconds:0,yieldSeek:async()=>{},seekNowMs:()=>clock,...options});
  controller.setSource(source(),'song.psf');
  return {controller,audio,context,machines,starts,buffers,gates,faders,updates,requests,timers,get before(){return before;},
    advance:frames=>{context.currentTime+=frames/RATE;},setClock:value=>{clock=value;}};
}
const frameInRam=ram=>new DataView(ram.buffer,ram.byteOffset,ram.byteLength).getUint32(0,true);
const firstSample=start=>start.node.buffer.getChannelData(0)[Math.round(start.offset*RATE)];

test('stopped seek discards bounded adaptive slices and captures only the exact target without scheduling audio',async t=>{
  let yields=0;
  const h=harness({yieldSeek:async()=>{yields++;}});t.after(()=>h.controller.dispose());
  await h.controller.setMonitorEnabled(true);h.controller.setLiveVoice(23);
  const target=20000;assert.equal(await h.controller.seek(target/RATE),true);
  const core=h.machines[0],state=h.controller.read();
  assert.equal(state.paused,true);assert.equal(state.positionSeconds,target/RATE);assert.equal(state.liveFrame,target);
  assert.equal(state.monitorEnabled,true);assert.equal(state.monitorVoice,23);assert.equal(state.monitorBufferedBytes,0);
  assert.equal(core.renders[0],256);assert(core.renders.every(frames=>frames<=2048));
  assert.equal(core.renders.reduce((sum,frames)=>sum+frames,0),target);assert.equal(yields,core.renders.length);
  assert.deepEqual(core.stems,[]);assert.deepEqual(core.observations,[target]);assert.deepEqual(core.copies,[target]);
  assert.equal(h.starts.length,0);assert.equal(h.buffers.length,0);assert.equal(h.before,1);
  assert.equal(frameInRam(h.controller.capturePaused().ram),target);assert.equal(state.seeking,false);
  assert.equal(state.canResume,true);assert.equal(state.canSeek,true);
});

test('paused seek commits a fresh core, keeps source controls and resumes from its exact selected-channel sample',async t=>{
  const h=harness();t.after(()=>h.controller.dispose());
  await h.controller.play();h.advance(2);h.controller.pause();
  const old=h.machines[0];await h.controller.setMonitorEnabled(true);h.controller.setLiveVoice(4);
  const target=91;assert.equal(await h.controller.seek(target/RATE),true);
  assert.equal(old.disposals,1);assert.equal(h.machines[1].frame,target);assert.equal(h.controller.read().paused,true);
  const count=h.starts.length;await h.controller.resume();
  assert.equal(firstSample(h.starts[count]),500000+target);
  const opened=h.faders.at(-1).events.find(event=>event[0]==='open');assert.equal(opened[1].freshInput,true);assert.equal(opened[1].notBefore,h.starts[count].at);
});

test('playing seek resumes automatically, while zero-frame seeking prepares a silent paused source',async t=>{
  const h=harness();t.after(()=>h.controller.dispose());
  await h.controller.play();h.advance(2);
  const count=h.starts.length;assert.equal(await h.controller.seek(31/RATE),true);
  assert.equal(h.controller.read().playing,true);assert.equal(firstSample(h.starts[count]),31);
  assert(h.faders[0].events.some(event=>event[0]==='fade'));
  const empty=harness();t.after(()=>empty.controller.dispose());
  assert.equal(await empty.controller.seek(0),true);assert.equal(empty.controller.read().paused,true);
  assert.equal(empty.controller.read().liveFrame,0);assert.deepEqual(empty.machines[0].renders,[]);assert.equal(empty.starts.length,0);
});

test('Live Off seek copies no RAM and enabling Live while paused captures that same target without rendering',async t=>{
  const h=harness();t.after(()=>h.controller.dispose());h.controller.setLiveEnabled(false);
  await h.controller.seek(777/RATE);const core=h.machines[0],renders=core.renders.slice();
  assert.deepEqual(core.observations,[]);assert.deepEqual(core.copies,[]);assert.equal(h.controller.read().canCapture,false);
  h.controller.setLiveEnabled(true);
  assert.deepEqual(core.observations,[777]);assert.deepEqual(core.copies,[777]);assert.deepEqual(core.renders,renders);
  assert.equal(h.controller.read().liveFrame,777);assert.equal(frameInRam(h.controller.capturePaused().ram),777);
  h.controller.setLiveEnabled(false);h.controller.setLiveEnabled(true);assert.deepEqual(core.copies,[777]);
});

test('Cancel from Pause keeps old core, unconsumed audio and exact frozen Capture, never committing target PCM',async t=>{
  let gate=null;
  const h=harness({yieldSeek:()=>gate?.promise??Promise.resolve()});t.after(()=>h.controller.dispose());
  await h.controller.play();h.advance(2);h.controller.pause();
  const original=h.machines[0],before=h.controller.capturePaused(),oldFrame=original.frame,starts=h.starts.length;
  gate=deferred();const seeking=h.controller.seek(1000/RATE);await until(()=>h.machines.length===2&&h.machines[1].renders.length);
  assert.equal(h.controller.read().seeking,true);assert.equal(h.controller.read().canCapture,false);assert.equal(original.disposals,0);
  assert.equal(await h.controller.cancelSeek(),true);assert.equal(await seeking,false);
  assert.equal(h.controller.read().paused,true);assert.equal(h.controller.read().positionSeconds,2/RATE);
  assert.equal(original.frame,oldFrame);assert.equal(original.disposals,0);assert.equal(h.machines[1].disposals,1);
  assert.deepEqual(h.controller.capturePaused(),before);assert.equal(h.starts.length,starts);
  gate.resolve();await Promise.resolve();assert.equal(h.controller.read().liveFrame,before.frame);
});

test('Cancel from playing restores only the original scheduled route and its next unconsumed sample',async t=>{
  const gate=deferred(),h=harness({yieldSeek:()=>gate.promise});t.after(()=>h.controller.dispose());
  await h.controller.play();h.advance(2);const count=h.starts.length,seeking=h.controller.seek(900/RATE);
  await until(()=>h.machines.length===2&&h.machines[1].renders.length);
  await h.controller.cancelSeek();assert.equal(await seeking,false);
  assert.equal(h.controller.read().playing,true);assert.equal(firstSample(h.starts[count]),2);
  assert.equal(h.machines[0].disposals,0);assert.equal(h.machines[1].disposals,1);
  assert.equal(h.faders[0].events.at(-1)[1].freshInput,true);gate.resolve();
});

test('seek render failures, hook failures and elapsed limits restore the old paused or playing run',async t=>{
  const h=harness();t.after(()=>h.controller.dispose());await h.controller.play();h.advance(1);h.controller.pause();
  const original=h.machines[0],before=h.controller.capturePaused();let faulty;
  const failed=harness({createCore:async()=>{faulty=machine();faulty.render=()=>{throw Error('fixture render failed');};return faulty;}});
  t.after(()=>failed.controller.dispose());assert.equal(await failed.controller.seek(1),false);
  assert.equal(faulty.disposals,1);assert.equal(failed.controller.read().canPlay,true);assert.match(failed.controller.read().seekMessage,/fixture render failed/);
  let now=0;
  const timeout=harness({seekNowMs:()=>now,seekTimeoutMilliseconds:5,yieldSeek:async()=>{now=6;}});t.after(()=>timeout.controller.dispose());
  await timeout.controller.play();timeout.advance(2);const starts=timeout.starts.length;
  assert.equal(await timeout.controller.seek(1000/RATE),false);assert.equal(timeout.controller.read().playing,true);
  assert.equal(firstSample(timeout.starts[starts]),2);assert.equal(timeout.machines[0].disposals,0);assert.equal(timeout.machines[1].disposals,1);
  assert.match(timeout.controller.read().seekMessage,/processing-time limit/);
  assert.equal(original.disposals,0);assert.deepEqual(h.controller.capturePaused(),before);
  const hook=harness({beforeSeek:async()=>{throw Error('hook refused');}});t.after(()=>hook.controller.dispose());
  await hook.controller.play();hook.advance(2);assert.equal(await hook.controller.seek(10/RATE),false);
  assert.equal(hook.controller.read().playing,true);assert.equal(hook.machines.length,1);assert.equal(hook.machines[0].disposals,0);
});

test('reseek waits for an aborted initializer and disposal before creating its only next candidate',async t=>{
  const pending=deferred(),old=machine();let calls=0;
  const h=harness({createCore:()=>++calls===1?pending.promise:Promise.resolve(machine())});t.after(()=>h.controller.dispose());
  const first=h.controller.seek(20/RATE);await until(()=>calls===1);await h.controller.cancelSeek();assert.equal(await first,false);
  const second=h.controller.seek(30/RATE);for(let i=0;i<20;i++)await Promise.resolve();assert.equal(calls,1);
  pending.resolve(old);assert.equal(await second,true);assert.equal(calls,2);assert.equal(old.disposals,1);
  assert.equal(h.controller.read().positionSeconds,30/RATE);assert.equal(h.controller.read().paused,true);
});

test('a later seek waits for asynchronous retirement of the previously replaced core',async t=>{
  const h=harness();t.after(()=>h.controller.dispose());await h.controller.play();h.controller.pause();
  const old=h.machines[0],release=deferred(),dispose=old.dispose;old.dispose=()=>{dispose();return release.promise;};
  assert.equal(await h.controller.seek(20/RATE),true);assert.equal(old.disposals,1);
  const next=h.controller.seek(30/RATE);for(let i=0;i<20;i++)await Promise.resolve();assert.equal(h.machines.length,2);
  release.resolve();assert.equal(await next,true);assert.equal(h.machines.length,3);
});

test('an immediate Cancel before the seek worker starts does not interrupt the existing playing route',async t=>{
  const h=harness();t.after(()=>h.controller.dispose());await h.controller.play();h.advance(2);
  const starts=h.starts.length,seeking=h.controller.seek(20/RATE);await h.controller.cancelSeek();
  assert.equal(await seeking,false);assert.equal(h.controller.read().playing,true);assert.equal(h.starts.length,starts);
  assert.equal(h.machines.length,1);assert.equal(h.faders[0].events.length,0);
});

test('reseek then Cancel during the first pending fade reopens the original route instead of leaving it muted',async t=>{
  const fade=deferred(),events=[];
  const h=harness({createOutput:()=>({fadeOut(){events.push('fade');return fade.promise;},open(options){events.push(options);fade.resolve(false);},dispose(){}})});
  t.after(()=>h.controller.dispose());await h.controller.play();h.advance(2);const starts=h.starts.length;
  const first=h.controller.seek(100/RATE);await until(()=>events.length===1);
  const second=h.controller.seek(200/RATE);await h.controller.cancelSeek();
  assert.equal(await first,false);assert.equal(await second,false);assert.equal(h.controller.read().playing,true);
  assert.equal(firstSample(h.starts[starts]),2);assert.equal(events.at(-1).freshInput,true);assert.equal(h.machines.length,1);
});

test('the seek deadline is retired at commit and cannot abort a successful candidate waiting for audio Resume',async t=>{
  const h=harness({seekTimeoutMilliseconds:30});t.after(()=>h.controller.dispose());await h.controller.play();
  const resume=deferred();h.audio.resume=()=>resume.promise;
  const seeking=h.controller.seek(20/RATE);await until(()=>h.controller.read().resuming);
  await new Promise(resolve=>setTimeout(resolve,45));assert.equal(h.requests[1].signal.aborted,false);
  resume.resolve();assert.equal(await seeking,true);assert.equal(h.controller.read().playing,true);
});

test('Stop during a committed seek waiting for audio Resume releases its cleanup fence for the next seek',async t=>{
  const h=harness();t.after(()=>h.controller.dispose());await h.controller.play();
  const resume=deferred();h.audio.resume=()=>resume.promise;
  const first=h.controller.seek(20/RATE);await until(()=>h.controller.read().resuming);await h.controller.stop();
  assert.equal(await first,false);const next=h.controller.seek(30/RATE);assert.equal(await next,true);
  assert.equal(h.controller.read().paused,true);assert.equal(h.controller.read().positionSeconds,30/RATE);
  const count=h.starts.length;resume.resolve();for(let i=0;i<10;i++)await Promise.resolve();assert.equal(h.starts.length,count);
});

test('Cancel keeps editing fenced until mutable beforeSeek cleanup has finished, then restores the original route',async t=>{
  const cleanup=deferred();let entered=false,author='before',cancelled=false;
  const h=harness({beforeSeek:async()=>{entered=true;await cleanup.promise;author='cleanup finished';}});t.after(()=>h.controller.dispose());
  await h.controller.play();h.advance(2);const count=h.starts.length,seeking=h.controller.seek(20/RATE);
  await until(()=>entered);const cancellation=h.controller.cancelSeek().then(()=>{cancelled=true;author='new editor';});
  for(let i=0;i<20;i++)await Promise.resolve();assert.equal(cancelled,false);assert.equal(h.controller.read().seeking,true);
  assert.equal(h.controller.read().canResume,false);assert.equal(h.starts.length,count);assert.equal(h.machines.length,1);
  cleanup.resolve();await cancellation;assert.equal(await seeking,false);assert.equal(author,'new editor');
  assert.equal(h.controller.read().playing,true);assert.equal(firstSample(h.starts[count]),2);
});

test('Stop and a subsequent seek serialize an old mutable host preparation without allocating another candidate',async t=>{
  const cleanup=deferred();let calls=0,entered=false,stopped=false;
  const h=harness({beforeSeek:async({signal})=>{calls++;if(calls===1){entered=true;await cleanup.promise;signal.throwIfAborted();}}});t.after(()=>h.controller.dispose());
  const first=h.controller.seek(20/RATE);await until(()=>entered);
  const stopping=h.controller.stop().then(()=>{stopped=true;}),second=h.controller.seek(30/RATE);
  for(let i=0;i<20;i++)await Promise.resolve();assert.equal(stopped,false);assert.equal(calls,1);assert.equal(h.machines.length,0);
  assert.equal(h.controller.read().seekPreparing,true);assert.equal(h.controller.read().canStop,true);assert.equal(h.controller.read().busy,true);
  assert.equal(h.controller.read().canSeek,false);assert.equal(h.controller.read().canPlay,false);
  cleanup.resolve();await stopping;assert.equal(await first,false);assert.equal(await second,true);assert.equal(calls,2);
  assert.equal(h.machines.length,1);assert.equal(h.controller.read().positionSeconds,30/RATE);assert.equal(h.controller.read().seekPreparing,false);
});

test('reseek preserves the original playing rollback phase and cannot commit its older target',async t=>{
  let hold=true;const gate=deferred(),h=harness({yieldSeek:()=>hold?gate.promise:Promise.resolve()});t.after(()=>h.controller.dispose());
  await h.controller.play();h.advance(2);const first=h.controller.seek(1000/RATE);
  await until(()=>h.machines.length===2&&h.machines[1].renders.length);
  hold=false;const second=h.controller.seek(40/RATE);
  assert.equal(await first,false);assert.equal(await second,true);assert.equal(h.controller.read().playing,true);
  assert.equal(h.machines[1].disposals,1);assert.equal(h.machines[0].disposals,1);assert.equal(h.machines.length,3);
  assert.equal(firstSample(h.starts.at(-1)),40);gate.resolve();
});

test('Stop, source replacement and disposal invalidate pending seeks without late rollback or output opening',async()=>{
  for(const transition of ['stop','source','dispose']) {
    const gate=deferred(),h=harness({yieldSeek:()=>gate.promise});await h.controller.play();h.advance(2);
    const seeking=h.controller.seek(900/RATE);await until(()=>h.machines.length===2&&h.machines[1].renders.length);
    const count=h.starts.length;
    if(transition==='stop')await h.controller.stop();else if(transition==='source')h.controller.setSource(source(),'other.psf');else await h.controller.dispose();
    gate.resolve();assert.equal(await seeking,false);assert.equal(h.starts.length,count);
    assert.equal(h.machines[0].disposals,1);assert.equal(h.machines[1].disposals,1);assert.equal(h.controller.read().canResume,false);
    if(transition==='source')assert.equal(h.controller.read().name,'other.psf');await h.controller.dispose();
  }
});

test('invalid ranges reject before changing Pause or allocating a candidate',async t=>{
  const h=harness();t.after(()=>h.controller.dispose());await h.controller.play();h.controller.pause();
  const before=h.controller.capturePaused();
  for(const seconds of [-1,1800.1,NaN,Infinity,'2'])await assert.rejects(h.controller.seek(seconds),/0\.\.1800/);
  assert.equal(h.machines.length,1);assert.deepEqual(h.controller.capturePaused(),before);assert.equal(h.controller.read().paused,true);
  assert.equal(h.controller.read().seekMaxSeconds,1800);
});

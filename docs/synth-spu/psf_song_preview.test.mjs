// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {createPsfSongPreview} from './psf_song_preview.js';
import {createSynthCodeOutput} from '../synth/synth_code_output.js';

const RATE=44100;
const RAM_BYTES=512*1024;
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
function source(entry='song.psf',title='Original test song') {
  return {records:new Map([[entry,{tags:new Map([['title',title]])}]]),entries:[{path:entry,title}]};
}
function core() {
  let frame=0,disposals=0;const renders=[];
  return {sampleRate:RATE,renders,get disposals(){return disposals;},get nativeFrames(){return frame;},
    render(frames){renders.push(frames);const pcm=new Float32Array(frames*2);for(let i=0;i<frames;i++){pcm[i*2]=frame;pcm[i*2+1]=-frame;frame++;}return pcm;},
    dispose(){disposals++;}};
}
function harness(options={}) {
  const timers=new Map(),starts=[],outputs=[],updates=[];let nextTimer=0,audioReads=0,beforeCalls=0,contextCloses=0;
  const destination={editor:true},context={currentTime:0,state:'running',
    close(){contextCloses++;},
    createGain(){const output={gain:{value:1,events:[],cancelScheduledValues(at){this.events.push(['cancel',at]);},setValueAtTime(value,at){this.value=value;this.events.push(['set',value,at]);},linearRampToValueAtTime(value,at){this.value=value;this.events.push(['ramp',value,at]);}},connected:null,disconnected:false,
      connect(node){this.connected=node;},disconnect(){this.disconnected=true;}};outputs.push(output);return output;},
    createBuffer(channels,frames,rate){const data=Array.from({length:channels},()=>new Float32Array(frames));return {sampleRate:rate,length:frames,getChannelData:channel=>data[channel]};},
    createBufferSource(){const node={buffer:null,stopped:false,disconnected:false,
      connect(output){this.output=output;},disconnect(){this.disconnected=true;},stop(){this.stopped=true;},
      start(at,offset,duration){starts.push({node,at,offset,duration});}};return node;},
  };
  const audio={context,gain:destination,resume:async()=>{}},machine=core();
  const controller=createPsfSongPreview({getAudio(){audioReads++;return audio;},
    beforePlay(){beforeCalls++;},onUpdate:value=>updates.push(value),createCore:async()=>machine,
    schedule(callback){const id=++nextTimer;timers.set(id,callback);return id;},cancel:id=>timers.delete(id),
    chunkFrames:4,lookaheadSeconds:4/RATE,startDelaySeconds:0,...options});
  return {controller,audio,machine,timers,starts,outputs,updates,
    get audioReads(){return audioReads;},get beforeCalls(){return beforeCalls;},get contextCloses(){return contextCloses;},
    advance(frames){context.currentTime+=frames/RATE;},
    refill(){const first=timers.entries().next().value;assert.ok(first,'a refill is scheduled');timers.delete(first[0]);first[1]();}};
}
const scheduledPcm=({node,offset,duration})=>Array.from(node.buffer.getChannelData(0).slice(Math.round(offset*RATE),Math.round((offset+duration)*RATE)));

function observedCore() {
  const machine=core(),observations=[];
  machine.observations=observations;
  machine.observe=()=>{
    const frame=machine.nativeFrames,state={sampleRate:RATE,nativeSampleRate:RATE,nativeFrames:frame,observation:{kind:'psf',nativeFrames:frame},
      channels:Array.from({length:24},(_,channel)=>({channel,pitch:frame+channel,envelope:frame,
        gate:Boolean(channel&1),waveform:{pcm:[frame,channel]}})),
      samples:[{id:0,startAddress:0x2000,byteLength:64}],noise:{clock:40},pmon:{mask:0},reverb:{preset:'room'}};
    observations.push({frame,state});return state;
  };
  return machine;
}
function liveHarness(options={}) {
  const machine=observedCore(),h=harness({chunkFrames:2048,lookaheadSeconds:8192/RATE,createCore:async()=>machine,...options});
  h.machine=machine;return h;
}
function capturingCore() {
  const machine=observedCore(),render=machine.render,ram=new Uint8Array(RAM_BYTES),copies=[];
  const mark=()=>{new DataView(ram.buffer).setUint32(0,machine.nativeFrames,true);ram[0x2000]=(machine.nativeFrames*7+3)&255;};
  mark();machine.ram=ram;machine.ramCopies=copies;
  machine.render=frames=>{const pcm=render(frames);mark();return pcm;};
  machine.copySpuRam=()=>{copies.push(machine.nativeFrames);return ram.slice();};
  return machine;
}
function captureHarness(options={}) {
  const machine=capturingCore(),h=harness({chunkFrames:2048,lookaheadSeconds:8192/RATE,createCore:async()=>machine,...options});
  h.machine=machine;return h;
}
function monitoredCore() {
  const machine=capturingCore(),parts=[];
  machine.voiceParts=parts;
  machine.renderWithVoices=frames=>{
    const start=machine.nativeFrames,pcm=machine.render(frames),voices=new Float32Array(frames*48);
    for(let frame=0;frame<frames;frame++)for(let channel=0;channel<24;channel++) {
      const value=(channel+1)*100000+start+frame,at=frame*48+channel*2;voices[at]=value;voices[at+1]=-value;
    }
    parts.push({start,frames,voices});return {pcm,voices};
  };
  return machine;
}
function monitorHarness(options={}) {
  const machine=monitoredCore(),fadeTimers=new Map(),faders=[];let serial=0,h;
  h=harness({chunkFrames:2048,lookaheadSeconds:8192/RATE,createCore:async()=>machine,
    createOutput:hooks=>{
      const output=createSynthCodeOutput({...hooks,setTimer(callback){const id=++serial;fadeTimers.set(id,callback);return id;},
        clearTimer:id=>fadeTimers.delete(id),nowMs:()=>h.audio.context.currentTime*1000});
      faders.push({...hooks,output});return output;
    },...options});
  h.machine=machine;h.fadeTimers=fadeTimers;h.faders=faders;
  h.finishFade=async(frames=441)=>{
    h.advance(frames);
    for(const [id,callback]of [...fadeTimers]){fadeTimers.delete(id);callback();}
    // Settle the fader, route switch and any Resume waiting on that switch.
    for(let i=0;i<8;i++)await Promise.resolve();
  };
  return h;
}
const ramFrame=ram=>new DataView(ram.buffer,ram.byteOffset,ram.byteLength).getUint32(0,true);
function assertNoBinary(value) {
  assert.equal(value instanceof ArrayBuffer||ArrayBuffer.isView(value),false,'public transport state never contains private RAM');
  if(value&&typeof value==='object')for(const child of Object.values(value))assertNoBinary(child);
}

test('PSF selection is silent and an invalid entry preserves the accepted source and playback',async()=>{
  const h=harness(),set=source();
  h.controller.setSource(set,'song.psf');
  assert.equal(h.audioReads,0);assert.equal(h.beforeCalls,0);assert.deepEqual(h.machine.renders,[]);
  assert.equal(h.controller.read().selection.title,'Original test song');
  assert.equal(await h.controller.play(),true);
  assert.throws(()=>h.controller.setSource(set,'missing.minipsf'),/Choose an entry/);
  assert.equal(h.controller.read().name,'song.psf');assert.equal(h.controller.read().playing,true);
  assert.equal(h.machine.disposals,0);
  await h.controller.dispose();
});

test('Pause and Resume retain unconsumed PCM instead of rerendering or skipping lookahead',async()=>{
  const h=harness();h.controller.setSource(source(),'song.psf');
  assert.equal(await h.controller.play(),true);
  assert.deepEqual(scheduledPcm(h.starts[0]),[0,1,2,3]);
  h.advance(2);assert.equal(h.controller.pause(),true);
  assert.equal(h.controller.read().positionSeconds,2/RATE);assert.equal(h.timers.size,0);
  assert.ok(h.starts[0].node.stopped);assert.deepEqual(h.machine.renders,[4]);
  h.advance(1000);assert.equal(h.controller.read().positionSeconds,2/RATE);
  assert.equal(await h.controller.resume(),true);
  assert.deepEqual(h.starts.slice(1).flatMap(scheduledPcm),[2,3,4,5,6,7]);
  assert.deepEqual(h.machine.renders,[4,4]);assert.equal(h.beforeCalls,1);assert.equal(h.timers.size,1);
  assert.equal(h.controller.read().positionSeconds,2/RATE);
  h.advance(3);h.controller.pause();assert.equal(h.controller.read().positionSeconds,5/RATE);
  const count=h.starts.length;await h.controller.resume();
  assert.deepEqual(scheduledPcm(h.starts[count]),[5,6,7]);
  await h.controller.dispose();
});

test('song output borrows the final editor bus and removes its software mixing headroom',async()=>{
  const h=harness();h.controller.setSource(source(),'song.psf');await h.controller.play();
  assert.equal(h.outputs.length,2);assert.equal(h.outputs[0].gain.value,.25);assert.equal(h.outputs[1].gain.value,1);
  assert.equal(h.outputs[0].connected,h.audio.gain);assert.equal(h.outputs[1].connected,h.outputs[0]);assert.equal(h.starts[0].node.output,h.outputs[1]);
  await h.controller.stop();
  assert.ok(h.outputs.every(output=>output.disconnected));assert.ok(h.starts.every(item=>item.node.stopped));
  assert.equal(h.machine.disposals,1);assert.equal(h.contextCloses,0);assert.equal(h.timers.size,0);
  assert.equal(h.controller.read().name,'song.psf');assert.equal(h.controller.read().canPlay,true);
  await h.controller.dispose();assert.equal(h.machine.disposals,1);
});

test('Stop cancels pending initialization and disposes its eventual stale result without acquiring audio',async()=>{
  const pending=deferred(),machine=core();let received;
  const h=harness({createCore:options=>{received=options;return pending.promise;}}),set=source();
  h.controller.setSource(set,'song.psf');const playing=h.controller.play();
  assert.equal(h.controller.read().starting,true);assert.equal(received.set,set);assert.equal(received.entry,'song.psf');
  await h.controller.stop();assert.equal(received.signal.aborted,true);
  pending.resolve(machine);assert.equal(await playing,false);
  assert.equal(machine.disposals,1);assert.equal(h.audioReads,0);assert.equal(h.beforeCalls,0);assert.equal(h.starts.length,0);
  assert.equal(h.controller.read().canPlay,true);assert.equal(h.controller.read().error,false);
  await h.controller.dispose();
});

test('a stale initialization cannot replace a newer song or dispose its core',async()=>{
  const old=deferred(),older=core(),newer=core();let calls=0;
  const h=harness({createCore:()=>++calls===1?old.promise:Promise.resolve(newer)});
  h.controller.setSource(source('old.psf'),'old.psf');const first=h.controller.play();
  h.controller.setSource(source('new.psf'),'new.psf');assert.equal(await h.controller.play(),true);
  old.resolve(older);assert.equal(await first,false);
  assert.equal(older.disposals,1);assert.equal(newer.disposals,0);
  assert.equal(h.controller.read().name,'new.psf');assert.equal(h.controller.read().playing,true);
  await h.controller.dispose();assert.equal(newer.disposals,1);
});

test('Stop during asynchronous Resume cannot start another scheduled source',async()=>{
  const pending=deferred(),h=harness();h.audio.resume=()=>pending.promise;
  h.controller.setSource(source(),'song.psf');await h.controller.play();h.advance(1);h.controller.pause();
  const count=h.starts.length,resuming=h.controller.resume();assert.equal(h.controller.read().resuming,true);
  await h.controller.stop();pending.resolve();assert.equal(await resuming,false);
  assert.equal(h.starts.length,count);assert.equal(h.timers.size,0);assert.equal(h.machine.disposals,1);
  assert.equal(h.controller.read().playing,false);await h.controller.dispose();
});

test('buffer underrun resumes the next machine sample rather than skipping to wall-clock time',async()=>{
  const h=harness();h.controller.setSource(source(),'song.psf');await h.controller.play();
  h.advance(100);h.refill();
  assert.deepEqual(scheduledPcm(h.starts[1]),[4,5,6,7]);
  assert.equal(h.starts[1].at,h.audio.context.currentTime);
  assert.equal(h.controller.read().positionSeconds,4/RATE);await h.controller.dispose();
});

test('a slow initial render schedules every first sample after generation instead of starting chunks in the past',async()=>{
  const h=harness({lookaheadSeconds:8/RATE}),render=h.machine.render;
  h.machine.render=frames=>{const pcm=render(frames);h.advance(100);return pcm;};
  h.controller.setSource(source(),'song.psf');assert.equal(await h.controller.play(),true);
  assert.equal(h.starts[0].at,h.audio.context.currentTime);
  assert.equal(h.starts[1].at,h.starts[0].at+4/RATE);
  assert.deepEqual(h.starts.flatMap(scheduledPcm),[0,1,2,3,4,5,6,7]);
  assert.equal(h.controller.read().positionSeconds,0,'render time consumes no unscheduled machine samples');
  h.advance(2);assert.equal(h.controller.read().positionSeconds,2/RATE);
  await h.controller.dispose();
});

test('a slow Resume refill preserves its partial buffer and schedules new PCM after it',async()=>{
  const h=harness();h.controller.setSource(source(),'song.psf');await h.controller.play();h.advance(1);h.controller.pause();
  const render=h.machine.render;h.machine.render=frames=>{const pcm=render(frames);h.advance(100);return pcm;};
  assert.equal(await h.controller.resume(),true);
  assert.equal(h.starts[1].at,h.audio.context.currentTime);
  assert.equal(h.starts[2].at,h.starts[1].at+3/RATE);
  assert.deepEqual(h.starts.slice(1).flatMap(scheduledPcm),[1,2,3,4,5,6,7]);
  assert.equal(h.controller.read().positionSeconds,1/RATE);
  await h.controller.dispose();
});

test('refill retains scheduled future buffers and rebases only fresh PCM after a slow underrun',async()=>{
  const h=harness({lookaheadSeconds:8/RATE});h.controller.setSource(source(),'song.psf');await h.controller.play();
  const render=h.machine.render;let renderDelay=1;
  h.machine.render=frames=>{const pcm=render(frames);h.advance(renderDelay);return pcm;};
  h.advance(1);h.refill();
  assert.equal(h.starts[2].at,8/RATE,'the next chunk follows already scheduled future buffers');
  assert.deepEqual(scheduledPcm(h.starts[2]),[8,9,10,11]);
  assert.equal(h.controller.read().positionSeconds,2/RATE,'position includes playback during generation');
  h.advance(5);renderDelay=1000;h.refill();
  assert.equal(h.starts[3].at,h.audio.context.currentTime,'late fresh PCM starts at the current clock');
  assert.deepEqual(scheduledPcm(h.starts[3]),[12,13,14,15]);
  assert.equal(h.controller.read().positionSeconds,12/RATE,'late rendering never consumes its own unscheduled samples');
  assert.equal(h.starts.length,4,'the original future sources are never rescheduled');
  await h.controller.dispose();
});

test('engine failures release their route while preserving the selected entry',async()=>{
  const machine=core();machine.render=()=>new Float32Array([NaN]);
  const h=harness({createCore:async()=>machine});h.controller.setSource(source(),'song.psf');
  assert.equal(await h.controller.play(),false);
  assert.equal(h.controller.read().playing,false);assert.equal(h.controller.read().error,true);
  assert.match(h.controller.read().message,/invalid stereo PCM/);assert.equal(h.controller.read().name,'song.psf');
  assert.equal(machine.disposals,1);assert.equal(h.starts.length,0);assert.ok(h.outputs[0].disconnected);
  await h.controller.dispose();
});

test('Dispose cancels pending work and never closes the editor context',async()=>{
  const pending=deferred(),machine=core(),h=harness({createCore:()=>pending.promise});
  h.controller.setSource(source(),'song.psf');const playing=h.controller.play();await h.controller.dispose();
  pending.resolve(machine);assert.equal(await playing,false);assert.equal(machine.disposals,1);
  assert.equal(h.contextCloses,0);assert.equal(h.audioReads,0);assert.equal(h.updates.at(-1).playing,false);
  assert.throws(()=>h.controller.setSource(source(),'song.psf'),/disposed/);
});

test('PSF Live controls default to CH1 and remain silent before a song is played',async()=>{
  const h=liveHarness(),initial=h.controller.read();
  assert.equal(initial.liveKind,'psf');assert.equal(initial.liveEnabled,true);assert.equal(initial.liveVoice,0);
  assert.equal(initial.liveState,null);assert.equal(initial.liveFrame,null);assert.equal(initial.liveActive,false);assert.equal(initial.liveWaiting,false);
  assert.equal(initial.liveBufferedSnapshots,0);
  h.controller.setSource(source(),'song.psf');h.controller.setLiveVoice(23);h.controller.setLiveEnabled(false);h.controller.setLiveEnabled(true);
  assert.equal(h.controller.read().liveVoice,23);assert.deepEqual(h.machine.observations,[]);assert.deepEqual(h.machine.renders,[]);
  assert.equal(h.audioReads,0);assert.equal(h.beforeCalls,0);assert.equal(h.starts.length,0);assert.equal(h.outputs.length,0);
  for(const value of [-1,24,.5,'1'])assert.throws(()=>h.controller.setLiveVoice(value),RangeError);
  assert.throws(()=>h.controller.setLiveEnabled(1),TypeError);await h.controller.dispose();
});

test('Live shows pre-render state only when its native sample reaches the audible cursor',async()=>{
  const h=liveHarness({startDelaySeconds:.01});h.controller.setSource(source(),'song.psf');await h.controller.play();
  assert.deepEqual(h.machine.observations.map(value=>value.frame),[0,2205,4410,6615]);
  assert.equal(h.machine.nativeFrames,8192,'the emulator has rendered ahead of audible playback');
  let view=h.controller.read();assert.equal(view.liveFrame,0);assert.equal(view.positionSeconds,0);
  assert.equal(view.liveState.nativeFrames,0);assert.equal(view.liveActive,true);
  h.advance(441+2204);view=h.controller.read();assert.equal(view.liveFrame,0,'a 2205-frame snapshot cannot be displayed at frame 2204');
  h.advance(1);view=h.controller.read();assert.equal(view.liveFrame,2205);assert.equal(view.positionSeconds,2205/RATE);
  const snapshot=view.liveState,observations=h.machine.observations.length,renders=h.machine.renders.length,starts=h.starts.length;
  h.controller.setLiveVoice(23);view=h.controller.read();assert.equal(view.liveState,snapshot,'channel selection reuses one coherent all-voice snapshot');
  assert.equal(view.liveState.channels[23].pitch,2205+23);assert.equal(view.liveVoice,23);
  assert.equal(h.machine.observations.length,observations);assert.equal(h.machine.renders.length,renders);assert.equal(h.starts.length,starts);
  assert.equal(h.audioReads,1);assert.equal(h.beforeCalls,1);assert.equal(h.outputs.length,2);assert.equal(h.contextCloses,0);
  h.machine.observations[1].state.channels[23].pitch=999;
  assert.equal(h.controller.read().liveState.channels[23].pitch,2205+23,'core-returned mutable data is detached at capture');
  assert.ok(Object.isFrozen(snapshot)&&Object.isFrozen(snapshot.channels[23].waveform.pcm));
  assert.throws(()=>{snapshot.channels[23].pitch=999;},TypeError);
  assert.equal(h.controller.read().liveState,snapshot,'repeated reads do not clone the full state');
  await h.controller.dispose();
});

test('Live subdivisions preserve every scheduled PCM sample and AudioBuffer boundary',async()=>{
  const live=liveHarness(),off=liveHarness();off.controller.setLiveEnabled(false);
  for(const h of [live,off]){h.controller.setSource(source(),'song.psf');await h.controller.play();}
  assert.deepEqual(live.starts.flatMap(scheduledPcm),off.starts.flatMap(scheduledPcm));
  assert.deepEqual(live.starts.map(value=>[value.at,value.offset,value.duration,value.node.buffer.length]),
    off.starts.map(value=>[value.at,value.offset,value.duration,value.node.buffer.length]));
  assert.ok(live.machine.renders.some(frames=>frames<2048),'20 Hz snapshots subdivide renders within the same output buffers');
  assert.deepEqual(off.machine.renders,[2048,2048,2048,2048]);assert.equal(off.machine.observations.length,0);
  await live.controller.dispose();await off.controller.dispose();
});

test('Pause freezes the audible all-voice snapshot and Resume retains lookahead observations',async()=>{
  const h=liveHarness();h.controller.setSource(source(),'song.psf');await h.controller.play();h.advance(3000);h.controller.pause();
  const paused=h.controller.read(),snapshot=paused.liveState,renders=h.machine.renders.length,observations=h.machine.observations.length;
  assert.equal(paused.liveFrame,2205);assert.equal(paused.positionSeconds,3000/RATE);assert.equal(paused.liveActive,true);
  h.advance(RATE*100);h.controller.setLiveVoice(12);assert.equal(h.controller.read().liveState,snapshot);
  assert.equal(h.controller.read().liveState.channels[12].pitch,2217);assert.equal(h.controller.read().liveFrame,2205);
  assert.equal(h.machine.renders.length,renders);assert.equal(h.machine.observations.length,observations);
  assert.equal(await h.controller.resume(),true);assert.equal(h.controller.read().liveFrame,2205);
  assert.equal(h.beforeCalls,1);assert.equal(h.audioReads,1);assert.equal(h.outputs.length,2);
  h.advance(1410);assert.equal(h.controller.read().liveFrame,4410,'already-rendered resumed PCM retains its matching future observation');
  await h.controller.dispose();
});

test('Live Off performs no observations; On waits for a new boundary to become audible',async()=>{
  const h=liveHarness();h.controller.setLiveEnabled(false);h.controller.setSource(source(),'song.psf');await h.controller.play();
  const starts=h.starts.length,renders=h.machine.renders.length;
  h.controller.setLiveEnabled(true);let view=h.controller.read();
  assert.equal(view.liveWaiting,true);assert.equal(view.liveState,null);assert.equal(view.liveBufferedSnapshots,0);
  assert.equal(h.machine.observations.length,0);assert.equal(h.machine.renders.length,renders);assert.equal(h.starts.length,starts);
  h.refill();assert.equal(h.machine.observations.length,0,'On does not observe the current ahead-of-audio machine directly');
  h.advance(1);h.refill();view=h.controller.read();
  assert.equal(h.machine.observations[0].frame,8192);assert.equal(view.liveState,null);assert.equal(view.liveWaiting,true);
  assert.equal(view.liveBufferedSnapshots,1,'future state is buffered, not displayed');
  h.advance(8191);assert.equal(h.controller.read().liveFrame,8192);assert.equal(h.controller.read().liveActive,true);
  h.controller.setLiveEnabled(false);view=h.controller.read();assert.equal(view.liveState,null);assert.equal(view.liveBufferedSnapshots,0);
  const count=h.machine.observations.length;h.advance(3000);h.refill();assert.equal(h.machine.observations.length,count);
  assert.equal(h.controller.read().playing,true);assert.equal(h.machine.disposals,0);assert.equal(h.audioReads,1);
  await h.controller.dispose();
});

test('Off/On while paused may reuse only the one already-audible frozen snapshot',async()=>{
  const h=liveHarness();h.controller.setSource(source(),'song.psf');await h.controller.play();h.advance(3000);h.controller.pause();
  const snapshot=h.controller.read().liveState,count=h.machine.observations.length,renders=h.machine.renders.length;
  h.controller.setLiveEnabled(false);assert.equal(h.controller.read().liveState,null);assert.equal(h.controller.read().liveBufferedSnapshots,1);
  h.controller.setLiveVoice(23);h.controller.setLiveEnabled(true);
  assert.equal(h.controller.read().liveState,snapshot);assert.equal(h.controller.read().liveFrame,2205);assert.equal(h.controller.read().liveBufferedSnapshots,1);
  assert.equal(h.machine.observations.length,count);assert.equal(h.machine.renders.length,renders);
  await h.controller.resume();assert.equal(h.controller.read().liveFrame,2205,'resumed playback can retain the known audible predecessor');
  await h.controller.dispose();

  const off=liveHarness();off.controller.setLiveEnabled(false);off.controller.setSource(source(),'song.psf');await off.controller.play();
  off.advance(3000);off.controller.pause();off.controller.setLiveEnabled(true);
  assert.equal(off.controller.read().liveState,null,'pausing while Off cannot invent a matching old snapshot');
  assert.equal(off.controller.read().liveWaiting,true);assert.equal(off.machine.observations.length,0);await off.controller.dispose();
});

test('Live history stays bounded by lookahead rather than the duration of a song',async()=>{
  const h=liveHarness({chunkFrames:32768,lookaheadSeconds:1}),bound=Math.ceil((RATE+32768)/2205)+2;
  h.controller.setSource(source(),'song.psf');await h.controller.play();
  for(let second=0;second<90;second++) {
    const view=h.controller.read();assert.ok(view.liveBufferedSnapshots<=bound);
    assert.ok(view.liveFrame<=Math.round(view.positionSeconds*RATE),'bounded history never substitutes a future state');
    h.advance(RATE);h.refill();
  }
  const frames=h.machine.observations.map(value=>value.frame);
  assert.ok(frames.length>1000,'the fake song ran long enough to expose unbounded retention');
  assert.ok(frames.every((frame,index)=>!index||frame-frames[index-1]===2205),'capture cadence is capped at exactly 20 per native second');
  h.controller.setLiveEnabled(false);assert.equal(h.controller.read().liveBufferedSnapshots,0);assert.equal(h.controller.read().liveState,null);
  await h.controller.stop();assert.equal(h.controller.read().liveBufferedSnapshots,0);assert.equal(h.controller.read().liveFrame,null);
  await h.controller.dispose();
});

test('observation errors affect only Live, retry later and never stop song output',async()=>{
  const h=liveHarness(),observe=h.machine.observe;let broken=true;
  h.machine.observe=()=>{if(broken)throw new Error('snapshot unavailable');return observe();};
  h.controller.setSource(source(),'song.psf');assert.equal(await h.controller.play(),true);
  let view=h.controller.read();assert.equal(view.playing,true);assert.equal(view.error,false);assert.equal(view.liveError,true);
  assert.match(view.liveMessage,/snapshot unavailable/);assert.equal(view.liveState,null);assert.equal(h.machine.disposals,0);
  assert.ok(h.starts.every(value=>!value.node.stopped));assert.equal(h.outputs[0].disconnected,false);
  broken=false;h.advance(3000);h.refill();view=h.controller.read();
  assert.equal(view.playing,true);assert.equal(view.liveError,false);assert.equal(view.liveWaiting,true,'a valid future retry still waits for audible time');
  h.advance(5820);view=h.controller.read();assert.equal(view.liveFrame,8820);assert.equal(view.liveActive,true);
  await h.controller.dispose();

  for(const invalid of [state=>({...state,nativeFrames:state.nativeFrames+1}),state=>({...state,channels:state.channels.slice(1)})]) {
    const bad=liveHarness(),original=bad.machine.observe;bad.machine.observe=()=>invalid(original());
    bad.controller.setSource(source(),'song.psf');assert.equal(await bad.controller.play(),true);
    assert.equal(bad.controller.read().liveError,true);assert.match(bad.controller.read().liveMessage,/24 voices at the current native frame/);
    assert.equal(bad.controller.read().error,false);assert.equal(bad.machine.disposals,0);await bad.controller.dispose();
  }
});

test('Stop, source replacement, disposal and stale initialization clear Live ownership',async()=>{
  const h=liveHarness();h.controller.setSource(source(),'song.psf');await h.controller.play();assert.ok(h.controller.read().liveState);
  h.controller.setSource(source('new.psf'),'new.psf');let view=h.controller.read();
  assert.equal(view.name,'new.psf');assert.equal(view.liveState,null);assert.equal(view.liveBufferedSnapshots,0);assert.equal(view.liveActive,false);
  await h.controller.dispose();assert.equal(h.controller.read().liveState,null);assert.equal(h.controller.read().liveBufferedSnapshots,0);
  const pending=deferred(),machine=observedCore(),late=liveHarness({createCore:()=>pending.promise});
  late.controller.setSource(source(),'song.psf');const playing=late.controller.play();await late.controller.stop();pending.resolve(machine);
  assert.equal(await playing,false);assert.equal(machine.observations.length,0);assert.equal(late.controller.read().liveState,null);
  assert.equal(late.audioReads,0);await late.controller.dispose();
});

test('paused Capture uses the audible pre-render RAM, never the newer emulation lookahead',async()=>{
  const h=captureHarness();h.controller.setSource(source('folder/track.minipsf','RAM timing test'),'folder/track.minipsf');await h.controller.play();
  assert.deepEqual(h.machine.ramCopies,[0,2205,4410,6615]);
  assert.equal(ramFrame(h.machine.ram),8192,'the driver has already overwritten RAM at its later machine position');
  h.advance(3000);h.controller.pause();let view=h.controller.read();
  assert.equal(view.canCapture,true);assert.equal(view.captureFrame,2205);assert.match(view.captureMessage,/CH 1.*2205/);
  assertNoBinary(view);
  const renders=h.machine.renders.length,observes=h.machine.observations.length,copies=h.machine.ramCopies.length,starts=h.starts.length;
  const captured=h.controller.capturePaused();
  assert.equal(captured.state.nativeFrames,2205);assert.equal(captured.state.observation.nativeFrames,2205);assert.equal(captured.frame,2205);
  assert.equal(ramFrame(captured.ram),2205);assert.equal(captured.ram[0x2000],(2205*7+3)&255);
  assert.equal(captured.ram.length,RAM_BYTES);assert.equal(captured.voice,0);
  assert.deepEqual(captured.source,{entry:'folder/track.minipsf',title:'RAM timing test'});
  assert.equal(captured.state,view.liveState,'Capture and Live are the same coherent frozen register snapshot');
  h.machine.ram.fill(0xee);h.advance(RATE*10);h.controller.setLiveVoice(23);
  const other=h.controller.capturePaused();assert.equal(other.frame,2205);assert.equal(other.voice,23);assert.equal(ramFrame(other.ram),2205);
  assert.equal(other.state.channels[23].pitch,2228);assert.equal(other.state,captured.state);
  captured.ram.fill(0);captured.source.entry='changed.psf';
  const again=h.controller.capturePaused();assert.equal(ramFrame(again.ram),2205);assert.equal(again.source.entry,'folder/track.minipsf');
  assert.notEqual(again.ram,captured.ram,'each explicit Capture returns its own mutable RAM copy');
  assert.equal(h.machine.renders.length,renders);assert.equal(h.machine.observations.length,observes);assert.equal(h.machine.ramCopies.length,copies);
  assert.equal(h.starts.length,starts);assert.equal(h.audioReads,1);assert.equal(h.beforeCalls,1);assert.equal(h.outputs.length,2);assert.equal(h.machine.disposals,0);
  await h.controller.dispose();
});

test('Capture requires Pause and Live On, reuses one frozen RAM image across paused Off/On',async()=>{
  const h=captureHarness();assert.equal(h.controller.read().canCapture,false);assert.equal(h.controller.read().captureBufferedBytes,0);
  assert.throws(()=>h.controller.capturePaused(),/Play and pause/);
  h.controller.setSource(source(),'song.psf');await h.controller.play();
  assert.equal(h.controller.read().canCapture,false);assert.throws(()=>h.controller.capturePaused(),/Pause the PSF song/);
  h.advance(3000);h.controller.pause();const first=h.controller.capturePaused(),copies=h.machine.ramCopies.length;
  h.controller.setLiveEnabled(false);let view=h.controller.read();
  assert.equal(view.canCapture,false);assert.equal(view.captureFrame,null);assert.equal(view.captureBufferedBytes,RAM_BYTES);
  assert.throws(()=>h.controller.capturePaused(),/Turn PSF Live on/);
  h.controller.setLiveVoice(17);h.controller.setLiveEnabled(true);view=h.controller.read();
  assert.equal(view.canCapture,true);assert.equal(view.captureBufferedBytes,RAM_BYTES);assert.equal(view.captureFrame,2205);
  const again=h.controller.capturePaused();assert.equal(again.state,first.state);assert.deepEqual(again.ram,first.ram);assert.equal(again.voice,17);
  assert.equal(h.machine.ramCopies.length,copies,'Off/On, channel selection and Capture cannot ask the advanced core for new RAM');
  await h.controller.resume();assert.equal(h.controller.read().canCapture,false);assert.throws(()=>h.controller.capturePaused(),/Pause the PSF song/);
  await h.controller.stop();assert.equal(h.controller.read().captureBufferedBytes,0);assert.equal(h.controller.read().canCapture,false);
  assert.throws(()=>h.controller.capturePaused(),/Play and pause/);await h.controller.dispose();
});

test('Live Off copies no RAM, and an On snapshot cannot be captured before its samples are audible',async()=>{
  const h=captureHarness();h.controller.setLiveEnabled(false);h.controller.setSource(source(),'song.psf');await h.controller.play();
  h.advance(100);h.refill();assert.equal(h.machine.ramCopies.length,0);assert.equal(h.controller.read().captureBufferedBytes,0);
  h.controller.pause();h.controller.setLiveEnabled(true);let view=h.controller.read();
  assert.equal(view.canCapture,false);assert.equal(view.captureFrame,null);assert.match(view.captureMessage,/No matching audible/);
  assert.throws(()=>h.controller.capturePaused(),/No matching audible/);assert.equal(h.machine.ramCopies.length,0);
  await h.controller.resume();h.advance(2205);h.refill();
  assert.ok(h.machine.ramCopies.length>0);const next=h.machine.ramCopies[0];
  h.controller.pause();view=h.controller.read();assert.equal(view.canCapture,false,'a future-only RAM image cannot be captured at the paused cursor');
  assert.ok(next>Math.round(view.positionSeconds*RATE));
  await h.controller.resume();h.advance(next-Math.round(h.controller.read().positionSeconds*RATE));h.controller.pause();
  assert.equal(h.controller.read().canCapture,true);assert.equal(h.controller.capturePaused().frame,next);
  await h.controller.dispose();
});

test('RAM snapshot failures and unsupported cores disable Capture without affecting Live or audio',async()=>{
  const invalid=[
    {copy:undefined,reason:/does not expose RAM snapshots/},
    {copy:()=>{throw new Error('RAM copy failed');},reason:/RAM copy failed/},
    {copy:()=>new Uint8Array(RAM_BYTES-1),reason:/exactly 512 KiB/},
    {copy:()=>new Uint8Array(RAM_BYTES+1),reason:/exactly 512 KiB/},
    {copy:()=>new Uint16Array(RAM_BYTES/2),reason:/Uint8Array/},
    {copy:()=>new ArrayBuffer(RAM_BYTES),reason:/Uint8Array/},
    {copy:()=>Promise.resolve(new Uint8Array(RAM_BYTES)),reason:/Uint8Array/},
  ];
  for(const {copy,reason} of invalid) {
    const h=captureHarness();h.machine.copySpuRam=copy;h.controller.setSource(source(),'song.psf');
    assert.equal(await h.controller.play(),true);h.advance(3000);h.controller.pause();const view=h.controller.read();
    assert.equal(view.canCapture,false);assert.equal(view.captureFrame,2205);assert.match(view.captureMessage,reason);
    assert.throws(()=>h.controller.capturePaused(),reason);assert.equal(view.captureBufferedBytes,0);
    assert.equal(view.liveActive,true);assert.equal(view.liveError,false);assert.equal(view.error,false);assert.equal(h.machine.disposals,0);
    assert.equal(view.liveState.nativeFrames,2205);assertNoBinary(view);await h.controller.dispose();
  }
});

test('Capture availability follows each audible RAM image, not a later RAM-copy error',async()=>{
  const h=captureHarness(),copy=h.machine.copySpuRam;
  h.machine.copySpuRam=()=>{if(h.machine.nativeFrames>=4410)throw new Error('future snapshot failed');return copy();};
  h.controller.setSource(source(),'song.psf');await h.controller.play();h.advance(3000);h.controller.pause();
  assert.equal(h.controller.read().canCapture,true);assert.equal(h.controller.capturePaused().frame,2205);
  await h.controller.resume();h.advance(1500);h.controller.pause();const view=h.controller.read();
  assert.equal(view.captureFrame,4410);assert.equal(view.liveFrame,4410);assert.equal(view.canCapture,false);
  assert.match(view.captureMessage,/future snapshot failed/);assert.equal(view.liveError,false);assert.equal(view.liveActive,true);
  await h.controller.dispose();
});

test('private Capture RAM retention is bounded by lookahead and released by Off, source replacement and disposal',async()=>{
  const h=captureHarness({lookaheadSeconds:.2,onUpdate:()=>{}}),bound=(Math.ceil((.2*RATE+2048)/2205)+3)*RAM_BYTES;
  assert.equal(bound,4*1024*1024,'default retention including one paused predecessor is at most 4 MiB');
  h.controller.setSource(source(),'song.psf');await h.controller.play();
  for(let step=0;step<60;step++) {
    const view=h.controller.read();assert.ok(view.captureBufferedBytes<=bound);assert.equal(view.captureBufferedBytes%RAM_BYTES,0);
    assert.ok(view.captureBufferedBytes<=view.liveBufferedSnapshots*RAM_BYTES);
    h.advance(4410);h.refill();
  }
  assert.ok(h.machine.ramCopies.length>100);h.controller.pause();assert.ok(h.controller.read().captureBufferedBytes<=bound);
  h.controller.setLiveEnabled(false);assert.equal(h.controller.read().captureBufferedBytes,RAM_BYTES,'paused Off retains only its already-audible image');
  h.controller.setSource(source('new.psf'),'new.psf');assert.equal(h.controller.read().captureBufferedBytes,0);assert.equal(h.controller.read().canCapture,false);
  assert.throws(()=>h.controller.capturePaused(),/Play and pause/);await h.controller.dispose();assert.equal(h.controller.read().captureBufferedBytes,0);

  const large=captureHarness({chunkFrames:32768,lookaheadSeconds:1,onUpdate:()=>{}}),largeBound=(Math.ceil((RATE+32768)/2205)+3)*RAM_BYTES;
  large.controller.setSource(source(),'song.psf');await large.controller.play();assert.ok(large.controller.read().captureBufferedBytes<=largeBound);
  large.controller.setLiveEnabled(false);assert.equal(large.controller.read().captureBufferedBytes,0);await large.controller.dispose();
});

test('oversized RAM backing buffers are normalized to the bounded image and stale initialization never captures RAM',async()=>{
  const h=captureHarness();h.machine.copySpuRam=()=>{
    const backing=new Uint8Array(RAM_BYTES*3),view=backing.subarray(RAM_BYTES,RAM_BYTES*2);
    new DataView(view.buffer,view.byteOffset,view.byteLength).setUint32(0,h.machine.nativeFrames,true);return view;
  };
  h.controller.setSource(source(),'song.psf');await h.controller.play();h.advance(3000);h.controller.pause();
  const captured=h.controller.capturePaused();assert.equal(ramFrame(captured.ram),2205);assert.equal(captured.ram.buffer.byteLength,RAM_BYTES);
  assert.equal(h.controller.read().captureBufferedBytes,h.controller.read().liveBufferedSnapshots*RAM_BYTES);await h.controller.dispose();
  const pending=deferred(),machine=capturingCore(),late=captureHarness({createCore:()=>pending.promise});
  late.controller.setSource(source(),'song.psf');const playing=late.controller.play();await late.controller.stop();pending.resolve(machine);
  assert.equal(await playing,false);assert.equal(machine.ramCopies.length,0);assert.equal(late.controller.read().captureBufferedBytes,0);
  assert.equal(late.controller.read().canCapture,false);assert.throws(()=>late.controller.capturePaused(),/Play and pause/);await late.controller.dispose();
});

test('selected-channel monitor defaults Off, captures all stems in one pass and retains its desired mode across sources',async()=>{
  const h=monitorHarness();assert.equal(h.controller.read().monitorEnabled,false);assert.equal(h.controller.read().monitorAvailable,false);
  await h.controller.setMonitorEnabled(true);h.controller.setLiveVoice(23);
  assert.equal(h.audioReads,0);assert.equal(h.starts.length,0);
  h.controller.setSource(source(),'song.psf');await h.controller.play();
  const view=h.controller.read();assert.equal(view.monitorEnabled,true);assert.equal(view.monitorAvailable,true);assert.equal(view.monitorVoice,23);
  assert.equal(view.monitorSwitching,false);assert.equal(h.outputs.length,2);
  assert.deepEqual(scheduledPcm(h.starts[0]).slice(0,4),[2400000,2400001,2400002,2400003]);
  assert.equal(h.machine.voiceParts.reduce((frames,part)=>frames+part.frames,0),h.machine.nativeFrames,'there is one native rendering pass, including Live subdivisions');
  assert.equal(h.machine.renders.length,h.machine.voiceParts.length);
  await h.controller.stop();assert.equal(h.controller.read().monitorEnabled,true);assert.equal(h.controller.read().monitorBufferedBytes,0);
  h.controller.setSource(source('next.psf'),'next.psf');assert.equal(h.controller.read().monitorEnabled,true);
  await h.controller.dispose();
});

test('monitor switching retains the exact first unconsumed frame, original full mix and shared Live state',async()=>{
  const h=monitorHarness();h.controller.setSource(source(),'song.psf');await h.controller.play();h.advance(3000);
  const before=h.controller.read(),starts=h.starts.length,original=h.starts[1].node.buffer;
  const switching=h.controller.setMonitorEnabled(true);assert.equal(h.controller.read().playing,true);assert.equal(h.controller.read().monitorSwitching,true);
  await h.finishFade();assert.equal(await switching,true);
  let view=h.controller.read();assert.equal(view.positionSeconds,3441/RATE);assert.equal(view.liveFrame,2205);
  assert.equal(view.liveState,before.liveState);assert.equal(view.monitorVoice,0);assert.equal(view.monitorSwitching,false);
  assert.equal(h.starts[starts].offset,1393/RATE);assert.equal(scheduledPcm(h.starts[starts])[0],103441);
  assert.notEqual(h.starts[starts].node.buffer,original);assert.equal(h.starts[1].node.stopped,true);
  const selectedStarts=h.starts.length,full=h.controller.setMonitorEnabled(false);await h.finishFade();assert.equal(await full,true);
  view=h.controller.read();assert.equal(view.positionSeconds,3882/RATE);assert.equal(view.monitorVoice,null);
  assert.equal(h.starts[selectedStarts].node.buffer,original,'Off reuses the original full song AudioBuffer, including its wet mix');
  assert.equal(scheduledPcm(h.starts[selectedStarts])[0],3882);
  assert.equal(h.audioReads,1);assert.equal(h.beforeCalls,1);assert.equal(h.machine.disposals,0);await h.controller.dispose();
});

test('rapid monitor On/Off and channel changes coalesce to the latest desired channel without moving a paused source',async()=>{
  const h=monitorHarness();h.controller.setSource(source(),'song.psf');await h.controller.play();h.advance(3000);h.controller.pause();
  const frozen=h.controller.read(),native=h.machine.nativeFrames,starts=h.starts.length;
  const first=h.controller.setMonitorEnabled(true);h.controller.setLiveVoice(7);
  const off=h.controller.setMonitorEnabled(false);h.controller.setLiveVoice(17);const last=h.controller.setMonitorEnabled(true);h.controller.setLiveVoice(23);
  await h.finishFade();assert.equal(await first,true);assert.equal(await off,true);assert.equal(await last,true);
  const view=h.controller.read();assert.equal(view.paused,true);assert.equal(view.monitorVoice,23);assert.equal(view.monitorSwitching,false);
  assert.equal(view.positionSeconds,frozen.positionSeconds);assert.equal(view.liveState,frozen.liveState);assert.equal(view.captureFrame,frozen.captureFrame);
  assert.equal(h.machine.nativeFrames,native);assert.equal(h.starts.length,starts);
  await h.controller.resume();assert.equal(scheduledPcm(h.starts[starts])[0],2403000);
  await h.controller.dispose();
});

test('On then Off before a fade settles reschedules the next original full-mix frame without applying a stale channel',async()=>{
  const h=monitorHarness();h.controller.setSource(source(),'song.psf');await h.controller.play();h.advance(3000);
  const count=h.starts.length,first=h.controller.setMonitorEnabled(true),last=h.controller.setMonitorEnabled(false);
  await h.finishFade();assert.equal(await first,true);assert.equal(await last,true);
  const view=h.controller.read();assert.equal(view.monitorEnabled,false);assert.equal(view.monitorVoice,null);assert.equal(view.monitorSwitching,false);
  assert.equal(scheduledPcm(h.starts[count])[0],3441);assert.equal(view.positionSeconds,3441/RATE);
  assert.equal(view.monitorBufferedBytes% (2048*48*4),0,'no selected stereo cache was allocated for an abandoned request');await h.controller.dispose();
});

test('Pause during a pending fade freezes position and Resume awaits the latest selected route',async()=>{
  const h=monitorHarness();h.controller.setSource(source(),'song.psf');await h.controller.play();h.advance(3000);
  const switching=h.controller.setMonitorEnabled(true);h.advance(50);h.controller.pause();const paused=h.controller.read();
  h.controller.setLiveVoice(5);const count=h.starts.length,resuming=h.controller.resume();
  assert.equal(h.controller.read().resuming,true);assert.equal(h.starts.length,count);
  await h.finishFade();assert.equal(await switching,true);assert.equal(await resuming,true);
  const view=h.controller.read();assert.equal(view.playing,true);assert.equal(view.monitorVoice,5);assert.equal(view.positionSeconds,paused.positionSeconds);
  assert.equal(scheduledPcm(h.starts[count])[0],603050);assert.equal(view.liveFrame,paused.liveFrame);await h.controller.dispose();
});

test('Stop while Resume awaits a selected-route fade cannot schedule any stale retained PCM',async()=>{
  const h=monitorHarness();h.controller.setSource(source(),'song.psf');await h.controller.play();h.advance(3000);h.controller.pause();
  const switching=h.controller.setMonitorEnabled(true),resuming=h.controller.resume(),count=h.starts.length;
  assert.equal(h.controller.read().resuming,true);await h.controller.stop();
  assert.equal(await switching,false);assert.equal(await resuming,false);await h.finishFade();
  assert.equal(h.starts.length,count);assert.equal(h.controller.read().playing,false);assert.equal(h.machine.disposals,1);await h.controller.dispose();
});

test('changing selected channel replaces one cached stereo buffer and repeating the same channel is a no-op',async()=>{
  const h=monitorHarness();await h.controller.setMonitorEnabled(true);h.controller.setSource(source(),'song.psf');await h.controller.play();h.advance(3000);h.controller.pause();
  const originalCount=h.starts.length,native=h.machine.nativeFrames,bytes=h.controller.read().monitorBufferedBytes;
  h.controller.setLiveVoice(0);assert.equal(h.controller.read().monitorSwitching,false);assert.equal(h.fadeTimers.size,0);
  h.controller.setLiveVoice(3);await h.finishFade();assert.equal(h.controller.read().monitorVoice,3);
  assert.equal(h.machine.nativeFrames,native);assert.equal(h.starts.length,originalCount);
  await h.controller.resume();assert.equal(scheduledPcm(h.starts[originalCount])[0],403000);
  assert.ok(h.controller.read().monitorBufferedBytes<=bytes+4096*(48*4+8),'CH selection replaces its cache instead of retaining 24 stereo AudioBuffers');
  assert.equal(h.outputs.length,2);await h.controller.dispose();
});

test('monitor switching never reads mutable reused native stem memory after a chunk is accepted',async()=>{
  const h=monitorHarness();h.controller.setSource(source(),'song.psf');await h.controller.play();h.advance(3000);h.controller.pause();
  for(const part of h.machine.voiceParts)part.voices.fill(-999);
  h.controller.setLiveVoice(2);const switching=h.controller.setMonitorEnabled(true);await h.finishFade();await switching;
  const count=h.starts.length;await h.controller.resume();assert.equal(scheduledPcm(h.starts[count])[0],303000);
  await h.controller.dispose();
});

test('Live Off only disables observations and does not disable selected-channel listening',async()=>{
  const h=monitorHarness();await h.controller.setMonitorEnabled(true);h.controller.setSource(source(),'song.psf');await h.controller.play();
  h.controller.setLiveEnabled(false);const observations=h.machine.observations.length;
  h.advance(3000);h.refill();assert.equal(h.machine.observations.length,observations);
  assert.equal(h.controller.read().monitorVoice,0);assert.equal(h.controller.read().monitorEnabled,true);assert.equal(h.controller.read().liveState,null);
  h.controller.pause();h.controller.setLiveVoice(12);await h.finishFade();const count=h.starts.length;await h.controller.resume();
  assert.equal(scheduledPcm(h.starts[count])[0],1303000);await h.controller.dispose();
});

test('legacy render-only engines keep full song playback when selected listening is requested',async()=>{
  const h=monitorHarness({createCore:async()=>core()});await h.controller.setMonitorEnabled(true);h.controller.setSource(source(),'song.psf');
  assert.equal(await h.controller.play(),true);let view=h.controller.read();
  assert.equal(view.monitorEnabled,true);assert.equal(view.monitorAvailable,false);assert.equal(view.monitorVoice,null);assert.equal(view.monitorError,true);
  assert.match(view.monitorMessage,/unavailable/);assert.equal(view.error,false);assert.equal(view.playing,true);assert.equal(view.monitorBufferedBytes,0);
  assert.deepEqual(scheduledPcm(h.starts[0]).slice(0,4),[0,1,2,3]);await h.controller.setMonitorEnabled(false);
  view=h.controller.read();assert.equal(view.monitorError,false);assert.equal(view.playing,true);await h.controller.dispose();
});

test('invalid stem length or nonfinite samples disable only selected listening, preserving valid full PCM',async()=>{
  for(const invalid of [new Float32Array(1),new Float32Array(2048*48).fill(NaN)]) {
    const h=monitorHarness(),render=h.machine.renderWithVoices;
    h.machine.renderWithVoices=frames=>({...render(frames),voices:invalid});
    h.controller.setSource(source(),'song.psf');assert.equal(await h.controller.play(),true);
    let view=h.controller.read();assert.equal(view.playing,true);assert.equal(view.error,false);assert.equal(view.monitorError,true);assert.equal(view.monitorAvailable,false);
    assert.equal(view.monitorBufferedBytes,0);assert.deepEqual(scheduledPcm(h.starts[0]).slice(0,4),[0,1,2,3]);
    await h.controller.setMonitorEnabled(true);view=h.controller.read();assert.equal(view.monitorVoice,null);assert.equal(view.playing,true);await h.controller.dispose();
  }
});

test('Stop/source/dispose invalidate an old fader before a later song can acquire the shared bus',async()=>{
  for(const action of ['stop','source','dispose']) {
    const h=monitorHarness();h.controller.setSource(source(),'song.psf');await h.controller.play();
    const old=h.faders[0],oldGate=h.outputs[1],switching=h.controller.setMonitorEnabled(true);
    if(action==='stop')await h.controller.stop();
    else if(action==='source')h.controller.setSource(source('new.psf'),'new.psf');
    else await h.controller.dispose();
    assert.equal(old.getContext(),null);assert.equal(old.getGain(),null);assert.equal(await switching,false);
    assert.equal(h.controller.read().monitorSwitching,false);assert.equal(h.controller.read().monitorBufferedBytes,0);assert.ok(oldGate.disconnected);
    if(action!=='dispose') {
      if(action==='stop')h.controller.setSource(source('new.psf'),'new.psf');
      await h.controller.play();const newest=h.outputs.at(-1),events=newest.gain.events.length,count=h.starts.length;
      old.output.open();old.output.dispose();await h.finishFade();
      assert.equal(newest.gain.events.length,events,'stale fader cannot automate the newer run');assert.equal(h.starts.length,count);
    }
    await h.controller.dispose();
  }
});

test('retained all24 stems and one selected buffer stay bounded by lookahead, not song duration',async()=>{
  const h=monitorHarness();await h.controller.setMonitorEnabled(true);h.controller.setSource(source(),'song.psf');await h.controller.play();
  const bound=(8192+2048*2)*(48*4+8);
  for(let step=0;step<70;step++) {
    assert.ok(h.controller.read().monitorBufferedBytes>0);assert.ok(h.controller.read().monitorBufferedBytes<=bound);
    h.advance(3000);h.refill();
  }
  assert.equal(h.outputs.length,2);await h.controller.stop();assert.equal(h.controller.read().monitorBufferedBytes,0);
  await h.controller.dispose();
});

test('selected listening uses the existing 8ms close and 4ms open fader without automating Master',async()=>{
  const h=monitorHarness({startDelaySeconds:.01});h.controller.setSource(source(),'song.psf');await h.controller.play();h.advance(3000);
  const at=h.audio.context.currentTime,count=h.starts.length,switched=h.controller.setMonitorEnabled(true),events=h.outputs[1].gain.events;
  assert.deepEqual(events.slice(0,3),[['cancel',at],['set',1,at],['ramp',0,at+.008]]);
  assert.equal(h.outputs[0].gain.events.length,0);await h.finishFade();await switched;
  const ramp=events.at(-1);assert.equal(ramp[0],'ramp');assert.equal(ramp[1],1);
  const firstAt=h.starts[count].at,openStart=events.at(-2);
  assert.ok(firstAt>=h.audio.context.currentTime+.01-1e-12);assert.deepEqual(openStart,['set',0,firstAt]);
  assert.ok(Math.abs(ramp[2]-(firstAt+.004))<1e-12,'the new source starts at gain zero, then ramps for four milliseconds');
  assert.equal(h.outputs[0].gain.value,.25);assert.equal(h.contextCloses,0);await h.controller.dispose();
  await assert.rejects(h.controller.setMonitorEnabled(1),TypeError);
});

test('Resume after a paused monitor switch anchors its gate fade to retained PCM scheduling, including slow refill',async()=>{
  const h=monitorHarness({startDelaySeconds:.01});h.controller.setSource(source(),'song.psf');await h.controller.play();h.advance(3000);h.controller.pause();
  const switching=h.controller.setMonitorEnabled(true);await h.finishFade();await switching;
  const count=h.starts.length,render=h.machine.renderWithVoices;
  h.machine.renderWithVoices=frames=>{const result=render(frames);h.advance(1000);return result;};
  const before=h.audio.context.currentTime;await h.controller.resume();
  assert.ok(h.audio.context.currentTime>before,'slow native generation advances the host clock before sources are scheduled');
  const firstAt=h.starts[count].at,events=h.outputs[1].gain.events;
  assert.ok(firstAt>=h.audio.context.currentTime+.01-1e-12);assert.deepEqual(events.at(-2),['set',0,firstAt]);
  assert.deepEqual(events.at(-1),['ramp',1,firstAt+.004]);assert.equal(h.outputs[0].gain.events.length,0);await h.controller.dispose();
});

test('Pause before a selected source onset then Resume reanchors an already-opening gate to the fresh source',async()=>{
  const h=monitorHarness({startDelaySeconds:.01});h.controller.setSource(source(),'song.psf');await h.controller.play();h.advance(3000);
  const count=h.starts.length,switching=h.controller.setMonitorEnabled(true);await h.finishFade();await switching;
  const old=h.starts[count],events=h.outputs[1].gain.events;
  assert.ok(h.audio.context.currentTime<old.at,'the old source and its gate ramp have not started yet');
  assert.deepEqual(events.at(-2),['set',0,old.at]);h.controller.pause();const paused=h.controller.read(),native=h.machine.nativeFrames;
  h.advance(88);assert.ok(h.audio.context.currentTime<old.at,'the gate remains in its opening state');
  const next=h.starts.length;await h.controller.resume();const fresh=h.starts[next];
  assert.equal(old.node.stopped,true);assert.ok(fresh.at>old.at);assert.equal(h.controller.read().positionSeconds,paused.positionSeconds);
  assert.equal(h.machine.nativeFrames,native,'Resume reuses the exact retained PCM');
  assert.deepEqual(events.at(-2),['set',0,fresh.at]);assert.deepEqual(events.at(-1),['ramp',1,fresh.at+.004]);
  assert.equal(h.outputs[0].gain.events.length,0);await h.controller.dispose();
});

// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {createPsfSongPreview} from './psf_song_preview.js';

const RATE=44100;
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
    createGain(){const output={gain:{value:1},connected:null,disconnected:false,
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
    const frame=machine.nativeFrames,state={sampleRate:RATE,nativeSampleRate:RATE,nativeFrames:frame,
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
  assert.equal(h.outputs.length,1);assert.equal(h.outputs[0].gain.value,.25);
  assert.equal(h.outputs[0].connected,h.audio.gain);assert.equal(h.starts[0].node.output,h.outputs[0]);
  await h.controller.stop();
  assert.ok(h.outputs[0].disconnected);assert.ok(h.starts.every(item=>item.node.stopped));
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
  assert.equal(h.audioReads,1);assert.equal(h.beforeCalls,1);assert.equal(h.outputs.length,1);assert.equal(h.contextCloses,0);
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
  assert.equal(h.beforeCalls,1);assert.equal(h.audioReads,1);assert.equal(h.outputs.length,1);
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

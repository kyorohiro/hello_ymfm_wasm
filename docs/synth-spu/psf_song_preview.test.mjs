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
  return {sampleRate:RATE,renders,get disposals(){return disposals;},
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

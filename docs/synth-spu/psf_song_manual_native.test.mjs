// Same-machine PSF manual conformance. Native PCM is compared as numeric
// arrays; no browser or physical audio device is created.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createPsfSongPreview} from './psf_song_preview.js';
import {createPsfPlaybackCore} from './psf_playback_core.js';
import {preparePsfSongSource} from './psf_song_source.js';
import {readPsfFileSet} from '../playground/playground_ps1_psf.js';
import {createPsfPlaybackFixture} from '../../test/helpers/spu_psf_playback_fixture.mjs';

const RATE=44100;
const fixture=createPsfPlaybackFixture(),set=await readPsfFileSet(fixture.standaloneFiles);
const image=await preparePsfSongSource(set,'standalone.psf');
const wasmBinary=await readFile(new URL('../generated/psf-player/psf_player.wasm',import.meta.url));
const create=()=>createPsfPlaybackCore({image,wasmBinary});
function harness() {
  const timers=new Map(),starts=[],cores=[];let serial=0;
  const context={currentTime:0,state:'running',
    createGain:()=>({gain:{value:1},connect(){},disconnect(){}}),
    createBuffer(channels,length,sampleRate){const data=Array.from({length:channels},()=>new Float32Array(length));return {length,sampleRate,getChannelData:ch=>data[ch]};},
    createBufferSource(){const node={buffer:null,stopped:false,connect(){},disconnect(){},stop(){this.stopped=true;},start(at,offset,duration){starts.push({node,at,offset,duration});}};return node;},
  },audio={context,gain:{authored:true},resume:async()=>{}};
  const preview=createPsfSongPreview({getAudio:()=>audio,createCore:async()=>{const core=await create();cores.push(core);return core;},
    schedule:callback=>{timers.set(++serial,callback);return serial;},cancel:id=>timers.delete(id),
    createOutput:()=>({fadeOut:async()=>true,open(){},dispose(){}}),chunkFrames:1024,lookaheadSeconds:4096/RATE,startDelaySeconds:0});
  preview.setSource(set,'standalone.psf');
  return {preview,cores,starts,context,advance:frames=>{context.currentTime+=frames/RATE;},
    pump(){const first=timers.entries().next().value;assert(first);timers.delete(first[0]);first[1]();}};
}
function rendered(starts) {
  const values=[];
  for(const {node,offset,duration}of starts) {
    const first=Math.round(offset*RATE),end=first+Math.round(duration*RATE),left=node.buffer.getChannelData(0),right=node.buffer.getChannelData(1);
    for(let frame=first;frame<end;frame++)values.push(left[frame],right[frame]);
  }
  return Float32Array.from(values);
}

test('native buffered PSF playback without hand input is bit-exact before and after Pause/Resume',async()=>{
  const h=harness(),reference=await create();
  try {
    assert(await h.preview.play());assert(h.preview.read().manualAvailable);
    const initial=reference.render(4096);assert.deepEqual(rendered(h.starts),initial);
    h.advance(2300);assert(h.preview.pause());const paused=h.preview.capturePaused(),count=h.starts.length;
    assert.equal(paused.frame,2205);assert.equal(h.cores[0].observe().nativeFrames,4096);
    assert(await h.preview.resume());
    const future=reference.render(3072),all=new Float32Array(7168*2);all.set(initial);all.set(future,initial.length);
    assert.deepEqual(rendered(h.starts.slice(count)),all.slice(2300*2));
    assert.equal(h.cores[0].observe().nativeFrames,7168);assert.equal(h.preview.read().error,false);
  }finally{await h.preview.dispose();reference.dispose();}
});

test('native selected voice edits preserve queued audio, RAM, phase, gate and all other voices until their render boundary',async()=>{
  const h=harness(),reference=await create();
  try {
    await h.preview.play();reference.render(4096);const core=h.cores[0],before=core.observe(),ram=core.copySpuRam(),scheduled=rendered(h.starts);
    const patch={volumeLeft:0,volumeRight:0,envelope:{releaseRate:13}};
    h.preview.editVoice(0,patch);reference.manual.edit(0,patch);
    const after=core.observe();
    assert.equal(after.nativeFrames,before.nativeFrames);assert.equal(after.channels[0].gate,before.channels[0].gate);
    assert.equal(after.channels[0].envelope,before.channels[0].envelope);assert.equal(after.channels[0].pitch,before.channels[0].pitch);
    assert.equal(after.channels[0].startAddress,before.channels[0].startAddress);assert.equal(after.channels[0].repeatAddress,before.channels[0].repeatAddress);
    assert.deepEqual(after.channels.slice(1),before.channels.slice(1));assert.deepEqual(after.reverb,before.reverb);assert.deepEqual(core.copySpuRam(),ram);
    assert.deepEqual(rendered(h.starts),scheduled);assert(h.starts.every(item=>!item.node.stopped));
    assert.equal(h.preview.read().liveState.nativeFrames,0,'render-head edit is not exposed as already audible');
    const count=h.starts.length;h.advance(4096);h.pump();
    assert.deepEqual(rendered(h.starts.slice(count)),reference.render(4096));
    assert(rendered(h.starts.slice(count)).every(value=>value===0),'only the selected audible source is muted');
    assert.equal(h.preview.read().liveFrame,2205,'the original 20 Hz cadence is retained across the manual boundary');
    h.advance(314);assert.equal(h.preview.read().liveFrame,4410);assert.equal(h.preview.read().liveState.channels[0].volumeLeft,0);
  }finally{await h.preview.dispose();reference.dispose();}
});

test('native manual keys and Pitch share one core while stale key-up and paused audition leave queued source audio intact',async()=>{
  const h=harness();
  try {
    await h.preview.play();const core=h.cores[0],frame=core.observe().nativeFrames,scheduled=rendered(h.starts);
    assert(h.preview.describeVoice(0).playable);
    h.preview.noteOn('older',0,72,{referenceMidi:60});assert.equal(core.observe().channels[0].pitch,8192);
    const newer=h.preview.noteOn('newer',0,60,{referenceMidi:60});assert.equal(newer.stolenId,'older');
    assert.equal(core.observe().channels[0].pitch,4096,'successive keys use source tuning rather than compound hand pitch');
    assert(h.preview.setPitchBend(12));assert.equal(core.observe().channels[0].pitch,8192);
    assert.equal(h.preview.noteOff('older'),false);assert(core.observe().channels[0].gate);
    h.advance(2300);assert(h.preview.pause());const count=h.starts.length,paused=h.preview.capturePaused();
    assert.equal(core.observe().nativeFrames,frame);assert.equal(core.observe().channels[0].gate,false);
    assert.equal(h.preview.noteOff('newer'),false);assert.equal(h.preview.setPitchBend(0),false);
    assert.deepEqual(h.preview.capturePaused(),paused);assert.deepEqual(rendered(h.starts),scheduled);
    await h.preview.resume();
    assert.deepEqual(rendered(h.starts.slice(count,count+1)),scheduled.slice(2300*2,3072*2));
    assert.equal(h.cores.length,1);assert.equal(h.preview.read().playing,true);
  }finally{await h.preview.dispose();}
});

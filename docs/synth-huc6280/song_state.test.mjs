// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import factory from '../generated/huc6280_wasm.js';
import {Huc6280AudioEngine} from '../js/huc6280audioengine.js';
import {VgmPlayer} from '../js/vgmplayer.js';
import {createHuc6280RegisterState,createHuc6280SongTimeline} from './song_state.js';
import {fixtures,wave} from './song_test_helpers.mjs';
function core(){return {selectedChannel:0,writes:[],cursor:0,reset(){this.selectedChannel=0;this.cursor=0;},
  writeHuc6280(r,v){this.writes.push([r,v]);if(r===0)this.selectedChannel=v&7;},
  writeHuc6280Stream(port,r,v){const old=this.selectedChannel;if(port!==255)this.writeHuc6280(r>>>4,port);this.writeHuc6280(r&15,v);if(port!==255)this.writeHuc6280(r>>>4,old);},
  processFrames(frames){const left=new Float32Array(frames),right=new Float32Array(frames);for(let i=0;i<frames;i++)left[i]=right[i]=this.cursor++;return{left,right};}};}
const upload=(target,ch,values=wave)=>{target.writeHuc6280(0,ch);target.writeHuc6280(4,64);target.writeHuc6280(4,0);for(const value of values)target.writeHuc6280(6,value);};

test('initial RAM/registers are unknown; only a recorded DDA reset and complete upload establishes a waveform',()=>{
  const state=createHuc6280RegisterState();let snapshot=state.snapshot();
  assert(snapshot.globals.every(value=>value===null));assert(snapshot.waveforms.every(values=>values.every(value=>value===null)));
  assert(snapshot.indices.every(value=>value===null));assert.equal(snapshot.selectedChannel,null);
  const write=(r,v)=>state.write(r,v);write(0,2);write(4,0);for(const value of wave)write(6,value);
  assert(state.snapshot().waveforms[2].every(value=>value===null),'unknown upload pointer is not fabricated');
  write(4,64);write(4,0);for(const value of wave)write(6,value);
  snapshot=state.snapshot();assert.deepEqual(snapshot.waveforms[2],wave);assert.equal(snapshot.indices[2],0);
  assert(Object.isFrozen(snapshot.waveforms[2]));assert.throws(()=>{snapshot.waveforms[2][0]=31;},TypeError);
  state.reset();assert(state.snapshot().waveforms[2].every(value=>value===null));
});

test('playback makes phase unknown while preserving configured RAM; an unknown-index live write invalidates RAM safely',()=>{
  const state=createHuc6280RegisterState(),adapter={writeHuc6280:(r,v)=>state.write(r,v)};upload(adapter,0);
  state.write(4,159);state.advance(100,1);assert.equal(state.snapshot().indices[0],null);
  assert.deepEqual(state.snapshot().waveforms[0],wave,'playing does not erase known configured RAM');
  state.write(6,12,100);assert(state.snapshot().waveforms[0].every(value=>value===null));
  state.write(4,64,100);state.write(4,0,100);for(const value of wave)state.write(6,value,100);
  assert.deepEqual(state.snapshot().waveforms[0],wave);
  upload(adapter,1);state.write(0,0);state.write(4,159);state.write(9,1);state.advance(100,101);
  assert.equal(state.snapshot().indices[1],null,'the LFO carrier advances CH2 even if its audible gate is off');
});

test('heard-time snapshots exclude prefetched future registers, DAC values and RAM uploads',()=>{
  const engine=core(),timeline=createHuc6280SongTimeline(engine);upload(engine,0);engine.writeHuc6280(2,100);engine.writeHuc6280(4,159);
  engine.processFrames(256);engine.writeHuc6280(2,200);engine.writeHuc6280(4,223);engine.writeHuc6280(6,31);engine.processFrames(256);
  let snapshot=timeline.read(0);assert.equal(snapshot.registers[0][2],100);assert.equal(snapshot.ddaValues[0],null);assert.deepEqual(snapshot.waveforms[0],wave);
  snapshot=timeline.read(255);assert.equal(snapshot.registers[0][2],100);assert.equal(snapshot.ddaValues[0],null);
  snapshot=timeline.read(256);assert.equal(snapshot.registers[0][2],200);assert.equal(snapshot.ddaValues[0],31);assert.equal(snapshot.ddaFrames[0],256);
  assert.equal(snapshot.ddaWrites[0],1);assert.equal(snapshot.observation.kind,'song');
  assert.throws(()=>timeline.read(255),/backwards/);timeline.dispose();
});

test('DAC writes coalesce per frame/CH; consumed data is discarded and stream selector restoration is observed exactly once',()=>{
  const engine=core(),timeline=createHuc6280SongTimeline(engine);engine.writeHuc6280(0,0);engine.writeHuc6280(4,223);engine.writeHuc6280(0,4);engine.writeHuc6280(4,223);engine.writeHuc6280(0,2);
  const before=timeline.pendingChanges;
  for(let i=0;i<10000;i++)engine.writeHuc6280Stream(0,6,i&31);
  assert(timeline.pendingChanges-before<=4,'ten thousand writes retain only final DAC/register/count/frame fields');
  const snapshot=timeline.read(0);assert.equal(snapshot.ddaValues[0],9999&31);assert.equal(snapshot.ddaWrites[0],10000);
  assert.equal(snapshot.selectedChannel,2);assert.equal(engine.selectedChannel,2);assert.equal(snapshot.ddaValues[2],null);
  engine.processFrames(1);engine.writeHuc6280Stream(4,6,10);engine.processFrames(1);
  assert.equal(timeline.read(0).ddaValues[4],null);assert.equal(timeline.read(1).ddaValues[4],10);
  timeline.read(2);assert.equal(timeline.pendingChanges,0);assert.equal(timeline.pendingEvents,0);timeline.dispose();
});

test('bounded observation overflow disables only Live and preserves native PCM/writes; reset retries and dispose restores hooks',()=>{
  const engine=core(),original={write:engine.writeHuc6280,stream:engine.writeHuc6280Stream,process:engine.processFrames,reset:engine.reset};
  const timeline=createHuc6280SongTimeline(engine,3579545,{maxPendingChanges:2});
  engine.writeHuc6280(0,0);engine.writeHuc6280(4,223);engine.writeHuc6280(6,31);
  assert.match(timeline.error,/limit/);assert.equal(timeline.read(0),null);assert.equal(timeline.pendingChanges,0);
  const pcm=engine.processFrames(3);assert.deepEqual([...pcm.left],[0,1,2]);assert.equal(engine.writes.length,3);
  engine.reset();assert.equal(timeline.error,'');assert.equal(timeline.generatedFrames,0);assert.equal(timeline.read(0).ddaValues[0],null);
  timeline.dispose();assert.equal(engine.writeHuc6280,original.write);assert.equal(engine.writeHuc6280Stream,original.stream);assert.equal(engine.processFrames,original.process);assert.equal(engine.reset,original.reset);
});

test('opaque timeline state restores committed and prefetched unknown/RAM/index/DAC deltas into a matching instance',()=>{
  const a=core(),b=core(),ta=createHuc6280SongTimeline(a),tb=createHuc6280SongTimeline(b);
  upload(a,2);a.writeHuc6280(2,100);a.writeHuc6280(4,159);a.processFrames(256);a.writeHuc6280(2,200);a.writeHuc6280(4,223);a.writeHuc6280(6,31);a.processFrames(256);
  ta.read(128);const saved=ta.saveState();assert(saved.byteLength>512);assert(Object.isFrozen(saved));assert.equal(saved.readFrame,128);assert.equal(saved.generatedFrames,512);
  assert.equal(tb.validateState(saved),true);tb.loadState(saved);assert.equal(tb.engine,b);assert.equal(tb.generatedFrames,512);assert.equal(tb.readFrame,128);
  for(const frame of [128,255,256,511,512])assert.deepEqual(tb.read(frame),ta.read(frame),String(frame));
  for(const engine of [a,b]){engine.writeHuc6280(0,2);engine.writeHuc6280(4,64);engine.writeHuc6280(4,0);engine.writeHuc6280(6,7);engine.processFrames(10);}
  assert.deepEqual(tb.read(522),ta.read(522),'restored ahead write indices and revisions continue identically');
  assert.throws(()=>tb.loadState({...saved}),/Invalid or incompatible/);ta.dispose();tb.dispose();
});

test('timeline compatibility checks and overflow-state restoration are atomic without resetting the chip',()=>{
  const a=core(),b=core(),ta=createHuc6280SongTimeline(a,3579545,{maxPendingChanges:2}),tb=createHuc6280SongTimeline(b);
  a.writeHuc6280(0,0);a.writeHuc6280(4,223);a.writeHuc6280(6,31);const saved=ta.saveState(),before=tb.read(0);
  assert.throws(()=>tb.loadState(saved),/Invalid or incompatible/);assert.deepEqual(tb.read(0),before);assert.equal(b.writes.length,0);
  tb.dispose();const matching=createHuc6280SongTimeline(b,3579545,{maxPendingChanges:2});matching.loadState(saved);assert.equal(matching.error,ta.error);assert.equal(matching.read(0),null);assert.equal(b.writes.length,0);
  matching.dispose();assert.throws(()=>matching.validateState(saved),/Invalid or incompatible/);ta.dispose();
});

const wasmBinary=await readFile(new URL('../generated/huc6280_wasm.wasm',import.meta.url));
async function native(){return Huc6280AudioEngine.create({moduleFactory:()=>factory({wasmBinary}),clock:3579545,outputSampleRate:44100,masterVolume:1});}
function render(engine,bytes,timeline){const player=new VgmPlayer(engine);player.setPrefetchFactor(1);player.load(bytes,{logger:null});player.reset();player.play();const result=[];let consumed=0;
  while(player.isPlaying()||player.queuedFrames){const l=new Float32Array(256),r=new Float32Array(256),count=player.process(l,r,256);for(let i=0;i<count;i++)result.push(l[i],r[i]);consumed+=count;timeline?.read(consumed);}
  return result;}
test('passive timeline leaves real native Wave/Noise/LFO/directDAC/DACstream PCM bit-exact and does not change the selector',async()=>{
  for(const[name,bytes]of Object.entries(fixtures())){const observed=await native(),plain=await native(),timeline=createHuc6280SongTimeline(observed);
    try{assert.deepEqual(render(observed,bytes,timeline),render(plain,bytes),name);assert.equal(observed.selectedChannel,plain.selectedChannel);assert.equal(timeline.error,'');
      const final=timeline.read(timeline.generatedFrames);if(name==='stream'||name==='direct'){assert(final.ddaWrites[0]>0);assert.notEqual(final.ddaValues[0],null);}}
    finally{timeline.dispose();observed.dispose();plain.dispose();}}
});

// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {VgmPlayer} from '../js/vgmplayer.js';
import {createHuc6280SongTimeline} from './song_state.js';
import {captureHuc6280SongCheckpoint,validateHuc6280SongCheckpoint,restoreHuc6280SongCheckpoint} from './song_checkpoint.js';
import {fixtures} from './song_test_helpers.mjs';

const nativeStates=new WeakMap();
class Engine{
  constructor(rate=48000){this.rate=rate;this.channelMask=0;this.phase=0;this.selectedChannel=0;this.value=0;this.loads=0;}
  sampleRate(){return this.rate;}supportsState(){return true;}reset(){this.phase=0;this.selectedChannel=0;this.value=0;}
  writeHuc6280(register,value){if(register===0)this.selectedChannel=value&7;else this.value=value;}
  writeHuc6280Stream(port,register,value){const old=this.selectedChannel;if(port!==255)this.writeHuc6280(register>>>4,port);this.writeHuc6280(register&15,value);if(port!==255)this.writeHuc6280(register>>>4,old);}
  processFrames(frames){const left=new Float32Array(frames),right=new Float32Array(frames);for(let i=0;i<frames;i++){left[i]=Math.sin(this.phase++/7)*(this.value+1)/256;right[i]=left[i]/2;}return{left,right};}
  saveState(){const state=Object.freeze({byteLength:128});nativeStates.set(state,{rate:this.rate,mask:this.channelMask,phase:this.phase,selectedChannel:this.selectedChannel,value:this.value});return state;}
  validateState(state){const data=nativeStates.get(state);if(!data||data.rate!==this.rate||data.mask!==this.channelMask)throw Error('Incompatible fake native state');return true;}
  loadState(state){this.validateState(state);const data=nativeStates.get(state);this.phase=data.phase;this.selectedChannel=data.selectedChannel;this.value=data.value;this.loads++;}
}
function setup(source,engine=new Engine()){
  const timeline=createHuc6280SongTimeline(engine),player=new VgmPlayer(engine);player.setPrefetchFactor(1);player.setLoopEnabled(false);player.load(source.bytes,{logger:null});player.reset();player.play();
  return{source,engine,timeline,player,mask:engine.channelMask};
}
function render(run,frames){const left=new Float32Array(frames),right=new Float32Array(frames),count=run.player.process(left,right,frames);return{count,left:left.slice(0,count),right:right.slice(0,count)};}
const capture=run=>captureHuc6280SongCheckpoint({...run,frame:run.player.renderedPositionFrames()});
const dispose=run=>{run.timeline.dispose();run.engine.dispose?.();};

test('app checkpoints continue one-pass Wave/Noise/LFO/direct/stream PCM and pending Live deltas across matching players',()=>{
  for(const[name,bytes]of Object.entries(fixtures())){
    const source={bytes},a=setup(source),b=setup(source);render(a,3);const frame=a.player.renderedPositionFrames();a.timeline.read(frame);const saved=capture(a);
    assert(Object.isFrozen(saved));assert(saved.byteLength>saved.frame);assert.equal(validateHuc6280SongCheckpoint(saved,b),true);assert.equal(restoreHuc6280SongCheckpoint(saved,b),frame);
    assert.deepEqual(b.timeline.read(frame),a.timeline.read(frame),name+' committed snapshot');assert.deepEqual(render(b,4096),render(a,4096),name+' queued/native tail');
    assert.deepEqual(b.timeline.read(b.player.renderedPositionFrames()),a.timeline.read(a.player.renderedPositionFrames()),name+' future snapshot');dispose(a);dispose(b);
  }
});

test('parser graph cloning keeps bank/stream aliases and no restored candidate can modify a cached state',()=>{
  const source={bytes:fixtures().stream},a=setup(source),b=setup(source),c=setup(source);render(a,1);const saved=capture(a);restoreHuc6280SongCheckpoint(saved,b);
  const stream=[...b.player.parser.streams.values()][0],bank=b.player.parser.dataBanks.get(stream.dataBankId);assert.equal(stream.data,bank,'DAC stream must refer to the cloned shared bank');
  const first=bank[0];bank[0]^=31;assert.equal(stream.data[0],first^31);restoreHuc6280SongCheckpoint(saved,c);
  const other=[...c.player.parser.streams.values()][0];assert.equal(other.data,c.player.parser.dataBanks.get(other.dataBankId));assert.equal(other.data[0],first);assert.notEqual(other.data,bank);
  const forged=setup(source);assert.throws(()=>restoreHuc6280SongCheckpoint({...saved},forged),/Invalid or incompatible/);dispose(forged);dispose(a);dispose(b);dispose(c);
});

test('timeline preparation failure rejects before native mutation and parser restoration uses its detached prepared graph',()=>{
  const source={bytes:fixtures().stream},a=setup(source),b=setup(source);render(a,1);const saved=capture(a),prepare=b.timeline.prepareState;
  b.timeline.prepareState=()=>{throw Error('Preparation allocation failed');};
  assert.throws(()=>restoreHuc6280SongCheckpoint(saved,b),/Preparation allocation failed/);assert.equal(b.engine.loads,0);assert.equal(b.player.processedEvents,0);
  b.timeline.prepareState=prepare;b.player.parser.loadPlaybackState=()=>{throw Error('Unexpected late clone');};
  assert.equal(restoreHuc6280SongCheckpoint(saved,b),saved.frame);assert.deepEqual(render(b,4096),render(a,4096));dispose(a);dispose(b);
});

test('source/rate/mask/loop/freshness guards reject before changing native or player state',()=>{
  const source={bytes:fixtures().wave},a=setup(source);render(a,7);const saved=capture(a);
  const candidates=[setup({bytes:source.bytes}),setup(source,new Engine(44100)),setup(source),setup(source)];candidates[2].mask=1;candidates[2].engine.channelMask=1;candidates[3].player.loopEnabled=true;
  for(const run of candidates){assert.throws(()=>restoreHuc6280SongCheckpoint(saved,run),/Invalid|incompatible|one-pass/);assert.equal(run.engine.loads,0);assert.equal(run.player.processedEvents,0);dispose(run);}
  const used=setup(source);render(used,1);const phase=used.engine.phase;assert.throws(()=>restoreHuc6280SongCheckpoint(saved,used),/fresh\/reset/);assert.equal(used.engine.phase,phase);assert.equal(used.engine.loads,0);
  const wrongFrame=setup(source);render(wrongFrame,2);assert.throws(()=>captureHuc6280SongCheckpoint({...wrongFrame,frame:100}),/producer cursor/);
  const shared=setup(source);shared.player.checkpointIntervalSeconds=1;assert.throws(()=>capture(shared),/shared checkpoints disabled/);dispose(shared);dispose(wrongFrame);dispose(used);dispose(a);
});

test('oversized immutable source or parser graph is rejected before calling its expensive clone',()=>{
  const source={bytes:fixtures().stream},run=setup(source);render(run,1);let copies=0;const save=run.player.parser.savePlaybackState.bind(run.player.parser);run.player.parser.savePlaybackState=()=>{copies++;return save();};
  assert.throws(()=>captureHuc6280SongCheckpoint({...run,frame:run.player.renderedPositionFrames(),maxBytes:32}),/byte budget/);assert.equal(copies,0);
  run.player.parser.dataBanks.set(63,new Uint8Array(131072));assert.throws(()=>captureHuc6280SongCheckpoint({...run,frame:run.player.renderedPositionFrames(),maxBytes:65536}),/byte budget/);assert.equal(copies,0);dispose(run);
});

test('actual native cached continuation is exact for all reference source kinds at non-native output rate',async t=>{
  const {Huc6280AudioEngine}=await import('../../tetorica_src/runtime/huc6280audioengine.js');
  const {default:factory}=await import('../../tetorica_src/runtime/generated/huc6280_wasm.js');
  const wasmBinary=await readFile(new URL('../../tetorica_src/runtime/generated/huc6280_wasm.wasm',import.meta.url));
  const make=()=>Huc6280AudioEngine.create({moduleFactory:()=>factory({wasmBinary}),clock:3579545,outputSampleRate:48000,masterVolume:1});
  const first=await make();if(!first.supportsState()){first.dispose();t.skip('Native state SDK rebuild is pending');return;}first.dispose();
  for(const[name,bytes]of Object.entries(fixtures())){const source={bytes},a=setup(source,await make()),b=setup(source,await make());
    try{render(a,17);a.timeline.read(a.player.renderedPositionFrames());const saved=capture(a);restoreHuc6280SongCheckpoint(saved,b);assert.deepEqual(render(b,4093),render(a,4093),name);assert.deepEqual(b.timeline.read(b.player.renderedPositionFrames()),a.timeline.read(a.player.renderedPositionFrames()),name+' Live');}
    finally{dispose(a);dispose(b);}}
});

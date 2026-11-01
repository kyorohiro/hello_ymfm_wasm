import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Ps1Spu} from './ps1_spu.js';
import {Ps1Synth} from './ps1synth.js';
import {readVab} from '../docs/playground/playground_ps1_vab.js';
import {prepareVabTone} from '../docs/synth-spu/spu_synth_vab.js';
import {readSpuInstrument,writeSpuInstrument} from '../docs/synth-spu/spu_synth_instrument.js';
import {createLoopRepeatFixture,createLoopRepeatVabFixture} from '../test/helpers/ps1_loop_repeat_fixture.mjs';
import factory from '../docs/generated/ps1_spu_wasm.js';

const wasmBinary=await readFile(new URL('../docs/generated/ps1_spu_wasm.wasm',import.meta.url));
const module=await factory({wasmBinary});
const create=()=>Ps1Spu.create({moduleFactory:async()=>module});
const peak=values=>values.reduce((p,v)=>Math.max(p,Math.abs(v)),0);
function start(core,fixture,pitch=4096){
  core.loadRam(fixture.adpcm,0x2000);
  for(const [at,value]of [[0x180,0x3fff],[0x182,0x3fff],[0x1aa,0xc000],[0,0x3fff],[2,0x2000],[4,pitch],[6,0x400],[8,15],[10,0],[14,(0x2000+fixture.loopStartSamples/28*16)/8],[0x188,1]])core.write(at,value);
}
function render(core,frames,partition=[frames]){
  const left=new Float32Array(frames+10).fill(123),right=new Float32Array(frames+10).fill(123);
  let at=0,index=0;
  while(at<frames){const count=Math.min(frames-at,partition[index++%partition.length]);core.renderInto(left,right,count,at+5);at+=count;}
  for(const data of[left,right]){assert(data.subarray(0,5).every(v=>v===123));assert(data.subarray(frames+5).every(v=>v===123));}
  return {left:left.slice(5,frames+5),right:right.slice(5,frames+5)};
}
test('flag4-only and markerless repeat packets loop with exact flag6/flag2 PCM, offsets and retained original RAM',async t=>{
  for(const options of[{loopBlock:0},{loopBlock:2},{loopBlock:2,marker:false}])for(const pitch of[4096,0x1234]){
    const actual=await create(),reference=await create();t.after(()=>{actual.dispose();reference.dispose();});
    const fixture=createLoopRepeatFixture(options),control=createLoopRepeatFixture({...options,repeatBit:true});
    start(actual,fixture,pitch);start(reference,control,pitch);
    const got=render(actual,16384,[1,27,2,113,2048]),expected=render(reference,16384);
    assert(peak(expected.left.subarray(8192))>.01,'flag6/flag2 positive control must remain audible');
    assert(peak(got.left.subarray(8192))>.01,'loop must remain audible long after the original sample END');
    assert.deepEqual(got,expected,`repeat flags have no PCM meaning: ${JSON.stringify(options)} pitch${pitch}`);
    assert.deepEqual(actual.readRam(0x2000,fixture.adpcm.length),fixture.adpcm,'playback must not patch original ADPCM flags');
    actual.write(0x18c,1);const released=render(actual,8192,[31,257]);
    assert.equal(peak(released.left.subarray(2048)),0,'key release stops the loop');
    actual.reset();start(actual,fixture,pitch);const reset=render(actual,16384,[29,1]);
    assert.deepEqual(reset,expected,'RAM-retaining reset and cache priming preserve the same loop');
    actual.reset({clearRam:true});assert.equal(peak(render(actual,1024).left),0);
  }
});
test('VAB and Web preset round trips retain flag4 original bytes and nonzero repeat metadata while sounding',async t=>{
  const fixture=createLoopRepeatVabFixture(),prepared=prepareVabTone(readVab(fixture.vab),0);
  assert.deepEqual(prepared.adpcm,fixture.adpcm);assert.equal(prepared.options.loopStartSamples,56);
  const cores=[await create(),await create()];t.after(()=>cores.forEach(core=>core.dispose()));
  const synths=cores.map(core=>new Ps1Synth({core}));
  const sample=synths[0].loadADPCM(prepared.adpcm,prepared.options);
  synths[0].setPreset(0,{...prepared.preset,sample});
  const instrument=readSpuInstrument(JSON.parse(JSON.stringify(writeSpuInstrument('Flag4 original',{
    sample:{adpcm:prepared.adpcm,...prepared.options},preset:synths[0].getPreset(0),reverb:{...synths[0].reverb},waveform:null,
  }))));
  assert.deepEqual(instrument.sample.adpcm,fixture.adpcm);assert.equal(instrument.sample.loopStartSamples,56);
  const {adpcm,...options}=instrument.sample;
  const restored=synths[1].loadADPCM(adpcm,options);synths[1].setPreset(0,{...instrument.preset,sample:restored});
  const audio=synths.map((synth,index)=>{synth.noteOn(0,60);const out=render(cores[index],16384,[17,1,257]);synth.noteOff(0);return out;});
  assert(peak(audio[0].left.subarray(8192))>.005,'VAB loop must remain audible beyond END');assert.deepEqual(audio[0],audio[1]);
  for(const core of cores)assert.equal(peak(render(core,8192).left.subarray(2048)),0);
});

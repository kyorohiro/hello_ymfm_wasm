import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Ps1Spu} from './ps1_spu.js';
import {Ps1Synth,preparePs1ADPCM,createPs1InitSample} from './ps1synth.js';
let sharedModule;
async function create(t) {
  sharedModule??=Promise.all([import('../docs/generated/ps1_spu_wasm.js'),readFile(new URL('../docs/generated/ps1_spu_wasm.wasm',import.meta.url))]).then(([{default:factory},wasmBinary])=>factory({wasmBinary}));
  const core=await Ps1Spu.create({moduleFactory:()=>sharedModule}),synth=new Ps1Synth({core});
  t.after(()=>synth.dispose());return {synth,core};
}
function load(synth){const {adpcm,...options}=createPs1InitSample();return synth.loadADPCM(adpcm,options);}
function render(synth,frames){const left=new Float32Array(frames),right=new Float32Array(frames);synth.renderInto(left,right,frames);assert.ok(left.every(Number.isFinite));assert.ok(right.every(Number.isFinite));return {left,right};}
const peak=values=>values.reduce((v,x)=>Math.max(v,Math.abs(x)),0);
function frequency(values,rate){let edges=0,first=-1,last=-1;for(let at=1;at<values.length;at++)if(values[at-1]<=0&&values[at]>0){if(first<0)first=at;last=at;edges++;}return (edges-1)*rate/(last-first);}
function cloneFixture(){const {adpcm,...options}=createPs1InitSample();return {adpcm,options};}

test('SPU ADPCM validation requires complete packets, explicit tuning, final END and a matching aligned loop',()=>{
  const {adpcm,options}=cloneFixture();
  for(const opts of [{},{rootNote:69,baseFrequencyHz:440},{baseFrequencyHz:0},{rootNote:'H4'},{...options,basePitch:1}])assert.throws(()=>preparePs1ADPCM(adpcm,opts));
  for(const bytes of [new Uint8Array(),new Uint8Array(15),new Uint8Array(524288)])assert.throws(()=>preparePs1ADPCM(bytes,options));
  const bad=(at,value)=>{const copy=adpcm.slice();copy[at]=value;assert.throws(()=>preparePs1ADPCM(copy,options));};
  bad(0,0x50);bad(0,0x0d);bad(1,0x80);bad(1,7);bad(49,2);bad(17,4);
  assert.throws(()=>preparePs1ADPCM(adpcm,{baseFrequencyHz:440}),/loopStartSamples/);
  assert.throws(()=>preparePs1ADPCM(adpcm,{baseFrequencyHz:440,loopStartSamples:1}),/boundary/);
  assert.throws(()=>preparePs1ADPCM(adpcm,{baseFrequencyHz:440,loopStartSamples:28}),/disagrees/);
  const oneShot=adpcm.slice();oneShot[1]=0;oneShot[49]=1;
  assert.throws(()=>preparePs1ADPCM(oneShot,options),/LOOP/);
  const prepared=preparePs1ADPCM(adpcm,{rootNote:'A4',loopStartSamples:0});adpcm.fill(0);
  assert.equal(prepared.rootFrequencyHz,440);assert.equal(prepared.basePitch,4096);assert.equal(prepared.decodedFrames,112);assert.equal(prepared.adpcm[1],6);
  assert.equal(createPs1InitSample().adpcm[1],6,'authored fixture returns independent buffers');
});

test('PS1 instruments upload beyond capture RAM, tune A4=440, and preserve signed independent stereo',async t=>{
  const {synth,core}=await create(t),sample=load(synth);
  assert.equal(sample.startAddress,0x1000);assert.equal(sample.repeatAddress,0x1000);assert.equal(sample.byteLength,64);
  assert.equal(sample.decodedFrames,112);assert.equal(sample.basePitch,4096);
  synth.setPreset(23,{sample,volumeLeft:0.7,volumeRight:-0.7});synth.noteOn(23,'A4');
  const expected=Math.round(4096*440/(44100/112));assert.equal(core.read(23*16+4),expected);
  const audio=render(synth,16384);assert.ok(peak(audio.left)>0.01);
  assert.ok(Math.abs(frequency(audio.left.subarray(1024),44100)-440)<0.2);
  for(let at=1024;at<audio.left.length;at++)assert.ok(Math.abs(audio.left[at]+audio.right[at])<1/16384);
  synth.setNote(23,'A5');assert.equal(synth.getPreset(23).pitch,Math.round(4096*880/(44100/112)));
  synth.setFrequency(23,220);assert.equal(synth.getPreset(23).pitch,Math.round(4096*220/(44100/112)));
  synth.setPitch(23,0);assert.equal(core.read(23*16+4),0);
});

test('all 24 fixed SPU voices sound, simultaneous key-ons survive, and KOFF isolates the high bank',async t=>{
  const {synth}=await create(t),sample=load(synth);
  for(let ch=0;ch<24;ch++) {
    synth.setPreset(ch,{sample,volumeLeft:0.03,volumeRight:0.03});synth.keyOn(ch);
    assert.ok(peak(render(synth,128).left)>0,`voice ${ch}`);synth.stopVoices();
  }
  for(let ch=0;ch<24;ch++)synth.keyOn(ch);
  render(synth,1024);assert.ok(synth.getState().channels.every(c=>c.envelope>0));
  synth.keyOff(23);render(synth,2048);
  const state=synth.getState();assert.equal(state.channels[23].envelope,0);assert.equal(state.channels[23].gate,false);
  assert.ok(state.channels.slice(0,23).every(c=>c.envelope>0&&c.gate));
  synth.allNotesOff();render(synth,2048);assert.equal(peak(render(synth,256).left),0);
});

test('PS1 preset and sample errors are atomic and valid edits do not retrigger sounding voices',async t=>{
  const {synth,core}=await create(t),sample=load(synth);synth.setPreset(0,{sample});synth.keyOn(0);render(synth,512);
  const state=synth.getPreset(0),frame=core.nativeFrames,before=core.readRam(sample.startAddress,sample.byteLength);
  for(const params of [{volumeLeft:0.1,volumeRight:2},{adsr1:12,pitch:16384},{sample:999},{volumeLeft:NaN},{adsr1:-1},{gain:1}])assert.throws(()=>synth.setPreset(0,params));
  assert.deepEqual(synth.getPreset(0),state);assert.equal(core.nativeFrames,frame);assert.deepEqual(core.readRam(sample.startAddress,sample.byteLength),before);
  const next=synth.getState().nextAddress;
  assert.throws(()=>synth.loadADPCM(new Uint8Array(64),{rootNote:60}));assert.equal(synth.getState().nextAddress,next);
  assert.throws(()=>synth.setNote(1,'A4'),/Assign/);assert.throws(()=>synth.keyOn(1),/Assign/);
  assert.throws(()=>synth.setFrequency(0,1e9),/range/);assert.deepEqual(synth.getPreset(0),state);
  synth.setPreset(0,{volumeLeft:0,volumeRight:0.4});const audio=render(synth,128);assert.equal(peak(audio.left),0);assert.ok(peak(audio.right)>0);
  assert.equal(synth.getState().channels[0].gate,true);assert.equal(core.nativeFrames,frame+128);
});

test('PS1 Stop immediately silences output and reuses sample RAM, presets, tuning and all 24 channels',async t=>{
  const {synth,core}=await create(t),sample=load(synth);synth.setPreset(23,{sample,volumeLeft:0.5,volumeRight:0.2,adsr2:8});synth.noteOn(23,'C4');
  assert.ok(peak(render(synth,1024).left)>0);const before=synth.getPreset(23),ram=core.readRam(sample.startAddress,64);
  synth.stopVoices();assert.equal(core.nativeFrames,0);assert.deepEqual(synth.getPreset(23),before);assert.deepEqual(core.readRam(sample.startAddress,64),ram);
  assert.equal(peak(render(synth,4097).left),0);assert.ok(synth.getState().channels.every(c=>!c.gate));
  synth.keyOn(23);assert.ok(peak(render(synth,512).left)>0);assert.equal(synth.getState().samples.length,1);
  synth.reset();assert.equal(synth.getPreset(23).sample,null);assert.equal(synth.getState().samples.length,1);assert.equal(peak(render(synth,128).left),0);
  synth.setPreset(0,{sample});synth.noteOn(0,'A4');assert.ok(peak(render(synth,256).left)>0);
  synth.reset({clearRam:true});assert.equal(synth.getState().samples.length,0);assert.equal(synth.getState().nextAddress,0x1000);assert.ok(core.readRam().every(x=>x===0));
  assert.throws(()=>synth.setPreset(0,{sample}),/sample/);assert.equal(load(synth).id,0);
});

test('SPU upload allocator fills only available RAM and rejects further samples without changing the bank',async t=>{
  const {synth,core}=await create(t),bytes=new Uint8Array(512*1024-0x1000);bytes[bytes.length-15]=1;
  const sample=synth.loadADPCM(bytes,{rootNote:60});assert.equal(sample.byteLength,bytes.length);assert.equal(synth.getState().nextAddress,512*1024);
  const end=core.readRam(512*1024-16,16);
  assert.throws(()=>load(synth),/full/);assert.deepEqual(core.readRam(512*1024-16,16),end);assert.equal(synth.getState().samples.length,1);
});

test('non-looped SPU ADPCM stops at END and snapshots are independent owned copies',async t=>{
  const {synth}=await create(t),{adpcm}=createPs1InitSample();adpcm[1]=0;adpcm[49]=1;
  const sample=synth.loadADPCM(adpcm,{rootNote:60});assert.equal(sample.loop,false);assert.equal(sample.loopStartSamples,null);
  synth.setPreset(0,{sample});synth.keyOn(0);assert.ok(peak(render(synth,512).left)>0);assert.equal(peak(render(synth,512).left),0);
  const snapshot=synth.snapshot();assert.equal(snapshot.ram.length,512*1024);assert.equal(snapshot.registers.length,512);assert.equal(snapshot.channels[0].ended,true);
  snapshot.samples[0].startAddress=0;snapshot.channels[0].pitch=0;snapshot.ram.fill(0);assert.equal(synth.getState().samples[0].startAddress,0x1000);assert.equal(synth.getPreset(0).pitch,4096);
  synth.dispose();synth.dispose();assert.throws(()=>synth.keyOn(0),/disposed/);assert.throws(()=>synth.getState(),/disposed/);assert.throws(()=>synth.reset(),/disposed/);
});

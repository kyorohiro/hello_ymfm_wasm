import test from 'node:test';
import assert from 'node:assert/strict';
import {SnesSynth,prepareSnesBRR} from './snessynth.js';
const brr=(loop=true)=>new Uint8Array([0x10,...Array(8).fill(0x77),loop?0x13:0x11,...Array(8).fill(0x88)]);
function setup(){const memory=new Uint8Array(65536),dsp=new Uint8Array(128),writes=[];let frames=0;const core={get nativeFrames(){return frames;},reset(){memory.fill(0);dsp.fill(0);frames=0;},loadRam(b,at){memory.set(b,at);},writeDsp(r,v){dsp[r]=v;writes.push([r,v]);},readDsp:r=>dsp[r],snapshot:()=>({ram:memory.slice(),dsp:dsp.slice(),nativeFrames:frames}),renderInto(l,r,n){l.fill(0);r.fill(0);frames+=n;},dispose(){}};const synth=new SnesSynth({core});return{synth,core,memory,dsp,writes};}
test('SNES BRR tuning and loop metadata must be explicit and validated before upload',()=>{
  for(const options of [{},{rootNote:60,baseFrequencyHz:440},{rootNote:NaN},{baseFrequencyHz:0}])assert.throws(()=>prepareSnesBRR(brr(),options));
  assert.throws(()=>prepareSnesBRR(brr(),{rootNote:60}),/loopStartSamples/);
  assert.throws(()=>prepareSnesBRR(brr(),{rootNote:60,loopStartSamples:1}),/boundary/);
  assert.throws(()=>prepareSnesBRR(brr(false),{rootNote:60,loopStartSamples:0}),/LOOP/);
  assert.throws(()=>prepareSnesBRR(new Uint8Array(9),{rootNote:60}),/END/);
  assert.throws(()=>prepareSnesBRR(new Uint8Array(65537),{rootNote:60}),/RAM/);
  const bytes=brr(),p=prepareSnesBRR(bytes,{rootNote:'A4',loopStartSamples:16});bytes.fill(0);
  assert.equal(p.rootFrequencyHz,440);assert.equal(p.basePitch,4096);assert.equal(p.frames,32);assert.equal(p.brr[0],0x10);
});
test('SNES fixed voices program samples, directory and A4=440 musical pitch without allocator',()=>{
  const {synth,memory,dsp}=setup(),sample=synth.loadBRR(brr(),{rootNote:'A4',loopStartSamples:16});
  assert.equal(dsp[0x2d],0);assert.equal(dsp[0x3d],0);assert.equal(dsp[0x4d],0);assert.equal(dsp[0x6c],0x20);
  assert.equal(sample.id,0);assert.equal(sample.startAddress,0x400);assert.equal(sample.loopAddress,0x409);
  assert.deepEqual([...memory.subarray(0,4)],[0,4,9,4]);
  synth.setPreset(7,{sample,adsr1:0x8f,adsr2:0xe0,volumeLeft:-100,volumeRight:80});
  synth.setNote(7,'A5');assert.equal(synth.getPreset(7).pitch,8192);synth.setFrequency(7,220);assert.equal(synth.getPreset(7).pitch,2048);
  synth.setPitch(7,0);assert.equal(dsp[0x72],0);assert.equal(dsp[0x73],0);assert.equal(dsp[0x70],156);
  assert.equal(dsp[0x75],0x8f);assert.equal(dsp[0x76],0xe0);
  assert.throws(()=>synth.keyOn(0),/Assign/);assert.throws(()=>synth.setFrequency(0,440),/Assign/);
  assert.throws(()=>synth.setNote(7,'A8'),/range/);assert.throws(()=>synth.setPreset(8,{sample}),/channel/);
});
test('SNES same-frame chord merges KON, KOFF uses correct voice mask and leaves other voices enabled',()=>{
  const {synth,dsp,writes}=setup(),sample=synth.loadBRR(brr(),{rootNote:60,loopStartSamples:0});
  for(let ch=0;ch<8;ch++)synth.setPreset(ch,{sample});
  synth.noteOn(0,'C4');synth.noteOn(7,'E4');assert.equal(dsp[0x5c],0x7e);assert.equal(dsp[0x4c],0x81);
  synth.renderInto(new Float32Array(1),new Float32Array(1),1);assert.equal(dsp[0x4c],0x81);
  synth.keyOn(1);assert.equal(dsp[0x4c],2,'new native frame must not retrigger an older voice');
  const ons=writes.filter(([reg])=>reg===0x4c);assert.equal(ons.at(-2)[1],0x81);synth.keyOff(1);
  synth.keyOff(7);assert.equal(dsp[0x5c],0xfe);synth.allNotesOff();assert.equal(dsp[0x5c],255);
});
test('SNES failed preset edits are atomic and parameter changes do not inject KON or reset',()=>{
  const {synth,writes}=setup(),sample=synth.loadBRR(brr(),{rootNote:60,loopStartSamples:0});synth.setPreset(0,{sample});
  const before=synth.getPreset(0),start=writes.length;
  assert.throws(()=>synth.setPreset(0,{gain:20,volumeLeft:999}));assert.deepEqual(synth.getPreset(0),before);assert.equal(writes.length,start);
  synth.setPreset(0,{gain:0xd0,adsr1:0,adsr2:12});assert.ok(writes.slice(start).every(([reg])=>reg!==0x4c&&reg!==0x6c));
});
test('SNES DSP reset retains and restores uploaded samples but releases all voices',()=>{
  const {synth,memory,dsp}=setup(),sample=synth.loadBRR(brr(),{baseFrequencyHz:220,basePitch:0x800,loopStartSamples:0});
  synth.setPreset(0,{sample});synth.noteOn(0,'A3');synth.reset();
  assert.equal(synth.getState().samples.length,1);assert.equal(synth.getPreset(0).sample,null);assert.equal(dsp[0x5c],255);
  assert.deepEqual(memory.subarray(sample.startAddress,sample.startAddress+18),brr());synth.setPreset(0,{sample});synth.setFrequency(0,440);assert.equal(synth.getPreset(0).pitch,0x1000);
});
test('SNES RAM allocator rejects exhaustion without modifying previous samples',()=>{
  const {synth,memory}=setup(),bytes=new Uint8Array(9*7168);bytes[bytes.length-9]=1;
  const first=synth.loadBRR(bytes,{rootNote:60});assert.equal(first.byteLength,64512);assert.equal(synth.getState().nextAddress,65536);
  const original=memory.slice();assert.throws(()=>synth.loadBRR(brr(false),{rootNote:60}),/full/);assert.deepEqual(memory,original);assert.equal(synth.getState().samples.length,1);
});

// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {readVab, prepareVabTone} from './spu_synth_vab.js';
import {createVabFixture} from '../../test/helpers/spu_vab_fixture.mjs';
import {createPs1InitSample, Ps1Synth} from '../js/ps1synth.js';
import {Ps1Spu} from '../js/ps1_spu.js';
import factory from '../generated/ps1_spu_wasm.js';
import {writeSpuInstrument, readSpuInstrument} from './spu_synth_instrument.js';

test('combined and split VAB map sparse program IDs, packed tones, prefix and sample lengths identically', () => {
  const {vh,vb,vab}=createVabFixture(), bank=readVab(vab);
  assert.deepEqual(readVab(vh,vb),bank);
  assert.deepEqual(bank.programs.map(p=>p.index),[3,11]);
  assert.deepEqual(bank.tones.map(t=>[t.program,t.index,t.sample]),[[3,0,1],[3,1,1],[11,0,2]]);
  assert.deepEqual(bank.samples.map(s=>s.bytes.length),[80,32]);
  assert.deepEqual(bank.samples[0].bytes.slice(0,64),createPs1InitSample().adpcm);
  vab.fill(0); assert.notEqual(bank.samples[0].bytes[0],0,'parser owns sample data');
});

test('Tone preparation preserves original packets, trims at END and applies positive fine tune in playback direction', () => {
  const bank=readVab(createVabFixture().vab), plain=prepareVabTone(bank,0), fine=prepareVabTone(bank,1), oneShot=prepareVabTone(bank,2);
  assert.deepEqual(plain.adpcm,createPs1InitSample().adpcm);
  assert.equal(plain.trimmedBytes,16); assert.equal(plain.options.loopStartSamples,0);
  assert.equal(plain.options.baseFrequencyHz,440*2**((60-69)/12));
  assert.equal(fine.options.baseFrequencyHz,440*2**((59.5-69)/12));
  assert(plain.options.baseFrequencyHz/fine.options.baseFrequencyHz>1,'positive shift raises playback at the same key');
  assert.equal(oneShot.adpcm.length,16); assert.equal(oneShot.options.loopStartSamples,undefined);
  assert.equal(plain.preset.adsr1,15); assert.equal(plain.preset.adsr2,0);
  assert.equal(plain.preset.volumeLeft,(100/127)**2); assert.equal(plain.preset.volumeRight,plain.preset.volumeLeft);
});

test('VAB rejects truncated tables, mismatched split banks and out-of-range metadata before applying any instrument', () => {
  const mutations=[
    b=>b[0]=0, b=>new DataView(b.buffer).setUint32(4,5,true),
    b=>new DataView(b.buffer).setUint32(12,10,true),
    b=>b[0x12]=129, b=>b[0x14]=4, b=>b[0x16]=0,
    b=>b[0x18]=128, b=>b[0x20+3*16]=17,
    b=>b[0x820+22]=3, b=>b[0x820+6]=110, b=>b[0x820+5]=128,
    b=>b[0xc22]=255, b=>b[0xc20]=255,
  ];
  for(const mutate of mutations) {const {vab}=createVabFixture();mutate(vab);assert.throws(()=>readVab(vab));}
  const {vh,vb,vab}=createVabFixture();
  for(const length of [0,31,0x820,0xdff,vab.length-1])assert.throws(()=>readVab(vab.slice(0,length)));
  assert.throws(()=>readVab(vh,vb.slice(0,100)),/size/);
  assert.throws(()=>readVab(vab,vb),/size/);
  assert.throws(()=>readVab('not bytes'));
});

test('bad ADPCM never borrows an END packet from the next sample or rewrites unsupported flags', () => {
  for(const mutate of [
    b=>{b.samples[0].bytes[49]=0;}, // remove END (no END in its own remaining padding)
    b=>{b.samples[0].bytes[0]=0x50;},
    b=>{b.samples[0].bytes[1]|=8;},
    b=>{b.samples[0].bytes[17]|=4;},
    b=>{b.samples[0].bytes[49]=1;}, // one-shot with loop start
  ]) {const bank=readVab(createVabFixture().vab);mutate(bank);assert.throws(()=>prepareVabTone(bank,0));}
  assert.throws(()=>prepareVabTone(readVab(createVabFixture().vab),3));
  const bank=readVab(createVabFixture().vab);
  bank.samples[0].bytes[1]&=~4;
  assert.equal(prepareVabTone(bank,0).options.loopStartSamples,0,'loop without a marker starts at sample address');
});

test('version 6, sliced buffers and packet-aligned nonzero loop starts retain the exact sample', () => {
  const {vab}=createVabFixture(); new DataView(vab.buffer).setUint32(4,6,true);
  const backing=new Uint8Array(vab.length+19); backing.set(vab,11);
  const bank=readVab(new DataView(backing.buffer,11,vab.length));
  bank.samples[0].bytes[1]&=~4; bank.samples[0].bytes[17]|=4;
  const prepared=prepareVabTone(bank,0);
  assert.equal(bank.version,6); assert.equal(prepared.options.loopStartSamples,28);
  assert.deepEqual(prepared.adpcm,bank.samples[0].bytes.slice(0,64));
});

test('volume stages keep opposite pans silent and mode 4 retains the reverb send', () => {
  const bank=readVab(createVabFixture().vab);
  bank.programs[0].pan=0; bank.tones[0].pan=127; bank.tones[0].mode=4;
  const {preset}=prepareVabTone(bank,0);
  assert.equal(preset.volumeLeft,0); assert.equal(preset.volumeRight,0); assert.equal(preset.reverb,true);
});

test('silent and libsnd Noise tones do not prevent other Tones in a bank from loading', () => {
  const {vab}=createVabFixture();
  new DataView(vab.buffer).setUint16(0x840+22,255,true);
  new DataView(vab.buffer).setUint16(0xa20+22,0,true);
  const bank=readVab(vab);
  assert.equal(prepareVabTone(bank,0).adpcm.length,64);
  assert.throws(()=>prepareVabTone(bank,1),/Noise/);
  assert.throws(()=>prepareVabTone(bank,2),/no assigned sample/);
});

test('raw ADSR, tuning and loop survive a preset round-trip and produce real native SPU audio', async t => {
  const wasmBinary=await readFile(new URL('../generated/ps1_spu_wasm.wasm',import.meta.url));
  const core=await Ps1Spu.create({moduleFactory:factory,moduleOptions:{wasmBinary}}), synth=new Ps1Synth({core});
  t.after(()=>synth.dispose());
  const bank=readVab(createVabFixture().vab), prepared=prepareVabTone(bank,1);
  const sample=synth.loadADPCM(prepared.adpcm,prepared.options);
  synth.setPreset(0,{...prepared.preset,sample}); synth.noteOn(0,60);
  assert.equal(core.read(4),Math.round(4096*2**(.5/12)));
  assert.equal(core.read(8),15); assert.equal(core.read(10),0);
  const left=new Float32Array(8192),right=new Float32Array(8192); synth.renderInto(left,right);
  assert(left.some(x=>Math.abs(x)>.01)); assert(left.every(Number.isFinite));
  const instrument=readSpuInstrument(JSON.parse(JSON.stringify(writeSpuInstrument('Imported tone',{
    sample:{adpcm:prepared.adpcm,...prepared.options},preset:synth.getPreset(0),reverb:{...synth.reverb},waveform:null,
  }))));
  assert.deepEqual(instrument.sample.adpcm,prepared.adpcm); assert.equal(instrument.preset.adsr1,15);
  assert.equal(instrument.sample.baseFrequencyHz,prepared.options.baseFrequencyHz); assert.equal(instrument.sample.loopStartSamples,0);
});

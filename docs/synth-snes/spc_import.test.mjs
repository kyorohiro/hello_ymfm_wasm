// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseSpcVoices, MAX_SPC_BYTES} from './spc_import.js';
import {readPreset, envelopeRegisters} from './preset.js';
import {decodeBase64, MAX_BRR_BYTES} from './sample.js';
import {SnesInstrument} from './instrument.js';
import {SnesDspCore} from '../js/spc.js';
import factory from '../generated/spc_wasm.js';

// Entirely self-authored SPC snapshots: no game program or Nintendo IPL ROM.
const RAM = 0x100, DSP = 0x10100;
const BRR = Uint8Array.of(0xc0,0x77,0x66,0x44,0x22,0x0e,0xcc,0xaa,0x99,0xc3,0x99,0xaa,0xcc,0xee,0x02,0x44,0x66,0x77);
function sample(image, sourceNumber, address = 0x2000, bytes = BRR, loopAddress = address) {
  const directory = image[DSP + 0x5d] << 8;
  const word = (address, value) => {image[RAM + (address & 65535)] = value & 255;image[RAM + ((address + 1) & 65535)] = value >> 8;};
  word(directory + sourceNumber * 4, address);word(directory + sourceNumber * 4 + 2, loopAddress);
  bytes.forEach((value,index) => {image[RAM + ((address + index) & 65535)] = value;});
  return image;
}
function voice(image, index, {sourceNumber = 0, pitch = 4096, left = 16, right = 16, adsr1 = 0xaf, adsr2 = 0xe0, gain = 0x60, envx = 0, outx = 0} = {}) {
  image.set([left & 255,right & 255,pitch & 255,(pitch >> 8) & 255,sourceNumber,adsr1,adsr2,gain,envx,outx],DSP + (index << 4));
  return image;
}
function image() {
  const data = new Uint8Array(0x10200);
  data.set(new TextEncoder().encode('SNES-SPC700 Sound File Data v0.30'));
  data.set([0x1a,0x1a,0x1b,30],0x21);
  data[DSP + 0x5d] = 2;
  for (let index=0;index<8;index++) voice(data,index);
  return sample(data,0);
}
const ready = result => result.candidates.filter(candidate => candidate.preset);

test('only eight physical records are offered, retaining inactive voices and distinct settings on the same BRR', () => {
  const source = image();
  voice(source,0,{left:-128,right:127,pitch:3072,adsr1:0x9b,adsr2:0x73,gain:0x1d,envx:64});
  voice(source,1,{left:0,right:-1,pitch:2048,adsr1:0x35,adsr2:0x98,gain:0xd4,outx:255});
  const result = parseSpcVoices(source,{name:'My snapshot.spc'});
  assert.equal(result.name,'My snapshot.spc');assert.equal(result.directory,2);
  assert.equal(result.candidates.length,8);assert.equal(ready(result).length,8);
  const [a,b,c] = result.candidates;
  assert.deepEqual([a.id,b.id,c.id],['voice-0','voice-1','voice-2']);
  assert.equal(a.voice.active,true);assert.equal(b.voice.active,true);assert.equal(c.voice.active,false);
  assert.equal(a.preset.brr.data,b.preset.brr.data);assert.notEqual(a.preset.name,b.preset.name);
  assert.deepEqual(a.preset.volume,{left:-128,right:127});assert.deepEqual(b.preset.volume,{left:0,right:-1});
  assert.equal(a.preset.brr.rootNote,60);assert.equal(a.preset.brr.basePitch,3072);assert.equal(b.preset.brr.basePitch,2048);
  assert.deepEqual(envelopeRegisters(a.preset),{adsr1:0x9b,adsr2:0x73,gain:0x1d});
  assert.deepEqual(envelopeRegisters(b.preset),{adsr1:0x35,adsr2:0x98,gain:0xd4});
  assert.deepEqual(decodeBase64(a.preset.brr.data),BRR);
  assert.deepEqual(a.sample,{sourceNumber:0,startAddress:0x2000,loopAddress:0x2000,bytes:18,frames:32,loopStartSamples:0});
  assert(result.warnings.some(warning=>warning.includes('ENVX / OUTX')));
  assert(result.warnings.some(warning=>warning.includes('not the original musical note')));
  // An unused directory slot pointing at invalid RAM does not become a candidate.
  assert.equal(result.candidates.every(candidate=>candidate.voice.sourceNumber===0),true);
});

test('all GAIN modes preserve raw register bytes and decreasing modes explain fresh key-on silence', () => {
  const modes = [[0x00,'direct'],[0x7f,'direct'],[0x80,'linear-decrease'],[0x9f,'linear-decrease'],
    [0xa0,'exponential-decrease'],[0xbf,'exponential-decrease'],[0xc1,'linear-increase'],[0xdf,'linear-increase'],[0xe0,'bent-increase'],[0xff,'bent-increase']];
  for (const [gain,mode] of modes) {
    const data=image();voice(data,0,{adsr1:0x75,adsr2:0xab,gain});
    const candidate=parseSpcVoices(data).candidates[0];
    assert.equal(candidate.preset.envelope.mode,'gain');assert.equal(candidate.preset.envelope.gainMode,mode);
    assert.deepEqual(envelopeRegisters(candidate.preset),{adsr1:0x75,adsr2:0xab,gain});
    assert.equal(candidate.preset.envelope.gainRate,gain & 31);
    assert.equal(candidate.warnings.some(warning=>warning.includes('Decreasing GAIN')),mode.includes('decrease'));
  }
});

test('resolved block loops survive, unresolved loops remain visible but cannot be adopted', () => {
  const second=image();sample(second,0,0x2000,BRR,0x2009);
  const loop=parseSpcVoices(second).candidates[0];
  assert.equal(loop.preset.brr.loopStartSamples,16);assert.equal(loop.sample.loopStartSamples,16);
  for (const address of [0x2001,0x2012,0x1000]) {
    const data=image();sample(data,0,0x2000,BRR,address);
    const candidate=parseSpcVoices(data).candidates[0];
    assert.equal(candidate.preset,null);assert.match(candidate.reason,/Loop target/);
    assert.equal(candidate.sample.loopAddress,address);assert.equal(candidate.sample.loopStartSamples,null);
  }
  const oneShot=image(),bytes=BRR.slice();bytes[9] &= ~2;sample(oneShot,0,0x2000,bytes,0x1234);
  assert.equal(parseSpcVoices(oneShot).candidates[0].preset.brr.loopStartSamples,null,'non-looping samples ignore a stale loop pointer');
});

test('16-bit RAM wrap is reconstructed without moving the original loop boundary', () => {
  const data=image();sample(data,0,65530,BRR,3);
  const candidate=parseSpcVoices(data).candidates[0];
  assert(candidate.preset);assert.deepEqual(decodeBase64(candidate.preset.brr.data),BRR);
  assert.equal(candidate.preset.brr.loopStartSamples,16);assert.equal(candidate.sample.startAddress,65530);
  assert(candidate.warnings.some(warning=>warning.includes('wraps')));
});

test('Noise and zero PITCH stay unavailable; PMON and Echo explicitly load a dry unmodulated voice', () => {
  const data=image();data[DSP + 0x3d] = 1;data[DSP + 0x2d] = 5;data[DSP + 0x4d] = 4;
  voice(data,1,{pitch:0});voice(data,3,{left:0,right:0});
  const result=parseSpcVoices(data);
  assert.equal(result.candidates[0].preset,null);assert.match(result.candidates[0].reason,/Noise voice/);
  assert.equal(result.candidates[1].preset,null);assert.match(result.candidates[1].reason,/PITCH is 0/);
  assert(result.candidates[2].preset);assert(result.candidates[2].warnings.some(warning=>warning.includes('PMON is not reproduced')));
  assert(result.candidates[2].warnings.some(warning=>warning.includes('Echo / FIR is not reproduced')));
  assert.equal(result.candidates[0].voice.pitchModulation,false,'PMON bit zero does not modulate voice zero');
  assert(result.candidates[3].warnings.some(warning=>warning.includes('volumes are zero')));
});

test('incomplete or over-budget BRR leaves valid SRCNs available without truncating or inventing END', () => {
  const data=image();
  // SRCN 1 starts in a long region with no END; the valid SRCN 0 is elsewhere.
  sample(data,1,0x3000,new Uint8Array(MAX_BRR_BYTES));
  // Long zero write wraps and overwrites directory: rebuild directory and good sample.
  data[DSP + 0x5d]=2;sample(data,0);sample(data,1,0x3000,new Uint8Array(9));
  voice(data,1,{sourceNumber:1});
  const result=parseSpcVoices(data);
  assert(result.candidates[0].preset);assert.equal(result.candidates[1].preset,null);
  assert.match(result.candidates[1].reason,/64,512 bytes/);assert.equal(result.candidates[1].sample,null);
  assert.deepEqual(decodeBase64(result.candidates[0].preset.brr.data),BRR);
});

test('sample at the RAM budget is accepted; the next complete block is not silently truncated', () => {
  const data=image(),exact=new Uint8Array(MAX_BRR_BYTES);exact[exact.length-9]=1;
  // Starting above the reserved directory leaves exactly the full permitted RAM budget.
  sample(data,0,1024,exact,1024);
  const full=parseSpcVoices(data).candidates[0];assert(full.preset);assert.equal(full.sample.bytes,MAX_BRR_BYTES);
  assert.equal(decodeBase64(full.preset.brr.data).length,MAX_BRR_BYTES);
  const oversize=image(),long=new Uint8Array(MAX_BRR_BYTES+9);long[long.length-9]=1;
  sample(oversize,0,1024,long,1024);
  const rejected=parseSpcVoices(oversize).candidates[0];assert.equal(rejected.preset,null);assert.match(rejected.reason,/64,512 bytes/);
});

test('SPC validation is bounded and rejects malformed bytes without accepting other formats', () => {
  assert.equal(MAX_SPC_BYTES,16*1024*1024);
  assert.throws(()=>parseSpcVoices(new Uint8Array(4)),/Truncated SPC/);
  const bad=image();bad[0]=0;assert.throws(()=>parseSpcVoices(bad),/signature/);
  const sentinel=image();sentinel[0x22]=0;assert.throws(()=>parseSpcVoices(sentinel),/signature/);
  assert.throws(()=>parseSpcVoices(new Uint8Array(MAX_SPC_BYTES+1)),/16 MiB/);
  assert.throws(()=>parseSpcVoices('not bytes'),/ArrayBuffer/);
  assert.throws(()=>parseSpcVoices(image(),{name:12}),/name must be a string/);
  const short=image().slice(0,0x10180);assert.equal(ready(parseSpcVoices(short)).length,8);
});

test('file/tag names are bounded and sanitized, presets and voice records own their data', () => {
  const data=image();data[0x23]=0x1a;
  data.set(new TextEncoder().encode('A\nTitle\u0001'),0x2e);data.set(new TextEncoder().encode('Game'),0x4e);
  const before=data.slice(),result=parseSpcVoices(new DataView(data.buffer),{name:'\u0000  file\n'+ 'x'.repeat(500)});
  assert.equal(result.name.length,160);assert(!/[\u0000-\u001f]/.test(result.name));
  assert.equal(result.metadata.title,'A Title');assert.equal(result.metadata.game,'Game');
  const [a,b]=result.candidates;assert.equal(readPreset(a.preset).name,a.preset.name);
  a.preset.volume.left=90;a.voice.pitch=3;a.preset.wave[0]=1;
  assert.equal(b.preset.volume.left,16);assert.equal(b.voice.pitch,4096);assert.notEqual(b.preset.wave[0],1);
  assert.deepEqual(data,before,'parsing does not rewrite the source snapshot');
  data.fill(0);assert.deepEqual(decodeBase64(b.preset.brr.data),BRR,'returned sample no longer aliases the file');
});

test('a selected preset uses the captured hardware PITCH and envelope in the actual S-DSP without restoring snapshot ENVX', async t => {
  const data=image();voice(data,0,{pitch:3072,left:24,right:-16,adsr1:0x95,adsr2:0x9a,gain:0x47,envx:120,outx:70});
  const candidate=parseSpcVoices(data).candidates[0];
  const wasmBinary=await readFile(new URL('../generated/spc_wasm.wasm',import.meta.url));
  const core=await SnesDspCore.create({moduleFactory:factory,moduleOptions:{wasmBinary}});
  const instrument=new SnesInstrument(core);t.after(()=>instrument.dispose());
  instrument.loadPreset(candidate.preset);
  assert.equal(instrument.read().registers[0][8],0,'captured ENVX is not a preloaded envelope');
  instrument.noteOn('imported',60);
  let row=instrument.read().registers[0];
  assert.deepEqual(row.slice(0,4),[24,240,0,12]);assert.deepEqual(row.slice(5,8),[0x95,0x9a,0x47]);
  const left=new Float32Array(4096),right=new Float32Array(4096);instrument.renderInto(left,right);
  assert(left.every(Number.isFinite));assert(left.some(value=>Math.abs(value)>.001));
  assert(right.every(Number.isFinite));assert(left.some((value,index)=>value!==right[index]));
  instrument.noteOn('octave',72);row=instrument.read().registers[1];assert.equal(row[2]|row[3]<<8,6144);
  const loaded=instrument.read().preset;assert.deepEqual(loaded,readPreset(JSON.parse(JSON.stringify(candidate.preset))));
});

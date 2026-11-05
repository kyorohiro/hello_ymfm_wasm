// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {gzipSync} from 'node:zlib';
import {readFile} from 'node:fs/promises';
import factory from '../generated/nesapu_wasm.js';
import {NesApuWasm} from '../js/nesapu_wasm.js';
import {NesApuSynth} from '../js/nesapusynth.js';
import {NesInstrument} from './instrument.js';
import {createDemoDpcm, readPreset, presetToCode} from './preset.js';
import {extractVgmInstruments} from './vgm_import.js';

const w = (register, value) => [0xb4, register, value];
const u32 = value => [value & 255, (value >>> 8) & 255, (value >>> 16) & 255, value >>> 24];
const u24 = value => [value & 255, (value >>> 8) & 255, (value >>> 16) & 255];
const wait = samples => [0x61, samples & 255, samples >>> 8];
const dataBlock = (type, bytes, second = false) => [0x67, 0x66, type, ...u32((bytes.length | (second ? 0x80000000 : 0)) >>> 0), ...bytes];
const ram = (address, bytes) => dataBlock(0xc2, [address & 255, address >>> 8, ...bytes]);
const copyRam = (source, address, length, type = 7) => [0x68,0x66,type,...u24(source),...u24(address),...u24(length)];
const pulse = [...w(0x15, 1), ...w(0, 0xb9), ...w(1, 8), ...w(2, 0x40), ...w(3, 9)];
const setup = ({rate = 15, loop = false, level = 64, address = 0, length = 1} = {}) => [
  ...w(0x10, (loop ? 64 : 0) | rate), ...w(0x11, level), ...w(0x12, address), ...w(0x13, length),
];
function vgm(commands, clock = 1789773) {
  const bytes = new Uint8Array(0x100 + commands.length), view = new DataView(bytes.buffer);
  bytes.set([86, 103, 109, 32]);
  view.setUint32(4, bytes.length - 4, true); view.setUint32(8, 0x171, true);
  view.setUint32(0x34, 0xcc, true); view.setUint32(0x84, clock >>> 0, true);
  bytes.set(commands, 0x100); return bytes;
}
const sounds = result => result.voices.filter(voice => voice.kind === 'dmc');
const messages = result => [...result.warnings, ...sounds(result).flatMap(voice => voice.warnings)].join(' ');
const dpcm17 = () => createDemoDpcm().slice(0,17);
const complete = () => vgm([...ram(0xc000, createDemoDpcm()), ...setup({rate:7, loop:true, level:48, length:16}), ...w(0x15,16), 0x66]);

test('DMC-only VGM and VGZ recover complete encoded bytes and the recorded playback settings', async () => {
  const source = complete(), result = await extractVgmInstruments(source);
  assert.deepEqual(await extractVgmInstruments(gzipSync(source)), result);
  assert.equal(result.voices.length, 1); assert.equal(result.timebase, 44100);
  const [voice] = sounds(result);
  assert.equal(voice.channel, 5); assert.equal(voice.firstTime, 0); assert.equal(voice.occurrences, 1);
  assert.match(voice.preset.name, /^DMC\b/);
  assert.deepEqual(voice.preset.dmc, {data:createDemoDpcm(), rate:7, loop:true, level:48});
  assert.equal(voice.preset.source, 'dmc'); assert.equal(voice.preset.version, 7);
  assert.deepEqual(readPreset(JSON.parse(JSON.stringify(voice.preset))), voice.preset);
});

test('DMC RAM and control masks coexist with ordinary Pulse voices without taking opaque chip data', async () => {
  const bytes = dpcm17();
  const result = await extractVgmInstruments(vgm([...pulse,
    ...dataBlock(0, [...ram(0xc040, bytes), ...setup({address:1}), ...w(0x15,16)]),
    ...ram(0xc040, bytes), ...setup({rate:7, loop:true, level:0xe1, address:1}), ...w(0x10,0xc7), ...w(0x15,17), 0x66]));
  assert.deepEqual(result.voices.map(voice => [voice.kind, voice.channel]), [['pulse',1], ['dmc',5]]);
  assert.deepEqual(sounds(result)[0].preset.dmc, {data:bytes, rate:7, loop:true, level:97});
});

test('DMC samples own trigger-time RAM snapshots and distinct settings, even after overlapping writes', async () => {
  const a = dpcm17(), b = a.map(value => value ^ 255);
  const result = await extractVgmInstruments(vgm([
    ...ram(0xc000,a), ...setup({rate:7, loop:true, level:32}), ...w(0x15,16), ...wait(10),
    ...ram(0xc000,b), ...w(0x15,0), ...w(0x11,32), ...w(0x15,16),
    ...w(0x15,0), ...ram(0xc000,a), ...w(0x11,32), ...w(0x15,16),
    ...w(0x15,0), ...w(0x10,3), ...w(0x11,32), ...w(0x15,16), 0x66,
  ]));
  const voices = sounds(result);
  assert.equal(voices.length, 3);
  const first = voices.find(voice => voice.preset.dmc.rate === 7 && voice.preset.dmc.data[0] === a[0]);
  const replacement = voices.find(voice => voice.preset.dmc.data[0] === b[0]);
  assert(first); assert(replacement); assert.equal(first.occurrences, 2);
  assert.deepEqual(first.preset.dmc.data,a); assert.deepEqual(replacement.preset.dmc.data,b);
  assert(voices.some(voice => voice.preset.dmc.rate === 3 && !voice.preset.dmc.loop));
  assert.match(messages(result), /RAM.*(?:chang|overwrit)|snapshot/i);
  replacement.preset.dmc.data[0] ^= 255;
  assert.deepEqual(first.preset.dmc.data,a, 'recovered presets do not share mutable data');
});

test('NES bank 07 chunks concatenate before a 68 RAM copy spanning their boundary', async () => {
  const bytes = dpcm17(), prefix = [0x13,0x27,0x39,0x4d,0x51];
  const result = await extractVgmInstruments(vgm([
    ...dataBlock(7,[...prefix,...bytes.slice(0,8)]), ...dataBlock(7,[...bytes.slice(8),0x6b,0x79]),
    ...copyRam(prefix.length,0xc040,bytes.length), ...setup({address:1}), ...w(0x15,16), 0x66,
  ]));
  assert.deepEqual(sounds(result)[0].preset.dmc.data,bytes);
});

test('unknown or compressed NES bank copies invalidate old RAM instead of auditioning stale bytes', async () => {
  const bytes = dpcm17();
  // A valid type-0 compressed header describes 17 decoded bytes; this stage
  // deliberately does not decode compressed NES data-bank payloads.
  const compressed = [0,...u32(17),8,4,0,0,0,...Array(9).fill(0)];
  for (const commands of [
    copyRam(0,0xc000,17),
    [...dataBlock(7,bytes.slice(0,8)), ...copyRam(0,0xc000,17)],
    [...dataBlock(7,bytes), ...dataBlock(0x47,compressed), ...copyRam(17,0xc000,17)],
  ]) {
    const result = await extractVgmInstruments(vgm([
      ...pulse, ...ram(0xc000,bytes), ...commands, ...setup(), ...w(0x15,16), 0x66,
    ]));
    assert.equal(sounds(result).length,0);
    assert.match(messages(result), /(?:bank|copy|compressed|RAM).*(?:unknown|incomplete|unavailable|unsupported|not supported|outside|range|invalidat)/i);
  }
  const repaired = await extractVgmInstruments(vgm([
    ...pulse, ...ram(0xc000,bytes), ...copyRam(0,0xc000,17), ...setup(), ...w(0x15,16), ...w(0x15,0),
    ...ram(0xc000,bytes), ...w(0x11,64), ...w(0x15,16), 0x66,
  ]));
  assert.equal(sounds(repaired).length,1); assert.equal(sounds(repaired)[0].occurrences,1);
  assert.deepEqual(sounds(repaired)[0].preset.dmc.data,bytes);
});

test('invalid NES RAM-copy destinations, zero-length expansion and second-chip copies fail safely', async () => {
  for (const commands of [
    copyRam(0,0xffff,2), copyRam(0,0x10000,1), copyRam(0,0xc000,0), copyRam(0,0xc000,1,0x87),
  ]) await assert.rejects(extractVgmInstruments(vgm([...pulse,...commands,0x66])), /RAM|Second|chip|range|copy/i);
});

test('small-input repeated RAM copies cannot exceed the bounded cumulative NES transfer budget', async () => {
  const bank = Array.from({length:65536},(_,index)=>index & 255);
  const copies = Array.from({length:2049},()=>copyRam(0,0,65536)).flat();
  const source = vgm([...pulse,...dataBlock(7,bank),...copies,0x66]);
  assert(source.length < 100000, 'the fixture exhausts work rather than the input-size limit');
  await assert.rejects(extractVgmInstruments(source), /128 MiB.*(?:RAM|transfer)|(?:RAM|transfer).*128 MiB/i);
});

test('missing DMC RAM or required start settings omit the sample instead of filling zeros or demo bytes', async () => {
  const bytes = dpcm17();
  for (const commands of [
    [...setup(), ...w(0x15,16)],
    [...ram(0xc000,bytes.slice(0,-1)), ...setup(), ...w(0x15,16)],
    [...dataBlock(0xc1,[0,0xc0,...bytes]), ...setup(), ...w(0x15,16)],
    [...ram(0xc000,bytes), ...w(0x11,64), ...w(0x12,0), ...w(0x13,1), ...w(0x15,16)],
    [...ram(0xc000,bytes), ...w(0x10,15), ...w(0x11,64), ...w(0x13,1), ...w(0x15,16)],
    [...ram(0xc000,bytes), ...w(0x10,15), ...w(0x11,64), ...w(0x12,0), ...w(0x15,16)],
  ]) {
    const result = await extractVgmInstruments(vgm([...pulse, ...commands, 0x66]));
    assert.equal(sounds(result).length, 0);
    assert.match(messages(result), /DMC.*(?:missing|unknown|incomplete|unrecorded|not recorded)|(?:missing|unknown|incomplete|unrecorded).*DMC/i);
  }
});

test('DMC address wrapping and both hardware length endpoints preserve exactly the addressed bytes', async () => {
  const first = Array.from({length:64},(_,index)=>index ^ 0x5a), last = 0xe7;
  const wrapped = await extractVgmInstruments(vgm([
    ...ram(0xffc0,first), ...ram(0x8000,[last]), ...setup({address:255, length:4}), ...w(0x15,16), 0x66,
  ]));
  assert.deepEqual(sounds(wrapped)[0].preset.dmc.data,[...first,last]);
  for (const length of [1,4081]) {
    const bytes = Array.from({length},(_,index)=>(index * 17 + 0x55) & 255);
    const result = await extractVgmInstruments(vgm([...ram(0xc000,bytes), ...setup({length:(length - 1) / 16}), ...w(0x15,16), 0x66]));
    assert.deepEqual(sounds(result)[0].preset.dmc.data,bytes);
  }
});

test('an active DMC reader ignores repeated enabled masks and preloaded next-sample registers', async () => {
  const bytes = createDemoDpcm();
  const result = await extractVgmInstruments(vgm([
    ...ram(0xc000,bytes), ...setup({loop:true, length:16}), ...w(0x15,16),
    ...w(0x15,17), ...w(0x15,31), ...wait(1000), ...w(0x12,255), ...w(0x13,255),
    ...w(0x15,16), ...w(0x15,17), 0x66,
  ]));
  const voices = sounds(result);
  assert.equal(voices.length, 1); assert.equal(voices[0].occurrences, 1);
  assert.deepEqual(voices[0].preset.dmc.data,bytes);
});

test('hours of loop waits advance arithmetically without publishing automatic sample restarts', {timeout:5000}, async () => {
  const waits = Array.from({length:50000},()=>wait(65535)).flat();
  const result = await extractVgmInstruments(vgm([
    ...ram(0xc000,createDemoDpcm()), ...setup({loop:true, length:16}), ...w(0x15,16), ...waits, ...w(0x15,0), 0x66,
  ]));
  assert.equal(sounds(result).length,1); assert.equal(sounds(result)[0].occurrences,1);
  assert.equal(sounds(result)[0].firstTime,0);
});

test('a completed one-shot can retrigger by writing the already-enabled DMC bit again', async () => {
  const result = await extractVgmInstruments(vgm([
    ...ram(0xc000,dpcm17()), ...setup(), ...w(0x15,16), ...wait(1000),
    ...w(0x11,64), ...w(0x15,16), 0x66,
  ]));
  assert.equal(sounds(result).length, 1); assert.equal(sounds(result)[0].occurrences, 2);
});

test('a one-byte immediate reload is captured once without mistaking the next enabled mask for another trigger', async () => {
  const result = await extractVgmInstruments(vgm([
    ...ram(0xc000,[0xa5]), ...setup({length:0}), ...w(0x15,16), ...w(0x15,16), ...w(0x15,16), 0x66,
  ]));
  assert.equal(sounds(result).length,1); assert.equal(sounds(result)[0].occurrences,2);
});

test('live DMC rate changes and short DAC-waits advance reader completion without replaying the song', async () => {
  const result = await extractVgmInstruments(vgm([
    ...ram(0xc000,createDemoDpcm()), ...setup({rate:0, length:16}), ...w(0x15,16),
    ...wait(1000), ...w(0x10,15), ...wait(5000), ...w(0x11,64), ...w(0x15,16),
    ...Array(40).fill(0x8f), ...Array(150).fill(0x7f), ...w(0x11,64), ...w(0x15,16), 0x66,
  ]));
  assert.deepEqual(sounds(result).map(voice=>[voice.preset.dmc.rate,voice.occurrences]), [[0,1],[15,2]]);
  // Both wait forms contribute: 600 + 2,400 samples exceed the fast pass's
  // ~2,736 samples, but neither wait group would complete it by itself.
});

test('PAL source timing decides DMC completion before auditioning at the Synth NTSC clock', async () => {
  const result = await extractVgmInstruments(vgm([
    ...ram(0xc000,createDemoDpcm()), ...setup({rate:0, length:16}), ...w(0x15,16),
    ...wait(22000), ...w(0x11,64), ...w(0x15,16), 0x66,
  ],1662607));
  // PAL's 398-cycle bit period fetches this sample's last byte before the
  // wait ends; using the 428-cycle NTSC table at this source clock would not.
  assert.equal(sounds(result).length,1); assert.equal(sounds(result)[0].occurrences,2);
  assert.match(result.warnings.join(' '), /different.*clock|NTSC/i);
});

test('an unknown or progressed DMC DAC start is disclosed as an audition approximation', async () => {
  const unknown = await extractVgmInstruments(vgm([
    ...ram(0xc000,dpcm17()), ...w(0x10,15), ...w(0x12,0), ...w(0x13,1), ...w(0x15,16), 0x66,
  ]));
  assert.equal(sounds(unknown)[0].preset.dmc.level,64);
  assert.match(sounds(unknown)[0].warnings.join(' '), /(?:level|DAC).*(?:unknown|not recorded|assum|64|approximat)/i);
  const progressed = await extractVgmInstruments(vgm([
    ...ram(0xc000,dpcm17()), ...setup(), ...w(0x15,16), ...wait(1000), ...w(0x15,0), ...w(0x15,16), 0x66,
  ]));
  assert(sounds(progressed).length >= 1);
  assert.match(messages(progressed), /(?:level|DAC).*(?:progress|approximat|last|restart)/i);
});

test('direct DAC PCM is not misidentified as encoded DPCM and unsupported NES streams are explicit', async () => {
  const result = await extractVgmInstruments(vgm([
    ...pulse, ...w(0x11,10), ...wait(1), ...w(0x11,120), ...wait(1), ...w(0x11,30),
    0x90,0,0x14,0,0x11, 0x66,
  ]));
  assert.equal(sounds(result).length,0);
  assert.match(result.warnings.join(' '), /(?:direct.*(?:DAC|PCM)|(?:DAC|PCM).*direct)/i);
  assert.match(result.warnings.join(' '), /(?:stream.*not imported|not imported.*stream)/i);
});

test('unsupported NES register streams cannot leave stale DMC settings looking like a new recovered voice', async () => {
  const result = await extractVgmInstruments(vgm([
    ...pulse, ...ram(0xc000,dpcm17()), ...setup(), ...w(0x15,16), ...w(0x15,0),
    ...dataBlock(0,[8]),
    0x90,0,0x14,0,0x10, // NES stream targets the rate/control register.
    0x91,0,0,1,0,
    0x92,0,...u32(100),
    0x93,0,...u32(0),1,...u32(1), ...wait(441),
    ...w(0x15,16), 0x66,
  ]));
  assert.equal(sounds(result).length,1); assert.equal(sounds(result)[0].occurrences,1);
  assert.equal(sounds(result)[0].preset.dmc.rate,15, 'the valid pre-stream snapshot stays available');
  assert.match(result.warnings.join(' '), /stream/i);
});

test('stopping an unsupported NES stream needs a known DMC off before direct settings can recover extraction', async () => {
  const result = await extractVgmInstruments(vgm([
    ...ram(0xc000,dpcm17()), ...setup(), ...w(0x15,16), ...w(0x15,0),
    ...dataBlock(0,[16]),
    0x90,0,0x14,0,0x15, // The unsupported stream can enable the sample reader.
    0x91,0,0,1,0, 0x92,0,...u32(100), 0x93,0,...u32(0),1,...u32(1),
    ...wait(1), 0x94,0,
    ...setup({rate:7,loop:true,level:48}), ...w(0x15,16),
    ...w(0x15,0), ...setup({rate:7,loop:true,level:48}), ...w(0x15,16), 0x66,
  ]));
  assert.deepEqual(sounds(result).map(voice=>[voice.preset.dmc.rate,voice.occurrences]), [[15,1],[7,1]]);
});

test('malformed or second-chip NES RAM cannot publish a recovered library', async () => {
  for (const commands of [
    dataBlock(0xc2,[0]),
    ram(0xffff,[0xaa,0x55]),
    dataBlock(0xc2,[0,0xc0,0xaa],true),
    [0x67,0x66,0xc2,...u32(100),0,0xc0,0xaa],
  ]) await assert.rejects(extractVgmInstruments(vgm([...pulse, ...commands, 0x66])), /RAM|Second|truncated/i);
});

test('recovered DMC survives preset and JavaScript export and plays through actual WASM', async t => {
  const [voice] = sounds(await extractVgmInstruments(complete()));
  const portable = readPreset(JSON.parse(JSON.stringify(voice.preset)));
  assert.deepEqual(portable,voice.preset);
  const uploads = [], writes = [];
  const nes = new NesApuSynth({transport:{writeRegister:(address,value)=>writes.push([address,value]),loadMemory:(bytes,address)=>uploads.push([address,[...bytes]])}});
  writes.length = 0;
  await vm.runInNewContext(`(async () => {${presetToCode(portable)}\n})()`, {nes,Uint8Array});
  assert.deepEqual(uploads,[[0xc000,portable.dmc.data]]);
  assert(writes.some(([address,value])=>address===0x4010 && value===0x47));
  const wasmBinary = await readFile(new URL('../generated/nesapu_wasm.wasm',import.meta.url));
  for (const sampleRate of [44100,48000]) {
    const core = await NesApuWasm.create({moduleFactory:factory,moduleOptions:{wasmBinary},sampleRate,fds:true});
    const instrument = new NesInstrument(core); t.after(()=>instrument.dispose());
    instrument.loadPreset(portable); instrument.noteOn('recovered',60);
    const pcm = instrument.generateStereo(4096);
    assert(pcm.left.every(Number.isFinite) && pcm.right.every(Number.isFinite));
    assert(pcm.left.some(value=>Math.abs(value)>.0001),`recovered DMC is audible at ${sampleRate}`);
    assert.equal(core.readMemory(0xc000),portable.dmc.data[0]);
    assert.equal(core.getState().registers[0x10],0x47);
  }
});

// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import {readFile} from 'node:fs/promises';
import factory from '../generated/nesapu_wasm.js';
import {NesApuWasm} from '../js/nesapu_wasm.js';
import {NesInstrument} from './instrument.js';
import {readPreset} from './preset.js';
import {extractVgmInstruments, MAX_VGM_BYTES} from './vgm_import.js';

const w = (register, value) => [0xb4, register, value];
const wait = [0x61, 0xe8, 3]; // 1,000 VGM samples.
const wave = Array.from({length:64}, (_, index) => index);
const mod = Array.from({length:32}, (_, index) => index % 8);
const power = w(0x15, 0x0f);
const pulse1 = [...w(0, 0xb9), ...w(1, 0x8a), ...w(2, 0x40), ...w(3, 0x09)];
const pulse2 = [...w(4, 0x7a), ...w(5, 8), ...w(6, 0x55), ...w(7, 0x09)];
const triangle = [...w(8, 0xff), ...w(0x0a, 0x80), ...w(0x0b, 8)];
const noise = [...w(0x0c, 0x3b), ...w(0x0e, 0x86), ...w(0x0f, 8)];
const waveWrites = values => values.flatMap((value, index) => w(0x40 + index, value));
const modWrites = values => values.flatMap(value => w(0x28, value));
const fdsTables = [...w(0x3f, 2), ...w(0x23, 0x80), ...w(0x29, 0x80), ...waveWrites(wave),
  ...w(0x29, 1), ...w(0x27, 0x80), ...modWrites(mod)];
const fdsParameters = [...w(0x20, 0x98), ...w(0x24, 0x90), ...w(0x25, 127), ...w(0x26, 0x78), ...w(0x27, 1)];
const fdsNote = [...w(0x22, 0x90), ...w(0x23, 1)];
function vgm(commands, clock = 1789773, fds = true) {
  const bytes = new Uint8Array(0x100 + commands.length);
  bytes.set([86, 103, 109, 32]);
  const view = new DataView(bytes.buffer);
  view.setUint32(4, bytes.length - 4, true); view.setUint32(8, 0x171, true);
  view.setUint32(0x34, 0xcc, true); view.setUint32(0x84, (clock | (fds ? 0x80000000 : 0)) >>> 0, true);
  bytes.set(commands, 0x100); return bytes;
}
const complete = () => vgm([...power, ...pulse1, ...wait, ...pulse2, ...wait,
  ...w(6, 0x66), ...w(7, 0x0a), ...wait, ...triangle, ...wait, ...noise,
  ...wait, ...fdsTables, ...fdsParameters, ...fdsNote, 0x66]);
const fdsVoices = result => result.voices.filter(voice => voice.kind === 'fds');
const volumeEnvelopeState = voice => ({...voice.preset.fds.envelope,...voice.preset.fds.envelopeClock});

test('NES VGM maps five channel definitions and ignores pitch-only differences when grouping sounds', async () => {
  const result = await extractVgmInstruments(complete());
  assert.deepEqual(result.voices.map(({kind, channel, firstTime, occurrences}) => [kind, channel, firstTime, occurrences]), [
    ['pulse', 1, 0, 1], ['pulse', 2, 1000, 2], ['triangle', 3, 3000, 1], ['noise', 4, 4000, 1], ['fds', 6, 5000, 1],
  ]);
  const [a, b, c, d, e] = result.voices.map(voice => voice.preset);
  assert.deepEqual(a.pulse, {duty:.5, volume:9, envelope:{enabled:false, period:9, loop:true},
    sweep:{enabled:true, period:0, negate:true, shift:2}});
  assert.equal(b.pulse.duty, .25); assert.equal(b.pulse.volume, 10);
  assert.equal(c.source, 'triangle');
  assert.deepEqual(d.noise, {volume:11, period:6, shortMode:true, envelope:{enabled:false, period:11, loop:true}});
  assert.deepEqual(e.fds, {wave, volume:24, master:1,
    envelope:{enabled:false,increase:false,period:24,initialGain:24},envelopeClock:{masterSpeed:232,halt:false},
    modulation:{enabled:true, table:mod, rate:0x178, depth:16, bias:-1,envelope:{enabled:false,increase:false,period:16,initialGain:16}}});
  for (const voice of result.voices) assert.deepEqual(readPreset(voice.preset), voice.preset);
  assert.equal(result.timebase, 44100);
});

test('Pulse and Noise hardware envelopes retain their recorded initial settings', async () => {
  const result = await extractVgmInstruments(vgm([...power,
    ...w(0, 0x80 | 0x20 | 7), ...w(1, 8), ...w(2, 0x40), ...w(3, 9),
    ...w(0x0c, 2), ...w(0x0e, 5), ...w(0x0f, 8), 0x66]));
  const p = result.voices.find(voice => voice.kind === 'pulse');
  assert.deepEqual(p.preset.pulse.envelope, {enabled:true, period:7, loop:true});
  const n = result.voices.find(voice => voice.kind === 'noise');
  assert.equal(n.preset.noise.volume, 15);
  assert.deepEqual(n.preset.noise.envelope, {enabled:true, period:2, loop:false});
  assert(!n.warnings.some(message => /Noise.*Envelope.*fixed volume|decay.*not imported/i.test(message)));
  assert(!result.warnings.some(message => /Noise.*Envelope.*fixed volume|decay.*not imported/i.test(message)));
  assert(result.warnings.some(message => /Initial settings only.*later register changes/i.test(message)));
});

test('Noise Envelope period and loop distinguish voices, period zero is audible, and fixed zero is omitted', async () => {
  const attacks = [0x30, 0, 15, 0x2f, 0x3b, 0x2f].flatMap(control => [
    ...w(0x15, 0), ...w(0x0c, control), ...w(0x0e, 0x85), ...w(0x15, 8), ...w(0x0f, 8), ...wait,
  ]);
  const result = await extractVgmInstruments(vgm([...attacks, 0x66]));
  assert.deepEqual(result.voices.map(voice => [voice.preset.noise, voice.occurrences]), [
    [{volume:15, period:5, shortMode:true, envelope:{enabled:true, period:0, loop:false}}, 1],
    [{volume:15, period:5, shortMode:true, envelope:{enabled:true, period:15, loop:false}}, 1],
    [{volume:15, period:5, shortMode:true, envelope:{enabled:true, period:15, loop:true}}, 2],
    [{volume:11, period:5, shortMode:true, envelope:{enabled:false, period:11, loop:true}}, 1],
  ]);
  assert.equal(result.voices[0].firstTime, 1000, 'the preceding silent fixed-volume trigger is not a voice');
  assert(result.voices.every(voice => voice.kind === 'noise' && voice.channel === 4));
  for (const voice of result.voices) assert.deepEqual(readPreset(voice.preset), voice.preset);
});

test('APU enable masks gate real trigger writes, while known silent attacks can open through later control writes', async () => {
  const ignored = vgm([...w(0x15, 0), ...pulse1, ...w(0x15, 1), 0x66]);
  await assert.rejects(extractVgmInstruments(ignored), /No complete|No .*voices/i);
  const result = await extractVgmInstruments(vgm([...w(0x15, 0x0d),
    ...w(0, 0xb0), ...w(1, 8), ...w(2, 0x40), ...w(3, 9), ...wait, ...w(0, 0xb7),
    ...w(8, 0x80), ...w(0x0a, 0x80), ...w(0x0b, 8), ...wait, ...w(8, 0xff),
    ...w(0x0c, 0x30), ...w(0x0e, 6), ...w(0x0f, 8), ...wait, ...w(0x0c, 0x3c), 0x66]));
  assert.deepEqual(result.voices.map(voice => [voice.kind, voice.firstTime]), [['pulse', 1000], ['triangle', 2000], ['noise', 3000]]);
  assert.equal(result.voices[0].preset.pulse.volume, 7);
  assert.equal(result.voices[2].preset.noise.volume, 12);
});

test('FDS volume written after frequency can open the gate, and fixed modulation depth retains all six bits', async () => {
  const result = await extractVgmInstruments(vgm([...fdsTables,
    ...w(0x20, 0x80), ...w(0x24, 0xbf), ...w(0x25, 64), ...w(0x26, 0x56), ...w(0x27, 3),
    ...fdsNote, ...wait, ...w(0x20, 0x98), 0x66]));
  const [voice] = fdsVoices(result);
  assert.equal(fdsVoices(result).length, 1); assert.equal(voice.firstTime, 1000);
  assert.equal(voice.preset.fds.volume, 24); assert.equal(voice.preset.fds.modulation.depth, 63);
  assert.equal(voice.preset.fds.modulation.bias, -64); assert.equal(voice.preset.fds.modulation.rate, 0x356);
});

test('FDS active-frequency setup becomes importable when Wave RAM write mode closes', async () => {
  const result = await extractVgmInstruments(vgm([
    ...w(0x3f, 2), ...w(0x23, 1), ...w(0x22, 0x90), ...w(0x20, 0x98), ...w(0x27, 0x80),
    ...w(0x29, 0x80), ...waveWrites(wave), ...wait, ...w(0x29, 2), 0x66]));
  const [voice] = fdsVoices(result);
  assert.equal(fdsVoices(result).length, 1); assert.equal(voice.firstTime, 1000);
  assert.deepEqual(voice.preset.fds.wave, wave); assert.equal(voice.preset.fds.master, 2);
  assert(voice.warnings.some(message => /neutral table|not completely recorded/i.test(message)));
});

test('FDS zero-gain upward envelopes stay silent until their known envelope clock resumes', async () => {
  for (const {setup, resume} of [
    {setup:[...w(0x23, 0x41)], resume:w(0x23, 1)},
    {setup:[...w(0x2a, 0), ...w(0x23, 1)], resume:w(0x2a, 1)},
  ]) {
    const result = await extractVgmInstruments(vgm([...power, ...pulse2, ...fdsTables,
      ...w(0x20, 0x80), ...w(0x20, 0x40), ...w(0x22, 0x90), ...setup,
      ...wait, ...resume, 0x66]));
    const voices = fdsVoices(result);
    assert.equal(voices.length, 1); assert.equal(voices[0].firstTime, 1000);
    assert.equal(voices[0].preset.fds.envelope.initialGain, 0);
    assert.equal(voices[0].preset.fds.envelope.enabled, true);
    assert.equal(voices[0].preset.fds.envelope.increase, true);
    assert.equal(voices[0].preset.fds.envelopeClock.halt, false);
    assert(!voices[0].warnings.some(message => /volume Envelope.*fixed volume/i.test(message)));
  }
});

test('FDS frequency-low and modulation-enable writes can finish audible instrument setup', async () => {
  const lowFrequency = await extractVgmInstruments(vgm([...fdsTables, ...w(0x20, 0x98),
    ...w(0x22, 0), ...w(0x23, 0), ...wait, ...w(0x22, 0x90), 0x66]));
  assert.equal(fdsVoices(lowFrequency).length, 1);
  assert.equal(fdsVoices(lowFrequency)[0].firstTime, 1000);
  const enablingMod = await extractVgmInstruments(vgm([...fdsTables, ...w(0x20, 0x98),
    ...w(0x24, 0x90), ...w(0x26, 0x78), ...w(0x27, 0x81), ...fdsNote,
    ...wait, ...w(0x27, 1), 0x66]));
  assert.deepEqual(fdsVoices(enablingMod).map(voice => [voice.firstTime, voice.preset.fds.modulation.enabled]), [[0, false], [1000, true]]);
});

test('unknown or rejected FDS RAM writes are never replaced with the default factory wave or enabled modulation', async () => {
  const incompleteWave = await extractVgmInstruments(vgm([...power, ...pulse2, ...w(0x3f, 2), ...w(0x29, 0x80),
    ...waveWrites(wave.slice(0, 63)), ...w(0x29, 0), ...fdsParameters, ...fdsNote, 0x66]));
  assert.equal(fdsVoices(incompleteWave).length, 0); assert(incompleteWave.warnings.some(message => /incomplete.*Wave RAM/i.test(message)));
  const rejectedWrite = await extractVgmInstruments(vgm([...power, ...pulse2, ...w(0x3f, 2),
    ...waveWrites(wave), ...fdsParameters, ...fdsNote, 0x66]));
  assert.equal(fdsVoices(rejectedWrite).length, 0); assert(rejectedWrite.warnings.some(message => /write gate/i.test(message)));
  const incompleteMod = await extractVgmInstruments(vgm([...power, ...pulse2,
    ...w(0x3f, 2), ...w(0x23, 0x80), ...w(0x29, 0x80), ...waveWrites(wave), ...w(0x29, 0),
    ...w(0x27, 0x80), ...modWrites(mod.slice(0, 31)), ...fdsParameters, ...fdsNote, 0x66]));
  assert.equal(fdsVoices(incompleteMod).length, 0); assert(incompleteMod.warnings.some(message => /incomplete modulation/i.test(message)));
  const disabledPartialMod = await extractVgmInstruments(vgm([
    ...w(0x3f, 2), ...w(0x23, 0x80), ...w(0x29, 0x80), ...waveWrites(wave), ...w(0x29, 0),
    ...w(0x27, 0x80), ...modWrites(mod.slice(0, 31)), ...w(0x20, 0x98), ...fdsNote, 0x66]));
  const [disabled] = fdsVoices(disabledPartialMod);
  assert.equal(disabled.preset.fds.modulation.enabled, false);
  assert.deepEqual(disabled.preset.fds.modulation.table, Array(32).fill(0));
  assert(disabled.warnings.some(message => /not completely recorded.*disabled.*neutral/i.test(message)));
});

test('FDS modulation write phase after running is explicit, including quiet playback and DAC-wait commands', async () => {
  const replacement = Array.from({length:32}, (_, index) => (index + 3) % 8);
  const result = await extractVgmInstruments(vgm([...fdsTables,
    ...w(0x20, 0x80), ...w(0x24, 0x90), ...w(0x25, 0), ...w(0x26, 0x80), ...w(0x27, 1), ...fdsNote,
    0x8f, ...w(0x27, 0x81), ...modWrites(replacement), ...w(0x27, 1), ...w(0x20, 0x98), ...w(0x23, 1), 0x66]));
  const voices = fdsVoices(result);
  assert(voices.length >= 1);
  assert(voices.every(voice => voice.preset.fds.modulation.table.every(Number.isInteger)));
  const voice = voices.find(voice => JSON.stringify(voice.preset.fds.modulation.table) === JSON.stringify(replacement));
  assert(voice); assert(voice.warnings.some(message => /phase.*unknown|written order/i.test(message)));
  assert(voice.warnings.some(message => /phase.*counter|counter progress/i.test(message)));
});

test('FDS volume and modulation Envelopes retain their controls with explicit unknown initial-gain notes', async () => {
  const result = await extractVgmInstruments(vgm([...fdsTables, ...w(0x20, 0x40), ...w(0x24, 0x40),
    ...w(0x25, 0), ...w(0x26, 0x80), ...w(0x27, 1), ...fdsNote, 0x66]));
  const [voice] = fdsVoices(result);
  assert.equal(voice.preset.fds.volume, 32); assert.equal(voice.preset.fds.modulation.depth, 32);
  assert.deepEqual(volumeEnvelopeState(voice),{enabled:true,increase:true,period:0,masterSpeed:232,initialGain:0,halt:false});
  assert.deepEqual(voice.preset.fds.modulation.envelope,{enabled:true,increase:true,period:0,initialGain:0});
  assert(voice.warnings.some(message => /volume Envelope initial gain.*not recorded/i.test(message)));
  assert(voice.warnings.some(message => /master Envelope speed.*not recorded/i.test(message)));
  assert(!voice.warnings.some(message => /volume Envelope.*fixed volume/i.test(message)));
  assert(voice.warnings.some(message => /modulation Envelope initial gain.*not recorded/i.test(message)));
  assert(!voice.warnings.some(message => /modulation Envelope.*fixed depth/i.test(message)));
});

test('FDS volume Envelope imports direction, divider, master speed, halt and all six initial-gain bits', async () => {
  const variants = [
    {gain:63,control:3,speed:12,halt:false},
    {gain:0,control:0x44,speed:12,halt:false},
    {gain:0,control:0x44,speed:13,halt:false},
    {gain:1,control:0x44,speed:13,halt:true},
    {gain:63,control:3,speed:12,halt:false},
  ];
  const commands = variants.flatMap(({gain,control,speed,halt}) => [
    ...w(0x23,0xc0), ...w(0x20,0x80|gain), ...w(0x20,control), ...w(0x2a,speed),
    ...w(0x22,0x90), ...w(0x23,halt?0x41:1), ...wait,
  ]);
  const result = await extractVgmInstruments(vgm([...fdsTables,...commands,0x66]));
  const voices = fdsVoices(result);
  assert.deepEqual(voices.map(voice => [volumeEnvelopeState(voice),voice.occurrences]),[
    [{enabled:true,increase:false,period:3,masterSpeed:12,initialGain:63,halt:false},2],
    [{enabled:true,increase:true,period:4,masterSpeed:12,initialGain:0,halt:false},1],
    [{enabled:true,increase:true,period:4,masterSpeed:13,initialGain:0,halt:false},1],
    [{enabled:true,increase:true,period:4,masterSpeed:13,initialGain:1,halt:true},1],
  ]);
  assert.equal(voices[0].preset.fds.volume,32,'the separate fixed-volume control retains its output-scale limit');
  assert(voices.every(voice => !voice.warnings.some(message => /volume Envelope.*fixed volume|initial gain.*not recorded|master Envelope speed.*not recorded/i.test(message))));
});

test('audible FDS Envelope control and master-speed changes create distinct captured settings', async () => {
  const result = await extractVgmInstruments(vgm([...fdsTables,
    ...w(0x20,0xa0), ...w(0x20,1), ...w(0x2a,4), ...fdsNote,
    ...w(0x2a,5), ...w(0x20,2), ...w(0x20,0x42), 0x66]));
  assert.deepEqual(fdsVoices(result).map(volumeEnvelopeState),[
    {enabled:true,increase:false,period:1,masterSpeed:4,initialGain:32,halt:false},
    {enabled:true,increase:false,period:1,masterSpeed:5,initialGain:32,halt:false},
    {enabled:true,increase:false,period:2,masterSpeed:5,initialGain:32,halt:false},
    {enabled:true,increase:true,period:2,masterSpeed:5,initialGain:32,halt:false},
  ]);
});

test('frozen FDS volume Envelope preserves its known gain while a running timer makes the restart approximate', async () => {
  for (const {speed,halt} of [{speed:0,halt:false},{speed:7,halt:true}]) {
    const result = await extractVgmInstruments(vgm([...fdsTables,
      ...w(0x20,0x84), ...w(0x20,0x41), ...w(0x2a,speed), ...w(0x22,0x90), ...w(0x23,halt?0x41:1),
      ...wait, ...w(0x20,0x53), 0x66]));
    const voices = fdsVoices(result);
    assert.equal(voices.length,2);
    assert(voices.every(voice => voice.preset.fds.envelope.initialGain===4));
    assert(voices.every(voice => voice.preset.fds.envelopeClock.masterSpeed===speed&&voice.preset.fds.envelopeClock.halt===halt));
    assert(voices.every(voice => !voice.warnings.some(message => /unknown current gain|initial gain.*not recorded/i.test(message))));
  }
  const progressed = await extractVgmInstruments(vgm([...fdsTables,
    ...w(0x20,0x98), ...w(0x20,63), ...w(0x2a,255), ...fdsNote,
    0x70, ...w(0x23,1), 0x66]));
  const [initial,later] = fdsVoices(progressed);
  assert.equal(initial.preset.fds.envelope.initialGain,24);
  assert.equal(later.preset.fds.envelope.initialGain,32);
  assert(later.warnings.some(message => /clock had already run.*approximate gain 32.*timer phase/i.test(message)));
});

test('known silent FDS Envelope endpoints remain omitted until an upward running clock can open them', async () => {
  for (const {control,speed,high} of [{control:3,speed:7,high:1},{control:0x43,speed:0,high:1},{control:0x43,speed:7,high:0x41}]) {
    const result = await extractVgmInstruments(vgm([...power,...pulse2,...fdsTables,
      ...w(0x20,0x80), ...w(0x20,control), ...w(0x2a,speed), ...w(0x22,0x90), ...w(0x23,high), 0x66]));
    assert.equal(fdsVoices(result).length,0);
  }
});

test('FDS depth Envelope preserves raw gain, direction, divider and the shared clock for active or halted modulation', async () => {
  const variants=[
    {gain:63,control:3,speed:12,halt:false,modEnabled:true},
    {gain:0,control:0x44,speed:12,halt:false,modEnabled:true},
    {gain:0,control:0x44,speed:13,halt:false,modEnabled:true},
    {gain:1,control:0x44,speed:13,halt:true,modEnabled:true},
    {gain:7,control:8,speed:0,halt:false,modEnabled:false},
    {gain:63,control:3,speed:12,halt:false,modEnabled:true},
  ];
  const commands=variants.flatMap(({gain,control,speed,halt,modEnabled})=>[
    ...w(0x23,0xc0),...w(0x20,0x98),...w(0x24,0x80|gain),...w(0x24,control),...w(0x2a,speed),
    ...w(0x26,0x80),...w(0x27,modEnabled?1:0x81),...w(0x22,0x90),...w(0x23,halt?0x41:1),...wait,
  ]);
  const voices=fdsVoices(await extractVgmInstruments(vgm([...fdsTables,...commands,0x66])));
  assert.deepEqual(voices.map(voice=>[voice.preset.fds.modulation.envelope,voice.preset.fds.envelopeClock,voice.occurrences]),[
    [{enabled:true,increase:false,period:3,initialGain:63},{masterSpeed:12,halt:false},2],
    [{enabled:true,increase:true,period:4,initialGain:0},{masterSpeed:12,halt:false},1],
    [{enabled:true,increase:true,period:4,initialGain:0},{masterSpeed:13,halt:false},1],
    [{enabled:true,increase:true,period:4,initialGain:1},{masterSpeed:13,halt:true},1],
    [{enabled:true,increase:false,period:8,initialGain:7},{masterSpeed:0,halt:false},1],
  ]);
  assert.equal(voices[0].preset.fds.modulation.depth,63,'the fixed-depth fallback retains all six raw bits');
  assert.equal(voices[4].preset.fds.modulation.enabled,false,'a halted table retains its independently configured Envelope');
  assert(voices.every(voice=>!voice.warnings.some(message=>/modulation Envelope.*fixed depth|initial gain.*not recorded|master Envelope speed.*not recorded/i.test(message))));
});

test('audible depth-Envelope control changes are captured and missing initial gain or shared clock is explicit', async () => {
  const voices=fdsVoices(await extractVgmInstruments(vgm([...fdsTables,...w(0x20,0x98),
    ...w(0x24,0x8a),...w(0x24,1),...w(0x2a,4),...w(0x26,0x80),...w(0x27,1),...fdsNote,
    ...w(0x24,2),...w(0x24,0x42),...w(0x2a,5),0x66])));
  assert.deepEqual(voices.map(voice=>[voice.preset.fds.modulation.envelope,voice.preset.fds.envelopeClock]),[
    [{enabled:true,increase:false,period:1,initialGain:10},{masterSpeed:4,halt:false}],
    [{enabled:true,increase:false,period:2,initialGain:10},{masterSpeed:4,halt:false}],
    [{enabled:true,increase:true,period:2,initialGain:10},{masterSpeed:4,halt:false}],
    [{enabled:true,increase:true,period:2,initialGain:10},{masterSpeed:5,halt:false}],
  ]);
  for(const increase of [false,true]) {
    const [voice]=fdsVoices(await extractVgmInstruments(vgm([...fdsTables,...w(0x20,0x98),
      ...w(0x24,(increase?64:0)|15),...w(0x26,0x80),...w(0x27,1),...fdsNote,0x66])));
    assert.deepEqual(voice.preset.fds.modulation.envelope,{enabled:true,increase,period:15,initialGain:increase?0:32});
    assert.deepEqual(voice.preset.fds.envelopeClock,{masterSpeed:232,halt:false});
    assert(voice.warnings.some(message=>/modulation Envelope initial gain.*not recorded/i.test(message)));
    assert.equal(voice.warnings.filter(message=>/master Envelope speed.*not recorded/i.test(message)).length,1);
    assert(!voice.warnings.some(message=>/modulation Envelope.*fixed depth/i.test(message)));
  }
});

test('depth Envelope gain is preserved while the shared clock is frozen but becomes approximate across independent table, waveform or I/O halts', async () => {
  for(const {speed,halt}of [{speed:0,halt:false},{speed:7,halt:true}]) {
    const voices=fdsVoices(await extractVgmInstruments(vgm([...fdsTables,...w(0x20,0x98),
      ...w(0x24,0x87),...w(0x24,0x43),...w(0x2a,speed),...w(0x22,0x90),...w(0x23,halt?0x41:1),
      ...wait,...w(0x24,0x44),0x66])));
    assert.equal(voices.length,2);
    assert(voices.every(voice=>voice.preset.fds.modulation.envelope.initialGain===7));
    assert(voices.every(voice=>!voice.warnings.some(message=>/modulation Envelope clock had already run/i.test(message))));
  }
  for(const ioDisabled of [false,true]) {
    const voices=fdsVoices(await extractVgmInstruments(vgm([...fdsTables,...w(0x20,0x98),
      ...w(0x24,0x8a),...w(0x24,15),...w(0x2a,7),...w(0x22,0x90),...w(0x23,0x81),
      ...(ioDisabled?w(0x3f,0):[]),...wait,...(ioDisabled?w(0x3f,2):[]),...w(0x23,1),0x66])));
    const voice=voices.at(-1);
    assert.equal(voice.preset.fds.modulation.enabled,false);
    assert.equal(voice.preset.fds.modulation.envelope.initialGain,32);
    assert(voice.warnings.some(message=>/modulation Envelope clock had already run.*approximate gain 32.*timer phase/i.test(message)));
    assert(voice.warnings.some(message=>/neutral table|not completely recorded/i.test(message))===false,'the authored halted modulation table is still retained');
  }
});

test('unused DMC setup and opaque other-chip blocks cannot fabricate playable NES voices', async () => {
  const fakeCommands = [...pulse1, 0x66];
  const opaque = [0x67, 0x66, 0, fakeCommands.length, 0, 0, 0, ...fakeCommands];
  const nesRam = [0x67, 0x66, 0xc2, 4, 0, 0, 0, 0, 0xc0, 0xaa, 0x55];
  const result = await extractVgmInstruments(vgm([...power, ...opaque, ...nesRam, ...w(0x10, 0x4f), ...pulse2, 0x66]));
  assert.deepEqual(result.voices.map(voice => [voice.kind, voice.channel]), [['pulse', 2]]);
});

test('VGZ round-trips settings and rejects malformed, non-NES, dual-chip, missing-end and truncated input', async () => {
  const source = complete();
  assert.deepEqual(await extractVgmInstruments(gzipSync(source)), await extractVgmInstruments(source));
  await assert.rejects(extractVgmInstruments(new Uint8Array(8)), /header/i);
  await assert.rejects(extractVgmInstruments(vgm([0x66], 0, false)), /no NES/i);
  await assert.rejects(extractVgmInstruments(vgm([...power, ...pulse1, 0x66], 1789773 | 0x40000000)), /Dual/i);
  await assert.rejects(extractVgmInstruments(vgm([...w(0x80, 1), 0x66])), /Second NES/i);
  await assert.rejects(extractVgmInstruments(vgm([...power, ...pulse1], 1789773, false)), /end of VGM/i);
  await assert.rejects(extractVgmInstruments(vgm([0xb4, 0])), /Truncated VGM command/i);
  await assert.rejects(extractVgmInstruments(vgm([0x67, 0x66, 0xc2, 1, 0, 0, 0, 0])), /RAM block header/i);
  await assert.rejects(extractVgmInstruments(vgm([...power, ...pulse1, 0x64, 0, 0, 0, 0x66])), /Unsupported|Unknown/i);
  await assert.rejects(extractVgmInstruments(Uint8Array.from([0x1f, 0x8b, 0])), /./);
  const invalidOffset = complete(); new DataView(invalidOffset.buffer).setUint32(0x34, 0xffff, true);
  await assert.rejects(extractVgmInstruments(invalidOffset), /data offset/i);
  const invalidSize = complete(); new DataView(invalidSize.buffer).setUint32(4, invalidSize.length + 50, true);
  await assert.rejects(extractVgmInstruments(invalidSize), /file size/i);
});

test('nonstandard clocks and missing Sweep are explicit rather than silently replaced with factory effects', async () => {
  const result = await extractVgmInstruments(vgm([...power, ...w(0, 0xb9), ...w(2, 0x40), ...w(3, 9), 0x66], 1662607));
  assert.equal(result.voices[0].preset.pulse.sweep.enabled, false);
  assert(result.voices[0].warnings.some(message => /Sweep.*not recorded/i.test(message)));
  assert(result.warnings.some(message => /normal NTSC/i.test(message)));
});

test('input, expanded gzip and asynchronous cancellation limits never publish partial libraries', async () => {
  await assert.rejects(extractVgmInstruments(new Uint8Array(MAX_VGM_BYTES + 1)), /64 MiB/);
  const expanded = gzipSync(Buffer.alloc(MAX_VGM_BYTES + 1));
  await assert.rejects(extractVgmInstruments(expanded), /Expanded VGZ.*64 MiB/i);
  const pre = new AbortController(); pre.abort();
  await assert.rejects(extractVgmInstruments(complete(), {signal:pre.signal}), {name:'AbortError'});
  const later = new AbortController();
  const pending = extractVgmInstruments(vgm([...power, ...pulse1, ...Array(20000).fill(0x70), 0x66]), {signal:later.signal});
  setTimeout(() => later.abort(), 0);
  await assert.rejects(pending, {name:'AbortError'});
});

test('every imported source produces finite audible PCM through the actual NES / FDS WASM instrument', async t => {
  const {voices} = await extractVgmInstruments(complete());
  const wasmBinary = await readFile(new URL('../generated/nesapu_wasm.wasm', import.meta.url));
  const core = await NesApuWasm.create({moduleFactory:factory, moduleOptions:{wasmBinary}, sampleRate:48000, fds:true});
  const instrument = new NesInstrument(core); t.after(() => instrument.dispose());
  for (const voice of voices) {
    instrument.loadPreset(voice.preset); instrument.noteOn(String(voice.id), 60);
    const pcm = instrument.generateStereo(4096);
    assert(pcm.left.every(Number.isFinite) && pcm.right.every(Number.isFinite), voice.preset.name);
    assert(pcm.left.some(value => Math.abs(value) > .0001), voice.preset.name);
  }
});

test('imported Noise Envelope settings reach the real WASM hardware control without fixed-volume approximation', async t => {
  const {voices:[voice]} = await extractVgmInstruments(vgm([
    ...w(0x15, 8), ...w(0x0c, 0x23), ...w(0x0e, 0x85), ...w(0x0f, 8), 0x66,
  ]));
  const wasmBinary = await readFile(new URL('../generated/nesapu_wasm.wasm', import.meta.url));
  const core = await NesApuWasm.create({moduleFactory:factory, moduleOptions:{wasmBinary}, sampleRate:48000, fds:true});
  const instrument = new NesInstrument(core); t.after(() => instrument.dispose());
  instrument.loadPreset(voice.preset); instrument.noteOn('imported-noise-envelope', 60);
  const state = instrument.read();
  assert.equal(state.registers[0x0c], 0x23, 'Envelope mode, loop and divider are retained in $400C');
  assert.equal(state.registers[0x0e], 0x85, 'the independent Noise clock and LFSR mode are retained');
  const pcm = instrument.generateStereo(4096);
  assert(pcm.left.every(Number.isFinite) && pcm.right.every(Number.isFinite));
  assert(pcm.left.some(value => Math.abs(value) > .0001));
});

test('imported FDS volume Envelopes start from recorded zero or six-bit gain and move through the actual WASM', async t => {
  const wasmBinary = await readFile(new URL('../generated/nesapu_wasm.wasm', import.meta.url));
  for (const sampleRate of [44100,48000]) for (const {gain,increase} of [{gain:0,increase:true},{gain:63,increase:false}]) {
    const {voices:[voice]} = await extractVgmInstruments(vgm([...fdsTables,
      ...w(0x20,128|gain), ...w(0x20,(increase?64:0)|15), ...w(0x2a,232), ...fdsNote, 0x66]));
    assert.equal(voice.preset.fds.envelope.initialGain,gain);
    const core = await NesApuWasm.create({moduleFactory:factory,moduleOptions:{wasmBinary},sampleRate,fds:true});
    const instrument = new NesInstrument(core); t.after(() => instrument.dispose());
    instrument.loadPreset(voice.preset); instrument.noteOn(`imported-fds-${gain}`,60);
    const state = instrument.read();
    assert.equal(state.registers[0x80],(increase?64:0)|15);
    assert.equal(state.registers[0x8a],232); assert.equal(state.registers[0x83]&64,0);
    assert.equal(core.getState().fdsGain,gain,'the raw recorded initial gain reaches the core before Envelope clocking');
    const pcm = instrument.generateStereo(Math.round(.04*sampleRate));
    assert(pcm.left.every(Number.isFinite)&&pcm.right.every(Number.isFinite));
    assert(pcm.left.some(value => Math.abs(value)>.0001),'actual FDS PCM is audible after hardware Envelope steps');
    const early = core.getState().fdsGain;
    assert(increase ? early>0&&early<8 : early>32&&early<63);
    instrument.generateStereo(Math.round(.6*sampleRate));
    const late = core.getState().fdsGain;
    assert(increase ? late>early&&late<=32 : late<32&&late<early,'the recorded Envelope direction controls actual gain evolution');
  }
});

test('imported depth Envelopes evolve in actual WASM alongside volume Envelope or a halted modulation table', async t => {
  const wasmBinary=await readFile(new URL('../generated/nesapu_wasm.wasm',import.meta.url));
  const cases=[
    {gain:0,increase:true,modEnabled:true,volumeEnvelope:true},
    {gain:63,increase:false,modEnabled:true,volumeEnvelope:false},
    {gain:0,increase:true,modEnabled:false,volumeEnvelope:false},
  ];
  for(const sampleRate of [44100,48000])for(const {gain,increase,modEnabled,volumeEnvelope}of cases) {
    const volume=volumeEnvelope?[...w(0x20,0x80),...w(0x20,0x4f)]:w(0x20,0x98);
    const [voice]=fdsVoices(await extractVgmInstruments(vgm([...fdsTables,...volume,
      ...w(0x24,0x80|gain),...w(0x24,(increase?64:0)|15),...w(0x2a,232),
      ...w(0x25,0),...w(0x26,0x80),...w(0x27,modEnabled?1:0x81),...fdsNote,0x66])));
    assert.deepEqual(voice.preset.fds.modulation.envelope,{enabled:true,increase,period:15,initialGain:gain});
    assert.deepEqual(voice.preset.fds.envelopeClock,{masterSpeed:232,halt:false});
    const core=await NesApuWasm.create({moduleFactory:factory,moduleOptions:{wasmBinary},sampleRate,fds:true});
    const instrument=new NesInstrument(core);t.after(()=>instrument.dispose());
    instrument.loadPreset(voice.preset);instrument.noteOn(`imported-depth-${gain}-${modEnabled}`,60);
    const state=instrument.read();
    assert.equal(state.registers[0x84],(increase?64:0)|15);assert.equal(state.registers[0x8a],232);
    assert.equal(state.registers[0x83]&64,0);assert.equal(Boolean(state.registers[0x87]&128),!modEnabled);
    assert.equal(core.getState().fdsSweepGain,gain,'the full recorded depth seed reaches the modulation Envelope');
    if(volumeEnvelope)assert.equal(core.getState().fdsGain,0);
    const pcm=instrument.generateStereo(Math.round(.04*sampleRate));
    assert(pcm.left.every(Number.isFinite)&&pcm.right.every(Number.isFinite));
    assert(pcm.left.some(value=>Math.abs(value)>.0001),'actual PCM remains audible with depth Envelope active');
    const early=core.getState().fdsSweepGain;
    assert(increase?early>0&&early<8:early>32&&early<63);
    if(volumeEnvelope)assert(core.getState().fdsGain>0,'both units advance through their shared clock');
    instrument.generateStereo(Math.round(.6*sampleRate));
    const late=core.getState().fdsSweepGain;
    assert(increase?late>early&&late<=32:late<32&&late<early,'the hardware depth Envelope advances even with a halted table');
  }
});

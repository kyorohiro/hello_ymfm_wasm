// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import {readFile} from 'node:fs/promises';
import {extractVgmInstruments, MAX_VGM_BYTES} from './vgm_import.js';
import {readPreset} from './preset.js';
import {GameboyInstrument} from './instrument.js';
import {GameboyApu} from '../js/gameboyapu.js';
import factory from '../generated/gameboy_apu_wasm.js';

const w = (register, value) => [0xb3, register, value];
const wait = [0x61, 0xe8, 3];
const power = [...w(22, 0x80), ...w(20, 0x77), ...w(21, 0xff)];
const pulse1 = [...w(0, 0x29), ...w(1, 0x80), ...w(2, 0xa0), ...w(3, 0x40), ...w(4, 0x84)];
const pulse2 = [...w(6, 0x40), ...w(7, 0x90), ...w(8, 0x50), ...w(9, 0x84)];
const ram = Array.from({length: 16}, (_, i) => w(0x20 + i, ((i * 2) & 15) << 4 | ((i * 2 + 1) & 15))).flat();
const wave = [...ram, ...w(10, 0x80), ...w(12, 0x40), ...w(13, 0x90), ...w(14, 0x84)];
const noise = [...w(17, 0xb0), ...w(18, 0x4b), ...w(19, 0x80)];
function vgm(commands, clock = 4194304) {
  const bytes = new Uint8Array(0x100 + commands.length);
  bytes.set([86, 103, 109, 32]);
  const view = new DataView(bytes.buffer);
  view.setUint32(4, bytes.length - 4, true);
  view.setUint32(8, 0x171, true);
  view.setUint32(0x34, 0xcc, true);
  view.setUint32(0x80, clock, true);
  bytes.set(commands, 0x100);
  return bytes;
}
const complete = () => vgm([...power, ...pulse1, ...wait, ...pulse2, ...wait, ...w(8, 0x60), ...w(9, 0x85), ...wait, ...wave, ...wait, ...noise, 0x66]);

test('VGM import maps four channel settings, timing, Sweep, Wave nibbles and repeated triggers to portable presets', async () => {
  const result = await extractVgmInstruments(complete());
  assert.deepEqual(result.voices.map(v => [v.kind, v.channel, v.firstTime, v.occurrences]), [
    ['pulse', 1, 0, 1], ['pulse', 2, 1000, 2], ['wave', 3, 3000, 1], ['noise', 4, 4000, 1],
  ]);
  const [a, b, c, d] = result.voices.map(v => v.preset);
  assert.deepEqual(a.pulse, {duty: 0.5, volume: 10, envelope: {direction: 'down', period: 0}, sweep: {enabled: true, direction: 'down', period: 2, shift: 1}});
  assert.equal(b.pulse.duty, 0.25); assert.equal(b.pulse.volume, 9); assert.equal(b.pulse.sweep.enabled, false);
  assert.deepEqual(c.wave, {samples: Array.from({length: 32}, (_, i) => i % 16), level: 0.5});
  assert.deepEqual(d.noise, {volume: 11, envelope: {direction: 'down', period: 0}, divisor: 3, shift: 4, width: 7});
  for (const {preset} of result.voices) assert.deepEqual(readPreset(preset), preset);
  assert.deepEqual(result.warnings, []);
});

test('pan belongs to each trigger and changes split definitions while frequency and length do not', async () => {
  const result = await extractVgmInstruments(vgm([...power, ...pulse2, ...w(21, 0x20), ...w(9, 0xc7), ...w(8, 0xff), ...w(9, 0x83), ...w(21, 0x02), ...w(9, 0x84), 0x66]));
  assert.deepEqual(result.voices.map(v => [v.occurrences, v.preset.pan]), [
    [1, {left: true, right: true}], [2, {left: true, right: false}], [1, {left: false, right: true}],
  ]);
});

test('silent and incomplete triggers are omitted; zero-volume rising envelopes remain importable', async () => {
  const result = await extractVgmInstruments(vgm([
    ...power, ...w(4, 0x80), ...w(0x20, 0x12), ...w(10, 0x80), ...w(12, 0x40), ...w(14, 0x80),
    ...pulse2, ...w(7, 0), ...w(9, 0x80), ...w(21, 0), ...pulse1,
    ...w(21, 0xff), ...ram, ...w(12, 0), ...w(14, 0x80),
    ...w(17, 0x09), ...w(18, 3), ...w(19, 0x80), 0x66,
  ]));
  assert.deepEqual(result.voices.map(v => [v.kind, v.channel]), [['pulse', 2], ['noise', 4]]);
  assert.equal(result.voices[1].preset.noise.volume, 0);
  assert.equal(result.voices[1].preset.noise.envelope.direction, 'up');
  assert(result.warnings.some(message => message.includes('unknown voice')));
  assert(result.warnings.some(message => message.includes('incomplete wave')));
});

test('unknown routing and Sweep use explicit fallbacks; power reset does not erase Wave RAM', async () => {
  const unknown = await extractVgmInstruments(vgm([...w(1, 0x80), ...w(2, 0xa0), ...w(4, 0x80), 0x66]));
  assert.deepEqual(unknown.voices[0].preset.pan, {left: true, right: true});
  assert.equal(unknown.voices[0].preset.pulse.sweep.enabled, false);
  assert(unknown.warnings.some(message => message.includes('routing')));
  assert(unknown.warnings.some(message => message.includes('Sweep')));
  const reset = await extractVgmInstruments(vgm([...power, ...wave, ...w(22, 0), ...w(22, 0x80), ...w(21, 0xff), ...w(10, 0x80), ...w(12, 0x20), ...w(14, 0x80), 0x66]));
  assert.equal(reset.voices.length, 2);
  assert.deepEqual(reset.voices[0].preset.wave.samples, reset.voices[1].preset.wave.samples);
  assert.equal(reset.voices[1].preset.wave.level, 1);
});

test('VGZ is decoded with the same results and malformed/non-GB/dual/truncated input rejects', async () => {
  const source = complete();
  assert.deepEqual(await extractVgmInstruments(gzipSync(source)), await extractVgmInstruments(source));
  await assert.rejects(extractVgmInstruments(new Uint8Array(20)), /header/i);
  await assert.rejects(extractVgmInstruments(vgm([0x66], 0)), /no Game Boy/i);
  await assert.rejects(extractVgmInstruments(vgm([...power, ...pulse1, 0x66], 4194304 | 0x40000000)), /Dual or variant/);
  await assert.rejects(extractVgmInstruments(vgm([...power, ...w(0x81, 0x80), 0x66])), /Second Game Boy/);
  await assert.rejects(extractVgmInstruments(vgm([...power, ...pulse1])), /end of VGM/);
  await assert.rejects(extractVgmInstruments(vgm([0xb3, 2])), /Truncated VGM command/);
  await assert.rejects(extractVgmInstruments(vgm([0x67, 0x66])), /Truncated VGM command/);
  const invalidOffset = complete(); new DataView(invalidOffset.buffer).setUint32(0x34, 0xffff, true);
  await assert.rejects(extractVgmInstruments(invalidOffset), /data offset/);
  const invalidSize = complete(); new DataView(invalidSize.buffer).setUint32(4, invalidSize.length + 10, true);
  await assert.rejects(extractVgmInstruments(invalidSize), /file size/);
  await assert.rejects(extractVgmInstruments(vgm([...power, ...ram, 0x66])), /No complete/);
  await assert.rejects(extractVgmInstruments(Uint8Array.from([0x1f, 0x8b, 0])), /./);
});

test('input limits and cancellation prevent publishing partial results', async () => {
  await assert.rejects(extractVgmInstruments(new Uint8Array(MAX_VGM_BYTES + 1)), /64 MiB/);
  const pre = new AbortController(); pre.abort();
  await assert.rejects(extractVgmInstruments(complete(), {signal: pre.signal}), {name: 'AbortError'});
  const later = new AbortController();
  const task = extractVgmInstruments(vgm([...power, ...pulse1, ...Array(20_000).fill(0x70), 0x66]), {signal: later.signal});
  setTimeout(() => later.abort(), 0);
  await assert.rejects(task, {name: 'AbortError'});
});

test('other-chip blocks are opaque and malformed blocks or unsupported wait overrides reject', async () => {
  const block = [0x67, 0x66, 0, 4, 0, 0, 0, 0xb3, 4, 0x80, 0x66];
  const result = await extractVgmInstruments(vgm([...power, ...block, 0x52, 0xb3, 0x66, ...pulse2, 0x66]));
  assert.equal(result.voices.length, 1);
  assert.equal(result.voices[0].channel, 2);
  await assert.rejects(extractVgmInstruments(vgm([...power, ...pulse2, 0x64, 0x62, 0, 1, 0x66])), /Unsupported raw VGM command/);
  await assert.rejects(extractVgmInstruments(vgm([0x67, 0, 0, 0, 0, 0, 0, 0x66])), /data block header/);
  await assert.rejects(extractVgmInstruments(vgm([0x67, 0x66, 0, 10, 0, 0, 0, 0x66])), /Truncated VGM command/);
});

test('small VGZ inputs cannot expand beyond the decompressed byte limit', async () => {
  const compressed = gzipSync(new Uint8Array(MAX_VGM_BYTES + 1), {level: 1});
  assert(compressed.length < 1024 * 1024);
  await assert.rejects(extractVgmInstruments(compressed), /Expanded VGZ exceeds 64 MiB/);
});

test('every imported source plays through the actual Game Boy WASM instrument', async t => {
  const {voices} = await extractVgmInstruments(complete());
  const wasmBinary = await readFile(new URL('../generated/gameboy_apu_wasm.wasm', import.meta.url));
  const core = await GameboyApu.create({moduleFactory: factory, moduleOptions: {wasmBinary}, sampleRate: 48000});
  const instrument = new GameboyInstrument(core);
  t.after(() => instrument.dispose());
  for (const {preset, id} of voices) {
    instrument.loadPreset(preset);
    instrument.noteOn(String(id), 60);
    const pcm = instrument.generateStereo(4096);
    assert(pcm.left.every(Number.isFinite) && pcm.right.every(Number.isFinite));
    assert(pcm.left.some(value => Math.abs(value) > 0.0001), preset.name);
  }
});

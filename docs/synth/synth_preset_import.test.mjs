import test from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { readPresetFile, OPM_IMPORT_NOTICE } from './synth_preset_import.js';
import { createTfiFromPreset } from '../js/tfi.js';
import { createVgiFromPreset } from '../js/vgi.js';

const patch = { algorithm: 4, feedback: 2, operators: { 1: { ar: 23, tl: 12 } } };
function s98(commands, type = 5) {
  const bytes = new Uint8Array(48 + commands.length), view = new DataView(bytes.buffer);
  bytes.set([83, 57, 56, 51]);
  view.setUint32(4, 10, true); view.setUint32(8, 1000, true);
  view.setUint32(20, 48, true); view.setUint32(28, 1, true);
  view.setUint32(32, type, true); view.setUint32(36, type === 5 ? 4000000 : 7987200, true);
  bytes.set(commands, 48); return bytes;
}
function opmVgm() {
  const commands = [0x54, 0x20, 0xdd, 0x54, 0x60, 12, 0x54, 0x68, 13,
    0x54, 0x70, 14, 0x54, 0x78, 15, 0x54, 0xc0, 0x40,
    0x54, 8, 0x78, 0x54, 8, 0x78, 0x61, 10, 0, 0x66];
  const bytes = new Uint8Array(256 + commands.length), view = new DataView(bytes.buffer);
  bytes.set([86, 103, 109, 32]); view.setUint32(4, bytes.length - 4, true);
  view.setUint32(8, 0x171, true); view.setUint32(0x34, 204, true); view.setUint32(0x30, 4000000, true);
  bytes.set(commands, 256); return bytes;
}
test('TFI and VGI retain exact bytes and instrument parameters, including renamed files', async () => {
  for (const bytes of [createTfiFromPreset(patch), createVgiFromPreset(patch)]) {
    const [entry] = await readPresetFile(bytes, 'test.tfi');
    assert.equal(entry.preset.algorithm, 4);
    assert.equal(entry.preset.operators[1].ar, 23);
    assert.equal(entry.preset.operators[1].tl, 12);
    assert.deepEqual(entry.bytes, bytes);
    assert.equal(entry.format, bytes.length === 43 ? 'vgi' : 'tfi');
    entry.bytes[0] = 0;
    assert.equal(bytes[0], 4, 'the parser gives the project independent bytes');
  }
});

test('VGM key-on snapshots become named presets; malformed files reject', async () => {
  const data = new Uint8Array(0x100 + 10);
  data.set([0x56, 0x67, 0x6d, 0x20]);
  const view = new DataView(data.buffer);
  view.setUint32(4, data.length - 4, true);
  view.setUint32(8, 0x171, true);
  view.setUint32(0x34, 0xcc, true);
  data.set([0x52, 0xb0, 4, 0x52, 0x28, 0xf0, 0x52, 0x28, 0xf0, 0x66], 0x100);
  const entries = await readPresetFile(data, 'song.vgm');
  assert.deepEqual(await readPresetFile(gzipSync(data), 'song.vgz'), entries);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].label, 'ym2612_ch1_001');
  assert.equal(entries[0].preset.algorithm, 4);
  await assert.rejects(() => readPresetFile(new Uint8Array(3), 'bad.vgm'));
  await assert.rejects(() => readPresetFile(new Uint8Array(3), 'bad.tfi'));
});

test('S98 OPN imports use the same key-on extraction as VGM', async () => {
  for (const [type, chip] of [[2, 'ym2203'], [3, 'ym2612'], [4, 'ym2608']]) {
    const entries = await readPresetFile(s98([0, 0xb0, 4, 0, 0x28, 0xf0, 255, 253], type), 'song.s98');
    assert.equal(entries.length, 1);
    assert.match(entries[0].label, new RegExp(chip));
    assert.equal(entries[0].preset.algorithm, 4);
    assert.equal(entries[0].notice, undefined);
  }
  await assert.rejects(readPresetFile(new Uint8Array(3), 'bad.s98'), /S98.*header/);
});

test('YM2151 VGM, VGZ and S98 import approximate presets with logical operator mapping', async () => {
  const bytes = opmVgm();
  const vgm = await readPresetFile(bytes, 'opm.vgm');
  assert.equal(vgm.length, 1, 'repeated key-ons deduplicate');
  assert.deepEqual(await readPresetFile(gzipSync(bytes), 'opm.vgz'), vgm);
  const commands = Array.from(bytes.subarray(256, bytes.length - 4));
  for (let index = 0; index < commands.length; index += 3) commands[index] = 0;
  const normalized = await readPresetFile(s98([...commands, 255, 253]), 'opm.s98');
  assert.deepEqual(normalized, vgm);
  assert.equal(vgm[0].preset.algorithm, 5);
  assert.equal(vgm[0].preset.feedback, 3);
  assert.deepEqual([1, 2, 3, 4].map(op => vgm[0].preset.operators[op].tl), [12, 14, 13, 15]);
  assert.match(vgm[0].label, /ym2151.*YM2612/);
  assert.equal(vgm[0].notice, OPM_IMPORT_NOTICE);
  assert.deepEqual(await readPresetFile(s98([255, 253]), 'empty.s98'), []);
});

test('mixed OPN and OPM logs retain both families; dual OPM rejects explicitly', async () => {
  const base = opmVgm(), mixed = new Uint8Array(base.length + 6);
  mixed.set(base.subarray(0, base.length - 1));
  mixed.set([0x52, 0xb0, 4, 0x52, 0x28, 0xf0, 0x66], base.length - 1);
  new DataView(mixed.buffer).setUint32(0x2c, 7670454, true);
  const entries = await readPresetFile(mixed, 'mixed.vgm');
  assert.equal(entries.length, 2);
  assert.match(entries[0].label, /ym2612/); assert.match(entries[1].label, /ym2151/);
  new DataView(base.buffer).setUint32(0x30, 0x40000000 | 4000000, true);
  await assert.rejects(readPresetFile(base, 'dual.vgm'), /single YM2151/);
});

test('unsupported formats and corrupt gzip have actionable errors', async () => {
  await assert.rejects(readPresetFile(new Uint8Array(42), 'image.png'), /Unsupported file format/);
  await assert.rejects(readPresetFile(new Uint8Array([0x1f, 0x8b, 0]), 'broken.vgz'), /Could not decompress VGZ/);
  await assert.rejects(readPresetFile(gzipSync(new Uint8Array(42)), 'not-vgm.vgz'), /VGM header not found/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createVgmPresetFiles } from './playground_vgm_presets.js';
import { parseTfi } from '../js/tfi.js';
import { createVirtualFileSystem } from './playground_virtual_files.js';

function vgm(commands) {
  const data = new Uint8Array(0x100 + commands.length + 1);
  data.set([0x56, 0x67, 0x6d, 0x20]);
  const view = new DataView(data.buffer);
  view.setUint32(4, data.length - 4, true);
  view.setUint32(8, 0x171, true);
  view.setUint32(0x34, 0x100 - 0x34, true);
  data.set(commands, 0x100);
  data[data.length - 1] = 0x66;
  return data.buffer;
}

test('key-on snapshots preserve logical operators and deduplicate repeated timbres', () => {
  const files = createVgmPresetFiles(vgm([
    0x52, 0xb0, 0x1d,
    0x52, 0x34, 0x52, // physical slot 2 = logical OP3
    0x52, 0x44, 37,
    0x52, 0x54, 0x9f,
    0x52, 0x64, 0x87,
    0x52, 0x74, 9,
    0x52, 0x84, 0xa6,
    0x52, 0x94, 12,
    0x52, 0x28, 0xf0,
    0x52, 0x28, 0,
    0x52, 0xb4, 0xc0, // pan is not a distinct TFI
    0x52, 0x28, 0xf0,
    0x52, 0x44, 38,
    0x52, 0x28, 0xf0,
  ]), 'song.vgz');
  assert.equal(files.length, 2);
  assert.equal(files[0].path, '/presets/song/ym2612_ch1_001.tfi');
  const preset = parseTfi(files[0].data);
  assert.equal(preset.algorithm, 5);
  assert.equal(preset.feedback, 3);
  assert.deepEqual(preset.operators[3], { multi: 2, dt: 5, tl: 37, rs: 2, ar: 31, d1r: 7, d2r: 9, rr: 6, sl: 10, ssg: 12 });
  assert.equal(parseTfi(files[1].data).operators[3].tl, 38);
});

test('OPN chips keep independent banks; DAC and invalid channels are omitted', () => {
  const files = createVgmPresetFiles(vgm([
    0x52, 0x2b, 0x80, 0x52, 0x28, 0xf6,
    0x52, 0x28, 0xf3,
    0x55, 0xb0, 2, 0x55, 0x28, 0xf0,
    0x57, 0xb0, 4, 0x56, 0x28, 0xf4,
    0x59, 0xb1, 6, 0x58, 0x28, 0xf5,
  ]), 'song.vgm');
  assert.deepEqual(files.map(f => f.path), [
    '/presets/song/ym2203_ch1_001.tfi',
    '/presets/song/ym2608_ch4_001.tfi',
    '/presets/song/ym2610_ch5_001.tfi',
  ]);
  assert.deepEqual(files.map(f => parseTfi(f.data).algorithm), [2, 4, 6]);
});

test('repeat imports preserve existing virtual files and allocate another folder', () => {
  const buffer = vgm([0x52, 0x28, 0xf0]);
  const fs = createVirtualFileSystem();
  for (let i = 0; i < 2; i++) {
    for (const entry of createVgmPresetFiles(buffer, 'song.vgm', fs.list().map(f => f.path))) fs.writeBinary(entry.path, entry.data);
  }
  assert.deepEqual(fs.list().map(f => f.path), ['/presets/song/ym2612_ch1_001.tfi', '/presets/song-2/ym2612_ch1_001.tfi']);
  const safe = createVgmPresetFiles(buffer, '../song.vgm')[0].path;
  assert.equal(safe.split('/').length, 4);
});

test('files without FM key-ons produce no preset files', () => {
  assert.deepEqual(createVgmPresetFiles(vgm([0x52, 0x30, 1, 0x52, 0x28, 0]), 'silent.vgm'), []);
});

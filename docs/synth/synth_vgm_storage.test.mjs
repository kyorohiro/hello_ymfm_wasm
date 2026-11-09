import test from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { createSynthProject } from './synth_project.js';
import { createTfiFromPreset } from '../js/tfi.js';
import { loadPlaygroundCassette } from '../playground/playground_cassette.js';

const instrument = (name, bytes) => ({
  name,
  async arrayBuffer() { return bytes.slice().buffer; },
});

function vgm(algorithm = 4, { psgOnly = false } = {}) {
  const commands = psgOnly
    ? [0x50, 0x90, 0x61, 10, 0, 0x66]
    : [0x52, 0xb0, algorithm, 0x52, 0x28, 0xf0, 0x52, 0x28, 0xf0, 0x66];
  const bytes = new Uint8Array(256 + commands.length);
  const view = new DataView(bytes.buffer);
  bytes.set([0x56, 0x67, 0x6d, 0x20]);
  view.setUint32(4, bytes.length - 4, true);
  view.setUint32(8, 0x171, true);
  view.setUint32(0x34, 204, true);
  view.setUint32(psgOnly ? 0x0c : 0x2c, psgOnly ? 3579545 : 7670454, true);
  bytes.set(commands, 256);
  return bytes;
}

function vgz(bytes) {
  const compressed = new Uint8Array(gzipSync(bytes));
  // Preserve an original gzip header as well as its decompressed payload.
  compressed.set([0x78, 0x56, 0x34, 0x12], 4);
  return compressed;
}

function s98() {
  const commands = [0, 0xb0, 4, 0, 0x28, 0xf0, 255, 253];
  const bytes = new Uint8Array(48 + commands.length);
  const view = new DataView(bytes.buffer);
  bytes.set([83, 57, 56, 51]);
  view.setUint32(4, 10, true);
  view.setUint32(8, 1000, true);
  view.setUint32(20, 48, true);
  view.setUint32(28, 1, true);
  view.setUint32(32, 3, true);
  view.setUint32(36, 7670454, true);
  bytes.set(commands, 48);
  return bytes;
}

test('VGM and VGZ sources retain exact input bytes through tone edits and Cassette round trips', async () => {
  const project = createSynthProject();
  const originals = new Map([
    ['/vgm/raw.vgm', vgm(4)],
    ['/vgm/compressed.vgz', vgz(vgm(7))],
  ]);
  let commits = 0;
  project.onDidChange(() => commits++);
  const result = await project.importInstrumentFiles(
    [...originals].map(([path, bytes]) => instrument(path.split('/').pop(), bytes)),
  );
  assert.deepEqual(result.failures, []);
  assert.deepEqual([...result.sourcePaths].sort(), [...originals.keys()].sort());
  assert.equal(result.paths.length, 2);
  assert.ok(result.paths.every(path => path.startsWith('/presets/') && path.endsWith('.tfi')));
  assert.deepEqual(project.listTones().map(file => file.path).sort(), [...result.paths].sort());
  assert.equal(commits, 1, 'the sources and extracted instruments commit together');
  for (const [path, bytes] of originals) assert.deepEqual(project.fs.get(path).data, bytes, path);

  const tone = project.readTone(result.paths[0]);
  project.writeTone(tone.path, { ...tone.preset, algorithm: (tone.preset.algorithm + 1) % 8 });
  const exported = project.exportCassette();
  const cassette = await loadPlaygroundCassette(exported);
  for (const [path, bytes] of originals) {
    assert.deepEqual(project.fs.get(path).data, bytes, `tone edits preserve ${path}`);
    assert.deepEqual(cassette.files.get(path.slice(1)), bytes, `export preserves ${path}`);
  }
  const restored = createSynthProject();
  await restored.importCassette(exported);
  for (const [path, bytes] of originals) assert.deepEqual(restored.fs.get(path).data, bytes, path);
  assert.deepEqual(restored.listTones().map(file => file.path).sort(), [...result.paths].sort());
});

test('repeated source basenames receive suffixes without overwriting earlier logs or tones', async () => {
  const project = createSynthProject();
  const bytes = [vgm(4), vgm(7), vgm(1)];
  const first = await project.importInstrumentFiles([
    instrument('song.vgm', bytes[0]), instrument('song.vgm', bytes[1]),
  ]);
  assert.deepEqual(first.sourcePaths, ['/vgm/song.vgm', '/vgm/song-2.vgm']);
  assert.deepEqual(first.paths, ['/presets/song/ym2612_ch1_001.tfi', '/presets/song-2/ym2612_ch1_001.tfi']);
  const third = await project.importInstrumentFiles([instrument('song.vgm', bytes[2])]);
  assert.deepEqual(third.sourcePaths, ['/vgm/song-3.vgm']);
  assert.deepEqual(third.paths, ['/presets/song-3/ym2612_ch1_001.tfi']);
  for (let index = 0; index < bytes.length; index++) {
    const suffix = index ? `-${index + 1}` : '';
    assert.deepEqual(project.fs.get(`/vgm/song${suffix}.vgm`).data, bytes[index]);
    assert.equal(project.readTone(`/presets/song${suffix}/ym2612_ch1_001.tfi`).preset.algorithm, [4, 7, 1][index]);
  }
});

test('a valid PSG-only VGM is stored with a notice even when no FM tones can be extracted', async () => {
  const project = createSynthProject();
  const bytes = vgm(0, { psgOnly: true });
  const result = await project.importInstrumentFiles([instrument('psg.vgm', bytes)]);
  assert.deepEqual(result.paths, []);
  assert.deepEqual(result.sourcePaths, ['/vgm/psg.vgm']);
  assert.deepEqual(result.failures, []);
  assert.ok(result.notices.some(notice => /FM|instrument|snapshot/i.test(notice)));
  assert.deepEqual(project.fs.get('/vgm/psg.vgm').data, bytes);
  assert.deepEqual(project.listTones(), []);
  const restored = createSynthProject();
  await restored.importCassette(project.exportCassette());
  assert.deepEqual(restored.fs.get('/vgm/psg.vgm').data, bytes);
});

test('malformed and cancelled log imports leave no partial source files or tone folders', async () => {
  const project = createSynthProject();
  project.writeTone('/presets/existing.tfi', { algorithm: 4, feedback: 2 });
  const before = project.snapshot();
  const invalid = await project.importInstrumentFiles([
    instrument('bad.vgm', new Uint8Array(7)),
    instrument('broken.vgz', new Uint8Array([0x1f, 0x8b, 0])),
  ]);
  assert.deepEqual(invalid.paths, []);
  assert.deepEqual(invalid.sourcePaths, []);
  assert.equal(invalid.failures.length, 2);
  assert.deepEqual(project.snapshot(), before);

  let finish;
  const slow = project.importInstrumentFiles([{
    name: 'cancelled.vgm',
    arrayBuffer: () => new Promise(resolve => { finish = resolve; }),
  }]);
  const current = await project.importInstrumentFiles([
    instrument('current.tfi', createTfiFromPreset({ algorithm: 7, feedback: 1 })),
  ]);
  const afterCurrent = project.snapshot();
  finish(vgm().buffer);
  const cancelled = await slow;
  assert.equal(cancelled.cancelled, true);
  assert.deepEqual(cancelled.paths, []);
  assert.deepEqual(cancelled.sourcePaths, []);
  assert.deepEqual(project.snapshot(), afterCurrent);
  assert.ok(project.fs.has(current.paths[0]));

  const stale = await project.importInstrumentFiles([instrument('stale.vgm', vgm())], { isCurrent: () => false });
  assert.equal(stale.cancelled, true);
  assert.deepEqual(stale.sourcePaths, []);
  assert.deepEqual(project.snapshot(), afterCurrent);
});

test('a file occupying /vgm rejects the log without leaving orphaned extracted tones', async () => {
  const project = createSynthProject();
  project.fs.writeBinary('/vgm', new Uint8Array([9, 0, 255]));
  const before = project.snapshot();
  const result = await project.importInstrumentFiles([instrument('song.vgm', vgm())]);
  assert.deepEqual(result.paths, []);
  assert.deepEqual(result.sourcePaths, []);
  assert.equal(result.failures.length, 1);
  assert.match(result.failures[0], /vgm/i);
  assert.deepEqual(project.snapshot(), before);
});

test('log drops keep sources in /vgm while their instruments use the selected folder', async () => {
  const project = createSynthProject();
  project.mkdir('/presets/My set');
  const bytes = vgz(vgm());
  const result = await project.importInstrumentFiles([instrument('game.vgz', bytes)], { directory: '/presets/My set' });
  assert.deepEqual(result.sourcePaths, ['/vgm/game.vgz']);
  assert.deepEqual(result.paths, ['/presets/My set/game/ym2612_ch1_001.tfi']);
  assert.deepEqual(project.fs.get('/vgm/game.vgz').data, bytes);
  assert.equal(project.readTone(result.paths[0]).preset.algorithm, 4);
  assert.deepEqual(result.failures, []);
});

test('a raw VGM named .tfi gets a .vgm source and a log folder on custom drops', async () => {
  const project = createSynthProject();
  project.mkdir('/presets/My set');
  const bytes = vgm();
  const result = await project.importInstrumentFiles([instrument('renamed.tfi', bytes)], { directory: '/presets/My set' });
  assert.deepEqual(result.sourcePaths, ['/vgm/renamed.vgm']);
  assert.deepEqual(result.paths, ['/presets/My set/renamed/ym2612_ch1_001.tfi']);
  assert.deepEqual(project.fs.get('/vgm/renamed.vgm').data, bytes);
  assert.deepEqual(project.listTones().map(file => file.path), result.paths);
  assert.deepEqual(result.failures, []);
});

test('S98 instrument extraction continues without archiving S98 files under /vgm', async () => {
  const project = createSynthProject();
  const result = await project.importInstrumentFiles([instrument('song.s98', s98())]);
  assert.deepEqual(result.sourcePaths, []);
  assert.deepEqual(result.paths, ['/presets/song/ym2612_ch1_001.tfi']);
  assert.deepEqual(result.failures, []);
  assert.equal(project.readTone(result.paths[0]).preset.algorithm, 4);
  assert.equal(project.listEntries().some(entry => entry.type === 'file' && entry.path.startsWith('/vgm/')), false);
});

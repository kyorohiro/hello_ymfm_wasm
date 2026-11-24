import assert from 'node:assert/strict';
import test from 'node:test';
import { FM2610_ADPCM_B_MAX_BYTES } from '../../docs/synth-fm2610/adpcm_b.js';
import {
  ADPCM_B_SAMPLE_SUFFIX, isAdpcmBSamplePath, readAdpcmBSample, writeAdpcmBSample,
} from '../../docs/synth-fm2610/adpcm_b_sample_document.js';
import { createPlaygroundCassetteZip, loadPlaygroundCassette } from '../../docs/playground/playground_cassette.js';
import { createStoredZipBytes } from '../../docs/vgm_analyzer/stored_zip.js';

const sample = {
  name: '太鼓.wav',
  bytes: new Uint8Array(256).fill(0x89),
  sampleRate: 24000,
  rootNote: 46,
  volume: 183,
  repeat: true,
};

test('ADPCM-B sample document preserves encoded bytes and playback settings', async () => {
  assert(isAdpcmBSamplePath('Taiko.ADPCM-B-SAMPLE.ZIP'));
  assert(!isAdpcmBSamplePath('Taiko.zip'));
  const archive = writeAdpcmBSample(sample);
  const {files} = await loadPlaygroundCassette(archive);
  assert.deepEqual(files.get('sample.adpcm-b'), sample.bytes);
  const restored = await readAdpcmBSample(archive);
  assert.deepEqual(restored, sample);
  restored.bytes[0] = 0;
  assert.equal(sample.bytes[0], 0x89);
  assert.deepEqual(await readAdpcmBSample(archive), sample);
});

test('ADPCM-B sample reader verifies ZIP checksums, format and ROM alignment', async () => {
  const archive = writeAdpcmBSample(sample);
  const corrupt = archive.slice();
  const manifestOffset = 30 + 'sample.json'.length;
  corrupt[manifestOffset] ^= 1;
  await assert.rejects(readAdpcmBSample(corrupt), /checksum/);

  const {files} = await loadPlaygroundCassette(archive);
  const manifest = {name: 'sample.json', data: files.get('sample.json')};
  const misaligned = createStoredZipBytes([manifest,
    {name: 'sample.adpcm-b', data: sample.bytes.subarray(1)},
  ]);
  await assert.rejects(readAdpcmBSample(misaligned), RangeError);
  const extra = createStoredZipBytes([manifest,
    {name: 'sample.adpcm-b', data: sample.bytes},
    {name: 'other.adpcm-b', data: sample.bytes},
  ]);
  await assert.rejects(readAdpcmBSample(extra), /Invalid ADPCM-B sample document/);
  const wrongVersion = JSON.parse(new TextDecoder().decode(manifest.data));
  wrongVersion.version = 2;
  await assert.rejects(readAdpcmBSample(createStoredZipBytes([
    {name: 'sample.json', data: new TextEncoder().encode(JSON.stringify(wrongVersion))},
    {name: 'sample.adpcm-b', data: sample.bytes},
  ])), /Choose a Tetorica FM2610 ADPCM-B sample/);
  assert.throws(() => writeAdpcmBSample({...sample, rootNote:128}), RangeError);
});

test('maximum-size ADPCM-B sample stays portable inside a Cassette', async () => {
  const full = {...sample, bytes: new Uint8Array(FM2610_ADPCM_B_MAX_BYTES).fill(0x60)};
  const data = writeAdpcmBSample(full);
  const path = 'samples/Taiko' + ADPCM_B_SAMPLE_SUFFIX;
  const metadata = {fm2610: {version:1, view:{activeSample:'/' + path}, drafts:[]}};
  const archive = createPlaygroundCassetteZip([{path:'/' + path, type:'binary', data}], {metadata});
  const {files, metadata: restored} = await loadPlaygroundCassette(archive);
  assert.equal(restored.fm2610.view.activeSample, '/' + path);
  assert.deepEqual(files.get(path), data);
  assert.deepEqual(await readAdpcmBSample(files.get(path)), full);
});

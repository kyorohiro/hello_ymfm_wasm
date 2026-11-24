import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ADPCM_A_KIT_MAX_SAMPLE_BYTES, createDefaultAdpcmAKit, readAdpcmAKit, writeAdpcmAKit,
} from '../../docs/synth-fm2610/adpcm_a_kit.js';
import { createPlaygroundCassetteZip, loadPlaygroundCassette } from '../../docs/playground/playground_cassette.js';
import { createStoredZipBytes } from '../../docs/vgm_analyzer/stored_zip.js';

test('ADPCM-A kit preserves default pads, volume and the original encoded data', async () => {
  const defaults = createDefaultAdpcmAKit();
  assert.deepEqual(await readAdpcmAKit(writeAdpcmAKit(defaults)), defaults);

  const kit = {...defaults, level: 31};
  kit.pads[0] = {name: 'バスドラム.wav', bytes: new Uint8Array(256).fill(0x12)};
  kit.pads[5] = {name: 'Clap.wav', bytes: new Uint8Array(512).fill(0x9d)};
  const restored = await readAdpcmAKit(writeAdpcmAKit(kit));
  assert.deepEqual(restored, kit);
  restored.pads[0].bytes[0] = 0;
  assert.equal(kit.pads[0].bytes[0], 0x12);
});

test('ADPCM-A kit rejects corrupt ZIP members and valid but misaligned sample files', async () => {
  const kit = createDefaultAdpcmAKit();
  kit.pads[0] = {name: 'Kick.wav', bytes: new Uint8Array(256).fill(0x29)};
  const encoded = writeAdpcmAKit(kit);
  const corrupted = encoded.slice();
  // The first local ZIP member is the stored manifest, with no extra field.
  const firstMember = 30 + 'kit.json'.length;
  corrupted[firstMember] ^= 1;
  await assert.rejects(readAdpcmAKit(corrupted), /checksum/);

  const {files} = await loadPlaygroundCassette(encoded);
  const misaligned = createStoredZipBytes([
    {name: 'kit.json', data: files.get('kit.json')},
    {name: 'pads/a1.adpcm-a', data: kit.pads[0].bytes.subarray(1)},
  ]);
  await assert.rejects(readAdpcmAKit(misaligned), /sample size for pad A1/);
});

test('six maximum-size ADPCM-A pads fit in one portable Cassette', async () => {
  const kit = {
    level: 63,
    pads: Array.from({length: 6}, (_, index) => ({
      name: 'Sample ' + (index + 1),
      bytes: new Uint8Array(ADPCM_A_KIT_MAX_SAMPLE_BYTES).fill(index),
    })),
  };
  const path = 'kits/Six pads.adpcm-a-kit.zip';
  const data = writeAdpcmAKit(kit);
  const cassette = createPlaygroundCassetteZip([{path: '/' + path, data, type: 'binary'}]);
  const {files} = await loadPlaygroundCassette(cassette);
  const reloaded = files.get(path);
  assert.deepEqual(reloaded, data);
  assert.deepEqual(await readAdpcmAKit(reloaded), kit);
});

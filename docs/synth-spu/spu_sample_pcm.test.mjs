// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {decodeSpuSamplePcm} from './spu_sample_pcm.js';
import {decodePsfAdpcmPreview} from './psf_live_snapshot.js';

function packets(count, {loopStartSamples = null} = {}) {
  const adpcm = new Uint8Array(count * 16);
  let seed = 0x61ac4e9;
  for (let block = 0; block < count; block++) {
    // 65 packets exercise every predictor/shift combination, including
    // negative nibbles, and carry their history across every packet boundary.
    const at = block * 16;
    adpcm[at] = ((block % 5) << 4) | (block % 13);
    for (let byte = 2; byte < 16; byte++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      adpcm[at + byte] = seed >>> 24;
    }
  }
  adpcm[adpcm.length - 15] = loopStartSamples === null ? 1 : 3;
  if (loopStartSamples !== null) adpcm[loopStartSamples / 28 * 16 + 1] |= 4;
  return {sampleId: 7, token: 'original-source', adpcm, baseFrequencyHz: 321.25, loopStartSamples};
}

test('short one-shots decode exactly 28 LSB-first signed samples without padding or normalization', () => {
  const source = packets(1); source.adpcm[0] = 12; source.adpcm.fill(0xf0, 2);
  source.adpcm.set([0x87, 0xf1, 0x20, 0xde], 2);
  const before = source.adpcm.slice(), pcm = decodeSpuSamplePcm(source);
  assert(pcm instanceof Float32Array); assert.equal(pcm.length, 28);
  assert.deepEqual(Array.from(pcm.slice(0, 8)), [7, -8, 1, -1, 0, 2, -2, -3].map(value => value / 32768));
  assert.deepEqual(Array.from(pcm.slice(8)), Array.from({length: 20}, (_, index) => index % 2 ? -1 / 32768 : 0));
  assert.deepEqual(source.adpcm, before); assert.equal(source.baseFrequencyHz, 321.25);
  pcm.fill(.9); assert.notDeepEqual(pcm, decodeSpuSamplePcm(source), 'returned PCM is independent of its immutable source');
});

test('full samples retain every packet and predictor history beyond the 112-frame preview', () => {
  const source = packets(65), original = source.adpcm.slice(), pcm = decodeSpuSamplePcm(source);
  assert.equal(pcm.length, 65 * 28); assert.equal(pcm.length, source.adpcm.length / 16 * 28);
  assert.deepEqual(Array.from(pcm.slice(0, 112)), decodePsfAdpcmPreview(source.adpcm.subarray(0, 64)).pcm);
  const separate = source.adpcm.slice(64, 80); separate[1] = 1;
  assert.notDeepEqual(pcm.slice(112, 140), decodeSpuSamplePcm({...source, adpcm: separate}), 'packet history is not reset at preview boundaries');
  assert(pcm.every(value => Number.isFinite(value) && value >= -1 && value < 1));
  assert.deepEqual(source.adpcm, original); assert.equal(source.sampleId, 7); assert.equal(source.token, 'original-source');
});

test('looping samples preserve their intro, full length and source loop/tuning metadata', () => {
  const source = packets(9, {loopStartSamples: 56}), original = structuredClone(source);
  const pcm = decodeSpuSamplePcm(source), oneShot = source.adpcm.slice(); oneShot[oneShot.length - 15] = 1;
  assert.deepEqual(pcm, decodeSpuSamplePcm({...source, adpcm: oneShot, loopStartSamples: null}), 'LOOP does not reset first-pass predictor history or expand data');
  assert.equal(pcm.length, 252); assert.deepEqual(source, original);
  assert.deepEqual(decodeSpuSamplePcm({...source, loopStartSamples: 56}), pcm);
});

test('overflow follows actual signed-short wrapping rather than clipping predictor history', () => {
  const source = packets(1); source.adpcm[0] = 0x10; source.adpcm.fill(0x77, 2);
  const pcm = decodeSpuSamplePcm(source);
  assert.deepEqual(Array.from(pcm.slice(0, 6)), [28672, -9984, 19312, -18759, 11085, -26472].map(value => value / 32768));
  assert(pcm[1] < 0, 'the overflowing positive sum wraps instead of saturating');
});

test('invalid packets, END placement, loop metadata and tuning reject without changing source bytes', () => {
  assert.throws(() => decodeSpuSamplePcm(null), /source.*Uint8Array/);
  assert.throws(() => decodeSpuSamplePcm({...packets(1), adpcm: [0, 1]}), /Uint8Array/);
  for (const [mutate, message] of [
    [source => {source.adpcm = new Uint8Array(15);}, /complete 16-byte/],
    [source => {source.adpcm[0] = 0x50;}, /predictor/],
    [source => {source.adpcm[0] = 13;}, /shift/],
    [source => {source.adpcm[1] = 8;}, /flags/],
    [source => {source.adpcm[1] = 1;}, /END only/],
    [source => {source.adpcm[source.adpcm.length - 15] = 0;}, /END only/],
    [source => {source.adpcm[source.adpcm.length - 15] = 3;}, /explicit loopStartSamples/],
    [source => {source.loopStartSamples = 0;}, /LOOP on the END/],
    [source => {source.baseFrequencyHz = NaN;}, /positive finite/],
    [source => {source.baseFrequencyHz = 0;}, /positive finite/],
    [source => {source.adpcm = new Uint8Array(520208);}, /available sample RAM/],
  ]) {
    const source = packets(2); mutate(source); const bytes = source.adpcm.slice();
    assert.throws(() => decodeSpuSamplePcm(source), message); assert.deepEqual(source.adpcm, bytes);
  }
  assert.throws(() => decodeSpuSamplePcm({...packets(3, {loopStartSamples: 0}), loopStartSamples: 1}), /28-sample/);
  assert.throws(() => decodeSpuSamplePcm({...packets(3, {loopStartSamples: 0}), loopStartSamples: 28}), /disagrees/);
  const multiple = packets(3, {loopStartSamples: 0}); multiple.adpcm[17] = 4;
  assert.throws(() => decodeSpuSamplePcm(multiple), /multiple LOOP START/);
});

test('full source reconstruction exactly matches the pinned native decoder including maximum sample RAM', async t => {
  const compiler = process.env.CXX || 'c++', probe = spawnSync(compiler, ['--version'], {encoding: 'utf8'});
  if (probe.error?.code === 'ENOENT') {t.skip('C++ compiler unavailable; actual native comparison not run'); return;}
  assert.equal(probe.status, 0, probe.stderr || probe.error?.message);
  const root = fileURLToPath(new URL('../../', import.meta.url)), temp = await mkdtemp(join(tmpdir(), 'spu-full-sample-pcm-'));
  t.after(() => rm(temp, {recursive: true, force: true}));
  const directory = join(root, 'third_party/tetorica-soundchip-native/vendor/mame-ps1-spu'), binary = join(temp, 'decode');
  const built = spawnSync(compiler, ['-std=c++17', '-O2', '-fwrapv', '-fno-strict-aliasing', '-ffp-contract=off', '-I' + directory,
    join(root, 'test/helpers/ps1_adpcm_decode_reference.cpp'), join(directory, 'spu_tables.cpp'), join(directory, 'spureverb.cpp'), '-o', binary], {encoding: 'utf8'});
  assert.equal(built.status, 0, built.stderr || built.error?.message);
  const streams = [packets(1), packets(65), packets(65, {loopStartSamples: 28 * 17}), packets(32512, {loopStartSamples: 28 * 31})];
  streams[0].adpcm[0] = 0x10; streams[0].adpcm.fill(0x77, 2);
  const u32 = value => {const bytes = Buffer.alloc(4); bytes.writeUInt32LE(value); return bytes;};
  const result = spawnSync(binary, [], {input: Buffer.concat([u32(streams.length), ...streams.flatMap(source => [u32(source.adpcm.length), source.adpcm])]), maxBuffer: 16 * 1024 * 1024});
  assert.equal(result.status, 0, result.stderr?.toString() || result.error?.message);
  let offset = 0;
  for (const source of streams) {
    const actual = decodeSpuSamplePcm(source);
    assert.equal(actual.length, source.adpcm.length / 16 * 28);
    for (let frame = 0; frame < actual.length; frame++, offset += 2)
      assert.equal(actual[frame], result.stdout.readInt16LE(offset) / 32768, `native sample ${frame} of ${actual.length}`);
  }
  assert.equal(offset, result.stdout.length);
});

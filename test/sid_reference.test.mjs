// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, writeFile, rm, access} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {measurePcm, comparePcm, readFloatPcm, floatWave} from '../tetorica_src/cli/sid_reference_metrics.mjs';
import {parseSidReferenceArgs, runSidReference, prepareSidTraceRenderer, readBoundedReferenceFile} from '../tetorica_src/cli/sid_reference.mjs';
import {createSidReferenceFixture} from './fixtures/sid-reference/fixture.mjs';

test('reference metrics measure known DC/tone/bands without modifying or normalizing samples', () => {
  const rate = 48000, pcm = Float32Array.from({length: rate}, (_, i) => .375 + .25 * Math.sin(2 * Math.PI * 440 * i / rate));
  const before = pcm.slice(), measured = measurePcm(pcm, rate);
  assert(Math.abs(measured.mean - .375) < 1e-8);
  assert(Math.abs(measured.acRms - .25 / Math.sqrt(2)) < 1e-8);
  assert.equal(measured.peak, .625); assert.equal(measured.overrange, 0);
  assert(Math.abs(measured.spectrum.dominantBinHz - 440) <= measured.spectrum.binWidthHz);
  assert(measured.spectrum.bandPowerFractions.from200To2000Hz > .999);
  assert.deepEqual(pcm, before);
  const high = Float32Array.from({length: rate}, (_, i) => Math.sin(2 * Math.PI * 6000 * i / rate));
  assert(measurePcm(high, rate).spectrum.bandPowerFractions.above2000Hz > .999);
  assert.equal(measurePcm(new Float32Array(64), rate).spectrum.dominantBinHz, null);
});

test('comparison keeps gain, sign, sample indices and extra reference frames visible', () => {
  const reference = Float32Array.of(1, -1, 1, -1, .5), actual = Float32Array.of(-2, 2, -2, 2);
  const measured = comparePcm(reference, actual);
  assert.equal(measured.commonFrames, 4); assert.equal(measured.referenceExtraFrames, 1);
  assert.equal(measured.rmse, 3); assert.equal(measured.centeredCorrelation, -1);
  assert.equal(measured.rmsRatioActualToReference, 2);
  assert.equal(comparePcm(new Float32Array(0), actual).rmse, null);
  assert.throws(() => comparePcm(Float32Array.of(NaN), actual), /Nonfinite/);
});

test('float WAV preserves overrange samples and declares mono IEEE float with a fact chunk', () => {
  const pcm = Float32Array.of(-1.25, -.5, 0, .5, 1.25), wav = floatWave(pcm, 48000);
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF'); assert.equal(wav.readUInt32LE(4), wav.length - 8);
  assert.equal(wav.readUInt16LE(20), 3); assert.equal(wav.readUInt16LE(22), 1);
  assert.equal(wav.readUInt16LE(34), 32); assert.equal(wav.toString('ascii', 36, 40), 'fact');
  assert.equal(wav.readUInt32LE(44), 5); assert.equal(wav.toString('ascii', 48, 52), 'data');
  assert.deepEqual(readFloatPcm(wav.subarray(56)), pcm);
  assert.equal(measurePcm(pcm, 48000).overrange, 2);
  assert.throws(() => readFloatPcm(Buffer.alloc(3)), /PCM/);
  assert.throws(() => floatWave(Float32Array.of(Infinity), 48000), /Nonfinite/);
});

test('comparison help and argument errors never build, download or open an audio device', () => {
  const script = fileURLToPath(new URL('../tetorica_src/cli/sid_reference.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [script, '--help'], {encoding: 'utf8'});
  assert.equal(result.status, 0, result.stderr); assert.match(result.stdout, /No audio device is opened/);
  const parsed = parseSidReferenceArgs(['--fixture', 'tone', '--seconds', '1.5', '--offline']);
  assert.equal(parsed.seconds, 1.5); assert.equal(parsed.fixture, 'tone'); assert.equal(parsed.offline, true);
  for (const args of [['--bogus'], ['--seconds'], ['one.sid', 'two.sid'], ['--offline', '--offline'], ['--seconds', '1', '--seconds', '2']]) assert.throws(() => parseSidReferenceArgs(args));
});

test('unsupported PSID execution subsets fail before creating output or preparing the external engine', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'sid-reference-options-'));
  t.after(() => rm(directory, {recursive: true, force: true}));
  const inputPath = join(directory, 'input.sid'), outDir = join(directory, 'never-created');
  const original = createSidReferenceFixture('tone').bytes;
  for (const [change, expected] of [
    [bytes => { bytes[5] = 3; }, /v2 only/],
    [bytes => { bytes[0x15] = 1; }, /VBI timing/],
    [bytes => { bytes[0x78] = 0x80; bytes[0x79] = 1; }, /relocation/],
  ]) {
    const bytes = Uint8Array.from(original); change(bytes); await writeFile(inputPath, bytes);
    await assert.rejects(runSidReference({inputPath, outDir, offline: true}), expected);
    await assert.rejects(access(outDir), {code: 'ENOENT'});
  }
  for (const options of [{seconds: 0}, {seconds: .01}, {sampleRate: 48000.5}, {eventChunk: 0}, {eventChunk: 4097}, {renderChunk: 0}, {renderChunk: 8193}, {inputPath, fixture: 'tone'}])
    await assert.rejects(runSidReference({fixture: 'tone', outDir, ...options}));
});

test('trace renderer cache rejects tampered compiler, platform and flag provenance', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'sid-renderer-provenance-'));
  t.after(() => rm(directory, {recursive: true, force: true}));
  const {binary} = await prepareSidTraceRenderer(directory), receipt = JSON.parse(await readFile(binary + '.json'));
  assert.equal((await prepareSidTraceRenderer(directory)).binary, binary);
  for (const [key, value] of [['compiler', 'different-compiler'], ['compilerVersion', 'unknown'], ['flags', ['-ffast-math']], ['platform', 'different-os'], ['arch', 'different-cpu']]) {
    const edited = structuredClone(receipt); edited.build[key] = value;
    await writeFile(binary + '.json', JSON.stringify(edited));
    await assert.rejects(prepareSidTraceRenderer(directory), /cache is invalid/);
  }
  await writeFile(binary + '.json', JSON.stringify(receipt));
  assert.equal((await prepareSidTraceRenderer(directory)).binary, binary);
});

test('reference file reads preserve boundary bytes and reject non-files or oversized inputs', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'sid-reference-file-bound-'));
  t.after(() => rm(directory, {recursive: true, force: true}));
  const file = join(directory, 'bytes'), original = Buffer.alloc(65537, 123);
  await writeFile(file, original);
  assert.deepEqual(await readBoundedReferenceFile(file, original.length), original);
  await assert.rejects(readBoundedReferenceFile(file, 65536), /bounded file size/);
  await assert.rejects(readBoundedReferenceFile(directory, 65536), /bounded file size/);
  await assert.rejects(readBoundedReferenceFile(file, 0), /Invalid reference file limit/);
});

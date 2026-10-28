import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {renderPs1Sample, renderPs1SampleComparison} from './playground_sample_ps1.js';
import {renderSampleEdit} from './playground_sample_edit.js';
import {encodePs1Adpcm, DEFAULT_PS1_ADPCM_MAX_BYTES} from './ps1_adpcm_encoder.js';
import {preparePs1ADPCM} from './ps1synth.js';

const signal = (sampleRate = 44100, frames = 560) => ({sampleRate,
  channels: [Float32Array.from({length: frames}, (_, i) => .7 * Math.sin(2 * Math.PI * 440 * i / sampleRate))]});

test('PS1 conversion uses existing non-destructive edits and fixed-rate mono PCM at 8, 44.1 and 48 kHz', () => {
  for (const rate of [8000, 44100, 48000]) {
    const audio = signal(rate, Math.round(rate * .035));
    audio.channels.push(Float32Array.from(audio.channels[0], value => value * .4));
    const original = structuredClone(audio);
    const settings = {startFrame: 17, endFrame: audio.channels[0].length - 20,
      gainDb: 5, fadeInSeconds: .002, fadeOutSeconds: .003, rootMidi: 69, tuneCents: 53,
      drawPoints: [[30, -.9], [40, .8]], drawStrokes: [[[60, .7], [80, -.4]]]};
    const edited = renderSampleEdit(audio, settings, {sampleRate: 44100, mono: true});
    const result = renderPs1Sample(audio, settings), encoded = encodePs1Adpcm(edited.channels[0]);
    assert.deepEqual(result.channels, edited.channels);
    assert.deepEqual(result.adpcm, encoded.adpcm);
    assert.deepEqual(result.metrics, encoded.metrics);
    assert.equal(result.sourceStartFrame, 17);
    assert.equal(result.sourceEndFrame, settings.endFrame);
    assert.equal(result.sampleRate, 44100);
    assert.equal(result.channels.length, 1);
    assert.equal(result.rootMidi, 69); assert.equal(result.tuneCents, 53);
    assert.equal(result.baseFrequencyHz, 440 * 2 ** (.53 / 12));
    assert.equal(result.peakBeforeClip, edited.peakBeforeClip);
    assert.equal(result.clippedSamples, edited.clippedSamples);
    assert.ok(result.channels[0][0] === 0); assert.ok(result.channels[0].at(-1) === 0);
    assert.equal(result.loopEnabled, false);
    assert.equal(result.paddingFrames, (28 - result.sourceFrames % 28) % 28);
    assert.equal(result.frames, result.sourceFrames + result.paddingFrames);
    assert.equal(result.decodedChannels[0].length, result.frames);
    preparePs1ADPCM(result.adpcm, {baseFrequencyHz: result.baseFrequencyHz});
    assert.deepEqual(audio, original, 'source PCM and drawing/edit metadata stay untouched');
    assert.notEqual(result.channels[0], audio.channels[0]);
    result.channels[0].fill(0); result.adpcm.fill(255); result.decodedChannels[0].fill(1);
    assert.deepEqual(audio, original, 'all returned large arrays own storage');
  }
});

test('root/tune metadata never changes encoded recording PCM or infers a cycle', () => {
  const audio = signal(44100, 112), normal = renderPs1Sample(audio, {rootMidi: 60});
  const tuned = renderPs1Sample(audio, {rootMidi: 69, tuneCents: 88});
  assert.deepEqual(tuned.channels, normal.channels);
  assert.deepEqual(tuned.adpcm, normal.adpcm);
  assert.equal(normal.baseFrequencyHz, 440 * 2 ** (-9 / 12));
  assert.equal(tuned.baseFrequencyHz, 440 * 2 ** (.88 / 12));
  assert.notEqual(normal.baseFrequencyHz, 44100 / 112, 'a short recording is not treated as a single automatic cycle');
});

test('loops align inward after resampling, preserve the intro and explicitly report discarded tail', () => {
  for (const rate of [8000, 44100, 48000]) {
    const audio = signal(rate, Math.round(rate * .025));
    const settings = {startFrame: 7, endFrame: audio.channels[0].length - 3, rootMidi: 72, tuneCents: -18,
      loopEnabled: true, loopStartFrame: 19, loopEndFrame: audio.channels[0].length - 15};
    const edited = renderSampleEdit(audio, settings, {sampleRate: 44100, mono: true});
    const result = renderPs1Sample(audio, settings);
    const start = Math.ceil(edited.loopStartFrame / 28) * 28, end = Math.floor(edited.loopEndFrame / 28) * 28;
    assert.equal(result.loopStartFrame, start); assert.equal(result.loopEndFrame, end);
    assert.equal(result.loopStartSamples, start); assert.equal(result.loopEnabled, true);
    assert.deepEqual(result.channels[0], edited.channels[0].slice(0, end));
    assert.deepEqual(result.adpcm, encodePs1Adpcm(result.channels[0], {loopStartSamples: start}).adpcm);
    assert.deepEqual(result.alignment, {blockFrames: 28,
      changed: start !== edited.loopStartFrame || end !== edited.loopEndFrame,
      requested: {startFrame: edited.loopStartFrame, endFrame: edited.loopEndFrame},
      applied: {startFrame: start, endFrame: end}, discardedTailFrames: edited.channels[0].length - end});
    assert.ok(start >= edited.loopStartFrame && end <= edited.loopEndFrame);
    assert.equal(result.paddingFrames, 0);
    const prepared = preparePs1ADPCM(result.adpcm, {baseFrequencyHz: result.baseFrequencyHz, loopStartSamples: start});
    assert.equal(prepared.decodedFrames, end);
  }
  const aligned = renderPs1Sample(signal(), {loopEnabled: true, loopStartFrame: 56, loopEndFrame: 280});
  assert.equal(aligned.alignment.changed, false);
  assert.equal(aligned.alignment.discardedTailFrames, 280);
  for (const [start, end] of [[1, 28], [27, 55], [28, 55]]) {
    assert.throws(() => renderPs1Sample(signal(), {loopEnabled: true, loopStartFrame: start, loopEndFrame: end}), /complete 28-frame packet/);
  }
  const minimal = renderPs1Sample(signal(), {loopEnabled: true, loopStartFrame: 28, loopEndFrame: 56});
  assert.equal(minimal.adpcm.at(-15), 7, 'minimum final-packet loop carries all three markers');
});

test('byte budgets bound the working selection without changing normal post-loop truncation', () => {
  const audio = signal(44100, 280);
  assert.equal(renderPs1Sample(audio, {}, {maxBytes: 160}).adpcm.length, 160);
  assert.throws(() => renderPs1Sample(audio, {}, {maxBytes: 159}), /Shorten the selection/);
  const looped = renderPs1Sample(audio, {loopEnabled: true, loopStartFrame: 28, loopEndFrame: 56}, {maxBytes: 160});
  assert.equal(looped.adpcm.length, 32); assert.equal(looped.alignment.discardedTailFrames, 224);
  assert.throws(() => renderPs1Sample(audio, {loopEnabled: true, loopStartFrame: 28, loopEndFrame: 56}, {maxBytes: 32}), /Shorten the selection/);
  for (const maxBytes of [0, 15, NaN, 16.5, DEFAULT_PS1_ADPCM_MAX_BYTES + 1]) {
    assert.throws(() => renderPs1Sample(audio, {}, {maxBytes}), /maxBytes/);
  }
  assert.throws(() => renderPs1Sample(audio, {}, {extra: 1}), /options/);
  assert.throws(() => renderPs1Sample({...audio, channels: [Float32Array.of(NaN)]}), /finite/);
  const settings = {gainDb: 24}, clipped = renderPs1Sample(signal(), settings);
  assert.ok(clipped.clippedSamples > 0);
  assert.ok(clipped.channels[0].every(value => Math.abs(value) <= 1));
});

test('a short loop cannot bypass the native-rate working-selection bound before source scanning', () => {
  // Only 40 KiB of source PCM would expand to 441 million frames at 44.1 kHz.
  // Its one-second loop fits RAM, but the full selection must be shortened
  // before the shared editor resampler is allowed to allocate its output.
  const audio = {sampleRate: 1, channels: [new Float32Array(10000)]};
  audio.channels[0][9999] = NaN;
  const settings = {loopEnabled: true, loopStartFrame: 0, loopEndFrame: 1};
  assert.throws(() => renderPs1Sample(audio, settings), error => {
    assert.match(error.message, /PS1 edited selection needs 441000000 native frames/);
    assert.match(error.message, /Shorten the selection; the original recording is preserved/);
    assert.doesNotMatch(error.message, /finite/);
    return true;
  });
  assert.equal(audio.channels[0].length, 10000);
  assert.ok(Number.isNaN(audio.channels[0][9999]), 'the rejected conversion does not edit its source');
});

test('comparison is bounded and matches the canonical raw reconstructed PCM, including one-shot padding', () => {
  for (const frames of [1, 17, 28, 1000]) {
    const audio = signal(44100, frames), settings = {rootMidi: 74, tuneCents: -25};
    const rendered = renderPs1Sample(audio, settings), result = renderPs1SampleComparison(audio, settings);
    assert.equal(result.sourceFrameCount, frames);
    assert.equal(result.decodedFrameCount, rendered.frames);
    assert.equal(result.byteLength, rendered.adpcm.length);
    assert.ok(!('channels' in result) && !('decodedChannels' in result) && !('adpcm' in result), 'bounded transfer has no recording-sized arrays');
    for (const [display, pcm] of [[result.sourceDisplay, rendered.channels[0]], [result.decodedDisplay, rendered.decodedChannels[0]]]) {
      assert.equal(display.length, Math.min(256, pcm.length));
      for (let i = 0; i < display.length; i++) assert.equal(display[i], pcm[display.length === 1 ? 0 : Math.round(i * (pcm.length - 1) / (display.length - 1))]);
    }
    let error = 0, maxError = 0;
    for (let i = 0; i < frames; i++) {
      const d = rendered.channels[0][i] - rendered.decodedChannels[0][i];
      error += d * d; maxError = Math.max(maxError, Math.abs(d));
    }
    assert.equal(result.metrics.rmsError, Math.sqrt(error / frames));
    assert.equal(result.metrics.maxError, maxError);
    assert.equal(result.metrics.errorFrames, frames);
    assert.deepEqual(JSON.parse(JSON.stringify(result.metrics)), result.metrics);
    result.sourceDisplay.fill(.123); result.decodedDisplay.fill(.123);
    assert.deepEqual(renderPs1SampleComparison(audio, settings).metrics, rendered.metrics);
  }
});

test('comparison reconstruction exactly matches the actual pinned native decoder', async t => {
  const compiler = process.env.CXX || 'c++', probe = spawnSync(compiler, ['--version'], {encoding: 'utf8'});
  if (probe.error?.code === 'ENOENT') {t.skip('C++ compiler unavailable; native decoder check not run'); return;}
  assert.equal(probe.status, 0, probe.stderr || probe.error?.message);
  const root = fileURLToPath(new URL('../', import.meta.url));
  const temp = await mkdtemp(join(tmpdir(), 'ps1-sample-comparison-')); t.after(() => rm(temp, {recursive: true, force: true}));
  const binary = join(temp, 'decoder'), directory = join(root, 'third_party/tetorica-soundchip-native/vendor/mame-ps1-spu');
  const built = spawnSync(compiler, ['-std=c++17', '-O2', '-fwrapv', '-fno-strict-aliasing', '-ffp-contract=off', '-I' + directory,
    join(root, 'test/helpers/ps1_adpcm_decode_reference.cpp'), join(directory, 'spu_tables.cpp'), join(directory, 'spureverb.cpp'), '-o', binary], {encoding: 'utf8'});
  assert.equal(built.status, 0, built.stderr || built.error?.message);
  let seed = 0x913fe0;
  const fixture = {sampleRate: 48000, channels: [Float32Array.from({length: 2500}, (_, i) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return .45 * Math.sin(i * .1) + .4 * (seed / 0x80000000 - 1);
  })]};
  const streams = [renderPs1Sample(fixture), renderPs1Sample(fixture, {loopEnabled: true, loopStartFrame: 147, loopEndFrame: 2345})];
  const u32 = value => {const bytes = Buffer.alloc(4); bytes.writeUInt32LE(value); return bytes;};
  const result = spawnSync(binary, [], {input: Buffer.concat([u32(streams.length), ...streams.flatMap(stream => [u32(stream.adpcm.length), stream.adpcm])])});
  assert.equal(result.status, 0, result.stderr?.toString());
  let offset = 0;
  for (const stream of streams) for (const value of stream.decodedChannels[0]) {
    assert.equal(value, result.stdout.readInt16LE(offset) / 32768); offset += 2;
  }
  assert.equal(offset, result.stdout.length);
});

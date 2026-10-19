import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createSampleEdit, normalizeSampleEdit, renderSampleEdit, sampleNormalizationGainDb,
  estimateSamplePitch, renderGameboyWave, encodeSampleWav, decodeSampleWav,
} from './playground_sample_edit.js';

const audio = (values, sampleRate = 1000) => ({channels: [Float32Array.from(values)], sampleRate});
const tone = (hz, {sampleRate = 48000, seconds = 1, gain = .6} = {}) => audio(
  Float32Array.from({length: Math.round(sampleRate * seconds)}, (_, i) => gain * Math.sin(2 * Math.PI * hz * i / sampleRate)), sampleRate);
const close = (actual, expected, tolerance = 1e-5) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} should be close to ${expected}`);
const rms = values => Math.sqrt(values.reduce((sum, value) => sum + value * value, 0) / values.length);

test('edit settings normalize source-frame bounds without mutating source PCM or input settings', () => {
  const input = audio([0, .1, .2, .3, .4, .5]);
  const original = input.channels[0].slice();
  const settings = {startFrame: -20, endFrame: 200, gainDb: 90, fadeInSeconds: 10,
    fadeOutSeconds: -1, rootMidi: 500, tuneCents: -500, loopEnabled: true, loopStartFrame: 4, loopEndFrame: 0,
    drawStrokes: [[[5, 3], [2, -.5], [5, .75]]]};
  const saved = structuredClone(settings), edit = createSampleEdit(input, {settings});
  assert.deepEqual([edit.startFrame, edit.endFrame, edit.loopStartFrame, edit.loopEndFrame], [0, 6, 4, 5]);
  assert.deepEqual([edit.gainDb, edit.fadeInSeconds, edit.fadeOutSeconds, edit.rootMidi, edit.tuneCents], [24, .006, 0, 127, -100]);
  assert.deepEqual(edit.drawStrokes, [[[2, -.5], [5, .75]]]);
  assert.deepEqual(input.channels[0], original);
  assert.deepEqual(settings, saved);
  assert.deepEqual(normalizeSampleEdit(input, JSON.parse(JSON.stringify(edit))), edit);
});

test('crop, gain, fades and clipping operate on owned PCM and report actual pre-clip peaks', () => {
  const input = audio(Array(12).fill(.8));
  const output = renderSampleEdit(input, {startFrame: 2, endFrame: 10, gainDb: 20 * Math.log10(2), fadeInSeconds: .002, fadeOutSeconds: .002});
  assert.equal(output.channels[0].length, 8);
  close(output.channels[0][0], 0); close(output.channels[0][1], .8);
  close(output.channels[0][2], 1); close(output.channels[0][6], .8); close(output.channels[0][7], 0);
  close(output.peakBeforeClip, 1.6);
  assert.equal(output.clippedSamples, 4);
  assert.deepEqual([output.sourceStartFrame, output.sourceEndFrame], [2, 10]);
  assert.ok(input.channels[0].every(value => value === Math.fround(.8)));
  output.channels[0][0] = 1;
  assert.equal(input.channels[0][2], Math.fround(.8));
});

test('independent draw gestures leave gaps intact, interpolate only inside a stroke and allow a later overwrite', () => {
  const input = audio(Array(12).fill(.25));
  const output = renderSampleEdit(input, {drawStrokes: [
    [[1, -1], [3, 1]], [[8, -.5], [10, .5]], [[2, .7]],
  ]});
  const expected = [.25, -1, .7, 1, .25, .25, .25, .25, -.5, 0, .5, .25];
  output.channels[0].forEach((value, index) => close(value, expected[index]));
  assert.ok(input.channels[0].every(value => value === .25));
  const cropped = renderSampleEdit(input, {startFrame: 2, endFrame: 4, drawPoints: [[0, -1], [4, 1]]});
  assert.deepEqual([...cropped.channels[0]], [0, .5]);
});

test('mono downmix and explicit stereo output share edits without sharing source memory', () => {
  const input = {channels: [new Float32Array([.5, -.5]), new Float32Array([.1, -.1])], sampleRate: 8000};
  const mono = renderSampleEdit(input);
  close(mono.channels[0][0], .3);
  assert.equal(mono.channels.length, 1);
  const stereo = renderSampleEdit(input, {}, {mono: false});
  assert.equal(stereo.channels.length, 2);
  assert.deepEqual(stereo.channels, input.channels);
  assert.notEqual(stereo.channels[0], input.channels[0]);
  const patched = renderSampleEdit(input, {drawPoints: [[0, .8]]}, {mono: false});
  close(patched.channels[0][0], .8); close(patched.channels[1][0], .8);
});

test('bandlimited resampling preserves a usable tone and suppresses a high-frequency alias', () => {
  const low = renderSampleEdit(tone(1000, {seconds: .1}), {}, {sampleRate: 16000});
  const high = renderSampleEdit(tone(12000, {seconds: .1}), {}, {sampleRate: 16000});
  assert.equal(low.channels[0].length, 1600);
  assert.ok(rms(low.channels[0].slice(160, -160)) > .41);
  assert.ok(rms(high.channels[0].slice(160, -160)) < .003);
  assert.throws(() => renderSampleEdit(tone(440), {}, {sampleRate: 16000, maxFrames: 15999}), /Shorten it or lower/);
  assert.equal(renderSampleEdit(tone(440), {}, {sampleRate: 16000, maxFrames: 16000}).channels[0].length, 16000);
});

test('loop positions follow crop and output rate while root/tuning remain non-destructive metadata', () => {
  const input = tone(440, {sampleRate: 48000, seconds: .1});
  const output = renderSampleEdit(input, {startFrame: 1200, endFrame: 3600, loopEnabled: true,
    loopStartFrame: 1800, loopEndFrame: 3000, rootMidi: 69, tuneCents: -23}, {sampleRate: 16000});
  assert.equal(output.channels[0].length, 800);
  assert.deepEqual([output.loopStartFrame, output.loopEndFrame, output.loopEnabled], [200, 600, true]);
  assert.deepEqual([output.rootMidi, output.tuneCents], [69, -23]);
  const plain = renderSampleEdit(input, {startFrame: 1200, endFrame: 3600}, {sampleRate: 16000});
  assert.deepEqual(output.channels, plain.channels, 'root/tuning do not change source playback speed during rendering');
});

test('normalization uses the selected patched source peak and leaves silence at zero gain', () => {
  const input = audio([.9, -.25, .5, .25]);
  const settings = {startFrame: 1, endFrame: 4, gainDb: -40, fadeInSeconds: .003};
  close(sampleNormalizationGainDb(input, settings), 20 * Math.log10(.95 / .5));
  const gainDb = sampleNormalizationGainDb(input, {...settings, drawPoints: [[2, .8]]});
  close(gainDb, 20 * Math.log10(.95 / .8));
  const output = renderSampleEdit(input, {...settings, fadeInSeconds: 0, gainDb});
  assert.equal(output.clippedSamples, 0);
  assert.equal(sampleNormalizationGainDb(audio([0, 0, 0]), {}), 0);
});

for (const hz of [55, 110, 261.625565, 440, 880, 2000]) test(`bounded PCM periodicity identifies a steady ${hz} Hz reference`, () => {
  const input = tone(hz), original = input.channels[0].slice();
  const hint = estimateSamplePitch(input);
  assert.equal(hint.confidence, 'high', JSON.stringify(hint));
  assert.ok(Math.abs(1200 * Math.log2(hint.hz / hz)) < 4, JSON.stringify(hint));
  assert.deepEqual(input.channels[0], original);
});

test('pitch suggestions retain fractional cents and a weaker harmonic fundamental', () => {
  const hz = 440 * 2 ** (23 / 1200), hint = estimateSamplePitch(tone(hz));
  assert.equal(hint.midi, 69); close(hint.cents, 23, 1);
  const input = tone(220);
  for (let i = 0; i < input.channels[0].length; i++) input.channels[0][i] = .2 * Math.sin(2 * Math.PI * 220 * i / input.sampleRate) + .6 * Math.sin(2 * Math.PI * 440 * i / input.sampleRate);
  const harmonic = estimateSamplePitch(input);
  assert.equal(harmonic.confidence, 'high', JSON.stringify(harmonic));
  assert.ok(Math.abs(1200 * Math.log2(harmonic.hz / 220)) < 4);
});

test('silence, noise, short cycles and an unstable sweep never receive an automatic pitch', () => {
  let seed = 12345;
  const noise = audio(Float32Array.from({length: 48000}, () => {seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return (seed / 0x100000000 - .5) * .6;}), 48000);
  const sweep = tone(440);
  for (let i = 0; i < sweep.channels[0].length; i++) {const t = i / sweep.sampleRate; sweep.channels[0][i] = .6 * Math.sin(2 * Math.PI * (220 * t + 110 * t * t));}
  for (const input of [audio(new Float32Array(48000), 48000), noise, tone(440, {seconds: .002}), sweep, tone(6000)]) {
    const hint = estimateSamplePitch(input);
    assert.equal(hint.confidence, 'none', JSON.stringify(hint));
    assert.equal(hint.hz, null); assert.equal(hint.midi, null); assert.equal(hint.cents, null);
    assert.ok(hint.reason.length > 0);
  }
});

test('Game Boy conversion uses one selected cycle and yields 32 four-bit samples', () => {
  const cycle = tone(250, {sampleRate: 32000, seconds: 128 / 32000, gain: 1});
  const wave = renderGameboyWave(cycle, {});
  assert.ok(wave instanceof Uint8Array);
  assert.equal(wave.length, 32);
  assert.ok(wave.every(value => Number.isInteger(value) && value >= 0 && value <= 15));
  assert.equal(wave[8], 15); assert.equal(wave[24], 0);
  assert.ok(Math.abs(wave[0] - wave[16]) <= 1);
  const selected = audio([0, 0, ...cycle.channels[0], 0, 0], 32000);
  assert.deepEqual(renderGameboyWave(selected, {startFrame: 2, endFrame: 130}), wave);
});

test('Float32 WAV assets and JSON edit metadata round-trip exactly without baking in edits', async () => {
  const input = {sampleRate: 44100, channels: [new Float32Array([-.123456789, 0, .987654321]), new Float32Array([.25, -.75, 1.25])]};
  const original = input.channels.map(channel => channel.slice());
  const settings = createSampleEdit(input, {settings: {startFrame: 1, gainDb: 3, rootMidi: 64,
    tuneCents: 12.5, drawStrokes: [[[1, -.5], [2, .5]]]}});
  const bytes = encodeSampleWav(input), decoded = await decodeSampleWav(bytes);
  assert.equal(new DataView(bytes.buffer).getUint16(20, true), 3, 'IEEE float WAV retains source samples');
  assert.equal(decoded.sampleRate, input.sampleRate);
  assert.deepEqual(decoded.channels, original);
  const savedSettings = normalizeSampleEdit(decoded, JSON.parse(JSON.stringify(settings)));
  assert.deepEqual(savedSettings, settings);
  assert.deepEqual(renderSampleEdit(decoded, savedSettings), renderSampleEdit(input, settings));
  assert.deepEqual(input.channels, original);
});

test('malformed PCM, settings, target sizes and nonbinary assets are rejected', async () => {
  for (const input of [{}, audio([]), {channels: [new Float32Array(2), new Float32Array(3)], sampleRate: 8000}]) assert.throws(() => createSampleEdit(input));
  const input = audio([0, .5]);
  for (const settings of [{gainDb: NaN}, {drawStrokes: [[[0, Infinity]]]}, {loopEnabled: 'yes'}]) assert.throws(() => normalizeSampleEdit(input, settings));
  assert.throws(() => renderSampleEdit(audio([NaN]), {}), /finite/);
  assert.throws(() => renderSampleEdit(input, {}, {maxFrames: -1}));
  await assert.rejects(decodeSampleWav('https://example.com/audio.wav'), /WAV bytes/);
  await assert.rejects(decodeSampleWav(new Uint8Array([1, 2, 3])), /WAV/);
  const nonfinite = encodeSampleWav(input);
  new DataView(nonfinite.buffer).setFloat32(58, NaN, true);
  await assert.rejects(decodeSampleWav(nonfinite), /finite/);
});

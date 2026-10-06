import test from 'node:test';
import assert from 'node:assert/strict';
import {encodeWav} from './soundchip.js';
import {readSamplePCM} from './adpcm_b_sample.js';

test('mono PCM16 WAV: header, scaling, clipping and decoder round trip', async () => {
  const bytes = encodeWav({channels: [[-2, -.5, 0, .5, 2]], sampleRate: 8000});
  const view = new DataView(bytes.buffer);
  assert.equal(new TextDecoder().decode(bytes.subarray(0, 4)), 'RIFF');
  assert.equal(view.getUint32(4, true), bytes.length - 8);
  assert.equal(view.getUint16(20, true), 1);
  assert.equal(view.getUint16(22, true), 1);
  assert.equal(view.getUint32(28, true), 16000);
  assert.equal(view.getUint32(40, true), 10);
  assert.deepEqual(Array.from({length: 5}, (_, i) => view.getInt16(44 + i * 2, true)), [-32768, -16384, 0, 16384, 32767]);
  const pcm = await readSamplePCM(bytes);
  assert.equal(pcm.sampleRate, 8000);
  assert.deepEqual([...pcm.channels[0]], [-1, -.5, 0, .5, 32767 / 32768]);
});
test('stereo interleaving, gain and AudioBuffer input', () => {
  const bytes = encodeWav({left: [1, -1], right: [-1, 1], sampleRate: 44100}, {gain: .5});
  const view = new DataView(bytes.buffer);
  assert.equal(view.getUint16(22, true), 2);
  assert.deepEqual([44, 46, 48, 50].map(offset => view.getInt16(offset, true)), [16384, -16384, -16384, 16384]);
  const buffer = {sampleRate: 44100, numberOfChannels: 2, getChannelData: i => i ? [-1, 1] : [1, -1]};
  assert.deepEqual(encodeWav(buffer, {gain: .5}), bytes);
});
test('reject malformed PCM, nonfinite samples and invalid rates/gains', () => {
  for (const pcm of [{}, {channels: [[], []], sampleRate: 8000},
    {left: [1], right: [1, 2], sampleRate: 8000},
    {channels: [[0], [0], [0]], sampleRate: 8000},
    {channels: [[NaN]], sampleRate: 8000},
    {channels: [[0]], sampleRate: 8000.5}]) assert.throws(() => encodeWav(pcm));
  for (const gain of [-1, NaN, Infinity]) assert.throws(() => encodeWav({left: [1], sampleRate: 8000}, {gain}));
});

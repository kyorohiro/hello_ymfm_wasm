import test from 'node:test';
import assert from 'node:assert/strict';
import {ChipPCMRenderer} from './chip_pcm_renderer.js';

const valueAt = frame => Math.fround(Math.sin(frame * .137) * .3);
function source(rate) {
  let position = 0;
  const left = new Float32Array(16384), right = new Float32Array(16384);
  return {sampleRate: () => rate,
    generateStereo() {throw Error('Owned intermediate PCM is not needed');},
    generateStereoView(frames) {
      for (let i = 0; i < frames; i++) {left[i] = valueAt(position++); right[i] = -left[i];}
      return {left, right};
    },
    get position() {return position;},
  };
}

for (const rate of [32000, 44100, 53267, 500000, 1000000]) {
  test(`renderInto keeps continuous ${rate} Hz PCM across short output spans`, () => {
    const chip = source(rate), renderer = new ChipPCMRenderer(chip, {sampleRate: 48000, gain: .37});
    const chunks = [1, 17, 0, 128, 3, 128, 1], actual = [];
    for (const count of chunks) {
      const left = new Float32Array(count + 6).fill(9), right = left.slice();
      renderer.renderInto(left, right, 3, count);
      assert.ok(left.subarray(0, 3).every(value => value === 9));
      assert.ok(left.subarray(3 + count).every(value => value === 9));
      assert.deepEqual(right.subarray(0, 3), left.subarray(0, 3));
      for (let i = 0; i < count; i++) {
        actual.push(left[3 + i]);
        assert.ok(right[3 + i] === -left[3 + i]);
      }
    }
    let held = 0;
    const expected = Float32Array.from(actual, (_, i) => {
      const start = Math.floor(i * rate / 48000), end = Math.floor((i + 1) * rate / 48000);
      if (start !== end) {
        let sum = 0;
        for (let frame = start; frame < end; frame++) sum += valueAt(frame);
        held = sum / (end - start);
      }
      return held * .37;
    });
    assert.deepEqual(Float32Array.from(actual), expected);
    assert.equal(chip.position, Math.floor(actual.length * rate / 48000));
  });
}

test('owned PCM remains owned and invalid spans do not advance the chip', () => {
  const chip = source(44100), renderer = new ChipPCMRenderer(chip, {sampleRate: 48000});
  const first = renderer.render(17), copy = first.left.slice();
  renderer.renderInto(new Float32Array(128), new Float32Array(128));
  assert.deepEqual(first.left, copy);
  assert.equal(first.sampleRate, 48000);
  const before = chip.position;
  for (const args of [[-1, 1], [0, -1], [1, 4], [0, 1.5]]) {
    assert.throws(() => renderer.renderInto(new Float32Array(4), new Float32Array(4), ...args), /output span/);
  }
  assert.throws(() => renderer.renderInto(new Float32Array(4), new Float32Array(1), 0, 2), /output span/);
  assert.equal(chip.position, before);
});

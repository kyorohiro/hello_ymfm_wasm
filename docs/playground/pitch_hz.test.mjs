import test from 'node:test';
import assert from 'node:assert/strict';
import { hzToBlockFnum } from '../../web/pitch.js';
import { hzToBlockFnum as browserHzToBlockFnum } from '../js/pitch.js';
import { createPlaygroundMusic } from '../../web/playground_music.js';

test('Hz conversion chooses the nearest representable frequency', () => {
  for (const clock of [7670454, 8000000]) {
    for (const hz of [0.001, 220, 440, 440 * 3 / 2, 440 * (3 / 2) ** 12 / 128, 20000]) {
      const pitch = hzToBlockFnum(hz, clock);
      const actual = pitch.fnum * clock * 2 ** (pitch.block - 1) / (144 * 2 ** 20);
      let bestError = Infinity;
      for (let block = 0; block < 8; block++) {
        for (let fnum = 1; fnum <= 2047; fnum++) {
          bestError = Math.min(bestError, Math.abs(fnum * clock * 2 ** (block - 1) / (144 * 2 ** 20) - hz));
        }
      }
      assert.ok(Math.abs(actual - hz) <= bestError + 1e-10);
      assert.deepEqual(browserHzToBlockFnum(hz, clock), pitch);
    }
  }
});

test('Hz helper is pure and does not add a sound API', () => {
  const api = createPlaygroundMusic({});
  assert.deepEqual(api.hzToBlockFnum(440), hzToBlockFnum(440));
  assert.equal('sound' in api, false);
  for (const invalid of [0, -1, NaN, Infinity]) {
    assert.throws(() => hzToBlockFnum(invalid), /positive/);
    assert.throws(() => hzToBlockFnum(440, invalid), /positive/);
  }
});

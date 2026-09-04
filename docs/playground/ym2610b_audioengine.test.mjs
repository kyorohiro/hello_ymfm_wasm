import test from "node:test";
import assert from "node:assert/strict";

import { Ym2610BAudioEngine } from "../js/ym2610baudioengine.js";

test("YM2610B audio engine resamples PCM and maps both register ports", () => {
  const writes = [];
  const chip = {
    write(...args) { writes.push(args); },
    reset() {},
    dispose() {},
    generateStereo(frames) {
      return { left: new Float32Array(frames).fill(0.5), right: new Float32Array(frames).fill(-0.25) };
    },
  };
  const engine = new Ym2610BAudioEngine(chip, 8, 4, 0.5);
  engine.writeYm2610B(1, 0xa4, 0x2c);
  assert.deepEqual(writes, [[2, 0xa4], [3, 0x2c]]);
  assert.deepEqual(engine.processFrames(2), {
    left: new Float32Array([0.25, 0.25]),
    right: new Float32Array([-0.125, -0.125]),
  });
});

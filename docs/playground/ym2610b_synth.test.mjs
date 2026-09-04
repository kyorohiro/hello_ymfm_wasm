import test from "node:test";
import assert from "node:assert/strict";

import { NeoGeoFMSynth, YM2610BSynth } from "../js/ym2610bsynth.js";

test("YM2610B exposes six-channel OPN FM operations", () => {
  const writes = [];
  const fm = new YM2610BSynth({ transport: { reset() {}, write(...args) { writes.push(args); } } });
  writes.length = 0;
  fm.setFrequency(5, 4, 0x345);
  assert.deepEqual(writes, [
    [{ port: 1, register: 0xa6, value: 0x23 }],
    [{ port: 1, register: 0xa2, value: 0x45 }],
  ]);
});

test("Neo Geo facade maps four logical channels onto YM2610 hardware channels", () => {
  const calls = [];
  const fm = new NeoGeoFMSynth({
    setFrequency(...args) { calls.push(["frequency", ...args]); },
    keyOn(...args) { calls.push(["keyOn", ...args]); },
  });
  fm.setFrequency(0, 4, 553);
  fm.keyOn(3);
  assert.deepEqual(calls, [["frequency", 1, 4, 553], ["keyOn", 5]]);
  assert.throws(() => fm.keyOn(4), /0\.\.3/);
});

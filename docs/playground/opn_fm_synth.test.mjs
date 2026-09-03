import test from "node:test";
import assert from "node:assert/strict";

import {
  YM2203DirectTransport,
  YM2203Synth,
} from "../js/ym2203synth.js";
import {
  YM2608DirectTransport,
  YM2608Synth,
} from "../js/ym2608synth.js";

function createTransport() {
  const writes = [];
  return {
    writes,
    write(port, register, value) {
      writes.push({ port, register, value });
    },
    reset() {},
  };
}

test("YM2203 high-level FM API keeps writes on its three port-0 channels", () => {
  const transport = createTransport();
  const fm = new YM2203Synth({ transport });
  transport.writes.length = 0;

  fm.setOperator(2, 1, { dt: 2, multi: 3, tl: 0x24 });
  fm.setAlgo(2, 5, 6);
  fm.setFrequency(2, 4, 0x345);
  fm.keyOn(2);

  assert.deepEqual(transport.writes, [
    { port: 0, register: 0x3a, value: 0x23 },
    { port: 0, register: 0x4a, value: 0x24 },
    { port: 0, register: 0xb2, value: 0x35 },
    { port: 0, register: 0xa6, value: 0x23 },
    { port: 0, register: 0xa2, value: 0x45 },
    { port: 0, register: 0x28, value: 0xf2 },
  ]);
  assert.throws(() => fm.setPan(0, true, true), /does not support stereo pan/);
  assert.throws(() => fm.setLfo(true, 1), /does not support FM LFO/);
  assert.throws(() => fm.setModulation(0, 1, 1), /does not support FM LFO modulation/);
});

test("YM2608 high-level FM API maps channels 4-6 to port 1", () => {
  const transport = createTransport();
  const fm = new YM2608Synth({ transport });
  transport.writes.length = 0;

  fm.setOperator(4, 3, { tl: 0x18 });
  fm.setPan(4, true, false, 2, 3);
  fm.setLfo(true, 4);
  fm.setFrequency(4, 5, 0x456);
  fm.keyOff(4);

  assert.deepEqual(transport.writes, [
    { port: 1, register: 0x4d, value: 0x18 },
    { port: 1, register: 0xb5, value: 0xa3 },
    { port: 0, register: 0x22, value: 0x0c },
    { port: 1, register: 0xa5, value: 0x2c },
    { port: 1, register: 0xa1, value: 0x56 },
    { port: 0, register: 0x28, value: 0x05 },
  ]);
});

test("direct transports map high-level ports to each WASM address/data bus", () => {
  const ym2203Writes = [];
  const ym2203 = new YM2203DirectTransport({
    write(offset, value) {
      ym2203Writes.push({ offset, value });
    },
  });
  ym2203.write(0, 0x52, 0x34);

  const ym2608Writes = [];
  const ym2608 = new YM2608DirectTransport({
    write(offset, value) {
      ym2608Writes.push({ offset, value });
    },
  });
  ym2608.write(1, 0xa4, 0x2c);

  assert.deepEqual(ym2203Writes, [
    { offset: 0, value: 0x52 },
    { offset: 1, value: 0x34 },
  ]);
  assert.deepEqual(ym2608Writes, [
    { offset: 2, value: 0xa4 },
    { offset: 3, value: 0x2c },
  ]);
});

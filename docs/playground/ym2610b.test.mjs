import test from "node:test";
import assert from "node:assert/strict";

import { YM2610B_CLOCK, Ym2610B } from "../js/ym2610b.js";

test("YM2610B wrapper exposes the FM-only WASM lifecycle", async () => {
  const calls = [];
  const heap = new Float32Array(128);
  let nextPtr = 16;
  const module = {
    HEAPF32: heap,
    _malloc(bytes) { const ptr = nextPtr; nextPtr += bytes; return ptr; },
    _free(ptr) { calls.push(["free", ptr]); },
    cwrap(name) {
      return (...args) => {
        calls.push([name, ...args]);
        if (name === "ym2610b_create") return 99;
        if (name === "ym2610b_sample_rate") return 55555;
        if (name === "ym2610b_read") return 0x12;
        if (name === "ym2610b_get_irq") return 1;
        if (name === "ym2610b_generate") {
          heap[args[1] >> 2] = 0.25;
          heap[args[2] >> 2] = -0.5;
        }
        return 0;
      };
    },
  };
  const chip = await Ym2610B.create({ moduleFactory: async () => module });

  chip.reset();
  chip.write(2, 0xa4);
  assert.equal(chip.read(0), 0x12);
  assert.equal(chip.sampleRate(), 55555);
  assert.equal(chip.sampleRate(YM2610B_CLOCK), 55555);
  assert.equal(chip.getIrq(), true);
  assert.deepEqual(chip.generateStereo(1), {
    left: new Float32Array([0.25]),
    right: new Float32Array([-0.5]),
  });
  chip.dispose();

  assert.deepEqual(calls.slice(0, 4), [
    ["ym2610b_create"],
    ["ym2610b_reset", 99],
    ["ym2610b_write", 99, 2, 0xa4],
    ["ym2610b_read", 99, 0],
  ]);
  assert.ok(calls.some((call) => call[0] === "ym2610b_generate"));
  assert.ok(calls.some((call) => call[0] === "ym2610b_destroy"));
});

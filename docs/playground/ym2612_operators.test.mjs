import test from "node:test";
import assert from "node:assert/strict";
import { YM2612Synth } from "../../web/ym2612synth.js";
import { createFmProxy } from "../../web/playground_sync.js";

function fixture() {
  const writes = [];
  const synth = new YM2612Synth({ transport: { write: (port, register, value) => writes.push([port, register, value]) } });
  writes.length = 0;
  return { synth, writes };
}

test("setOperators preserves entry order, repeats and partial state through the Playground proxy", () => {
  for (let channel = 0; channel < 6; channel++) {
    const { synth, writes } = fixture();
    const entries = [[0, { tl: 20 }], [2, { dt: 3, multi: 4 }], [0, { tl: 20 }], [2, { multi: 5 }]];
    createFmProxy(synth).setOperators(channel, entries);
    const port = Math.floor(channel / 3);
    const offset = channel % 3;
    assert.deepEqual(writes, [[port, 0x40 + offset, 20], [port, 0x34 + offset, 0x34], [port, 0x40 + offset, 20], [port, 0x34 + offset, 0x35]]);
    assert.equal(synth.channels[channel].operators[2].dt, 3);
  }
});

test("setOperators validates every entry before writing or changing state", () => {
  for (const invalid of [[4, { tl: 0 }], [0, { tl: 128 }], [0, { am: 1 }], [0, null], [0], undefined]) {
    const { synth, writes } = fixture();
    const before = structuredClone(synth.channels);
    assert.throws(() => synth.setOperators(0, [[0, { tl: 12 }], invalid]));
    assert.deepEqual(writes, []);
    assert.deepEqual(synth.channels, before);
  }
});

test("setOperators uses register order within entries and supports sr alias", () => {
  const { synth, writes } = fixture();
  synth.setOperators(0, [[0, { tl: 20, multi: 6, dt: 1 }], [0, { sr: 5 }]]);
  assert.deepEqual(writes, [[0, 0x30, 0x16], [0, 0x40, 20], [0, 0x70, 5]]);
});

import test from "node:test";
import assert from "node:assert/strict";

import {
  createSegaPsgApi,
  psgPeriodFromFrequency,
  psgPeriodFromNote,
} from "../js/segapsg_api.js";

test("PSG tone API converts notes and volume to SN76489 writes", () => {
  const writes = [];
  const psg = createSegaPsgApi({
    write(value) {
      writes.push(value);
    },
  });

  assert.equal(psgPeriodFromNote("C4"), 428);
  assert.equal(psgPeriodFromFrequency(440), 0x0fe);
  assert.equal(psg.tone(0, { note: "C4", volume: 1 }), 428);
  psg.off(0);

  assert.deepEqual(writes, [0x8c, 0x1a, 0x90, 0x9f]);
});

test("PSG noise API maps type and rate without hiding raw writes", () => {
  const writes = [];
  const psg = createSegaPsgApi({
    write(value) {
      writes.push(value);
    },
  });

  assert.equal(
    psg.noise({
      type: "periodic",
      rate: "tone3",
      attenuation: 2,
    }),
    3
  );
  psg.noiseVolume(0.5);
  psg.noiseOff();
  psg.write(0xe7);

  assert.deepEqual(writes, [0xe3, 0xf2, 0xf7, 0xff, 0xe7]);
});

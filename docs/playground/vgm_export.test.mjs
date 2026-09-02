import test from "node:test";
import assert from "node:assert/strict";

import {
  Ym2612VGM,
  describeYm2612Write,
  exportYm2612VgmToPlaygroundJavaScript,
  getYm2612WriteTarget,
} from "../js/ym2612vgm.js";

function createVgmBuffer(commands, options = {}) {
  const dataOffset = 0x40;
  const totalLength = Math.max(0x4c, dataOffset + commands.length);
  const bytes = new Uint8Array(totalLength);
  bytes[0] = 0x56;
  bytes[1] = 0x67;
  bytes[2] = 0x6d;
  bytes[3] = 0x20;
  const view = new DataView(bytes.buffer);
  view.setUint32(0x08, 0x00000150, true);
  view.setUint32(0x18, options.totalSamples ?? 0, true);
  view.setUint32(0x2c, options.ym2612Clock ?? 7670454, true);
  bytes.set(commands, dataOffset);
  return bytes.buffer;
}

test("exportYm2612VgmToPlaygroundJavaScript separates global and channel timing", () => {
  const buffer = createVgmBuffer(
    Uint8Array.from([
      0x52, 0x22, 0x08,
      0x52, 0x30, 0x71,
      0x61, 0xe0, 0x01,
      0x52, 0x28, 0xf0,
      0x62,
      0x52, 0x28, 0x00,
      0x66,
    ])
  );

  const script = exportYm2612VgmToPlaygroundJavaScript(buffer);

  assert.match(script, /write\(0x22, 0x08\)/);
  assert.match(script, /write\(0x30, 0x71\)/);
  assert.match(script, /await sleepSamples\(480\)/);
  assert.match(script, /write\(0x28, 0xf0\)/);
  assert.match(script, /write\(0x28, 0x00\)/);
  assert.match(script, /await sleepSamples\(1215\)/);

  const scheduled = exportYm2612VgmToPlaygroundJavaScript(buffer, { scheduled: true });
  assert.match(scheduled, /scheduleWritesSamples\(cycleStart, \[/);
  assert.match(scheduled, /\[480, 0, 0x28, 0xf0\]/);
});

test("exportPlaygroundJavaScript keeps port 1 writes on the correct channel loop", () => {
  const buffer = createVgmBuffer(
    Uint8Array.from([
      0x53, 0x30, 0x24,
      0x61, 0x10, 0x00,
      0x53, 0xb4, 0xc7,
      0x66,
    ])
  );

  const parser = new Ym2612VGM(buffer, { logger: null });
  const script = parser.exportPlaygroundJavaScript({ includeHeaderComment: false });

  assert.match(script, /liveLoop\("ch3", async \(\) => \{/);
  assert.match(script, /write\(1, 0x30, 0x24\)/);
  assert.match(script, /write\(1, 0xb4, 0xc7\)/);
});

test("register helpers classify channel-scoped and global writes", () => {
  assert.deepEqual(getYm2612WriteTarget(0, 0x22, 0x08), { scope: "global" });
  assert.deepEqual(getYm2612WriteTarget(1, 0x30, 0x24), { scope: "channel", channel: 3 });
  assert.equal(describeYm2612Write(0, 0x28, 0xf0), "CH0: KEY ON OP1-4");
  assert.equal(describeYm2612Write(0, 0x28, 0x00), "CH0: KEY OFF");
});

test("scheduled export expands YM2612 DAC stream data while readable export omits it", () => {
  const buffer = createVgmBuffer(Uint8Array.from([
    0x67, 0x66, 0x00, 0x03, 0x00, 0x00, 0x00, 0x70, 0x80, 0x90,
    0x90, 0x00, 0x02, 0x00, 0x2a,
    0x91, 0x00, 0x00, 0x01, 0x00,
    0x92, 0x00, 0x44, 0xac, 0x00, 0x00,
    0x93, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x03, 0x00, 0x00, 0x00,
    0x61, 0x03, 0x00,
    0x66,
  ]));

  const readable = exportYm2612VgmToPlaygroundJavaScript(buffer);
  const scheduled = exportYm2612VgmToPlaygroundJavaScript(buffer, { scheduled: true });

  assert.doesNotMatch(readable, /0x2a/);
  assert.match(scheduled, /\[1, 0, 0x2a, 0x70\]/);
  assert.match(scheduled, /\[2, 0, 0x2a, 0x80\]/);
  assert.match(scheduled, /\[3, 0, 0x2a, 0x90\]/);
});

test("scheduled export handles large DAC write tracks without argument spreading", () => {
  const dacWrites = new Uint8Array(50000 * 3 + 1);
  for (let index = 0; index < 50000; index += 1) {
    const offset = index * 3;
    dacWrites[offset] = 0x52;
    dacWrites[offset + 1] = 0x2a;
    dacWrites[offset + 2] = index & 0xff;
  }
  dacWrites[dacWrites.length - 1] = 0x66;

  const script = exportYm2612VgmToPlaygroundJavaScript(
    createVgmBuffer(dacWrites),
    { scheduled: true }
  );

  assert.match(script, /\[0, 0, 0x2a, 0x00\]/);
  assert.match(script, /\[0, 0, 0x2a, 0x4f\]/);
});

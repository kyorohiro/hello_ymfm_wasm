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

  assert.match(script, /liveLoop\("global", async \(\) => \{\n  \/\/ Enable LFO FREQ=0\n  write\(0x22, 0x08\);\n  await sleepSamples\(1215\);\n\}\);/);
  assert.match(script, /liveLoop\("ch0", async \(\) => \{\n  \/\/ CH0 OP1: DT=7, MULTI=1\n  write\(0x30, 0x71\);\n  await sleepSamples\(480\);\n  \/\/ CH0: KEY ON OP1-4\n  write\(0x28, 0xf0\);\n  await sleepSamples\(735\);\n  \/\/ CH0: KEY OFF\n  write\(0x28, 0x00\);\n\}\);/);
  assert.match(script, /liveLoop\("ch5", async \(\) => \{\n  await sleepSamples\(1215\);\n\}\);/);
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

  assert.match(script, /liveLoop\("ch3", async \(\) => \{\n  \/\/ CH3 OP1: DT=2, MULTI=4\n  write\(1, 0x30, 0x24\);\n  await sleepSamples\(16\);\n  \/\/ CH3: L=1, R=1, AMS=0, FMS=7\n  write\(1, 0xb4, 0xc7\);\n\}\);/);
});

test("register helpers classify channel-scoped and global writes", () => {
  assert.deepEqual(getYm2612WriteTarget(0, 0x22, 0x08), { scope: "global" });
  assert.deepEqual(getYm2612WriteTarget(1, 0x30, 0x24), { scope: "channel", channel: 3 });
  assert.equal(describeYm2612Write(0, 0x28, 0xf0), "CH0: KEY ON OP1-4");
  assert.equal(describeYm2612Write(0, 0x28, 0x00), "CH0: KEY OFF");
});

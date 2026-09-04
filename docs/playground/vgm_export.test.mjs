import test from "node:test";
import assert from "node:assert/strict";

import {
  Ym2612VGM,
  describeYm2612Write,
  exportYm2203FmVgmToPlaygroundJavaScript,
  exportYm2612VgmToPlaygroundJavaScript,
  exportYm2608FmVgmToPlaygroundJavaScript,
  getYm2612WriteTarget,
} from "../js/ym2612vgm.js";
import {
  exportYm2203VgmToPlaygroundJavaScript,
} from "../js/ym2203vgm.js";
import {
  exportYm2608VgmToPlaygroundJavaScript,
} from "../js/ym2608vgm.js";
import { exportYm2610BVgmToPlaygroundJavaScript } from "../js/ym2610bvgm.js";

function createVgmBuffer(commands, options = {}) {
  const dataOffset = options.dataOffset ??
    (options.ym2203Clock || options.ym2608Clock || options.ym2610Clock ? 0x100 : 0x40);
  const totalLength = Math.max(0x50, dataOffset + commands.length);
  const bytes = new Uint8Array(totalLength);
  bytes[0] = 0x56;
  bytes[1] = 0x67;
  bytes[2] = 0x6d;
  bytes[3] = 0x20;
  const view = new DataView(bytes.buffer);
  view.setUint32(0x08, 0x00000150, true);
  view.setUint32(0x18, options.totalSamples ?? 0, true);
  view.setUint32(0x2c, options.ym2612Clock ?? 7670454, true);
  view.setUint32(0x34, dataOffset - 0x34, true);
  if (options.ym2203Clock) {
    view.setUint32(0x44, options.ym2203Clock, true);
  }
  if (options.ym2608Clock) {
    view.setUint32(0x48, options.ym2608Clock, true);
  }
  if (options.ym2610Clock) view.setUint32(0x4c, options.ym2610Clock, true);
  bytes.set(commands, dataOffset);
  return bytes.buffer;
}

test("YM2610B native export keeps FM writes and omits SSG and ADPCM", () => {
  const buffer = createVgmBuffer(Uint8Array.from([
    0x58, 0x22, 0x08,
    0x58, 0x30, 0x71,
    0x59, 0xa4, 0x22,
    0x58, 0x08, 0xff,
    0x58, 0x10, 0xff,
    0x66,
  ]), { ym2610Clock: 8000000 });
  const script = exportYm2610BVgmToPlaygroundJavaScript(buffer);
  assert.match(script, /write\(0x22, 0x08\)/);
  assert.match(script, /write\(1, 0xa4, 0x22\)/);
  assert.doesNotMatch(script, /0x8, 0xff/);
  assert.doesNotMatch(script, /0x10, 0xff/);
});

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

  const scheduled = exportYm2612VgmToPlaygroundJavaScript(buffer, {
    scheduled: true,
    dacBase64: false,
  });
  const scheduledBase64 = exportYm2612VgmToPlaygroundJavaScript(buffer, {
    scheduled: true,
  });
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

test("YM2608 FM-only export preserves FM and drops SSG and ADPCM registers", () => {
  const buffer = createVgmBuffer(
    Uint8Array.from([
      0x56, 0x22, 0x08,
      0x56, 0x00, 0x7f,
      0x56, 0x30, 0x71,
      0x57, 0x30, 0x24,
      0x56, 0xa0, 0x00,
      0x56, 0xa4, 0x22,
      0x61, 0xe0, 0x01,
      0x57, 0x10, 0xff,
      0x56, 0x28, 0xf0,
      0x66,
    ]),
    { ym2612Clock: 0, ym2608Clock: 7987200 }
  );

  const script = exportYm2608FmVgmToPlaygroundJavaScript(buffer, {
    scheduled: true,
  });

  assert.match(script, /YM2608 VGM FM registers only/);
  assert.match(script, /\[0, 0, 0x22, 0x08\]/);
  assert.match(script, /\[0, 0, 0x30, 0x71\]/);
  assert.match(script, /\[0, 1, 0x30, 0x24\]/);
  assert.match(script, /\[0, 0, 0xa4, 0x22\]/);
  assert.match(script, /\[0, 0, 0xa0, 0x15\]/);
  assert.match(script, /\[480, 0, 0x28, 0xf0\]/);
  assert.doesNotMatch(script, /0x00, 0x7f|0x10, 0xff/);
});

test("YM2203 FM-only export preserves three FM channels and enables YM2612 pan", () => {
  const buffer = createVgmBuffer(
    Uint8Array.from([
      0x55, 0x00, 0x7f,
      0x55, 0x30, 0x71,
      0x55, 0xa0, 0x00,
      0x55, 0xa4, 0x22,
      0x61, 0xe0, 0x01,
      0x55, 0x28, 0xf0,
      0x66,
    ]),
    { ym2612Clock: 0, ym2203Clock: 3993600 }
  );

  const script = exportYm2203FmVgmToPlaygroundJavaScript(buffer, {
    scheduled: true,
  });

  assert.match(script, /YM2203 VGM FM registers only/);
  assert.match(script, /\[0, 0, 0xb4, 0xc0\]/);
  assert.match(script, /\[0, 0, 0x30, 0x71\]/);
  assert.match(script, /\[0, 0, 0xa4, 0x21\]/);
  assert.match(script, /\[0, 0, 0xa0, 0x0b\]/);
  assert.match(script, /\[480, 0, 0x28, 0xf0\]/);
  assert.doesNotMatch(script, /0x00, 0x7f/);
  assert.doesNotMatch(script, /liveLoop\("ch3"/);
});

test("native OPN exports preserve FNUM and omit YM2612 compatibility writes", () => {
  const ym2203 = createVgmBuffer(
    Uint8Array.from([0x55, 0xa0, 0x00, 0x55, 0xa4, 0x22, 0x66]),
    { ym2612Clock: 0, ym2203Clock: 3993600 }
  );
  const ym2608 = createVgmBuffer(
    Uint8Array.from([0x56, 0xa0, 0x00, 0x56, 0xa4, 0x22, 0x66]),
    { ym2612Clock: 0, ym2608Clock: 7987200 }
  );

  const ym2203Script = exportYm2203VgmToPlaygroundJavaScript(ym2203, {
    scheduled: true,
  });
  const ym2608Script = exportYm2608VgmToPlaygroundJavaScript(ym2608, {
    scheduled: true,
  });

  assert.match(ym2203Script, /\[0, 0, 0xa4, 0x22\]/);
  assert.match(ym2203Script, /\[0, 0, 0xa0, 0x00\]/);
  assert.doesNotMatch(ym2203Script, /0xb4, 0xc0|FNUM converted/);
  assert.match(ym2608Script, /\[0, 0, 0xa4, 0x22\]/);
  assert.match(ym2608Script, /\[0, 0, 0xa0, 0x00\]/);
  assert.doesNotMatch(ym2608Script, /FNUM converted/);
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
  const rawDac = exportYm2612VgmToPlaygroundJavaScript(buffer, {
    dacBase64: false,
  });
  const scheduled = exportYm2612VgmToPlaygroundJavaScript(buffer, {
    scheduled: true,
    dacBase64: false,
  });
  const scheduledBase64 = exportYm2612VgmToPlaygroundJavaScript(buffer, {
    scheduled: true,
  });

  assert.match(readable, /await dac\.loadBase64\("vgm-dac", "/);
  assert.match(readable, /dac\.playStream\("vgm-dac", \{ atSamples: dacStart \}\)/);
  assert.doesNotMatch(readable, /\[1, 0x70\]/);
  assert.doesNotMatch(rawDac, /dac\.loadBase64|dac\.playStream/);
  assert.match(rawDac, /write\(0x2a, 0x70\)/);
  assert.match(scheduled, /\[1, 0, 0x2a, 0x70\]/);
  assert.match(scheduled, /\[2, 0, 0x2a, 0x80\]/);
  assert.match(scheduled, /\[3, 0, 0x2a, 0x90\]/);
  assert.match(scheduledBase64, /await dac\.loadBase64\("vgm-dac", "/);
  assert.match(scheduledBase64, /dac\.playStream\("vgm-dac", \{ atSamples: cycleStart \}\)/);
  assert.doesNotMatch(scheduledBase64, /\[1, 0, 0x2a, 0x70\]/);
});

test("export can omit DAC data and DAC enable writes", () => {
  const script = exportYm2612VgmToPlaygroundJavaScript(
    createVgmBuffer(Uint8Array.from([
      0x52, 0x2b, 0x80,
      0x52, 0x2a, 0x70,
      0x66,
    ])),
    { includeDac: false }
  );

  assert.doesNotMatch(script, /0x2a|0x2b|dac\./);
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
    { scheduled: true, dacBase64: false }
  );

  assert.match(script, /\[0, 0, 0x2a, 0x00\]/);
  assert.match(script, /\[0, 0, 0x2a, 0x4f\]/);
});

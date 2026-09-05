import test from "node:test";
import { YM2612Synth } from "../../web/ym2612synth.js";
import assert from "node:assert/strict";

test("High inlines small groups and formats large one-off groups across lines", () => {
  for (const count of [2, 3, 4, 5]) {
    const commands = [];
    const repetitions = count <= 4 ? 20 : 1;
    for (let repeat = 0; repeat < repetitions; repeat++) {
      for (let i = 0; i < count; i++) commands.push(0x52, 0x40, i);
      commands.push(0x70);
    }
    commands.push(0x66);
    const source = exportYm2612VgmToPlaygroundJavaScript(createVgmBuffer(commands), { high: true });
    assert.doesNotMatch(source, /const operators/);
    if (count <= 4) assert.match(source, /fm.setOperators\(CH1, \[\[OP1,/);
    else assert.match(source, /fm.setOperators\(CH1, \[\n    \[OP1,/);
  }
});

test("High keeps repeated single operator settings inline for readability", () => {
  const commands = [];
  for (let i = 0; i < 20; i++) commands.push(0x52, 0x40, 20, 0x70);
  commands.push(0x66);
  const source = exportYm2612VgmToPlaygroundJavaScript(createVgmBuffer(commands), { high: true });
  assert.doesNotMatch(source, /const operators/);
  assert.equal(source.split("fm.setOperator(CH1, OP1, { tl: 20 });").length - 1, 20);
});

test("High operator grouping and constants reproduce register values, order and waits", async () => {
  const commands = [];
  const expected = [];
  let time = 0;
  const write = (port, register, value) => {
    commands.push(port ? 0x53 : 0x52, register, value);
    expected.push([time, port, register, value]);
  };
  for (let channel = 0; channel < 6; channel++) {
    const port = Math.floor(channel / 3), offset = channel % 3;
    for (let repeat = 0; repeat < 4; repeat++) {
      for (const [register, value] of [[0x40, 20], [0x34, 0x36], [0x40, 20], [0x58, 0xdf], [0x6c, 0x9f], [0x70, 31], [0x84, 0xff], [0x98, 15]]) {
        write(port, register + offset, value);
      }
      commands.push(0x61, 3, 0); time += 3;
    }
    write(port, 0x40 + offset, 21 + channel);
    write(0, 0x27, 0x40); // Global operation is a grouping boundary.
    write(port, 0x44 + offset, 22);
    for (const [register, value] of [[0x30, 0x80], [0x50, 0x20], [0x60, 0x40], [0x90, 0x80], [0xb0, 0x80], [0xb4, 8]]) write(port, register + offset, value);
    write(port, 0xb0 + offset, 0x3f);
    write(port, 0xb4 + offset, 0xf7);
  }
  write(0, 0x22, 15);
  write(0, 0x2b, 0x80);
  commands.push(0x66);
  const source = exportYm2612VgmToPlaygroundJavaScript(createVgmBuffer(commands), { high: true });
  assert.match(source, /const operators001/);
  assert.match(source, /\/\*\* @type \{Array<\[YM2612Operator, YM2612OperatorParams\]>\} \*\/\nconst operators001/);
  assert.match(source, /fm.setOperators/);
  assert.match(source, /fm.setOperator\(/);
  assert.match(source, /write\(0x27/);
  const actual = [];
  let clock = 0, run;
  const record = (port, register, value) => actual.push([clock, port, register, value]);
  const synth = new YM2612Synth({ transport: { write: record } });
  actual.length = 0;
  const names = ["fm", "liveLoop", "sleepSamples", "write", ...Array.from({ length: 6 }, (_, i) => `CH${i + 1}`), "OP1", "OP2", "OP3", "OP4"];
  new Function(...names, source)(synth, (_name, fn) => { run = fn; }, async (samples) => { clock += samples; }, (...args) => record(...(args.length === 2 ? [0, ...args] : args)), 0, 1, 2, 3, 4, 5, 0, 1, 2, 3);
  await run();
  assert.deepEqual(actual, expected);
});

test("DAC file export preserves packed timestamps and generates a file reader", () => {
  for (const mode of ["write", "schedule", "high"]) {
    let data;
    const source = exportYm2612VgmToPlaygroundJavaScript(createVgmBuffer([
      0x52, 0x2a, 0x81, 0x61, 3, 0, 0x52, 0x2a, 0x92, 0x66,
    ]), {
      scheduled: mode === "schedule",
      high: mode === "high",
      writeDacFile(bytes) { data = bytes; return "/vgmdat-test.dat"; },
    });
    assert.deepEqual(Array.from(data), [0, 0, 0, 0, 0x81, 3, 0, 0, 0, 0x92]);
    assert.match(source, /await dac.load\("vgm-dac", await file\("\/vgmdat-test.dat", \{ type: "arrayBuffer" \}\)\)/);
    assert.doesNotMatch(source, /loadBase64/);
  }
});

test("High keeps large DAC streams out of generated code", () => {
  const commands = [0x52, 0x2b, 0x80];
  const count = 100000;
  for (let i = 0; i < count; i++) commands.push(0x52, 0x2a, i & 255, 0x70);
  commands.push(0x52, 0x28, 0, 0x66);
  let data;
  const source = exportYm2612VgmToPlaygroundJavaScript(createVgmBuffer(commands), {
    high: true,
    writeDacFile(bytes) { data = bytes; return "/vgmdat-large.dat"; },
  });
  assert.equal(data.length, count * 5);
  const last = new DataView(data.buffer);
  assert.equal(last.getUint32((count - 1) * 5, true), count - 1);
  assert.equal(data.at(-1), (count - 1) & 255);
  assert.ok(source.split("\n").length < 25);
  assert.doesNotMatch(source, /write\(0x2a,/);
  assert.match(source, /dac.playStream/);
  assert.match(source, /sleepSamples\(100000\)/);
});

test("High preserves exact writes, tiny waits, all channels, partial keys and DAC", async () => {
  const commands = [];
  const expected = [];
  let time = 0;
  const write = (port, register, value) => {
    commands.push(port ? 0x53 : 0x52, register, value);
    expected.push([time, port, register, value]);
  };
  for (let channel = 0; channel < 6; channel++) {
    const port = Math.floor(channel / 3);
    const offset = channel % 3;
    const code = channel < 3 ? channel : channel + 1;
    write(port, 0xa4 + offset, 0x22);
    write(port, 0xa0 + offset, 0x83);
    write(0, 0x28, 0x50 | code);
    commands.push(0x61, 1, 0);
    time++;
    write(0, 0x28, code);
  }
  write(0, 0xa4, 0x22);
  write(0, 0x22, 8); // Intervening global write prevents grouping.
  write(0, 0xa0, 0x83);
  write(0, 0x2b, 0x80);
  write(0, 0x2a, 0x88);
  commands.push(0x66);
  const source = exportYm2612VgmToPlaygroundJavaScript(createVgmBuffer(commands), { high: true, dacBase64: false });
  assert.match(source, /fm.setFrequency/);
  assert.match(source, /fm.keyOn/);
  assert.match(source, /fm.keyOff/);
  const actual = [];
  let clock = 0;
  const record = (port, register, value) => actual.push([clock, port, register, value]);
  const synth = new YM2612Synth({ transport: { write: record } });
  actual.length = 0;
  const names = ["fm", "liveLoop", "sleepSamples", "write", ...Array.from({ length: 6 }, (_, i) => `CH${i + 1}`), "OP1", "OP2", "OP3", "OP4"];
  let run;
  new Function(...names, source)(synth, (_name, fn) => { run = fn; }, async (samples) => { clock += samples; }, (...args) => record(...(args.length === 2 ? [0, ...args] : args)), 0, 1, 2, 3, 4, 5, 0, 1, 2, 3);
  await run();
  assert.deepEqual(actual, expected);
});

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

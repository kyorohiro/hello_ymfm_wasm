import test from "node:test";
import assert from "node:assert/strict";
import { exportAnalysisMml } from "./vgm_mml.js";

function vgm(commands, clock = 7670454) {
  const bytes = new Uint8Array(0x100 + commands.length);
  bytes.set([86, 103, 109, 32]);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 0x170, true);
  view.setUint32(0x2c, clock, true);
  view.setUint32(0x34, 0xcc, true);
  bytes.set(commands, 0x100);
  return bytes;
}
const on = [0x52, 0xa4, 0x22, 0x52, 0xa0, 0x1d, 0x52, 0x28, 0xf0];
const quarter = [0x61, 0x22, 0x56];
test("manual BPM changes lengths while source samples and pitch are retained", () => {
  const source = vgm([...on, ...quarter, 0x52, 0x28, 0, ...quarter, 0x66]);
  const a = exportAnalysisMml(source);
  const b = exportAnalysisMml(source, { bpm: 60 });
  assert.match(a, /start=0 samples=22050/);
  assert.match(a, /r4/);
  assert.match(b, /o3 a8/);
  assert.match(a, /; CH6/);
  for (const bpm of [0, -1, NaN, Infinity]) assert.throws(() => exportAnalysisMml(source, { bpm }));
  assert.throws(() => exportAnalysisMml(vgm([0x66], 0)), /YM2612/);
});
test("retrigger, another channel, patches, and unconverted operations are visible", () => {
  const text = exportAnalysisMml(vgm([
    0x52, 0x40, 20, ...on, ...quarter,
    0x52, 0x28, 0xf0, 0x53, 0xa4, 0x22, 0x53, 0xa0, 0x1d, 0x52, 0x28, 0xf4,
    0x52, 0x40, 21, 0x52, 0x22, 8, 0x50, 0x90, 0x52, 0x2a, 128,
    ...quarter, 0x66,
  ]));
  assert.equal((text.match(/; N\d+ ticks=/g) ?? []).length, 3);
  assert.match(text, /sounding patch write/);
  assert.match(text, /raw registers:.*"40":20/);
  assert.match(text, /PSG writes omitted/);
  assert.match(text, /DAC samples omitted/);
  assert.match(text, /Unconverted YM2612 register/);
  assert.match(text, /KEY still on/);
});
test("partial keys and CH3 special mode are unknown, loops are not expanded", () => {
  const source = vgm([0x52, 0x27, 0x40, 0x52, 0x28, 0xf2, ...quarter, 0x52, 0x28, 0x10, ...quarter, 0x66]);
  new DataView(source.buffer).setUint32(0x1c, 0x100 - 0x1c, true);
  const text = exportAnalysisMml(source);
  assert.match(text, /\?/);
  assert.match(text, /Unknown pitch/);
  assert.match(text, /Loop: file offset=256/);
});
test("rounding uses absolute endpoints and cannot accumulate timing drift", () => {
  const commands = [...on];
  for (let i = 0; i < 100; i++) commands.push(0x70, 0x52, 0x28, 0xf0);
  commands.push(0x66);
  const text = exportAnalysisMml(vgm(commands));
  const ch1 = text.split("; CH1\n")[1].split("; CH2")[0];
  assert.match(ch1, /ticks=2\.\.2/);
  assert.match(ch1, /start=99 samples=1/);
});

test("frequency commits split a held note without losing original timestamps", () => {
  const text = exportAnalysisMml(vgm([...on, ...quarter, 0x52, 0xa4, 0x2a, 0x52, 0xa0, 0x1d, ...quarter, 0x52, 0x28, 0, 0x66]));
  assert.match(text, /pitch change during KEY ON/);
  assert.match(text, /start=0 samples=22050/);
  assert.match(text, /start=22050 samples=22050/);
});

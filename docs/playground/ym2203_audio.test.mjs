import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { Ym2203AudioEngine } from "../js/ym2203audioengine.js";
import { VgmPlayer } from "../js/vgmplayer.js";

// Execute the shipped WASM in a shell context, adapting only ES module syntax.
const runtimeUrl = new URL("../generated/ym2203_wasm.js", import.meta.url);
const source = readFileSync(runtimeUrl, "utf8")
  .replaceAll("import.meta.url", JSON.stringify(runtimeUrl.href))
  .replace("export default Module;", "Module;");
const moduleFactory = vm.runInNewContext(source, {
  console, WebAssembly, Uint8Array, setTimeout, clearTimeout, performance, URL,
});
const wasmBinary = new Uint8Array(readFileSync(new URL("../generated/ym2203_wasm.wasm", import.meta.url)));
const peak = (values) => values.reduce((max, value) => Math.max(max, Math.abs(value)), 0);

function makeVgm(registers) {
  const commands = [...registers.flatMap(([register, value]) => [0x55, register, value]),
    0x61, 0x00, 0x08, 0x66];
  const bytes = new Uint8Array(0x100 + commands.length);
  bytes.set([0x56, 0x67, 0x6d, 0x20]);
  const view = new DataView(bytes.buffer);
  view.setUint32(4, bytes.length - 4, true);
  view.setUint32(8, 0x171, true);
  view.setUint32(0x34, 0xcc, true);
  view.setUint32(0x44, 4000000, true);
  bytes.set(commands, 0x100);
  return bytes;
}

async function render(registers) {
  const engine = await Ym2203AudioEngine.create({
    ym2203ModuleFactory: moduleFactory, ym2203ModuleOptions: { wasmBinary },
  });
  try {
    const player = new VgmPlayer(engine);
    player.load(makeVgm(registers));
    player.reset();
    player.play();
    const left = new Float32Array(1024), right = new Float32Array(1024);
    player.process(left, right, 1024);
    return { left, right };
  } finally { engine.dispose(); }
}

for (let channel = 0; channel < 3; channel++) {
  test(`YM2203 VGM SSG ${"ABC"[channel]} tone reaches both outputs and respects volume`, async () => {
    const registers = [[channel * 2, 100], [channel * 2 + 1, 0],
      [7, 0x3f & ~(1 << channel)], [8 + channel, 15]];
    const pcm = await render(registers);
    assert.ok(peak(pcm.left) > 0.1);
    assert.deepEqual(pcm.left, pcm.right);
    assert.ok(new Set(pcm.left).size > 1);
    const muted = await render([...registers, [8 + channel, 0]]);
    assert.equal(peak(muted.left), 0);
    assert.equal(peak(muted.right), 0);
  });
}

test("YM2203 VGM SSG noise and envelope use the mono mix", async () => {
  for (const registers of [
    [[6, 3], [7, 0x37], [8, 15]],
    [[0, 100], [7, 0x3e], [11, 8], [12, 0], [13, 0x0e], [8, 16]],
  ]) {
    const pcm = await render(registers);
    assert.ok(peak(pcm.left) > 0.1);
    assert.deepEqual(pcm.left, pcm.right);
    assert.ok(new Set(pcm.left).size > 2);
  }
});

test("YM2203 VGM sums all three SSG channels and clips after mixing", async () => {
  // Disable tone/noise gates to obtain constant output from each channel.
  const single = await render([[7, 0x3f], [8, 10]]);
  const all = await render([[7, 0x3f], [8, 10], [9, 10], [10, 10]]);
  assert.ok(peak(all.left) > peak(single.left) * 2.9);
  assert.ok(peak(all.left) <= 1);
  assert.deepEqual(all.left, all.right);
  const loud = await render([[7, 0x3f], [8, 15], [9, 15], [10, 15]]);
  assert.equal(peak(loud.left), 32767 / 32768);
  assert.deepEqual(loud.left, loud.right);
});

test("YM2203 VGM FM output is also present in both mono channels", async () => {
  const registers = [
    ...[0, 4, 8, 12].flatMap((slot) => [
      [0x30 + slot, 1], [0x40 + slot, 32], [0x50 + slot, 31],
      [0x60 + slot, 0], [0x70 + slot, 0], [0x80 + slot, 15],
    ]),
    [0xb0, 7], [0xa4, 0x22], [0xa0, 0x69], [0x28, 0xf0],
  ];
  const pcm = await render(registers);
  assert.ok(peak(pcm.left) > 0.01);
  assert.ok(new Set(pcm.left).size > 2);
  assert.deepEqual(pcm.left, pcm.right);
});

test("YM2203 SSG mute preserves tone registers, later writes and reset preference", async () => {
  const engine = await Ym2203AudioEngine.create({ym2203ModuleFactory: moduleFactory, ym2203ModuleOptions: {wasmBinary}});
  try {
    const setup = () => { engine.writeYm2203(0, 100); engine.writeYm2203(7, 0x3e); engine.writeYm2203(8, 15); };
    setup(); assert.ok(peak(engine.processFrames(256).left) > 0.1);
    engine.setSsgMuted(true);
    engine.writeYm2203(0, 50);
    assert.equal(peak(engine.processFrames(256).left), 0);
    engine.ym2203.write(0, 0); assert.equal(engine.ym2203.read(1), 50);
    engine.setSsgMuted(false); assert.ok(peak(engine.processFrames(256).left) > 0.1);
    engine.setSsgMuted(true); engine.reset(); setup();
    assert.equal(peak(engine.processFrames(256).left), 0);
  } finally { engine.dispose(); }
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { Ym2608 } from "../js/ym2608.js";
import { Ym2608AudioEngine } from "../js/ym2608audioengine.js";
import { Ym2612VGM } from "../js/ym2612vgm.js";
import { VgmPlayer } from "../js/vgmplayer.js";

// Run the shipped web/worker/shell build in an isolated shell context. Only
// the ES module syntax is adapted; the generated runtime and WASM are unchanged.
const runtimeUrl = new URL("../generated/ym2608_wasm.js", import.meta.url);
const source = readFileSync(runtimeUrl, "utf8")
  .replaceAll("import.meta.url", JSON.stringify(runtimeUrl.href))
  .replace("export default Module;", "Module;");
const moduleFactory = vm.runInNewContext(source, {
  console, WebAssembly, Uint8Array, setTimeout, clearTimeout, performance, URL,
});
const moduleOptions = {
  wasmBinary: new Uint8Array(readFileSync(new URL("../generated/ym2608_wasm.wasm", import.meta.url))),
};
const createChip = () => Ym2608.create({ moduleFactory, moduleOptions: { ...moduleOptions } });
function write(chip, port, register, value) {
  chip.write(port * 2, register);
  chip.write(port * 2 + 1, value);
}
const peak = (values) => values.reduce((max, value) => Math.max(max, Math.abs(value)), 0);
const u32 = (value) => [value & 255, (value >>> 8) & 255, (value >>> 16) & 255, value >>> 24];
function block(offset, data, memorySize = 512, secondChip = false) {
  return [0x67, 0x66, 0x81, ...u32((8 + data.length) | (secondChip ? 0x80000000 : 0)),
    ...u32(memorySize), ...u32(offset), ...data];
}
function vgm(commands) {
  const bytes = new Uint8Array(0x100 + commands.length);
  bytes.set([0x56, 0x67, 0x6d, 0x20]);
  const view = new DataView(bytes.buffer);
  view.setUint32(4, bytes.length - 4, true);
  view.setUint32(8, 0x171, true);
  view.setUint32(0x34, 0xcc, true);
  view.setUint32(0x48, 8000000, true);
  bytes.set(commands, 0x100);
  return bytes;
}
const adpcmRegisters = [[1, 0x82], [2, 1], [3, 0], [4, 8], [5, 0],
  [9, 255], [10, 255], [11, 255], [12, 255], [13, 255], [0, 0xa0]];

test("generated YM2608 WASM mixes SSG tone into both channels and respects mute", async () => {
  const chip = await createChip();
  try {
    write(chip, 0, 0, 100);
    write(chip, 0, 7, 0x3e);
    write(chip, 0, 8, 15);
    const pcm = chip.generateStereo(16384);
    assert.ok(peak(pcm.left) > 0.1);
    assert.deepEqual(pcm.left, pcm.right);
    assert.ok(new Set(pcm.left).size > 1, "tone must vary over time");
    assert.ok(peak(pcm.left) <= 1);
    write(chip, 0, 8, 0);
    chip.generateStereo(1024);
    assert.equal(peak(chip.generateStereo(1024).left), 0);
  } finally { chip.dispose(); }
});

test("VGM Player loads split ADPCM-B blocks before playback and can restart", async () => {
  const engine = await Ym2608AudioEngine.create({
    ym2608ModuleFactory: moduleFactory, ym2608ModuleOptions: { ...moduleOptions },
  });
  try {
    const player = new VgmPlayer(engine);
    const commands = [
      ...block(32, new Array(128).fill(0x77)),
      ...block(160, new Array(128).fill(0x77)),
      ...adpcmRegisters.flatMap(([r, v]) => [0x57, r, v]),
      0x61, 0x00, 0x08, 0x66,
    ];
    player.load(vgm(commands));
    player.reset();
    const render = () => {
      player.play();
      const left = new Float32Array(1024), right = new Float32Array(1024);
      player.process(left, right, 1024);
      return { left, right };
    };
    const pcm = render();
    assert.ok(peak(pcm.left) > 0.1);
    assert.equal(peak(pcm.right), 0, "ADPCM pan must remain independent of mono SSG");
    player.reset();
    const restarted = render();
    // ymfm reset keeps the resampler clock phase, so edge samples can differ.
    assert.equal(peak(restarted.left), peak(pcm.left));
    assert.equal(peak(restarted.right), 0);
    const audibleFrames = (values) => values.filter((value) => value !== 0).length;
    assert.ok(Math.abs(audibleFrames(restarted.left) - audibleFrames(pcm.left)) <= 1);

    // A new file must not inherit sample bytes from the previous one.
    player.load(vgm([0x66]));
    write(engine.ym2608, 1, 0, 1);
    write(engine.ym2608, 1, 1, 2);
    write(engine.ym2608, 1, 2, 1);
    write(engine.ym2608, 1, 0, 0x20);
    engine.ym2608.write(2, 8);
    engine.ym2608.read(3);
    engine.ym2608.read(3);
    assert.equal(engine.ym2608.read(3), 0);
  } finally { engine.dispose(); }
});

test("ADPCM-B CPU memory writes can be read back and partial loads preserve other bytes", async () => {
  const chip = await createChip();
  try {
    chip.loadAdpcmBMemory(new Uint8Array([0x12, 0x34]), 32, 512);
    chip.loadAdpcmBMemory(new Uint8Array([0x56]), 33, 512);
    write(chip, 1, 1, 2);
    write(chip, 1, 2, 1);
    write(chip, 1, 4, 8);
    write(chip, 1, 0, 0x20);
    chip.write(2, 8);
    chip.read(3); chip.read(3);
    assert.equal(chip.read(3), 0x12);
    assert.equal(chip.read(3), 0x56);
    write(chip, 1, 0, 0x60);
    write(chip, 1, 8, 0xab);
    write(chip, 1, 0, 0x20);
    chip.write(2, 8);
    chip.read(3); chip.read(3);
    assert.equal(chip.read(3), 0xab);
    assert.throws(() => chip.loadAdpcmBMemory(new Uint8Array(2), 511, 512), RangeError);
  } finally { chip.dispose(); }
});

test("ADPCM-B parser rejects malformed blocks and skips second-chip data explicitly", () => {
  assert.throws(() => new Ym2612VGM(vgm([0x67, 0x66, 0x81, ...u32(1), 0])).step(), /memory header/);
  assert.throws(() => new Ym2612VGM(vgm(block(511, [1, 2]))).step(), /memory range/);
  const warnings = [];
  const parser = new Ym2612VGM(vgm([...block(0, [1], 512, true), 0x66]), {
    logger: { warn: (message) => warnings.push(message) },
  });
  let loaded = false;
  parser.playStep({ ym2608: { loadAdpcmBMemory() { loaded = true; } } });
  assert.equal(loaded, false);
  assert.match(warnings[0], /second YM2608/);
  assert.equal(parser.step().type, "end");
});

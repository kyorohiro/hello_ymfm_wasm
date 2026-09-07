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

test("YM2608 source mutes silence only the selected output and preserve playback state", async () => {
  for (const source of ["ssg", "rhythm", "adpcmB"]) {
    const chip = await createChip(), reference = await createChip();
    const engine = new Ym2608AudioEngine(chip, chip.sampleRate(), 44100);
    const methods = { ssg: "setSsgMuted", rhythm: "setRhythmMuted", adpcmB: "setAdpcmBMuted" };
    try {
      for (const c of [chip, reference]) {
        if (source === "ssg") {
          write(c, 0, 0, 100); write(c, 0, 7, 0x3e); write(c, 0, 8, 15);
        } else if (source === "rhythm") {
          c.loadAdpcmARom(new Uint8Array(8192).fill(0x77));
          write(c, 0, 0x11, 0x3f); write(c, 0, 0x18, 0xdf); write(c, 0, 0x10, 1);
        } else {
          c.loadAdpcmBMemory(new Uint8Array(4096).fill(0x77));
          for (const [r, v] of [[1, 0xc2], [4, 127], [9, 255], [10, 255], [11, 255], [12, 255], [13, 255], [0, 0xb0]]) write(c, 1, r, v);
        }
      }
      const initial = chip.generateStereo(2048);
      assert.deepEqual(initial, reference.generateStereo(2048));
      assert.ok(peak(initial.left) > 0.01, source);
      // Other source mutes must not silence this source.
      for (const [name, method] of Object.entries(methods)) if (name !== source) engine[method](true);
      assert.deepEqual(chip.generateStereo(1024), reference.generateStereo(1024));
      engine[methods[source]](true);
      chip.generateStereo(16); reference.generateStereo(16); // cached FM/ADPCM output boundary
      const silent = chip.generateStereo(1024); reference.generateStereo(1024);
      assert.equal(peak(silent.left), 0, source);
      assert.equal(peak(silent.right), 0, source);
      engine[methods[source]](false);
      chip.generateStereo(16); reference.generateStereo(16);
      assert.deepEqual(chip.generateStereo(1024), reference.generateStereo(1024), `${source} must keep running while muted`);
    } finally { chip.dispose(); reference.dispose(); }
  }
});

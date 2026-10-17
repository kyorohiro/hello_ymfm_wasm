import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import factory from '../docs/generated/spc_wasm.js';
import { SpcCore, SpcPlayerCore, SnesDspCore, SPC_SAMPLE_RATE } from './spc.js';
import { createSyntheticSpc } from './spc_test_fixture.mjs';

const run = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
const wasmBinary = await readFile(new URL('../docs/generated/spc_wasm.wasm', import.meta.url));
// Share one WASM module to exercise actual native-handle separation, not just
// isolation provided by separate module instances.
const module = await factory({ wasmBinary });
const create = () => SpcCore.create({ moduleFactory: async () => module });
const createDsp = () => SnesDspCore.create({ moduleFactory: async () => module });
function pcm(core, frames, partition = [frames]) {
  const left = new Float32Array(frames), right = new Float32Array(frames);
  let offset = 0, p = 0;
  while (offset < frames) {
    const n = Math.min(partition[p++ % partition.length], frames - offset);
    core.renderInto(left, right, n, offset); offset += n;
  }
  return {left, right};
}
function audible({left, right}) {
  assert.ok(left.every(Number.isFinite) && right.every(Number.isFinite));
  assert.ok(left.every(v => v >= -1 && v <= 1) && right.every(v => v >= -1 && v <= 1));
  assert.ok(left.some(v => v !== 0));
  assert.notDeepEqual(left, right, 'independent stereo volumes are preserved');
}

test('SPC loads original snapshot, renders finite native stereo and advances SMP/RAM', async () => {
  assert.equal(SpcPlayerCore, SpcCore);
  assert.equal(SPC_SAMPLE_RATE, 32000);
  const core = await create();
  try {
    core.load(createSyntheticSpc());
    assert.equal(core.nativeFrames, 0);
    const before = core.snapshot();
    audible(pcm(core, 32017));
    const after = core.snapshot();
    assert.equal(after.nativeFrames, 32017);
    assert.notEqual(after.ram[0x30], before.ram[0x30], 'synthetic INC/BRA CPU program executed');
    assert.equal(after.ram.length, 65536); assert.equal(after.dsp.length, 128);
    assert.ok(after.dsp[8] > 0, 'envelope remains active');
    after.ram.fill(99); after.dsp.fill(99);
    assert.notEqual(core.snapshot().ram[0x200], 99, 'snapshot arrays are owned copies');
  } finally { core.dispose(); }
});

test('SPC PCM is independent of render partitions including one-frame calls and output offsets', async () => {
  for (const options of [{}, {voices: 3, echo: true, pmon: true}, {voices: 2, noise: true}]) {
    const a = await create(), b = await create();
    try {
      const image = createSyntheticSpc(options); a.load(image); b.load(image);
      assert.deepEqual(pcm(a, 12017), pcm(b, 12017, [1, 127, 128, 511, 1023, 17]));
    } finally { a.dispose(); b.dispose(); }
  }
});

test('SMP writes through the DSP data register are executed by the loaded CPU', async () => {
  const core = await create();
  try {
    const image = createSyntheticSpc();
    // MOV $f2,#$07; MOV $f3,#$40; INC $30; BRA back to INC.
    image.set([0x8f, 0x07, 0xf2, 0x8f, 0x40, 0xf3, 0xab, 0x30, 0x2f, 0xfc], 0x300);
    core.load(image);
    assert.equal(core.snapshot().dsp[7], 0x7f);
    pcm(core, 1024);
    assert.equal(core.snapshot().dsp[7], 0x40);
  } finally { core.dispose(); }
});

test('DSP sample directory wraps at 64 KiB for high DIR and SRCN register values', async () => {
  const a = await create(), b = await create();
  try {
    const normal = createSyntheticSpc(), wrapped = normal.slice();
    wrapped.set([0, 0x20, 0, 0x20], 0x100 + 0x02fc); // ($ff00 + $ff*4) & $ffff
    wrapped[0x10100 + 4] = 255;
    wrapped[0x10100 + 0x5d] = 255;
    a.load(normal); b.load(wrapped);
    assert.deepEqual(pcm(a, 4096), pcm(b, 4096));
  } finally { a.dispose(); b.dispose(); }
});

test('failed SPC validation preserves playing state; restart restores original RAM and echo', async () => {
  const a = await create(), b = await create();
  try {
    const image = createSyntheticSpc({echo: true}); a.load(image); b.load(image);
    const initial = pcm(a, 4096); pcm(b, 4096);
    const bad = image.slice(); bad[0] = 0;
    assert.throws(() => a.load(bad), /SPC/);
    for (const offset of [0x21, 0x22, 0x23]) {
      const badHeader = image.slice(); badHeader[offset] = 0;
      assert.throws(() => a.load(badHeader), /SPC/);
    }
    assert.equal(a.nativeFrames, 4096);
    assert.deepEqual(pcm(a, 1027), pcm(b, 1027));
    image.fill(0); // load owns its input baseline
    a.restart(); assert.equal(a.nativeFrames, 0);
    assert.deepEqual(pcm(a, 4096), initial);
    a.reset(); assert.deepEqual(pcm(a, 4096), initial);
  } finally { a.dispose(); b.dispose(); }
});

test('output-only mute retains EG, BRR progression and PMON modulation without KOFF', async () => {
  const a = await create(), b = await create();
  try {
    const image = createSyntheticSpc({voices: 2, pmon: true}); a.load(image); b.load(image);
    pcm(a, 1000); pcm(b, 1000);
    a.setMuteMask(1); b.setMuteMask(0);
    const muted = pcm(a, 2011), full = pcm(b, 2011);
    assert.notDeepEqual(muted, full);
    assert.deepEqual(a.snapshot(), b.snapshot(), 'RAM/DSP including ENVX/OUTX advance identically without echo');
    // Voice 1 uses voice 0 for PMON even while voice 0 is inaudible. Upon
    // unmuting, allow the upstream output queue and DSP mixer phase to settle.
    // This is bounded in native frames, not a release or newly restarted voice.
    a.setMuteMask(0); pcm(a, 16); pcm(b, 16);
    assert.deepEqual(pcm(a, 2048), pcm(b, 2048));
    a.setMuteMask(255); const silent = pcm(a, 100);
    assert.ok(silent.left.slice(16).every(v => v === 0));
    assert.ok(silent.right.slice(16).every(v => v === 0));
    assert.ok(a.snapshot().dsp[8] > 0, 'muting does not release voice');
    a.restart(); const stillMuted = pcm(a, 100);
    assert.ok(stillMuted.left.every(v => v === 0), 'restart preserves output mask');
  } finally { a.dispose(); b.dispose(); }
});

test('muting preserves already written echo tails instead of clearing echo RAM', async () => {
  const core = await create();
  try {
    core.load(createSyntheticSpc({echo: true})); pcm(core, 4096);
    core.setMuteMask(255);
    const tail = pcm(core, 512);
    assert.ok(tail.left.slice(8).some(v => v !== 0), 'old echo remains after all dry voices are muted');
  } finally { core.dispose(); }
});

test('Dsp-only core has independent RAM, raw DSP writes, native rendering and reset', async () => {
  const a = await createDsp(), b = await createDsp();
  try {
    const image = createSyntheticSpc(), ram = image.subarray(0x100, 0x10100), regs = image.subarray(0x10100, 0x10180);
    a.loadRam(ram);
    for (let r = 0; r < 128; r++) if (r !== 0x4c) a.writeDsp(r, regs[r]);
    a.writeDsp(0x4c, 1);
    audible(pcm(a, 4096));
    assert.equal(a.readDsp(0x5d), 0x10);
    assert.equal(a.snapshot().ram[0x30], 0, 'DSP-only mode never runs the SMP');
    assert.equal(b.snapshot().ram[0x200], 0, 'a second handle owns separate RAM');
    a.reset(); assert.equal(a.nativeFrames, 0); assert.equal(a.snapshot().ram[0x200], 0);
    assert.ok(pcm(a, 1024).left.every(v => v === 0));
  } finally { a.dispose(); b.dispose(); }
});

test('SPC validates dimensions/numbers and rejects use after idempotent dispose', async () => {
  await assert.rejects(SpcCore.create(), /moduleFactory/);
  const core = await create();
  const left = new Float32Array(8), right = new Float32Array(8);
  assert.throws(() => core.restart(), /Load/);
  assert.throws(() => core.renderInto(left, right), /Load/);
  assert.throws(() => core.load(new Uint8Array(10)), RangeError);
  assert.throws(() => core.load(null), TypeError);
  core.load(createSyntheticSpc());
  for (const bad of [-1, NaN, Infinity, 0.5, 256]) assert.throws(() => core.setMuteMask(bad), RangeError);
  for (const bad of [-1, NaN, Infinity, 0.5, 9]) assert.throws(() => core.renderInto(left, right, bad), RangeError);
  assert.throws(() => core.renderInto(left, right, 2, 7), RangeError);
  assert.throws(() => core.renderInto([], right), TypeError);
  core.renderInto(left, right, 0); assert.equal(core.nativeFrames, 0);
  core.dispose(); core.dispose();
  assert.throws(() => core.snapshot(), /disposed/);
  assert.throws(() => core.renderInto(left, right), /disposed/);
});

test('WASM PCM equals the native pinned accurate core for synthetic BRR/echo/noise/PMON', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'tetorica-spc-native-'));
  try {
    const binary = join(dir, 'reference');
    try {
      await run(process.env.CXX || 'c++', [
        '-std=c++14', '-O2', '-Ithird_party/snes-spc/snes_spc',
        'test/helpers/spc_native_reference.cpp',
        'third_party/snes-spc/snes_spc/SNES_SPC.cpp',
        'third_party/snes-spc/snes_spc/SNES_SPC_misc.cpp',
        'third_party/snes-spc/snes_spc/SNES_SPC_state.cpp',
        'third_party/snes-spc/snes_spc/SPC_DSP.cpp', '-o', binary,
      ], {cwd: root});
    } catch (error) {
      if (error.code === 'ENOENT') { t.skip('Native C++ compiler is unavailable'); return; }
      throw error;
    }
    for (const options of [{}, {voices: 3, echo: true, pmon: true}, {voices: 2, noise: true}]) {
      const input = join(dir, 'synthetic.spc'), output = join(dir, 'native.s16');
      const image = createSyntheticSpc(options); await writeFile(input, image);
      const frames = 16017;
      await run(binary, [input, output, String(frames), '137']);
      const bytes = await readFile(output), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      assert.equal(bytes.length, frames * 4);
      const core = await create();
      try {
        core.load(image); const actual = pcm(core, frames, [1, 128, 513, 17]);
        for (let i = 0; i < frames; i++) {
          assert.equal(actual.left[i], view.getInt16(i * 4, true) / 32768, `left native frame ${i}`);
          assert.equal(actual.right[i], view.getInt16(i * 4 + 2, true) / 32768, `right native frame ${i}`);
        }
      } finally { core.dispose(); }
    }
  } finally { await rm(dir, {recursive: true, force: true}); }
});

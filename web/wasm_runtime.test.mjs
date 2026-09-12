import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { Ym2203 } from './ym2203.js';
import { Ym2608 } from './ym2608.js';
import { Ym2612 } from './ym2612.js';
import { Ym2610B } from './ym2610b.js';
import { SegaPSG } from './segapsg.js';
import { Rf5c164 } from './rf5c164.js';

async function createChip(name, Type) {
  const url = new URL(`../docs/generated/${name}_wasm.js`, import.meta.url);
  const source = readFileSync(url, 'utf8')
    .replaceAll('import.meta.url', JSON.stringify(url.href))
    .replace('export default Module;', 'Module;');
  const moduleFactory = vm.runInNewContext(source, {
    console, WebAssembly, Uint8Array, setTimeout, clearTimeout, performance, URL,
  });
  return Type.create({ moduleFactory, moduleOptions: {
    wasmBinary: new Uint8Array(readFileSync(new URL(`../docs/generated/${name}_wasm.wasm`, import.meta.url))),
  } });
}

for (const Type of [Ym2203, Ym2608, Ym2612, Ym2610B, SegaPSG, Rf5c164]) {
  test(`${Type.name} rejects invalid frame counts before allocation or WASM access`, () => {
    const unexpected = () => assert.fail('Invalid input reached WASM');
    const chip = new Type({ _malloc: unexpected }, 1, { generate: unexpected, generateWithInternalEnvelope: unexpected });
    for (const frames of [-1, 0.5, NaN, Infinity, 0x1000001, 2 ** 32, '1', undefined]) {
      assert.throws(() => chip.generateStereo(frames), RangeError);
      if (chip.generateStereoWithInternalEnvelope)
        assert.throws(() => chip.generateStereoWithInternalEnvelope(frames), RangeError);
    }
  });
}

for (const [name, Type, period] of [
  ['ym2203', Ym2203, 18], ['ym2608', Ym2608, 18],
  ['ym2612', Ym2612, 1], ['ym2610b', Ym2610B, 9],
]) {
  test(`${name} timer deadlines, IRQ, reload, cancellation and reset`, async () => {
    const chip = await createChip(name, Type);
    try {
      const write = (reg, value) => { chip.write(0, reg); chip.write(1, value); };
      const irq = [];
      if (chip.setHooks) chip.setHooks({ onIrq: value => irq.push(value) });
      if (name === 'ym2608') write(0x29, 0x1f); // Enable timer IRQ sources.
      write(0x24, 0xff); write(0x25, 3); write(0x27, 5);
      chip.generateStereo(period - 1);
      assert.equal(chip.readStatus() & 1, 0);
      chip.generateStereo(1);
      // Check the hook before a read can synchronize it.
      if (chip.setHooks) assert.deepEqual(irq, [false, true]);
      assert.equal(chip.readStatus() & 1, 1);
      assert.equal(chip.getIrq(), true);
      write(0x27, 0x15); // Clear status while keeping Timer A running.
      assert.equal(chip.getIrq(), false);
      chip.generateStereo(period);
      assert.equal(chip.readStatus() & 1, 1);
      write(0x27, 0x10); // Stop and clear.
      chip.generateStereo(period * 4);
      assert.equal(chip.readStatus() & 1, 0);
      write(0x26, 0xff); write(0x27, 0x0a);
      chip.generateStereo(period * 16);
      assert.equal(chip.readStatus() & 2, 2);
      chip.reset();
      chip.generateStereo(period * 32);
      assert.equal(chip.readStatus() & 3, 0);
      assert.equal(chip.getIrq(), false);
      assert.equal(chip.generateStereo(0).left.length, 0);
    } finally { chip.dispose(); }
  });
}

test('YM2608 rhythm ROM rejects invalid ranges in JS and safely ignores them in raw WASM', async () => {
  const chip = await createChip('ym2608', Ym2608);
  try {
    const bytes = new Uint8Array([0x12]);
    for (const offset of [-1, 0.5, NaN, Infinity, 0x2000, 0xffffffff])
      assert.throws(() => chip.loadAdpcmARom(bytes, offset), RangeError);
    chip.loadAdpcmARom(new Uint8Array(0x2000));
    chip.loadAdpcmARom(bytes, 0x1fff);
    chip.loadAdpcmARom(new Uint8Array(), 0x2000);
    const ptr = chip.module._malloc(1);
    try {
      chip.module.HEAPU8[ptr] = 0x12;
      for (const offset of [0x2000, 0xffffffff])
        chip.api.loadAdpcmARom(chip.handle, offset, ptr, 1);
      chip.api.loadAdpcmARom(chip.handle, 0, 0, 1);
    } finally { chip.module._free(ptr); }
    assert.equal(chip.generateStereo(32).left.length, 32);
  } finally { chip.dispose(); }
});

test('YM2612 envelope generation advances timers and reports IRQ', async () => {
  const chip = await createChip('ym2612', Ym2612);
  try {
    const states = [];
    chip.setHooks({ onIrq: value => states.push(value) });
    chip.writeRegister(0x24, 0xff);
    chip.writeRegister(0x25, 3);
    chip.writeRegister(0x27, 5);
    const pcm = chip.generateStereoWithInternalEnvelope(1);
    assert.equal(pcm.envelopes.length, 4);
    assert.deepEqual(states, [false, true]);
    assert.equal(chip.readStatus() & 1, 1);
  } finally { chip.dispose(); }
});

test('YM2203 timers are independent per instance and retain time across chunks', async () => {
  const a = await createChip('ym2203', Ym2203);
  // Deliberately share one WASM module between two chip handles.
  const b = new Ym2203(a.module, a.api.create(), a.api);
  const write = (chip, reg, value) => { chip.write(0, reg); chip.write(1, value); };
  try {
    for (const chip of [a, b]) {
      write(chip, 0x24, 0xff); write(chip, 0x25, 3); write(chip, 0x27, 5);
    }
    a.generateStereo(7); a.generateStereo(10);
    assert.equal(a.readStatus() & 1, 0);
    a.generateStereo(1);
    assert.equal(a.readStatus() & 1, 1);
    assert.equal(b.readStatus() & 1, 0);
    b.generateStereo(18);
    assert.equal(b.readStatus() & 1, 1);
  } finally { a.dispose(); b.dispose(); }
});

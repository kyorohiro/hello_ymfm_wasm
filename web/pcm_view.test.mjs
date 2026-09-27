import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Ym2612} from './ym2612.js';
import {SegaPSG} from './segapsg.js';

for (const [name, Chip] of [['ym2612', Ym2612], ['segapsg', SegaPSG]]) {
  test(`${name}: borrowed views match owned output and reuse capacity`, async () => {
    const {default: moduleFactory} = await import(`../docs/generated/${name}_wasm.js`);
    const wasmBinary = await readFile(new URL(`../docs/generated/${name}_wasm.wasm`, import.meta.url));
    const a = await Chip.create({moduleFactory, moduleOptions: {wasmBinary}});
    const b = await Chip.create({moduleFactory, moduleOptions: {wasmBinary}});
    try {
      for (const chip of [a,b]) {
        if (name === 'ym2612') {
          chip.writeRegister(0xb6, 0xc0);
          chip.writeRegister(0x2b, 0x80);
          chip.writeRegister(0x2a, 200);
        } else {
          chip.write(0x80); chip.write(0x10); chip.write(0x90);
        }
      }
      a.reserveStereoFrames(256);
      let first;
      let audible = false;
      for (const n of [128, 1, 96, 256, 0, 32]) {
        const view = a.generateStereoView(n), owned = b.generateStereo(n);
        first ??= view;
        assert.equal(view, first);
        assert.equal(view.left.length, 256);
        assert.deepEqual(view.left.slice(0,n), owned.left);
        assert.deepEqual(view.right.slice(0,n), owned.right);
        audible ||= owned.left.some(x => x !== 0) || owned.right.some(x => x !== 0);
      }
      assert.ok(audible);
      const owned = a.generateStereo(32), saved = owned.left.slice();
      a.generateStereoView(512);
      assert.deepEqual(owned.left, saved);
      assert.notEqual(a.pcmView, first);
      for (const n of [-1, 1.5, NaN, 0x1000001]) {
        assert.throws(() => a.generateStereoView(n), RangeError);
        assert.throws(() => a.reserveStereoFrames(n), RangeError);
      }
    } finally { a.dispose(); b.dispose(); }
  });

  test(`${name}: refresh views after WASM memory growth`, () => {
    const memory = new WebAssembly.Memory({initial: 1});
    let next = 64, allocations = 0;
    const module = {
      get HEAPF32() { return new Float32Array(memory.buffer); },
      _malloc(size) { allocations++; const p=next; next+=size; return p; },
      _free() {},
    };
    let irqChecks = 0;
    const chip = new Chip(module, 1, {
      generate(_handle, l, r, n) {
        module.HEAPF32.fill(.25, l/4, l/4+n);
        module.HEAPF32.fill(-.25, r/4, r/4+n);
      },
      getIrq() { irqChecks++; return 0; },
    });
    if (name === 'ym2612') chip.setHooks({onIrq() {}});
    chip.reserveStereoFrames(128);
    const count = allocations;
    const old = chip.generateStereoView(64);
    for (let i=0; i<100; i++) assert.equal(chip.generateStereoView(32), old);
    assert.equal(allocations, count);
    memory.grow(1);
    const fresh = chip.generateStereoView(64);
    assert.notEqual(fresh, old);
    assert.equal(fresh.left.buffer, memory.buffer);
    assert.equal(fresh.left[63], .25);
    assert.equal(fresh.right[63], -.25);
    if (name === 'ym2612') assert.ok(irqChecks >= 102);
  });
}

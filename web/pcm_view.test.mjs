import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Ym2612} from './ym2612.js';
import {SegaPSG} from './segapsg.js';
import {YM2612Synth, YM2612DirectTransport} from './ym2612synth.js';
import {FM_PRESETS} from './megasynth-fm-presets.js';

const numericBindings = {
  ym2612: {
    create: ['create', 'number', []], destroy: ['destroy', null, ['number']],
    reset: ['reset', null, ['number']], write: ['write', null, ['number', 'number', 'number']],
    read: ['read', 'number', ['number', 'number']], readStatus: ['read_status', 'number', ['number']],
    getIrq: ['get_irq', 'number', ['number']], sampleRate: ['sample_rate', 'number', ['number', 'number']],
    generate: ['generate', null, Array(4).fill('number')],
    generateWithInternalEnvelope: ['generate_with_internal_envelope', null, Array(9).fill('number')],
  },
  segapsg: {
    create: ['create', 'number', ['number', 'number']], destroy: ['destroy', null, ['number']],
    reset: ['reset', null, ['number']], write: ['write', null, ['number', 'number']],
    setStereo: ['set_stereo', null, ['number', 'number']], setMuteMask: ['set_mute_mask', null, ['number', 'number']],
    sampleRate: ['sample_rate', 'number', ['number']], generate: ['generate', null, Array(4).fill('number')],
  },
};

for (const [name, Chip] of [['ym2612', Ym2612], ['segapsg', SegaPSG]]) {
  test(`${name}: numeric exports bind their module and bypass cwrap`, async () => {
    const calls = [], failure = new Error('native failure');
    let fail = false;
    const module = {cwrap() { assert.fail('Direct numeric exports must bypass cwrap'); }};
    for (const [key, [suffix]] of Object.entries(numericBindings[name])) {
      module[`_${name}_${suffix}`] = function (...args) {
        assert.equal(this, module);
        if (fail) throw failure;
        calls.push({key, args});
        return 123;
      };
    }
    const chip = await Chip.create({moduleFactory: () => module});
    assert.equal(chip.handle, 123);
    assert.deepEqual(calls.shift(), {key: 'create', args: name === 'ym2612' ? [] : [44100, 3579545]});
    for (const [key, [, , types]] of Object.entries(numericBindings[name])) {
      const args = types.map((_, index) => index + 1);
      assert.equal(chip.api[key](...args), 123);
      assert.deepEqual(calls.shift(), {key, args});
    }
    fail = true;
    assert.throws(() => chip.api.write(1, 2, 3), error => error === failure);
    fail = false;
    chip.dispose();
    assert.deepEqual(calls, [{key: 'destroy', args: [123]}]);
  });

  test(`${name}: cwrap-only factories retain required APIs and optional absence`, async () => {
    const wrapped = [];
    const module = {cwrap(nativeName, result, types) {
      assert.equal(this, module);
      wrapped.push([nativeName, result, types]);
      return () => 123;
    }};
    const chip = await Chip.create({moduleFactory: () => module});
    const optional = new Set(name === 'ym2612' ? ['read', 'readStatus', 'getIrq'] : []);
    for (const [key, [suffix, result, types]] of Object.entries(numericBindings[name])) {
      if (optional.has(key)) assert.equal(chip.api[key], undefined);
      else {
        assert.equal(typeof chip.api[key], 'function');
        assert.deepEqual(wrapped.shift(), [`${name}_${suffix}`, result, types]);
      }
    }
    assert.deepEqual(wrapped, []);
    chip.dispose();
  });
}

for (const [name, Chip] of [['ym2612', Ym2612], ['nuked_opn2', Ym2612], ['segapsg', SegaPSG]]) {
  test(`${name}: direct bindings preserve legacy cwrap PCM and envelope state`, async () => {
    const {default: moduleFactory} = await import(`../docs/generated/${name}_wasm.js`);
    const wasmBinary = await readFile(new URL(`../docs/generated/${name}_wasm.wasm`, import.meta.url));
    const direct = await Chip.create({moduleFactory, moduleOptions: {wasmBinary}});
    const legacy = await Chip.create({moduleFactory, moduleOptions: {wasmBinary}});
    const family = Chip === Ym2612 ? 'ym2612' : 'segapsg';
    for (const [key, [suffix, result, types]] of Object.entries(numericBindings[family]))
      if (legacy.api[key]) legacy.api[key] = legacy.module.cwrap(`${family}_${suffix}`, result, types);
    const synths = Chip === Ym2612
      ? [direct, legacy].map(chip => new YM2612Synth({transport: new YM2612DirectTransport(chip)}))
      : [];
    let audible = false;
    try {
      for (let pass = 0; pass < 2; pass++) {
        for (const chip of [direct, legacy]) chip.reset();
        for (const synth of synths) { synth.setPreset(0, FM_PRESETS['one-op-basic']); synth.noteOn(0, 52); }
        for (const chip of synths.length ? [] : [direct, legacy]) {
          chip.write(0x8d); chip.write(0x10); chip.write(0x92);
          chip.write(0xe4); chip.write(0xf5);
          chip.setStereo(0x9f);
        }
        for (const [index, frames] of [0, 1, 127, 128, 257, 4096, 32, 1024].entries()) {
          if (index === 5) {
            for (const synth of synths) synth.noteOff(0);
            for (const chip of synths.length ? [] : [direct, legacy]) chip.setChannelMuted(0, true);
          }
          if (index === 6) {
            for (const synth of synths) synth.noteOn(0, 74);
            for (const chip of synths.length ? [] : [direct, legacy]) { chip.setChannelMuted(0, false); chip.setStereo(0xf9); }
          }
          const clock = index % 2 ? 7670454 : 7600489;
          assert.equal(direct.sampleRate(clock), legacy.sampleRate(clock));
          const render = chip => Chip === Ym2612 && index % 2
            ? chip.generateStereoWithInternalEnvelope(frames, 0) : chip.generateStereo(frames);
          const a = render(direct), b = render(legacy);
          assert.deepEqual(a, b);
          audible ||= a.left.some(value => Math.abs(value) > .01);
          if (Chip === Ym2612) {
            assert.equal(direct.readStatus(), legacy.readStatus());
            assert.equal(direct.getIrq(), legacy.getIrq());
          }
        }
      }
      assert.ok(audible);
    } finally { direct.dispose(); legacy.dispose(); }
  });

  test(`${name}: borrowed views match owned output and reuse capacity`, async () => {
    const {default: moduleFactory} = await import(`../docs/generated/${name}_wasm.js`);
    const wasmBinary = await readFile(new URL(`../docs/generated/${name}_wasm.wasm`, import.meta.url));
    const a = await Chip.create({moduleFactory, moduleOptions: {wasmBinary}});
    const b = await Chip.create({moduleFactory, moduleOptions: {wasmBinary}});
    try {
      for (const chip of [a,b]) {
        if (Chip === Ym2612) {
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
    if (Chip === Ym2612) chip.setHooks({onIrq() {}});
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
    if (Chip === Ym2612) assert.ok(irqChecks >= 102);
  });
}

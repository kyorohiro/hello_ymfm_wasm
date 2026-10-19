import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Ym2203} from './ym2203.js';
import {Ym2608} from './ym2608.js';
import {Ym2610B} from './ym2610b.js';

const chips = [
  ['ym2203', Ym2203], ['ym2608', Ym2608],
  ['ym2610b', Ym2610B, true], ['ym2610b', Ym2610B, false],
];

async function create(name, Chip, variant) {
  const {default: moduleFactory} = await import(`../docs/generated/${name}_wasm.js`);
  const wasmBinary = await readFile(new URL(`../docs/generated/${name}_wasm.wasm`, import.meta.url));
  const chip = await Chip.create({moduleFactory, moduleOptions:{wasmBinary}, variant});
  const write = (register, value) => {chip.write(0, register); chip.write(1, value);};
  // Program a sustained FM note and a pure SSG tone. The same bus sequence is
  // used for the independently allocated view and owned-copy chip instances.
  const channel = variant === false ? 1 : 0;
  write(0xb0 + channel, 7);
  write(0xb4 + channel, 0xc0);
  for (const offset of [0,4,8,12]) {
    write(0x30 + offset + channel, 1);
    write(0x40 + offset + channel, offset === 12 ? 32 : 127);
    write(0x50 + offset + channel, 31);
    write(0x80 + offset + channel, 15);
  }
  write(0xa4 + channel, 0x22);
  write(0xa0 + channel, 0x69);
  write(0x28, 0xf0 | channel);
  write(0, 120); write(1, 0); write(7, 0x3e); write(8, 8);
  return chip;
}

for (const [name,Chip,variant] of chips) {
  const label = variant === false ? 'ym2610' : name;
  for (const outputRate of [44100,48000,96000]) {
    test(`${label}: reusable PCM matches owned copies for ${outputRate} Hz source chunks`, async t => {
      const a = await create(name,Chip,variant), b = await create(name,Chip,variant);
      t.after(() => {a.dispose(); b.dispose();});
      const capacity = Math.ceil(256 * a.sampleRate() / outputRate);
      a.reserveStereoFrames(capacity);
      const first = a.generateStereoView(0);
      let remainder = 0, audible = false;
      for (const outputFrames of [128,1,96,256,0,32,127,1,128,128]) {
        const frames = Math.floor((remainder + outputFrames * a.sampleRate()) / outputRate);
        remainder += outputFrames * a.sampleRate() - frames * outputRate;
        const view = a.generateStereoView(frames), owned = b.generateStereo(frames);
        assert.equal(view, first, 'rendering must reuse both views and the result object');
        assert.equal(view.left.length, capacity);
        assert.deepEqual(view.left.slice(0,frames), owned.left);
        assert.deepEqual(view.right.slice(0,frames), owned.right);
        audible ||= owned.left.some(x => x !== 0);
      }
      assert(audible, 'real FM/SSG output must be audible');
      const owned = a.generateStereo(64), saved = owned.left.slice();
      b.generateStereo(64);
      const grown = a.generateStereoView(capacity + 1), expected = b.generateStereo(capacity + 1);
      assert.notEqual(grown,first);
      assert.deepEqual(grown.left,expected.left);
      assert.deepEqual(grown.right,expected.right);
      assert.deepEqual(owned.left,saved,'borrowed generation must preserve earlier owned copies');
      for (const frames of [-1,1.5,NaN,0x1000001]) {
        assert.throws(() => a.generateStereoView(frames),RangeError);
        assert.throws(() => a.reserveStereoFrames(frames),RangeError);
      }
      a.dispose();
      assert.throws(() => a.generateStereoView(1),/disposed/);
      assert.throws(() => a.reserveStereoFrames(128),/disposed/);
      assert.throws(() => a.generateStereo(1),/disposed/);
      assert.deepEqual(owned.left,saved,'owned copies survive disposal');
    });
  }

  test(`${label}: refresh borrowed views after actual WASM memory growth`, async t => {
    const a = await create(name,Chip,variant), b = await create(name,Chip,variant);
    let allocation = 0;
    t.after(() => {if (allocation) a.module._free(allocation); a.dispose(); b.dispose();});
    a.reserveStereoFrames(4096);
    const old = a.generateStereoView(0), oldBuffer = old.left.buffer;
    // A memory allocation larger than the existing entire heap forces the
    // generated Emscripten runtime to grow memory and replace its typed arrays.
    allocation = a.module._malloc(a.module.HEAPF32.byteLength + 65536);
    assert(allocation);
    assert.notEqual(a.module.HEAPF32.buffer,oldBuffer);
    const fresh = a.generateStereoView(512), expected = b.generateStereo(512);
    assert.notEqual(fresh,old);
    assert.equal(fresh.left.buffer,a.module.HEAPF32.buffer);
    assert.deepEqual(fresh.left.slice(0,512),expected.left);
    assert.deepEqual(fresh.right.slice(0,512),expected.right);
    assert.equal(a.generateStereoView(0),fresh);
  });
}

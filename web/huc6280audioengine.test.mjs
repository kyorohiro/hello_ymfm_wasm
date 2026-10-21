import test from 'node:test';
import assert from 'node:assert/strict';
import factory from '../docs/generated/huc6280_wasm.js';
import {Huc6280AudioEngine} from './huc6280audioengine.js';

function wave(engine) {
  const write = (register, value) => engine.writeHuc6280(register, value);
  write(1, 255); write(0, 0); write(4, 64); write(4, 0);
  for (let i = 0; i < 32; i++) write(6, i < 16 ? 31 : 0);
  write(2, 254); write(3, 0); write(5, 249); write(4, 159);
}

test('HuC6280 PCM retains independent owned buffers and Float32 gain across variable blocks', async () => {
  const create = () => Huc6280AudioEngine.create({moduleFactory: factory, clock: 3579545, outputSampleRate: 48000});
  const reference = await create(), scaled = await create();
  try {
    let retained;
    for (const volume of [0, .7, 1, 3.8]) {
      reference.reset(); scaled.reset();
      wave(reference); wave(scaled); scaled.setMasterVolume(volume);
      let previous;
      for (const frames of [0, 1, 127, 128, 257, 31, 4096, 256]) {
        const expected = reference.processFrames(frames), actual = scaled.processFrames(frames);
        assert.notEqual(actual.left.buffer, actual.right.buffer);
        assert.notEqual(actual.left.buffer, scaled.module.HEAPF32.buffer);
        assert.notEqual(actual.right.buffer, scaled.module.HEAPF32.buffer);
        for (const side of ['left', 'right']) {
          assert.deepEqual(actual[side], Float32Array.from(expected[side], value => value * volume));
          if (previous) {
            assert.notEqual(actual[side].buffer, previous.pcm[side].buffer);
            assert.deepEqual(previous.pcm[side], previous.snapshot[side], 'later synthesis must not change returned PCM');
          }
        }
        previous = {pcm: actual, snapshot: {left: actual.left.slice(), right: actual.right.slice()}};
      }
      retained = previous;
    }
    scaled.dispose();
    assert.deepEqual(retained.pcm, retained.snapshot, 'disposal must not invalidate returned PCM');
  } finally { reference.dispose(); scaled.dispose(); }
});

function replacingHeapModule() {
  return {
    HEAPF32: new Float32Array(16), allocations: 0, generations: 0, frees: 0, destroys: 0,
    _huc6280_create: () => 1,
    _huc6280_destroy() { this.destroys++; },
    _malloc(bytes) {
      this.allocations++;
      this.HEAPF32 = new Float32Array(bytes / 4 + 4);
      return 16;
    },
    _free() { this.frees++; },
    _huc6280_generate(handle, left, right, frames) {
      this.generations++;
      this.HEAPF32 = new Float32Array(this.HEAPF32.length + 8);
      for (let i = 0; i < frames; i++) {
        this.HEAPF32[left / 4 + i] = this.generations + (i + 1) / 10;
        this.HEAPF32[right / 4 + i] = -this.generations - (i + 1) / 10;
      }
    },
  };
}

test('HuC6280 PCM reads the heap replaced during allocation and generation, including reused capacity', () => {
  const module = replacingHeapModule(), engine = new Huc6280AudioEngine(module, 3579545, 48000, .7);
  try {
    for (const frames of [3, 1, 7]) {
      const pcm = engine.processFrames(frames);
      for (let i = 0; i < frames; i++) {
        assert.equal(pcm.left[i], Math.fround(Math.fround(module.generations + (i + 1) / 10) * .7));
        assert.equal(pcm.right[i], Math.fround(Math.fround(-module.generations - (i + 1) / 10) * .7));
      }
    }
    assert.equal(module.allocations, 2, 'shorter blocks retain the previous stereo capacity');
  } finally { engine.dispose(); }
});

test('HuC6280 zero/invalid blocks and disposal do not allocate or advance synthesis', () => {
  const module = replacingHeapModule(), engine = new Huc6280AudioEngine(module, 3579545, 48000, 1);
  for (const frames of [-1, .5, NaN, Infinity, 0x1000001]) {
    assert.throws(() => engine.processFrames(frames), RangeError);
  }
  const zero = engine.processFrames(0);
  assert.equal(zero.left.length, 0); assert.equal(zero.right.length, 0);
  assert.notEqual(zero.left.buffer, zero.right.buffer);
  assert.equal(module.allocations, 0); assert.equal(module.generations, 0);
  engine.dispose(); engine.dispose();
  assert.equal(module.destroys, 1);
  assert.throws(() => engine.processFrames(0), /disposed/);
  assert.equal(module.allocations, 0); assert.equal(module.generations, 0);
});

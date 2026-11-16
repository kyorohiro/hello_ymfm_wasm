import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import factory from '../generated/ay8910_wasm.js';
import {VgmPlayer} from '../js/vgmplayer.js';
import {readYmVgmSource} from './vgm_source.js';
import {createYmVgmEngine} from './vgm_engine.js';
import {createYmVgmFixture, ayWrite, ayWait} from './vgm_test_helpers.mjs';

const wasmBinary = await readFile(new URL('../generated/ay8910_wasm.wasm', import.meta.url));
const module = await factory({wasmBinary}), moduleFactory = async () => module;
// Exercise the actual existing SynthWorklet speaker implementation through the
// independent VgmPlayer parser/scheduler. No browser audio device is involved.
const globals = new Map(['AudioWorkletProcessor', 'registerProcessor', 'sampleRate'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
let Processor;
globalThis.AudioWorkletProcessor = class { constructor() { this.port = {postMessage: data => this.onReady?.(data), close() {}}; } };
globalThis.registerProcessor = (_name, constructor) => { Processor = constructor; };
globalThis.sampleRate = 44100;
await import('../js/playground_ay8910_worklet.js');
after(() => { for (const [key, value] of globals) { if (value) Object.defineProperty(globalThis, key, value); else delete globalThis[key]; } });
async function referencePlayer(source) {
  const processor = new Processor({processorOptions: {clock: source.clock, type: source.type, flags: source.flags, wasmBinary}});
  await new Promise((resolve, reject) => { processor.onReady = data => data.ready ? resolve() : data.error ? reject(new Error(data.error)) : null; });
  const engine = {
    reset: () => processor.apply({method: 'reset'}), sampleRate: () => 44100,
    writeAy8910: (register, value) => processor.writeRegister(register, value),
    processFrames: count => processor.generateStereo(count),
  };
  const player = new VgmPlayer(engine); player.load(source.bytes, {logger: null});
  player.setPrefetchFactor(1); player.setLoopEnabled(false); player.reset(); player.play();
  return {player, dispose: () => processor.dispose()};
}
function render(engine, count, parts = [count]) {
  const left = new Float32Array(count), right = new Float32Array(count);
  let offset = 0, index = 0;
  while (offset < count) {
    const size = Math.min(count - offset, parts[index++ % parts.length]);
    const pcm = engine.processFrames(size);
    assert.equal(pcm.left.length, size); left.set(pcm.left, offset); right.set(pcm.right, offset); offset += size;
  }
  return {left, right};
}

for (const options of [
  {type: 0x10, flags: 1, clock: 2000000}, {type: 0x10, flags: 0x11, clock: 1773400},
  {type: 0, flags: 1, clock: 1789773}, {type: 0x10, flags: 0, clock: 2000000},
  ...[2, 3].flatMap(flags => [{type: 0, flags, clock: 1789773}, {type: 0x10, flags, clock: 2000000}]),
  ...[0x12, 0x13].map(flags => ({type: 0x10, flags, clock: 2000000})),
])
  test(`native AY PCM / shape restarts equal existing VgmPlayer and SynthWorklet (${JSON.stringify(options)})`, async () => {
    const source = await readYmVgmSource(createYmVgmFixture(undefined, options));
    const actual = await createYmVgmEngine(source, {moduleFactory}), reference = await referencePlayer(source);
    try {
      const expected = {left: new Float32Array(source.durationFrames), right: new Float32Array(source.durationFrames)};
      assert.equal(reference.player.process(expected.left, expected.right, source.durationFrames), source.durationFrames);
      const pcm = render(actual, source.durationFrames, [1, 7, 113, 256, 77]);
      assert.deepEqual(pcm, expected);
      assert(pcm.left.some(value => Math.abs(value) > .001)); assert(pcm.left.every(Number.isFinite));
      assert.deepEqual(pcm.left, pcm.right);
      assert.equal(actual.frame, source.durationFrames); assert.equal(actual.ended, true);
      assert.equal(actual.processFrames(100).left.length, 0);
      assert(pcm.left.subarray(-200).every(value => value === 0));
    } finally { actual.dispose(); reference.dispose(); }
  });

test('snapshot matches the audible frame without prefetch and retains zero / unknown raw levels', async () => {
  const bytes = createYmVgmFixture([...ayWrite(0, 61), ...ayWrite(1, 255), ...ayWrite(7, 0x3e), ...ayWrite(8, 15), ...ayWait(10), ...ayWrite(8, 0), ...ayWrite(14, 0xab), ...ayWait(10), ...ayWrite(8, 16), 0x66]);
  const source = await readYmVgmSource(bytes), engine = await createYmVgmEngine(source, {moduleFactory});
  try {
    assert.equal(engine.clock, 2000000); assert.equal(engine.sampleRate(), 44100);
    let snapshot = engine.snapshot();
    assert.equal(snapshot.registers[1], 255); assert.equal(snapshot.registers[8], 15);
    assert.equal(snapshot.registers[9], 0); assert.equal(snapshot.registerKnown[9], 0);
    engine.processFrames(9); assert.equal(engine.snapshot().registers[8], 15);
    engine.processFrames(1); snapshot = engine.snapshot();
    assert.equal(snapshot.frame, 10); assert.equal(snapshot.registers[8], 0); assert.equal(snapshot.registers[14], 0xab);
    assert.equal(snapshot.registerKnown[8], 1); assert.equal(snapshot.registerKnown[14], 1);
    snapshot.registers[8] = 99; snapshot.registerKnown.fill(0);
    assert.equal(engine.snapshot().registers[8], 0); assert.equal(engine.snapshot().registerKnown[8], 1);
    assert(engine.processFrames(2).left.every(value => value === 0));
    assert.equal(engine.processFrames(100).left.length, 8); assert.equal(engine.snapshot().registers[8], 16);
    assert(engine.ended);
    for (const value of [-1, 1.5, NaN, 0x1000001]) assert.throws(() => engine.processFrames(value), /frame count/);
  } finally { engine.dispose(); engine.dispose(); }
  assert.throws(() => engine.snapshot(), /disposed/); assert.throws(() => engine.processFrames(1), /disposed/);
});

test('unchanged R13 writes audibly restart the hardware envelope; arbitrary partitions are exact', async () => {
  const start = [...ayWrite(0, 60), ...ayWrite(7, 0x3e), ...ayWrite(8, 16), ...ayWrite(11, 4), ...ayWrite(12, 0), ...ayWrite(13, 12), ...ayWait(333)];
  const a = await createYmVgmEngine(await readYmVgmSource(createYmVgmFixture([...start, ...ayWrite(13, 12), ...ayWait(900), 0x66])), {moduleFactory});
  const b = await createYmVgmEngine(await readYmVgmSource(createYmVgmFixture([...start, ...ayWait(900), 0x66])), {moduleFactory});
  const c = await createYmVgmEngine(await readYmVgmSource(createYmVgmFixture([...start, ...ayWrite(13, 12), ...ayWait(900), 0x66])), {moduleFactory});
  try {
    const pcm = render(a, 1233);
    assert.deepEqual(pcm, render(c, 1233, [7, 1, 96, 335]));
    assert.notDeepEqual(pcm.left.subarray(333), render(b, 1233).left.subarray(333));
  } finally { a.dispose(); b.dispose(); c.dispose(); }
});

test('loading / rendering cancellation and zero-duration sources create no audio context', async () => {
  const source = await readYmVgmSource(createYmVgmFixture([...ayWrite(8, 0), 0x66]));
  const empty = await createYmVgmEngine(source, {moduleFactory});
  assert(empty.ended); assert.equal(empty.processFrames(0).left.length, 0); empty.dispose();
  const controller = new AbortController(); controller.abort();
  let requested = 0;
  await assert.rejects(createYmVgmEngine(source, {signal: controller.signal, moduleFactory: async () => { requested++; return module; }}), {name: 'AbortError'});
  assert.equal(requested, 0);
  const later = new AbortController();
  await assert.rejects(createYmVgmEngine(source, {signal: later.signal, moduleFactory: async () => { later.abort(); return module; }}), {name: 'AbortError'});
  const during = new AbortController(), engine = await createYmVgmEngine(source, {signal: during.signal, moduleFactory});
  during.abort(); assert.throws(() => engine.processFrames(1), {name: 'AbortError'}); engine.dispose();
  await assert.rejects(createYmVgmEngine({}), /Prepare an AY/);
});

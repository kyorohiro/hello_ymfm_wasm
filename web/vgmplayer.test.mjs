import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { VgmPlayer } from './vgmplayer.js';

function vgm(samples, loop = false) {
  const bytes = new Uint8Array(0x104);
  bytes.set([86, 103, 109, 32]);
  const view = new DataView(bytes.buffer);
  view.setUint32(4, bytes.length - 4, true);
  view.setUint32(8, 0x150, true);
  view.setUint32(0x34, 0xcc, true);
  if (loop) view.setUint32(0x1c, 0x100 - 0x1c, true);
  bytes.set([0x61, samples & 255, samples >>> 8, 0x66], 0x100);
  return bytes;
}
function engine(rate = 44100) {
  return {
    resets: 0, disposed: 0, phase: 0,
    reset() { this.resets++; this.phase = 0; },
    sampleRate: () => rate,
    dispose() { this.disposed++; },
    processFrames(n) {
      const left = Float32Array.from({ length: n }, () => ++this.phase);
      return { left, right: left.slice() };
    },
  };
}
function render(player, frames) {
  const left = new Float32Array(frames).fill(-1), right = left.slice();
  player.process(left, right, frames);
  assert.deepEqual(left, right);
  return [...left];
}

test('pause preserves the queued samples, parser position and fractional time', () => {
  const p = new VgmPlayer(engine());
  p.load(vgm(20)); p.play();
  assert.deepEqual(render(p, 4), [1, 2, 3, 4]);
  p.pause();
  const before = [p.queuedFrames, p.parser.position, p.waitAccumulator];
  assert.deepEqual(render(p, 8), Array(8).fill(0));
  assert.deepEqual([p.queuedFrames, p.parser.position, p.waitAccumulator], before);
  p.resume();
  assert.deepEqual(render(p, 4), [5, 6, 7, 8]);
});

for (const loopPoint of [false, true]) {
  test(`loop ${loopPoint ? 'with' : 'without'} loop point retains every rendered frame`, () => {
    const e = engine(), p = new VgmPlayer(e);
    p.load(vgm(4, loopPoint)); p.setLoopEnabled(true); p.play();
    const audio = render(p, 8);
    assert.deepEqual(audio, loopPoint ? [1,2,3,4,5,6,7,8] : [1,2,3,4,1,2,3,4]);
    assert.ok(e.resets < 10);
    assert.ok(render(p, 8).every(x => x > 0));
  });
}

test('whole-song loops retain fractional sample timing', () => {
  const e = engine(48000), p = new VgmPlayer(e);
  p.load(vgm(1)); p.setLoopEnabled(true); p.setPrefetchFactor(1); p.play();
  assert.ok(render(p, 160).every(x => x > 0));
  assert.equal(e.resets, 146); // 147 VGM samples yield 160 output frames.
});

const workletSource = readFileSync(new URL('./vgm-output-worklet.js', import.meta.url), 'utf8');
function processor() {
  let Type;
  vm.runInNewContext(workletSource, {
    AudioWorkletProcessor: class { constructor() { this.port = { postMessage() {} }; } },
    registerProcessor: (_, value) => { Type = value; },
    Float32Array,
  });
  return new Type();
}
function output(p, frames) {
  const left = new Float32Array(frames).fill(-1), right = left.slice();
  p.process([], [[left, right]]);
  assert.deepEqual(left, right);
  return [...left];
}

test('worklet pause retains a partially consumed chunk, queued chunks and end marker', () => {
  const p = processor();
  const send = data => p.port.onmessage({ data });
  for (const values of [[1,2,3,4], [5,6]]) {
    send({ type: 'enqueue', left: new Float32Array(values).buffer, right: new Float32Array(values).buffer });
  }
  send({ type: 'end' });
  assert.deepEqual(output(p, 2), [1,2]);
  send({ type: 'pause' });
  assert.deepEqual(output(p, 4), [0,0,0,0]);
  assert.equal(p.queuedFrames, 4);
  assert.equal(p.currentOffset, 2);
  send({ type: 'resume' });
  assert.deepEqual(output(p, 4), [3,4,5,6]);
  assert.equal(p.endRequested, true);
});

function deferred() {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
}
async function until(predicate) {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return;
    await Promise.resolve();
  }
  assert.fail('Async boundary was not reached');
}
// Substitute only imports: exercise the actual runtime orchestration with
// controlled engine creation and AudioContext/Worklet implementations.
function runtimeHarness({ factory = async () => engine(), moduleGate = null, script = false } = {}) {
  const nodes = [], contexts = [];
  class Context {
    constructor() {
      this.sampleRate = 44100; this.state = 'running'; this.destination = {};
      this.closed = 0;
      this.audioWorklet = script ? null : { addModule: async () => { if (moduleGate) await moduleGate.promise; } };
      contexts.push(this);
    }
    close() { this.closed++; return Promise.resolve(); }
    resume() { return Promise.resolve(); }
    createScriptProcessor() {
      const n = { connect() {}, disconnect() {} };
      nodes.push(n); return n;
    }
  }
  const source = readFileSync(new URL('./vgm_runtime.js', import.meta.url), 'utf8')
    .replace(/^import .*;\n/gm, '')
    .replace('export function createVgmRuntime', 'function createVgmRuntime')
    .replace('export const VgmRuntime', 'const VgmRuntime') + '\ncreateVgmRuntime;';
  const create = vm.runInNewContext(source, {
    ym2612ModuleFactory() {}, segaPsgModuleFactory() {},
    createGenesisAudioEngine: factory, VgmPlayer, AudioContext: Context,
    AbortController, DOMException, console, Float32Array,
    AudioWorkletNode: class {
      constructor() {
        this.processor = processor(); this.connected = false;
        this.port = { postMessage: data => this.processor.port.onmessage({ data }) };
        nodes.push(this);
      }
      connect() { this.connected = true; }
      disconnect() { this.connected = false; }
    },
  });
  return { runtime: create(), nodes, contexts };
}

test('runtime pauses and resumes already transferred Worklet audio', async () => {
  const { runtime, nodes } = runtimeHarness();
  await runtime.load(vgm(20000)); await runtime.play();
  const node = nodes[0];
  assert.deepEqual(output(node.processor, 2), [1,2]);
  runtime.pause();
  const queued = runtime.player.queuedFrames;
  assert.deepEqual(output(node.processor, 2), [0,0]);
  // A status report already in transit must not pump audio while paused.
  node.port.onmessage({ data: { queuedFrames: 4094 } });
  assert.equal(runtime.player.queuedFrames, queued);
  runtime.resume();
  assert.deepEqual(output(node.processor, 2), [3,4]);
  await runtime.finalize();
});

test('script fallback preserves audio while paused', async () => {
  const { runtime, nodes } = runtimeHarness({ script: true });
  await runtime.load(vgm(20000)); await runtime.play();
  const render = () => {
    const audio = [new Float32Array(2048), new Float32Array(2048)];
    nodes[0].onaudioprocess({ outputBuffer: { getChannelData: i => audio[i] } });
    return audio[0];
  };
  assert.equal(render()[0], 1);
  runtime.pause(); assert.ok(render().every(x => x === 0));
  runtime.resume(); assert.equal(render()[0], 2049);
  await runtime.finalize();
});

test('finalize cancels initialization, disposes late engines and permits a fresh initialize', async () => {
  const gate = deferred(), old = engine(), fresh = engine();
  let calls = 0;
  const { runtime } = runtimeHarness({ factory: () => ++calls === 1 ? gate.promise : Promise.resolve(fresh) });
  const cancelled = assert.rejects(runtime.initialize(), { name: 'AbortError' });
  await runtime.finalize(); await cancelled;
  await runtime.initialize();
  gate.resolve(old);
  await until(() => old.disposed === 1);
  assert.equal(runtime.engine, fresh);
  assert.equal(runtime.getState().audio, 'ready');
  await runtime.finalize();
  assert.equal(fresh.disposed, 1);
});

test('finalize while a Worklet module is loading prevents a late output connection', async () => {
  const moduleGate = deferred();
  const { runtime, nodes, contexts } = runtimeHarness({ moduleGate });
  await runtime.load(vgm(20000));
  const cancelled = assert.rejects(runtime.play(), { name: 'AbortError' });
  await until(() => runtime.player.isPlaying());
  await runtime.finalize(); await cancelled;
  moduleGate.resolve();
  assert.equal(nodes.length, 0);
  assert.equal(contexts[0].closed, 1);
  assert.equal(runtime.getState().audio, 'idle');
});

test('finalize cancels a pending context resume without changing the finalized state later', async () => {
  const { runtime, contexts } = runtimeHarness();
  await runtime.initialize();
  const gate = deferred();
  contexts[0].state = 'suspended';
  contexts[0].resume = () => gate.promise;
  const cancelled = assert.rejects(runtime.initialize(), { name: 'AbortError' });
  await runtime.finalize(); await cancelled;
  gate.resolve();
  await Promise.resolve();
  assert.equal(runtime.getState().audio, 'idle');
  assert.equal(runtime.engine, null);
  assert.equal(contexts[0].closed, 1);
});

test('reinitialize waits for context close and concurrent finalize calls share completion', async () => {
  const { runtime, contexts } = runtimeHarness();
  await runtime.initialize();
  const gate = deferred();
  contexts[0].close = () => gate.promise;
  const closing = runtime.finalize();
  assert.equal(runtime.finalize(), closing);
  const restarting = runtime.initialize();
  assert.equal(contexts.length, 1);
  gate.resolve();
  await closing; await restarting;
  assert.equal(contexts.length, 2);
  assert.equal(runtime.getState().audio, 'ready');
  await runtime.finalize();
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { YM2203RuntimeSynth as RuntimeSynth } from './ym2203synth.js';

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
function harness(t, stage = '') {
  const gate = deferred();
  let reached = false;
  const nodes = [];
  const context = {
    state: 'running', currentTime: 0, destination: {},
    resume: async () => {}, close: async () => {},
    audioWorklet: { addModule: async () => {
      if (stage === 'module') { reached = true; await gate.promise; }
    } },
    createGain: () => ({ gain: { value: 1 }, connect() {}, disconnect() {} }),
  };
  const priorNode = globalThis.AudioWorkletNode;
  globalThis.AudioWorkletNode = class {
    constructor() {
      nodes.push(this);
      this.connected = false;
      this.handlers = new Set();
      this.port = {
        closed: false,
        close: () => { this.port.closed = true; },
        addEventListener: (_, fn) => this.handlers.add(fn),
        removeEventListener: (_, fn) => this.handlers.delete(fn),
        start() {},
        postMessage: message => {
          if (message.type !== 'initialize') return;
          reached = true;
          if (stage !== 'ready') queueMicrotask(() => this.send('ready'));
        },
      };
    }
    send(type) { for (const fn of [...this.handlers]) fn({ data: { type } }); }
    connect() { this.connected = true; }
    disconnect() { this.connected = false; }
  };
  t.after(() => { globalThis.AudioWorkletNode = priorNode; });
  t.mock.method(globalThis, 'fetch', async () => {
    if (stage === 'fetch') { reached = true; await gate.promise; }
    return { ok: true, arrayBuffer: async () => new ArrayBuffer(1) };
  });
  const synth = new RuntimeSynth({ audioContext: context, stereoWidthWorkletUrl: '', bitcrusherWorkletUrl: '' });
  return { synth, context, nodes, gate, reached: () => reached };
}
for (const stage of ['module', 'fetch', 'ready']) {
  test(`close cancels initialization during ${stage} and permits restart`, async t => {
    const h = harness(t, stage);
    const cancelled = assert.rejects(h.synth.start(), { name: 'AbortError' });
    await until(h.reached);
    await h.synth.close();
    await cancelled;
    h.gate.resolve();
    for (const node of h.nodes) node.send('ready');
    assert.equal(h.synth.state, 'closed');
    assert.equal(h.synth.fm, null);
    assert.ok(h.nodes.every(n => !n.connected && n.port.closed && n.handlers.size === 0));
    const restarting = h.synth.start();
    if (stage === 'ready') {
      await until(() => h.nodes.length === 2);
      h.nodes[1].send('ready');
    }
    await restarting;
    assert.equal(h.synth.isReady(), true);
    await h.synth.close();
  });
}

test('start waits for an owned AudioContext to finish closing', async t => {
  const h = harness(t);
  await h.synth.start();
  const gate = deferred();
  h.synth.audio.ownsAudioContext = true;
  h.context.close = () => gate.promise;
  const prior = globalThis.AudioContext;
  globalThis.AudioContext = class { constructor() { return { ...h.context, close: async () => {} }; } };
  t.after(() => { globalThis.AudioContext = prior; });
  const closing = h.synth.close();
  assert.equal(h.synth.close(), closing);
  const restarting = h.synth.start();
  assert.equal(h.nodes.length, 1);
  gate.resolve();
  await closing; await restarting;
  assert.equal(h.synth.isReady(), true);
  assert.equal(h.nodes.length, 2);
  await h.synth.close();
});

test('worklet initialization failure releases its node and permits retry', async t => {
  const h = harness(t, 'ready');
  const failed = assert.rejects(h.synth.start(), /initialization failed/);
  await until(h.reached);
  h.nodes[0].send('error');
  await failed;
  assert.equal(h.nodes[0].connected, false);
  assert.equal(h.nodes[0].port.closed, true);
  const retry = h.synth.start();
  await until(() => h.nodes.length === 2);
  h.nodes[1].send('ready');
  await retry;
  await h.synth.close();
});


test('close cancels an existing-context resume and ignores its late completion', async t => {
  const h = harness(t);
  await h.synth.start();
  const gate = deferred();
  h.context.state = 'suspended';
  h.context.resume = () => gate.promise;
  const cancelled = assert.rejects(h.synth.start(), { name: 'AbortError' });
  await Promise.resolve();
  await h.synth.close();
  await cancelled;
  gate.resolve();
  await Promise.resolve();
  assert.equal(h.synth.state, 'closed');
  assert.equal(h.synth.fm, null);
});

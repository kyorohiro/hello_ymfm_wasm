import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlaygroundRuntime } from './playground_runtime.js';

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
function setup(t) {
  const listeners = new Set(), statuses = [];
  const previous = globalThis.window;
  globalThis.window = {
    addEventListener: (_, fn) => listeners.add(fn),
    removeEventListener: (_, fn) => listeners.delete(fn), setTimeout,
  };
  const media = () => ({ stop() {}, stopAll() {}, pause() {}, list: () => [], unload() {} });
  const megaDrive = {
    state: 'idle', audioContext: { currentTime: 0 },
    fm: { setPreset() {}, noteOff() {} }, psg: {},
    sample: media(), stream: media(),
    async start() { this.state = 'ready'; }, async resume() {}, async close() {},
    clearFXChain: () => [],
  };
  const runtime = createPlaygroundRuntime({ megaDrive, guardExecution: false, onStatus: s => statuses.push(s) });
  t.after(() => {
    runtime.stop();
    globalThis.window = previous;
    delete globalThis.playgroundReview;
  });
  return { runtime, megaDrive, listeners, statuses };
}

test('stop prevents a late evaluation from registering loops and keyboard handlers', async t => {
  const { runtime, listeners } = setup(t);
  const gate = deferred();
  globalThis.playgroundReview = { gate: gate.promise, entered: false, loops: 0 };
  const running = runtime.playSource(`
    globalThis.playgroundReview.entered = true;
    await globalThis.playgroundReview.gate;
    onKeyboardPressKey('late', () => {});
    liveLoop('late', async () => { globalThis.playgroundReview.loops++; await sleep(60); });
  `);
  await until(() => globalThis.playgroundReview.entered);
  runtime.stop(); gate.resolve(); await running;
  assert.equal(listeners.size, 0);
  assert.equal(globalThis.playgroundReview.loops, 0);
  assert.equal(runtime.getState().playback, 'stopped');
});

test('an older evaluation cannot replace a newer run or change its state', async t => {
  const { runtime, listeners } = setup(t);
  const gate = deferred();
  globalThis.playgroundReview = { gate: gate.promise, entered: false, hits: 0 };
  const old = runtime.playSource('globalThis.playgroundReview.entered = true; await globalThis.playgroundReview.gate;');
  await until(() => globalThis.playgroundReview.entered);
  await runtime.playSource("onKeyboardPressKey('new', () => { globalThis.playgroundReview.hits++; });");
  gate.resolve(); await old;
  assert.equal(listeners.size, 1);
  for (const fn of listeners) fn({});
  assert.equal(globalThis.playgroundReview.hits, 1);
  assert.equal(runtime.getState().playback, 'running');
});

for (const execution of ['main', 'worker']) {
  test(`stop during audio initialization prevents ${execution} code from running`, async t => {
    const { runtime, megaDrive } = setup(t);
    const gate = deferred(); let entered = false;
    megaDrive.start = () => { entered = true; return gate.promise; };
    const previous = globalThis.Worker;
    globalThis.Worker = class { constructor() { assert.fail('Stopped run created a Worker'); } };
    t.after(() => { globalThis.Worker = previous; });
    globalThis.playgroundReview = { ran: false };
    const pending = runtime.playSource('globalThis.playgroundReview.ran = true;', { execution });
    await until(() => entered);
    runtime.stop(); gate.resolve(); await pending;
    assert.equal(globalThis.playgroundReview.ran, false);
    assert.equal(runtime.getState().playback, 'stopped');
  });
}

test('syntax errors leave stopped state and allow the next run', async t => {
  const { runtime, statuses } = setup(t);
  await assert.rejects(runtime.playSource('const = ;'), SyntaxError);
  assert.equal(runtime.getState().playback, 'stopped');
  assert.ok(statuses.some(s => s.startsWith('Error:')));
  await runtime.playSource("onKeyboardPressKey('valid', () => {});");
  assert.equal(runtime.getState().playback, 'running');
});

test('finalize settles pending Worker runs and main-mode stop waits; late Worker messages are ignored', { timeout: 1000 }, async t => {
  const { runtime, listeners } = setup(t);
  const previous = globalThis.Worker, workers = [];
  globalThis.Worker = class {
    constructor() { workers.push(this); }
    postMessage() {}
    terminate() { this.terminated = true; }
  };
  t.after(() => { globalThis.Worker = previous; });
  const cancelled = assert.rejects(runtime.playSource('await sleep(60);', { execution: 'worker' }), { name: 'AbortError' });
  await until(() => workers.length > 0);
  const main = runtime.playSource("onKeyboardPressKey('late', () => {});");
  const lateMessage = workers[0].onmessage;
  await runtime.finalize();
  await cancelled; await main;
  lateMessage({ data: { type: 'complete', loopCount: 1 } });
  assert.equal(workers[0].terminated, true);
  assert.equal(listeners.size, 0);
  assert.equal(runtime.getState().playback, 'stopped');
});

import test from 'node:test';
import assert from 'node:assert/strict';

let sequence = 0;
async function harness(run, {fetcher = async () => ({ok: true, arrayBuffer: async () => new ArrayBuffer(4)}), ready = true, moduleError} = {}) {
  const previous = {fetch: globalThis.fetch, AudioWorkletNode: globalThis.AudioWorkletNode}, nodes = [], modules = [], requests = [];
  globalThis.fetch = async (url, options) => { requests.push({url: String(url), options}); return fetcher(url, options); };
  globalThis.AudioWorkletNode = class {
    constructor(context, name, options) {
      this.name = name; this.options = options; this.sent = [];
      this.port = {postMessage: value => this.sent.push(value), close: () => { this.closed = true; }}; nodes.push(this);
      if (ready) queueMicrotask(() => this.port.onmessage?.({data: {ready: true}}));
    }
    connect() { this.connected = true; }
    disconnect() { this.disconnected = true; }
  };
  const listeners = new Set(), context = {sampleRate: 48000, state: 'suspended',
    audioWorklet: {addModule: async url => { modules.push(String(url)); if (moduleError) throw moduleError; }},
    addEventListener: (_type, listener) => listeners.add(listener), removeEventListener: (_type, listener) => listeners.delete(listener)};
  try {
    const {createSidAudio} = await import(`../../tetorica_src/runtime/playground_sid_audio.js?fixture=${++sequence}`);
    await run({createSidAudio, context, nodes, modules, requests, listeners});
  } finally { globalThis.fetch = previous.fetch; globalThis.AudioWorkletNode = previous.AudioWorkletNode; }
}

test('SID endpoints share module registration but own clock/model/WASM state and disposal', async () => {
  await harness(async ({createSidAudio, context, nodes, modules, requests}) => {
    const a = await createSidAudio(context, {}), b = await createSidAudio(context, null, {clock: 1022727, model: '6581'});
    try {
      assert.equal(nodes[0].name, 'tetorica-sid'); assert.equal(nodes[0].options.outputChannelCount[0], 2);
      assert.equal(nodes[0].options.processorOptions.clock, 985248); assert.equal(nodes[1].options.processorOptions.clock, 1022727);
      assert.equal(nodes[0].options.processorOptions.model, '6581'); assert.equal(a.chip, 'sid');
      assert.match(requests[0].url, /generated\/sid\/sid\.wasm$/); assert.match(modules[0], /playground_sid_worklet\.js$/);
      assert.equal(modules.length, 1); assert.notEqual(a.port, b.port); assert(nodes[0].connected); assert(!nodes[1].connected);
      a.dispose(); a.dispose(); assert(nodes[0].closed && nodes[0].disconnected); assert(!nodes[1].closed);
    } finally { a.dispose(); b.dispose(); }
  });
});

test('SID unsupported clocks/models/rates reject before fetching and audio allocation', async () => {
  await harness(async ({createSidAudio, context, requests, nodes}) => {
    for (const options of [{clock: 1}, {clock: 985248.5}, {model: '8580'}]) await assert.rejects(createSidAudio(context, null, options));
    for (const rate of [7999, 96001, 192000]) { context.sampleRate = rate; await assert.rejects(createSidAudio(context, null), /sample rate/); }
    context.sampleRate = 48000; context.state = 'closed'; await assert.rejects(createSidAudio(context, null), /open AudioContext/);
    assert.equal(requests.length, 0); assert.equal(nodes.length, 0);
  });
});

test('SID failed assets, cancelled readiness and post-ready errors clean up only their endpoint', async () => {
  await harness(async ({createSidAudio, context, nodes}) => {
    await assert.rejects(createSidAudio(context, null), /WASM HTTP 404/); assert.equal(nodes.length, 0);
  }, {fetcher: async () => ({ok: false, status: 404})});
  await harness(async ({createSidAudio, context, nodes, listeners}) => {
    const controller = new AbortController(), pending = createSidAudio(context, null, {signal: controller.signal});
    await new Promise(resolve => setImmediate(resolve)); assert.equal(nodes.length, 1); controller.abort();
    await assert.rejects(pending, /abort/i); assert(nodes[0].closed && nodes[0].disconnected); assert.equal(listeners.size, 0);
  }, {ready: false});
  await harness(async ({createSidAudio, context, nodes}) => {
    const errors = [], pending = createSidAudio(context, null, {onError: error => errors.push(error)});
    await new Promise(resolve => setImmediate(resolve)); nodes[0].onprocessorerror();
    await assert.rejects(pending, /processor failed/); assert.equal(errors.length, 1); assert(errors[0] instanceof Error); assert(nodes[0].closed);
  }, {ready: false});
  await harness(async ({createSidAudio, context, nodes}) => {
    const errors = [], a = await createSidAudio(context, null, {onError: error => errors.push(error)}), b = await createSidAudio(context, null);
    try { nodes[0].onprocessorerror(); assert(nodes[0].closed); assert(!nodes[1].closed); assert.equal(errors.length, 1); assert.match(errors[0].message, /processor failed/); }
    finally { a.dispose(); b.dispose(); }
  });
});

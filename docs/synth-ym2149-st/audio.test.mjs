import test, {after} from 'node:test';
import assert from 'node:assert/strict';

const saved = new Map(['AudioContext', 'AudioWorkletNode', 'fetch'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
let response = () => Promise.resolve({ok: true, arrayBuffer: async () => new ArrayBuffer(16)});
const contexts = [], worklets = [];
class Node {
  constructor() { this.connections = []; this.disconnected = false; }
  connect(target) { this.connections.push(target); return target; }
  disconnect() { this.connections.length = 0; this.disconnected = true; }
}
class Context extends EventTarget {
  constructor(options) {
    super(); this.options = options; this.sampleRate = 48000; this.currentTime = 0;
    this.state = 'suspended'; this.destination = new Node(); this.gains = []; this.closeCount = 0;
    this.audioWorklet = {addModule: async url => { this.moduleUrl = String(url); }};
    contexts.push(this);
  }
  createGain() { const node = new Node(); node.gain = {value: 1}; this.gains.push(node); return node; }
  async resume() { this.state = 'running'; this.dispatchEvent(new Event('statechange')); }
  async close() { this.closeCount++; this.state = 'closed'; this.dispatchEvent(new Event('statechange')); }
}
class Worklet extends Node {
  constructor(context, name, options) {
    super(); this.context = context; this.name = name; this.options = options; this.messages = [];
    this.port = {onmessage: null, close() {}, postMessage: data => {
      if (data.port) { data.port.onmessage = event => this.messages.push(event.data); data.port.start(); }
    }};
    worklets.push(this);
    queueMicrotask(() => this.port.onmessage?.({data: {ready: true}}));
  }
}
globalThis.AudioContext = Context;
globalThis.AudioWorkletNode = Worklet;
globalThis.fetch = (...args) => response(...args);
const {createAudio, YM2149_ST_SYNTH_BALANCE} = await import('./audio.js');
after(() => { for (const [key, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } });

test('uses the fixed ST endpoint and exactly one calibrated source-to-master route', async () => {
  const errors = [];
  const audio = await createAudio({onError: error => errors.push(error)});
  try {
    const context = audio.context, node = worklets.at(-1), [balance, fade, master, songInput] = context.gains;
    assert.equal(node.name, 'tetorica-ay8910');
    assert.deepEqual([node.options.processorOptions.clock, node.options.processorOptions.type, node.options.processorOptions.flags], [2000000, 0x10, 1]);
    assert.match(context.moduleUrl, /playground_ay8910_worklet\.js$/);
    assert.deepEqual(node.connections, [balance]);
    assert.deepEqual(balance.connections, [fade]);
    assert.deepEqual(fade.connections, [master]);
    assert.deepEqual(master.connections, [context.destination]);
    assert.deepEqual(songInput.connections,[master]);
    assert.equal(audio.songInputNode,songInput);
    assert.equal(balance.gain.value, YM2149_ST_SYNTH_BALANCE);
    assert.equal(balance.gain.value, 0.85);
    assert.equal(master.gain.value, 0.6);
    assert.equal(audio.outputNode, master);
    assert.equal(audio.codeInputNode, balance);
    assert.equal(audio.codeOutputNode, fade);
    assert.equal(audio.codeFadeNode, fade);
    assert.deepEqual(audio.instrument.read().activeChannels, []);
    audio.instrument.noteOn('manual', 60); audio.stop();
    assert.deepEqual(audio.instrument.read().activeChannels, []);
    audio.setVolume(3.8); audio.setChipVolume(0);
    assert.equal(master.gain.value, 3.8); assert.equal(balance.gain.value, 0);
    audio.setChipVolume(1);assert.equal(balance.gain.value,0.85);
    assert.equal(songInput.gain.value,0.85);
    audio.setChipVolume(2);assert.equal(balance.gain.value,1.7);
    assert.throws(() => audio.setVolume(3.81));
    await audio.dispose(); await audio.dispose();
    assert.equal(context.closeCount, 1);
    assert.ok(context.gains.every(gain => gain.disconnected));
    assert.deepEqual(errors, []);
  } finally { await audio.dispose(); }
});

test('startup fetch failure closes context and reports one useful error', async () => {
  response = async () => ({ok: false, status: 503});
  const errors = [];
  try {
    await assert.rejects(createAudio({onError: error => errors.push(error)}), /WASM HTTP 503/);
    const context = contexts.at(-1);
    assert.equal(context.state, 'closed');
    assert.equal(context.closeCount, 1);
    assert.equal(errors.length, 1);
    assert.ok(context.gains.every(gain => gain.disconnected));
  } finally { response = async () => ({ok: true, arrayBuffer: async () => new ArrayBuffer(16)}); }
});

test('post-ready processor failure retires the graph and prevents later commands', async () => {
  const errors = [], audio = await createAudio({onError: error => errors.push(error)});
  worklets.at(-1).onprocessorerror();
  await audio.dispose();
  assert.equal(audio.context.state, 'closed');
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /Worklet processor failed/);
  assert.throws(() => audio.setVolume(1), /Worklet processor failed/);
  await assert.rejects(audio.resume(), /Worklet processor failed/);
});

test('invalid presets fail before opening an audio device', async () => {
  const count = contexts.length;
  await assert.rejects(createAudio({preset: {}}), /preset/);
  assert.equal(contexts.length, count);
});

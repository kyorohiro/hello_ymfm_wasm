import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {SpcRuntimeSynth} from './spc_audio.js';

const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {let resolve, reject; const promise = new Promise((a, b) => {resolve = a; reject = b;}); return {promise, resolve, reject};};
const wave = frame => ((frame % 97) - 48) / 96;
class FakeCore {
  static instances = [];
  static gate = null;
  static async create() {
    if (this.gate) await this.gate.promise;
    const core = new FakeCore(); this.instances.push(core); return core;
  }
  constructor() {this.nativeFrames = 0; this.calls = 0; this.mask = 0; this.disposed = false;}
  load(bytes) {if (bytes[0] !== 1) throw new Error('Invalid SPC fixture'); this.nativeFrames = 0;}
  restart() {this.nativeFrames = 0;}
  setMuteMask(mask) {this.mask = mask;}
  // This fixture exercises the unobserved player; the real observer path is
  // covered with the WASM core in playground_spc.test.mjs.
  stopDspObservation() {}
  renderInto(left, right, frames = left.length) {
    this.calls++;
    for (let i = 0; i < frames; i++) {left[i] = this.mask === 255 ? 0 : wave(this.nativeFrames); right[i] = -left[i]; this.nativeFrames++;}
  }
  snapshot() {const ram = new Uint8Array(65536), dsp = new Uint8Array(128); ram[0] = this.nativeFrames & 255; dsp[0] = this.mask; return {ram, dsp, nativeFrames: this.nativeFrames};}
  dispose() {this.disposed = true;}
}
class WorkletBase {
  constructor() {this.port = {messages: [], closed: false, onmessage: null,
    postMessage(message) {this.messages.push(structuredClone(message));}, close() {this.closed = true;}};}
}
function workletTypes(rate = 48000) {
  const source = readFileSync(new URL('./spc-worklet.js', import.meta.url), 'utf8')
    .replace(/^import .*;$/gm, '').replaceAll('export class ', 'class ');
  const resampler = readFileSync(new URL('./spc_resampler.js', import.meta.url), 'utf8').replaceAll('export class ', 'class ');
  return vm.runInNewContext(resampler + '\n' + source + '\n({SpcProcessor,SpcResampler});', {
    AudioWorkletProcessor: WorkletBase, SpcCore: FakeCore, moduleFactory() {}, sampleRate: rate,
    Float32Array, Uint8Array, Error, RangeError, Math, Number, Promise, registerProcessor() {},
  });
}
async function processor(rate = 48000) {
  const {SpcProcessor} = workletTypes(rate), result = new SpcProcessor({processorOptions: {wasmBinary: new Uint8Array(1)}});
  await result.ready; return result;
}
async function command(processor, type, options = {}) {
  const id = processor.port.messages.length + 1;
  processor.port.onmessage({data: {type, id, ...options}}); await processor.commands;
  const reply = processor.port.messages.findLast(message => message.id === id);
  if (reply?.error) {const error = new Error(reply.error); error.name = reply.name; throw error;}
  return reply?.value;
}
function render(processor, frames = 128) {
  const pcm = [new Float32Array(frames), new Float32Array(frames)]; processor.process([], [pcm]); return pcm;
}

for (const rate of [32000, 44100, 48000]) {
  test(`SPC continuous ${rate} Hz resampling is independent of render partitioning`, () => {
    const {SpcResampler} = workletTypes(rate), a = new SpcResampler(new FakeCore(), rate), b = new SpcResampler(new FakeCore(), rate);
    a.render(new Float32Array(0), new Float32Array(0)); assert.equal(a.core.nativeFrames, 0);
    const expected = [new Float32Array(4097), new Float32Array(4097)]; a.render(...expected);
    const actual = [new Float32Array(4097), new Float32Array(4097)];
    const partitions = [1, 127, 193, 1024, 17, 128]; let offset = 0, index = 0;
    while (offset < 4097) {const count = Math.min(partitions[index++ % partitions.length], 4097 - offset); b.render(actual[0].subarray(offset, offset + count), actual[1].subarray(offset, offset + count)); offset += count;}
    assert.deepEqual(actual, expected);
    assert.equal(a.playbackNativeFrames, 4097 * 32000 / rate);
    assert.equal(a.renderedNativeFrames, b.renderedNativeFrames);
    assert.equal(a.left.length, 128); assert.equal(b.left.length, 128);
    assert(expected[0].every(Number.isFinite));
  });
}
test('SPC one-frame instrument resampling matches batched file PCM with at most two native frames ahead', () => {
  for (const rate of [44100, 48000]) {
    const {SpcResampler} = workletTypes(rate), core = new FakeCore();
    const fine = new SpcResampler(core, rate, {sourceFrames: 1}), batched = new SpcResampler(new FakeCore(), rate);
    const a = [new Float32Array(1025), new Float32Array(1025)], b = [new Float32Array(1025), new Float32Array(1025)];
    const scratch = fine.left; fine.render(...a); batched.render(...b);
    assert.deepEqual(a, b); assert.equal(fine.left, scratch);
    assert(core.nativeFrames - fine.playbackNativeFrames <= 2);
    assert.throws(() => new SpcResampler(core, rate, {sourceFrames: 0}), RangeError);
  }
});
test('SPC pause freezes native time and resampler; resume and stop retain exact PCM', async () => {
  const a = await processor(), b = await processor();
  for (const p of [a, b]) {await command(p, 'load', {bytes: Uint8Array.of(1)}); await command(p, 'play');}
  assert.deepEqual(render(a, 193), render(b, 193));
  const before = await command(a, 'pause'), generated = a.core.nativeFrames;
  assert(render(a, 4096).every(channel => channel.every(value => value === 0)));
  assert.equal(a.core.nativeFrames, generated); assert.equal((await command(a, 'state')).positionSeconds, before.positionSeconds);
  await command(a, 'play'); assert.deepEqual(render(a, 129), render(b, 129));
  await command(a, 'mute', {mask: 16}); await command(a, 'stop');
  const stopped = await command(a, 'state'); assert.equal(stopped.positionSeconds, 0); assert.equal(stopped.playing, false); assert.equal(stopped.muteMask, 16);
  await command(b, 'stop'); await command(b, 'mute', {mask: 16});
  await command(a, 'play'); await command(b, 'play'); assert.deepEqual(render(a), render(b));
  a.dispose(); b.dispose();
});
test('SPC seek uses native 32 kHz discard blocks and atomic snapshots identify render-ahead', async () => {
  const p = await processor(44100); await command(p, 'load', {bytes: Uint8Array.of(1)});
  await command(p, 'seek-begin', {seekId: 'seek'});
  await command(p, 'seek-step', {seekId: 'seek', frames: 16000});
  await command(p, 'seek-step', {seekId: 'seek', frames: 7});
  const state = await command(p, 'seek-end', {seekId: 'seek', resume: true});
  assert.equal(state.playbackNativeFrames, 16007); assert.equal(state.positionSeconds, 16007 / 32000);
  const pcm = render(p); assert.equal(pcm[0][0], Math.fround(wave(16007)));
  const snapshot = await command(p, 'snapshot');
  assert.equal(snapshot.ram.length, 65536); assert.equal(snapshot.dsp.length, 128);
  assert.equal(snapshot.nativeFrames, p.core.nativeFrames); assert(snapshot.nativeFrames >= snapshot.playbackNativeFrames);
  assert(snapshot.nativeFrames - snapshot.playbackNativeFrames <= 130);
  assert.equal(snapshot.ram[0], snapshot.nativeFrames & 255);
  await command(p, 'play'); await assert.rejects(command(p, 'seek-step', {seekId: 'seek', frames: 1}), {name: 'AbortError'});
  p.dispose();
});
test('SPC commands await core initialization and disposal rejects late readiness', async () => {
  const gate = deferred(); FakeCore.gate = gate;
  try {
    const {SpcProcessor} = workletTypes(), p = new SpcProcessor({processorOptions: {}});
    p.port.onmessage({data: {type: 'load', id: 1, bytes: Uint8Array.of(1)}});
    p.port.onmessage({data: {type: 'play', id: 2}});
    assert(render(p).every(channel => channel.every(v => v === 0)));
    gate.resolve(); await p.commands;
    assert.equal(p.playing, true); assert(render(p)[0].some(v => v !== 0)); p.dispose();
    const lateGate = deferred(); FakeCore.gate = lateGate;
    const late = new SpcProcessor({processorOptions: {}}); late.dispose(); lateGate.resolve(); await late.ready;
    assert.equal(late.port.messages.length, 0); assert.equal(FakeCore.instances.at(-1).disposed, true);
  } finally {FakeCore.gate = null;}
});
test('SPC processor rejects invalid commands and fails closed on nonrecoverable rendering errors', async () => {
  const p = await processor(); await assert.rejects(command(p, 'play'), /Load an SPC/);
  await command(p, 'load', {bytes: Uint8Array.of(1)}); await command(p, 'play');
  for (const mask of [-1, 256, NaN]) await assert.rejects(command(p, 'mute', {mask}), /mute mask/);
  p.core.renderInto = () => {throw new Error('native renderer failed');};
  const output = [new Float32Array(128).fill(1), new Float32Array(128).fill(1)];
  assert.equal(p.process([], [output]), false); assert(output.every(ch => ch.every(v => v === 0)));
  assert.equal(p.failed, true); assert.equal(p.port.closed, true); assert.match(p.port.messages.at(-1).error, /native renderer/);
});

class MockNode {
  constructor(context) {this.context = context; this.connections = []; this.disconnected = false; this.gain = {value: 1, cancelScheduledValues() {}, cancelAndHoldAtTime() {}, setValueAtTime(v) {this.value = v;}, setTargetAtTime(v) {this.value = v;}, linearRampToValueAtTime(v) {this.value = v;}};}
  connect(...args) {this.connections.push(args);}
  disconnect() {this.connections = []; this.disconnected = true;}
}
class MockContext extends EventTarget {
  static instances = [];
  constructor() {super(); this.state = 'suspended'; this.currentTime = 0; this.sampleRate = 48000; this.destination = new MockNode(this); this.moduleGate = null; this.moduleCalls = 0; this.audioWorklet = {addModule: () => {this.moduleCalls++; return this.moduleGate?.promise ?? Promise.resolve();}}; MockContext.instances.push(this);}
  async resume() {this.state = 'running'; this.dispatchEvent(new Event('statechange'));}
  async close() {this.state = 'closed'; this.dispatchEvent(new Event('statechange'));}
  createGain() {return new MockNode(this);}
  createChannelSplitter() {return new MockNode(this);}
  createChannelMerger() {return new MockNode(this);}
}
class MockWorkletNode extends MockNode {
  static instances = [];
  static autoReady = true;
  constructor(context) {
    super(context); MockWorkletNode.instances.push(this); this.queue = Promise.resolve(); this.commandGate = null; this.sent = [];
    this.state = {ready: true, loaded: false, playing: false, paused: false, positionSeconds: 0, playbackNativeFrames: 0, renderedNativeFrames: 0, muteMask: 0, sampleRate: 48000, nativeSampleRate: 32000};
    this.port = {onmessage: null, closed: false, close() {this.closed = true;},
      postMessage: (data, transfer = []) => {
        if (this.port.closed) throw new Error('Port closed');
        const message = structuredClone(data, {transfer}); this.sent.push(message);
        this.queue = this.queue.then(async () => {
          if (this.commandGate?.type === message.type) await this.commandGate.promise;
          if (this.port.closed) return;
          const s = this.state;
          switch (message.type) {
            case 'load': if (message.bytes[0] !== 1) {this.emit({type: 'result', id: message.id, error: 'Invalid SPC'}); return;} s.loaded = true; s.playing = false; s.paused = true; s.positionSeconds = 0; break;
            case 'play': if (!s.loaded) {this.emit({type: 'result', id: message.id, error: 'Load an SPC file'}); return;} s.playing = true; s.paused = false; break;
            case 'pause': s.playing = false; s.paused = s.loaded; break;
            case 'stop': s.playing = false; s.paused = s.loaded; s.positionSeconds = 0; break;
            case 'mute': s.muteMask = message.mask; break;
            case 'seek-begin': s.positionSeconds = 0; s.playing = false; s.paused = true; break;
            case 'seek-step': s.positionSeconds += message.frames / 32000; break;
            case 'seek-end': s.playing = message.resume; s.paused = !s.playing; break;
            case 'snapshot': this.emit({type: 'result', id: message.id, value: {ram: new Uint8Array(65536), dsp: new Uint8Array(128), nativeFrames: 99}}); return;
            case 'dispose': return;
          }
          this.emit({type: 'result', id: message.id, value: structuredClone(s)});
        });
      }};
    if (MockWorkletNode.autoReady) queueMicrotask(() => this.emit({type: 'ready'}));
  }
  emit(data) {if (!this.port.closed) this.port.onmessage?.({data});}
}
function makeHost(t, options = {}) {
  const previousNode = globalThis.AudioWorkletNode, previousContext = globalThis.AudioContext;
  globalThis.AudioWorkletNode = MockWorkletNode; globalThis.AudioContext = MockContext;
  t.after(() => {globalThis.AudioWorkletNode = previousNode; globalThis.AudioContext = previousContext; MockWorkletNode.autoReady = true;});
  const synth = new SpcRuntimeSynth({wasmBinary: Uint8Array.of(1), ...options});
  synth.audio.prepareNativeFX = async function() {
    const rack = {node: new MockNode(this.audioContext), controller: {getChain: () => [], setChain() {}, clear() {}},
      sample: {stopAll() {}}, noise: {disposeAll() {}}, disposed: false, dispose() {this.disposed = true; this.node.disconnect();}};
    this.nativeFX = rack; this.rebuildFXChain(); return rack;
  };
  t.after(() => synth.close());
  return synth;
}
test('SPC browser host retains output settings, uses actual processor state, and closes only owned audio', async t => {
  const external = new MockContext(), outputNode = new MockNode(external), synth = makeHost(t, {audioContext: external, outputNode, masterVolume: 2});
  assert.equal(synth.node, null); assert.equal(synth.isReady(), false);
  await synth.setVoiceMuted(3, true); await synth.loadSPC(Uint8Array.of(1, 2, 3));
  assert.equal(synth.isReady(), true); assert.equal(synth.getMasterVolume(), 2); assert.equal(synth.mixer.list()[0].id, 'snes_spc');
  const node = synth.node; assert.equal(node.sent.find(m => m.type === 'load').bytes[1], 2);
  await synth.play(); node.state.positionSeconds = 1.234;
  assert.equal((await synth.getState()).positionSeconds, 1.234); assert.equal((await synth.pause()).positionSeconds, 1.234);
  const snapshot = await synth.snapshot(); assert.equal(snapshot.ram.length, 65536);
  const stopped = await synth.stop(); assert.equal(stopped.positionSeconds, 0); assert.equal(stopped.muteMask, 8); assert.equal(stopped.playing, false);
  assert.equal((await synth.restart()).playing, true);
  await synth.close(); assert.equal(external.state, 'running'); assert.equal(node.port.closed, true); assert.equal(synth.mixer.list().length, 0);
  assert.equal((await synth.getState()).closed, true); await assert.rejects(synth.start(), /closed/);
});
test('SPC host rejects invalid numeric controls before opening an audio device', async t => {
  const synth = makeHost(t);
  for (const volume of [-1, Infinity, NaN, 4]) assert.throws(() => synth.setMasterVolume(volume), RangeError);
  for (const mask of [-1, 256, Infinity, NaN]) await assert.rejects(synth.setMuteMask(mask), RangeError);
  for (const seconds of [-1, Infinity, NaN, Number.MAX_SAFE_INTEGER]) await assert.rejects(synth.seek(seconds), RangeError);
  assert.equal(synth.audioContext, null);
});
test('SPC simultaneous load/play preserves FIFO; superseded loads never become audible', async t => {
  const synth = makeHost(t), first = synth.loadSPC(Uint8Array.of(1, 2)), second = synth.loadSPC(Uint8Array.of(1, 3));
  await assert.rejects(first, {name: 'AbortError'}); await second;
  assert.deepEqual(synth.node.sent.filter(m => m.type === 'load').map(m => m.bytes[1]), [3]);
  const original = Uint8Array.of(1, 4), loaded = synth.loadSPC(original), played = synth.play();
  await Promise.all([loaded, played]); assert.equal(original[1], 4); assert.equal((await synth.getState()).playing, true);
});
test('SPC close aborts pending initialization without creating a late node or closing a shared context', async t => {
  const context = new MockContext(), gate = deferred(); context.moduleGate = gate;
  const synth = makeHost(t, {audioContext: context}), count = MockWorkletNode.instances.length;
  const starting = synth.start(); await tick(); await synth.close();
  await assert.rejects(starting, {name: 'AbortError'}); gate.resolve(); await tick();
  assert.equal(MockWorkletNode.instances.length, count); assert.equal(context.state, 'running');
});
test('SPC Stop during initialization fences an older load and does not leave a delayed start', async t => {
  const context = new MockContext(), gate = deferred(); context.moduleGate = gate;
  const synth = makeHost(t, {audioContext: context}), loading = synth.loadSPC(Uint8Array.of(1)), stopping = synth.stop();
  gate.resolve(); await assert.rejects(loading, {name: 'AbortError'}); const state = await stopping;
  assert.equal(state.playing, false); assert.equal(state.loaded, false);
  assert.equal(synth.node.sent.filter(message => message.type === 'load').length, 0);
});
test('SPC close while the core is initializing rejects ready and ignores a late ready message', async t => {
  MockWorkletNode.autoReady = false;
  const synth = makeHost(t), starting = synth.start(); await tick(); const node = synth.node;
  assert(node); await synth.close(); await assert.rejects(starting, {name: 'AbortError'});
  node.emit({type: 'ready'}); await tick();
  assert.equal(node.port.closed, true); assert.equal(synth.node, null); assert.equal(synth.audioContext.state, 'closed');
});
test('SPC close rejects pending ready/request promises and disposes late FX', async t => {
  const synth = makeHost(t), gate = deferred(); let rack;
  synth.audio.prepareNativeFX = async function() {await gate.promise; rack = {node: new MockNode(this.audioContext), disposed: false, dispose() {this.disposed = true;}}; this.nativeFX = rack; return rack;};
  const starting = synth.start(); await tick(); const node = synth.node;
  assert(node); await synth.close(); await assert.rejects(starting, {name: 'AbortError'});
  gate.resolve(); await tick(); assert.equal(rack.disposed, true); assert.equal(node.port.closed, true); assert.equal(synth.audioContext.state, 'closed');
});
test('SPC seek cancellation occurs after a real Worklet command and preserves a paused partial position', async t => {
  const synth = makeHost(t); await synth.loadSPC(Uint8Array.of(1)); await synth.play();
  const abort = new AbortController();
  await assert.rejects(synth.seek(2, {signal: abort.signal, onProgress() {abort.abort();}}), {name: 'AbortError'});
  assert.equal(synth.node.sent.filter(m => m.type === 'seek-step').length, 1);
  const state = await synth.getState(); assert.equal(state.positionSeconds, .5); assert.equal(state.playing, false);
  const seek = await synth.seek(.125, {resume: true}); assert.equal(seek.positionSeconds, .125); assert.equal(seek.playing, true);
});
test('SPC play supersedes an in-flight seek without a stale completion pausing the new playback', async t => {
  const synth = makeHost(t); await synth.loadSPC(Uint8Array.of(1));
  const gate = deferred(); synth.node.commandGate = {type: 'seek-step', ...gate};
  const seeking = synth.seek(2); while (!synth.node.sent.some(m => m.type === 'seek-step')) await tick();
  const playing = synth.play(); gate.resolve();
  await assert.rejects(seeking, {name: 'AbortError'}); await playing;
  assert.equal((await synth.getState()).playing, true);
  assert.equal(synth.node.sent.filter(m => m.type === 'seek-end').length, 0);
});
test('SPC processor failure rejects outstanding requests, releases nodes, and reports the original failure', async t => {
  const errors = [], synth = makeHost(t, {onError: error => errors.push(error.message)});
  await synth.loadSPC(Uint8Array.of(1)); const node = synth.node, gate = deferred();
  node.commandGate = {type: 'state', ...gate}; const pending = synth.getState(); await tick();
  node.onprocessorerror(); await assert.rejects(pending, /processor failed/);
  assert.deepEqual(errors, ['SPC AudioWorklet processor failed']); assert.equal(node.port.closed, true); assert.equal(synth.audioContext.state, 'closed'); gate.resolve();
});

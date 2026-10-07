import test from 'node:test';
import assert from 'node:assert/strict';
import { MegaSynth } from './megasynth.js';
import { MegaSynthRecordingManager } from './megasynth_recording.js';

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
function harness(t, stage = '', options = {}) {
  const gate = deferred();
  let reached = false;
  const nodes = [];
  const context = {
    state: 'running', currentTime: 0, destination: {},
    resume: async () => {}, close: async () => {},
    audioWorklet: { addModule: async url => {
      if (stage === 'module' || (stage === 'pcm-module' && String(url).includes('rf5c164'))) { reached = true; await gate.promise; }
    } },
    createGain: () => ({ gain: { value: 1, cancelScheduledValues(){}, setValueAtTime(v){this.value=v;}, linearRampToValueAtTime(v){this.value=v;} }, connect() {}, disconnect() {} }),
    createChannelSplitter: () => ({connect(){}, disconnect(){}}),
    createChannelMerger: () => ({connect(){}, disconnect(){}}),
  };
  const priorNode = globalThis.AudioWorkletNode;
  globalThis.AudioWorkletNode = class {
    constructor(_context, name) {
      nodes.push(this);
      this.connected = false;
      this.name = name;
      this.commands = [];
      this.handlers = new Set();
      this.port = {
        closed: false,
        close: () => { this.port.closed = true; },
        addEventListener: (_, fn) => this.handlers.add(fn),
        removeEventListener: (_, fn) => this.handlers.delete(fn),
        start() {},
        postMessage: message => {
          this.commands.push(message);
          if (message.port && typeof message.port.postMessage === 'function') {
            this.remote = message.port;
            this.remote.onmessage = ({data}) => {
              this.commands.push(data);
              if (data.id) this.remote.postMessage({id: data.id});
            };
            this.remote.start();
          }
          if (message.method === 'dispose') this.remote?.close();
          if (message.type !== 'initialize') return;
          reached = true;
          if (stage !== 'ready') queueMicrotask(() => this.send('ready'));
        },
      };
      if (name === 'tetorica-rf5c164') {
        reached = true;
        if (stage !== 'pcm-ready') queueMicrotask(() => this.port.onmessage?.({data: {ready: true}}));
      }
    }
    send(type) { for (const fn of [...this.handlers]) fn({ data: { type } }); }
    connect(destination) { this.connected = true; this.destination = destination; }
    disconnect() { this.connected = false; }
  };
  t.after(() => { globalThis.AudioWorkletNode = priorNode; });
  t.mock.method(globalThis, 'fetch', async url => {
    if (stage === 'fetch' || (stage === 'pcm-fetch' && String(url).includes('rf5c164'))) { reached = true; await gate.promise; }
    return { ok: true, arrayBuffer: async () => new ArrayBuffer(1) };
  });
  const synth = new MegaSynth({ audioContext: context, stereoWidthWorkletUrl: '', bitcrusherWorkletUrl: '', rf5c164Fetch: globalThis.fetch, ...options });
  return { synth, context, nodes, gate, reached: () => reached };
}

test('Mega CD uses the shared mixer, exposes eight-channel PCM commands and releases stale clients on close', async t => {
  const {synth, nodes} = harness(t, '', {megaCD: true});
  assert.equal(synth.pcm, null);
  await synth.start();
  const device = nodes.find(n => n.name === 'tetorica-rf5c164');
  assert.ok(synth.psg);
  assert.deepEqual(synth.mixer.list().map(s=>s.id), ['ym2612', 'segapsg', 'rf5c164']);
  const client = synth.pcm;
  const wave = await client.loadSample({channels: [new Float32Array(256).fill(.5)], sampleRate: 32000}, {loopStart: 0});
  assert.equal(wave.start, 0);
  assert.equal(wave.loopStart, 0);
  await client.setChannel(7, {...wave, volume: 255, pan: {left: 15, right: 15}});
  await client.keyOn(7);
  assert.ok(device.commands.some(m => m.method === 'keyOn' && m.args[0] === 7));
  await synth.reset();
  assert.ok(device.commands.some(m => m.method === 'reset'));
  const pending = client.keyOff(7);
  const rejected = assert.rejects(pending, /disposed/);
  await synth.close();
  await rejected;
  await assert.rejects(client.keyOn(0), /disposed/);
  await assert.rejects(client.loadSample(new ArrayBuffer(0)), /disposed/);
  assert.equal(synth.pcm, null);
  assert.ok(nodes.every(n => !n.connected && n.port.closed));
  await synth.start();
  assert.notEqual(synth.pcm, client);
  await synth.close();
});

for (const stage of ['pcm-module', 'pcm-fetch', 'pcm-ready']) {
  test(`Mega CD close cancels ${stage} without leaking nodes and permits restart`, async t => {
    const h = harness(t, stage, {megaCD: true});
    const cancelled = assert.rejects(h.synth.start(), {name: 'AbortError'});
    // The FM initialization also reaches the harness; wait for the PCM boundary.
    await until(() => stage === 'pcm-ready' ? h.nodes.some(n => n.name === 'tetorica-rf5c164') : h.synth.fm !== null && h.reached());
    await h.synth.close();
    await cancelled;
    h.gate.resolve();
    assert.equal(h.synth.pcm, null);
    assert.ok(h.nodes.every(n => !n.connected && n.port.closed));
    const restart = h.synth.start();
    if (stage === 'pcm-ready') {
      await until(() => h.nodes.filter(n => n.name === 'tetorica-rf5c164').length === 2);
      h.nodes.at(-1).port.onmessage({data: {ready: true}});
    }
    await restart;
    assert.ok(h.synth.pcm);
    await h.synth.close();
  });
}

test('Mega CD Worklet errors release FM/PCM nodes and allow retry', async t => {
  const h = harness(t, 'pcm-ready', {megaCD: true});
  const failed = assert.rejects(h.synth.start(), /PCM initialization failed/);
  await until(() => h.nodes.length === 2);
  h.nodes[1].port.onmessage({data: {error: 'PCM initialization failed'}});
  await failed;
  assert.equal(h.synth.pcm, null);
  assert.ok(h.nodes.every(n => !n.connected && n.port.closed));
  const retry = h.synth.start();
  await until(() => h.nodes.length === 4);
  h.nodes[3].port.onmessage({data: {ready: true}});
  await retry;
  assert.ok(h.synth.pcm);
  await h.synth.close();
});
function timers(manager) {
  let id = 0;
  const pending = new Map();
  manager.setTimer = (fn, delay) => { pending.set(++id, { fn, delay }); return id; };
  manager.clearTimer = key => pending.delete(key);
  return {
    pending,
    next() {
      const [key, value] = [...pending].sort((a, b) => a[1].delay - b[1].delay)[0];
      pending.delete(key);
      value.fn();
    },
  };
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
  h.synth.ownsAudioContext = true;
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

test('close stops recording and playback, clears timers, and detaches FM and PSG', async t => {
  const { synth, context } = harness(t);
  await synth.start();
  const clock = timers(synth.recordingManager);
  synth.startRecord();
  synth.fm.noteOn(0, 4, 500);
  context.currentTime = 1;
  await synth.close();
  assert.equal(synth.isRecording(), false);
  const recording = synth.exportRecording();
  assert.equal(recording.durationSeconds, 1);
  await synth.start();
  synth.playRecording(recording, { loop: true });
  const stale = [...clock.pending.values()].map(x => x.fn);
  synth.psg = {};
  await synth.close();
  assert.equal(synth.isRecordingPlaybackActive(), false);
  assert.equal(clock.pending.size, 0);
  assert.equal(synth.recordingManager.synth, null);
  assert.equal(synth.psg, null);
  for (const fn of stale) assert.doesNotThrow(fn);
});

function settings(fm) {
  const state = fm.getState();
  return { lfo: state.lfo, dac: state.dac, mode: state.modeRegister,
    ams: state.channels[0].ams, pms: state.channels[0].pms,
    left: state.channels[0].left, right: state.channels[0].right,
    special: state.channels[2].specialFrequencies };
}
function changeSettings(fm) {
  fm.setLfo(true, 4); fm.setDacEnabled(true); fm.writeDac(200);
  fm.setPan(0, true, true, 2, 5);
  fm.setPan(0, false, true); // Omitted AMS/PMS must preserve the previous values.
  fm.setChannel3SpecialMode(true);
  fm.setChannel3SpecialFrequency(1, 4, 500);
}
for (const initial of [false, true]) {
  test(`recording restores ${initial ? 'initial settings' : 'recorded commands'}`, async t => {
    const { synth, context } = harness(t);
    await synth.start();
    const clock = timers(synth.recordingManager);
    if (initial) changeSettings(synth.fm);
    synth.startRecord();
    if (!initial) changeSettings(synth.fm);
    const expected = settings(synth.fm);
    context.currentTime = 1;
    const recording = synth.stopRecord();
    synth.playRecording(recording);
    while (clock.pending.size > 1) clock.next();
    assert.deepEqual(settings(synth.fm), expected);
    await synth.close();
  });
}

test('loop playback only retains pending timers and stale callbacks cannot affect a new session', () => {
  const manager = new MegaSynthRecordingManager();
  const clock = timers(manager);
  const recording = { format: 'megasynth-recording-v1', version: 1, durationSeconds: 1, commands: [] };
  manager.play(recording, { loop: true });
  const stale = [...clock.pending.values()][0].fn;
  for (let i = 0; i < 1000; i++) clock.next();
  assert.equal(clock.pending.size, 1);
  assert.equal(manager.playbackTimers.size, 1);
  manager.play(recording, { loop: true });
  stale();
  assert.equal(clock.pending.size, 1);
  manager.stopPlayback();
  assert.equal(clock.pending.size, 0);
});

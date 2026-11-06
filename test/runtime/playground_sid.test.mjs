import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {SidCore} from '../../tetorica_src/runtime/sid.js';
import {SidSynth, validateSidClock, SID_PAL_CLOCK} from '../../tetorica_src/runtime/sidsynth.js';
import {SidVoiceInspector, receiveSidInspector} from '../../tetorica_src/runtime/playground_sid_inspector.js';
import {createSidClient, createSidRegisterClient} from '../../tetorica_src/runtime/playground_sid.js';
import {createProcessorPerformance, performanceNoteRelease} from '../../tetorica_src/runtime/playground_performance_processor.js';

const wasmBinary = await readFile(new URL('../../tetorica_src/runtime/generated/sid/sid.wasm', import.meta.url));
const source = (await readFile(new URL('../../tetorica_src/runtime/playground_sid_worklet.js', import.meta.url), 'utf8')).replace(/^import .*;$/gm, '');
const peak = samples => samples.reduce((maximum, sample) => Math.max(maximum, Math.abs(sample)), 0);
async function setup(t, {rate = 48000, clock = SID_PAL_CLOCK} = {}) {
  let Processor, frame = 0, resolveReady; const messages = [], commands = [];
  const ready = new Promise(resolve => { resolveReady = resolve; });
  const port = {postMessage(message) { messages.push(message); if (message.ready || message.error) resolveReady(message); }};
  vm.runInNewContext(source, {SidCore, SidSynth, validateSidClock, SID_PAL_CLOCK, SidVoiceInspector, receiveSidInspector, performanceNoteRelease, sampleRate: rate,
    createProcessorPerformance: options => createProcessorPerformance({...options, rate, nowFrame: () => frame}),
    AudioWorkletProcessor: class { constructor() { this.port = port; } }, registerProcessor(name, Type) { assert.equal(name, 'tetorica-sid'); Processor = Type; }});
  const processor = new Processor({processorOptions: {clock, wasmBinary}}); assert.equal((await ready).ready, true, JSON.stringify(messages));
  const replies = {postMessage: data => clientPort.onmessage?.({data})};
  const clientPort = {start() {}, close() { this.closed = true; }, postMessage(data) { commands.push(data); processor.receive(data, replies); }};
  const client = createSidClient(clientPort, {clock}); client.initialize();
  const fixture = {processor, client, port, messages, commands, rate, clock,
    render(frames = 128) { const left = new Float32Array(frames), right = new Float32Array(frames); const active = processor.process([], [[left, right]]); frame += frames; return {left, right, active}; },
    receive: data => processor.receive(data, port), now: () => frame / rate};
  t.after(() => { client.dispose(); processor.dispose(); }); return fixture;
}
const raw = (reg, value) => ({method: 'writeRegister', args: [reg, value]});

for (const rate of [44100, 48000, 96000]) test(`SID client/Worklet matches direct core through split renders at ${rate} Hz`, async t => {
  const p = await setup(t, {rate}), core = await SidCore.create({sampleRate: rate, wasmBinary}), synth = new SidSynth({core});
  t.after(() => { synth.dispose(); core.dispose(); }); synth.initialize();
  for (const api of [p.client, synth]) { api.setVoice(0, {waveform: 'pulse', pulseWidth: 1200, attack: 0}); api.setFilter({mode: 'lowpass', cutoff: 950, resonance: 10, routing: 7}); api.noteOn(0, 'A3'); api.noteOn(2, 'E4'); }
  let maximum = 0;
  for (const frames of [1, 127, 53, 128, 4096]) {
    const actual = p.render(frames), expected = core.render(frames);
    assert.deepEqual(actual.left, expected); assert.deepEqual(actual.right, expected); assert(actual.active); maximum = Math.max(maximum, peak(expected));
  }
  assert(maximum > .01); const state = await p.client.getState(); assert.equal(state.channels[0].gate, true); assert.equal(state.clock, SID_PAL_CLOCK);
  const cycles = p.processor.core.getState().cycles; assert.equal(await p.client.readRegister(28), core.readRegister(28)); assert.equal(p.processor.core.getState().cycles, cycles + 1);
});

test('SID scheduled Gates apply on their output frame and old owner cancellation preserves replacement notes', async t => {
  const p = await setup(t); p.receive({type: 'performance-start', session: 1});
  const enqueue = (owner, time, commands) => p.receive({performance: {session: 1, owner, time}, commands});
  enqueue('old', 64 / p.rate, [raw(4, 0x21), raw(11, 0x21)]);
  assert.equal(peak(p.render(64).left), 0); assert(!p.processor.synth._getState().channels[0].gate);
  p.render(1); assert(p.processor.synth._getState().channels[0].gate);
  enqueue('new', 128 / p.rate, [raw(4, 0x11)]); enqueue('old', 129 / p.rate, [raw(4, 0x20)]); p.render(128);
  assert(p.processor.synth._getState().channels[0].gate);
  p.receive({type: 'performance-cancel-owner', session: 1, owner: 'old'});
  assert.deepEqual(p.processor.synth._getState().channels.map(voice => voice.gate), [true, false, false]);
  p.receive({type: 'performance-cancel-owner', session: 1, owner: 'new'}); assert(!p.processor.synth._getState().channels[0].gate);
});

test('SID Stop flushes release tails and future notes, preserves patch and acknowledges physical silence', async t => {
  const p = await setup(t); p.client.setVoice(0, {waveform: 'triangle', attack: 0, release: 15}); p.client.noteOn(0, 'C4');
  assert(peak(p.render(4096).left) > .01); const before = p.processor.synth._getState();
  p.receive({type: 'performance-start', session: 2});
  p.receive({performance: {session: 2, owner: 'future', time: 1}, commands: [raw(4, 0x11)]});
  assert.equal(await p.client._stopVoices(), true);
  const stopped = p.processor.synth._getState(); assert.equal(stopped.channels[0].waveform, before.channels[0].waveform); assert.equal(stopped.channels[0].release, 15);
  assert(stopped.channels.every(voice => !voice.gate)); assert.equal(p.processor.performance.getStats().queuedCommands, 0);
  assert.equal(peak(p.render(50000).left), 0); p.client.noteOn(0, 'E4'); assert(peak(p.render(4096).left) > .01);
  p.receive({type: 'performance-stop', session: 2}); assert.equal(peak(p.render(128).left), 0);
});

test('SID primary Worker port replacement/detach retires old writers and their pending notes', async t => {
  const p = await setup(t), first = {start() {}, close() { this.closed = true; }, postMessage() {}}, second = {...first};
  p.processor.port.onmessage({data: {primaryWorker: true, port: first}});
  first.onmessage({data: raw(4, 0x21)}); assert(p.processor.synth._getState().channels[0].gate);
  p.processor.port.onmessage({data: {primaryWorker: true, port: second}}); assert(first.closed); assert.equal(peak(p.render(128).left), 0);
  first.onmessage({data: raw(4, 0x21)}); assert(!p.processor.synth._getState().channels[0].gate);
  second.onmessage({data: raw(4, 0x21)}); assert(p.processor.synth._getState().channels[0].gate);
  p.processor.port.onmessage({data: {primaryWorker: true}}); assert(second.closed); assert.equal(peak(p.render(128).left), 0);
});

test('SID read-only inspector protocol never advances the chip and rejects invocation', async t => {
  const p = await setup(t), cycles = p.processor.core.getState().cycles;
  p.receive({type: 'chip-inspector', action: 'read', id: 'read'});
  const value = p.messages.find(message => message.id === 'read').value; assert.equal(value.kind, 'sid'); assert.equal(value.channels.length, 3);
  p.receive({type: 'chip-inspector', action: 'invoke', method: 'auditionOn', id: 'edit'});
  assert.match(p.messages.find(message => message.id === 'edit').error, /read-only/); assert.equal(p.processor.core.getState().cycles, cycles);
  await assert.rejects(p.client.setClock(1022727), /new SID instance/); assert.equal(await p.client.setClock(SID_PAL_CLOCK), true);
});

test('SID async register reads restore their loop context and reject late replies from stopped owners', async () => {
  const original = {name: 'old'}, other = {name: 'other'}; let current = original, resolveRead;
  const sent = [], client = createSidRegisterClient((...args) => sent.push(args), {request: () => new Promise(resolve => { resolveRead = resolve; }),
    lifecycle: {captureContext: () => current, restoreContext: value => { current = value; }, isStopped: context => context?.stopped}});
  client.initialize(); const pending = client.readRegister(28); current = other; resolveRead(42); assert.equal(await pending, 42); assert.equal(current, original);
  const cancelled = client.readRegister(28); original.stopped = true; current = other; resolveRead(43);
  await assert.rejects(cancelled, {name: 'AbortError'}); assert.equal(current, other);
  client._beforeWrite = () => false; client._forceKeyOff(0); assert.equal(sent.at(-1)[0], 'forceKeyOff');
  client.dispose(); client.dispose(); assert.throws(() => client.keyOn(0), /disposed/);
});

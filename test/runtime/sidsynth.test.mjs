import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {SidCore, SID_PAL_CLOCK} from '../../tetorica_src/runtime/sid.js';
import {SidSynth} from '../../tetorica_src/runtime/sidsynth.js';
import {SidVoiceInspector, receiveSidInspector} from '../../tetorica_src/runtime/playground_sid_inspector.js';

const wasmBinary = await readFile(new URL('../../tetorica_src/runtime/generated/sid/sid.wasm', import.meta.url));
const peak = samples => samples.reduce((maximum, sample) => Math.max(maximum, Math.abs(sample)), 0);
async function setup(t) {
  const core = await SidCore.create({wasmBinary}), synth = new SidSynth({core});
  t.after(() => { synth.dispose(); core.dispose(); }); return {core, synth};
}

test('SID defaults are silent, helpers address three physical voices, and borrowed cores remain caller-owned', async t => {
  const {core, synth} = await setup(t);
  assert.throws(() => synth.noteOn(0, 'A4'), /initialize/);
  synth.initialize(); const initial = synth._getState();
  assert.equal(initial.model, '6581'); assert.equal(initial.clock, SID_PAL_CLOCK);
  assert.equal(initial.initialized, true); assert.equal(initial.filter.volume, 8);
  assert(initial.channels.every(voice => !voice.gate && voice.waveform === 'saw' && voice.pulseWidth === 2048));
  assert.equal(peak(core.render(256)), 0);
  const quantized = synth.setFrequency(2, 440); assert(Math.abs(quantized - 440) < 0.04);
  synth.noteOn(2, 'A4'); assert(peak(core.render(4096)) > 0.01);
  assert.deepEqual(synth._getState().channels.map(voice => voice.gate), [false, false, true]);
  synth.noteOff(2); assert.equal(synth._getState().channels[2].gate, false);
  synth.dispose(); assert.throws(() => synth.keyOn(0), /disposed/);
  assert.doesNotThrow(() => core.render(128), 'disposing a borrowed synth must not destroy its core');
});

test('SID voice/filter patches validate atomically and preserve unrelated bits and held Gates', async t => {
  const {core, synth} = await setup(t); synth.initialize(); synth.noteOn(0, 'C4');
  for (const [method, args] of [['setVoice', [0, {attack: 15, pulseWidth: 4096}]], ['setVoice', [0, {ring: true, other: 1}]],
    ['setFilter', [{volume: 15, cutoff: -1}]], ['setFilter', [{mode: 'lowpass', voice3off: 1}]],
    ['setFilter', [{volume: 15, mode: 'lowpass+noise'}]], ['noteOn', [0, 127]]]) {
    const before = synth._getState(), cycles = core.getState().cycles;
    assert.throws(() => synth[method](...args)); assert.deepEqual(synth._getState(), before); assert.equal(core.getState().cycles, cycles);
  }
  synth.setVoice(0, {waveform: 'pulse', pulseWidth: 1234, attack: 3, sync: true, ring: true});
  const voice = synth._getState().channels[0]; assert.equal(voice.gate, true); assert.equal(voice.decay, 6); assert.equal(voice.attack, 3);
  assert.equal(voice.pulseWidth, 1234); assert.equal(voice.waveform, 'pulse'); assert(voice.sync && voice.ring);
  synth.writeRegister(23, 8); synth.setFilter({mode: 'notch', cutoff: 1511, resonance: 9, routing: 5, volume: 12, voice3off: true});
  const filter = synth._getState().filter;
  assert.deepEqual(filter, {mode: 'notch', modeBits: 5, cutoff: 1511, resonance: 9, routing: 5, volume: 12, voice3off: true});
  assert.equal(synth.getRegisterSnapshot()[23] & 8, 8, 'the unexposed external-routing bit stays unchanged');
  assert.throws(() => synth.setFrequency(0, 0.00001), /representable/);
  await assert.rejects(synth.setClock(1022727), /new SID instance/); assert.equal(await synth.setClock(SID_PAL_CLOCK), true);
});

test('SID applied shadow represents raw waveform/filter combinations and exposes independent state copies', async t => {
  const {synth} = await setup(t); synth.initialize(); synth.writeRegister(4, 0x71); synth.writeRegister(24, 0xff);
  const state = synth._getState(); assert.equal(state.channels[0].waveform, 'combined');
  assert.deepEqual(state.channels[0].waveforms, ['triangle', 'saw', 'pulse']); assert.equal(state.channels[0].waveformBits, 7);
  assert.equal(state.filter.mode, 'lowpass+bandpass+highpass'); assert.equal(state.filter.modeBits, 7);
  state.channels[0].waveforms.length = 0; state.registers[4] = 0; state.filter.volume = 0;
  assert.equal(synth._getState().registers[4], 0x71); assert.equal(synth._getState().filter.volume, 15);
});

test('all SID filter output combinations match raw mode writes and retain shared settings and Gates', async t => {
  const modes = ['off', 'lowpass', 'bandpass', 'lowpass+bandpass', 'highpass', 'notch',
    'bandpass+highpass', 'lowpass+bandpass+highpass'];
  for (const [bits, mode] of modes.entries()) {
    const authoring = await setup(t), raw = await setup(t);
    for (const {synth} of [authoring, raw]) {
      synth.initialize(); synth.setFilter({cutoff: 699, resonance: 9, routing: 5, volume: 11, voice3off: true});
      synth.noteOn(0, 'C4'); synth.noteOn(2, 'G4');
    }
    authoring.synth.setFilter({mode}); raw.synth.writeRegister(24, 0x8b | (bits << 4));
    const state = authoring.synth._getState();
    assert.deepEqual(state.filter, {mode, modeBits: bits, cutoff: 699, resonance: 9, routing: 5, volume: 11, voice3off: true});
    assert.equal(state.registers[24], 0x8b | (bits << 4));
    assert.deepEqual(state.channels.map(voice => voice.gate), [true, false, true]);
    const pcm = authoring.core.render(4096);
    assert(pcm.every(Number.isFinite)); assert.deepEqual(pcm, raw.core.render(4096), mode);
    assert.equal(authoring.core.getState().cycles, raw.core.getState().cycles);
  }
});

test('SID adoption never replays writes and a blocked owner hook does not mutate local state', () => {
  const calls = [], synth = new SidSynth({transport: {writeRegister: (...args) => calls.push(args), reset() {}}});
  synth.initialize(); const state = synth._getState(), count = calls.length;
  state.registers[4] |= 1; synth._adoptState(state); assert.equal(calls.length, count); assert(synth._getState().channels[0].gate);
  for (const invalid of [{...state, clock: 1022727}, {...state, model: '8580'}, {...state, registers: [...state.registers.slice(0, 31), 256]}]) {
    assert.throws(() => synth._adoptState(invalid)); assert.equal(synth._getState().registers[4], state.registers[4]);
  }
  const observed = []; synth._observe = event => observed.push(event); synth._beforeWrite = register => register !== 4;
  synth.keyOff(0); assert(synth._getState().channels[0].gate); assert.equal(calls.length, count);
  synth.setFrequency(1, 220); assert.equal(observed.length, 2); assert(observed.every(event => event.channel === 1));
  synth.dispose();
});

test('SID filter changes actual WASM output while inspector reads neither clock nor mutate it', async t => {
  const dry = await setup(t), wet = await setup(t);
  for (const {synth} of [dry, wet]) { synth.initialize(); synth.noteOn(0, 'C4'); synth.noteOn(1, 'E4'); synth.noteOn(2, 'G4'); }
  wet.synth.setFilter({mode: 'lowpass', cutoff: 400, resonance: 12, routing: 7});
  const a = dry.core.render(4096), b = wet.core.render(4096);
  assert(peak(a) > .01 && peak(b) > .001); assert(a.some((value, index) => Math.abs(value - b[index]) > .01));
  const inspector = new SidVoiceInspector({synth: wet.synth, sampleRate: 48000}), before = wet.core.getState().cycles;
  const messages = [], port = {postMessage: message => messages.push(message)};
  for (let i = 0; i < 5; ++i) assert(receiveSidInspector({type: 'chip-inspector', action: 'read', id: i}, port, inspector));
  assert.equal(wet.core.getState().cycles, before); assert(messages.every(message => message.value.kind === 'sid' && message.value.readOnly));
  receiveSidInspector({type: 'chip-inspector', action: 'invoke', method: 'auditionOn', id: 6}, port, inspector);
  assert.match(messages.at(-1).error, /read-only/); assert.equal(wet.core.getState().cycles, before);
});

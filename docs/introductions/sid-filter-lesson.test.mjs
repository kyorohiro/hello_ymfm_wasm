import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {SidCore, SID_PAL_CLOCK} from '../js/sid.js';
import {SidSynth} from '../js/sidsynth.js';
import {SID_FILTER_DEFAULTS, SID_FILTER_VOICE, SID_FILTER_NOTES, SID_FILTER_OUTPUT_GAIN,
  readSidFilterSettings, sidFilterConfiguration, initializeSidFilterLesson,
  applySidFilterLesson, setSidFilterChord, stopSidFilterLesson,
  sidFilterLessonCode} from './sid-filter-lesson.js';

const wasmBinary = await readFile(new URL('../generated/sid/sid.wasm', import.meta.url));
const rms = pcm => Math.sqrt(pcm.reduce((sum, sample) => sum + sample * sample, 0) / pcm.length);
const peak = pcm => pcm.reduce((maximum, sample) => Math.max(maximum, Math.abs(sample)), 0);
async function engine(t, sampleRate = 48000) {
  const core = await SidCore.create({wasmBinary, sampleRate, clockHz: SID_PAL_CLOCK});
  const sid = new SidSynth({core});
  t.after(() => {sid.dispose(); core.dispose();});
  return {core, sid};
}
async function measured(t, value, sampleRate = 48000) {
  const current = await engine(t, sampleRate);
  await initializeSidFilterLesson(current.sid, value);
  current.core.render(sampleRate / 5);
  return {...current, pcm: current.core.render(sampleRate * 2 / 5)};
}

test('settings validate before touching a client and Bypass keeps requested sends without routing into mode off', async () => {
  assert.deepEqual(readSidFilterSettings(), SID_FILTER_DEFAULTS);
  for (const routing of [0, 1, 2, 3, 4, 5, 6, 7]) {
    assert.equal(readSidFilterSettings({routing}).routing, routing);
    assert.equal(sidFilterConfiguration({mode: 'bypass', routing}).routing, 0);
    assert.equal(sidFilterConfiguration({mode: 'lowpass', routing}).routing, routing);
  }
  assert.deepEqual(sidFilterConfiguration(), {mode:'off', cutoff:500, resonance:5, routing:0, volume:8, voice3off:false});
  assert.deepEqual(sidFilterConfiguration({cutoff:2047, resonance:15, mode:'highpass', routing:4}),
    {mode:'highpass', cutoff:2047, resonance:15, routing:4, volume:8, voice3off:false});
  const calls = [], sid = {initialize() {calls.push('initialize');}, setFilter() {calls.push('filter');}};
  for (const value of [null, [], {mode:'notch'}, {cutoff:-1}, {cutoff:2048}, {cutoff:1.5},
    {resonance:16}, {routing:8}, {routing:NaN}, {chord:1}, {constructor:1}, {volume:15}]) {
    await assert.rejects(initializeSidFilterLesson(sid, value));
    await assert.rejects(applySidFilterLesson(sid, value));
  }
  assert.deepEqual(calls, []);
});

test('the recipe awaits asynchronous setters and fully specifies voices, filter and notes before Gate', async () => {
  const calls = [], record = name => async (...args) => {await Promise.resolve(); calls.push([name, ...args]);};
  const sid = Object.fromEntries(['initialize','setVoice','setNote','setFilter','keyOn','keyOff','allNotesOff','reset'].map(name => [name, record(name)]));
  await initializeSidFilterLesson(sid, {chord:true});
  assert.equal(calls[0][0], 'initialize');
  for (let ch = 0; ch < 3; ch++) {
    assert.deepEqual(calls[1 + ch * 2], ['setVoice', ch, SID_FILTER_VOICE]);
    assert.deepEqual(calls[2 + ch * 2], ['setNote', ch, SID_FILTER_NOTES[ch]]);
  }
  assert.deepEqual(calls.slice(7), [['setFilter', sidFilterConfiguration()], ['keyOn',0], ['keyOn',1], ['keyOn',2]]);
  calls.length = 0;
  await applySidFilterLesson(sid, {mode:'bandpass', routing:5});
  assert.deepEqual(calls, [['setFilter', sidFilterConfiguration({mode:'bandpass', routing:5})]]);
  calls.length = 0; await setSidFilterChord(sid, false);
  assert.deepEqual(calls, [['keyOff',1], ['keyOff',2]], 'CH1 is never retriggered by the Chord control');
  calls.length = 0; await stopSidFilterLesson(sid);
  assert.deepEqual(calls, [['allNotesOff'], ['reset']]);
});

for (const sampleRate of [44100, 48000]) test(`real 6581 at ${sampleRate} Hz: all four comparisons are finite, audible numerically and share a fixed output gain`, async t => {
  const results = [];
  for (const mode of ['bypass','lowpass','bandpass','highpass']) {
    const result = await measured(t, {mode}, sampleRate);
    assert(result.pcm.every(Number.isFinite));
    assert(rms(result.pcm) > 0.0001, `${mode} must not be accidentally routed into silence`);
    assert(peak(result.pcm) * SID_FILTER_OUTPUT_GAIN < 1, 'the common host headroom is not mode normalization');
    assert.equal(result.sid._getState().channels[0].frequencyRegister, results[0]?.sid._getState().channels[0].frequencyRegister ?? result.sid._getState().channels[0].frequencyRegister);
    results.push(result);
  }
  for (let i = 0; i < results.length; i++) for (let j = i + 1; j < results.length; j++) {
    assert.notDeepEqual(results[i].pcm, results[j].pcm, 'different filter outputs must alter the same original tone');
  }
});

test('live Cutoff/Resonance/mode/routing edits write only four shared registers; held Gates, pitch and envelope remain', async t => {
  const {core, sid} = await engine(t);
  await initializeSidFilterLesson(sid, {chord:true}); core.render(12000);
  const writes = []; sid._observe = command => writes.push(command.args[0]);
  for (const mode of ['lowpass','bandpass','highpass','bypass']) {
    const before = sid._getState(), cycles = core.getState().cycles;
    await applySidFilterLesson(sid, {mode, cutoff:917, resonance:13, routing:5, chord:true});
    const after = sid._getState();
    assert.deepEqual(after.registers.slice(0,21), before.registers.slice(0,21));
    assert(after.channels.every(ch => ch.gate && ch.envelope > 0));
    assert.equal(core.getState().cycles, cycles + 4, 'only register accesses advance clocks; no reset or key edge');
    assert.deepEqual(writes.splice(0), [21,22,23,24]);
    core.render(256);
  }
});

test('starting with an inherited SID clears old Gates, noise/Sync/Ring/TEST and filter history before the original patch', async t => {
  const dirty = await engine(t), fresh = await engine(t);
  dirty.sid.initialize();
  for (let ch = 0; ch < 3; ch++) {
    dirty.sid.setVoice(ch, {waveform:'noise', pulseWidth:99, attack:15, decay:14, sustain:15, release:15, sync:true, ring:true, test:true});
    dirty.sid.noteOn(ch, 'B5');
  }
  dirty.sid.setFilter({mode:'highpass',cutoff:2047,resonance:15,routing:7,volume:15,voice3off:true});
  dirty.core.render(10000);
  await initializeSidFilterLesson(dirty.sid);
  await initializeSidFilterLesson(fresh.sid);
  assert.deepEqual(dirty.sid._getState().channels.map(ch => ch.gate), [true,false,false]);
  assert(dirty.sid._getState().channels.every(ch => ch.waveform === 'saw' && !ch.sync && !ch.ring && !ch.test));
  assert.deepEqual(dirty.sid._getState().registers, fresh.sid._getState().registers);
  assert.deepEqual(dirty.core.render(20000), fresh.core.render(20000), 'initialize resets native envelopes, phases and old filter/DC history as well as its authoring shadow');
});

test('each lesson filter mode matches independently written hardware register bytes', async t => {
  for (const [mode, bits] of [['bypass',0], ['lowpass',1], ['bandpass',2], ['highpass',4]]) {
    const left = await engine(t), right = await engine(t);
    await initializeSidFilterLesson(left.sid, {chord:true});
    await initializeSidFilterLesson(right.sid, {chord:true});
    left.core.render(5000); right.core.render(5000);
    await applySidFilterLesson(left.sid, {mode, cutoff:739, resonance:6, routing:5, chord:true});
    right.sid.writeRegister(21, 739 & 7);
    right.sid.writeRegister(22, 739 >> 3);
    right.sid.writeRegister(23, (6 << 4) | (mode === 'bypass' ? 0 : 5));
    right.sid.writeRegister(24, (bits << 4) | 8);
    assert.deepEqual(left.core.render(8192), right.core.render(8192), mode);
  }
});

test('unrouted voices remain dry, including CH3; the raw mode-off plus routed-voice counterexample is silent', async t => {
  const bypass = await measured(t, {chord:true}), noSends = await measured(t, {chord:true,mode:'lowpass',routing:0});
  assert.deepEqual(bypass.pcm, noSends.pcm, 'unchecked sends route all three voices to the dry output, not a mute');
  const {core, sid} = await engine(t);
  await initializeSidFilterLesson(sid, {mode:'lowpass',routing:1});
  await sid.keyOff(0); await sid.keyOn(2); core.render(24000);
  assert.equal(sid._getState().filter.voice3off, false);
  assert(rms(core.render(12000)) > 0.001, 'CH3 is audible dry while the silent CH1 is routed');
  const silent = await engine(t);
  await initializeSidFilterLesson(silent.sid);
  silent.sid.setFilter({mode:'off',routing:1}); silent.core.render(12000);
  assert.equal(peak(silent.core.render(8192)), 0, 'hardware mode off with CH1 routed really is silent; UI Bypass must use routing 0');
});

test('Cutoff changes harmonic distribution without per-mode normalization; Resonance alters the same signal', async t => {
  const low = await measured(t, {mode:'lowpass',cutoff:80});
  const open = await measured(t, {mode:'lowpass',cutoff:1400});
  function upperHarmonicRatio({pcm,sid}) {
    const hz = sid._getState().channels[0].frequency;
    let lower = 0, upper = 0;
    for (let harmonic = 1; harmonic <= 32; harmonic++) {
      let real = 0, imag = 0;
      for (let i = 0; i < pcm.length; i++) {
        const window = .5 - .5 * Math.cos(2 * Math.PI * i / (pcm.length - 1));
        const angle = 2 * Math.PI * hz * harmonic * i / 48000;
        real += pcm[i] * window * Math.cos(angle); imag += pcm[i] * window * Math.sin(angle);
      }
      const power = real * real + imag * imag;
      if (harmonic <= 4) lower += power;
      if (harmonic >= 12) upper += power;
    }
    return upper / lower;
  }
  assert(upperHarmonicRatio(open) > 10 * upperHarmonicRatio(low), 'this specific Saw comparison exposes more upper harmonics; no Hz-to-code mapping or monotonic loudness is assumed');
  const plain = await measured(t, {mode:'lowpass',resonance:0});
  const resonant = await measured(t, {mode:'lowpass',resonance:15});
  assert.notDeepEqual(plain.pcm, resonant.pcm);
  assert(resonant.pcm.every(Number.isFinite));
});

test('Stop discards release/filter/DC tails; it is different from an ordinary musical Gate release', async t => {
  const {core,sid} = await engine(t);
  await initializeSidFilterLesson(sid, {chord:true,mode:'lowpass',resonance:15}); core.render(10000);
  sid.allNotesOff(); assert(peak(core.render(256)) > 0);
  await stopSidFilterLesson(sid);
  assert.equal(sid._getState().initialized, false);
  assert.equal(peak(core.render(4096)), 0);
});

test('the readable Playground example executes the displayed configuration and disposes on success or a failed wait', async () => {
  const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
  for (const fail of [false, true]) {
    const calls = [], record = method => async (...args) => calls.push([method,...args]);
    const sid = Object.fromEntries(['initialize','setVoice','setNote','setFilter','keyOn','allNotesOff','dispose'].map(method => [method, record(method)]));
    const code = sidFilterLessonCode({mode:'bandpass',cutoff:917,resonance:3,routing:5,chord:true});
    const execute = new AsyncFunction('useSoundChip','sleep',code);
    const result = execute(async name => {assert.equal(name,'sid'); return sid;}, async seconds => {
      calls.push(['sleep',seconds]); if (fail) throw new Error('Run stopped');
    });
    if (fail) await assert.rejects(result,/Run stopped/); else await result;
    assert.deepEqual(calls.find(call => call[0] === 'setFilter'), ['setFilter',sidFilterConfiguration({mode:'bandpass',cutoff:917,resonance:3,routing:5})]);
    assert.deepEqual(calls.filter(call => call[0] === 'keyOn'), [['keyOn',0],['keyOn',1],['keyOn',2]]);
    assert.equal(calls.at(-1)[0], 'dispose');
    assert(!code.includes('setInterval'), 'the recipe does not synthesize hardware audio with host timers');
  }
});

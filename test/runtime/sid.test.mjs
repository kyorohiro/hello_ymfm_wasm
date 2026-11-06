import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {SidCore, sidFrequency, SID_PAL_CLOCK, SID_NTSC_CLOCK} from '../../tetorica_src/runtime/sid.js';
import {SidTestInstrument, defaultSidSettings, validateSidSettings} from '../../tetorica_src/runtime/sid_test_instrument.js';

const wasmBinary = await readFile(new URL('../../tetorica_src/runtime/generated/sid/sid.wasm', import.meta.url));
const make = options => SidCore.create({wasmBinary, ...options});
const rms = values => Math.sqrt(values.reduce((sum, value) => sum + value * value, 0) / values.length);
const distance = (a, b) => rms(a.map((value, index) => value - b[index]));
async function pcm(settings, action = 'playTone') {
  const core = await make();
  try { const instrument = new SidTestInstrument(core, settings); instrument[action](); core.render(12000); return instrument.renderInto(new Float32Array(12000)); }
  finally { core.dispose(); }
}

test('SID rational clock renders one exact second at each supported comparison rate', async () => {
  for (const sampleRate of [44100, 48000, 96000]) for (const clockHz of [SID_PAL_CLOCK, SID_NTSC_CLOCK]) {
    const core = await make({sampleRate, clockHz});
    try { assert(core.render(sampleRate).every(value => value === 0)); assert.equal(core.getState().cycles, clockHz); }
    finally { core.dispose(); }
  }
});

test('SID four hardware waveforms produce distinct, finite, bounded PCM', async () => {
  const waveforms = [];
  for (const waveform of ['triangle', 'saw', 'pulse', 'noise']) {
    const output = await pcm({waveform});
    assert(output.every(Number.isFinite)); assert(rms(output) > 0.003, waveform);
    assert(output.every(value => Math.abs(value) < 1), waveform); waveforms.push(output);
  }
  for (let a = 0; a < waveforms.length; a++) for (let b = a + 1; b < waveforms.length; b++) assert(distance(waveforms[a], waveforms[b]) > 0.005);
});

test('SID frequency register follows PAL/NTSC clocks and the output is approximately 220 Hz', async () => {
  assert.notEqual(sidFrequency(220, SID_PAL_CLOCK), sidFrequency(220, SID_NTSC_CLOCK));
  for (const clockHz of [SID_PAL_CLOCK, SID_NTSC_CLOCK]) {
    const core = await make({clockHz});
    try {
      const instrument = new SidTestInstrument(core, {waveform: 'triangle', attack: 0, sustain: 15, clockHz});
      instrument.playTone(220); core.render(24000);
      const output = core.render(48000), edges = [];
      for (let i = 1; i < output.length; i++) if (output[i - 1] < 0 && output[i] >= 0) edges.push(i);
      const hz = 48000 * (edges.length - 1) / (edges.at(-1) - edges[0]);
      assert(Math.abs(hz - 220) < 0.1, `Measured ${hz} Hz`);
    } finally { core.dispose(); }
  }
});

test('SID render splitting preserves filter, envelope and oscillator state exactly', async () => {
  const a = await make(), b = await make();
  try {
    const settings = {filterMode: 'lowpass', cutoff: 500, resonance: 12};
    const ia = new SidTestInstrument(a, settings), ib = new SidTestInstrument(b, settings);
    ia.playChord(); ib.playChord(); const expected = a.render(5000), actual = new Float32Array(5000);
    for (let at = 0; at < actual.length;) { const count = Math.min(actual.length - at, at % 23 + 1); b.renderInto(actual.subarray(at, at + count)); at += count; }
    assert.deepEqual(actual, expected); assert.deepEqual(a.getState(), b.getState());
  } finally { a.dispose(); b.dispose(); }
});

test('SID samples generated during register accesses are preserved', async () => {
  const a = await make(), b = await make();
  try {
    new SidTestInstrument(a).playTone(); new SidTestInstrument(b).playTone();
    for (let i = 0; i < 2000; i++) a.writeRegister(31, i & 255);
    assert.deepEqual(a.render(2000), b.render(2000));
    assert.equal(a.getState().cycles, b.getState().cycles);
  } finally { a.dispose(); b.dispose(); }
});

test('SID pulse width and shared filter modes/cutoff/resonance affect actual PCM', async () => {
  assert(distance(await pcm({waveform: 'pulse', pulseWidth: 512}), await pcm({waveform: 'pulse', pulseWidth: 2048})) > 0.02);
  const dry = await pcm({}), low = await pcm({filterMode: 'lowpass', cutoff: 20});
  assert(rms(low) < rms(dry) * 0.5, 'Low cutoff reduces a saw tone');
  assert(distance(low, await pcm({filterMode: 'lowpass', cutoff: 1800})) > 0.01);
  assert(distance(await pcm({filterMode: 'bandpass', cutoff: 600}), await pcm({filterMode: 'highpass', cutoff: 600})) > 0.01);
  assert(distance(await pcm({filterMode: 'lowpass', cutoff: 600, resonance: 0}), await pcm({filterMode: 'lowpass', cutoff: 600, resonance: 15})) > 0.003);
});

test('SID gate release decays and immediate Stop/reset produces exact silence', async () => {
  const core = await make();
  try {
    const instrument = new SidTestInstrument(core, {attack: 0, sustain: 15, release: 0});
    instrument.playChord(); assert(rms(core.render(6000)) > 0.01);
    instrument.release(); assert.equal(core.getState().registers[4] & 1, 0);
    core.render(48000); assert(rms(core.render(2000)) < 1e-6);
    instrument.playTone(); assert(rms(core.render(6000)) > 0.01);
    instrument.stop(); assert(core.render(3000).every(value => value === 0));
    assert(core.getState().voices.every(voice => voice.envelope === 0));
  } finally { core.dispose(); }
});

test('SID hardware ENV3 read is distinct from the register shadow', async () => {
  const core = await make();
  try {
    new SidTestInstrument(core, {attack: 0, sustain: 15}).playChord(); core.render(6000);
    assert.equal(core.getState().registers[28], 0); assert.equal(core.readRegister(28), 255);
    const before = core.getState().cycles; core.readRegister(27); assert.equal(core.getState().cycles, before + 1);
  } finally { core.dispose(); }
});

test('SID Ring / Sync use a silent third oscillator and distinct carrier output', async () => {
  const dry = await pcm({waveform: 'triangle'});
  for (const option of ['ring', 'sync']) {
    const settings = {waveform: 'triangle', modulatorHz: 147, [option]: true};
    assert(distance(dry, await pcm(settings)) > 0.01, option);
    const core = await make();
    try {
      const instrument = new SidTestInstrument(core, settings); instrument.playTone(); core.render(5000);
      const regs = core.getState().registers;
      assert(regs[24] & 0x80); assert(regs[18] & 1); assert(regs[4] & (option === 'sync' ? 2 : 4));
      assert.throws(() => instrument.playChord(), /modulator/);
    } finally { core.dispose(); }
  }
});

test('SID live parameter edits preserve gate and invalid edits preserve current sound', async () => {
  const core = await make();
  try {
    const instrument = new SidTestInstrument(core); instrument.playTone(); core.render(2000);
    instrument.setSettings({cutoff: 500, filterMode: 'lowpass'});
    assert(core.getState().registers[4] & 1);
    const previous = core.getState(), settings = {...instrument.settings};
    assert.throws(() => instrument.setSettings({cutoff: 9999}), /cutoff/);
    assert.deepEqual(core.getState(), previous); assert.deepEqual(instrument.settings, settings);
    instrument.setSettings({ring: true}); assert(core.getState().registers[4] & 1);
  } finally { core.dispose(); }
});

test('SID rejects unsupported inputs and guards disposed instances', async () => {
  await assert.rejects(make({sampleRate: 1}), /sampleRate/);
  assert.throws(() => validateSidSettings({waveform: 'toString'}), /waveform/);
  assert.throws(() => validateSidSettings({model: '8580'}), /Unknown/);
  assert.throws(() => validateSidSettings({sync: 1}), /boolean/);
  assert.throws(() => sidFrequency(100000), /register/);
  const core = await make();
  assert.throws(() => core.writeRegister(32, 0), /register/);
  assert.throws(() => core.writeRegister(0, NaN), /value/);
  assert.throws(() => core.renderInto(new Float64Array(1)), /Float32Array/);
  core.dispose(); core.dispose(); assert.throws(() => core.render(1), /disposed/);
});

test('SID written register shadow is an isolated snapshot', async () => {
  const core = await make();
  try { core.writeRegister(0, 34); const snapshot = core.getState(); snapshot.registers[0] = 99; assert.equal(core.getState().registers[0], 34); }
  finally { core.dispose(); }
});

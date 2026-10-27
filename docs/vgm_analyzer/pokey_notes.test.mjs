import test from 'node:test';
import assert from 'node:assert/strict';
import {createPokeyMonitor, applyPokeyWrite, describePokeyNotes} from './pokey_notes.js';
import {PokeySynth} from '../../web/pokeysynth.js';

test('POKEY reset shadow matches the pinned core, with independent physical chips', () => {
  const state = createPokeyMonitor({pokeyClock: 1789773 | 0x40000000});
  assert.equal(state.clock, 1789773);
  assert.equal(state.chips.length, 2);
  assert.notEqual(state.chips[0].registers, state.chips[1].registers);
  const notes = describePokeyNotes(state);
  assert.equal(notes.length, 8);
  assert.deepEqual(notes.map(ch => ch.name), ['POKEY 1 CH1', 'POKEY 1 CH2', 'POKEY 1 CH3', 'POKEY 1 CH4', 'POKEY 2 CH1', 'POKEY 2 CH2', 'POKEY 2 CH3', 'POKEY 2 CH4']);
  assert.ok(notes.every(ch => ch.audc === 0xb0 && ch.skctl === 3 && ch.volume === 0 && ch.midi === null));
  assert.equal(applyPokeyWrite(state, 1, 0xa9, 1), true);
  assert.equal(describePokeyNotes(state)[4].volume, 9);
  assert.equal(describePokeyNotes(state)[0].volume, 0);
  applyPokeyWrite(state, 9, 0, 1);
  assert.equal(state.chips[1].stimerCount, 1);
  assert.equal(state.chips[0].stimerCount, 0);
  for (const args of [[16, 1, 0], [-1, 1, 0], [1, 256, 0], [1, 1, 2], [1, 1, -1]]) {
    const before = state.chips.map(ch => Array.from(ch.registers));
    assert.equal(applyPokeyWrite(state, ...args), false);
    assert.deepEqual(state.chips.map(ch => Array.from(ch.registers)), before);
  }
});

for (const high of [false, true]) for (const joined of [false, true]) for (const base of ['64khz', '15khz']) {
  test(`POKEY displayed timer agrees with Synth (${base}, high ${high}, joined ${joined})`, () => {
    const state = createPokeyMonitor({pokeyClock: 1789790});
    const transport = {clock: state.clock, reset() {}, writeRegister(r, v) {applyPokeyWrite(state, r, v);}};
    const synth = new PokeySynth({transport});
    synth.initialize(); synth.setBaseClock(base);
    for (const lower of [0, 2]) {
      synth.setJoined(lower / 2, joined); synth.setHighClock(lower, high);
      const channel = joined ? lower + 1 : lower;
      // An unjoined master-clock timer has a much higher minimum pitch.
      const frequency = synth.setFrequency(channel, joined ? 440 : high ? 8000 : 880);
      synth.keyOn(channel);
      const note = describePokeyNotes(state)[channel];
      assert.equal(note.frequency, frequency);
      assert.equal(note.divisor, high ? 1 : base === '15khz' ? 114 : 28);
      assert.equal(note.offset, high ? joined ? 7 : 4 : 1);
      assert.equal(note.joined, joined);
      if (joined) {
        const helper = describePokeyNotes(state)[lower];
        assert.equal(helper.helper, true);
        assert.equal(helper.midi, null);
      }
    }
  });
}

test('noise polynomials, Poly5 gate, and volume-only DAC never acquire a false pitch', () => {
  const state = createPokeyMonitor({pokeyClock: 1789790});
  for (const poly9 of [false, true]) {
    applyPokeyWrite(state, 8, poly9 ? 128 : 0);
    for (let distortion = 0; distortion < 8; distortion++) {
      applyPokeyWrite(state, 1, (distortion << 5) | 12);
      const ch = describePokeyNotes(state)[0];
      assert.equal(ch.volume, 12);
      assert.equal(ch.distortion, distortion);
      assert.equal(ch.midi !== null, distortion === 5 || distortion === 7);
      if (distortion === 0 || distortion === 4) assert.match(ch.type, new RegExp(poly9 ? 'Poly9' : 'Poly17'));
      if (distortion === 2 || distortion === 6) assert.match(ch.type, /Poly4/);
      if (distortion === 1 || distortion === 3) assert.equal(ch.type, 'Poly5-gated tone');
      applyPokeyWrite(state, 1, (distortion << 5) | 16 | 12);
      assert.equal(describePokeyNotes(state)[0].type, 'Volume-only DAC');
      assert.equal(describePokeyNotes(state)[0].midi, null);
    }
  }
});

test('high-pass, helper, SKCTL stop/two-tone/serial modes suppress inferred notes', () => {
  const state = createPokeyMonitor({pokeyClock: 1789790});
  for (let channel = 0; channel < 4; channel++) applyPokeyWrite(state, channel * 2 + 1, 0xa8);
  applyPokeyWrite(state, 8, 6);
  let channels = describePokeyNotes(state);
  assert.equal(channels[0].type, 'High-pass filtered');
  assert.equal(channels[1].type, 'High-pass filtered');
  assert.equal(channels[2].filterClockFor, 0);
  assert.equal(channels[3].filterClockFor, 1);
  assert.ok(channels.slice(0, 2).every(ch => ch.midi === null));
  assert.ok(channels.slice(2).every(ch => ch.midi !== null));
  applyPokeyWrite(state, 8, 24);
  channels = describePokeyNotes(state);
  assert.ok([channels[0], channels[2]].every(ch => ch.helper && ch.midi === null));
  assert.ok([channels[1], channels[3]].every(ch => ch.joined && ch.midi !== null));
  applyPokeyWrite(state, 8, 0);
  applyPokeyWrite(state, 15, 0);
  assert.ok(describePokeyNotes(state).every(ch => ch.reason === 'Timers stopped' && ch.midi === null));
  applyPokeyWrite(state, 15, 11);
  channels = describePokeyNotes(state);
  assert.ok(channels.slice(0, 2).every(ch => ch.type === 'Two-tone' && ch.midi === null));
  assert.ok(channels.slice(2).every(ch => ch.midi !== null));
  applyPokeyWrite(state, 15, 0x13);
  assert.ok(describePokeyNotes(state).every(ch => ch.type === 'Serial clock mode' && ch.midi === null));
});

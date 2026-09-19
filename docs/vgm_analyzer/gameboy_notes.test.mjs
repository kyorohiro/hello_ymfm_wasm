import test from 'node:test';
import assert from 'node:assert/strict';
import { createGameboyMonitor, applyGameboyWrite, describeGameboyNotes } from './gameboy_notes.js';

function triggerSquare(state, ch, freq, { volume = 15, direction = 0 } = {}) {
  const envelopeReg = ch === 0 ? 0x02 : 0x07;
  applyGameboyWrite(state, envelopeReg, (volume << 4) | (direction << 3));
  const freqLo = ch === 0 ? 0x03 : 0x08, freqHi = ch === 0 ? 0x04 : 0x09;
  applyGameboyWrite(state, freqLo, freq & 0xff);
  applyGameboyWrite(state, freqHi, 0x80 | ((freq >> 8) & 7));
}

test('square channels report the documented Hz = 131072/(2048-x) formula as MIDI', () => {
  const state = createGameboyMonitor();
  triggerSquare(state, 0, 1750);
  const [ch1] = describeGameboyNotes(state);
  assert.equal(ch1.keyOn, true);
  const expectedHz = 131072 / (2048 - 1750);
  const expectedMidi = 69 + 12 * Math.log2(expectedHz / 440);
  assert(Math.abs(ch1.midi - expectedMidi) < 1e-9);
});

test('wave channel (NR30 DAC bit) uses Hz = 65536/(2048-x)', () => {
  const state = createGameboyMonitor();
  applyGameboyWrite(state, 0x0a, 0x80); // NR30 DAC on
  applyGameboyWrite(state, 0x0d, 1948 & 0xff);
  applyGameboyWrite(state, 0x0e, 0x80 | ((1948 >> 8) & 7));
  const [, , wave] = describeGameboyNotes(state);
  assert.equal(wave.keyOn, true);
  const expectedHz = 65536 / (2048 - 1948);
  const expectedMidi = 69 + 12 * Math.log2(expectedHz / 440);
  assert(Math.abs(wave.midi - expectedMidi) < 1e-9);
});

test('DAC-disabled envelope prevents and clears key-on', () => {
  const state = createGameboyMonitor();
  // Volume 0, direction decrease -> DAC disabled: trigger must not turn it on.
  applyGameboyWrite(state, 0x02, 0x00);
  applyGameboyWrite(state, 0x03, 100);
  applyGameboyWrite(state, 0x04, 0x80);
  assert.equal(describeGameboyNotes(state)[0].keyOn, false);
  // Now enable the DAC and trigger for real, then disable it again mid-note.
  applyGameboyWrite(state, 0x02, 0xf0);
  applyGameboyWrite(state, 0x04, 0x80);
  assert.equal(describeGameboyNotes(state)[0].keyOn, true);
  applyGameboyWrite(state, 0x02, 0x00);
  assert.equal(describeGameboyNotes(state)[0].keyOn, false);
});

test('NR30 DAC off clears wave channel key-on independent of square channels', () => {
  const state = createGameboyMonitor();
  triggerSquare(state, 0, 1750);
  applyGameboyWrite(state, 0x0a, 0x80);
  applyGameboyWrite(state, 0x0d, 1900 & 0xff);
  applyGameboyWrite(state, 0x0e, 0x80 | ((1900 >> 8) & 7));
  assert.deepEqual(describeGameboyNotes(state).map(c => c.keyOn), [true, false, true]);
  applyGameboyWrite(state, 0x0a, 0x00);
  assert.deepEqual(describeGameboyNotes(state).map(c => c.keyOn), [true, false, false]);
});

test('NR52 power off silences all three tracked channels', () => {
  const state = createGameboyMonitor();
  triggerSquare(state, 0, 1750);
  triggerSquare(state, 1, 900);
  applyGameboyWrite(state, 0x0a, 0x80);
  applyGameboyWrite(state, 0x0e, 0x80);
  assert.deepEqual(describeGameboyNotes(state).map(c => c.keyOn), [true, true, true]);
  applyGameboyWrite(state, 0x16, 0x00);
  assert.deepEqual(describeGameboyNotes(state).map(c => c.keyOn), [false, false, false]);
});

test('applyGameboyWrite returns false for unrelated registers (e.g. NR51/NR50) and channels are independent', () => {
  const state = createGameboyMonitor();
  assert.equal(applyGameboyWrite(state, 0x15, 0x11), false);
  assert.equal(applyGameboyWrite(state, 0x14, 0x77), false);
  triggerSquare(state, 0, 1750);
  triggerSquare(state, 1, 900);
  const [ch1, ch2] = describeGameboyNotes(state);
  assert.notEqual(ch1.midi, ch2.midi);
});

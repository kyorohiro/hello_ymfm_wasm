import test from 'node:test';
import assert from 'node:assert/strict';
import { createGameboyMonitor, applyGameboyWrite, describeGameboyNotes, extractGameboyNotes } from './gameboy_notes.js';

function vgm(commands, { gameBoyDmgClock = 4194304 } = {}) {
  const bytes = new Uint8Array(256 + commands.length); bytes.set([86, 103, 109, 32]);
  const v = new DataView(bytes.buffer); v.setUint32(8, 0x171, true); v.setUint32(0x34, 0xcc, true);
  v.setUint32(0x80, gameBoyDmgClock, true);
  bytes.set(commands, 256); return bytes;
}
const w = (register, value) => [0xb3, register, value];
const wait = n => [0x61, n & 255, n >>> 8];

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

test('extractGameboyNotes tracks a triggered square note interval and reports the write-driven-approximation warning', () => {
  const source = vgm([...w(0x02, 15 << 4), ...w(0x03, 1750 & 0xff), ...w(0x04, 0x80 | ((1750 >> 8) & 7)),
    ...wait(1000), ...w(0x02, 0x00), ...wait(500), 0x66]);
  const result = extractGameboyNotes(source);
  assert.equal(result.channels.length, 3);
  const ch1 = result.channels[0];
  assert.equal(ch1.notes.length, 1);
  assert.equal(ch1.notes[0].start, 0);
  assert.equal(ch1.notes[0].end, 1000);
  const expectedHz = 131072 / (2048 - 1750);
  const expectedMidi = 69 + 12 * Math.log2(expectedHz / 440);
  assert(Math.abs(ch1.notes[0].midi - expectedMidi) < 1e-9);
  assert.equal(result.channels[1].notes.length, 0);
  assert.equal(result.channels[2].notes.length, 0);
  assert.equal(result.time, 1500);
  assert.ok([...result.warnings.keys()].some(text => /length-counter timeout/.test(text)));
});

test('extractGameboyNotes closes all active notes on NR52 power-off', () => {
  const source = vgm([...w(0x02, 15 << 4), ...w(0x03, 100), ...w(0x04, 0x80),
    ...w(0x07, 15 << 4), ...w(0x08, 200), ...w(0x09, 0x80),
    ...wait(2000), ...w(0x16, 0x00), ...wait(100), 0x66]);
  const result = extractGameboyNotes(source);
  assert.equal(result.channels[0].notes.length, 1);
  assert.equal(result.channels[0].notes[0].end, 2000);
  assert.equal(result.channels[1].notes.length, 1);
  assert.equal(result.channels[1].notes[0].end, 2000);
});

// SPDX-License-Identifier: BSD-3-Clause
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import factory from '../generated/ym2610b_wasm.js';
import { Ym2610B } from '../js/ym2610b.js';
import { createFm2610SongAdpcmState, isFm2610SongAdpcmRegister, normalizeFm2610AdpcmAWindow } from './song_adpcm_state.js';
import { getFm2610AdpcmAWaveform, summarizeFm2610AdpcmA } from './song_adpcm_a_waveform.js';

test('ADPCM-A shadow decodes the six addresses, level, pan and key/flag masks', () => {
  const state = createFm2610SongAdpcmState({clock: 7987200});
  const original = state.snapshot();
  assert.equal(original.adpcmA.sampleRate, 7987200 / 432);
  assert.equal(original.adpcmA.voices.length, 6);
  assert.deepEqual(original.adpcmA.voices.map(voice => [voice.volume, voice.left, voice.right, voice.keyed]),
    Array.from({length: 6}, () => [31, true, true, false]));
  assert.equal(isFm2610SongAdpcmRegister(1, 0x2d), true);
  assert.equal(isFm2610SongAdpcmRegister(1, 0x2e), false);
  assert.equal(isFm2610SongAdpcmRegister(0, 0x18), false, 'OPNB forces ROM; this CPU-data register does not change its ROM');
  assert.equal(isFm2610SongAdpcmRegister(0, 0x22), false);

  state.write(1, 0x01, 0xff);
  state.write(1, 0x08, 0x95);
  // A1 starts at 0x123400. Program a conflicting end bank; the chip
  // compares lower 20 bits, so its first exclusive stop is 0x123800.
  state.write(1, 0x10, 0x34);
  state.write(1, 0x18, 0x12);
  state.write(1, 0x20, 0x37);
  state.write(1, 0x28, 0x32);
  state.write(1, 0x00, 0x23);
  state.write(1, 0x00, 0x82);
  state.write(0, 0x1c, 0x81);
  state.loadRom(0, new Uint8Array(0x400), 0x123400, 0x200000);
  const result = state.snapshot();
  assert.equal(result.adpcmA.volume, 63);
  assert.equal(result.adpcmA.rom.size, 0x200000);
  assert.deepEqual(result.adpcmA.voices[0], {
    channel: 0, start: 0x123400, end: 0x323800, playbackEnd: 0x123800, rangeValid: true,
    available: true, keyed: true, lastTrigger: 1, lastTriggerFrame: 0, lastTriggerTime: 0,
    eosFlagEnabled: false, volume: 21, left: true, right: false,
  });
  assert.deepEqual(result.adpcmA.voices.map(voice => voice.keyed), [true, false, false, false, false, true]);
  assert.equal(result.adpcmA.voices[1].lastTrigger, 1, 'Key-off preserves the last trigger order');
  state.write(1, 0, 1);
  assert.equal(state.snapshot().adpcmA.voices[0].lastTrigger, 2, 'Repeated KEY ON increments the order');
  assert.equal(state.snapshot().adpcmA.voices[5].lastTrigger, 1);
  assert.equal(result.adpcmB.eosFlagEnabled, false);
  assert.equal(result.adpcmB.rom, original.adpcmB.rom, 'ADPCM-B ROM retains identity across writes and A-bank transfers');
});

test('custom ADPCM-A windows can select an alternate recorded range without modifying voice settings', () => {
  const state = createFm2610SongAdpcmState();
  const bankSize = 0x180000, wave = new Uint8Array(512).fill(0x17);
  const window = {start: 0x12ff00, end: 0x030100};
  const range = normalizeFm2610AdpcmAWindow(window);
  assert.deepEqual(range, {...window, playbackEnd: 0x130100, rangeValid: true});
  assert.throws(() => normalizeFm2610AdpcmAWindow({start: window.start + 1, end: window.end}), /256/);
  assert.equal(normalizeFm2610AdpcmAWindow({start: 0x001000, end: 0x101000}).rangeValid, false);
  assert.equal(normalizeFm2610AdpcmAWindow({start: 0xffff00, end: 0x10100}).rangeValid, false);
  state.loadRom(0, wave.subarray(0, 256), window.start, bankSize);
  assert.equal(state.getAdpcmAWindow(0, undefined, window).available, false);
  assert.equal(state.readAdpcmABytes(0, undefined, window), null);
  state.loadRom(0, wave.subarray(256), window.start + 256, bankSize);
  const snapshot = state.snapshot();
  const {adpcmA} = snapshot;
  assert.equal(adpcmA.voices[0].start, 0);
  assert.equal(state.readAdpcmABytes(0, adpcmA), null);
  assert.deepEqual(state.getAdpcmAWindow(0, adpcmA, window), {...range, available: true});
  assert.deepEqual(state.readAdpcmABytes(0, adpcmA, window), wave);
  assert.equal(state.snapshot(), snapshot);
  state.loadRom(0, Uint8Array.of(0x42), window.start, bankSize);
  assert.equal(state.getAdpcmAWindow(0, adpcmA, window), null);
  assert.equal(state.readAdpcmABytes(0, adpcmA, window), null);
  assert.equal(state.readAdpcmABytes(0, state.snapshot().adpcmA, window)[0], 0x42);
});

test('ADPCM-A reads the fully recorded effective span across ROM pages', () => {
  const state = createFm2610SongAdpcmState();
  const start = 0x12ff00, middle = 0x130000, end = 0x130100, bankSize = 0x180000;
  state.write(1, 0x10, 0xff);
  state.write(1, 0x18, 0x12);
  state.write(1, 0x20, 0x00);
  state.write(1, 0x28, 0x03);
  const first = new Uint8Array(256).fill(0x77), second = new Uint8Array(256).fill(0x88);
  state.loadRom(0, second, middle, bankSize);
  assert.equal(state.readAdpcmABytes(0), null);
  state.loadRom(0, first, start, bankSize);
  const snapshot = state.snapshot().adpcmA;
  assert.equal(snapshot.voices[0].end, 0x030100);
  assert.equal(snapshot.voices[0].playbackEnd, end);
  const expected = Uint8Array.from([...first, ...second]);
  const preview = state.readAdpcmABytes(0, snapshot);
  assert.deepEqual(preview, expected);
  first.fill(0);
  preview.fill(0);
  assert.deepEqual(state.readAdpcmABytes(0), expected);
  assert.equal(state.readAdpcmABytes(6), null);

  state.write(1, 0x28, 0x23);
  assert.deepEqual(state.readAdpcmABytes(0, snapshot), expected, 'Unused end bits do not invalidate the same sample');
  const replacement = Uint8Array.of(5, 8, 13, 21);
  state.loadRom(0, replacement, middle - 2, bankSize);
  assert.equal(state.readAdpcmABytes(0, snapshot), null);
  expected.set(replacement, 254);
  assert.deepEqual(state.readAdpcmABytes(0), expected);
  state.loadRom(0, new Uint8Array(0), 0, middle + 2);
  state.loadRom(0, new Uint8Array(0), 0, bankSize);
  assert.equal(state.readAdpcmABytes(0), null);
  state.loadRom(0, expected.subarray(258), middle + 2, bankSize);
  assert.deepEqual(state.readAdpcmABytes(0), expected);
  state.clearRom();
  assert.equal(state.readAdpcmABytes(0), null);
});

test('ADPCM-A waveform uses the 12-bit predictor and stores compact normalized min/max pairs', async () => {
  const tiny = Uint8Array.of(0x08, 0x1b);
  const expected = Float32Array.from([2, 2, 0, 0, 6, 6, -8, -8], value => value / 2048);
  assert.deepEqual(summarizeFm2610AdpcmA(tiny), expected);
  assert.deepEqual(await getFm2610AdpcmAWaveform(tiny), expected);
  const large = summarizeFm2610AdpcmA(new Uint8Array(0xfff00).fill(0x77));
  assert.equal(large.length, 2 * 768);
  assert.ok(large.some(value => value < -0.99), 'All-positive nibbles wrap through the signed range');
  for (let index = 0; index < large.length; index += 2) {
    assert.ok(large[index] >= -1 && large[index] <= large[index + 1] && large[index + 1] < 1);
  }
  await assert.rejects(getFm2610AdpcmAWaveform(tiny, AbortSignal.abort()), {name: 'AbortError'});
});

test('ADPCM-B preview requires every recorded byte and follows replacement, shrink and declared ROM limits', () => {
  const state = createFm2610SongAdpcmState();
  state.write(0, 0x12, 2);
  state.write(0, 0x14, 3);
  state.write(0, 0x19, 0x34);
  state.write(0, 0x1a, 0x12);
  state.write(0, 0x1b, 177);
  state.write(0, 0x11, 0x40);
  state.write(0, 0x10, 0xd0);
  const first = new Uint8Array(256).fill(0x82), second = new Uint8Array(256).fill(0x34);
  state.loadRom(1, second, 768, 0x1000);
  assert.equal(state.snapshot().adpcmB.available, false, 'Declared zero-fill is separate from recorded bytes');
  assert.equal(state.readAdpcmBBytes(), null);
  state.loadRom(1, first, 512, 0x1000);
  const snapshot = state.snapshot();
  assert.equal(snapshot, state.snapshot());
  assert.deepEqual({...snapshot.adpcmB, rom: undefined}, {
    start: 512, end: 1024, deltaN: 0x1234, sampleRate: 0x1234 * 8000000 / (144 * 65536),
    volume: 177, repeat: true, left: false, right: true, keyed: true, eosFlagEnabled: true,
    available: true, rangeValid: true, rom: undefined,
  });
  assert.equal('bytes' in snapshot.adpcmB, false);
  const expected = Uint8Array.from([...first, ...second]);
  first.fill(0);
  const preview = state.readAdpcmBBytes(snapshot.adpcmB);
  assert.deepEqual(preview, expected);
  preview.fill(0xff);
  assert.deepEqual(state.readAdpcmBBytes(), expected);

  state.write(0, 0x10, 0xd1);
  assert.equal(state.snapshot().adpcmB.keyed, false, 'Reset takes precedence over Execute');
  assert.equal(state.snapshot().adpcmB.rom, snapshot.adpcmB.rom);
  assert.deepEqual(state.readAdpcmBBytes(snapshot.adpcmB), expected);
  state.loadRom(1, Uint8Array.of(0x47, 0x68), 530, 0x1000);
  assert.equal(state.readAdpcmBBytes(snapshot.adpcmB), null, 'A prior waveform request cannot read a newer bank');
  expected.set([0x47, 0x68], 18);
  assert.deepEqual(state.readAdpcmBBytes(), expected);
  state.loadRom(1, new Uint8Array(0), 0, 900);
  state.loadRom(1, new Uint8Array(0), 0, 0x1000);
  assert.equal(state.readAdpcmBBytes(), null, 'Reexpanding does not make truncated data available');
  state.loadRom(1, expected.subarray(900 - 512), 900, 0x1000);
  assert.deepEqual(state.readAdpcmBBytes(), expected);

  const populated = state.snapshot().adpcmB;
  state.clearRom();
  assert.equal(state.snapshot().adpcmB.rom.size, 0);
  assert.equal(state.snapshot().adpcmB.deltaN, 0x1234, 'Clear ROM does not change registers');
  assert.equal(state.readAdpcmBBytes(populated), null);
  state.reset();
  assert.equal(state.snapshot().adpcmB.deltaN, 0);
  assert.notEqual(state.snapshot().adpcmB.rom, populated.rom);
});

test('ROM coverage validates the 16 MiB end and rejects impossible ranges without altering state', () => {
  const state = createFm2610SongAdpcmState();
  const finalPage = new Uint8Array(256).fill(173);
  const limit = 0x1000000;
  for (const address of [0x12, 0x13, 0x14, 0x15]) state.write(0, address, 0xff);
  state.loadRom(1, finalPage, limit - finalPage.length, limit);
  assert.deepEqual(state.readAdpcmBBytes(), finalPage);
  const saved = state.snapshot();
  assert.equal(saved.adpcmB.end, limit);
  assert.throws(() => state.loadRom(1, finalPage, limit - 255, limit), /range|block/i);
  assert.equal(state.snapshot(), saved);
  state.write(0, 0x15, 0xfe);
  assert.equal(state.snapshot().adpcmB.rangeValid, false);
  assert.equal(state.snapshot().adpcmB.available, false);
});

test('an ADPCM-A key request stays latched even after the real WASM reports EOS', async () => {
  const wasmBinary = await readFile(new URL('../generated/ym2610b_wasm.wasm', import.meta.url));
  const core = await Ym2610B.create({moduleFactory: factory, moduleOptions: {wasmBinary}, variant: false});
  const state = createFm2610SongAdpcmState();
  try {
    const rom = new Uint8Array(256).fill(0x17);
    state.loadRom(0, rom, 0, rom.length);
    core.loadAdpcmRom(0, rom, 0, rom.length);
    for (const [port, register, value] of [[1, 0x01, 63], [1, 0, 1]]) {
      core.write(port * 2, register);
      core.write(port * 2 + 1, value);
      state.write(port, register, value);
    }
    assert.equal(state.snapshot().adpcmA.voices[0].keyed, true);
    core.generateStereo(20000);
    assert.equal(core.readStatusHi() & 1, 1);
    assert.equal(state.snapshot().adpcmA.voices[0].keyed, true, 'Register intent is not decoder status');
  } finally {
    core.dispose();
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, mkdtemp, readdir, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {copyOpnaRhythm} from '../scripts/copy_opna_rhythm.mjs';
import {generateRhythmRom, encodeAdpcmA} from '../assets/opna-rhythm/generate.mjs';
import {Ym2608} from './ym2608.js';
import {YM2608Synth, YM2608DirectTransport} from './ym2608synth.js';

const romUrl = new URL('./tetorica_ym2608_adpcm_rom.bin', import.meta.url);

test('release payload and Pages copy include identical licensed synthetic data', async () => {
  const stage = await mkdtemp(join(tmpdir(), 'opna-release-'));
  try {
    await copyOpnaRhythm(stage);
    const files = ['LICENSE', 'README.md', 'generate.mjs', 'synthesis.mjs'];
    const rom = await readFile(romUrl);
    assert.deepEqual(await readFile(join(stage, 'js/tetorica_ym2608_adpcm_rom.bin')), rom);
    assert.deepEqual(await readFile(new URL('../docs/js/tetorica_ym2608_adpcm_rom.bin', import.meta.url)), rom);
    assert.deepEqual((await readdir(join(stage, 'assets/opna-rhythm'))).sort(), files.sort());
    for (const file of files) {
      const source = await readFile(new URL(`../assets/opna-rhythm/${file}`, import.meta.url));
      assert.deepEqual(await readFile(join(stage, 'assets/opna-rhythm', file)), source);
      assert.deepEqual(await readFile(new URL(`../docs/assets/opna-rhythm/${file}`, import.meta.url)), source);
    }
    assert.match(await readFile(join(stage, 'assets/opna-rhythm/LICENSE'), 'utf8'), /BSD 3-Clause/);
  } finally { await rm(stage, {recursive: true, force: true}); }
});

test('distributed rhythm ROM is 8 KiB and matches the standalone generator', async () => {
  const rom = await readFile(romUrl);
  assert.equal(rom.length, 8192);
  assert.deepEqual(Buffer.from(generateRhythmRom()), rom);
});

test('ADPCM-A encoding follows high-nibble order and adaptive step changes', () => {
  // Initial step 16: +2, -2, +30; code 7 raises step to 37, then +69.
  assert.deepEqual([...encodeAdpcmA([2, 0, 30, 99])], [0x08, 0x77]);
  assert.throws(() => encodeAdpcmA([0]), RangeError);
  assert.throws(() => encodeAdpcmA([0, 2048]), RangeError);
  assert.throws(() => encodeAdpcmA([NaN, 0]), RangeError);
});

test('generated sounds play on YM2608 and stop at each fixed ROM boundary', async () => {
  const {default: moduleFactory} = await import('../docs/generated/ym2608_wasm.js');
  const chip = await Ym2608.create({moduleFactory, moduleOptions: {
    wasmBinary: await readFile(new URL('../docs/generated/ym2608_wasm.wasm', import.meta.url)),
  }});
  const peak = values => values.reduce((p, x) => Math.max(p, Math.abs(x)), 0);
  try {
    const synth = new YM2608Synth({transport: new YM2608DirectTransport(chip)});
    synth.rhythm.loadRom(await readFile(romUrl));
    // Expected durations from the core's fixed address map, at an 8 MHz clock.
    const durations = [0.048384, 0.069120, 0.642816, 0.041472, 0.138240, 0.027648];
    for (let channel = 0; channel < 6; channel++) {
      synth.reset();
      chip.generateStereo(1000);
      synth.rhythm.setVolume(48);
      synth.rhythm.setVoice(channel, {volume: 24, left: true, right: false});
      synth.rhythm.keyOn(channel);
      const pcm = chip.generateStereo(Math.ceil(chip.sampleRate() * (durations[channel] + 0.01)));
      assert.ok(pcm.left.every(Number.isFinite), `voice ${channel}: finite samples`);
      assert.ok(peak(pcm.left) > 0.001, `voice ${channel}: audible`);
      assert.ok(peak(pcm.left) < 1, `voice ${channel}: no clipping`);
      assert.equal(peak(pcm.right), 0, `voice ${channel}: left-only pan`);
      const end = Math.ceil(chip.sampleRate() * (durations[channel] + 0.002));
      assert.equal(peak(pcm.left.subarray(end)), 0, `voice ${channel}: automatic stop`);
    }
  } finally { chip.dispose(); }
});

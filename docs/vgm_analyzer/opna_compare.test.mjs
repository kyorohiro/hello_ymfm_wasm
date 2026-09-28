import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import factory from '../generated/ym2608_wasm.js';
import {renderRhythmVoice} from '../demos/opna-rhythm-render.js';

test('comparison renders repeatable, audible stereo for all six voices', async () => {
  const rom = await readFile(new URL('../js/tetorica_ym2608_adpcm_rom.bin', import.meta.url));
  const options = {wasmBinary: await readFile(new URL('../generated/ym2608_wasm.wasm', import.meta.url))};
  for (let voice = 0; voice < 6; voice++) {
    const a = await renderRhythmVoice(rom, voice, factory, options);
    const b = await renderRhythmVoice(rom, voice, factory, options);
    assert.equal(a.left.length, 48000);
    assert.deepEqual(a, b, 'same ROM and voice must render identically');
    assert.deepEqual(a.left, a.right);
    assert.ok(a.left.every(Number.isFinite));
    assert.ok(a.left.some(v => Math.abs(v) > 0.001));
    assert.ok(a.left.subarray(40000).every(v => v === 0));
  }
  await assert.rejects(renderRhythmVoice(new Uint8Array(10), 0, factory, options), /8192/);
  await assert.rejects(renderRhythmVoice(rom, 6, factory, options), /voice/);
});

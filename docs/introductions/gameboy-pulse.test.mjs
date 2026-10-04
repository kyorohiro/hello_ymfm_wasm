import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {GameboyApu} from '../js/gameboyapu.js';
import {GameboySynth, GameboyDirectTransport} from '../js/gameboysynth.js';
import moduleFactory from '../generated/gameboy_apu_wasm.js';
import {DEFAULT_PULSE, pulseCode, renderPulse, validatePulse} from './gameboy-pulse.js';
const moduleOptions = {wasmBinary: await readFile(new URL('../generated/gameboy_apu_wasm.wasm', import.meta.url))};
const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;

for (const sampleRate of [44100, 48000]) test(`all Pulse duties/channels match copied Playground code at ${sampleRate} Hz`, async () => {
  for (const channel of [0, 1]) for (const duty of [0.125, 0.25, 0.5, 0.75]) {
    const settings = {...DEFAULT_PULSE, channel, duty};
    const actual = await renderPulse(settings, {sampleRate, moduleOptions});
    assert.equal(actual.left.length, sampleRate * 1.5);
    assert.deepEqual(actual.left, actual.right);
    assert.ok(actual.left.every(Number.isFinite));
    const part = actual.left.slice(sampleRate / 2, sampleRate);
    assert.ok(Math.max(...part) - Math.min(...part) > .01);
    const center = (Math.max(...part) + Math.min(...part)) / 2;
    let crossings = 0;
    for (let i = 1; i < part.length; i++) if (part[i - 1] < center && part[i] >= center) crossings++;
    assert.ok(Math.abs(crossings * 2 - 440) < 5, `pitch ${crossings * 2}`);
    const chip = await GameboyApu.create({moduleFactory, moduleOptions, sampleRate});
    const gb = new GameboySynth({transport: new GameboyDirectTransport(chip)});
    let copied;
    try {
      await new AsyncFunction('useSoundChip', 'sleep', pulseCode(settings))(
        async name => { assert.equal(name, 'gameboy'); return gb; },
        async seconds => { copied = chip.generateStereo(Math.round(seconds * sampleRate)); });
      assert.deepEqual(actual.left, copied.left);
      assert.throws(() => gb.pulse.keyOn(channel), /disposed/);
    } finally { gb.dispose(); chip.dispose(); }
  }
});
test('invalid controls fail before loading WASM', async () => {
  for (const override of [{channel: 2}, {duty: .3}, {note: 'x'}, {volume: 0}, {volume: NaN}]) {
    const settings = {...DEFAULT_PULSE, ...override};
    assert.throws(() => validatePulse(settings), RangeError);
    await assert.rejects(renderPulse(settings), RangeError);
  }
});

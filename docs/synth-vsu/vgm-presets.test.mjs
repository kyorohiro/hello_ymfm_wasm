// SPDX-License-Identifier: BSD-3-Clause
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { VSU_REGISTERS, vsuChannelRegister } from './vsu.js';
import {
  extractVsuVgmPresets, scanVsuVgmPresets, VSU_VGM_PRESET_SCAN_TICKS,
} from './vgm-presets.js';

const module = await WebAssembly.compile(await readFile(new URL('./vsu.wasm', import.meta.url)));
const chip = () => new WebAssembly.Instance(module).exports;
const write = (tick, channel, name, value) => [tick, vsuChannelRegister(channel, VSU_REGISTERS[name]), value];
const plan = (events, durationTicks = 4096) => ({ writes: Uint32Array.from(events.flat()), durationTicks });
const waveform = (tone, channel) => tone.patch.banks[tone.patch.channels[channel].wave];

test('collects the final wave and settings at a trigger and deduplicates different notes and idle envelope flags', () => {
  const events = [
    [0, 0, 27], [0, 4, 50],
    write(0, 0, 'LRV', 0xa2),
    write(0, 0, 'EV0', 0xb0),
    write(0, 0, 'FQL', 51),
    write(0, 0, 'INT', 0x80),
    write(0, 0, 'LRV', 0xb3),
    write(800, 0, 'FQL', 113),
    write(800, 0, 'FQH', 6),
    write(800, 0, 'EV0', 0xbf),
    write(800, 0, 'INT', 0x80),
  ];
  const [tone, ...rest] = scanVsuVgmPresets(chip(), plan(events));
  assert.deepEqual(rest, []);
  assert.equal(tone.channel, 0);
  assert.equal(tone.patch.preferredChannel, 0);
  assert.deepEqual(waveform(tone, 0).slice(0, 3), [27, 50, 0]);
  assert.deepEqual(tone.patch.channels[0], {
    wave: 0, left: 11, right: 3,
    envelope: { initial: 11, rate: 0, direction: 'down', enabled: false, repeat: false },
  });
});

test('progresses hardware intervals and ignores wave RAM writes while a channel is sounding', () => {
  const events = [
    [0, 0, 13], [0, 4, 52],
    write(0, 0, 'LRV', 0xff),
    write(0, 0, 'EV0', 0xf0),
    write(0, 0, 'INT', 0xa0), // One interval unit, 3.84 ms (~169 VGM ticks).
    [100, 0, 42],
    write(100, 0, 'INT', 0xa0),
    [300, 0, 33],
    write(300, 0, 'INT', 0xa0),
  ];
  const tones = scanVsuVgmPresets(chip(), plan(events));
  assert.deepEqual(tones.map(tone => waveform(tone, 0)[0]), [13, 33]);
});

test('preserves CH5 signed modulation and CH6 noise settings in playable default editor patches', () => {
  const events = [
    [0, 0, 24], [0, 4, 55], [0, 0x280, 0x80], [0, 0x284, 0x7f],
    write(0, 4, 'LRV', 0x81),
    write(0, 4, 'EV0', 0xdb),
    write(0, 4, 'EV1', 0x73),
    write(0, 4, 'SWP', 0xb0),
    write(0, 4, 'INT', 0x80),
    write(0, 5, 'LRV', 0xa5),
    write(0, 5, 'EV0', 0xf2),
    write(0, 5, 'EV1', 0x53),
    write(0, 5, 'FQL', 0xf0),
    write(0, 5, 'FQH', 7),
    write(0, 5, 'INT', 0xa2),
  ];
  const [wave, noise] = scanVsuVgmPresets(chip(), plan(events));
  assert.deepEqual([wave.channel, noise.channel], [4, 5]);
  assert.equal(wave.patch.preferredChannel, 4);
  assert.equal(wave.patch.ch5.mode, 'modulation');
  assert.equal(wave.patch.ch5.clock, 'slow');
  assert.equal(wave.patch.ch5.rate, 3);
  assert.equal(wave.patch.ch5.repeat, true);
  assert.deepEqual(wave.patch.ch5.modulation.slice(0, 3), [-128, 127, 0]);
  assert.deepEqual(wave.patch.channels[4].envelope, {
    initial: 13, rate: 3, direction: 'up', enabled: true, repeat: true,
  });
  assert.equal(noise.patch.preferredChannel, 5);
  assert.equal(noise.patch.channels[5].wave, null);
  assert.equal(noise.patch.noiseTap, 5);
  assert.deepEqual(noise.patch.noise, { keyTracking: false, frequency: 0x7f0, interval: 2 });
});

test('deduplicates CH6 by final clock and interval at each audible trigger', () => {
  const events = [
    write(0, 5, 'LRV', 0xff), write(0, 5, 'EV0', 0xf0),
    write(0, 5, 'FQL', 0xf0), write(0, 5, 'FQH', 7),
    write(0, 5, 'INT', 0xa1), write(0, 5, 'INT', 0xa2),
    write(50, 5, 'INT', 0xa2),
    write(100, 5, 'FQL', 0xf8), write(100, 5, 'INT', 0xa2),
    write(150, 5, 'INT', 0xa0),
    write(200, 5, 'INT', 0x9f),
    write(250, 5, 'INT', 0x80),
    write(300, 5, 'INT', 0xbf), write(300, 5, 'INT', 0),
  ];
  assert.deepEqual(scanVsuVgmPresets(chip(), plan(events)).map(({ patch }) => [patch.noise.frequency, patch.noise.interval]), [
    [0x7f0, 2], [0x7f8, 2], [0x7f8, 0], [0x7f8, null],
  ]);
});

test('keeps valid silent logs importable and bounds the first distinct presets in chronological order', () => {
  const events = [
    write(0, 0, 'LRV', 0x11), write(0, 0, 'EV0', 0xf0),
    write(0, 0, 'INT', 0x80), [0, 0x580, 1], // No audible frame followed this trigger.
    write(4, 0, 'LRV', 0), write(4, 0, 'INT', 0x80),
    write(8, 0, 'LRV', 0x32), write(8, 0, 'EV0', 0x08),
    write(8, 0, 'EV1', 1), write(8, 0, 'INT', 0x80),
    write(12, 0, 'LRV', 0x43), write(12, 0, 'INT', 0x80),
  ];
  assert.equal(scanVsuVgmPresets(chip(), plan(events), { limit: 1 })[0].patch.channels[0].left, 3);
  assert.deepEqual(scanVsuVgmPresets(chip(), plan(events.slice(0, 6))), []);
  const late = VSU_VGM_PRESET_SCAN_TICKS + 1;
  assert.deepEqual(scanVsuVgmPresets(chip(), plan([
    write(late, 0, 'LRV', 0x11), write(late, 0, 'EV0', 0xf0), write(late, 0, 'INT', 0x80),
  ], late + 1)), []);
});

test('checks cancellation before creating a worker', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(extractVsuVgmPresets(plan([]), { signal: controller.signal }), { name: 'AbortError' });
});

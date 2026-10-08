import test from 'node:test';
import assert from 'node:assert/strict';
import {createSoundChip} from '../web/soundchip.js';
import {YM2612Synth} from '../web/ym2612synth.js';
import {YM2608Synth} from '../web/ym2608synth.js';
import {GameboySynth} from '../web/gameboysynth.js';
import {SegaPSGSynth} from '../web/segapsgsynth.js';
import {YM2151Synth} from '../web/ym2151synth.js';
import {NesApuSynth} from '../web/nesapusynth.js';
import {FM_PRESETS} from '../web/megasynth-fm-presets.js';
import {YM2612AudifyTransport, YM2608AudifyTransport, YM2151AudifyTransport, NesApuAudifyTransport, GameboyAudifyTransport, SegaPSGAudifyTransport, PWM32XAudifyTransport} from '../node/chip_transports.mjs';
const outputModule = new URL('./fixtures/megasynth_output.mjs', import.meta.url).href;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
for (const [name, Type, configure] of [
  ['ym2612', YM2612AudifyTransport, transport => {const fm = new YM2612Synth({transport}); fm.setPreset(0, FM_PRESETS.sine); fm.noteOn(0, 4, 553);}],
  ['ym2608', YM2608AudifyTransport, transport => {const fm = new YM2608Synth({transport}); fm.setPreset(0, FM_PRESETS.sine); fm.noteOn(0, 4, 553);}],
  ['nes', NesApuAudifyTransport, transport => {const synth = new NesApuSynth({transport}); synth.pulse.noteOn(0, 'A4');}],
  ['ym2151', YM2151AudifyTransport, transport => {const fm = new YM2151Synth({transport}); fm.setPreset(0, FM_PRESETS.sine); fm.noteOn(0, 'A4');}],
  ['gameboy', GameboyAudifyTransport, transport => {const gb = new GameboySynth({transport}); gb.initialize(); gb.pulse.setVoice(0, {duty: .5, volume: 10}); gb.pulse.setNote(0, 'C4'); gb.pulse.keyOn(0);}],
  ['pwm', PWM32XAudifyTransport, transport => {transport.write(0, 5); transport.write(1, 1047); transport.write(4, 700);}],
  ['segapsg', SegaPSGAudifyTransport, transport => {const psg = new SegaPSGSynth({transport}); psg.tone(0, {note: 'C4', volume: .5});}],
]) {
  test(`${name}: transport owns output, preserves caller chip, stops/resumes and closes`, async () => {
    const chip = await createSoundChip(name);
    const transport = new Type(chip, {outputModule});
    try {
      configure(transport); assert.equal(transport.start(), transport.start()); await transport.start(); await wait(60);
      const state = transport.getState(); assert.ok(state.output.consumedFrames > 0); assert.ok(state.output.peak > .001);
      await transport.stop(); assert.equal(transport.getState().output.queuedFrames, 0);
      await transport.start(); await wait(30); await transport.close(); await transport.close();
      assert.equal(chip.generateStereo(8).left.length, 8); // Borrowed chip still belongs to caller.
      await assert.rejects(transport.start(), /closed/);
    } finally {await transport.close(); chip.dispose();}
  });
}
test('YM2612 idle offset is removed from device output without changing the chip', async () => {
  const chip = await createSoundChip('ym2612');
  const transport = new YM2612AudifyTransport(chip, {outputModule});
  try {
    assert.ok(chip.generateStereo(128).left.some(value => value > .01)); chip.reset();
    await transport.start(); await wait(50); assert.equal(transport.getState().output.peak, 0);
  } finally {await transport.close(); chip.dispose();}
});
test('output initialization failure and cancellation clean up their device Worker', async () => {
  const chip = await createSoundChip('ym2612');
  const failing = new YM2612AudifyTransport(chip, {outputModule, outputOptions: {failOpen: true}});
  try {await assert.rejects(failing.start(), /unavailable/); await assert.rejects(failing.start(), /closed/); await failing.close();}
  finally {await failing.close();}
  const canceled = new YM2612AudifyTransport(chip, {outputModule, outputOptions: {initDelay: 40}});
  const result = assert.rejects(canceled.start(), /closed/);
  await canceled.close(); await result; chip.dispose();
});

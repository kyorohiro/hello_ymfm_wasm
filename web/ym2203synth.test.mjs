import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {YM2203Synth, YM2203DirectTransport} from './ym2203synth.js';
import {Ym2203} from './ym2203.js';
import {FM_PRESETS} from './megadrive-fm-presets.js';
import {hzToBlockFnum} from './pitch.js';

test('SSG mixer preserves raw writes, other channels and I/O; reset stays within SSG', () => {
  const writes = [];
  let resets = 0;
  const synth = new YM2203Synth({transport: {
    write(port, register, value) { writes.push([port, register, value]); },
    reset() { resets++; },
  }});
  synth.write(0, 7, 0xff);
  assert.equal(synth.ssg.tone(0, {frequency: 440}), 284);
  assert.equal(synth.ssg.registers[7], 0xfe);
  synth.ssg.noise(1, {period: 12});
  assert.equal(synth.ssg.registers[7], 0xee);
  synth.ssg.setEnvelope({period: 4000, shape: 9});
  synth.ssg.setVolume(2, 12, true);
  assert.equal(synth.ssg.registers[10], 16);
  const count = writes.length;
  assert.throws(() => synth.ssg.tone(3, {frequency: 440}), RangeError);
  assert.throws(() => synth.ssg.noise(0, {period: 32}), RangeError);
  assert.throws(() => synth.ssg.setEnvelope({period: 4000, shape: 16}), RangeError);
  assert.equal(writes.length, count, 'invalid calls must not partially write');
  synth.ssg.reset();
  assert.equal(resets, 1, 'SSG reset must not reset whole chip');
  assert.ok(writes.slice(count).every(([p,r]) => p === 0 && r <= 13));
  assert.equal(synth.ssg.registers[7], 0xff);
  synth.reset();
  assert.equal(resets, 2);
  assert.ok(synth.ssg.registers.every(x => x === 0));
});

test('real YM2203: SSG frequency, silence and reset while FM remains active', async () => {
  const {default: moduleFactory} = await import('../docs/generated/ym2203_wasm.js');
  const chip = await Ym2203.create({moduleFactory, moduleOptions: {
    wasmBinary: await readFile(new URL('../docs/generated/ym2203_wasm.wasm', import.meta.url)),
  }});
  const peak = a => a.reduce((p,x) => Math.max(p, Math.abs(x)), 0);
  try {
    const synth = new YM2203Synth({transport: new YM2203DirectTransport(chip)});
    const rate = chip.sampleRate();
    synth.ssg.reset();
    synth.ssg.tone(0, {frequency: 440, volume: 12});
    const pcm = chip.generateStereo(Math.round(rate * 0.2));
    assert.ok(peak(pcm.left) > 0.01);
    let rises = 0;
    for (let i=1; i<pcm.left.length; i++) if (pcm.left[i] > pcm.left[i-1] + 0.01) rises++;
    assert.ok(Math.abs(rises / 0.2 - 440) < 10);
    synth.ssg.off(0);
    chip.generateStereo(100);
    assert.equal(peak(chip.generateStereo(1000).left), 0);
    synth.setPreset(0, FM_PRESETS.sine);
    const {block, fnum} = hzToBlockFnum(440, 8000000);
    synth.noteOn(0, block, fnum);
    chip.generateStereo(Math.round(rate * 0.1));
    synth.ssg.reset();
    assert.ok(peak(chip.generateStereo(10000).left) > 0.001, 'FM must survive SSG reset');
  } finally { chip.dispose(); }
});

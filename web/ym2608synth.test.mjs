import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {YM2608Synth, YM2608DirectTransport} from './ym2608synth.js';
import {Ym2608} from './ym2608.js';
import {FM_PRESETS} from './megadrive-fm-presets.js';
import {hzToBlockFnum} from './pitch.js';

test('SSG mixer preserves raw writes, other channels and I/O; reset stays within SSG', () => {
  const writes = [];
  let resets = 0;
  const synth = new YM2608Synth({transport: {
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

test('real YM2608: six FM channels, CH3 special, SSG pitch and mixed output', async () => {
  const {default: moduleFactory} = await import('../docs/generated/ym2608_wasm.js');
  const chip = await Ym2608.create({moduleFactory, moduleOptions: {
    wasmBinary: await readFile(new URL('../docs/generated/ym2608_wasm.wasm', import.meta.url)),
  }});
  const peak = a => a.reduce((p,x) => Math.max(p, Math.abs(x)), 0);
  try {
    const synth = new YM2608Synth({transport: new YM2608DirectTransport(chip)});
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
    // All six FM voices must work after construction and after reset.
    const strength = (data, hz) => {
      let re=0, im=0;
      for (let i=0; i<data.length; i++) {
        const angle = 2 * Math.PI * hz * i / rate;
        re += data[i] * Math.cos(angle); im += data[i] * Math.sin(angle);
      }
      return Math.hypot(re,im) / data.length;
    };
    for (let ch=0; ch<6; ch++) {
      synth.reset();
      synth.setPreset(ch, FM_PRESETS.sine);
      synth.setOperator(ch, 3, {tl: 0});
      synth.setPan(ch, ch < 3, ch >= 3);
      synth.noteOn(ch, block, fnum);
      chip.generateStereo(Math.round(rate * 0.05));
      const audio = chip.generateStereo(Math.round(rate * 0.1));
      const active = ch < 3 ? audio.left : audio.right;
      const silent = ch < 3 ? audio.right : audio.left;
      assert.ok(strength(active, 440) > 0.01, `FM CH${ch+1} frequency/output`);
      assert.equal(peak(silent), 0);
      synth.noteOff(ch);
      chip.generateStereo(Math.round(rate * 0.5));
      assert.ok(peak(chip.generateStereo(1000).left) < 0.0001);
      assert.ok(peak(chip.generateStereo(1000).right) < 0.0001);
    }
    synth.reset();
    synth.setPreset(2, FM_PRESETS.sine);
    synth.setAlgo(2, 7, 0);
    synth.setChannel3SpecialMode(true);
    const frequencies = [220, 277.182631, 329.627557, 440];
    frequencies.forEach((hz, op) => {
      synth.setOperator(2, op, {multi: 1, dt: 0, tl: 20});
      const p = hzToBlockFnum(hz, 8000000);
      synth.setChannel3SpecialFrequency(op, p.block, p.fnum);
    });
    synth.keyOn(2);
    chip.generateStereo(Math.round(rate * 0.05));
    const special = chip.generateStereo(Math.round(rate * 0.2));
    for (const hz of frequencies) assert.ok(strength(special.left, hz) > 0.005, `CH3 special ${hz} Hz`);
    // SSG and FM coexist; ADPCM bank writes must not corrupt SSG's mixer shadow.
    synth.write(0, 7, 0xff);
    synth.write(1, 7, 0);
    assert.equal(synth.ssg.registers[7], 0xff);
    synth.ssg.tone(0, {frequency: 880});
    const mixed = chip.generateStereo(Math.round(rate * 0.2));
    assert.ok(strength(mixed.left, 880) > 0.005);
    assert.ok(strength(mixed.left, 220) > 0.005);
  } finally { chip.dispose(); }
});

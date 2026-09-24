import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Ym3438 } from './ym3438.js';
import { Ymf276 } from './ymf276.js';
import { YM3438Synth, YMF276Synth } from './opn_variant_synth.js';
import { OPNDirectTransport } from './opn_fm_synth.js';
import { FM_PRESETS } from './megadrive-fm-presets.js';
import { hzToBlockFnum } from './pitch.js';

const cases = [['ym3438', Ym3438, YM3438Synth], ['ymf276', Ymf276, YMF276Synth]];
const peak = array => array.reduce((p, x) => Math.max(p, Math.abs(x)), 0);
for (const [name, Chip, Synth] of cases) {
  test(`${name}: native FM on all channels, pitch, pan, release and reset`, async () => {
    const {default: moduleFactory} = await import(`../docs/generated/${name}_wasm.js`);
    const moduleOptions = {wasmBinary: await readFile(new URL(`../docs/generated/${name}_wasm.wasm`, import.meta.url))};
    const chip = await Chip.create({moduleFactory, moduleOptions});
    try {
      const synth = new Synth({transport: new OPNDirectTransport(chip, {chipName:name, portCount:2})});
      const rate = chip.sampleRate();
      assert.ok(rate > 0);
      const {block, fnum} = hzToBlockFnum(440, chip.clock);
      for (let ch = 0; ch < 6; ch++) {
        synth.reset();
        synth.setPreset(ch, {...FM_PRESETS.sine, pan:{left:true,right:false}});
        synth.noteOn(ch, block, fnum);
        const pcm = chip.generateStereo(Math.round(rate * 0.3));
        assert.ok(pcm.left.every(Number.isFinite));
        assert.ok(peak(pcm.left) > 0.001, `CH${ch + 1} is silent`);
        assert.equal(peak(pcm.right), 0, 'right pan must be silent');
        let crossings = 0;
        const start = Math.round(rate * 0.05);
        for (let i=start+1; i<pcm.left.length; i++) if (pcm.left[i-1] <= 0 && pcm.left[i] > 0) crossings++;
        const measuredHz = crossings * rate / (pcm.left.length-start);
        assert.ok(Math.abs(measuredHz-440) < 6, `frequency ${measuredHz} Hz`);
        const saved = pcm.left.slice();
        synth.noteOff(ch);
        chip.generateStereo(Math.round(rate * 0.3));
        assert.ok(peak(chip.generateStereo(1024).left) < 0.0001, 'key off must release');
        assert.deepEqual(pcm.left, saved, 'PCM arrays must survive later renders');
        synth.reset();
        synth.setPreset(ch, {...FM_PRESETS.sine, pan:{left:true,right:false}});
        synth.noteOn(ch, block, fnum);
        assert.deepEqual(chip.generateStereo(saved.length).left, saved, 'reset must reproduce PCM');
      }
      assert.throws(() => chip.generateStereo(-1), RangeError);
      assert.throws(() => chip.write(4, 0), RangeError);
      assert.throws(() => chip.sampleRate(0), RangeError);
      chip.dispose();
      chip.dispose();
      assert.throws(() => chip.generateStereo(1), /disposed/);
    } finally { chip.dispose(); }
  });
}

test('YM3438 and YMF276 use distinct native DAC/output paths', async () => {
  const outputs = [];
  for (const [name, Chip] of cases) {
    const {default: moduleFactory} = await import(`../docs/generated/${name}_wasm.js`);
    const chip = await Chip.create({moduleFactory, moduleOptions:{wasmBinary:await readFile(new URL(`../docs/generated/${name}_wasm.wasm`, import.meta.url))}});
    try {
      const write = (port, reg, value) => {chip.write(port*2, reg);chip.write(port*2+1,value);};
      write(1, 0xb6, 0xc0); // DAC channel pan
      write(0, 0x2b, 0x80); // DAC enable
      write(0, 0x2a, 0xff);
      const pcm = chip.generateStereo(32);
      assert.ok(peak(pcm.left) > 0);
      assert.deepEqual(pcm.left, pcm.right);
      outputs.push(pcm.left);
    } finally {chip.dispose();}
  }
  assert.notDeepEqual(outputs[0], outputs[1], 'must not alias both variants to one core');
});

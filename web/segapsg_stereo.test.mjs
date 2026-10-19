import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {SegaPSG} from './segapsg.js';
import factory from '../docs/generated/segapsg_wasm.js';

const make = () => SegaPSG.create({moduleFactory:factory,moduleOptions:{wasmBinary:readFileSync(new URL('../docs/generated/segapsg_wasm.wasm',import.meta.url))},sampleRate:48000});
const peak = samples => samples.reduce((value,sample) => Math.max(value,Math.abs(sample)),0);
function sound(chip, channel) {
  if (channel === 3) {chip.write(0xe4); chip.write(0xf5);}
  else {chip.write(0x80 | channel << 5 | 8); chip.write(0x1a); chip.write(0x95 | channel << 5);}
}

for (const channel of [0,1,2,3]) test(`Game Gear stereo mask routes physical PSG voice ${channel} independently`, async t => {
  const chip = await make(); t.after(() => chip.dispose());
  sound(chip,channel);
  const mono = chip.generateStereo(1024); assert(peak(mono.left) > .01); assert.deepEqual(mono.left,mono.right,'0xff default preserves mono PCM');
  chip.setStereo(1 << (channel + 4));
  let pcm = chip.generateStereo(1024); assert(peak(pcm.left) > .01); assert.equal(peak(pcm.right),0);
  chip.setStereo(1 << channel);
  pcm = chip.generateStereo(1024); assert.equal(peak(pcm.left),0); assert(peak(pcm.right) > .01);
  chip.setStereo(0); pcm = chip.generateStereo(128); assert.equal(peak(pcm.left),0); assert.equal(peak(pcm.right),0);
  chip.setStereo(255); chip.setChannelMuted(channel,true); pcm = chip.generateStereo(128); assert.equal(peak(pcm.left),0); assert.equal(peak(pcm.right),0);
  chip.setChannelMuted(channel,false); assert(peak(chip.generateStereo(128).left) > .01);
});

test('Game Gear routing is part of synthesis state; reset returns all outputs enabled', async t => {
  const chip = await make(); t.after(() => chip.dispose()); sound(chip,0); chip.setStereo(0x10);
  const state = chip.saveState(), expected = chip.generateStereo(128);
  chip.setStereo(1); chip.generateStereo(100); chip.loadState(state); assert.deepEqual(chip.generateStereo(128),expected);
  chip.reset(); sound(chip,0); const reset = chip.generateStereo(128); assert.deepEqual(reset.left,reset.right);
  for (const value of [-1,256,NaN,.5]) assert.throws(() => chip.setStereo(value),RangeError);
});

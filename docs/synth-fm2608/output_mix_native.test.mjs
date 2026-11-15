import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ym2203Factory from '../generated/ym2203_wasm.js';
import ym2608Factory from '../generated/ym2608_wasm.js';
import {Ym2203AudioEngine} from '../js/ym2203audioengine.js';
import {Ym2608AudioEngine} from '../js/ym2608audioengine.js';
import {SOUNDCHIP_MIXER_PRESETS} from '../js/soundchip_mixer_presets.js';
import {resolveFm2608OutputMix} from './output_mix.js';

const gain = name => SOUNDCHIP_MIXER_PRESETS.calibrated.factoryDefaults.kinds.find(value=>value.name === name).volume;
const rms = samples => Math.sqrt(samples.reduce((sum,value)=>sum+value*value,0)/samples.length);

async function compareOutput(section,fileMultiplier = 1) {
  const [opnBinary,opnaBinary] = await Promise.all([
    readFile(new URL('../generated/ym2203_wasm.wasm',import.meta.url)),
    readFile(new URL('../generated/ym2608_wasm.wasm',import.meta.url)),
  ]);
  const [opn,opna] = await Promise.all([
    Ym2203AudioEngine.create({ym2203ModuleFactory:ym2203Factory,ym2203ModuleOptions:{wasmBinary:opnBinary},ym2203Clock:4000000,masterVolume:gain('ym2203')*fileMultiplier}),
    Ym2608AudioEngine.create({ym2608ModuleFactory:ym2608Factory,ym2608ModuleOptions:{wasmBinary:opnaBinary},ym2608Clock:8000000,masterVolume:gain('ym2608')}),
  ]);
  try {
    const source = {sourceChip:'ym2203',compatibility:{extraVolumeEntries:[{section,chipIndex:0,relative:true,multiplier:fileMultiplier}]}};
    opna.setOutputGains(resolveFm2608OutputMix({ym2203Mode:true},source).effective);
    const write = (register,value) => {opn.writeYm2203(register,value);opna.writeYm2608(0,register,value);};
    write(7,0x3f);write(8,0);write(9,0);write(10,0);
    if (section === 'ssg') {
      write(0,119);write(1,0);write(7,0x3e);write(8,10);
    } else {
      for (const slot of [0,8,4,12]) {
        for (const [register,value] of [[0x30,1],[0x40,slot === 12 ? 24 : 127],[0x50,31],[0x60,0],[0x70,0],[0x80,15],[0x90,0]]) write(register+slot,value);
      }
      write(0xb0,7);opna.writeYm2608(0,0xb4,0xc0);
      write(0xa4,0x22);write(0xa0,0xa5);write(0x28,0x80);
    }
    const expected = rms(opn.processFrames(4096).left),actual = rms(opna.processFrames(4096).left);
    assert(expected>.001 && actual>.001,'Both real cores produce audible output');
    assert(Math.abs(actual/expected-1)<.001,section+' calibrated output ratio '+actual/expected);
  } finally {opn.dispose();opna.dispose();}
}

test('real YM2203-mode FM and SSG output levels match their calibrated source',async()=>{
  await compareOutput('fm');
  await compareOutput('ssg');
});
test('real VGM relative FM and SSG volume profiles apply with source correction exactly once',async()=>{
  await compareOutput('fm',1.5);
  await compareOutput('ssg',1.6015625);
});

// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {SOUNDCHIP_MIXER_PRESETS} from '../js/soundchip_mixer_presets.js';
import {createPcEngineSourceMix,readPcEngineSourceMix} from './source_mix.js';

test('PC Engine mixer reuses calibrated source units and retains independent settings without audio',()=>{
  const mix=createPcEngineSourceMix(),defaults=mix.read();
  assert.equal(defaults.huc6280.volume,SOUNDCHIP_MIXER_PRESETS.calibrated.factoryDefaults.kinds.find(x=>x.name==='huc6280').volume);
  assert.equal(defaults.msm5205.volume,1);assert.equal(defaults.cdda.volume,1);
  let changes=0;const off=mix.onChange(()=>changes++);
  mix.set('msm5205',{volume:.25});mix.set('cdda',{muted:true});
  assert.deepEqual(mix.read().huc6280,defaults.huc6280,'untouched source settings keep their value');
  assert.equal(mix.read().msm5205.volume,.25);assert(mix.read().cdda.effectiveMuted);assert.equal(changes,2);
  mix.set('cdda',{muted:true});assert.equal(changes,2);mix.reset();assert.deepEqual(mix.read(),defaults);off();
});

test('invalid mixer patches reject atomically while 380 percent remains an explicit boost',()=>{
  const mix=createPcEngineSourceMix(),before=mix.read();
  for(const patch of [{volume:NaN},{volume:3.81},{muted:1},{pan:.5}])assert.throws(()=>mix.set('cdda',patch));
  assert.throws(()=>mix.set('unknown',{volume:1}));assert.equal(mix.read(),before);
  assert.throws(()=>readPcEngineSourceMix({...before,msm5205:{volume:1,muted:false,pan:.5}}));
  mix.set('cdda',{volume:3.8});assert.equal(mix.read().cdda.volume,3.8);
});

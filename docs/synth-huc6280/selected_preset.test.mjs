// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {createDefaultPreset} from './preset.js';
import {createHuc6280RegisterState} from './song_state.js';
import {prepareHuc6280SelectedPreset as prepare} from './selected_preset.js';
import {wave} from './song_test_helpers.mjs';

function snapshot(channel=0,control=159){
  const state=createHuc6280RegisterState();state.write(1,255);state.write(9,0);state.write(0,channel);
  state.write(4,64);state.write(4,0);for(const value of wave)state.write(6,value);
  state.write(2,254);state.write(3,0);state.write(5,255);if(channel>=4)state.write(7,0);state.write(4,control);
  return structuredClone(state.snapshot(1234));
}
test('Auto saves detached authored settings while a physical CH uses only its own configured wave',()=>{
  const author=createDefaultPreset();author.name='My Auto';
  const auto=prepare({author});assert.equal(auto.sound.name,'My Auto');auto.sound.wave.fill(0);assert.notDeepEqual(auto.sound.wave,author.wave);
  const observed=snapshot(2),before=structuredClone(observed),ch=prepare({target:2,origin:'vgm',author,snapshot:observed});
  assert.equal(ch.sound.name,'VGM CH 3');assert.deepEqual(ch.sound.wave,wave);assert.equal(ch.sound.envelope.enabled,false);
  ch.sound.wave.fill(0);assert.deepEqual(observed,before);assert.equal(author.name,'My Auto');
});
test('Code and normal CH presets preserve software envelope settings, VGM does not invent one',()=>{
  const observed=snapshot();observed.envelopes=[{enabled:true,attack:.2,decay:.3,sustain:.4,release:.5}];
  for(const origin of ['code','synth'])assert.deepEqual(prepare({target:0,origin,snapshot:observed}).sound.envelope,observed.envelopes[0]);
  assert.equal(prepare({target:0,origin:'vgm',snapshot:observed}).sound.envelope.enabled,false);
});
test('unknown waves and physical DDA cannot accidentally save the authored sample',()=>{
  assert.equal(prepare({target:0}).sound,null);
  const author=createDefaultPreset(),dda=prepare({target:0,origin:'code',author,snapshot:snapshot(0,223)});
  assert.equal(dda.sound,null);assert.match(dda.reason,/not a complete sample/);
  const unknown=snapshot();unknown.waveforms[0][3]=null;
  assert.equal(prepare({target:0,author,snapshot:unknown}).sound,null);
});
test('muted configured voices stay saveable and recorded global attenuation is retained conservatively',()=>{
  const observed=snapshot(0,31);observed.globals[1]=0x8b;
  const saved=prepare({target:0,origin:'vgm',snapshot:observed});
  assert(saved.sound);assert.equal(saved.sound.volume,31);assert(saved.warnings.some(value=>/global balance/.test(value)));
  assert(saved.sound.pan.left<=15&&saved.sound.pan.right<=15);
});

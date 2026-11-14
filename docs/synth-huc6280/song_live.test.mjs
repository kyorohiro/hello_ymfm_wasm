// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHuc6280RegisterState} from './song_state.js';
import {huc6280SongLiveView} from './song_live.js';
import {createDefaultPreset} from './preset.js';
import {wave} from './song_test_helpers.mjs';
function setup(){const state=createHuc6280RegisterState(),write=state.write;return{state,write,upload(ch,values=wave){write(0,ch);write(4,64);write(4,0);for(const value of values)write(6,value);}};}
test('unknown VGM RAM/fields remain explicit and never borrow authored waves, software envelope or PCM',()=>{
  const author=createDefaultPreset();author.wave.fill(31);author.lfo.wave.fill(23);author.dda.data='AA==';author.dda.name='Authored PCM';
  const view=huc6280SongLiveView(createHuc6280RegisterState().snapshot(),0,author);
  assert.equal(view.source,'unknown');assert.equal(view.waveKnown,false);assert.equal(view.lfoWaveKnown,false);
  assert.equal(view.preset.dda.data,'');assert.equal(view.preset.dda.name,'');assert.equal(view.preset.envelope.enabled,false);
  assert(view.unknownFields.includes('volume'));assert(view.unknownFields.includes('pan.left'));assert(view.unknownFields.includes('lfo.frequency'));assert(view.unknownFields.includes('dda.rootNote'));
  assert.match(view.readout,/Unknown/);assert.match(view.readout,/not instantaneous/);assert.equal(author.wave[0],31);assert.equal(author.lfo.wave[0],23);
});
test('same editor projection exposes recorded Wave/LFO periods, zero-period4096, volume, pan and gate',()=>{
  const{state,write,upload}=setup();upload(1);upload(0);write(2,0);write(3,0);write(4,159);write(5,0xa7);write(8,5);write(9,3);
  const view=huc6280SongLiveView(state.snapshot(),0);assert.equal(view.source,'wave');assert.equal(view.period,4096);assert.equal(view.gate,true);
  assert.equal(view.waveKnown,true);assert.deepEqual(view.preset.wave,wave);assert.equal(view.preset.volume,31);assert.deepEqual(view.preset.pan,{left:10,right:7});
  assert.equal(view.lfoWaveKnown,true);assert.equal(view.preset.lfo.enabled,true);assert.equal(view.preset.lfo.depth,3);assert.equal(view.preset.lfo.frequency,5);
  assert.match(view.readout,/zero register = 4096/);assert.equal(view.preset.lfo.mode,'recorded');assert.equal(view.observation.kind,'song');
});
test('Noise and DDA show physical source/current recorded DAC only, without inferred sample/pitch/root',()=>{
  const{state,write}=setup();write(0,4);write(7,0x91);write(4,223);write(5,255);write(6,27,123);
  let view=huc6280SongLiveView(state.snapshot(123),4);assert.equal(view.source,'noise','native Noise routing takes precedence over DDA');assert.equal(view.preset.noise.frequency,17);
  write(7,0);view=huc6280SongLiveView(state.snapshot(123),4);assert.equal(view.source,'dda');assert.equal(view.ddaValue,27);assert.equal(view.ddaLastFrame,123);assert.equal(view.ddaWrites,1);assert.equal(view.ddaActive,true);
  assert.equal(view.preset.dda.data,'');assert(view.unknownFields.includes('dda.sampleRate'));assert(view.unknownFields.includes('dda.rootNote'));assert.match(view.readout,/last recorded DAC 27/);
});

// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {createDefaultPreset,readPreset,presetToCode} from './preset.js';

test('SID v1 default is portable, detached and keeps dormant filter settings',()=>{
  const preset=createDefaultPreset(),copy=readPreset(JSON.stringify(preset));assert.deepEqual(copy,preset);
  assert.equal(copy.format,'tetorica-sid-voice');assert.equal(copy.version,1);assert.equal(copy.name,'Saw');
  assert.deepEqual(copy.modulation,{sync:false,ring:false,ratio:1});assert.equal(copy.filter.enabled,false);assert.equal(copy.filter.mode,'lowpass');
  copy.voice.attack=15;copy.modulation.ratio=8;copy.filter.cutoff=0;
  assert.equal(preset.voice.attack,2);assert.equal(preset.modulation.ratio,1);assert.equal(preset.filter.cutoff,600);
  assert.deepEqual(createDefaultPreset(),preset);
});

test('SID preset fields reject unknown keys, coercions, unsafe names and unsupported versions',()=>{
  const mutations=[p=>p.extra=1,p=>delete p.voice,p=>p.format='sid',p=>p.version=2,p=>p.version='1',
    p=>p.name=1,p=>p.name='a'.repeat(81),p=>p.name='bad\nname',p=>p.name='bad\u2028name',p=>p.name='bad\u0085name',
    p=>p.voice.extra=true,p=>delete p.voice.test,p=>p.voice.waveform='combined',p=>p.voice.waveform='off',
    p=>p.voice.pulseWidth=-1,p=>p.voice.pulseWidth=4096,p=>p.voice.pulseWidth=1.5,p=>p.voice.pulseWidth='2048',
    p=>p.voice.attack=16,p=>p.voice.decay=-1,p=>p.voice.sustain=NaN,p=>p.voice.release=Infinity,p=>p.voice.test=1,
    p=>p.modulation.sync='true',p=>p.modulation.ring=0,p=>p.modulation.ratio=.124,p=>p.modulation.ratio=8.001,
    p=>p.modulation.ratio=NaN,p=>p.modulation.ratio=Infinity,p=>p.modulation.ratio='1',p=>p.modulation.extra=0,
    p=>p.filter.enabled=1,p=>p.filter.mode='off',p=>p.filter.mode='LP',p=>p.filter.cutoff=2048,p=>p.filter.cutoff=-1,
    p=>p.filter.resonance=16,p=>p.filter.volume=16,p=>p.filter.routing=7,p=>p.filter.volume=.5];
  for(const mutate of mutations){const preset=createDefaultPreset();mutate(preset);assert.throws(()=>readPreset(preset));assert.throws(()=>presetToCode(preset));}
  for(const value of [null,[],true,5,'{broken',new Date()])assert.throws(()=>readPreset(value));
  const inherited=Object.create(createDefaultPreset());assert.throws(()=>readPreset(inherited));
  const symbol=createDefaultPreset();symbol[Symbol('extra')]=1;assert.throws(()=>readPreset(symbol));
  let read=0;const accessor=createDefaultPreset();Object.defineProperty(accessor,'name',{enumerable:true,get(){read++;return 'side effect';}});
  assert.throws(()=>readPreset(accessor),/accessors/);assert.equal(read,0);
});

test('all four waveforms and filter modes retain exact register parameter boundaries',()=>{
  for(const waveform of ['triangle','saw','pulse','noise'])for(const mode of ['lowpass','bandpass','highpass','notch']){
    const preset=createDefaultPreset();Object.assign(preset.voice,{waveform,pulseWidth:4095,attack:15,decay:15,sustain:15,release:15,test:true});
    Object.assign(preset.modulation,{sync:true,ring:true,ratio:8});Object.assign(preset.filter,{enabled:true,mode,cutoff:2047,resonance:15,volume:15});
    assert.deepEqual(readPreset(preset),preset);
    Object.assign(preset.voice,{pulseWidth:0,attack:0,decay:0,sustain:0,release:0});preset.modulation.ratio=.125;
    Object.assign(preset.filter,{cutoff:0,resonance:0,volume:0});assert.deepEqual(readPreset(preset),preset);
  }
});

test('readable JavaScript identifies software allocation/ratio and uses the physical silent source',()=>{
  const preset=createDefaultPreset();let code=presetToCode(preset);
  assert(code.includes('sid.initialize();'));assert(code.includes("sid.noteOn(0, 'C4');"));assert(!code.includes('liveLoop('));
  assert(code.includes('Software:'));assert(code.includes('"routing":0'));assert(code.includes('"mode":"off"'));
  preset.modulation={sync:true,ring:true,ratio:1.75};preset.filter.enabled=true;code=presetToCode(preset);
  assert(code.includes('oscillator 3 -> carrier 1'));assert(code.includes('carrierHz * 1.75'));
  assert(code.includes('"routing":1'));assert(code.includes('"voice3off":true'));assert(code.includes('sid.keyOn(0);'));
  assert(!code.includes('sid.keyOn(2)'));assert(!code.includes('sid.noteOn(2'));
  assert(code.includes('sid.setVoice(2, {"waveform":"triangle"'));assert(code.includes('Gate OFF'));
});

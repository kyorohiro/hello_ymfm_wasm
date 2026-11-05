// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createDefaultPreset, readPreset, waveShape, presetToCode} from './preset.js';

test('portable HuC6280 preset owns all waves, routing and software envelope values', () => {
  const source = createDefaultPreset(); source.name = '  Five bit  '; source.source = 'noise';
  source.lfo.enabled = true; source.lfo.wave = waveShape('saw'); source.pan.right = 4;
  source.envelope = {enabled:true,attack:.1,decay:.4,sustain:.35,release:.8};
  const copy = readPreset(JSON.parse(JSON.stringify(source)));
  assert.deepEqual(copy, {...source,name:'Five bit'});
  copy.wave[0] = 2; copy.lfo.wave[0] = 12; copy.pan.left = 5; copy.envelope.release = 4;
  assert.notEqual(source.wave[0],2); assert.equal(source.lfo.wave[0],0); assert.equal(source.pan.left,15); assert.equal(source.envelope.release,.8);
});

test('malformed full presets reject ambiguous shapes, sparse waves and invalid hardware fields', () => {
  const edits = [p=>p.extra=1,p=>delete p.envelope,p=>p.format='other',p=>p.version=2,p=>p.source='dda',
    p=>p.volume=32,p=>p.volume=3.5,p=>p.pan.left=-1,p=>p.pan.right=16,p=>p.noise.frequency=32,
    p=>p.lfo.enabled=1,p=>p.lfo.depth=0,p=>p.lfo.depth=4,p=>p.lfo.frequency=256,p=>p.lfo.rate=4,
    p=>p.wave.pop(),p=>p.wave[2]=32,p=>p.wave[2]=NaN,p=>delete p.wave[3],p=>p.wave.foo=2,
    p=>p.lfo.wave[3]=-1,p=>delete p.lfo.wave[4],p=>p.envelope.attack=Infinity,p=>p.envelope.decay=-1,
    p=>p.envelope.release=10.01,p=>p.envelope.sustain=1.01,p=>p.envelope.enabled='true',
    p=>p.name='bad\ncode',p=>p.name='bad\u2028code',p=>p.name='x'.repeat(81),p=>Object.setPrototypeOf(p,{wave:[]})];
  for (const edit of edits) {const preset=createDefaultPreset();edit(preset);assert.throws(()=>readPreset(preset));}
});

test('waveform helpers quantize exactly 32 five-bit values without aliasing', () => {
  for (const name of ['sine','triangle','saw','square']) {
    const values=waveShape(name);assert.equal(values.length,32);
    assert(values.every(value=>Number.isInteger(value)&&value>=0&&value<=31));
    values[0]=100;assert.notEqual(waveShape(name)[0],100);
  }
  assert.deepEqual(waveShape('square'),Array(16).fill(31).concat(Array(16).fill(0)));
  assert.throws(()=>waveShape('noise'));
});

test('copied JavaScript uses the initialized pce API and documents host-only ADSR', () => {
  for (const source of ['wave','noise']) for (const enabled of [false,true]) {
    const preset=createDefaultPreset();preset.source=source;preset.lfo.enabled=enabled;
    preset.pan.left=7;preset.pan.right=15;
    const calls=[],fn=name=>(...args)=>calls.push([name,...args]);
    const pce=Object.fromEntries(['allNotesOff','setMasterVolume','setLfo','setDda','setNoise','setWaveform','setVolume','setPan','setNote','noteOn','keyOn'].map(name=>[name,fn(name)]));
    const code=presetToCode(preset);vm.runInNewContext(code,{pce});
    assert.match(code,/Software envelope are host features/);
    const channel=source==='noise'?4:0;
    assert.deepEqual(calls.find(call=>call[0]==='setPan'),['setPan',channel,7,15]);
    assert.deepEqual(calls.at(-1),source==='noise'?['keyOn',4]:['noteOn',0,'C4']);
    const lfoWrites=calls.filter(call=>call[0]==='setLfo');
    assert.equal(lfoWrites.length,source==='wave'&&enabled?2:1);
    if(source==='wave'&&enabled)assert(calls.some(call=>call[0]==='setVolume'&&call[1]===1&&call[2]===0));
  }
});

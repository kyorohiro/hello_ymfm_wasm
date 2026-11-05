// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createDefaultPreset, readPreset, waveShape, presetToCode} from './preset.js';
import {createDefaultDda, encodeDdaData} from './dda_pcm.js';

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
  const edits = [p=>p.extra=1,p=>delete p.envelope,p=>p.format='other',p=>p.version=4,p=>p.source='cdda',
    p=>p.volume=32,p=>p.volume=3.5,p=>p.pan.left=-1,p=>p.pan.right=16,p=>p.noise.frequency=32,
    p=>p.lfo.enabled=1,p=>p.lfo.depth=0,p=>p.lfo.depth=4,p=>p.lfo.frequency=256,p=>p.lfo.rate=4,
    p=>p.wave.pop(),p=>p.wave[2]=32,p=>p.wave[2]=NaN,p=>delete p.wave[3],p=>p.wave.foo=2,
    p=>p.lfo.wave[3]=-1,p=>delete p.lfo.wave[4],p=>p.envelope.attack=Infinity,p=>p.envelope.decay=-1,
    p=>p.lfo.mode='fixed',p=>p.lfo.carrierPeriod=0,p=>p.lfo.carrierPeriod=4097,p=>p.lfo.modulatorPeriod=1.5,
    p=>p.lfo.reset=1,p=>p.lfo.output.enabled=0,p=>p.lfo.output.volume=32,p=>p.lfo.output.pan.left=16,
    p=>p.lfo.output.extra=1,p=>delete p.lfo.output.pan,p=>delete p.lfo.reset,
    p=>p.envelope.release=10.01,p=>p.envelope.sustain=1.01,p=>p.envelope.enabled='true',
    p=>p.name='bad\ncode',p=>p.name='bad\u2028code',p=>p.name='x'.repeat(81),p=>Object.setPrototypeOf(p,{wave:[]})];
  for (const edit of edits) {const preset=createDefaultPreset();edit(preset);assert.throws(()=>readPreset(preset));}
});

test('version one migrates to canonical v3 with the original follow and muted CH2 behavior', () => {
  const old=createDefaultPreset();old.version=1;delete old.dda;
  old.lfo={enabled:true,frequency:13,depth:2,wave:waveShape('saw')};
  const copy=structuredClone(old),migrated=readPreset(old);
  assert.deepEqual(old,copy);assert.equal(migrated.version,3);assert.deepEqual(migrated.dda,createDefaultDda());
  assert.deepEqual(migrated.lfo,{...old.lfo,mode:'follow',carrierPeriod:428,modulatorPeriod:428,reset:false,
    output:{enabled:false,volume:0,pan:{left:15,right:15}}});
  assert.deepEqual(readPreset(migrated),migrated);
  old.lfo.mode='follow';assert.throws(()=>readPreset(old),/unexpected or missing/);
});

test('version two LFO presets migrate without changing the recorded pair',()=>{
  const old=createDefaultPreset();old.version=2;delete old.dda;
  Object.assign(old.lfo,{enabled:true,mode:'recorded',carrierPeriod:701,modulatorPeriod:913,reset:true});
  old.lfo.output={enabled:true,volume:17,pan:{left:6,right:14}};
  const migrated=readPreset(old);assert.equal(migrated.version,3);assert.deepEqual(migrated.lfo,old.lfo);
  assert.deepEqual(migrated.dda,createDefaultDda());
});

test('DDA v3 presets retain five-bit bytes and reject malformed payloads or controls atomically',()=>{
  const preset=createDefaultPreset();preset.source='dda';
  preset.dda={name:'voice.wav',data:encodeDdaData(Uint8Array.from([0,15,16,31])),sampleRate:11025,rootNote:60,loop:true,speed:1.5};
  assert.deepEqual(readPreset(JSON.parse(JSON.stringify(preset))),preset);
  for(const mutate of [p=>delete p.dda,p=>p.dda.extra=1,p=>p.dda.data='IA==',p=>p.dda.data='not base64',
    p=>p.dda.sampleRate=0,p=>p.dda.sampleRate=192001,p=>p.dda.sampleRate=NaN,
    p=>p.dda.rootNote=-1,p=>p.dda.rootNote=128,p=>p.dda.loop=1,p=>p.dda.speed=.124,p=>p.dda.speed=4.01,
    p=>p.dda.speed=NaN,p=>p.dda.name='x'.repeat(121),p=>p.dda.name='bad\nname']) {
    const copy=structuredClone(preset);mutate(copy);assert.throws(()=>readPreset(copy));
  }
  const code=presetToCode(preset);
  assert.match(code,/not a one-register Playground audition/);assert.match(code,/Huc6280Instrument/);
  assert(!code.includes('setInterval('));
  assert.deepEqual(JSON.parse(JSON.stringify(vm.runInNewContext(`${code}\nddaPreset;`))),preset);
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

test('DDA presets retain low recorded stream rates without changing audio-conversion limits', () => {
  const preset=createDefaultPreset();preset.source='dda';
  for (const rate of [1,5512.5,44100/13,7000,44100,192000]) {
    preset.dda.sampleRate=rate;assert.equal(readPreset(preset).dda.sampleRate,rate);
  }
  for (const rate of [0,192001,NaN,Infinity]) {
    preset.dda.sampleRate=rate;assert.throws(()=>readPreset(preset),/sample rate/);
  }
});

test('recorded JavaScript retains exact periods, held reset and both outputs without retuning C4', () => {
  const preset=createDefaultPreset();preset.lfo={...preset.lfo,enabled:true,mode:'recorded',carrierPeriod:4096,
    modulatorPeriod:913,frequency:7,depth:2,reset:true,output:{enabled:true,volume:19,pan:{left:13,right:15}}};
  const calls=[],fn=name=>(...args)=>calls.push([name,...args]);
  const pce=Object.fromEntries(['allNotesOff','setMasterVolume','setLfo','setDda','setNoise','setWaveform','setVolume','setPan','setNote','noteOn','keyOn','writeRegister'].map(name=>[name,fn(name)]));
  const code=presetToCode(preset);vm.runInNewContext(code,{pce});
  assert.deepEqual(calls.filter(call=>call[0]==='writeRegister'),[
    ['writeRegister',0,0],['writeRegister',2,0],['writeRegister',3,0],
    ['writeRegister',0,1],['writeRegister',2,145],['writeRegister',3,3],
  ]);
  assert(!calls.some(call=>['setNote','noteOn'].includes(call[0])));
  assert(calls.some(call=>JSON.stringify(call)===JSON.stringify(['setLfo',{frequency:7,depth:2,reset:true}])));
  assert(calls.some(call=>JSON.stringify(call)===JSON.stringify(['setVolume',1,19])));
  assert(calls.some(call=>JSON.stringify(call)===JSON.stringify(['setPan',1,13,15])));
  assert.deepEqual(calls.filter(call=>call[0]==='keyOn'),[['keyOn',1],['keyOn',0]]);
  assert.match(code,/pce\.keyOff\(0\); pce\.keyOff\(1\)/);
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

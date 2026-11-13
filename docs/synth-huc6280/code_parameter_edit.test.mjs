import test from 'node:test';
import assert from 'node:assert/strict';
import {createHuc6280CodeEdit} from './code_parameter_edit.js';
import {createDefaultPreset,readPreset} from './preset.js';
import {encodeDdaData} from './dda_pcm.js';

test('one deliberate scalar edit does not resend source, tuning, envelope, wave or sample data',()=>{
  const previous=createDefaultPreset(),next=readPreset(previous);next.volume=12;
  assert.deepEqual(createHuc6280CodeEdit(previous,next,3),{channel:3,changes:{volume:12}});
  next.pan.left=7;next.noise.frequency=25;
  assert.deepEqual(createHuc6280CodeEdit(previous,next,5),{channel:5,changes:{volume:12,'pan.left':7,'noise.frequency':25}});
});

test('carrier/modulator drawing sends detached changed wave arrays without unrelated LFO fields',()=>{
  const previous=createDefaultPreset(),next=readPreset(previous);next.wave[7]=3;next.lfo.wave[9]=4;
  const edit=createHuc6280CodeEdit(previous,next,0);
  assert.deepEqual(edit,{channel:0,changes:{wave:next.wave,'lfo.wave':next.lfo.wave}});
  next.wave[7]=31;next.lfo.wave[9]=31;assert.equal(edit.changes.wave[7],3);assert.equal(edit.changes['lfo.wave'][9],4);
  assert.deepEqual(previous,createDefaultPreset(),'comparison never modifies the authored baseline');
});

test('unchanged large DDA data is never serialized into a small live patch',()=>{
  const value=createDefaultPreset();value.source='dda';value.dda.data=encodeDdaData(new Uint8Array(262144).fill(16));
  const previous=new Proxy(value,{get(target,key){if(key==='toJSON')throw Error('Full preset must not be serialized for live edits');return target[key];}});
  const next=readPreset(value);next.dda.speed=2;next.envelope.release=.2;
  const edit=createHuc6280CodeEdit(previous,next,4);
  assert.deepEqual(edit,{channel:4,changes:{'envelope.release':.2,'dda.speed':2}});
  assert(!Object.hasOwn(edit.changes,'dda.data'));assert.equal(value.dda.data,next.dda.data);
});

test('source changes and genuinely new DDA data remain explicit without sending unchanged metadata',()=>{
  const previous=createDefaultPreset(),next=readPreset(previous);next.source='dda';next.dda.data=encodeDdaData(Uint8Array.of(0,7,16,31));next.dda.rootNote=57;
  assert.deepEqual(createHuc6280CodeEdit(previous,next,2),{channel:2,changes:{source:'dda','dda.data':next.dda.data,'dda.rootNote':57}});
  const saved=readPreset(next);saved.name='Renamed only';
  assert.equal(createHuc6280CodeEdit(next,saved,2),null,'file name changes do not rewrite physical sound registers');
});

test('unchanged values including detached wave arrays produce no patch, and CH bounds are physical',()=>{
  const previous=createDefaultPreset(),next=readPreset(previous);assert.notEqual(previous.wave,next.wave);
  assert.equal(createHuc6280CodeEdit(previous,next,0),null);
  for(const invalid of [-1,6,7,.5,'1',null,NaN])assert.throws(()=>createHuc6280CodeEdit(previous,next,invalid),/channel/);
});

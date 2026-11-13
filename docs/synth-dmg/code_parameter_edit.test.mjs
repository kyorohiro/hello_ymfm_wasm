// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {createDefaultPreset} from './preset.js';
import {createGameboyCodeEdit,applyGameboyCodeEdit,readGameboyCodeEdit} from './code_parameter_edit.js';

test('selected-channel leaf changes never copy other observed Code values into the saved author preset',()=>{
  const author=createDefaultPreset(),before=structuredClone(author);before.pulse.duty=.75;before.pulse.volume=13;before.pan.left=false;
  const after=structuredClone(before);after.pulse.duty=.25;
  const edit=createGameboyCodeEdit(before,after,1);assert.deepEqual(edit,{channel:1,changes:{'pulse.duty':.25}});
  const saved=applyGameboyCodeEdit(author,edit);assert.equal(saved.pulse.duty,.25);assert.equal(saved.pulse.volume,author.pulse.volume);assert.deepEqual(saved.pan,author.pan);
  assert.equal(author.pulse.duty,createDefaultPreset().pulse.duty);assert.deepEqual(createGameboyCodeEdit(before,before,1),{channel:1,changes:{}});
});

test('Noise and Wave edits retain the authored source and own every transferred array',()=>{
  const author=createDefaultPreset(),before=structuredClone(author);before.source='noise';before.noise.width=7;
  const after=structuredClone(before);after.noise.shift=8;
  const saved=applyGameboyCodeEdit(author,createGameboyCodeEdit(before,after,3));assert.equal(saved.source,author.source);assert.equal(saved.noise.shift,8);assert.equal(saved.noise.width,author.noise.width);
  const wave=structuredClone(author);wave.source='wave';const drawn=structuredClone(wave);drawn.wave.samples[0]=15;
  const edit=createGameboyCodeEdit(wave,drawn,2),copy=readGameboyCodeEdit(edit);copy.changes['wave.samples'][0]=0;
  assert.equal(edit.changes['wave.samples'][0],15);assert.equal(applyGameboyCodeEdit(author,edit).wave.samples[0],15);
});

test('invalid values, Source/name changes, other physical sources and CH2 Sweep reject before author mutation',()=>{
  const author=createDefaultPreset(),before=structuredClone(author);
  for(const edit of [{channel:1,changes:{'pulse.sweep.period':3}},{channel:0,changes:{'noise.width':7}},
    {channel:2,changes:{'wave.samples':Array(31).fill(0)}},{channel:3,changes:{'noise.divisor':8}},
    {channel:0,changes:{'pulse.duty':.3}},{channel:4,changes:{}},{channel:0,changes:{'__proto__.x':1}}])assert.throws(()=>applyGameboyCodeEdit(author,edit));
  const name=structuredClone(author);name.name='Other';assert.throws(()=>createGameboyCodeEdit(author,name,0));
  const source=structuredClone(author);source.source='noise';assert.throws(()=>createGameboyCodeEdit(author,source,0));
  const sweep=structuredClone(author);sweep.pulse.sweep.period=1;assert.throws(()=>createGameboyCodeEdit(author,sweep,1));
  assert.deepEqual(author,before);
});

test('parameter edit validation never invokes payload getters',()=>{
  let reads=0;const changes={};Object.defineProperty(changes,'pulse.duty',{enumerable:true,get(){reads++;return .25;}});
  assert.throws(()=>readGameboyCodeEdit({channel:0,changes}));assert.equal(reads,0);
  const edit={changes:{}};Object.defineProperty(edit,'channel',{enumerable:true,get(){reads++;return 0;}});
  assert.throws(()=>readGameboyCodeEdit(edit));assert.equal(reads,0);
});

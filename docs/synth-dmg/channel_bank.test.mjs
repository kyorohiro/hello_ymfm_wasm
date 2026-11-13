// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {createDefaultPreset} from './preset.js';
import {createGameboyChannelBank,readGameboyChannelBank,applyGameboyChannelEdit,updateGameboyChannelBank} from './channel_bank.js';

test('a private bank has four detached physical-source presets without extending the portable schema',()=>{
  const preset=createDefaultPreset();preset.pulse.sweep.enabled=true;
  const bank=createGameboyChannelBank(preset);
  assert.deepEqual(bank.map(value=>value.source),['pulse','pulse','wave','noise']);
  assert(bank[0].pulse.sweep.enabled);assert(!bank[1].pulse.sweep.enabled);
  assert.deepEqual(Object.keys(bank[0]),Object.keys(preset));
  bank[2].wave.samples[0]=15;bank[0].pan.left=false;
  assert.notEqual(bank[1].wave.samples[0],15);assert(preset.pan.left);
  const copy=readGameboyChannelBank(bank);copy[0].pulse.volume=2;assert.equal(bank[0].pulse.volume,10);
});

test('a fixed-channel edit keeps every other channel and untouched field independent',()=>{
  const original=createGameboyChannelBank(createDefaultPreset()),before=structuredClone(original);
  const bank=applyGameboyChannelEdit(original,{channel:1,changes:{'pulse.duty':.75,'pulse.volume':6,'pan.left':false}});
  assert.deepEqual(original,before);for(const channel of [0,2,3])assert.deepEqual(bank[channel],original[channel]);
  assert.equal(bank[1].pulse.duty,.75);assert.equal(bank[1].pulse.volume,6);assert(!bank[1].pan.left);assert(bank[1].pan.right);
  for(const edit of [{channel:1,changes:{'pulse.sweep.enabled':true}},{channel:0,changes:{'wave.level':1}},{channel:2,changes:{'wave.samples':[1]}}])assert.throws(()=>applyGameboyChannelEdit(bank,edit));
  assert.throws(()=>readGameboyChannelBank([bank[1],bank[2],bank[0],bank[3]]),/physical channel/);
  assert.throws(()=>readGameboyChannelBank(Array(4)),/preset/);
});

test('round-robin source selection is passive and an edit broadcasts only its changed compatible fields',()=>{
  const previous=createDefaultPreset();let bank=createGameboyChannelBank(previous);
  bank=applyGameboyChannelEdit(bank,{channel:0,changes:{'pulse.duty':.125,'pulse.volume':5,'pan.left':false}});
  bank=applyGameboyChannelEdit(bank,{channel:1,changes:{'pulse.duty':.75,'pulse.volume':12}});
  const selected={...previous,source:'wave'};assert.deepEqual(updateGameboyChannelBank(bank,previous,selected),bank);
  const next=structuredClone(selected);next.pulse.volume=8;next.wave.level=1;
  const changed=updateGameboyChannelBank(bank,selected,next);
  assert.deepEqual(changed.slice(0,2).map(value=>[value.pulse.duty,value.pulse.volume]),[[.125,8],[.75,8]]);
  assert(!changed[0].pan.left);assert(changed[1].pan.left);assert.equal(changed[2].wave.level,1);assert.deepEqual(changed[3],bank[3]);
  const pan=structuredClone(next);pan.pan.right=false;
  assert(updateGameboyChannelBank(changed,next,pan).every(value=>!value.pan.right));
  const name=structuredClone(pan);name.name='One author label';assert(updateGameboyChannelBank(changed,next,name).every(value=>value.name===name.name));
});

test('an explicit full preset replacement reseeds the private bank and rejects malformed input first',()=>{
  const previous=createDefaultPreset(),bank=applyGameboyChannelEdit(createGameboyChannelBank(previous),{channel:1,changes:{'pulse.duty':.125}});
  const next=structuredClone(previous);next.pulse.duty=.75;next.wave.level=.25;
  assert.deepEqual(updateGameboyChannelBank(bank,previous,next,{replace:true}),createGameboyChannelBank(next));
  assert.throws(()=>updateGameboyChannelBank(bank,previous,{...next,pan:{left:1,right:true}},{replace:true}));
  assert.throws(()=>updateGameboyChannelBank(bank,previous,next,{replace:1}));
});

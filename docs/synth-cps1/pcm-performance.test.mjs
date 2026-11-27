// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {createKit} from './kit.js';
import {Oki6295AudioEngine} from '../js/okim6295audioengine.js';
import {writePerformanceCommand} from './pcm-performance.js';

test('one start can use separate live assignments, preserve busy voices and release them normally',()=>{
  const chip=new Oki6295AudioEngine({clock:1000000});
  chip.loadOki6295Rom(createKit());
  const send=(byte,samples,level)=>writePerformanceCommand(chip,byte,samples,level);
  send(0x81);send(0x13); // Voice 1 is already playing sample 1.
  send(0x82);send(0x75,[3,0,null,null],0);
  assert.deepEqual(chip.voices.slice(0,3).map(v=>[v.sample,v.attenuation,v.requestedSample]),[[1,3,3],[0,0,0],[2,0,2]]);
  assert.equal(chip.pending,-1);
  send(0x38);
  assert.equal(chip.readStatus(),0xf0);
  send(0x83);send(0x24);
  assert.equal(chip.voices[1].sample,3);
  assert.equal(chip.voices[1].attenuation,4);
});

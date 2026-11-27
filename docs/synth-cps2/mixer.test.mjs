// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultMix,mutedVoices,validateMix} from './mixer.js';
import {QSoundPcm} from '../js/qsoundpcm.js';
import {demoRom,noteWrites,adpcmTriggerWrites} from './demo.js';

test('solos can be combined across PCM and ADPCM while preserving explicit mutes',()=>{
  const mix=defaultMix();
  mix.mutes[0]=true;
  mix.solos[0]=mix.solos[15]=mix.solos[17]=true;
  const enabled=()=>mutedVoices(mix).flatMap((mute,i)=>mute?[]:[i]);
  assert.deepEqual(enabled(),[15,17]);
  mix.solos.fill(false);
  assert.equal(enabled().length,18);
  assert.ok(!enabled().includes(0));
  assert.deepEqual(validateMix(),defaultMix());
});

test('muted voices resume at the same PCM address and ADPCM decoder step as uninterrupted playback',()=>{
  const chips=[new QSoundPcm(demoRom()),new QSoundPcm(demoRom())];
  for(const chip of chips)for(const [r,v] of [...noteWrites(2,50,0,5,8000),...adpcmTriggerWrites(2,1,25,30000)])chip.writeRegister(r,v);
  for(const i of [2,18])chips[0].setChannelMuted(i,true);
  for(let t=0;t<260;t++){
    for(const chip of chips)chip.tick();
    assert.equal(chips[0].left,0);
  }
  for(const i of [2,18])chips[0].setChannelMuted(i,false);
  for(let t=0;t<160;t++){
    for(const chip of chips)chip.tick();
    assert.deepEqual([chips[0].left,chips[0].right],[chips[1].left,chips[1].right]);
  }
});

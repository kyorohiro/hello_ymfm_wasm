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

test('linear pan monitor compares the same PCM voice without changing its phase or register state',()=>{
  const make=spatialPcm=>new QSoundPcm(demoRom(),44100,{spatialPcm});
  const monitor=make(true),linear=make(false),spatial=make(true);
  for(const chip of [monitor,linear,spatial])
    for(const [reg,value] of noteWrites(0,72,1,0,6000))chip.writeRegister(reg,value);
  let heardLeft=false,heardFilteredRight=false;
  for(let tick=0;tick<300;tick++){
    monitor.linearPanMonitor=tick<150;
    for(const chip of [monitor,linear,spatial])chip.tick();
    const reference=monitor.linearPanMonitor?linear:spatial;
    assert.equal(monitor.left,reference.left);
    assert.equal(monitor.right,reference.right);
    if(tick<150 && monitor.left)heardLeft=true;
    if(tick>=150 && monitor.right)heardFilteredRight=true;
  }
  assert(heardLeft && heardFilteredRight);
  assert.deepEqual(monitor.lastWrites,spatial.lastWrites);
});

test('manual delay sweeps crossfade repeats and settle on the last register value',()=>{
  const raw=new QSoundPcm(new Uint8Array(0)), manual=new QSoundPcm(new Uint8Array(0));
  let prevRaw=0,prevManual=0,rawJump=0,manualJump=0;
  for(let tick=0;tick<8000;tick++){
    if(tick>=1200 && tick<5700 && tick%140===0){
      const length=20+(tick/140*91)%700;
      raw.writeRegister(0xd9,raw.echoBase+length);
      manual.setManualEchoDelay(length);
      assert.equal(manual.lastWrites[0xd9],raw.lastWrites[0xd9]);
    }
    const input=Math.round(7000*Math.sin(tick*.049))*65536;
    const a=raw.advanceEcho(input),b=manual.advanceEcho(input);
    rawJump=Math.max(rawJump,Math.abs(a-prevRaw));
    manualJump=Math.max(manualJump,Math.abs(b-prevManual));
    prevRaw=a;prevManual=b;
    if(tick>7500)assert.equal(a,b);
  }
  assert(rawJump>6000);
  assert(manualJump<450);
  manual.setManualEchoDelay(0);
  manual.writeRegister(0xd9,manual.echoBase+6);
  assert.equal(manual.echoTransition,null);
});

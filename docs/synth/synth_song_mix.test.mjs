import test from 'node:test';
import assert from 'node:assert/strict';
import {createSynthSongMix} from './synth_song_mix.js';

const fullHeader = {ym2612Clock:7670454,psgClock:3579545,rf5c164Clock:12500000,pwmClock:23011361};

test('reference mix exposes only the song chips, including physical DAC and stereo PWM outputs', () => {
  const mix = createSynthSongMix();
  assert.deepEqual(mix.getState().channels,[]);
  mix.configure(fullHeader);
  const state = mix.getState();
  assert.equal(state.channels.length,20);
  assert.deepEqual(state.channels.map(channel => channel.id),[
    ...Array.from({length:6},(_,i)=>`ym2612:${i}`),...Array.from({length:4},(_,i)=>`psg:${i}`),
    ...Array.from({length:8},(_,i)=>`pcm:${i}`),'pwm:0','pwm:1']);
  assert.equal(state.channels.find(channel=>channel.id==='ym2612:5').label,'CH6 / DAC');
  assert.match(state.channels.find(channel=>channel.id==='pwm:0').label,/output/);
  assert(state.channels.every(channel=>!channel.muted&&!channel.effectiveMuted));
  assert.deepEqual(state.groups,[{id:'ym2612',label:'YM2612',volume:1},
    {id:'psg',label:'Sega PSG',volume:1},{id:'pcm',label:'Mega CD PCM',volume:1},{id:'pwm',label:'32X PWM'}]);
  assert.deepEqual(mix.getGroupVolumes(),{ym2612:1,psg:1,pcm:1});
  assert.equal(state.changed,false);
  assert(Object.isFrozen(state.channels[0]));
  assert(Object.isFrozen(state.groups[0]));
  assert(Object.isFrozen(state.groups));
  mix.configure({psgClock:3579545});
  assert.deepEqual(mix.getState().channels.map(channel=>channel.id),['psg:0','psg:1','psg:2','psg:3']);
  assert.equal(mix.getMutedChannels().length,16,'undeclared endpoints stay silent too');
  assert.deepEqual(mix.getState().groups,[{id:'psg',label:'Sega PSG',volume:1}]);
  assert.deepEqual(mix.getGroupVolumes(),{psg:1});
  assert(mix.getMutedChannels().includes('ym2612:5'),'undeclared YM2612 cannot leak DAC discontinuity');
  assert(!mix.getMutedChannels().includes('psg:3'));
});

test('channel mutes remain independent from source volumes; Reset restores both', () => {
  const mix = createSynthSongMix();mix.configure(fullHeader);
  const audible = () => mix.getState().channels.filter(channel=>!channel.effectiveMuted).map(channel=>channel.id);
  mix.setChannelMuted('ym2612:1',true);mix.setChannelMuted('pwm:1',true);
  mix.setChannelMuted('pcm:6',true);
  mix.setGroupVolume('ym2612',3.8);mix.setGroupVolume('psg',0);mix.setGroupVolume('pcm',.25);
  assert.equal(audible().length,17,'group gain does not rewrite per-channel mute choices');
  assert.deepEqual(mix.getGroupVolumes(),{ym2612:3.8,psg:0,pcm:.25});
  assert.equal(mix.getState().changed,true);
  mix.setChannelMuted('ym2612:1',false);
  assert.equal(audible().length,18);
  assert.equal(mix.getState().groups[0].volume,3.8);
  assert.equal(mix.reset(),true);assert.equal(audible().length,20);
  assert.deepEqual(mix.getGroupVolumes(),{ym2612:1,psg:1,pcm:1});
  mix.setGroupVolume('psg',.5);
  assert.equal(mix.getState().changed,true,'a gain-only edit enables Reset');
  assert.equal(mix.reset(),true);
  assert.equal(mix.reset(),false);
});

test('same-song configuration retains choices; source clearing and unavailable channels remove them', () => {
  const mix = createSynthSongMix();mix.configure(fullHeader);
  mix.setChannelMuted('psg:3',true);mix.setGroupVolume('psg',2);mix.setGroupVolume('pcm',0);
  const previous = mix.getState();
  mix.configure({...fullHeader});
  assert.equal(mix.getState(),previous,'same header does not discard stopped-song mix');
  mix.configure({psgClock:3579545});
  assert.equal(mix.getState().channels.at(-1).muted,true);
  assert.deepEqual(mix.getGroupVolumes(),{psg:2},'remaining sources keep their gain; absent sources are forgotten');
  assert.throws(()=>mix.setChannelMuted('pwm:0',true),/Unknown reference channel/);
  assert.throws(()=>mix.setChannelMuted('psg:0',1),/boolean/);
  assert.equal(mix.setChannelMuted('psg:3',true),false);
  mix.clear();mix.configure(fullHeader);
  assert.equal(mix.getState().changed,false,'a new file starts with all outputs enabled');
  assert.deepEqual(mix.getGroupVolumes(),{ym2612:1,psg:1,pcm:1},'new source gains start at 100%');
  assert.equal(previous.channels.find(channel=>channel.id==='psg:3').muted,true,'old snapshots remain immutable');
  assert.equal(previous.groups.find(group=>group.id==='psg').volume,2);
});

test('group volume validation is atomic and externally returned maps cannot change playback choices',()=>{
  const mix=createSynthSongMix();mix.configure(fullHeader);mix.setGroupVolume('psg',.6);
  const original=mix.getState();
  for(const gain of [-1,3.80001,NaN,Infinity,'1',null]) {
    assert.throws(()=>mix.setGroupVolume('psg',gain),/0\.\.3\.8/);
    assert.equal(mix.getState(),original);
  }
  for(const id of ['pwm','ym2612:0','missing'])assert.throws(()=>mix.setGroupVolume(id,1),/Unknown reference volume group/);
  const detached=mix.getGroupVolumes();detached.psg=3.8;
  assert.equal(mix.getState().groups[1].volume,.6);
  assert.equal(mix.setGroupVolume('psg',.6),false);
  mix.configure({pwmClock:23011361});
  assert.deepEqual(mix.getGroupVolumes(),{});
  assert.deepEqual(mix.getState().groups,[{id:'pwm',label:'32X PWM'}]);
});

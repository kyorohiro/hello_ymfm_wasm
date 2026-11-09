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
  assert(state.channels.every(channel=>!channel.muted&&!channel.solo&&!channel.effectiveMuted));
  assert.equal(state.changed,false);
  assert(Object.isFrozen(state.channels[0]));
  mix.configure({psgClock:3579545});
  assert.deepEqual(mix.getState().channels.map(channel=>channel.id),['psg:0','psg:1','psg:2','psg:3']);
  assert.equal(mix.getMutedChannels().length,16,'undeclared endpoints stay silent too');
  assert(mix.getMutedChannels().includes('ym2612:5'),'undeclared YM2612 cannot leak DAC discontinuity');
  assert(!mix.getMutedChannels().includes('psg:3'));
});

test('multiple solos combine globally and explicit mute wins without erasing either choice', () => {
  const mix = createSynthSongMix();mix.configure(fullHeader);
  const audible = () => mix.getState().channels.filter(channel=>!channel.effectiveMuted).map(channel=>channel.id);
  mix.setChannelSolo('ym2612:1',true);
  assert.deepEqual(audible(),['ym2612:1']);
  mix.setChannelSolo('pcm:6',true);mix.setChannelSolo('pwm:1',true);
  assert.deepEqual(audible(),['ym2612:1','pcm:6','pwm:1']);
  mix.setChannelMuted('pcm:6',true);
  assert.deepEqual(audible(),['ym2612:1','pwm:1']);
  assert.equal(mix.getState().channels.find(channel=>channel.id==='pcm:6').solo,true);
  mix.setChannelSolo('ym2612:1',false);mix.setChannelSolo('pcm:6',false);mix.setChannelSolo('pwm:1',false);
  assert.equal(mix.getState().hasSolo,false);
  assert.equal(audible().length,19);
  assert.equal(mix.reset(),true);assert.equal(audible().length,20);
  assert.equal(mix.reset(),false);
});

test('same-song configuration retains choices; source clearing and unavailable channels remove them', () => {
  const mix = createSynthSongMix();mix.configure(fullHeader);
  mix.setChannelMuted('psg:3',true);mix.setChannelSolo('pwm:0',true);
  const previous = mix.getState();
  mix.configure({...fullHeader});
  assert.equal(mix.getState(),previous,'same header does not discard stopped-song mix');
  mix.configure({psgClock:3579545});
  assert.equal(mix.getState().hasSolo,false,'a missing source cannot leave every visible channel solo-muted');
  assert.equal(mix.getState().channels.at(-1).muted,true);
  assert.throws(()=>mix.setChannelMuted('pwm:0',true),/Unknown reference channel/);
  assert.throws(()=>mix.setChannelMuted('psg:0',1),/boolean/);
  assert.equal(mix.setChannelMuted('psg:3',true),false);
  mix.clear();mix.configure(fullHeader);
  assert.equal(mix.getState().changed,false,'a new file starts with all outputs enabled');
  assert.equal(previous.channels.find(channel=>channel.id==='psg:3').muted,true,'old snapshots remain immutable');
});

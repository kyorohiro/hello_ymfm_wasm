import test from 'node:test';
import assert from 'node:assert/strict';
import {createSynthSongMix} from './synth_song_mix.js';
import {SYNTH_SONG_MIX_DEFAULTS as defaults} from './synth_song_mix_defaults.js';
import {SOUNDCHIP_MIXER_PRESETS} from '../js/soundchip_mixer_presets.js';

const fullHeader = {ym2612Clock:7670454,psgClock:3579545,rf5c164Clock:12500000,pwmClock:23011361};
const defaultGroups = [{id:'ym2612',label:'YM2612',volume:defaults.ym2612},
  {id:'psg',label:'Sega PSG',volume:defaults.psg},{id:'pcm',label:'Mega CD PCM',volume:defaults.pcm},
  {id:'pwm',label:'32X PWM',volume:defaults.pwm}];

test('source defaults share the calibrated factory gains exactly, including PWM and fractional percentages',()=>{
  const kinds=SOUNDCHIP_MIXER_PRESETS.calibrated.factoryDefaults.kinds;
  for(const [id,kind] of Object.entries({ym2612:'ym2612',psg:'segapsg',pcm:'rf5c164',pwm:'pwm'})) {
    assert.equal(defaults[id],kinds.find(entry=>entry.name===kind).volume);
  }
  assert(Object.isFrozen(defaults));
  assert.notEqual(defaults.ym2612,Math.round(defaults.ym2612*1000)/1000,'display rounding must not replace the measured source gain');
  assert.notEqual(defaults.pcm,Math.round(defaults.pcm*1000)/1000);
});

test('all source volumes and twenty channel switches are available without a VGM; reference presence stays separate', () => {
  const mix = createSynthSongMix();
  assert.equal(mix.getState().channels.length,20);
  assert.equal(mix.getState().referenceActive,false);assert.deepEqual(mix.getState().referenceChannels,[]);
  assert(mix.getState().channels.every(channel=>!channel.muted&&!channel.referencePresent));
  assert.deepEqual(mix.getLiveMutedChannels(),[]);assert.equal(mix.getMutedChannels().length,20);
  assert.deepEqual(mix.getState().groups,defaultGroups);
  assert.deepEqual(mix.getGroupVolumes(),defaults);
  mix.configure(fullHeader);
  const state = mix.getState();
  assert.equal(state.channels.length,20);
  assert.equal(state.referenceActive,true);assert.equal(state.referenceChannels.length,20);
  assert.deepEqual(state.channels.map(channel => channel.id),[
    ...Array.from({length:6},(_,i)=>`ym2612:${i}`),...Array.from({length:4},(_,i)=>`psg:${i}`),
    ...Array.from({length:8},(_,i)=>`pcm:${i}`),'pwm:0','pwm:1']);
  assert.equal(state.channels.find(channel=>channel.id==='ym2612:5').label,'CH6 / DAC');
  assert.match(state.channels.find(channel=>channel.id==='pwm:0').label,/output/);
  assert(state.channels.every(channel=>!channel.muted&&!channel.effectiveMuted&&channel.referencePresent));
  assert.deepEqual(state.groups,defaultGroups);
  assert.deepEqual(mix.getGroupVolumes(),defaults);
  assert.equal(state.changed,false);
  assert(Object.isFrozen(state.channels[0]));
  assert(Object.isFrozen(state.groups[0]));
  assert(Object.isFrozen(state.groups));
  assert(Object.isFrozen(state.referenceChannels));
  mix.configure({psgClock:3579545});
  assert.equal(mix.getState().channels.length,20);
  assert.deepEqual(mix.getState().referenceChannels.map(channel=>channel.id),['psg:0','psg:1','psg:2','psg:3']);
  assert.equal(mix.getMutedChannels().length,16,'undeclared endpoints stay silent too');
  assert.deepEqual(mix.getState().groups,defaultGroups);
  assert.deepEqual(mix.getGroupVolumes(),defaults);
  assert(mix.getMutedChannels().includes('ym2612:5'),'undeclared YM2612 cannot leak DAC discontinuity');
  assert(!mix.getMutedChannels().includes('psg:3'));
  assert.deepEqual(mix.getLiveMutedChannels(),[],'VGM-only suppression never changes Keyboard/Code mute choices');
  assert.equal(mix.getChannelMuted('ym2612:5'),false);
});

test('channel mutes remain independent from source volumes; Reset restores both', () => {
  const mix = createSynthSongMix();mix.configure(fullHeader);
  const audible = () => mix.getState().channels.filter(channel=>!channel.effectiveMuted).map(channel=>channel.id);
  mix.setChannelMuted('ym2612:1',true);mix.setChannelMuted('pwm:1',true);
  mix.setChannelMuted('pcm:6',true);
  mix.setGroupVolume('ym2612',3.8);mix.setGroupVolume('psg',0);mix.setGroupVolume('pcm',.25);mix.setGroupVolume('pwm',.75);
  assert.equal(audible().length,17,'group gain does not rewrite per-channel mute choices');
  assert.deepEqual(mix.getGroupVolumes(),{ym2612:3.8,psg:0,pcm:.25,pwm:.75});
  assert.equal(mix.getState().changed,true);
  mix.setChannelMuted('ym2612:1',false);
  assert.equal(audible().length,18);
  assert.equal(mix.getState().groups[0].volume,3.8);
  assert.equal(mix.reset(),true);assert.equal(audible().length,20);
  assert.deepEqual(mix.getGroupVolumes(),defaults);
  mix.setGroupVolume('psg',.5);
  assert.equal(mix.getState().changed,true,'a gain-only edit enables Reset');
  assert.equal(mix.reset(),true);
  assert.equal(mix.reset(),false);
  mix.setGroupVolume('ym2612',1);
  assert.equal(mix.getState().changed,true,'100% is an explicit source gain, not the measured factory balance');
  assert.equal(mix.reset(),true);
  assert.equal(mix.getGroupVolumes().ym2612,defaults.ym2612,'Reset preserves the exact fractional calibrated value');
});

test('common mutes and volumes survive reference header changes, source replacement and clear', () => {
  const mix = createSynthSongMix();mix.configure(fullHeader);
  mix.setChannelMuted('psg:3',true);mix.setGroupVolume('psg',2);mix.setGroupVolume('pcm',0);
  const previous = mix.getState();
  mix.configure({...fullHeader});
  assert.equal(mix.getState(),previous,'same header does not discard stopped-song mix');
  mix.configure({psgClock:3579545});
  assert.equal(mix.getChannelMuted('psg:3'),true);
  assert.deepEqual(mix.getGroupVolumes(),{...defaults,psg:2,pcm:0},'absent sources keep their common volume');
  mix.setChannelMuted('pwm:0',true);
  assert.equal(mix.getChannelMuted('pwm:0'),true,'a chip absent from the VGM keeps an editable common switch');
  assert.deepEqual(mix.getLiveMutedChannels(),['psg:3','pwm:0']);
  assert.throws(()=>mix.setChannelMuted('pwm:2',true),/Unknown reference channel/);
  assert.throws(()=>mix.getChannelMuted('missing'),/Unknown reference channel/);
  assert.throws(()=>mix.setChannelMuted('psg:0',1),/boolean/);
  assert.equal(mix.setChannelMuted('psg:3',true),false);
  mix.clear();assert.equal(mix.getState().channels.length,20);assert.equal(mix.getState().referenceActive,false);
  assert.deepEqual(mix.getState().referenceChannels,[]);assert.equal(mix.getMutedChannels().length,20);
  assert.deepEqual(mix.getLiveMutedChannels(),['psg:3','pwm:0']);mix.configure(fullHeader);
  assert.deepEqual(mix.getMutedChannels(),['psg:3','pwm:0'],'the next VGM inherits common channel switches');
  assert.equal(mix.getState().changed,true,'common channels and source gains remain edited');
  assert.deepEqual(mix.getGroupVolumes(),{...defaults,psg:2,pcm:0},'new songs keep the common source volumes');
  assert.equal(previous.channels.find(channel=>channel.id==='psg:3').muted,true,'old snapshots remain immutable');
  assert.equal(previous.groups.find(group=>group.id==='psg').volume,2);
});

test('group volume validation is atomic and externally returned maps cannot change playback choices',()=>{
  const mix=createSynthSongMix();mix.setGroupVolume('pwm',3.8);mix.configure(fullHeader);mix.setGroupVolume('psg',.6);
  const original=mix.getState();
  for(const gain of [-1,3.80001,NaN,Infinity,'1',null]) {
    assert.throws(()=>mix.setGroupVolume('psg',gain),/0\.\.3\.8/);
    assert.equal(mix.getState(),original);
  }
  for(const id of ['ym2612:0','missing'])assert.throws(()=>mix.setGroupVolume(id,1),/Unknown reference volume group/);
  const detached=mix.getGroupVolumes();detached.psg=3.8;
  mix.setChannelMuted('pcm:2',true);const detachedMutes=mix.getLiveMutedChannels();detachedMutes.length=0;
  assert.deepEqual(mix.getLiveMutedChannels(),['pcm:2']);
  assert.equal(mix.getState().groups[1].volume,.6);
  assert.equal(mix.setGroupVolume('psg',.6),false);
  mix.configure({pwmClock:23011361});
  assert.deepEqual(mix.getGroupVolumes(),{...defaults,psg:.6,pwm:3.8});
  assert.deepEqual(mix.getState().groups,defaultGroups.map(group=>({...group,volume:mix.getGroupVolumes()[group.id]})));
});

test('shared mixer observers see stable immutable snapshots, single changes and detach cleanly',()=>{
  const mix=createSynthSongMix(),changes=[];
  const release=mix.onDidChange((state,change)=>changes.push({state,change}));
  const initial=mix.getState();assert.equal(mix.getState(),initial);
  assert.equal(mix.clear(),false);assert.equal(mix.reset(),false);assert.equal(mix.setGroupVolume('pwm',defaults.pwm),false);
  assert.equal(changes.length,0);
  mix.setGroupVolume('pwm',1.5);assert.equal(changes.length,1);assert.deepEqual(changes[0].change,{type:'volume',id:'pwm'});
  const edited=changes[0].state;assert.equal(edited,mix.getState());assert.notEqual(edited,initial);
  assert.equal(initial.groups[3].volume,defaults.pwm);assert.equal(edited.groups[3].volume,1.5);
  mix.configure(fullHeader);mix.setChannelMuted('psg:1',true);mix.clear();
  assert.deepEqual(changes.map(({change})=>change.type),['volume','configure','mute','clear']);
  assert.equal(mix.getGroupVolumes().pwm,1.5);assert.equal(mix.getState().channels.length,20);
  assert.equal(mix.getState().referenceActive,false);assert.equal(mix.getChannelMuted('psg:1'),true);
  assert.equal(mix.getState(),changes.at(-1).state);
  release();mix.reset();assert.equal(changes.length,4);assert.deepEqual(mix.getGroupVolumes(),defaults);
  assert.throws(()=>mix.onDidChange(null),/function/);
});

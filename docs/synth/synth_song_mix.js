// One session mixer for Keyboard, Code and reference playback. Its source
// volumes and twenty channel switches stay available without a song.
import {SYNTH_SONG_MIX_DEFAULTS} from './synth_song_mix_defaults.js?v=mix-source-1';

const GROUPS = [
  {clock:'ym2612Clock', prefix:'ym2612', group:'YM2612', labels:['CH1','CH2','CH3','CH4','CH5','CH6 / DAC']},
  {clock:'psgClock', prefix:'psg', group:'Sega PSG', labels:['Tone 1','Tone 2','Tone 3','Noise']},
  {clock:'rf5c164Clock', prefix:'pcm', group:'Mega CD PCM', labels:Array.from({length:8},(_,i)=>`PCM ${i+1}`)},
  {clock:'pwmClock', prefix:'pwm', group:'32X PWM', labels:['L output','R output']},
];

export function createSynthSongMix() {
  const entries = GROUPS.flatMap(({prefix,group,labels})=>
    labels.map((label,index)=>({id:`${prefix}:${index}`,groupId:prefix,group,label})));
  const settings = new Map(entries.map(entry=>[entry.id,false]));
  let referenceIds = new Set(), cached = null;
  const volumes = new Map(GROUPS.map(({prefix})=>[prefix,SYNTH_SONG_MIX_DEFAULTS[prefix]]));
  const listeners = new Set();
  function invalidate(change) {
    cached = null;
    const state = getState();
    for (const listener of [...listeners]) listener(state,change);
  }
  function getState() {
    if (!cached) {
      const channels = entries.map(entry => {
        const muted = settings.get(entry.id);
        return Object.freeze({...entry,muted,effectiveMuted:muted,referencePresent:referenceIds.has(entry.id)});
      });
      const groupState = GROUPS.map(({prefix,group}) => Object.freeze({id:prefix,label:group,volume:volumes.get(prefix)}));
      cached = Object.freeze({channels:Object.freeze(channels),groups:Object.freeze(groupState),
        referenceActive:referenceIds.size>0,referenceChannels:Object.freeze(channels.filter(channel=>channel.referencePresent)),
        changed:channels.some(channel => channel.muted)||[...volumes].some(([id,value])=>value!==SYNTH_SONG_MIX_DEFAULTS[id])});
    }
    return cached;
  }
  function configure(header) {
    const nextGroups = new Set(GROUPS.filter(group=>header[group.clock]).map(group=>group.prefix));
    const next = new Set(entries.filter(entry=>nextGroups.has(entry.groupId)).map(entry=>entry.id));
    if (next.size===referenceIds.size&&[...next].every(id=>referenceIds.has(id))) return false;
    referenceIds = next;
    invalidate({type:'configure'});
    return true;
  }
  function setChannelMuted(id, value) {
    if (!settings.has(id)) throw new RangeError(`Unknown reference channel: ${id}`);
    if (typeof value !== 'boolean') throw new TypeError('muted must be a boolean');
    if (settings.get(id) === value) return false;
    settings.set(id, value);
    invalidate({type:'mute',id});
    return true;
  }
  function setGroupVolume(id, value) {
    if (!volumes.has(id)) throw new RangeError(`Unknown reference volume group: ${id}`);
    if (typeof value !== 'number'||!Number.isFinite(value)||value<0||value>3.8) throw new RangeError('Reference group volume must be 0..3.8.');
    if (volumes.get(id) === value) return false;
    volumes.set(id, value);
    invalidate({type:'volume',id});
    return true;
  }
  function reset() {
    const changed = getState().changed;
    if (!changed) return false;
    for (const id of settings.keys()) settings.set(id,false);
    for (const id of volumes.keys()) volumes.set(id,SYNTH_SONG_MIX_DEFAULTS[id]);
    invalidate({type:'reset'});
    return true;
  }
  function clear() {
    if (!referenceIds.size) return false;
    referenceIds = new Set(); invalidate({type:'clear'}); return true;
  }
  function onDidChange(listener) {
    if (typeof listener !== 'function') throw new TypeError('Mixer listener must be a function');
    listeners.add(listener);
    return () => listeners.delete(listener);
  }
  function getGroupVolumes() {return Object.fromEntries(volumes);}
  function getChannelMuted(id) {
    if (!settings.has(id)) throw new RangeError(`Unknown reference channel: ${id}`);
    return settings.get(id);
  }
  function getLiveMutedChannels() {return entries.filter(entry=>settings.get(entry.id)).map(entry=>entry.id);}
  function getMutedChannels() {
    // The Genesis renderer always allocates YM2612/PSG endpoints, even for a
    // PSG/PCM-only log. Its absent chips must stay silent (including YM2612 DC)
    // without changing the independent Keyboard/Code channel switches.
    return entries.filter(entry=>settings.get(entry.id)||!referenceIds.has(entry.id)).map(entry=>entry.id);
  }
  return {configure, getState, getMutedChannels, getLiveMutedChannels, getChannelMuted,getGroupVolumes, clear, reset, onDidChange,
    setChannelMuted, setGroupVolume};
}

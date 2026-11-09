// Session-only listening choices for a reference song. These settings never
// change the instrument editor, source VGM or the written-register Live view.
import {SYNTH_SONG_MIX_DEFAULTS} from './synth_song_mix_defaults.js?v=mix-source-1';

const GROUPS = [
  {clock:'ym2612Clock', prefix:'ym2612', group:'YM2612', volume:true, labels:['CH1','CH2','CH3','CH4','CH5','CH6 / DAC']},
  {clock:'psgClock', prefix:'psg', group:'Sega PSG', volume:true, labels:['Tone 1','Tone 2','Tone 3','Noise']},
  {clock:'rf5c164Clock', prefix:'pcm', group:'Mega CD PCM', volume:true, labels:Array.from({length:8},(_,i)=>`PCM ${i+1}`)},
  {clock:'pwmClock', prefix:'pwm', group:'32X PWM', labels:['L output','R output']},
];

export function createSynthSongMix() {
  let entries = [], groups = [], settings = new Map(), volumes = new Map(), cached = null;
  const invalidate = () => {cached = null;};
  function getState() {
    if (!cached) {
      const channels = entries.map(entry => {
        const muted = settings.get(entry.id);
        return Object.freeze({...entry, muted, effectiveMuted:muted});
      });
      const groupState = groups.map(({prefix,group,volume}) => Object.freeze({id:prefix,label:group,
        ...(volume?{volume:volumes.get(prefix)}:{})}));
      cached = Object.freeze({channels:Object.freeze(channels),groups:Object.freeze(groupState),
        changed:channels.some(channel => channel.muted)||[...volumes].some(([id,value])=>value!==SYNTH_SONG_MIX_DEFAULTS[id])});
    }
    return cached;
  }
  function configure(header) {
    const nextGroups = GROUPS.filter(group => header[group.clock]);
    const next = nextGroups.flatMap(({prefix,group,labels}) =>
      labels.map((label,index) => ({id:`${prefix}:${index}`, groupId:prefix, group, label})));
    if (JSON.stringify(next) === JSON.stringify(entries)) return;
    entries = next;
    groups = nextGroups;
    settings = new Map(entries.map(entry => [entry.id, settings.get(entry.id) ?? false]));
    volumes = new Map(groups.filter(group=>group.volume).map(({prefix})=>[prefix,volumes.get(prefix)??SYNTH_SONG_MIX_DEFAULTS[prefix]]));
    invalidate();
  }
  function setChannelMuted(id, value) {
    if (!settings.has(id)) throw new RangeError(`Unknown reference channel: ${id}`);
    if (typeof value !== 'boolean') throw new TypeError('muted must be a boolean');
    if (settings.get(id) === value) return false;
    settings.set(id, value);
    invalidate();
    return true;
  }
  function setGroupVolume(id, value) {
    if (!volumes.has(id)) throw new RangeError(`Unknown reference volume group: ${id}`);
    if (typeof value !== 'number'||!Number.isFinite(value)||value<0||value>3.8) throw new RangeError('Reference group volume must be 0..3.8.');
    if (volumes.get(id) === value) return false;
    volumes.set(id, value);
    invalidate();
    return true;
  }
  function reset() {
    const changed = getState().changed;
    if (!changed) return false;
    settings = new Map(entries.map(entry => [entry.id, false]));
    volumes = new Map([...volumes.keys()].map(id=>[id,SYNTH_SONG_MIX_DEFAULTS[id]]));
    invalidate();
    return true;
  }
  function clear() {entries = []; groups = []; settings = new Map(); volumes = new Map(); invalidate();}
  function getGroupVolumes() {return Object.fromEntries(volumes);}
  function getMutedChannels() {
    const audible = new Set(getState().channels.filter(channel => !channel.effectiveMuted).map(channel => channel.id));
    // The Genesis renderer always allocates YM2612/PSG endpoints, even for a
    // PSG/PCM-only log. Suppress absent chips too, including YM2612 DC offset.
    return GROUPS.flatMap(({prefix,labels}) => labels.map((_,i)=>`${prefix}:${i}`))
      .filter(id => !audible.has(id));
  }
  return {configure, getState, getMutedChannels, getGroupVolumes, clear, reset,
    setChannelMuted, setGroupVolume};
}

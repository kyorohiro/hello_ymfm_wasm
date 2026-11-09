// Session-only listening choices for a reference song. These settings never
// change the instrument editor, source VGM or the written-register Live view.
const GROUPS = [
  {clock:'ym2612Clock', prefix:'ym2612', group:'YM2612', labels:['CH1','CH2','CH3','CH4','CH5','CH6 / DAC']},
  {clock:'psgClock', prefix:'psg', group:'Sega PSG', labels:['Tone 1','Tone 2','Tone 3','Noise']},
  {clock:'rf5c164Clock', prefix:'pcm', group:'Mega CD PCM', labels:Array.from({length:8},(_,i)=>`PCM ${i+1}`)},
  {clock:'pwmClock', prefix:'pwm', group:'32X PWM', labels:['L output','R output']},
];

export function createSynthSongMix() {
  let entries = [], settings = new Map(), cached = null;
  const invalidate = () => {cached = null;};
  function getState() {
    if (!cached) {
      const hasSolo = [...settings.values()].some(setting => setting.solo);
      const channels = entries.map(entry => {
        const {muted,solo} = settings.get(entry.id);
        return Object.freeze({...entry, muted, solo, effectiveMuted:muted || hasSolo && !solo});
      });
      cached = Object.freeze({channels:Object.freeze(channels), hasSolo,
        changed:channels.some(channel => channel.muted || channel.solo)});
    }
    return cached;
  }
  function configure(header) {
    const next = GROUPS.filter(group => header[group.clock]).flatMap(({prefix,group,labels}) =>
      labels.map((label,index) => ({id:`${prefix}:${index}`, group, label})));
    if (JSON.stringify(next) === JSON.stringify(entries)) return;
    entries = next;
    settings = new Map(entries.map(entry => [entry.id, settings.get(entry.id) ?? {muted:false,solo:false}]));
    invalidate();
  }
  function set(id, property, value) {
    const setting = settings.get(id);
    if (!setting) throw new RangeError(`Unknown reference channel: ${id}`);
    if (typeof value !== 'boolean') throw new TypeError(`${property} must be a boolean`);
    if (setting[property] === value) return false;
    settings.set(id, {...setting, [property]:value});
    invalidate();
    return true;
  }
  function reset() {
    const changed = getState().changed;
    if (!changed) return false;
    settings = new Map(entries.map(entry => [entry.id, {muted:false,solo:false}]));
    invalidate();
    return true;
  }
  function clear() {entries = []; settings = new Map(); invalidate();}
  function getMutedChannels() {
    const audible = new Set(getState().channels.filter(channel => !channel.effectiveMuted).map(channel => channel.id));
    // The Genesis renderer always allocates YM2612/PSG endpoints, even for a
    // PSG/PCM-only log. Suppress absent chips too, including YM2612 DC offset.
    return GROUPS.flatMap(({prefix,labels}) => labels.map((_,i)=>`${prefix}:${i}`))
      .filter(id => !audible.has(id));
  }
  return {configure, getState, getMutedChannels, clear, reset,
    setChannelMuted:(id,value) => set(id,'muted',value),
    setChannelSolo:(id,value) => set(id,'solo',value)};
}

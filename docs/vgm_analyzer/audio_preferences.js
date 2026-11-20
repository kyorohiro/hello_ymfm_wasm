import {mixerDefaults} from './playback_mixer.js?v=pokey-vgm-1';
import {legacyEngineTrim} from './mixer_defaults.js';
import {YM2608_SOURCE_LABELS, ym2608SourceDefaults} from './ym2608_source_mix.js?v=opna-source-mixer-1';

export const AUDIO_PREFERENCES_KEY = 'tetorica-vgm-analyzer.audio.v1';
export const effectDefaults = () => ({enabled: false, gain: 100, bass: 0, middle: 0, treble: 0, reverb: 0, compressor: 0, noiseGate: 0});
const effectRanges = {gain: [0, 200], bass: [-12, 12], middle: [-12, 12], treble: [-12, 12], reverb: [0, 100], compressor: [0, 100], noiseGate: [0, 100]};
const object = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const inRange = (value, min, max) => Number.isFinite(value) && value >= min && value <= max;
function validEffect(value) {
  const next = effectDefaults(), saved = object(value);
  if (typeof saved.enabled === 'boolean') next.enabled = saved.enabled;
  for (const [key, [min, max]] of Object.entries(effectRanges)) if (inRange(saved[key], min, max)) next[key] = Math.round(saved[key]);
  return next;
}
function validChip(value) {
  const next = {}, saved = object(value);
  if (inRange(saved.gain, 0, 2)) {
    next.gain = saved.gain;
    if(saved.gainUnits==='source')next.gainUnits='source';
  }
  if (inRange(saved.pan, -1, 1)) next.pan = saved.pan;
  if (typeof saved.muted === 'boolean') next.muted = saved.muted;
  return next;
}
function validSource(value) {
  const next = {}, saved = object(value);
  if (inRange(saved.gain, 0, 3.8)) next.gain = saved.gain;
  if (typeof saved.muted === 'boolean') next.muted = saved.muted;
  return next;
}
const supportedSource = (parent, part) => parent === 'ym2608' && Object.hasOwn(YM2608_SOURCE_LABELS, part);
function browserStorage() { try {return globalThis.localStorage;} catch {return null;} }

/** Audio preferences belong to this app, not a track. Storage failures leave session settings usable. */
export function createAudioPreferences(storage = browserStorage()) {
  let saved = {};
  try {saved = object(JSON.parse(storage?.getItem(AUDIO_PREFERENCES_KEY) ?? '{}'));} catch {}
  const state = {effect: validEffect(saved.effect), master: inRange(saved.master, 0, 3.8) ? saved.master : 1, chips: Object.create(null), sourceMixes: Object.create(null)};
  for (const [id, value] of Object.entries(object(saved.chips))) state.chips[id] = validChip(value);
  for (const [parent, sources] of Object.entries(object(saved.sourceMixes))) {
    for (const [part, value] of Object.entries(object(sources))) {
      if (!supportedSource(parent, part)) continue;
      (state.sourceMixes[parent] ??= Object.create(null))[part] = validSource(value);
    }
  }
  const save = () => {
    const {sourceMixes, ...legacyState} = state;
    try {storage?.setItem(AUDIO_PREFERENCES_KEY, JSON.stringify(Object.keys(sourceMixes).length ? state : legacyState));} catch {}
  };
  return {
    getEffect: () => ({...state.effect}),
    setEffect(value) {state.effect = validEffect(value); save();},
    getMaster: () => state.master,
    setMaster(value) {if (inRange(value, 0, 3.8)) {state.master = value; save();}},
    getChip(id, configuration) {
      const {gainUnits,...authored}=state.chips[id]??{};
      // Older records are renderer-relative and may be shared between tracks
      // with different source owners. Convert on read without rewriting them.
      if(Object.hasOwn(authored,'gain')&&gainUnits!=='source')authored.gain*=legacyEngineTrim(id,configuration);
      return {...mixerDefaults(id,configuration),...authored};
    },
    setChip(id, value) {
      const authored=validChip(value);
      if(Object.hasOwn(authored,'gain'))authored.gainUnits='source';
      state.chips[id] = {...state.chips[id],...authored}; save();
    },
    getSource(parent, part) {
      if (!supportedSource(parent, part)) throw new RangeError(`Unknown mixer source: ${parent}/${part}`);
      return {...ym2608SourceDefaults(), ...state.sourceMixes[parent]?.[part]};
    },
    setSource(parent, part, patch) {
      if (!supportedSource(parent, part)) throw new RangeError(`Unknown mixer source: ${parent}/${part}`);
      const sources = state.sourceMixes[parent] ??= Object.create(null);
      sources[part] = {...sources[part], ...validSource(patch)}; save();
    },
    resetMixer() {state.chips = Object.create(null); state.sourceMixes = Object.create(null); state.master = 1; save();},
  };
}

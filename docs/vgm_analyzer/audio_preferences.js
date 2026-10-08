import {mixerDefaults} from './playback_mixer.js';

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
function validChip(id, value) {
  const next = mixerDefaults(id), saved = object(value);
  if (inRange(saved.gain, 0, 2)) next.gain = saved.gain;
  if (inRange(saved.pan, -1, 1)) next.pan = saved.pan;
  if (typeof saved.muted === 'boolean') next.muted = saved.muted;
  return next;
}
function browserStorage() { try {return globalThis.localStorage;} catch {return null;} }

/** Audio preferences belong to this app, not a track. Storage failures leave session settings usable. */
export function createAudioPreferences(storage = browserStorage()) {
  let saved = {};
  try {saved = object(JSON.parse(storage?.getItem(AUDIO_PREFERENCES_KEY) ?? '{}'));} catch {}
  const state = {effect: validEffect(saved.effect), master: inRange(saved.master, 0, 3.8) ? saved.master : 1, chips: Object.create(null)};
  for (const [id, value] of Object.entries(object(saved.chips))) state.chips[id] = validChip(id, value);
  const save = () => {try {storage?.setItem(AUDIO_PREFERENCES_KEY, JSON.stringify(state));} catch {}};
  return {
    getEffect: () => ({...state.effect}),
    setEffect(value) {state.effect = validEffect(value); save();},
    getMaster: () => state.master,
    setMaster(value) {if (inRange(value, 0, 3.8)) {state.master = value; save();}},
    getChip: id => validChip(id, state.chips[id]),
    setChip(id, value) {state.chips[id] = validChip(id, value); save();},
    resetMixer() {state.chips = Object.create(null); state.master = 1; save();},
  };
}

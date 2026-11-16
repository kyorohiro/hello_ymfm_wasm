// SPDX-License-Identifier: BSD-3-Clause
import {createDefaultPreset, readPreset} from './preset.js';

export const YM2149_ST_CLOCK = 2000000;
const VOICE_KEYS = ['tone', 'noise', 'volume', 'envelope', 'period'];
const METHODS = ['initialize', 'reset', 'writeRegister', 'setVoice', 'tone', 'setTone', 'noise',
  'setMixer', 'setVolume', 'setTonePeriod', 'setFrequency', 'setNote', 'setNoisePeriod',
  'setEnvelope', 'keyOn', 'keyOff', 'noteOn', 'noteOff', 'off', 'allNotesOff'];
const channel = value => {
  if (!Number.isInteger(value) || value < 0 || value > 2) throw new RangeError('YM2149 ST channel must be 0..2');
  return value;
};
const patchObject = (value, keys, label) => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Reflect.ownKeys(value).some(key => !keys.includes(key)))
    throw new TypeError(`Invalid ${label} patch`);
};

/** A keyboard owner around the same register client borrowed by Code.
 * It never creates a second chip, copies Auto settings over a selected voice,
 * or resets a running Code performance when a patch changes.
 */
export function createInstrument({client, preset = createDefaultPreset(), onChange = () => {}} = {}) {
  if (!client || typeof client._getState !== 'function' || METHODS.some(method => typeof client[method] !== 'function'))
    throw new TypeError('YM2149 ST instrument needs an AY8910 register client');
  if (typeof onChange !== 'function') throw new TypeError('onChange must be a function');
  let sound = readPreset(preset), selectedChannel = null, pitch = 0, revision = 0;
  let disposed = false, internal = 0, depth = 0, dirty = false, initializing = true, queued = false, topMethod, topArgs;
  let cursor = 0;
  const notes = new Map(), owners = Array(3).fill(null), original = new Map();
  const previousObserve = client._observe;
  const check = () => { if (disposed) throw new Error('YM2149 ST instrument is disposed'); };
  const forget = voice => {
    if (!voice) return;
    if (owners[voice.channel] === voice) owners[voice.channel] = null;
    if (notes.get(voice.id) === voice) notes.delete(voice.id);
  };
  const forgetAll = () => { notes.clear(); owners.fill(null); };
  function hardware() {
    const state = client._getState(), r = state.registers, levels = state.levels;
    if (!r || r.length !== 16 || !levels || levels.length !== 3) throw new TypeError('Incomplete AY8910 register state');
    return {r, levels};
  }
  function reconcile() {
    const {r, levels} = hardware();
    sound = {...sound, voices: Array.from({length: 3}, (_, ch) => ({
      tone: !(r[7] & (1 << ch)), noise: !(r[7] & (8 << ch)),
      volume: levels[ch] & 15, envelope: Boolean(levels[ch] & 16),
      period: r[ch * 2] | ((r[ch * 2 + 1] & 15) << 8),
    })), noisePeriod: r[6] & 31, envelope: {period: r[11] | (r[12] << 8), shape: r[13] & 15}};
    return [0, 1, 2].filter(ch => Boolean(r[8 + ch] & 31));
  }
  function read() {
    check();
    const activeChannels = reconcile();
    return {preset: readPreset(sound), selectedChannel, pitch, activeChannels, revision};
  }
  function publish(force = false) {
    if (disposed || initializing || internal || depth || (!dirty && !force)) return;
    dirty = false;
    revision++;
    const state = read();
    // Observation must never turn a successful chip write into an API failure.
    try { onChange(state); } catch (error) { globalThis.console?.error?.('[YM2149 ST observer]', error); }
  }
  const schedule = () => {
    if (queued) return;
    queued = true;
    queueMicrotask(() => { queued = false; publish(); });
  };
  function observed(event) {
    dirty = true;
    if (!internal) {
      if (event.method === 'reset' || ['reset', 'initialize', 'allNotesOff'].includes(topMethod)) forgetAll();
      else if (event.channel !== undefined) forget(owners[event.channel]);
      else if (event.method === 'writeRegister' && event.args[0] === 7) {
        if (['setVoice', 'setMixer', 'tone', 'setTone', 'noise'].includes(topMethod)) forget(owners[topArgs[0]]);
        else forgetAll(); // A raw full mixer write intentionally takes all three gates.
      }
    }
    previousObserve?.call(client, event);
    if (!depth && !internal) schedule();
  }
  client._observe = observed;
  for (const method of METHODS) {
    const saved = client[method];
    const wrapper = function (...args) {
      const outer = depth === 0;
      // A Code release may arrive after a newer manual key acquired the voice.
      // Explicit raw register writes remain unconditional hardware operations.
      if (outer && !internal && ['noteOff', 'keyOff', 'off'].includes(method) &&
          Number.isInteger(args[0]) && args[0] >= 0 && args[0] < 3 && owners[args[0]]) return;
      if (outer) { topMethod = method; topArgs = args; }
      depth++;
      try { return saved.apply(this, args); }
      finally {
        depth--;
        if (outer) { topMethod = undefined; topArgs = undefined; publish(); }
      }
    };
    original.set(method, {saved, wrapper});
    client[method] = wrapper;
  }
  function edit(callback, force = false) {
    check();
    internal++;
    try { return callback(); }
    finally { internal--; publish(force); }
  }
  function applyVoice(ch, next, current, active) {
    const changed = Object.fromEntries(VOICE_KEYS.filter(key => next[key] !== current?.[key]).map(key => [key, next[key]]));
    if (!Object.keys(changed).length) return;
    client.setVoice(ch, changed);
    if (!active && ('volume' in changed || 'envelope' in changed)) client.keyOff(ch);
  }
  function applyPreset(value) {
    const next = readPreset(value), before = read();
    edit(() => {
      for (let ch = 0; ch < 3; ch++) applyVoice(ch, next.voices[ch], before.preset.voices[ch], before.activeChannels.includes(ch));
      if (next.noisePeriod !== before.preset.noisePeriod) client.setNoisePeriod(next.noisePeriod);
      // Loading a patch establishes and retriggers its one shared envelope.
      client.setEnvelope(next.envelope);
      sound.name = next.name;
    }, true);
    return read();
  }
  function setVoice(patch) {
    patchObject(patch, VOICE_KEYS, 'voice');
    const before = read(), targets = selectedChannel === null ? [0, 1, 2] : [selectedChannel];
    const next = readPreset({...before.preset, voices: before.preset.voices.map((voice, ch) => targets.includes(ch) ? {...voice, ...patch} : voice)});
    edit(() => { for (const ch of targets) applyVoice(ch, next.voices[ch], before.preset.voices[ch], before.activeChannels.includes(ch)); });
    return read();
  }
  const frequency = midi => Math.max(YM2149_ST_CLOCK / (16 * 4095), Math.min(YM2149_ST_CLOCK / 16, 440 * 2 ** ((midi - 69 + pitch) / 12)));
  function noteOn(id, midi) {
    check();
    if (typeof id !== 'string' || !id.length || id.length > 256) throw new TypeError('Note identity must contain 1..256 characters');
    if (!Number.isFinite(midi) || midi < 0 || midi > 127) throw new RangeError('MIDI note must be 0..127');
    const active = read().activeChannels;
    const old = notes.get(id);
    let ch = selectedChannel;
    if (ch === null) {
      ch = Array.from({length: 3}, (_, offset) => (cursor + offset) % 3)
        .find(index => !owners[index] && !active.includes(index));
      if (ch === undefined) ch = cursor;
      cursor = (ch + 1) % 3;
    }
    edit(() => {
      if (old && old.channel !== ch && owners[old.channel] === old) { client.keyOff(old.channel); forget(old); }
      forget(owners[ch]);
      const voice = {id, midi, channel: ch};
      owners[ch] = voice; notes.set(id, voice);
      client.setFrequency(ch, frequency(midi));
      client.keyOn(ch);
    });
    return ch;
  }
  function noteOff(id) {
    check();
    const voice = notes.get(id);
    if (!voice || owners[voice.channel] !== voice) return false;
    edit(() => { client.keyOff(voice.channel); forget(voice); });
    return true;
  }
  function stop() { edit(() => { forgetAll(); client.allNotesOff(); }); }
  const api = {
    getPreset() { check(); reconcile(); return readPreset(sound); }, read,
    selectChannel(value) {
      check(); if (value !== null) channel(value);
      if (selectedChannel !== value) { selectedChannel = value; publish(true); }
      return read();
    },
    applyPreset, setVoice,
    setName(value) {
      const next=readPreset({...read().preset,name:value});
      if(next.name!==sound.name) {sound.name=next.name;publish(true);}
      return read();
    },
    setNoisePeriod(value) {
      const next = readPreset({...read().preset, noisePeriod: value});
      if (next.noisePeriod !== sound.noisePeriod) edit(() => client.setNoisePeriod(next.noisePeriod));
      return read();
    },
    setEnvelope(patch) {
      patchObject(patch, ['period', 'shape'], 'envelope');
      const next = readPreset({...read().preset, envelope: {...sound.envelope, ...patch}});
      const change = {};
      if ('period' in patch && next.envelope.period !== sound.envelope.period) change.period = next.envelope.period;
      if ('shape' in patch) change.shape = next.envelope.shape; // Same Shape is an intentional retrigger.
      if (Object.keys(change).length) edit(() => client.setEnvelope(change));
      return read();
    },
    noteOn, noteOff,
    setPitch(value) {
      check();
      if (!Number.isFinite(value) || value < -48 || value > 48) throw new RangeError('Pitch must be -48..48 semitones');
      if (pitch !== value) {
        pitch = value;
        edit(() => { for (const voice of notes.values()) if (owners[voice.channel] === voice) client.setFrequency(voice.channel, frequency(voice.midi)); }, true);
      }
      return read();
    },
    stop,
    dispose() {
      if (disposed) return;
      stop(); disposed = true;
      if (client._observe === observed) client._observe = previousObserve;
      for (const [method, {saved, wrapper}] of original) if (client[method] === wrapper) client[method] = saved;
    },
  };
  // Set the complete initial patch without leaving a configured volume sounding.
  edit(() => {
    forgetAll(); client.allNotesOff();
    for (let ch = 0; ch < 3; ch++) { client.setVoice(ch, sound.voices[ch]); client.keyOff(ch); }
    client.setNoisePeriod(sound.noisePeriod); client.setEnvelope(sound.envelope);
  });
  initializing = false; dirty = false;
  return api;
}

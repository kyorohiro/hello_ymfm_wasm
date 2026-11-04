// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 kyorohiro.
import {GameboySynth, GameboyDirectTransport} from '../js/gameboysynth.js';
import {createDefaultPreset, readPreset} from './preset.js';

const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const poolFor = preset => preset.source === 'pulse' ? preset.pulse.sweep.enabled ? [0] : [0, 1] : preset.source === 'wave' ? [2] : [3];

/** One physical Game Boy APU. All keys use the selected sound source.
 * The host allocator cannot turn a Pulse channel into Wave or Noise. */
export class GameboyInstrument {
  constructor(core) {
    if (!core || typeof core.generateStereo !== 'function' || typeof core.writeRegister !== 'function') throw new TypeError('Expected a Game Boy APU');
    this.core = core;
    this.synth = new GameboySynth({transport: new GameboyDirectTransport(core)});
    this.synth.initialize();
    this.preset = createDefaultPreset();
    this.pitch = 0; this.cursor = 0; this.sequence = 0;
    this.voices = new Map(); this.slots = Array(4).fill(null); this.disposed = false;
    this._apply(null, this.preset);
    this.stop();
  }
  _open() { if (this.disposed) throw new Error('Game Boy instrument is disposed'); }
  _frequency(midi, pitch = this.pitch, source = this.preset.source) {
    const hz = 440 * 2 ** ((midi - 69 + pitch) / 12), divisor = source === 'wave' ? 64 : 32;
    const period = Math.round(2048 - this.synth.clock / (divisor * hz));
    if (!Number.isInteger(period) || period < 0 || period > 2047) throw new RangeError(`Note is outside the Game Boy ${source === 'wave' ? 'Wave' : 'Pulse'} frequency range`);
    return hz;
  }
  _apply(previous, next) {
    const changed = (path, value) => !previous || !equal(path(previous), value);
    const patch = {};
    for (const key of ['duty', 'volume', 'envelope']) if (changed(p => p.pulse[key], next.pulse[key])) patch[key] = next.pulse[key];
    for (let ch = 0; ch < 2; ch++) {
      // Envelope register writes have hardware side effects. Defer authored
      // initial volume/envelope edits on held channels until their next trigger.
      const live = this.slots[ch] ? ('duty' in patch ? {duty: patch.duty} : {}) : patch;
      if (Object.keys(live).length) this.synth.pulse.setVoice(ch, live);
    }
    if (changed(p => p.pulse.sweep, next.pulse.sweep)) {
      const sweep = next.pulse.sweep;
      if (!this.slots[0]) this.synth.pulse.setSweep(sweep.enabled ? {direction: sweep.direction, period: sweep.period, shift: sweep.shift} : {direction: 'up', period: 0, shift: 0});
    }
    if (changed(p => p.wave.samples, next.wave.samples)) this.synth.wave.stopAndSetWaveform(next.wave.samples);
    if (changed(p => p.wave.level, next.wave.level)) this.synth.wave.setLevel(next.wave.level);
    const noise = {};
    for (const key of ['volume', 'envelope', 'divisor', 'shift', 'width']) if (changed(p => p.noise[key], next.noise[key])) noise[key] = next.noise[key];
    const liveNoise = this.slots[3] ? Object.fromEntries(Object.entries(noise).filter(([key]) => key !== 'volume' && key !== 'envelope')) : noise;
    if (Object.keys(liveNoise).length) this.synth.noise.setVoice(liveNoise);
    if (changed(p => p.pan, next.pan)) for (let ch = 0; ch < 4; ch++) this.synth.setPan(ch, next.pan.left, next.pan.right);
  }
  read() {
    this._open();
    return {preset: readPreset(this.preset), voices: [...this.voices.values()].map(({id, midi, channel}) => ({id, midi, channel})),
      capacity: poolFor(this.preset).length, pitch: this.pitch, registers: this.synth._getState().registers};
  }
  setPreset(value) {
    this._open();
    const next = readPreset(value), previous = this.preset;
    const clear = previous.source !== next.source || !equal(poolFor(previous), poolFor(next)) || !equal(previous.wave.samples, next.wave.samples);
    if (clear) this.stop();
    this._apply(previous, next); this.preset = next;
    return this.read();
  }
  loadPreset(value) {
    this._open();
    const next = readPreset(value);
    this.stop(); this._apply(this.preset, next); this.preset = next; this.pitch = 0;
    return this.read();
  }
  noteOn(id, midi) {
    this._open();
    if (typeof id !== 'string' || !id.length || id.length > 128) throw new TypeError('Expected a note identity of 1–128 characters');
    if (this.voices.has(id)) throw new Error('Note identity is already active');
    if (!Number.isInteger(midi) || midi < 0 || midi > 127) throw new RangeError('Expected a MIDI note 0–127');
    const source = this.preset.source, hz = source === 'noise' ? null : this._frequency(midi);
    const pool = poolFor(this.preset);
    let channel;
    for (let offset = 0; offset < pool.length; offset++) {
      const candidate = pool[(this.cursor + offset) % pool.length];
      if (this.slots[candidate] === null) { channel = candidate; break; }
    }
    if (channel === undefined) channel = pool.reduce((oldest, candidate) => this.slots[candidate].order < this.slots[oldest].order ? candidate : oldest, pool[0]);
    const previous = this.slots[channel];
    if (previous) { this.synth.keyOff(channel); this.voices.delete(previous.id); }
    if (source === 'pulse') {
      const {duty, volume, envelope} = this.preset.pulse;
      this.synth.pulse.setVoice(channel, {duty, volume, envelope});
      if (channel === 0) {
        const sweep = this.preset.pulse.sweep;
        this.synth.pulse.setSweep(sweep.enabled ? {direction: sweep.direction, period: sweep.period, shift: sweep.shift} : {direction: 'up', period: 0, shift: 0});
      }
      this.synth.setFrequency(channel, hz); this.synth.keyOn(channel);
    } else if (source === 'wave') {
      this.synth.wave.setLevel(this.preset.wave.level);
      this.synth.setFrequency(2, hz); this.synth.keyOn(2);
    } else {
      this.synth.noise.setVoice(this.preset.noise); this.synth.noise.keyOn();
    }
    const voice = {id, midi, channel, order: ++this.sequence};
    this.slots[channel] = voice; this.voices.set(id, voice); this.cursor = (pool.indexOf(channel) + 1) % pool.length;
    return {channel, stolenId: previous?.id ?? null};
  }
  noteOff(id) {
    this._open();
    const voice = this.voices.get(id);
    if (!voice || this.slots[voice.channel] !== voice) return false;
    this.synth.keyOff(voice.channel); this.voices.delete(id); this.slots[voice.channel] = null;
    return true;
  }
  setPitch(semitones) {
    this._open();
    if (!Number.isFinite(semitones) || semitones < -24 || semitones > 24) throw new RangeError('Pitch must be between -24 and +24 semitones');
    const updates = this.preset.source === 'noise' ? [] : [...this.voices.values()].map(voice => [voice.channel, this._frequency(voice.midi, semitones)]);
    for (const [channel, hz] of updates) this.synth.setFrequency(channel, hz);
    this.pitch = semitones;
    return this.read();
  }
  stop() {
    this._open();
    for (let ch = 0; ch < 4; ch++) this.synth.keyOff(ch);
    this.voices.clear(); this.slots.fill(null); this.cursor = 0;
    return this.read();
  }
  generateStereo(frames) { this._open(); return this.core.generateStereo(frames); }
  dispose() {
    if (this.disposed) return;
    this.stop(); this.synth.dispose(); this.core.dispose(); this.disposed = true;
  }
}

// SPDX-License-Identifier: BSD-3-Clause
import {NesApuSynth, NesApuDirectTransport} from '../js/nesapusynth.js';
import {createDefaultPreset, readPreset} from './preset.js';

const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const poolFor = preset => preset.source === 'pulse' ? [0, 1] : preset.source === 'triangle' ? [2] : preset.source === 'noise' ? [3] : [5];
const quietSweep = {enabled: false, period: 0, negate: true, shift: 0};

/** Host keyboard allocation around one physical NES APU and FDS expansion. */
export class NesInstrument {
  constructor(core) {
    if (!core || typeof core.generateStereo !== 'function' || typeof core.writeRegister !== 'function' || !core.fdsEnabled) throw new TypeError('Expected an NES APU with FDS enabled');
    this.core = core; this.synth = new NesApuSynth({transport: new NesApuDirectTransport(core), fds: true});
    this.preset = createDefaultPreset(); this.pitch = 0; this.cursor = 0; this.sequence = 0;
    this.voices = new Map(); this.slots = Array(6).fill(null); this.disposed = false;
    this._apply(null, this.preset); this.stop();
  }
  _open() {if (this.disposed) throw new Error('NES instrument is disposed');}
  _frequency(midi, pitch = this.pitch, source = this.preset.source) {
    const hz = 440 * 2 ** ((midi - 69 + pitch) / 12);
    const period = source === 'fds' ? Math.round(hz * 4194304 / this.synth.clock)
      : Math.round(this.synth.clock / ((source === 'triangle' ? 32 : 16) * hz) - 1);
    if (period < (source === 'fds' ? 1 : 8) || period > (source === 'fds' ? 4095 : 2047)) throw new RangeError(`Note is outside the NES ${source} frequency range`);
    return {hz, period};
  }
  _pulseVoice(channel, preset, {live = false} = {}) {
    const {duty, volume, envelope, sweep} = preset.pulse;
    // Envelope/sweep authored changes are used on the next attack. Constant
    // volume and Duty can be changed without writing the trigger register.
    const voice = {duty};
    const constantVolume = Boolean(this.synth._getState().registers[channel * 4] & 16);
    if (!live || constantVolume && !envelope.enabled) {
      if (envelope.enabled) voice.envelope = {period: envelope.period, loop: envelope.loop};
      else voice.volume = volume;
    }
    if (!live) voice.sweep = sweep.enabled ? sweep : quietSweep;
    this.synth.pulse.setVoice(channel, voice);
  }
  _apply(previous, next) {
    const changed = (path, value) => !previous || !equal(path(previous), value);
    if (changed(p => p.pulse, next.pulse)) for (let channel = 0; channel < 2; channel++) this._pulseVoice(channel, next, {live: Boolean(this.slots[channel])});
    if (!previous) this.synth.writeRegister(0x4008, 0xff);
    if (changed(p => p.noise, next.noise)) this.synth.noise.setVoice(next.noise);
    if (changed(p => p.fds.wave, next.fds.wave)) this.synth.fds.setWave(next.fds.wave);
    if (changed(p => [p.fds.volume, p.fds.master], [next.fds.volume, next.fds.master])) this.synth.fds.setVolume(next.fds.volume, next.fds.master);
    const mod = next.fds.modulation;
    if (changed(p => p.fds.modulation.table, mod.table)) this.synth.fds.setModulation(mod);
    else {
      // Avoid rewriting the modulation RAM and resetting its clock for an
      // ordinary rate/depth/bias adjustment on a held FDS note.
      if (changed(p => p.fds.modulation.depth, mod.depth)) this.synth.writeRegister(0x4084, 128 | mod.depth);
      if (changed(p => p.fds.modulation.bias, mod.bias)) this.synth.writeRegister(0x4085, mod.bias & 127);
      if (changed(p => p.fds.modulation.rate, mod.rate)) this.synth.writeRegister(0x4086, mod.rate & 255);
      if (changed(p => [p.fds.modulation.rate, p.fds.modulation.enabled], [mod.rate, mod.enabled])) this.synth.writeRegister(0x4087, (mod.enabled ? 0 : 128) | (mod.rate >> 8));
    }
  }
  _retune(channel, period, {trigger = false} = {}) {
    if (channel === 5) {
      this.synth.writeRegister(0x4082, period & 255);
      this.synth.writeRegister(0x4083, (this.synth._getState().registers[0x83] & 0xc0) | (period >> 8));
      return;
    }
    const base = 0x4000 + channel * 4, previous = this.synth._getState().registers[channel * 4 + 3];
    this.synth.writeRegister(base + 2, period & 255);
    // NES timer-high writes restart the hardware envelope/length. Skip them
    // while the high bits are unchanged. Crossing a timer-byte boundary still
    // has that hardware side effect; the host voice identity stays unchanged.
    if (trigger || (previous & 7) !== (period >> 8)) this.synth.writeRegister(base + 3, (previous & 0xf8 || 8) | (period >> 8));
  }
  read() {
    this._open();
    const coreState = this.core.getState?.();
    return {preset: readPreset(this.preset), voices: [...this.voices.values()].map(({id, midi, channel}) => ({id, midi, channel})),
      capacity: poolFor(this.preset).length, pitch: this.pitch, registers: this.synth._getState().registers, ...(coreState ? {coreState} : {})};
  }
  setPreset(value) {
    this._open(); const next = readPreset(value), previous = this.preset;
    if (previous.source !== next.source || !equal(previous.fds.wave, next.fds.wave) || !equal(previous.fds.modulation.table, next.fds.modulation.table)) this.stop();
    this._apply(previous, next); this.preset = next; return this.read();
  }
  loadPreset(value) {
    this._open(); const next = readPreset(value);
    this.stop(); this.synth.reset(); this.pitch = 0; this._apply(null, next); this.preset = next; return this.read();
  }
  noteOn(id, midi) {
    this._open();
    if (typeof id !== 'string' || !id.length || id.length > 128) throw new TypeError('Expected a note identity of 1–128 characters');
    if (this.voices.has(id)) throw new Error('Note identity is already active');
    if (!Number.isInteger(midi) || midi < 0 || midi > 127) throw new RangeError('Expected a MIDI note 0–127');
    const source = this.preset.source, tone = source === 'noise' ? null : this._frequency(midi), pool = poolFor(this.preset);
    let channel;
    for (let offset = 0; offset < pool.length; offset++) {
      const candidate = pool[(this.cursor + offset) % pool.length];
      if (this.slots[candidate] === null) {channel = candidate; break;}
    }
    if (channel === undefined) channel = pool.reduce((oldest, candidate) => this.slots[candidate].order < this.slots[oldest].order ? candidate : oldest, pool[0]);
    const previous = this.slots[channel];
    if (previous) {this.synth.noteOff(channel); this.voices.delete(previous.id);}
    if (source === 'pulse') {
      this._pulseVoice(channel, this.preset);
      this._retune(channel, tone.period, {trigger: true}); this.synth.keyOn(channel);
    } else if (source === 'triangle') {
      this.synth.writeRegister(0x4008, 0xff); this._retune(2, tone.period, {trigger: true}); this.synth.keyOn(2);
    } else if (source === 'noise') {this.synth.noise.setVoice(this.preset.noise); this.synth.noise.noteOn();}
    else {this._retune(5, tone.period); this.synth.fds.keyOn();}
    const voice = {id, midi, channel, order: ++this.sequence};
    this.slots[channel] = voice; this.voices.set(id, voice); this.cursor = (pool.indexOf(channel) + 1) % pool.length;
    return {channel, stolenId: previous?.id ?? null};
  }
  noteOff(id) {
    this._open(); const voice = this.voices.get(id);
    if (!voice || this.slots[voice.channel] !== voice) return false;
    this.synth.noteOff(voice.channel); this.voices.delete(id); this.slots[voice.channel] = null; return true;
  }
  setPitch(semitones) {
    this._open();
    if (!Number.isFinite(semitones) || semitones < -24 || semitones > 24) throw new RangeError('Pitch must be between -24 and +24 semitones');
    const updates = this.preset.source === 'noise' ? [] : [...this.voices.values()].map(voice => [voice.channel, this._frequency(voice.midi, semitones).period]);
    for (const [channel, period] of updates) this._retune(channel, period);
    this.pitch = semitones; return this.read();
  }
  stop() {
    this._open(); for (let channel = 0; channel < 6; channel++) this.synth.noteOff(channel);
    this.voices.clear(); this.slots.fill(null); this.cursor = 0; return this.read();
  }
  generateStereo(frames) {this._open(); return this.core.generateStereo(frames);}
  dispose() {if (this.disposed) return; this.stop(); this.core.dispose(); this.disposed = true;}
}

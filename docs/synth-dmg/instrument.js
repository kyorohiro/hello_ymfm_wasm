// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 kyorohiro.
import {GameboySynth, GameboyDirectTransport} from '../js/gameboysynth.js';
import {createDefaultPreset, readPreset} from './preset.js';
import {validateGameboyCodeCall,gameboyCodeCancelled} from './code_endpoint.js';

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
    this.codeEpoch = 0; this.codeActive = false; this.codeCheckpoint = null; this.codeFrames = 0;
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
      capacity: poolFor(this.preset).length, pitch: this.pitch,
      registers: Array.from(this.codeCheckpoint?.synth.registers ?? this.synth._getState().registers)};
  }
  setPreset(value) {
    this._open();
    const next = readPreset(value), previous = this.preset;
    if (this.codeActive) this.stop();
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
  /** Replace editor settings without retiring the borrowed Code APU. Native
   * checkpoint work is synchronous; no audio frames are generated between
   * saving the live machine, preparing Stop's new editor state and restoring it. */
  applyCodePreset(session, value) {
    this._open();
    if (!this.codeActive || session !== this.codeEpoch) throw gameboyCodeCancelled();
    const next = readPreset(value), previous = this.preset, checkpoint = this.codeCheckpoint;
    const native = this.core.saveState(), shadow = this.synth._getState(), pitch = this.pitch;
    try {
      this.core.loadState(checkpoint.native); this.synth._adoptState(checkpoint.synth);
      this._apply(null, next);
      for (let channel = 0; channel < 4; channel++) this.synth.keyOff(channel);
      const restored = {native:this.core.saveState(),synth:this.synth._getState(),pitch:0};
      this.core.loadState(native); this.synth._adoptState(shadow);
      if (!shadow.initialized) this.synth.initialize();
      const live = this.synth._getState();
      const {duty,volume,envelope,sweep} = next.pulse;
      const env = (volume<<4)|(envelope.direction==='up'?8:0)|envelope.period;
      for (let channel = 0; channel < 2; channel++) {
        const base=channel*5,patch={};
        if([.125,.25,.5,.75][live.voice[base+1]>>6]!==duty)patch.duty=duty;
        if(live.voice[base+2]!==env){patch.volume=volume;patch.envelope=envelope;}
        if(Object.keys(patch).length)this.synth.pulse.setVoice(channel,patch);
      }
      const sweepBits=sweep.enabled?(sweep.period<<4)|(sweep.direction==='down'?8:0)|sweep.shift:0;
      if(live.voice[0]!==sweepBits)this.synth.pulse.setSweep(sweep.enabled ? {direction:sweep.direction,period:sweep.period,shift:sweep.shift} : {direction:'up',period:0,shift:0});
      const wave = next.wave.samples;
      const packed = Array.from({length:16},(_,index)=>(wave[index*2]<<4)|wave[index*2+1]);
      if (!equal(live.registers.slice(32,48),packed)) this.synth.wave.stopAndSetWaveform(wave);
      if([0,1,.5,.25][(live.voice[12]>>5)&3]!==next.wave.level)this.synth.wave.setLevel(next.wave.level);
      const noise={},noiseEnv=(next.noise.volume<<4)|(next.noise.envelope.direction==='up'?8:0)|next.noise.envelope.period;
      if(live.voice[17]!==noiseEnv){noise.volume=next.noise.volume;noise.envelope=next.noise.envelope;}
      const noiseBits=(next.noise.shift<<4)|(next.noise.width===7?8:0)|next.noise.divisor;
      if(live.voice[18]!==noiseBits)Object.assign(noise,{divisor:next.noise.divisor,shift:next.noise.shift,width:next.noise.width});
      if(Object.keys(noise).length)this.synth.noise.setVoice(noise);
      for (let channel = 0; channel < 4; channel++) {
        if(Boolean(live.voice[21]&(16<<channel))!==next.pan.left||Boolean(live.voice[21]&(1<<channel))!==next.pan.right)this.synth.setPan(channel,next.pan.left,next.pan.right);
      }
      this.preset = next; this.pitch = 0; this.codeCheckpoint = restored;
      return this.read();
    } catch (error) {
      this.core.loadState(native); this.synth._adoptState(shadow);
      this.preset = previous; this.pitch = pitch; this.codeCheckpoint = checkpoint;
      throw error;
    }
  }
  noteOn(id, midi) {
    this._open();
    if (this.codeActive) throw gameboyCodeCancelled();
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
    if (this.codeActive) return false;
    const voice = this.voices.get(id);
    if (!voice || this.slots[voice.channel] !== voice) return false;
    this.synth.keyOff(voice.channel); this.voices.delete(id); this.slots[voice.channel] = null;
    return true;
  }
  setPitch(semitones) {
    this._open();
    if (this.codeActive) throw gameboyCodeCancelled();
    if (!Number.isFinite(semitones) || semitones < -24 || semitones > 24) throw new RangeError('Pitch must be between -24 and +24 semitones');
    const updates = this.preset.source === 'noise' ? [] : [...this.voices.values()].map(voice => [voice.channel, this._frequency(voice.midi, semitones)]);
    for (const [channel, hz] of updates) this.synth.setFrequency(channel, hz);
    this.pitch = semitones;
    return this.read();
  }
  stop() {
    this._open();
    const restored = this._endCode();
    if (!restored) for (let ch = 0; ch < 4; ch++) this.synth.keyOff(ch);
    this.voices.clear(); this.slots.fill(null); this.cursor = 0;
    return this.read();
  }
  _endCode() {
    const checkpoint = this.codeCheckpoint;
    this.codeEpoch++; this.codeActive = false; this.codeCheckpoint = null;
    if (!checkpoint) return false;
    this.core.loadState(checkpoint.native);
    this.synth._adoptState(checkpoint.synth);
    this.pitch = checkpoint.pitch;
    return true;
  }
  beginCode() {
    this._open();
    if (!this.core.supportsState?.()) throw new Error('DMG Synth Code requires native APU checkpoint support');
    this.stop();
    const checkpoint = {native:this.core.saveState(),synth:this.synth._getState(),pitch:this.pitch};
    this.codeCheckpoint = checkpoint; this.codeActive = true; this.codeFrames = 0;
    return {session:this.codeEpoch,clock:this.synth.clock,channels:4,editorSource:this.preset.source};
  }
  observeCode(...args) {
    this._open();
    if (args.length) throw new TypeError('Game Boy Code observation takes no arguments');
    if (!this.codeActive) return null;
    return {...this.synth._getState(),positionFrames:this.codeFrames,activeMask:null,
      observation:{registers:'sent',voice:'configured',hardwareEnvelope:false,hardwareSweep:false}};
  }
  code(session, method, args = []) {
    this._open();
    if (!this.codeActive || session !== this.codeEpoch) throw gameboyCodeCancelled();
    validateGameboyCodeCall(method,args,this.synth.clock);
    if (method === 'getState') return {...this.synth._getState(),editorSource:this.preset.source,positionFrames:this.codeFrames};
    if (method === 'dispose') { this._endCode(); return this.read(); }
    if (method === 'setClock') return this.synth.clock;
    if (method === 'allNotesOff') { for (let ch = 0; ch < 4; ch++) this.synth.keyOff(ch); return; }
    const [group, member] = method.split('.');
    return member ? this.synth[group][member](...args) : this.synth[group](...args);
  }
  generateStereo(frames) {
    this._open(); const pcm = this.core.generateStereo(frames);
    if (this.codeActive) this.codeFrames += frames;
    return pcm;
  }
  dispose() {
    if (this.disposed) return;
    this.stop(); this.synth.dispose(); this.core.dispose(); this.disposed = true;
  }
}

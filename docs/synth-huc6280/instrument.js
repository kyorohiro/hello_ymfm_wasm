// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 kyorohiro.
import {Huc6280Synth, Huc6280DirectTransport, HUC6280_CLOCK} from '../js/huc6280synth.js';
import {createDefaultPreset, readPreset} from './preset.js';
import {decodeDdaData} from './dda_pcm.js';

const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const hasLfo = preset => preset.source === 'wave' && preset.lfo.enabled;
const poolFor = preset => preset.source === 'noise' ? [4,5] : hasLfo(preset) ? [0] : [0,1,2,3,4,5];
// Software volume automation is quantized to the real 1.5 dB channel steps.
// A fixed timeline makes rendering independent of AudioWorklet block sizes.
const ENVELOPE_QUANTUM = 16;
// Recover exact sample boundaries after floating-point rate conversion. Keep
// the tolerance below a quarter output frame, even at very slow playback.
const ddaBoundary = (position, step, length) => {
  const nearest = Math.round(position);
  const tolerance = Math.min(8 * Number.EPSILON * Math.max(1, Math.abs(position), length), step / 4);
  return Math.abs(position - nearest) <= tolerance ? nearest : position;
};

/** One physical six-channel PSG, with host keyboard allocation and optional
 * software ADSR. It does not invent extra Noise channels or FM routing. */
export class Huc6280Instrument {
  constructor(core) {
    if (!core || typeof core.processFrames !== 'function' || typeof core.writeHuc6280 !== 'function' ||
        typeof core.sampleRate !== 'function') throw new TypeError('Expected a HuC6280AudioEngine');
    this.core = core;
    this.synth = new Huc6280Synth({transport:new Huc6280DirectTransport(core)});
    this.synth.initialize();
    this.rate = core.sampleRate(); this.preset = createDefaultPreset();
    this.pitch = 0; this.cursor = 0; this.sequence = 0; this.frame = 0;
    this.voices = new Map(); this.slots = Array(6).fill(null); this.levels = Array(6).fill(null); this.disposed = false;
    this.ddaSamples=decodeDdaData(this.preset.dda.data); this.ddaValues=Array(6).fill(null);
    this._apply(null, this.preset); this.stop();
  }
  _open() { if (this.disposed) throw new Error('HuC6280 instrument is disposed'); }
  _frequency(midi, pitch = this.pitch) {
    const hz = 440 * 2 ** ((midi - 69 + pitch) / 12);
    // Notes outside the 12-bit period range reach the hardware endpoint.
    return Math.max(HUC6280_CLOCK / (32 * 4096), Math.min(HUC6280_CLOCK / 32, hz));
  }
  _setPeriod(channel, period) {
    const encoded = period & 4095;
    this.synth.writeRegister(0, channel);
    this.synth.writeRegister(2, encoded & 255);
    this.synth.writeRegister(3, encoded >> 8);
  }
  _tuneVoice(voice, pitch = this.pitch) {
    if(voice.dda) {
      voice.step=this.preset.dda.sampleRate*this.preset.dda.speed*2**((voice.midi-this.preset.dda.rootNote+pitch)/12)/this.rate;
      return;
    }
    if (hasLfo(this.preset) && this.preset.lfo.mode === 'recorded') {
      const period = Math.max(1, Math.min(4096, Math.round(this.preset.lfo.carrierPeriod * 2 ** ((60 - voice.midi - pitch) / 12))));
      this._setPeriod(voice.channel, period);
      this._setPeriod(1, this.preset.lfo.modulatorPeriod);
    } else {
      const hz = this._frequency(voice.midi, pitch);
      this.synth.setFrequency(voice.channel, hz);
      if (hasLfo(this.preset)) this.synth.setFrequency(1, hz);
    }
  }
  _heldLevel(voice, frame = this.frame) {
    const env = voice.envelope;
    if (!env.enabled) return 1;
    const time = Math.max(0, (frame - voice.startFrame) / this.rate);
    if (env.attack > 0 && time < env.attack) return time / env.attack;
    if (env.decay > 0 && time < env.attack + env.decay) return 1 - (1 - env.sustain) * (time - env.attack) / env.decay;
    return env.sustain;
  }
  _level(voice) {
    let level=this._heldLevel(voice);
    if(voice.released) {
      const elapsed = (this.frame - voice.releaseFrame) / this.rate;
      level=voice.envelope.release<=0||elapsed>=voice.envelope.release?0:voice.releaseLevel*(1-elapsed/voice.envelope.release);
    }
    // A one-shot has a known end. Reuse the authored software Release to ease
    // that edge, without modifying the five-bit PCM or crossfading loop data.
    if(voice.dda&&voice.envelope.enabled&&!this.preset.dda.loop&&voice.envelope.release>0) {
      const remaining=(this.ddaSamples.length-voice.position)/voice.step/this.rate;
      level*=Math.max(0,Math.min(1,remaining/voice.envelope.release));
    }
    return level;
  }
  _setLevel(channel, level, base = this.preset.volume) {
    const volume = level <= 0 || base === 0 ? 0 : Math.max(0, Math.min(31, base + Math.round(20 * Math.log10(level) / 1.5)));
    if (this.levels[channel] !== volume) { this.synth.setVolume(channel, volume); this.levels[channel] = volume; }
  }
  _setVoiceLevel(voice, level) {
    this._setLevel(voice.channel, level);
    if (voice.paired) this._setLevel(1, level, this.preset.lfo.output.volume);
  }
  _retire(voice) {
    this.synth.keyOff(voice.channel);
    if(voice.dda) this._writeDda(voice.channel,16);
    if (voice.paired) this.synth.keyOff(1);
    if (this.voices.get(voice.id) === voice) this.voices.delete(voice.id);
    if (this.slots[voice.channel] === voice) this.slots[voice.channel] = null;
  }
  _advanceEnvelopes() {
    for (const voice of this.slots) {
      if (!voice) continue;
      if(voice.ended) continue;
      const level = this._level(voice);
      if (voice.released && level <= 0) this._retire(voice);
      else this._setVoiceLevel(voice, level);
    }
  }
  _apply(previous, next) {
    const changed = getter => !previous || !same(getter(previous), getter(next));
    const lfo = hasLfo(next);
    if (changed(p => p.wave) || changed(p => p.source) || changed(p => p.lfo.enabled) || changed(p => p.lfo.wave)) {
      for (let ch = 0; ch < 6; ch++) this.synth.setWaveform(ch, lfo && ch === 1 ? next.lfo.wave : next.wave);
      this.levels.fill(null);
    }
    if(changed(p=>p.source)||changed(p=>p.wave)||changed(p=>p.lfo.enabled)||changed(p=>p.lfo.wave)) for(let channel=0;channel<6;channel++) {
      this.synth.setDda(channel,next.source==='dda');
      if(next.source==='dda') this._writeDda(channel,16);
    }
    if (changed(p => p.pan) || changed(p => p.source) || changed(p => p.lfo.enabled)) {
      for (let ch = 0; ch < 6; ch++) this.synth.setPan(ch, next.pan.left, next.pan.right);
    }
    if (changed(p => p.source) || changed(p => p.noise.frequency)) for (const ch of [4,5]) {
      this.synth.setNoise(ch, {enabled:next.source === 'noise', frequency:next.noise.frequency});
    }
    if (changed(p => p.source) || changed(p => p.lfo.enabled) || changed(p => p.lfo.frequency) || changed(p => p.lfo.depth) || changed(p => p.lfo.reset)) {
      this.synth.setLfo({frequency:next.lfo.frequency, depth:lfo ? next.lfo.depth : 0, reset:lfo && next.lfo.reset});
    }
    if (lfo) {
      this.synth.setPan(1, next.lfo.output.pan.left, next.lfo.output.pan.right);
      if (!this.slots[0]?.paired || !next.lfo.output.enabled) {
        this.synth.setVolume(1, next.lfo.output.volume); this.synth.keyOff(1); this.levels[1] = next.lfo.output.volume;
      }
    }
  }
  read() {
    this._open();
    const state = this.synth._getState();
    return {preset:readPreset(this.preset), voices:[...this.voices.values()].map(({id,midi,channel}) => ({id,midi,channel})),
      tails:this.slots.filter(voice => voice?.released).map(({id,channel}) => ({id,channel})),
      capacity:poolFor(this.preset).length, pitch:this.pitch, registers:state.registers, globals:state.globals,
      dda:{samples:this.ddaSamples.length,sampleRate:this.preset.dda.sampleRate,duration:this.ddaSamples.length/this.preset.dda.sampleRate,
        voices:this.slots.filter(voice=>voice?.dda).map(({id,channel,position,ended})=>({id,channel,position,ended}))}};
  }
  setPreset(value) {
    this._open();
    const next = readPreset(value), previous = this.preset;
    const clear = previous.source !== next.source || !same(previous.wave, next.wave) || previous.lfo.enabled !== next.lfo.enabled ||
      !same(previous.lfo.wave, next.lfo.wave) || previous.lfo.mode !== next.lfo.mode ||
      previous.lfo.output.enabled !== next.lfo.output.enabled || previous.envelope.enabled !== next.envelope.enabled || previous.dda.data!==next.dda.data;
    if (clear) this.stop();
    this._apply(previous, next); this.preset = next;
    if(previous.dda.data!==next.dda.data) this.ddaSamples=decodeDdaData(next.dda.data);
    if (next.source === 'wave' && (!same(previous.lfo.carrierPeriod, next.lfo.carrierPeriod) || !same(previous.lfo.modulatorPeriod, next.lfo.modulatorPeriod))) {
      for (const voice of this.slots) if (voice) this._tuneVoice(voice);
    }
    if(next.source==='dda') for(const voice of this.slots) if(voice) this._tuneVoice(voice);
    this._advanceEnvelopes();
    return this.read();
  }
  loadPreset(value) {
    this._open(); const next = readPreset(value);
    this.stop(); this._apply(this.preset, next); this.preset = next; this.pitch = 0;
    this.ddaSamples=decodeDdaData(next.dda.data);
    return this.read();
  }
  noteOn(id, midi) {
    this._open();
    if (typeof id !== 'string' || !id.length || id.length > 128) throw new TypeError('Expected a note identity of 1–128 characters');
    if (this.voices.has(id)) throw new Error('Note identity is already active');
    if (!Number.isInteger(midi) || midi < 0 || midi > 127) throw new RangeError('Expected a MIDI note 0–127');
    if(this.preset.source==='dda'&&!this.ddaSamples.length) throw new Error('Load audio before playing DDA PCM');
    const pool = poolFor(this.preset);
    let channel;
    for (let offset = 0; offset < pool.length; offset++) {
      const candidate = pool[(this.cursor + offset) % pool.length];
      if (this.slots[candidate] === null) { channel = candidate; break; }
    }
    if (channel === undefined) channel = pool.reduce((oldest, candidate) => {
      const a = this.slots[oldest], b = this.slots[candidate];
      const idleA=a.released||a.ended,idleB=b.released||b.ended;
      return idleB&&!idleA||Boolean(idleA)===Boolean(idleB)&&b.order<a.order?candidate:oldest;
    }, pool[0]);
    const previous = this.slots[channel];
    if (previous) this._retire(previous);
    const voice = {id,midi,channel,order:++this.sequence,startFrame:this.frame,released:false,
      paired:hasLfo(this.preset) && this.preset.lfo.output.enabled,envelope:{...this.preset.envelope},
      dda:this.preset.source==='dda',position:0,positionCompensation:0,ended:false};
    if (this.preset.source === 'wave'||voice.dda) this._tuneVoice(voice);
    if(voice.dda) this._writeDda(channel,this.ddaSamples[0]);
    this._setVoiceLevel(voice, this._level(voice));
    if (voice.paired) this.synth.keyOn(1);
    this.synth.keyOn(channel);
    this.slots[channel] = voice; this.voices.set(id, voice); this.cursor = (pool.indexOf(channel) + 1) % pool.length;
    return {channel, stolenId:previous?.released ? null : previous?.id ?? null};
  }
  noteOff(id) {
    this._open(); const voice = this.voices.get(id);
    if (!voice || this.slots[voice.channel] !== voice) return false;
    this.voices.delete(id);
    if (voice.ended || !voice.envelope.enabled || voice.envelope.release <= 0) this._retire(voice);
    else {
      voice.releaseLevel = this._heldLevel(voice); voice.releaseFrame = this.frame; voice.released = true;
      if (voice.releaseLevel <= 0) this._retire(voice);
      else this._setVoiceLevel(voice, this._level(voice));
    }
    return true;
  }
  setPitch(semitones) {
    this._open();
    if (!Number.isFinite(semitones) || semitones < -24 || semitones > 24) throw new RangeError('Pitch must be between -24 and +24 semitones');
    if (this.preset.source === 'wave'||this.preset.source==='dda') for (const voice of this.slots) {
      if (!voice) continue;
      this._tuneVoice(voice, semitones);
    }
    this.pitch = semitones; return this.read();
  }
  stop() {
    this._open(); this.synth.allNotesOff();
    if(this.preset.source==='dda') for(let channel=0;channel<6;channel++) this._writeDda(channel,16);
    this.voices.clear(); this.slots.fill(null); this.cursor = 0;
    return this.read();
  }
  generateStereo(frames) {
    this._open();
    if (!Number.isInteger(frames) || frames < 0 || frames > 0x1000000) throw new RangeError('Invalid frame count');
    const left = new Float32Array(frames), right = new Float32Array(frames);
    if(this.preset.source==='dda') return this._generateDda(frames,left,right);
    let offset = 0;
    while (offset < frames) {
      if (this.frame % ENVELOPE_QUANTUM === 0) this._advanceEnvelopes();
      const count = Math.min(frames - offset, ENVELOPE_QUANTUM - this.frame % ENVELOPE_QUANTUM);
      const output = this.core.processFrames(count);
      left.set(output.left, offset); right.set(output.right, offset);
      this.frame += count; offset += count;
    }
    if (this.frame % ENVELOPE_QUANTUM === 0) this._advanceEnvelopes();
    return {left,right};
  }
  _writeDda(channel,value) {
    if(this.ddaValues[channel]===value) return;
    this.synth.writeDda(channel,value);this.ddaValues[channel]=value;
  }
  _endDda(voice) {
    voice.ended=true;voice.position=this.ddaSamples.length;voice.positionCompensation=0;
    this.synth.keyOff(voice.channel);this._writeDda(voice.channel,16);
    if(voice.released) this._retire(voice);
  }
  _generateDda(frames,left,right) {
    const playing=[];
    for(let offset=0;offset<frames;offset++) {
      playing.length=0;
      for(const voice of this.slots) if(voice?.dda&&!voice.ended) playing.push(voice);
      if(!playing.length) {
        const output=this.core.processFrames(frames-offset);left.set(output.left,offset);right.set(output.right,offset);
        this.frame+=frames-offset;break;
      }
      if(this.frame%ENVELOPE_QUANTUM===0) this._advanceEnvelopes();
      for(const voice of playing) if(this.slots[voice.channel]===voice&&!voice.ended) {
        this._writeDda(voice.channel,this.ddaSamples[Math.min(this.ddaSamples.length-1,Math.floor(ddaBoundary(voice.position,voice.step,this.ddaSamples.length)))]);
      }
      const output=this.core.processFrames(1);left[offset]=output.left[0];right[offset]=output.right[0];this.frame++;
      for(const voice of playing) if(this.slots[voice.channel]===voice&&!voice.ended) {
        // Compensated summation prevents a rational step such as 1/6 from
        // accumulating into a sample one output frame late.
        const increment=voice.step-voice.positionCompensation, next=voice.position+increment;
        voice.positionCompensation=(next-voice.position)-increment;
        const boundary=ddaBoundary(next,voice.step,this.ddaSamples.length);
        voice.position=boundary;
        if(Number.isInteger(boundary)) voice.positionCompensation=0;
        if(boundary>=this.ddaSamples.length) {
          if(this.preset.dda.loop) {
            voice.position=boundary%this.ddaSamples.length;
          }
          else this._endDda(voice);
        }
      }
    }
    if(this.frame%ENVELOPE_QUANTUM===0) this._advanceEnvelopes();
    return {left,right};
  }
  dispose() {
    if (this.disposed) return;
    this.stop(); this.synth.dispose(); this.core.dispose(); this.disposed = true;
  }
}

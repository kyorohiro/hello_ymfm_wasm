// SPDX-License-Identifier: BSD-3-Clause
import {algorithms} from './algorithms.js';

export const MODE = 0x2804, ALGORITHM = 0x2805, PITCH = 0x3000, RATIO = 0x3020,
  DETUNE = 0x3030, RATE = 0x3040, LEVEL = 0x3060, OUTPUT = 0x3080, SENS = 0x30e0, AM = 0x30f0, EVENT = 0x30f1, PM = 0x30f2;

export function integer(value, min, max, label) {
  if (!Number.isInteger(value) || value < min || value > max)
    throw new RangeError(`${label} must be ${min}..${max}`);
  return value;
}
export function validRegister(address) {
  if(address===MODE || address===ALGORITHM) return;
  integer(address,PITCH,PM+1,'EGS address');
  const i=address-PITCH;
  if (!(i<0x2c || (i>=0x30 && i<0x36) || (i>=0x40 && i<0x58) || (i>=0x60 && i<0x78) ||
    (i>=0x80 && i<0xe6) || i>=0xf0)) throw new RangeError('Unimplemented EGS register');
}
const tau = 2 * Math.PI;
const amplitude = attenuation => attenuation >= 127 ? 0 : 2 ** (-attenuation / 8);
export class Fm21290 {
  constructor(sampleRate = 48000) {
    this.sampleRate = integer(sampleRate, 8000, 384000, 'sample rate');
    this.reg = new Uint8Array(256);
    this.reg.fill(255, 0x80, 0xe0);
    this.algorithms = new Uint8Array(16);
    this.voices = Array.from({length:16}, () => ({
      active:false, held:false, phase:new Float64Array(6), gain:new Float64Array(6),
      step:new Float64Array(6), rateOffset:new Uint8Array(6), level:new Float64Array(6), stage:new Uint8Array(6),
      attack:new Float64Array(24), decay:new Float64Array(24).fill(1), feedback:0, previous:0,
    }));
    this.attackByRate = new Float64Array(64);
    this.decayByRate = new Float64Array(64);
    for (let rate=0; rate<64; rate++) {
      this.attackByRate[rate] = 2 ** ((rate-32)/4) * 9.6 / sampleRate;
      const octaves = (4 + rate%4) * 2 ** (Math.floor(rate/4)-22) * 44100 / sampleRate;
      this.decayByRate[rate] = 2 ** -octaves;
    }
    for (const voice of this.voices) {
      voice.attack.fill(this.attackByRate[0]);
      voice.decay.fill(this.decayByRate[0]);
    }
    this.targets = new Float64Array(24);
    this.bus = new Float64Array(3);
    this.amGain = new Float64Array(6).fill(1);
    this.mode = 0x50;
    this.sync = false;
    this.frame = 0;
  }
  updateRate(voice, idx) {
    const rate = Math.min(63, this.reg[0x40+idx] + voice.rateOffset[idx >> 2]);
    voice.attack[idx] = this.attackByRate[rate];
    voice.decay[idx] = this.decayByRate[rate];
  }
  tune(ch) {
    const r = this.reg, voice = this.voices[ch];
    const key = (r[ch*2] << 8) | r[ch*2+1];
    // The MSFA comparison model groups three semitones per scaling step.
    // Recover the nearest key from the unmodulated EGS pitch.
    const note = Math.round(69 + (key-0x5aa8)*12/4096);
    const keyGroup = Math.max(0,Math.min(31,Math.floor(note/3)-7));
    const mod = ((r[0xf2]<<24) | (r[0xf3]<<16)) >> 16;
    for (let op = 0; op < 6; op++) {
      const i = 0x20 + op*2, pitch = (r[i] << 8) | r[i+1];
      const detune = r[0x30+op], cents = (detune & 7) * (detune & 8 ? -1 : 1);
      const rateOffset = ((r[0xe0+op] & 7) * keyGroup) >> 3;
      if (voice.rateOffset[op] !== rateOffset) {
        voice.rateOffset[op] = rateOffset;
        for (let stage=0; stage<4; stage++) this.updateRate(voice,op*4+stage);
      }
      const hz = pitch & 1 ? 2 ** (((pitch & ~3) - 0x16ac) / 4096)
        : 440 * 2 ** ((key + mod - 0x5aa8 + (pitch & ~3) - 0x232c) / 4096);
      voice.step[op] = tau * hz * 2 ** (cents/1200) / this.sampleRate;
    }
  }
  writeRegister(address, data) {
    integer(data, 0, 255, 'data');
    if (address === MODE) {
      this.mode = data;
      if (data & 32) this.sync = true;
      if (data & 64) this.sync = false;
      return;
    }
    if (address === ALGORITHM) {
      if ((this.mode & 0x94) === 0x10) this.algorithms.fill(data);
      else if ((this.mode & 0x90) === 0) this.algorithms[this.mode & 15] = data;
      return;
    }
    const i = address - PITCH;
    validRegister(address);
    this.reg[i] = data;
    if(i===0xf0 || (i>=0xe0 && i<0xe6)){
      for(let op=0;op<6;op++) this.amGain[op]=2 ** (-(this.reg[0xe0+op]>>3 & 3)*this.reg[0xf0]/64);
    }
    if (i < 32) this.tune(i >> 1);
    else if (i < 0x36 || i >= 0xf2 || (i >= 0xe0 && i < 0xe6)) for (let ch = 0; ch < 16; ch++) this.tune(ch);
    else if (i < 0x58) {
      for (const voice of this.voices) this.updateRate(voice,i-0x40);
    }
    else if (i < 0x78) this.targets[i-0x60] = data >= 63 ? 0 : amplitude(data * 2);
    else if (i < 0xe0) this.voices[i & 15].level[(i-0x80) >> 4] = amplitude(data / 2);
    else if (i === 0xf1) {
      const v = this.voices[(data >> 2) & 15];
      if ((data & 3) === 1) {
        v.active = v.held = true;
        v.stage.fill(0);
        if (this.sync) v.phase.fill(0);
      } else if ((data & 3) === 2) { v.held = false; v.stage.fill(3); }
    }
  }
  renderInto(buffer) {
    buffer.fill(0);
    for (let ch = 0; ch < 16; ch++) {
      const v = this.voices[ch], setting = this.algorithms[ch];
      const route = algorithms[setting >> 3], feedback = setting & 7;
      for (let frame = 0; frame < buffer.length && v.active; frame++) {
        this.bus.fill(0);
        let sounding = false;
        for (let op = 0; op < 6; op++) {
          const stage = v.stage[op], idx = op*4 + stage;
          const target = this.targets[idx], gain = v.gain[op];
          if (gain < target) {
            v.gain[op] = Math.min(target, gain + v.attack[idx]);
          } else if (gain > target) {
            const next = Math.max(target, gain * v.decay[idx]);
            v.gain[op] = target === 0 && next < 1e-6 ? 0 : next;
          }
          if (v.gain[op] === target && stage < 2) v.stage[op]++;
          const flags = route[op], input = (flags >> 4) & 3, out = flags & 3;
          let modulation = input ? this.bus[input] * 8 : 0;
          if ((flags & 64) && feedback) modulation += (v.previous + v.feedback) * 2 ** (feedback-5);
          const value = Math.sin(v.phase[op] + modulation) * v.level[op] * v.gain[op] * this.amGain[op];
          v.phase[op] = (v.phase[op] + v.step[op]) % tau;
          if (flags & 128) { v.previous = v.feedback; v.feedback = value; }
          this.bus[out] = flags & 4 ? this.bus[out] + value : value;
          if (v.gain[op] * v.level[op] > 0.00001) sounding = true;
        }
        buffer[frame] += this.bus[0] * 0.08;
        if (!v.held && !sounding) v.active = false;
      }
    }
    this.frame += buffer.length;
  }
}

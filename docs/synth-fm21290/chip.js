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
// A settled OL99 operator spans two phase cycles in the MSFA reference.
// The register gain at OL99 / velocity sensitivity 0 is 2^(-4/16).
const busToRadians = 2 * tau * 2 ** (4/16);
// Two returned samples are averaged, then scaled by the FBL shift.
const feedbackGain = Array.from({length:8}, (_,fbl) => fbl ? busToRadians * 2 ** (fbl-9) : 0);
// OPS COM ROM logarithms in eighths of an octave, indexed by carrier count - 1.
const comLog = [0,8,13,16,19,21];
const carrierGain = algorithms.map(route => {
  const count = route.filter(flags => (flags & 3) === 0).length;
  return 2 ** (-comLog[count-1]/8);
});
const amplitude = attenuation => attenuation >= 127 ? 0 : 2 ** (-attenuation / 8);
export class Fm21290 {
  constructor(sampleRate = 48000) {
    this.sampleRate = integer(sampleRate, 8000, 384000, 'sample rate');
    this.reg = new Uint8Array(256);
    this.reg.fill(255, 0x80, 0xe0);
    this.algorithms = new Uint8Array(16);
    this.voices = Array.from({length:16}, () => ({
      active:false, held:false, idleSince:0, phase:new Float64Array(6), gain:new Float64Array(6),
      step:new Float64Array(6), rateOffset:new Uint8Array(6), level:new Float64Array(6), stage:new Uint8Array(6),
      attackScale:new Float64Array(6).fill(1), attack:new Float64Array(24), decay:new Float64Array(24).fill(1), feedback:0, previous:0,
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
  advanceIdle(voice) {
    if (voice.active || voice.idleSince === this.frame) return;
    const frames = this.frame - voice.idleSince;
    for (let op=0; op<6; op++) {
      voice.phase[op] = (voice.phase[op] + frames * voice.step[op]) % tau;
    }
    // Inactive slots contribute zero output to the two-sample return path.
    voice.previous = frames === 1 ? voice.feedback : 0;
    voice.feedback = 0;
    voice.idleSince = this.frame;
  }
  tune(ch) {
    const r = this.reg, voice = this.voices[ch];
    this.advanceIdle(voice);
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
    // Repeated CPU timer writes are observable on the bus. Only changed
    // modulation bytes require updating the oscillator or gain caches.
    if ((address===AM || address===PM || address===PM+1) && this.reg[i]===data) return;
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
    else if (i < 0xe0) {
      const voice = this.voices[i & 15], op = (i-0x80) >> 4;
      // Preserve the instrument's OL99 / KVS0 mix reference when the
      // firmware bias changes its byte from the legacy 4 to 15.
      voice.level[op] = data >= 254 ? 0 : 2 ** ((11-data)/16);
      // Fit the normalized rising slope to the OL85 and OL65 PCM fixtures.
      // Bound extrapolation at very low levels; recompute only on a bus write.
      voice.attackScale[op] = 2 ** ((Math.min(data,123)-43)/40);
    }
    else if (i === 0xf1) {
      const v = this.voices[(data >> 2) & 15];
      if ((data & 3) === 1) {
        this.advanceIdle(v);
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
      const compensation = carrierGain[setting >> 3];
      const route = algorithms[setting >> 3], feedback = feedbackGain[setting & 7];
      for (let frame = 0; frame < buffer.length && v.active; frame++) {
        this.bus.fill(0);
        let sounding = false;
        for (let op = 0; op < 6; op++) {
          const stage = v.stage[op], idx = op*4 + stage;
          const target = this.targets[idx], gain = v.gain[op];
          if (gain < target) {
            v.gain[op] = Math.min(target, gain + v.attack[idx] * v.attackScale[op]);
          } else if (gain > target) {
            const next = Math.max(target, gain * v.decay[idx]);
            v.gain[op] = target === 0 && next < 1e-6 ? 0 : next;
          }
          if (v.gain[op] === target && stage < 2) v.stage[op]++;
          const flags = route[op], input = (flags >> 4) & 3, out = flags & 3;
          let modulation = input ? this.bus[input] * busToRadians : 0;
          if ((flags & 64) && feedback) modulation += (v.previous + v.feedback) * feedback;
          const value = Math.sin(v.phase[op] + modulation) * v.level[op] * v.gain[op] * this.amGain[op] * (out === 0 ? compensation : 1);
          v.phase[op] = (v.phase[op] + v.step[op]) % tau;
          if (flags & 128) { v.previous = v.feedback; v.feedback = value; }
          this.bus[out] = flags & 4 ? this.bus[out] + value : value;
          if (v.gain[op] * v.level[op] > 0.00001) sounding = true;
        }
        buffer[frame] += this.bus[0] * 0.08;
        if (!v.held && !sounding) {
          v.active = false;
          v.idleSince = this.frame + frame + 1;
        }
      }
    }
    this.frame += buffer.length;
  }
}

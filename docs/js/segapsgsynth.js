import {noteToHz} from './soundchip_pitch.js';
/**
 * @file segapsgsynth.js
 * 実行環境: Browser / Node.js
 * 依存: 注入されたレジスタ書き込み関数。DOM・Web Audio は不要。
 */
import { SEGAPSG_CLOCK } from "./segapsg.js?v=audio-stability-2";

const NOTE_TO_SEMITONE = {
  C: 0, "C#": 1, Db: 1, D: 2, "D#": 3, Eb: 3,
  E: 4, F: 5, "F#": 6, Gb: 6, G: 7, "G#": 8,
  Ab: 8, A: 9, "A#": 10, Bb: 10, B: 11,
};

const NOISE_RATES = {
  low: 0,
  medium: 1,
  high: 2,
  tone3: 3,
};

/** Direct register transport. The caller retains ownership of the chip. */
export class SegaPSGDirectTransport {
  /** @param {import('./segapsg.js?v=audio-stability-2').SegaPSG} chip */
  constructor(chip) {
    if (!chip || typeof chip.write !== 'function') throw new TypeError('SegaPSGDirectTransport requires write(value)');
    this.chip = chip;
  }
  /** @param {number} value */
  write(value) { this.chip.write(value); }
  reset() { this.chip.reset(); }
}

/** Tone/noise register generation shared by Node.js and browser transports. */
export class SegaPSGSynth {
  #attenuations = new Uint8Array(4);
  #latched = 0;
  /** @param {{transport: {clock?:number, write: (value: number) => void, reset?: () => void, resetAll?: () => void}}} [options] Ordered register transport. */
  constructor({transport} = {}) {
    if (!transport || typeof transport.write !== 'function') throw new TypeError('SegaPSGSynth requires a transport with write(value)');
    this.transport = transport;
  }
  /** Write a raw PSG command byte. @param {number} value */
  write(value) {
    const byte = normalizeByte(value);
    if (byte & 128) this.#latched = (byte >> 4) & 7;
    if (this.#latched & 1) this.#attenuations[this.#latched >> 1] = byte & 15;
    return this.transport.write(byte);
  }
  reset() { const result = this.transport.reset?.(); this.#attenuations.fill(0); this.#latched = 0; return result; }
  resetAll() { const result = this.transport.resetAll?.(); this.#attenuations.fill(0); this.#latched = 0; return result; }
  /** @param {number} channel Physical tone channel, 0..2.
   * @param {{note?: string, frequency?: number, period?: number, attenuation?: number, volume?: number}} [options]
   * @returns {number} Written 10-bit period, calculated using SEGAPSG_CLOCK.
   */
  tone(channel, options = {}) {
    const normalizedChannel = normalizeToneChannel(channel);
    const period = resolveTonePeriod(options, this.transport.clock ?? SEGAPSG_CLOCK);
    const attenuation = resolveAttenuation(options);
    writeTone(this.write.bind(this), normalizedChannel, period, attenuation);
    return period;
  }
  /** Set the exact 10-bit tone period without changing attenuation. Zero retains chip-specific behavior. @param {number} channel @param {number} period */
  setPeriod(channel, period) {
    const ch = normalizeToneChannel(channel);
    if (!Number.isInteger(period) || period < 0 || period > 1023) throw new RangeError('PSG period must be 0..1023');
    this.write(0x80 | (ch << 5) | (period & 15));
    this.write(period >> 4);
    return period;
  }
  /** Configure Hz, preserving attenuation. @param {number} channel @param {number} hz */
  setFrequency(channel, hz) {
    normalizeToneChannel(channel);
    if (!Number.isFinite(hz) || hz <= 0) throw new RangeError('Frequency must be positive finite Hz');
    return this.setPeriod(channel, psgPeriodFromFrequency(hz, this.transport.clock ?? SEGAPSG_CLOCK));
  }
  /** @param {number} channel @param {string|number} note */
  setNote(channel, note) { return this.setFrequency(channel, noteToHz(note)); }
  /** Restore the configured attenuation without changing pitch. @param {number} channel */
  keyOn(channel) { const ch = normalizeToneChannel(channel); this.setAttenuation(ch, this.#attenuations[ch]); }
  /** Silence while remembering the configured attenuation. @param {number} channel */
  keyOff(channel) {
    const ch = normalizeToneChannel(channel), attenuation = this.#attenuations[ch];
    this.setAttenuation(ch, 15); this.#attenuations[ch] = attenuation;
  }
  /** @param {number} channel @param {string|number} note */
  noteOn(channel, note) { this.setNote(channel, note); this.keyOn(channel); }
  /** Set attenuation only: 0 is loudest, 15 is silent; channel 3 is noise. @param {number} channel @param {number} attenuation */
  setAttenuation(channel, attenuation) {
    if (!Number.isInteger(channel) || channel < 0 || channel > 3) throw new RangeError('PSG channel must be 0..3');
    writeAttenuation(this.write.bind(this), channel, normalizeAttenuation(attenuation));
  }
  /** Write noise control only. Resets the noise shift register, without changing attenuation. */
  setNoise({type = 'white', rate = 'medium'} = {}) {
    if (type !== 'white' && type !== 'periodic') throw new Error('Invalid PSG noise type');
    if (!Object.hasOwn(NOISE_RATES, rate)) throw new Error('Invalid PSG noise rate');
    const mode = (type === 'white' ? 4 : 0) | NOISE_RATES[rate];
    this.write(0xe0 | mode);
    return mode;
  }
  /** @param {number} channel */
  off(channel) {
    this.keyOff(channel);
  }
  /** @param {{type?: "white"|"periodic", rate?: "low"|"medium"|"high"|"tone3", attenuation?: number, volume?: number}} [options]
   * @returns {number} Noise mode bits.
   */
  noise(options = {}) {
    const type = options.type ?? "white";
    if (type !== "white" && type !== "periodic") {
      throw new Error('psg.noise type must be "white" or "periodic"');
    }
    const rate = options.rate ?? "medium";
    const rateBits = NOISE_RATES[rate];
    if (rateBits === undefined) {
      throw new Error('psg.noise rate must be "low", "medium", "high", or "tone3"');
    }
    const attenuation = resolveAttenuation(options);
    const mode = (type === "white" ? 0x04 : 0) | rateBits;
    this.write(0xe0 | mode);
    this.write(0xf0 | attenuation);
    return mode;
  }
  /** @param {number} volume */
  noiseVolume(volume) {
    this.write(0xf0 | resolveAttenuation({ volume }));
  }
  noiseOff() {
    this.write(0xff);
  }
}

/** @param {number} frequency */
export function psgPeriodFromFrequency(frequency, clock = SEGAPSG_CLOCK) {
  const value = Number(frequency);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`PSG frequency must be a positive finite number, got ${frequency}`);
  }
  return Math.max(1, Math.min(0x3ff, Math.round(clock / (32 * value))));
}

/** @param {string | number} note */
export function psgPeriodFromNote(note, clock = SEGAPSG_CLOCK) {
  const match = /^([A-G](?:#|b)?)(-?\d+)$/.exec(String(note).trim());
  if (!match || NOTE_TO_SEMITONE[match[1]] === undefined) {
    throw new Error(`Unsupported PSG note: ${note}`);
  }
  const midi = (Number(match[2]) + 1) * 12 + NOTE_TO_SEMITONE[match[1]];
  return psgPeriodFromFrequency(440 * 2 ** ((midi - 69) / 12), clock);
}

function resolveTonePeriod(options, clock = SEGAPSG_CLOCK) {
  if (!options || typeof options !== "object") {
    throw new Error("psg.tone options must be an object");
  }
  if (options.period !== undefined) {
    return normalizePeriod(options.period);
  }
  if (options.frequency !== undefined) {
    return psgPeriodFromFrequency(options.frequency, clock);
  }
  if (options.note !== undefined) {
    return psgPeriodFromNote(options.note, clock);
  }
  throw new Error("psg.tone requires period, frequency, or note");
}

function resolveAttenuation(options) {
  if (options.attenuation !== undefined) {
    return normalizeAttenuation(options.attenuation);
  }
  if (options.volume === undefined) {
    return 0;
  }
  const volume = Number(options.volume);
  if (!Number.isFinite(volume) || volume < 0 || volume > 1) {
    throw new Error(`PSG volume must be in range 0..1, got ${options.volume}`);
  }
  return 15 - Math.round(volume * 15);
}

/** @param {number} channel
 * @param {number} period
 * @param {number} attenuation */
function writeTone(write, channel, period, attenuation) {
  write(0x80 | (channel << 5) | (period & 0x0f));
  write((period >> 4) & 0x3f);
  writeAttenuation(write, channel, attenuation);
}

/** @param {number} channel
 * @param {number} attenuation */
function writeAttenuation(write, channel, attenuation) {
  write(0x90 | (channel << 5) | attenuation);
}

function normalizeToneChannel(value) {
  const channel = Number(value);
  if (!Number.isInteger(channel) || channel < 0 || channel > 2) {
    throw new Error("PSG tone channel must be 0..2");
  }
  return channel;
}

function normalizePeriod(value) {
  const period = Number(value);
  if (!Number.isInteger(period) || period < 1 || period > 0x3ff) {
    throw new Error("PSG period must be an integer in range 1..1023");
  }
  return period;
}

function normalizeAttenuation(value) {
  const attenuation = Number(value);
  if (!Number.isInteger(attenuation) || attenuation < 0 || attenuation > 15) {
    throw new Error("PSG attenuation must be an integer in range 0..15");
  }
  return attenuation;
}

function normalizeByte(value) {
  const byte = Number(value);
  if (!Number.isInteger(byte) || byte < 0 || byte > 0xff) {
    throw new Error("PSG write value must be an integer in range 0..255");
  }
  return byte;
}

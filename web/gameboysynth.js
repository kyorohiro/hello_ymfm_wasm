/** Shared, synchronous Game Boy register synthesizer. No audio-device dependency. */
import {GAMEBOY_APU_CLOCK} from './gameboyapu.js';
const DUTIES = [0.125, 0.25, 0.5, 0.75];
const LEVELS = [0, 1, 0.5, 0.25];
const TRIGGERS = new Set([4, 9, 14, 19]);
function integer(value, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) throw new RangeError(`Expected integer ${min}..${max}`);
  return value;
}
function choice(value, values) {
  if (!values.includes(value)) throw new RangeError(`Expected one of ${values.join(', ')}`);
  return values.indexOf(value);
}
function options(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      (Object.getPrototypeOf(value) !== null && Object.getPrototypeOf(Object.getPrototypeOf(value)) !== null)) throw new TypeError('Expected options object');
  for (const key of Reflect.ownKeys(value)) if (!keys.includes(key)) throw new TypeError(`Unknown property: ${String(key)}`);
}
function noteHz(note) {
  let midi = note;
  if (typeof note === 'string') {
    const match = /^([A-G])([#b]?)(-?\d+)$/.exec(note);
    if (!match) throw new RangeError('Invalid note');
    midi = (Number(match[3]) + 1) * 12 + {C:0,D:2,E:4,F:5,G:7,A:9,B:11}[match[1]] + (match[2] === '#' ? 1 : match[2] === 'b' ? -1 : 0);
  }
  integer(midi, 0, 127);
  return 440 * 2 ** ((midi - 69) / 12);
}
/** Borrows the core. Disposing a Synth never destroys this transport's chip. */
export class GameboyDirectTransport {
  constructor(chip) {
    if (!chip || typeof chip.writeRegister !== 'function' || typeof chip.reset !== 'function') throw new TypeError('Expected GameboyApu');
    this.chip = chip;
  }
  writeRegister(offset, value) { this.chip.writeRegister(offset, value); }
  reset() { this.chip.reset(); }
}
export class GameboySynth {
  #transport; #clock; #disposed = false; #initialized = false;
  // Sent configuration and next-trigger configuration. Neither is a core status readback.
  #shadow = new Uint8Array(48); #voice = new Uint8Array(48);
  constructor({transport, clock = GAMEBOY_APU_CLOCK} = {}) {
    if (!transport || typeof transport.writeRegister !== 'function' || typeof transport.reset !== 'function') throw new TypeError('Expected transport');
    integer(clock, 1, 0x3fffffff);
    this.#transport = transport; this.#clock = clock;
    this.pulse = Object.freeze({
      setVoice: (ch, value) => this.#setVoice(this.#pulse(ch), value, false),
      setSweep: value => this.#sweep(value),
      setFrequency: (ch, hz) => this.#frequency(this.#pulse(ch) + 3, hz, 32),
      setNote: (ch, note) => { this.#ready(); return this.#frequency(this.#pulse(ch) + 3, noteHz(note), 32); },
      keyOn: ch => this.#keyOn(this.#pulse(ch)),
      keyOff: ch => { const base = this.#pulse(ch); this.#ready(); this.#send(base + 2, 0); },
    });
    this.wave = Object.freeze({
      setWaveform: samples => this.#waveform(samples),
      setLevel: level => { this.#ready(); const code = choice(level, LEVELS); this.#update(12, 0x60, code << 5, true); },
      setFrequency: hz => this.#frequency(13, hz, 64),
      setNote: note => { this.#ready(); return this.#frequency(13, noteHz(note), 64); },
      keyOn: () => { this.#ready(); this.#send(10, this.#voice[10] | 0x80); this.#send(12, this.#voice[12]); this.#trigger(13); },
      keyOff: () => { this.#ready(); this.#send(10, this.#shadow[10] & 0x7f); },
    });
    this.noise = Object.freeze({
      setVoice: value => this.#setVoice(15, value, true),
      keyOn: () => this.#keyOn(15),
      keyOff: () => { this.#ready(); this.#send(17, 0); },
    });
  }
  #alive() { if (this.#disposed) throw new Error('Game Boy disposed'); }
  #ready() { this.#alive(); if (!this.#initialized) throw new Error('Call initialize() before high-level operations'); }
  #pulse(ch) { this.#alive(); integer(ch, 0, 1); return ch * 5; }
  #send(offset, value) {
    this.#shadow[offset] = TRIGGERS.has(offset) ? value & 0x7f : value;
    this.#transport.writeRegister(offset, value);
  }
  #update(offset, mask, bits, immediate = false) {
    this.#voice[offset] = (this.#voice[offset] & ~mask) | bits;
    if (immediate) this.#send(offset, (this.#shadow[offset] & ~mask) | bits);
  }
  writeRegister(offset, value) {
    this.#alive(); integer(offset, 0, 47); integer(value, 0, 255);
    this.#voice[offset] = TRIGGERS.has(offset) ? value & 0x7f : value;
    if (offset === 22 && !(value & 0x80)) {
      this.#initialized = false;
      this.#shadow.fill(0, 0, 23); this.#voice.fill(0, 0, 23);
    }
    this.#send(offset, value);
  }
  reset() {
    this.#alive(); this.#transport.reset(); this.#initialized = false;
    this.#shadow.fill(0); this.#voice.fill(0);
  }
  initialize() {
    this.reset(); this.#send(22, 0x80); this.#voice[22] = 0x80; this.#initialized = true;
    this.setMasterVolume(3, 3);
    for (let ch = 0; ch < 4; ch++) this.setPan(ch, true, true);
    for (let ch = 0; ch < 2; ch++) {
      this.pulse.setVoice(ch, {duty: 0.5, volume: 10, envelope: {direction: 'down', period: 0}});
      this.pulse.setFrequency(ch, 440);
    }
    this.pulse.setSweep({direction: 'up', period: 0, shift: 0});
    this.wave.setWaveform(Array.from({length: 32}, (_, i) => i < 16 ? i : 31 - i));
    this.wave.setLevel(0.5); this.wave.setFrequency(220);
    this.noise.setVoice({volume: 10, envelope: {direction: 'down', period: 0}, divisor: 3, shift: 4, width: 15});
  }
  #setVoice(base, value, noise) {
    this.#ready(); options(value, noise ? ['volume', 'envelope', 'divisor', 'shift', 'width'] : ['duty', 'volume', 'envelope']);
    const changes = [];
    if ('volume' in value) changes.push([base + 2, 0xf0, integer(value.volume, 0, 15) << 4]);
    if ('envelope' in value) {
      options(value.envelope, ['direction', 'period']);
      if ('direction' in value.envelope) changes.push([base + 2, 8, choice(value.envelope.direction, ['down', 'up']) << 3]);
      if ('period' in value.envelope) changes.push([base + 2, 7, integer(value.envelope.period, 0, 7)]);
    }
    if ('duty' in value) changes.push([base + 1, 0xc0, choice(value.duty, DUTIES) << 6]);
    if ('divisor' in value) changes.push([18, 7, integer(value.divisor, 0, 7)]);
    if ('shift' in value) changes.push([18, 0xf0, integer(value.shift, 0, 15) << 4]);
    if ('width' in value) changes.push([18, 8, choice(value.width, [15, 7]) << 3]);
    for (const change of changes) this.#update(...change);
  }
  #sweep(value) {
    this.#ready(); options(value, ['direction', 'period', 'shift']);
    let next = this.#voice[0];
    if ('direction' in value) next = (next & ~8) | (choice(value.direction, ['up', 'down']) << 3);
    if ('period' in value) next = (next & ~0x70) | (integer(value.period, 0, 7) << 4);
    if ('shift' in value) next = (next & ~7) | integer(value.shift, 0, 7);
    this.#voice[0] = next;
  }
  #frequency(low, hz, divisor) {
    this.#ready();
    if (!Number.isFinite(hz) || hz <= 0) throw new RangeError('Expected finite positive Hz');
    const n = Math.round(2048 - this.#clock / (divisor * hz));
    integer(n, 0, 2047);
    this.#update(low, 255, n & 255, true);
    this.#update(low + 1, 0x87, n >> 8, true); // Never replay trigger; retain length-enable.
    return this.#clock / (divisor * (2048 - n));
  }
  #trigger(low) {
    this.#send(low, this.#voice[low]);
    this.#voice[low + 1] &= ~0xc0;
    this.#send(low + 1, this.#voice[low + 1] | 0x80);
  }
  #keyOn(base) {
    this.#ready();
    if (base === 0) this.#send(0, this.#voice[0]);
    this.#send(base + 1, this.#voice[base + 1]);
    const env = this.#voice[base + 2];
    this.#send(base + 2, env >> 4 ? env : 0);
    this.#trigger(base + 3);
  }
  #waveform(samples) {
    this.#ready();
    if (!(Array.isArray(samples) || samples instanceof Uint8Array) || samples.length !== 32) throw new RangeError('Expected 32 four-bit samples');
    const packed = new Uint8Array(16);
    for (let i = 0; i < 32; i++) packed[i >> 1] |= integer(samples[i], 0, 15) << (i % 2 ? 0 : 4);
    this.wave.keyOff();
    for (let i = 0; i < 16; i++) this.#update(32 + i, 255, packed[i], true);
  }
  setPan(ch, left, right) {
    this.#ready(); integer(ch, 0, 3);
    if (typeof left !== 'boolean' || typeof right !== 'boolean') throw new TypeError('Expected boolean pan');
    this.#update(21, (1 << ch) | (16 << ch), (left ? 16 << ch : 0) | (right ? 1 << ch : 0), true);
  }
  setMasterVolume(left, right) {
    this.#ready(); integer(left, 0, 7); integer(right, 0, 7);
    this.#update(20, 0x77, (left << 4) | right, true);
  }
  dispose() {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#transport.dispose?.();
  }
}

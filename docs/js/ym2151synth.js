export {YM2151_CLOCK} from './ym2151.js';
export {YM2151WorkletTransport} from './chip_worklet_transport.js';

/** @typedef {{dt?: number, dt1?: number, multi?: number, mul?: number,
 * tl?: number, rs?: number, ks?: number, ar?: number, am?: boolean | number,
 * d1r?: number, dt2?: number, d2r?: number, sr?: number,
 * sl?: number, d1l?: number, rr?: number}} YM2151OperatorParams
 * @typedef {{label?: string, algorithm?: number, feedback?: number,
 * ams?: number, pms?: number, pan?: {left?: boolean, right?: boolean},
 * operators?: YM2151OperatorParams[]}} YM2151Preset
 * @typedef {{writeRegister(register: number, value: number): void, reset?: () => void}} YM2151Transport
 */
const slots = [0, 16, 8, 24]; // Logical M1, M2, C1, C2; register order is M1, C1, M2, C2.
const keyBits = [8, 16, 32, 64];
const fields = {
  dt: [0x40, 4, 7], dt1: [0x40, 4, 7], multi: [0x40, 0, 15], mul: [0x40, 0, 15],
  tl: [0x60, 0, 127], rs: [0x80, 6, 3], ks: [0x80, 6, 3], ar: [0x80, 0, 31],
  am: [0xa0, 7, 1], d1r: [0xa0, 0, 31], dt2: [0xc0, 6, 3],
  d2r: [0xc0, 0, 31], sr: [0xc0, 0, 31], sl: [0xe0, 4, 15], d1l: [0xe0, 4, 15], rr: [0xe0, 0, 15],
};
const defaults = {dt: 0, multi: 1, tl: 127, rs: 0, ar: 31, am: false, d1r: 0, dt2: 0, d2r: 0, sl: 0, rr: 15};
function integer(value, max, label) {
  if (!Number.isInteger(value) || value < 0 || value > max) throw new RangeError(`${label} must be 0..${max}`);
  return value;
}
function bool(value, label) {
  if (typeof value !== 'boolean') throw new TypeError(`${label} must be boolean`);
  return value;
}
function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
}
/** @param {string | number} note */
function midiNote(note) {
  if (typeof note === 'number') {
    if (!Number.isInteger(note) || note < 13 || note > 108) throw new RangeError('YM2151 note must be C#0..C8 (MIDI 13..108)');
    return note;
  }
  if (typeof note !== 'string') throw new TypeError('YM2151 note must be a note name or MIDI integer');
  const match = /^([A-Ga-g])([#b]?)(-?\d+)$/.exec(note);
  if (!match) throw new RangeError('Invalid YM2151 note');
  return midiNote((Number(match[3]) + 1) * 12 + ({C:0,D:2,E:4,F:5,G:7,A:9,B:11}[match[1].toUpperCase()]) + (match[2] === '#' ? 1 : match[2] === 'b' ? -1 : 0));
}
function keyCode(note) {
  const index = note - 13;
  return (Math.floor(index / 12) << 4) | [0,1,2,4,5,6,8,9,10,12,13,14][index % 12];
}

/** Borrows the caller's chip; does not create or close an audio device. */
export class YM2151DirectTransport {
  /** @param {import('./ym2151.js').Ym2151} chip */
  constructor(chip) {
    if (!chip || typeof chip.write !== 'function') throw new TypeError('YM2151DirectTransport requires a chip with write(offset, value)');
    this.chip = chip;
  }
  /** @param {number} offset @param {number} value */
  write(offset, value) {this.chip.write(offset, value);}
  /** @param {number} register @param {number} value */
  writeRegister(register, value) {this.chip.write(0, register); this.chip.write(1, value);}
  reset() {this.chip.reset();}
  sampleRate() {return this.chip.sampleRate();}
  /** @param {number} frames */
  generateStereo(frames) {return this.chip.generateStereo(frames);}
  readStatus() {return this.chip.readStatus();}
  getIrq() {return this.chip.getIrq();}
}

/** Eight-channel OPM Synth, shared by Direct, Worklet and Node transports.
 * Operators and key masks use logical M1, M2, C1, C2 order (0..3).
 * Notes use the default YM2151_CLOCK; setPitch() exposes raw KC/KF values.
 */
export class YM2151Synth {
  #registers = new Uint8Array(256);
  /** @param {{transport: YM2151Transport}} options */
  constructor({transport} = {}) {
    if (!transport || typeof transport.writeRegister !== 'function') throw new TypeError('YM2151Synth requires writeRegister(register, value)');
    this.transport = transport;
    this.reset();
  }
  reset() {
    this.transport.reset?.();
    this.#registers.fill(0);
    this.setLFO({frequency: 0, amDepth: 0, pmDepth: 0, waveform: 0});
    this.setNoise(false);
    for (let ch = 0; ch < 8; ch++) {
      this.keyOff(ch);
      this.setPitch(ch, 0);
      this.setPreset(ch, {algorithm: 0, feedback: 0, pan: {left: true, right: true}, ams: 0, pms: 0, operators: Array.from({length: 4}, () => defaults)});
    }
  }
  /** @param {number} register @param {number} value */
  writeRegister(register, value) {
    integer(register, 255, 'Register'); integer(value, 255, 'Value');
    this.transport.writeRegister(register, value);
    this.#registers[register] = value;
  }
  /** @param {Array<[number, number, number]>} changes */
  #apply(changes) {
    for (const [register, mask, value] of changes) this.writeRegister(register, (this.#registers[register] & ~mask) | value);
  }
  /** @param {number} ch @param {number} operator @param {YM2151OperatorParams} params
   * @returns {Array<[number, number, number]>} */
  #operatorChanges(ch, operator, params) {
    integer(ch, 7, 'YM2151 channel'); integer(operator, 3, 'Operator'); object(params, 'Operator parameters');
    const changes = [];
    const seen = new Set();
    for (const [name, value] of Object.entries(params)) {
      const field = fields[name];
      if (!field) throw new TypeError(`Unknown YM2151 operator field: ${name}`);
      const [base, shift, max] = field;
      if (seen.has(`${base}:${shift}`)) throw new TypeError(`Duplicate YM2151 operator aliases: ${name}`);
      seen.add(`${base}:${shift}`);
      const normalized = name === 'am' && typeof value === 'boolean' ? Number(value) : integer(value, max, name);
      changes.push(/** @type {[number, number, number]} */ ([base + slots[operator] + ch, max << shift, normalized << shift]));
    }
    return changes;
  }
  /** Partial updates preserve other fields, including values written with writeRegister().
   * @param {number} ch @param {number} operator @param {YM2151OperatorParams} params */
  setOperator(ch, operator, params) {this.#apply(this.#operatorChanges(ch, operator, params));}
  /** Validates the entire preset before issuing any writes. FM_PRESETS use compatible fields.
   * OPN-only SSG envelopes are unsupported; OPM adds dt2 (0..3).
   * @param {number} ch @param {YM2151Preset} preset */
  setPreset(ch, preset) {
    integer(ch, 7, 'YM2151 channel'); object(preset, 'Preset');
    /** @type {Array<[number, number, number]>} */ const changes = [];
    for (const key of Object.keys(preset)) if (!['label','algorithm','feedback','pan','ams','pms','operators'].includes(key)) throw new TypeError(`Unknown YM2151 preset field: ${key}`);
    if (preset.algorithm !== undefined) changes.push([0x20 + ch, 7, integer(preset.algorithm, 7, 'Algorithm')]);
    if (preset.feedback !== undefined) changes.push([0x20 + ch, 0x38, integer(preset.feedback, 7, 'Feedback') << 3]);
    if (preset.pan !== undefined) {
      object(preset.pan, 'Pan');
      for (const key of Object.keys(preset.pan)) if (!['left','right'].includes(key)) throw new TypeError(`Unknown pan field: ${key}`);
      if (preset.pan.left !== undefined) changes.push([0x20 + ch, 0x40, bool(preset.pan.left, 'Left') ? 0x40 : 0]);
      if (preset.pan.right !== undefined) changes.push([0x20 + ch, 0x80, bool(preset.pan.right, 'Right') ? 0x80 : 0]);
    }
    if (preset.ams !== undefined) changes.push([0x38 + ch, 3, integer(preset.ams, 3, 'AMS')]);
    if (preset.pms !== undefined) changes.push([0x38 + ch, 0x70, integer(preset.pms, 7, 'PMS') << 4]);
    if (preset.operators !== undefined) {
      if (!Array.isArray(preset.operators) || preset.operators.length > 4) throw new TypeError('Preset operators must be an array of up to four entries');
      for (let i = 0; i < preset.operators.length; i++) if (preset.operators[i] !== undefined) changes.push(...this.#operatorChanges(ch, i, preset.operators[i]));
    }
    this.#apply(changes);
  }
  /** @param {number} ch @param {number} algorithm @param {number} [feedback] */
  setAlgo(ch, algorithm, feedback = 0) {this.setPreset(ch, {algorithm, feedback});}
  /** @param {number} ch @param {boolean} left @param {boolean} right @param {number} [ams] @param {number} [pms] */
  setPan(ch, left, right, ams = undefined, pms = undefined) {this.setPreset(ch, {pan: {left, right}, ams, pms});}
  /** @param {number} ch @param {string | number} note Note name or MIDI integer 13..108.
   * @returns {number} Written raw key code. */
  setNote(ch, note) {
    const code = keyCode(midiNote(note));
    this.setPitch(ch, code);
    return code;
  }
  /** Frequency in Hz at the default 3579545 Hz clock; quantized to 1/64 semitone.
   * @param {number} ch @param {number} frequency */
  setFrequency(ch, frequency) {
    integer(ch, 7, 'YM2151 channel');
    if (!Number.isFinite(frequency) || frequency <= 0) throw new RangeError('Frequency must be positive');
    const units = Math.round((69 + 12 * Math.log2(frequency / 440) - 13) * 64);
    if (units < 0 || units > 95 * 64 + 63) throw new RangeError('YM2151 frequency is outside the KC/KF range');
    const code = keyCode(13 + Math.floor(units / 64));
    this.setPitch(ch, code, units % 64);
    return {keyCode: code, keyFraction: units % 64};
  }
  /** Raw key code 0..127 and key fraction 0..63.
   * @param {number} ch @param {number} code @param {number} [fraction] */
  setPitch(ch, code, fraction = 0) {
    integer(ch, 7, 'YM2151 channel'); integer(code, 127, 'Key code'); integer(fraction, 63, 'Key fraction');
    this.writeRegister(0x28 + ch, code); this.writeRegister(0x30 + ch, fraction << 2);
  }
  /** @param {number} ch @param {number} [mask] Logical operator bits 0..3. */
  keyOn(ch, mask = 15) {
    integer(ch, 7, 'YM2151 channel'); integer(mask, 15, 'Operator mask');
    this.writeRegister(8, ch | keyBits.reduce((bits, value, i) => bits | ((mask & (1 << i)) ? value : 0), 0));
  }
  /** @param {number} ch */
  keyOff(ch) {integer(ch, 7, 'YM2151 channel'); this.writeRegister(8, ch);}
  /** @param {number} ch @param {string | number} note @param {{operatorMask?: number}} [options] */
  noteOn(ch, note, {operatorMask = 15} = {}) {
    integer(ch, 7, 'YM2151 channel'); integer(operatorMask, 15, 'Operator mask');
    midiNote(note); // Validate before either pitch register is written.
    this.setNote(ch, note); this.keyOn(ch, operatorMask);
  }
  /** @param {number} ch */
  noteOff(ch) {this.keyOff(ch);}
  /** @param {{frequency?: number, amDepth?: number, pmDepth?: number, waveform?: number}} [options] */
  setLFO(options = {}) {
    object(options, 'LFO');
    const changes = [];
    for (const [name, value] of Object.entries(options)) {
      const field = {frequency: [0x18, 255, 0], amDepth: [0x19, 127, 0], pmDepth: [0x19, 127, 128], waveform: [0x1b, 3, 0]}[name];
      if (!field) throw new TypeError(`Unknown YM2151 LFO field: ${name}`);
      const [register, max, select] = field;
      const next = integer(value, max, name) | select;
      changes.push([register, name === 'waveform' ? (this.#registers[register] & 0xc0) | next : next]);
    }
    for (const [register, value] of changes) this.writeRegister(register, value);
  }
  /** Noise replaces the last operator on channel 7.
   * @param {boolean} enabled @param {number} [frequency] */
  setNoise(enabled, frequency = 0) {
    bool(enabled, 'Noise enabled'); integer(frequency, 31, 'Noise frequency');
    this.writeRegister(15, (enabled ? 128 : 0) | frequency);
  }
}

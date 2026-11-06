import {noteToHz} from './soundchip_pitch.js';
import {sidFrequency, SID_PAL_CLOCK} from './sid.js';
export {SID_PAL_CLOCK, SID_NTSC_CLOCK} from './sid.js';

/** @typedef {Object} SidVoiceOptions
 * @property {'triangle'|'saw'|'pulse'|'noise'} [waveform]
 * @property {number} [pulseWidth] Twelve-bit pulse comparator, 0..4095.
 * @property {number} [attack] 0..15.
 * @property {number} [decay] 0..15.
 * @property {number} [sustain] 0..15.
 * @property {number} [release] 0..15.
 * @property {boolean} [sync]
 * @property {boolean} [ring]
 * @property {boolean} [test]
 */
/** @typedef {Object} SidFilterOptions
 * @property {'off'|'lowpass'|'bandpass'|'highpass'|'notch'} [mode]
 * @property {number} [cutoff] 0..2047.
 * @property {number} [resonance] 0..15.
 * @property {number} [routing] Voice mask 0..7.
 * @property {number} [volume] Hardware master level 0..15.
 * @property {boolean} [voice3off] Mute the dry voice 3; its routed filter path remains active.
 */
/** @typedef {Object} SidSynthOptions
 * @property {import('./sid.js').SidCore} [core] Borrowed, synchronous core.
 * @property {{clock?:number,writeRegister:(register:number,value:number,channel?:number)=>void,reset:()=>void,readRegister?:(register:number)=>number,dispose?:()=>void}} [transport]
 * @property {number} [clock] Creation-fixed integer Hz, 900000..1100000.
 */
/** @typedef {{clock:number,model:'6581',initialized:boolean,registers:number[],channels:Array<{frequency:number,frequencyRegister:number,waveform:string,waveformBits:number,waveforms:string[],pulseWidth:number,attack:number,decay:number,sustain:number,release:number,sync:boolean,ring:boolean,test:boolean,gate:boolean,envelope?:number,phase?:number}>,filter:{mode:string,modeBits:number,cutoff:number,resonance:number,routing:number,volume:number,voice3off:boolean},cycles?:number}} SidState */

const waves = Object.freeze({triangle: 0x10, saw: 0x20, pulse: 0x40, noise: 0x80});
const modes = Object.freeze({off: 0, lowpass: 1, bandpass: 2, highpass: 4, notch: 5});
const integer = (value, maximum, label) => {
  if (!Number.isInteger(value) || value < 0 || value > maximum) throw new RangeError(`SID ${label} must be an integer 0..${maximum}`);
  return value;
};
const boolean = (value, label) => {
  if (typeof value !== 'boolean') throw new TypeError(`SID ${label} must be boolean`);
  return value;
};
function patch(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`SID ${label} must be an object`);
  for (const key of Object.keys(value)) if (!keys.includes(key)) throw new TypeError(`Unknown SID ${label} field: ${key}`);
}
export function validateSidClock(clock) {
  if (!Number.isInteger(clock) || clock < 900000 || clock > 1100000) throw new RangeError('SID clock must be an integer 900000..1100000 Hz');
  return clock;
}

/** Borrowed core: the caller retains ownership and disposes it separately. */
export class SidDirectTransport {
  constructor(core) {
    if (!core || typeof core.writeRegister !== 'function' || typeof core.reset !== 'function') throw new TypeError('Expected a SID core');
    this.core = core; this.clock = core.clockHz;
  }
  writeRegister(register, value) { this.core.writeRegister(register, value); }
  readRegister(register) { return this.core.readRegister(register); }
  reset() { this.core.reset(); }
}

/** Three physical 6581 voices and one shared filter. Sync/Ring use the preceding
 * oscillator (voice 3 -> 1 -> 2 -> 3); they do not allocate a hidden voice.
 * This is an authoring shadow, not hardware register readback. The core's
 * software 12 Hz output DC blocker is separate from this programmable filter.
 */
export class SidSynth {
  #transport; #core; #disposed = false; #initialized = false;
  #registers = new Uint8Array(32);
  /** @param {SidSynthOptions} [options] */
  constructor({core, transport, clock = core?.clockHz ?? transport?.clock ?? SID_PAL_CLOCK} = {}) {
    if (core && transport) throw new TypeError('Specify SID core or transport, not both');
    transport ??= core ? new SidDirectTransport(core) : null;
    if (!transport || typeof transport.writeRegister !== 'function' || typeof transport.reset !== 'function') throw new TypeError('Expected SID core or transport');
    validateSidClock(clock);
    if (transport.clock !== undefined && transport.clock !== clock) throw new RangeError('SID synth and transport clocks must match');
    if (core?.model !== undefined && core.model !== '6581') throw new RangeError('Only SID model 6581 is supported');
    Object.defineProperty(this, 'clock', {value: clock, configurable: true, enumerable: true});
    this.chip = 'sid'; this.model = '6581'; this.channels = 3;
    this.#transport = transport; this.#core = core;
    this._beforeWrite = undefined; this._observe = undefined;
  }
  #alive() { if (this.#disposed) throw new Error('SID synth is disposed'); }
  #channel(channel) { this.#alive(); return integer(channel, 2, 'channel'); }
  #ready() { this.#alive(); if (!this.#initialized) throw new Error('Call initialize() before SID high-level operations'); }
  #send(register, value) {
    const channel = register < 21 ? Math.floor(register / 7) : undefined;
    if (this._beforeWrite?.(register, value, channel) === false) return;
    this.#transport.writeRegister(register, value, channel);
    this.#registers[register] = value;
    this._observe?.({method: 'writeRegister', args: [register, value], ...(channel === undefined ? {} : {channel})});
  }
  writeRegister(register, value) { this.#alive(); integer(register, 31, 'register'); integer(value, 255, 'byte'); this.#send(register, value); }
  readRegister(register) {
    this.#alive(); integer(register, 31, 'register');
    if (!this.#transport.readRegister) throw new Error('SID register reads require a control endpoint');
    return this.#transport.readRegister(register);
  }
  reset() {
    this.#alive(); this.#transport.reset(); this.#registers.fill(0); this.#initialized = false;
    this._observe?.({method: 'reset', args: []});
  }
  /** Default saw voices, Gate off, PW 2048, ADSR 2/6/12/5; shared filter off,
   * volume 8 and dry routing 0. Routing into an off filter would silence voices.
   * Initializing alone does not start a note. */
  initialize() {
    this.reset(); this.#initialized = true;
    for (let ch = 0; ch < 3; ++ch) {
      this.setVoice(ch, {waveform: 'saw', pulseWidth: 2048, attack: 2, decay: 6, sustain: 12, release: 5, sync: false, ring: false, test: false});
      this.setFrequency(ch, 440);
    }
    this.setFilter({mode: 'off', cutoff: 0, resonance: 0, routing: 0, volume: 8, voice3off: false});
  }
  adoptRegisterState() { this.#alive(); this.#initialized = true; }
  getRegisterSnapshot() { this.#alive(); return this.#registers.slice(); }
  /** @param {number} channel @param {SidVoiceOptions} value */
  setVoice(channel, value) {
    this.#ready(); this.#channel(channel);
    patch(value, ['waveform', 'pulseWidth', 'attack', 'decay', 'sustain', 'release', 'sync', 'ring', 'test'], 'voice');
    // Validate the whole patch before the first register write.
    for (const key of ['attack', 'decay', 'sustain', 'release']) if (key in value) integer(value[key], 15, key);
    for (const key of ['sync', 'ring', 'test']) if (key in value) boolean(value[key], key);
    if ('pulseWidth' in value) integer(value.pulseWidth, 4095, 'pulse width');
    if ('waveform' in value && (typeof value.waveform !== 'string' || !Object.hasOwn(waves, value.waveform))) throw new RangeError('SID waveform must be triangle, saw, pulse or noise');
    const base = channel * 7, registers = this.#registers;
    if ('pulseWidth' in value) { this.#send(base + 2, value.pulseWidth & 255); this.#send(base + 3, (registers[base + 3] & 240) | (value.pulseWidth >> 8)); }
    if ('attack' in value || 'decay' in value) this.#send(base + 5, ((value.attack ?? (registers[base + 5] >> 4)) << 4) | (value.decay ?? (registers[base + 5] & 15)));
    if ('sustain' in value || 'release' in value) this.#send(base + 6, ((value.sustain ?? (registers[base + 6] >> 4)) << 4) | (value.release ?? (registers[base + 6] & 15)));
    let control = registers[base + 4];
    if ('waveform' in value) control = (control & 15) | waves[value.waveform];
    for (const [key, mask] of [['sync', 2], ['ring', 4], ['test', 8]]) if (key in value) control = (control & ~mask) | (value[key] ? mask : 0);
    if (['waveform', 'sync', 'ring', 'test'].some(key => key in value)) this.#send(base + 4, control);
  }
  /** Preserve the hardware routing: mode off with routing 7 silences all three
   * voices. Use routing 0 for dry output, or explicitly route into an active mode.
   * @param {SidFilterOptions} value */
  setFilter(value) {
    this.#ready(); patch(value, ['mode', 'cutoff', 'resonance', 'routing', 'volume', 'voice3off'], 'filter');
    for (const [key, max] of [['cutoff', 2047], ['resonance', 15], ['routing', 7], ['volume', 15]]) if (key in value) integer(value[key], max, key);
    if ('voice3off' in value) boolean(value.voice3off, 'voice3off');
    if ('mode' in value && (typeof value.mode !== 'string' || !Object.hasOwn(modes, value.mode))) throw new RangeError('SID filter mode must be off, lowpass, bandpass, highpass or notch');
    const registers = this.#registers;
    if ('cutoff' in value) { this.#send(21, (registers[21] & 248) | (value.cutoff & 7)); this.#send(22, value.cutoff >> 3); }
    if ('resonance' in value || 'routing' in value) this.#send(23, ((value.resonance ?? (registers[23] >> 4)) << 4) | (registers[23] & 8) | (value.routing ?? (registers[23] & 7)));
    let control = registers[24];
    if ('mode' in value) control = (control & 143) | (modes[value.mode] << 4);
    if ('volume' in value) control = (control & 240) | value.volume;
    if ('voice3off' in value) control = (control & 127) | (value.voice3off ? 128 : 0);
    if (['mode', 'volume', 'voice3off'].some(key => key in value)) this.#send(24, control);
  }
  setFrequency(channel, hz) {
    this.#ready(); this.#channel(channel);
    if (!Number.isFinite(hz) || hz <= 0) throw new RangeError('SID frequency must be positive finite Hz');
    const frequency = sidFrequency(hz, this.clock);
    if (!frequency) throw new RangeError('SID frequency is below the representable range');
    this.#send(channel * 7, frequency & 255); this.#send(channel * 7 + 1, frequency >> 8);
    return frequency * this.clock / 16777216;
  }
  setNote(channel, note) { return this.setFrequency(channel, noteToHz(note)); }
  keyOn(channel) { this.#ready(); this.#channel(channel); const register = channel * 7 + 4; this.#send(register, this.#registers[register] | 1); }
  keyOff(channel) { this.#channel(channel); const register = channel * 7 + 4; this.#send(register, this.#registers[register] & 254); }
  noteOn(channel, note) { this.setNote(channel, note); this.keyOn(channel); }
  noteOff(channel) { this.keyOff(channel); }
  allNotesOff() { this.#alive(); for (let ch = 0; ch < 3; ++ch) this.keyOff(ch); }
  async setClock(clock) { this.#alive(); validateSidClock(clock); if (clock !== this.clock) throw new RangeError('Create a new SID instance to change its clock'); return true; }
  /** @returns {SidState} */
  _getState() {
    this.#alive(); const registers = this.#registers, live = this.#core?.getState?.();
    const channels = Array.from({length: 3}, (_, channel) => {
      const base = channel * 7, control = registers[base + 4], frequencyRegister = registers[base] | (registers[base + 1] << 8);
      const waveforms = Object.keys(waves).filter(name => control & waves[name]);
      return {frequency: frequencyRegister * this.clock / 16777216, frequencyRegister,
        waveform: waveforms.length === 1 ? waveforms[0] : waveforms.length ? 'combined' : 'off', waveformBits: control >> 4, waveforms,
        pulseWidth: registers[base + 2] | ((registers[base + 3] & 15) << 8), attack: registers[base + 5] >> 4, decay: registers[base + 5] & 15,
        sustain: registers[base + 6] >> 4, release: registers[base + 6] & 15, sync: !!(control & 2), ring: !!(control & 4), test: !!(control & 8), gate: !!(control & 1),
        ...(live?.voices?.[channel] ? {envelope: live.voices[channel].envelope, phase: live.voices[channel].phase} : {})};
    });
    const filterBits = (registers[24] >> 4) & 7;
    return {clock: this.clock, model: '6581', initialized: this.#initialized, registers: Array.from(registers), channels,
      ...(live ? {cycles: live.cycles} : {}), filter: {mode: Object.keys(modes).find(name => modes[name] === filterBits) ?? 'combined', modeBits: filterBits,
        cutoff: (registers[21] & 7) | (registers[22] << 3), resonance: registers[23] >> 4, routing: registers[23] & 7, volume: registers[24] & 15, voice3off: !!(registers[24] & 128)}};
  }
  /** Adopt a validated applied shadow without replaying any hardware writes. */
  _adoptState(state) {
    this.#alive();
    if (!state || typeof state.initialized !== 'boolean' || !state.registers || state.registers.length !== 32) throw new TypeError('Invalid SID authoring state');
    if (state.model !== undefined && state.model !== '6581') throw new RangeError('Only SID model 6581 is supported');
    if (validateSidClock(state.clock ?? this.clock) !== this.clock) throw new RangeError('SID state clock must match its instance');
    const registers = Uint8Array.from(state.registers, value => integer(value, 255, 'state byte'));
    this.#registers.set(registers); this.#initialized = state.initialized;
  }
  dispose() { if (this.#disposed) return; this.#disposed = true; this.#transport.dispose?.(); }
}

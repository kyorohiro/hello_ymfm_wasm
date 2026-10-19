import {noteToHz} from './soundchip_pitch.js';

/** HuC6280 PSG input clock (Hz), after the PC Engine master clock divider. */
export const HUC6280_CLOCK = 3579545;

function integer(value, minimum, maximum) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) throw new RangeError(`Expected integer ${minimum}..${maximum}`);
  return value;
}
function configuration(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Expected options object');
  for (const key of Reflect.ownKeys(value)) if (!keys.includes(key)) throw new TypeError(`Unknown property: ${String(key)}`);
}

/** Borrow a synchronous HuC6280 rendering engine; disposing the synth does not destroy it. */
export class Huc6280DirectTransport {
  /** @param {import('./huc6280audioengine.js?v=audio-stability-2').Huc6280AudioEngine} chip */
  constructor(chip) {
    if (!chip || typeof chip.writeHuc6280 !== 'function' || typeof chip.reset !== 'function') throw new TypeError('Expected Huc6280AudioEngine');
    this.chip = chip;
  }
  /** @param {number} register @param {number} value */
  writeRegister(register, value) { this.chip.writeHuc6280(register, value); }
  reset() { this.chip.reset(); }
}

/** Six-channel, 32-sample, five-bit wavetable authoring API.
 * Configure with initialize() before high-level operations. Values are hardware
 * units: volume 0..31, left/right balance 0..15, noise frequency code 0..31.
 * Waveform uploads stop that channel; call noteOn()/keyOn() afterward.
 */
export class Huc6280Synth {
  #transport; #disposed = false; #initialized = false; #selected = 0;
  #globals = new Uint8Array(10);
  #registers = Array.from({length:8}, () => new Uint8Array(8));
  #waveforms = Array.from({length:8}, () => new Uint8Array(32));
  #indices = new Uint8Array(8);
  /** @param {{transport:{writeRegister(register:number,value:number,channel?:number):void,reset():void,dispose?():void},clock?:number}} options */
  constructor({transport, clock = HUC6280_CLOCK} = {}) {
    if (!transport || typeof transport.writeRegister !== 'function' || typeof transport.reset !== 'function') throw new TypeError('Expected transport');
    integer(clock, 100000, 100000000);
    this.#transport = transport;
    this.clock = clock;
  }
  #alive() { if (this.#disposed) throw new Error('HuC6280 disposed'); }
  #ready() { this.#alive(); if (!this.#initialized) throw new Error('Call initialize() before high-level operations'); }
  #channel(channel) { this.#alive(); return integer(channel, 0, 5); }
  #select(channel) { if (this.#selected !== channel) this.#send(0, channel); }
  #send(register, value) {
    if (this._beforeWrite?.(register, value) === false) return;
    const channel = this.#selected;
    if (register === 0) { this.#selected = value & 7; this.#globals[0] = value; }
    else if ([1,8,9].includes(register)) this.#globals[register] = value;
    else {
      const registers = this.#registers[channel];
      if (register === 4 && (registers[4] & 64) && !(value & 64)) this.#indices[channel] = 0;
      if (register === 6 && !(registers[4] & 64)) {
        this.#waveforms[channel][this.#indices[channel]] = value & 31;
        if (!(registers[4] & 128)) this.#indices[channel] = (this.#indices[channel] + 1) & 31;
      }
      registers[register] = value;
    }
    this.#transport.writeRegister(register, value, channel);
    this._observe?.({method:'writeRegister', args:[register, value], channel});
  }
  /** Write a hardware register. Channel select also accepts the two unused slots 6/7.
   * @param {number} register Address 0..9. @param {number} value Byte 0..255. */
  writeRegister(register, value) {
    this.#alive(); integer(register, 0, 9); integer(value, 0, 255);
    this.#send(register, value);
  }
  /** Reset core and authoring state. Call initialize() to restore useful defaults. */
  reset() {
    this.#alive(); this.#transport.reset(); this.#initialized = false; this.#selected = 0;
    this.#globals.fill(0); this.#indices.fill(0);
    for (const registers of this.#registers) registers.fill(0);
    for (const waveform of this.#waveforms) waveform.fill(0);
    this._observe?.({method:'reset', args:[]});
  }
  /** Configure silent, centered triangle-wave voices on all six channels. */
  initialize() {
    this.reset(); this.#initialized = true;
    this.setMasterVolume(15, 15);
    const triangle = Array.from({length:32}, (_, i) => i < 16 ? i * 2 : 63 - i * 2);
    for (let channel = 0; channel < 6; channel++) {
      this.setVolume(channel, 24); this.setPan(channel, 15, 15);
      this.setWaveform(channel, triangle); this.setFrequency(channel, 440);
      if (channel >= 4) this.setNoise(channel, {enabled:false, frequency:16});
    }
    this.setLfo({frequency:0, depth:0});
  }
  /** Adopt registers written through this synth, without resetting hardware. */
  adoptRegisterState() { this.#alive(); this.#initialized = true; }
  /** Stop a channel and replace its waveform; values are exactly 32 integers 0..31.
   * @param {number} channel @param {number[]|Uint8Array} samples */
  setWaveform(channel, samples) {
    this.#ready(); this.#channel(channel);
    if (!(Array.isArray(samples) || samples instanceof Uint8Array) || samples.length !== 32) throw new RangeError('Expected 32 five-bit samples');
    const values = Array.from(samples, sample => integer(sample, 0, 31));
    this.#select(channel);
    const volume = this.#registers[channel][4] & 31;
    // DDA 1 -> 0 resets the waveform write pointer, including after playback.
    this.#send(4, volume | 64); this.#send(4, volume);
    for (const value of values) this.#send(6, value);
  }
  /** Set attenuation level without changing key/DDA state. @param {number} channel @param {number} volume 0..31. */
  setVolume(channel, volume) {
    this.#ready(); this.#channel(channel); integer(volume, 0, 31);
    this.#select(channel); this.#send(4, (this.#registers[channel][4] & 0xc0) | volume);
  }
  /** Independent channel left/right balances, 0=mute and 15=full. @param {number} channel @param {number} left @param {number} [right=left] */
  setPan(channel, left, right = left) {
    this.#ready(); this.#channel(channel); integer(left, 0, 15); integer(right, 0, 15);
    this.#select(channel); this.#send(5, left << 4 | right);
  }
  /** Global left/right balances. @param {number} left @param {number} [right=left] */
  setMasterVolume(left, right = left) {
    this.#ready(); integer(left, 0, 15); integer(right, 0, 15);
    this.#send(1, left << 4 | right);
  }
  /** Set wavetable Hz without enabling the channel; returns quantized Hz.
   * The 12-bit period 0 encodes 4096, the longest hardware period.
   * @param {number} channel @param {number} hz @returns {number} */
  setFrequency(channel, hz) {
    this.#ready(); this.#channel(channel);
    if (!Number.isFinite(hz) || hz <= 0) throw new RangeError('Expected finite positive Hz');
    const period = Math.round(this.clock / (32 * hz)); integer(period, 1, 4096);
    this.#select(channel); this.#send(2, period & 255); this.#send(3, (period & 4095) >> 8);
    return this.clock / (32 * period);
  }
  /** @param {number} channel @param {string|number} note Note name or integer MIDI 0..127. */
  setNote(channel, note) { return this.setFrequency(channel, noteToHz(note)); }
  /** @param {number} channel */
  keyOn(channel) {
    this.#ready(); this.#channel(channel); this.#select(channel);
    this.#send(4, this.#registers[channel][4] | 128);
  }
  /** @param {number} channel */
  keyOff(channel) {
    this.#ready(); this.#channel(channel); this.#select(channel);
    this.#send(4, this.#registers[channel][4] & 0x7f);
  }
  /** @param {number} channel @param {string|number} note */
  noteOn(channel, note) { this.setNote(channel, note); this.keyOn(channel); }
  /** Silence every channel while retaining volume, waveform and DDA settings. */
  allNotesOff() {
    this.#alive();
    for (let channel = 0; channel < 6; channel++) {
      this.#select(channel); this.#send(4, this.#registers[channel][4] & 0x7f);
    }
  }
  /** Noise is available on physical channels 4 and 5. Frequency is the hardware
   * code 0..31, increasing toward faster noise; this is not a Hz argument.
   * @param {number} channel @param {{enabled:boolean,frequency?:number}} options */
  setNoise(channel, options) {
    this.#ready(); integer(channel, 4, 5); configuration(options, ['enabled','frequency']);
    if (typeof options.enabled !== 'boolean') throw new TypeError('Expected boolean noise enabled');
    const frequency = options.frequency === undefined ? this.#registers[channel][7] & 31 : integer(options.frequency, 0, 31);
    this.#select(channel); this.#send(7, (options.enabled ? 128 : 0) | frequency);
  }
  /** Switch between wavetable and direct five-bit DAC mode, retaining key state.
   * @param {number} channel @param {boolean} enabled */
  setDda(channel, enabled) {
    this.#ready(); this.#channel(channel);
    if (typeof enabled !== 'boolean') throw new TypeError('Expected boolean DDA enabled');
    this.#select(channel); this.#send(4, (this.#registers[channel][4] & 0x9f) | (enabled ? 64 : 0));
  }
  /** Write one direct DAC sample; 16 is center. Enable DDA mode first.
   * @param {number} channel @param {number} sample */
  writeDda(channel, sample) {
    this.#ready(); this.#channel(channel); integer(sample, 0, 31);
    if (!(this.#registers[channel][4] & 64)) throw new Error('Enable DDA mode before writeDda()');
    this.#select(channel); this.#send(6, sample);
  }
  /** Hardware LFO modulates channel 0 from channel 1's wavetable. Channel 1 is
   * still audible; mute it with setVolume(1,0) if only modulation is desired.
   * reset=true holds the hardware LFO reset bit; pass false to let it advance.
   * @param {{frequency:number,depth:0|1|2|3,reset?:boolean}} options */
  setLfo(options) {
    this.#ready(); configuration(options, ['frequency','depth','reset']);
    integer(options.frequency, 0, 255); integer(options.depth, 0, 3);
    if (options.reset !== undefined && typeof options.reset !== 'boolean') throw new TypeError('Expected boolean LFO reset');
    this.#send(8, options.frequency);
    this.#send(9, options.depth | (options.reset ? 128 : 0));
  }
  /** Internal authoring state, for execution-thread handoff; not live core readback. */
  _getState() {
    return {clock:this.clock, initialized:this.#initialized, selectedChannel:this.#selected,
      globals:Array.from(this.#globals), registers:this.#registers.map(registers => Array.from(registers)),
      waveforms:this.#waveforms.map(waveform => Array.from(waveform)), indices:Array.from(this.#indices)};
  }
  _adoptState(state) {
    this.#alive();
    if (state.clock !== undefined) this._adoptClock ? this._adoptClock(state.clock) : this.clock = state.clock;
    this.#initialized = Boolean(state.initialized);
    this.#selected = integer(state.selectedChannel ?? 0, 0, 7);
    if (state.globals?.length === 10) this.#globals.set(state.globals);
    for (let channel = 0; channel < 8; channel++) {
      if (state.registers?.[channel]?.length === 8) this.#registers[channel].set(state.registers[channel]);
      if (state.waveforms?.[channel]?.length === 32) this.#waveforms[channel].set(state.waveforms[channel]);
    }
    if (state.indices?.length === 8) this.#indices.set(state.indices);
  }
  dispose() { if (this.#disposed) return; this.#disposed = true; this.#transport.dispose?.(); }
}

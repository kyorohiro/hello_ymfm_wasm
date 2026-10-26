import {noteToHz} from './soundchip_pitch.js';
import {WONDERSWAN_CLOCK} from './wonderswan.js?v=wonderswan-native-1';

export {WONDERSWAN_CLOCK};

function integer(value, minimum, maximum, label = 'integer') {
  if (!Number.isInteger(value) || value < minimum || value > maximum) throw new RangeError(`Expected ${label} ${minimum}..${maximum}`);
  return value;
}
function configuration(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Expected options object');
  for (const key of Reflect.ownKeys(value)) if (!keys.includes(key)) throw new TypeError(`Unknown property: ${String(key)}`);
}

/** Borrow a synchronous WonderSwan core; disposing the synth does not destroy it. */
export class WonderSwanDirectTransport {
  constructor(chip) {
    if (!chip || typeof chip.writeRegister !== 'function' || typeof chip.writeMemory !== 'function' || typeof chip.reset !== 'function') throw new TypeError('Expected WonderSwan core');
    this.chip = chip;
  }
  writeRegister(address, value) { this.chip.writeRegister(address, value); }
  writeMemory(address, value) { this.chip.writeMemory(address, value); }
  reset() { this.chip.reset(); }
}

/** Four-channel, 32-sample, four-bit wavetable authoring API.
 * Configure initialize() before high-level operations. Channels are physical
 * 0..3; voice mode replaces channel 1, sweep uses channel 2, noise uses channel 3.
 * Registers/RAM retained here describe authored commands, not live core reads.
 */
export class WonderSwanSynth {
  #transport; #disposed = false; #initialized = false;
  #registers = new Uint8Array(32); #memory = new Uint8Array(0x4000);
  /** @param {{transport:{writeRegister(address:number,value:number,channel?:number,controlMask?:number):void,writeMemory(address:number,value:number,channel?:number):void,reset():void,dispose?():void},clock?:number}} options */
  constructor({transport, clock = WONDERSWAN_CLOCK} = {}) {
    if (!transport || typeof transport.writeRegister !== 'function' || typeof transport.writeMemory !== 'function' || typeof transport.reset !== 'function') throw new TypeError('Expected WonderSwan transport');
    integer(clock, 100000, 100000000, 'clock'); this.clock = clock; this.#transport = transport;
  }
  #alive() { if (this.#disposed) throw new Error('WonderSwan disposed'); }
  #ready() { this.#alive(); if (!this.#initialized) throw new Error('Call initialize() before high-level operations'); }
  #channel(channel) { this.#alive(); return integer(channel, 0, 3, 'channel'); }
  #send(address, value, channel = address >= 0x80 && address <= 0x87 ? (address - 0x80) >> 1 : address >= 0x88 && address <= 0x8b ? address - 0x88 : undefined, controlMask) {
    if (this._beforeWrite?.(address, value, channel, controlMask) === false) return;
    this.#registers[address - 0x80] = value;
    this.#transport.writeRegister(address, value, channel, controlMask);
    this._observe?.({method:'writeRegister', args:[address, value], ...(channel === undefined ? {} : {channel}), ...(controlMask === undefined ? {} : {controlMask})});
  }
  #writeMemory(address, value, channel) {
    this.#memory[address] = value;
    this.#transport.writeMemory(address, value, channel);
    this._observe?.({method:'writeMemory', args:[address, value], ...(channel === undefined ? {} : {channel})});
  }
  /** Absolute hardware address 0x80..0x9f; value is one byte. */
  writeRegister(address, value) {
    this.#alive(); integer(address, 0x80, 0x9f, 'register address'); integer(value, 0, 255, 'register byte');
    this.#send(address, value);
  }
  /** Write one packed byte in the owned 16 KiB wave RAM. */
  writeMemory(address, value) {
    this.#alive(); integer(address, 0, 0x3fff, 'RAM address'); integer(value, 0, 255, 'RAM byte');
    this.#writeMemory(address, value);
  }
  /** Upload packed wave bytes; each byte stores two samples, low nibble first. */
  loadMemory(bytes, offset = 0) {
    this.#alive();
    if (!(bytes instanceof Uint8Array)) throw new TypeError('Expected WonderSwan RAM Uint8Array');
    integer(offset, 0, 0x4000, 'RAM offset');
    if (bytes.length > 0x4000 - offset) throw new RangeError('WonderSwan RAM upload exceeds 16 KiB');
    for (let index = 0; index < bytes.length; index++) this.#writeMemory(offset + index, bytes[index]);
  }
  /** Cold reset, including RAM and authored state; initialize() restores defaults. */
  reset() {
    this.#alive(); this.#transport.reset(); this.#initialized = false;
    this.#registers.fill(0); this.#memory.fill(0); this._observe?.({method:'reset', args:[]});
  }
  /** Silent, centered triangle-wave voices with left/right hardware volumes 9/9. */
  initialize() {
    this.reset(); this.#initialized = true;
    this.#send(0x91, 8); // Headphones path; the preliminary core has no speaker output.
    this.#send(0x94, 15); // Full left/right sample gain when voice mode is enabled.
    const triangle = Array.from({length:32}, (_, index) => index < 16 ? index : 31 - index);
    for (let channel = 0; channel < 4; channel++) {
      this.setVolume(channel, 9); this.setWaveform(channel, triangle); this.setFrequency(channel, 440);
    }
  }
  /** Permit high-level operations after configuring registers/RAM manually. */
  adoptRegisterState() { this.#alive(); this.#initialized = true; }
  /** Stop this channel and replace its 32 four-bit samples, at the current wave bank. */
  setWaveform(channel, samples) {
    this.#ready(); this.#channel(channel);
    if (!(Array.isArray(samples) || samples instanceof Uint8Array) || samples.length !== 32) throw new RangeError('Expected 32 four-bit samples');
    const values = Array.from(samples, value => integer(value, 0, 15, 'wave sample'));
    this.keyOff(channel);
    const base = (this.#registers[15] << 6) + channel * 16;
    for (let index = 0; index < 16; index++) this.#writeMemory(base + index, values[index * 2] | (values[index * 2 + 1] << 4), channel);
  }
  /** Hardware left/right volumes 0..15. In voice mode CH1's volume byte is PCM data. */
  setVolume(channel, left, right = left) {
    this.#ready(); this.#channel(channel); integer(left, 0, 15, 'left volume'); integer(right, 0, 15, 'right volume');
    this.#send(0x88 + channel, left << 4 | right, channel);
  }
  setPan(channel, left, right = left) { this.setVolume(channel, left, right); }
  /** Set Hz without enabling the channel; returns quantized Hz.
   * The source stream runs at floor(clock / 128), advancing 128 master cycles.
   * The 11-bit register encodes 2048 minus a period of 1..2048 cycles.
   */
  setFrequency(channel, hz) {
    this.#ready(); this.#channel(channel);
    if (!Number.isFinite(hz) || hz <= 0) throw new RangeError('Expected finite positive Hz');
    const effectiveClock = Math.floor(this.clock / 128) * 128;
    const period = integer(Math.round(effectiveClock / (32 * hz)), 1, 2048, 'period');
    const frequency = 2048 - period;
    this.#send(0x80 + channel * 2, frequency & 255, channel);
    this.#send(0x81 + channel * 2, frequency >> 8, channel);
    return effectiveClock / (32 * period);
  }
  /** A note name such as A4 or integer MIDI 0..127; numeric notes are never Hz. */
  setNote(channel, note) { return this.setFrequency(channel, noteToHz(note)); }
  keyOn(channel) { this.#ready(); this.#channel(channel); this.#send(0x90, this.#registers[16] | (1 << channel), channel, 1 << channel); }
  keyOff(channel) { this.#ready(); this.#channel(channel); this.#send(0x90, this.#registers[16] & ~(1 << channel), channel, 1 << channel); }
  noteOn(channel, note) { this.setNote(channel, note); this.keyOn(channel); }
  /** Preserve voice/sweep/noise modes, waveforms and volumes while releasing all voices. */
  allNotesOff() {
    this.#alive();
    // Each gate is independent: an owned Worker release may be rejected for
    // another loop's channel without preventing this loop's other releases.
    for (let channel = 0; channel < 4; channel++) this.#send(0x90, this.#registers[16] & ~(1 << channel), channel, 1 << channel);
  }
  /** Hardware noise on physical channel 3; type selects one of eight LFSR taps. */
  setNoise(options) {
    this.#ready(); configuration(options, ['enabled','type','reset']);
    if (typeof options.enabled !== 'boolean') throw new TypeError('Expected boolean noise enabled');
    if (options.reset !== undefined && typeof options.reset !== 'boolean') throw new TypeError('Expected boolean noise reset');
    const type = options.type === undefined ? this.#registers[14] & 7 : integer(options.type, 0, 7, 'noise type');
    this.#send(0x8e, type | (options.enabled ? 16 : 0) | (options.reset ? 8 : 0), 3);
    this.#send(0x90, (this.#registers[16] & ~128) | (options.enabled ? 128 : 0), 3, 128);
  }
  /** Sweep on physical channel 2: signed register step, and time code 0..31. */
  setSweep(options) {
    this.#ready(); configuration(options, ['enabled','step','time']);
    if (typeof options.enabled !== 'boolean') throw new TypeError('Expected boolean sweep enabled');
    const step = options.step === undefined ? this.#registers[12] : integer(options.step, -128, 127, 'sweep step') & 255;
    const time = options.time === undefined ? this.#registers[13] & 31 : integer(options.time, 0, 31, 'sweep time');
    this.#send(0x8c, step, 2); this.#send(0x8d, time, 2);
    this.#send(0x90, (this.#registers[16] & ~64) | (options.enabled ? 64 : 0), 2, 64);
  }
  /** Replace physical CH1's wavetable with unsigned 8-bit PCM; does not key it on. */
  setVoiceMode(enabled) {
    this.#ready(); if (typeof enabled !== 'boolean') throw new TypeError('Expected boolean voice mode');
    this.#send(0x90, (this.#registers[16] & ~32) | (enabled ? 32 : 0), 1, 32);
  }
  /** Write unsigned PCM 0..255, centered at 128. This is an immediate write, not a stream. */
  writeVoice(value) {
    this.#ready(); integer(value, 0, 255, 'voice sample');
    if (!(this.#registers[16] & 32)) throw new Error('Enable voice mode before writeVoice()');
    this.#send(0x89, value, 1);
  }
  /** Internal authored state for Main/Worker handoff; never live register readback. */
  _getState() {
    return {clock:this.clock, initialized:this.#initialized, registers:Array.from(this.#registers), memory:Array.from(this.#memory)};
  }
  /** Merge a Native editor's explicit fields into future authored state. */
  _applyAuthorEdit(patch) {
    configuration(patch,['clock','registers','memory']);
    for(const [field,maximum]of [['registers',128],['memory',16384]])if(patch[field]!==undefined&&(!Array.isArray(patch[field])||patch[field].length>maximum||patch[field].some(entry=>!Array.isArray(entry)||entry.length<2||entry.length>(field==='registers'?3:2))))throw new TypeError('Invalid WonderSwan author edit');
    const state=this._getState();
    for(const [index,value,mask=255]of patch.registers??[]){integer(index,0,31,'register index');integer(value,0,255,'register byte');integer(mask,0,255,'register mask');state.registers[index]=(state.registers[index]&~mask)|(value&mask);}
    for(const [address,value]of patch.memory??[]){integer(address,0,16383,'RAM address');state.memory[address]=integer(value,0,255,'RAM byte');}
    if(patch.clock!==undefined)state.clock=integer(patch.clock,100000,100000000,'clock');
    this._adoptState(state);
  }
  /** Adopt authored state without replaying writes, resets or hardware triggers. */
  _adoptState(state) {
    this.#alive();
    if (!state || typeof state !== 'object' || typeof state.initialized !== 'boolean' || state.registers?.length !== 32 || state.memory?.length !== 0x4000) throw new TypeError('Invalid WonderSwan authoring state');
    const clock = integer(state.clock ?? this.clock, 100000, 100000000, 'clock');
    const registers = Uint8Array.from(state.registers, value => integer(value, 0, 255, 'register byte'));
    const memory = Uint8Array.from(state.memory, value => integer(value, 0, 255, 'RAM byte'));
    if (this._adoptClock) this._adoptClock(clock); else this.clock = clock;
    this.#initialized = state.initialized; this.#registers.set(registers); this.#memory.set(memory);
  }
  dispose() { if (this.#disposed) return; this.#disposed = true; this.#transport.dispose?.(); }
}

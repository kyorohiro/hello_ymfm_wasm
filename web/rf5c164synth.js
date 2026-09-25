/** @file Browser / Worker / Node.js: RF5C164 register generation. No DOM or audio output. */
import { sampleBytes } from './rf5c164_pcm.js';
const integer = (value, max, name) => {
  if (!Number.isInteger(value) || value < 0 || value > max) throw new RangeError(`Invalid ${name}`);
  return value;
};

/** Direct synchronous transport; the caller owns and disposes the chip. */
export class RF5C164DirectTransport {
  /** @param {import('./rf5c164.js').Rf5c164} chip */
  constructor(chip) {
    if (!chip || typeof chip.writeRegister !== 'function' || typeof chip.loadMemory !== 'function' || typeof chip.reset !== 'function') {
      throw new TypeError('RF5C164DirectTransport requires writeRegister, loadMemory and reset');
    }
    this.chip = chip;
  }
  write(register, value) { this.chip.writeRegister(register, value); }
  loadMemory(bytes, address) { return this.chip.loadMemory(bytes, address); }
  reset() { this.chip.reset(); }
}

/** Physical-channel controls. A new/reset chip is expected; route raw writes through this Synth. */
export class RF5C164Synth {
  /** @param {{transport: {write: function(number, number): void, loadMemory: function(Uint8Array, number): *, reset: function(): void}}} options
   * Transport writes/reset must be synchronous or FIFO fire-and-forget. Memory transfer may return a completion promise.
   */
  constructor({transport} = {}) {
    if (!transport || ['write', 'loadMemory', 'reset'].some(name => typeof transport[name] !== 'function')) {
      throw new TypeError('RF5C164Synth requires write, loadMemory and reset transport methods');
    }
    this.transport = transport;
    this.channelMask = 255;
  }
  /** Copy chip-encoded bytes into absolute 64 KiB RAM. Await when using an asynchronous transport. */
  loadMemory(bytes, address = 0) {
    const data = sampleBytes(bytes);
    integer(address, 65536, 'address');
    if (address + data.length > 65536) throw new RangeError('RF5C164 RAM range exceeds 64 KiB');
    return this.transport.loadMemory(data, address);
  }
  /** Raw register write, also updating the tracked active-low channel mask. */
  writeRegister(register, value) {
    integer(register, 8, 'register');
    integer(value, 255, 'value');
    this.transport.write(register, value);
    if (register === 8) this.channelMask = value;
  }
  _select(channel) { this.writeRegister(7, 0xc0 | integer(channel, 7, 'channel')); }
  /** @param {number} channel Physical index 0..7.
   * @param {{start?: number, loopStart?: number, step?: number, volume?: number, pan?: {left: number, right: number}}} options
   * Unspecified registers retain their values. start is a 256-byte-aligned RAM address.
   */
  setChannel(channel, options) {
    integer(channel, 7, 'channel');
    const entries = [];
    const add = (register, value, max, name) => {
      integer(value, max, name);
      entries.push([register, value & 255]);
      if (max > 255) entries.push([register + 1, value >> 8]);
    };
    if (options.start !== undefined) {
      integer(options.start, 65535, 'start');
      if (options.start % 256) throw new RangeError('Start must be 256-byte aligned');
      add(6, options.start / 256, 255, 'start');
    }
    if (options.loopStart !== undefined) add(4, options.loopStart, 65535, 'loopStart');
    if (options.step !== undefined) add(2, options.step, 65535, 'step');
    if (options.volume !== undefined) add(0, options.volume, 255, 'volume');
    if (options.pan !== undefined) {
      integer(options.pan.left, 15, 'left'); integer(options.pan.right, 15, 'right');
      add(1, options.pan.left | (options.pan.right << 4), 255, 'pan');
    }
    this._select(channel);
    for (const [register, value] of entries) this.writeRegister(register, value);
  }
  /** Set raw 16-bit playback step, not a MIDI note. */
  setPitch(channel, step) { this.setChannel(channel, {step}); }
  /** Retrigger the selected physical channel; other channels keep playing. */
  keyOn(channel) {
    this._select(channel);
    this.writeRegister(8, this.channelMask | (1 << channel));
    this.writeRegister(8, this.channelMask & ~(1 << channel));
  }
  keyOff(channel) {
    integer(channel, 7, 'channel');
    this.writeRegister(8, this.channelMask | (1 << channel));
  }
  /** Reset registers and mask while retaining waveform RAM. */
  reset() {
    this.transport.reset();
    this.channelMask = 255;
    this.writeRegister(8, 255);
  }
}

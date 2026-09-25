/** @file Browser / Worker / Node.js. AY-compatible SSG register helper; no audio output or DOM. */
const integer = (name, value, max) => {
  if (!Number.isInteger(value) || value < 0 || value > max) throw new RangeError(`Invalid SSG ${name}`);
  return value;
};
/** Three tone/noise channels sharing one noise generator and one envelope. */
export class SSGSynth {
  /** @param {{transport: {write: function(number, number): void}, clock: number}} options
   * clock is the effective SSG clock, not necessarily the package's master clock.
   */
  constructor({transport, clock}) {
    if (!transport || typeof transport.write !== 'function') throw new TypeError('SSG requires write(register, value)');
    if (!Number.isFinite(clock) || clock <= 0) throw new RangeError('Invalid SSG clock');
    this.transport = transport;
    this.clock = clock;
    this.resetState();
  }
  /** Reset tracked registers after the parent chip was reset. Does not write hardware. */
  resetState() { this.registers = new Uint8Array(16); }
  /** Track parent Synth raw writes so mixer changes preserve other channels and I/O bits. */
  observeWrite(register, value) { if (register >= 0 && register < 16) this.registers[register] = value; }
  write(register, value) {
    integer('register', register, 15); integer('value', value, 255);
    this.transport.write(register, value);
    this.observeWrite(register, value);
  }
  /** Silence/reset SSG audio registers only; FM and I/O registers are preserved. */
  reset() {
    for (let r = 0; r <= 13; r++) this.write(r, r === 7 ? (this.registers[7] & 0xc0) | 0x3f : 0);
  }
  /** @param {number} channel 0..2.
   * @param {{period?: number, frequency?: number, volume?: number, envelope?: boolean}} options
   * volume is hardware level 0..15 (0=silent). period overrides frequency.
   */
  tone(channel, {period, frequency, volume = 12, envelope = false} = {}) {
    integer('channel', channel, 2); integer('volume', volume, 15);
    if (typeof envelope !== 'boolean') throw new TypeError('SSG envelope must be boolean');
    if (period === undefined) {
      if (!Number.isFinite(frequency) || frequency <= 0) throw new RangeError('Invalid SSG frequency');
      period = Math.max(1, Math.min(4095, Math.round(this.clock / (16 * frequency))));
    }
    integer('period', period, 4095);
    this.write(channel * 2, period & 255);
    this.write(channel * 2 + 1, period >> 8);
    this.setMixer(channel, {tone: true, noise: false});
    this.setVolume(channel, volume, envelope);
    return period;
  }
  /** Enable shared noise on one channel. Changing period affects all noise-enabled channels. */
  noise(channel, {period = 16, volume = 10, envelope = false} = {}) {
    integer('channel', channel, 2); integer('period', period, 31); integer('volume', volume, 15);
    if (typeof envelope !== 'boolean') throw new TypeError('SSG envelope must be boolean');
    this.write(6, period);
    this.setMixer(channel, {tone: false, noise: true});
    this.setVolume(channel, volume, envelope);
  }
  /** Mixer gates may combine tone and noise on the same channel. */
  setMixer(channel, {tone, noise}) {
    integer('channel', channel, 2);
    if (typeof tone !== 'boolean' || typeof noise !== 'boolean') throw new TypeError('SSG mixer expects booleans');
    const bits = (1 << channel) | (8 << channel);
    this.write(7, (this.registers[7] & ~bits) | (tone ? 0 : 1 << channel) | (noise ? 0 : 8 << channel));
  }
  /** Envelope selection replaces fixed volume with the shared hardware envelope. */
  setVolume(channel, volume, envelope = false) {
    integer('channel', channel, 2); integer('volume', volume, 15);
    if (typeof envelope !== 'boolean') throw new TypeError('SSG envelope must be boolean');
    this.write(8 + channel, envelope ? 16 : volume);
  }
  off(channel) { this.setVolume(channel, 0); }
  /** Set the shared envelope period/shape; writing shape retriggers the envelope. */
  setEnvelope({period, shape}) {
    integer('envelope period', period, 65535); integer('shape', shape, 15);
    this.write(11, period & 255); this.write(12, period >> 8); this.write(13, shape);
  }
}

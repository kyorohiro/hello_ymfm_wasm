import {NesApuAudioEngine} from './nesapuaudioengine.js';
export const NES_APU_CLOCK = 1789773;
/** NES APU with optional FDS. JavaScript cores; no CPU, cartridge or ROM required. */
export class NesApu {
  /** @param {{clock?: number, sampleRate?: number, fds?: boolean}} [options] */
  constructor({clock = NES_APU_CLOCK, sampleRate = 44100, fds = false} = {}) {
    this.clock = clock; this.fdsEnabled = Boolean(fds); this.disposed = false; this.enableMask = 0;
    this.engine = new NesApuAudioEngine({clock, outputSampleRate: sampleRate, fds});
    this.clearHistory();
  }
  /** @param {{clock?: number, sampleRate?: number, fds?: boolean}} [options] */
  static async create(options = {}) {return new NesApu(options);}
  clearHistory() {
    // Seed the integer core's filter at the silent DAC baseline, without advancing time.
    this.engine.apu.prevSampleL = this.engine.apu.prevSampleR = -this.engine.apu.dcValue;
    this.previousLeft = this.previousRight = this.filteredLeft = this.filteredRight = 0;
    this.dcCoefficient = Math.exp(-2 * Math.PI * 10 / this.engine.sampleRate());
  }
  check() {if (this.disposed) throw new Error('NES APU disposed');}
  /** Native CPU addresses, including FDS $4023 and $4040–$408A.
   * @param {number} address @param {number} value */
  writeRegister(address, value) {
    this.check();
    if (!Number.isInteger(value) || value < 0 || value > 255) throw new RangeError('NES value must be 0..255');
    let register;
    if (Number.isInteger(address) && address >= 0x4000 && address <= 0x4017) register = address - 0x4000;
    else if (address === 0x4023) register = 0x3f;
    else if (Number.isInteger(address) && address >= 0x4040 && address <= 0x407f) register = address - 0x4000;
    else if (Number.isInteger(address) && address >= 0x4080 && address <= 0x408a) register = 0x20 + address - 0x4080;
    else throw new RangeError('Unsupported NES/FDS address');
    this.engine.writeNesApu(register, value);
    if (address === 0x4015) this.enableMask = value & 31;
  }
  /** @param {Uint8Array} bytes @param {number} [address] */
  loadMemory(bytes, address = 0xc000) {this.check(); this.engine.loadNesMemory(bytes, address);}
  /** Preserve live DMC activity without restarting an already completed sample.
   * @param {number} channel @param {boolean} enabled */
  setChannelEnabled(channel, enabled) {
    this.check();
    if (!Number.isInteger(channel) || channel < 0 || channel > 4 || typeof enabled !== 'boolean') throw new RangeError('Invalid NES channel enable');
    const current = channel === 4 ? this.enableMask : (this.enableMask & 15) | (this.engine.apu.dmc.getLengthStatus() << 4);
    this.writeRegister(0x4015, enabled ? current | (1 << channel) : current & ~(1 << channel));
  }
  reset() {this.check(); this.enableMask = 0; this.engine.reset(); this.clearHistory();}
  sampleRate() {return this.engine.sampleRate();}
  /** @param {number} frames */
  generateStereo(frames) {
    this.check(); const pcm = this.engine.processFrames(frames);
    // JSNES's integer high-pass can leave a small positive DC plateau.
    for (let i = 0; i < frames; i++) {
      const left = pcm.left[i], right = pcm.right[i];
      this.filteredLeft = this.dcCoefficient * (this.filteredLeft + left - this.previousLeft);
      this.filteredRight = this.dcCoefficient * (this.filteredRight + right - this.previousRight);
      this.previousLeft = left; this.previousRight = right;
      pcm.left[i] = this.filteredLeft; pcm.right[i] = this.filteredRight;
    }
    return pcm;
  }
  /** @param {number} channel @param {boolean} muted */
  setChannelMuted(channel, muted) {this.check(); this.engine.setChannelMuted(channel, muted);}
  dispose() {if (!this.disposed) {this.disposed = true; this.engine.dispose();}}
}

import { Ym2151, YM2151_CLOCK } from './ym2151.js';
import { SegaPSG } from './segapsg.js';
import { SegaPcm } from './segapcm.js';

// YM2151 and optional Sega PSG / Sega PCM share the output clock, but keep independent state.
/**
 * Ym2151AudioEngine adapter for synchronous stereo rendering and VGM register dispatch.
 * Output timing uses sampleRate() frames per second. No browser audio device is opened.
 * Dispose the engine when done to release its underlying chips.
 */
export class Ym2151AudioEngine {
  /**
   * Create the chip instances required by this engine.
   * @param {Object} [options={}] Chip factories, clocks in Hz and loader settings.
   * @param {number} [options.outputSampleRate=44100] Output stereo frames per second.
   * @param {number} [options.masterVolume=1] Linear output gain, not dB.
   * @returns {Promise<Ym2151AudioEngine>} Initialized engine owned by the caller.
   */
  static async create({ ym2151ModuleFactory, ym2151ModuleOptions, ym2151Clock = YM2151_CLOCK,
    segaPsgModuleFactory, psgClock = 0,
    segaPcmModuleFactory, segaPcmModuleOptions, segaPcmClock = 0, segaPcmBankShift = 0, segaPcmBankMask = 0,
    outputSampleRate = 44100, masterVolume = 1 } = {}) {
    if (!Number.isFinite(outputSampleRate) || outputSampleRate <= 0 ||
        !Number.isFinite(ym2151Clock) || ym2151Clock <= 0) throw new RangeError('Invalid sample rate or chip clock');
    const chip = await Ym2151.create({ moduleFactory: ym2151ModuleFactory, moduleOptions: ym2151ModuleOptions });
    let psg, segapcm;
    try {
      if (psgClock) psg = await SegaPSG.create({ moduleFactory: segaPsgModuleFactory, clock: psgClock, sampleRate: outputSampleRate });
      if (segaPcmClock) segapcm = await SegaPcm.create({
        moduleFactory: segaPcmModuleFactory, moduleOptions: segaPcmModuleOptions,
        clock: segaPcmClock, bankShift: segaPcmBankShift, bankMask: segaPcmBankMask, sampleRate: outputSampleRate,
      });
      return new Ym2151AudioEngine(chip, psg, segapcm, chip.sampleRate(ym2151Clock), outputSampleRate, masterVolume);
    } catch (error) { chip.dispose(); psg?.dispose(); segapcm?.dispose(); throw error; }
  }

  constructor(chip, psg, segapcm, chipRate, outputRate, volume) {
    this.ym2151 = chip;
    this.psg = psg;
    this.segapcm = segapcm;
    this.chipRate = chipRate;
    this.outputRate = outputRate;
    this.setMasterVolume(volume);
    this.psgMuted = false;
    this.segapcmMuted = false; this.segapcmChannelMask = 0;
    this.remainder = 0;
    this.lastLeft = 0; this.lastRight = 0;
  }
  /**
   * Return the rate used by process() and processFrames().
   * @returns {number} Output stereo frames per second (Hz).
   */
  sampleRate() { return this.outputRate; }
  /**
   * Set the linear master gain; validation/clamping follows this engine.
   * @param {number} value Gain multiplier, not dB.
   */
  setMasterVolume(value) {
    if (!Number.isFinite(Number(value))) throw new RangeError('Invalid master volume');
    return this.volume = Math.max(0, Math.min(3.8, Number(value)));
  }
  /**
   * Read the current linear master gain.
   * @returns {number} Gain multiplier, not a dB value.
   */
  getMasterVolume() { return this.volume; }
  setPsgMuted(value) { this.psgMuted = Boolean(value); }
  /**
   * Change one physical channel mute flag.
   * @param {number} channel Zero-based physical channel index, not a MIDI part.
   * @param {boolean} muted True to suppress the channel.
   * @returns {void}
   */
  setChannelMuted(channel, muted) {
    if (!Number.isInteger(channel) || channel < 0 || channel >= 8) throw new RangeError('Invalid YM2151 channel');
    const bit = 1 << channel;
    this.ym2151.setMuteMask(muted ? this.ym2151.muteMask | bit : this.ym2151.muteMask & ~bit);
    this.lastLeft = 0; this.lastRight = 0;
  }
  /**
   * Dispatch a VGM register/command write to the corresponding sound chip.
   * @param {number} value Register/command data value.
   */
  writePsg(value) { this.psg?.write(value); }
  /**
   * Dispatch a VGM register/command write to the corresponding sound chip.
   * @param {number} register Register address within the selected chip bank.
   * @param {number} value Register/command data value.
   */
  writeYm2151(register, value) { this.ym2151.write(0, register); this.ym2151.write(1, value); }
  /**
   * Dispatch a VGM register/command write to the corresponding sound chip.
   * @param {number} offset Chip address offset.
   * @param {number} value Register/command data value.
   */
  writeSegaPcm(offset, value) { this.segapcm?.writeRegister(offset, value); }
  loadSampleMemory(data, offset, memorySize) { this.segapcm?.loadSampleMemory(data, offset, memorySize); }
  clearSampleMemory() { this.segapcm?.clearSampleMemory(); }
  setSegaPcmMuted(value) { this.segapcmMuted = Boolean(value); this.applySegaPcmMute(); }
  setSegaPcmChannelMuted(channel, muted) {
    if (!Number.isInteger(channel) || channel < 0 || channel > 15) throw new RangeError('Invalid Sega PCM channel');
    this.segapcmChannelMask = muted ? this.segapcmChannelMask | (1 << channel) : this.segapcmChannelMask & ~(1 << channel);
    this.applySegaPcmMute();
  }
  applySegaPcmMute() { this.segapcm?.setMuteMask(this.segapcmMuted ? 0xffff : this.segapcmChannelMask); }
  /**
   * Reset chip/playback state for a new pass. This is not pause/resume; replay setup writes afterward.
   * @returns {void}
   */
  reset() {
    this.ym2151.reset(); this.psg?.reset(); this.segapcm?.reset(); this.remainder = 0; this.lastLeft = 0; this.lastRight = 0;
  }
  /**
   * Release the underlying chips and their resources. Do not render after disposal.
   * @returns {void}
   */
  dispose() { this.ym2151.dispose(); this.psg?.dispose(); this.segapcm?.dispose(); }
  /**
   * Advance synthesis and fill caller-owned stereo buffers.
   * @param {Float32Array} left Left output buffer with capacity for frames samples.
   * @param {Float32Array} right Right output buffer with capacity for frames samples.
   * @param {number} frames Nonnegative integer output frame count; not VGM wait samples.
   */
  process(left, right, frames) {
    if (!Number.isInteger(frames) || frames < 0 || frames > 0x1000000) throw new RangeError('Invalid frame count');
    if (!(left instanceof Float32Array) || !(right instanceof Float32Array) || left.length < frames || right.length < frames)
      throw new RangeError('Invalid output buffers');
    const psg = this.psg?.generateStereo(frames);
    const segapcm = this.segapcm?.generateStereo(frames);
    for (let i = 0; i < frames; i++) {
      this.remainder += this.chipRate;
      const count = Math.floor(this.remainder / this.outputRate);
      this.remainder -= count * this.outputRate;
      if (count) {
        const pcm = this.ym2151.generateStereo(count);
        let sumLeft = 0, sumRight = 0;
        for (let sample = 0; sample < count; sample++) { sumLeft += pcm.left[sample]; sumRight += pcm.right[sample]; }
        this.lastLeft = sumLeft / count;
        this.lastRight = sumRight / count;
      }
      left[i] = (this.lastLeft + (psg && !this.psgMuted ? psg.left[i] : 0) + (segapcm ? segapcm.left[i] : 0)) * this.volume;
      right[i] = (this.lastRight + (psg && !this.psgMuted ? psg.right[i] : 0) + (segapcm ? segapcm.right[i] : 0)) * this.volume;
    }
  }
  /**
   * Allocate stereo output and advance synthesis.
   * @param {number} frames Nonnegative integer frame count at sampleRate().
   * @returns {{left:Float32Array,right:Float32Array}} Rendered stereo output.
   */
  processFrames(frames) {
    if (!Number.isInteger(frames) || frames < 0 || frames > 0x1000000) throw new RangeError('Invalid frame count');
    const left = new Float32Array(frames), right = new Float32Array(frames);
    this.process(left, right, frames);
    return { left, right };
  }
}
export const createYm2151AudioEngine = options => Ym2151AudioEngine.create(options);

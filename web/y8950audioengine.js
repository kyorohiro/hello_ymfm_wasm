import { Y8950, Y8950_CLOCK } from './y8950.js?v=mutes-1';
import { SegaPSG } from './segapsg.js';

// Y8950 and optional Sega PSG share the output clock, but keep independent state.
/**
 * Y8950AudioEngine adapter for synchronous stereo rendering and VGM register dispatch.
 * Output timing uses sampleRate() frames per second. No browser audio device is opened.
 * Dispose the engine when done to release its underlying chips.
 */
export class Y8950AudioEngine {
  /**
   * Create the chip instances required by this engine.
   * @param {Object} [options={}] Chip factories, clocks in Hz and loader settings.
   * @param {number} [options.outputSampleRate=44100] Output stereo frames per second.
   * @param {number} [options.masterVolume=1] Linear output gain, not dB.
   * @returns {Promise<Y8950AudioEngine>} Initialized engine owned by the caller.
   */
  static async create({ y8950ModuleFactory, y8950ModuleOptions, y8950Clock = Y8950_CLOCK,
    segaPsgModuleFactory, psgClock = 0, outputSampleRate = 44100, masterVolume = 1 } = {}) {
    if (!Number.isFinite(outputSampleRate) || outputSampleRate <= 0 ||
        !Number.isFinite(y8950Clock) || y8950Clock <= 0) throw new RangeError('Invalid sample rate or chip clock');
    const chip = await Y8950.create({ moduleFactory: y8950ModuleFactory, moduleOptions: y8950ModuleOptions });
    let psg;
    try {
      if (psgClock) psg = await SegaPSG.create({ moduleFactory: segaPsgModuleFactory, clock: psgClock, sampleRate: outputSampleRate });
      return new Y8950AudioEngine(chip, psg, chip.sampleRate(y8950Clock), outputSampleRate, masterVolume);
    } catch (error) { chip.dispose(); psg?.dispose(); throw error; }
  }

  constructor(chip, psg, chipRate, outputRate, volume) {
    this.y8950 = chip;
    this.psg = psg;
    this.chipRate = chipRate;
    this.outputRate = outputRate;
    this.setMasterVolume(volume);
    this.psgMuted = false;
    this.channelMask = 0; this.adpcmMuted = false; this.muted = false;
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
  /**
   * Change one physical channel mute flag.
   * @param {number} channel Zero-based physical channel index, not a MIDI part.
   * @param {boolean} value True to suppress the channel.
   * @returns {void}
   */
  setChannelMuted(channel, value) {
    if (!Number.isInteger(channel) || channel < 0 || channel >= 9) throw new RangeError('Invalid Y8950 channel');
    this.channelMask = value ? this.channelMask | (1 << channel) : this.channelMask & ~(1 << channel);
    this.applyMute();
  }
  setAdpcmMuted(value) { this.adpcmMuted = Boolean(value); this.applyMute(); }
  setY8950Muted(value) { this.muted = Boolean(value); this.applyMute(); }
  applyMute() {
    this.y8950.setMuteMask(this.muted ? 0x3ff : this.channelMask | (this.adpcmMuted ? 0x200 : 0));
    this.lastLeft = this.lastRight = 0;
  }
  setPsgMuted(value) { this.psgMuted = Boolean(value); }
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
  writeY8950(register, value) { this.y8950.write(0, register); this.y8950.write(1, value); }
  loadSampleMemory(data, offset, memorySize) { this.y8950.loadSampleMemory(data, offset, memorySize); }
  clearSampleMemory() { this.y8950.clearSampleMemory(); }
  /**
   * Reset chip/playback state for a new pass. This is not pause/resume; replay setup writes afterward.
   * @returns {void}
   */
  reset() {
    this.y8950.reset(); this.psg?.reset(); this.remainder = 0; this.lastLeft = 0; this.lastRight = 0;
  }
  /**
   * Release the underlying chips and their resources. Do not render after disposal.
   * @returns {void}
   */
  dispose() { this.y8950.dispose(); this.psg?.dispose(); }
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
    for (let i = 0; i < frames; i++) {
      this.remainder += this.chipRate;
      const count = Math.floor(this.remainder / this.outputRate);
      this.remainder -= count * this.outputRate;
      if (count) {
        const pcm = this.y8950.generateStereo(count);
        let sumLeft = 0, sumRight = 0;
        for (let sample = 0; sample < count; sample++) { sumLeft += pcm.left[sample]; sumRight += pcm.right[sample]; }
        this.lastLeft = sumLeft / count;
        this.lastRight = sumRight / count;
      }
      left[i] = (this.lastLeft + (psg && !this.psgMuted ? psg.left[i] : 0)) * this.volume;
      right[i] = (this.lastRight + (psg && !this.psgMuted ? psg.right[i] : 0)) * this.volume;
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
export const createY8950AudioEngine = options => Y8950AudioEngine.create(options);

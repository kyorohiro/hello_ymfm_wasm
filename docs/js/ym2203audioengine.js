import { Ym2203, YM2203_CLOCK } from "./ym2203.js";

const DEFAULT_OUTPUT_SAMPLE_RATE = 44100;

/**
 * Ym2203AudioEngine adapter for synchronous stereo rendering and VGM register dispatch.
 * Output timing uses sampleRate() frames per second. No browser audio device is opened.
 * Dispose the engine when done to release its underlying chips.
 */
export class Ym2203AudioEngine {
  constructor(
    ym2203,
    chipSampleRate,
    outputSampleRate,
    masterVolume = 1
  ) {
    this.ym2203 = ym2203;
    this._chipSampleRate = chipSampleRate;
    this._sampleRate = outputSampleRate;
    this._masterVolume = clampMasterVolume(masterVolume);
    this._sourceMuteMask = 0;
    this.channelMuteMask = 0;
    this._resampleRemainder = 0;
    this._lastLeft = 0;
    this._lastRight = 0;
  }

  /**
   * Create the chip instances required by this engine.
   * @param {Object} [options={}] Chip factories, clocks in Hz and loader settings.
   * @param {number} [options.outputSampleRate=44100] Output stereo frames per second.
   * @param {number} [options.masterVolume=1] Linear output gain, not dB.
   * @returns {Promise<Ym2203AudioEngine>} Initialized engine owned by the caller.
   */
  static async create(options = {}) {
    const {
      ym2203ModuleFactory,
      ym2203ModuleOptions,
      ym2203Clock = YM2203_CLOCK,
      outputSampleRate = DEFAULT_OUTPUT_SAMPLE_RATE,
      masterVolume = 1,
    } = options;

    if (!ym2203ModuleFactory) {
      throw new Error("ym2203ModuleFactory is required");
    }

    const ym2203 = await Ym2203.create({
      moduleFactory: ym2203ModuleFactory,
      moduleOptions: ym2203ModuleOptions,
    });
    const chipSampleRate = ym2203.sampleRate(ym2203Clock);

    return new Ym2203AudioEngine(
      ym2203,
      chipSampleRate,
      outputSampleRate,
      masterVolume
    );
  }

  /**
   * Release the underlying chips and their resources. Do not render after disposal.
   * @returns {void}
   */
  dispose() {
    this.ym2203.dispose();
  }

  /**
   * Reset chip/playback state for a new pass. This is not pause/resume; replay setup writes afterward.
   * @returns {void}
   */
  reset() {
    this.ym2203.reset();
    this.ym2203.setMuteMask(this.channelMuteMask);
    this._resampleRemainder = 0;
    this._lastLeft = 0;
    this._lastRight = 0;
  }

  /**
   * Return the rate used by process() and processFrames().
   * @returns {number} Output stereo frames per second (Hz).
   */
  sampleRate() {
    return this._sampleRate;
  }

  /**
   * Set the linear master gain; validation/clamping follows this engine.
   * @param {number} volume Gain multiplier, not dB.
   */
  setMasterVolume(volume) {
    this._masterVolume = clampMasterVolume(volume);
    return this._masterVolume;
  }

  /**
   * Read the current linear master gain.
   * @returns {number} Gain multiplier, not a dB value.
   */
  getMasterVolume() {
    return this._masterVolume;
  }

  /**
   * Dispatch a VGM register/command write to the corresponding sound chip.
   * @param {number} register Register address within the selected chip bank.
   * @param {number} value Register/command data value.
   */
  writeYm2203(register, value) {
    this.ym2203.write(0, register);
    this.ym2203.write(1, value);
  }

  /**
   * Change one physical channel mute flag.
   * @param {number} channel Zero-based physical channel index, not a MIDI part.
   * @param {boolean} muted True to suppress the channel.
   * @returns {void}
   */
  setChannelMuted(channel, muted) {
    if (!Number.isInteger(channel) || channel < 0 || channel >= 3) throw new RangeError('Invalid YM2203 channel');
    const bit = 1 << channel;
    this.channelMuteMask = muted ? this.channelMuteMask | bit : this.channelMuteMask & ~bit;
    this.ym2203.setMuteMask(this.channelMuteMask);
  }
  setSsgMuted(muted) { this.setSourceMuted(1, muted); }

  setSourceMuted(bit, muted) {
    const mask = muted ? this._sourceMuteMask | bit : this._sourceMuteMask & ~bit;
    this.ym2203.setSourceMuteMask(mask);
    this._sourceMuteMask = mask;
  }

  /**
   * Dispatch a VGM register/command write to the corresponding sound chip.
   * @param {number} _value Ignored; this engine has no Sega PSG output.
   */
  writePsg(_value) {}

  /**
   * Advance synthesis and fill caller-owned stereo buffers.
   * @param {Float32Array} left Left output buffer with capacity for frames samples.
   * @param {Float32Array} right Right output buffer with capacity for frames samples.
   * @param {number} frames Nonnegative integer output frame count; not VGM wait samples.
   */
  process(left, right, frames) {
    if (!(left instanceof Float32Array) || !(right instanceof Float32Array)) {
      throw new Error("process expects Float32Array buffers");
    }
    if (left.length < frames || right.length < frames) {
      throw new Error("process buffers are smaller than the requested frame count");
    }

    for (let index = 0; index < frames; index += 1) {
      this._resampleRemainder +=
        this._chipSampleRate;

      const samplesToMix = Math.floor(this._resampleRemainder / this._sampleRate);
      this._resampleRemainder -= samplesToMix * this._sampleRate;

      // During upsampling, hold the previous sample without advancing the chip.
      if (samplesToMix > 0) {
        const ym = this.ym2203.generateStereo(samplesToMix);
        let mixedLeft = 0;
        let mixedRight = 0;
        for (let sampleIndex = 0; sampleIndex < samplesToMix; sampleIndex += 1) {
          mixedLeft += ym.left[sampleIndex];
          mixedRight += ym.right[sampleIndex];
        }
        this._lastLeft = mixedLeft / samplesToMix;
        this._lastRight = mixedRight / samplesToMix;
      }
      left[index] = this._lastLeft * this._masterVolume;
      right[index] = this._lastRight * this._masterVolume;
    }
  }

  /**
   * Allocate stereo output and advance synthesis.
   * @param {number} frames Nonnegative integer frame count at sampleRate().
   * @returns {{left:Float32Array,right:Float32Array}} Rendered stereo output.
   */
  processFrames(frames) {
    const left = new Float32Array(frames);
    const right = new Float32Array(frames);
    this.process(left, right, frames);
    return { left, right };
  }
}

export async function createYm2203AudioEngine(options) {
  return Ym2203AudioEngine.create(options);
}

const MAX_MASTER_VOLUME = 3.8;

function clampMasterVolume(value) {
  const numeric = Number(value);

  if (!Number.isFinite(numeric)) {
    throw new Error(
      `master volume must be a finite number, got ${value}`
    );
  }

  return Math.min(
    MAX_MASTER_VOLUME,
    Math.max(0, numeric)
  );
}

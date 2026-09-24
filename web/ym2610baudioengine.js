import { Ym2610B, YM2610B_CLOCK } from "./ym2610b.js?v=ym2610-vgm-1";

const DEFAULT_OUTPUT_SAMPLE_RATE = 44100;

/** YM2610 / YM2610B FM, SSG and ADPCM playback engine. */
export class Ym2610BAudioEngine {
  constructor(chip, chipSampleRate, outputSampleRate, masterVolume = 1) {
    this.chip = chip;
    this.chipSampleRate = chipSampleRate;
    this.outputSampleRate = outputSampleRate;
    this.masterVolume = clampVolume(masterVolume);
    this.remainder = 0;
    this.lastLeft = 0;
    this.lastRight = 0;
    this.sourceMuteMask = 0;
  }

  /**
   * Create the chip instances required by this engine.
   * @param {Object} [options={}] Chip factories, clocks in Hz and loader settings.
   * @param {number} [options.outputSampleRate=44100] Output stereo frames per second.
   * @param {number} [options.masterVolume=1] Linear output gain, not dB.
   * @returns {Promise<Ym2610BAudioEngine>} Initialized engine owned by the caller.
   */
  static async create(options = {}) {
    const chip = await Ym2610B.create({
      moduleFactory: options.moduleFactory,
      moduleOptions: options.moduleOptions,
      variant: options.variant ?? true,
    });
    return new Ym2610BAudioEngine(
      chip,
      chip.sampleRate(options.clock ?? YM2610B_CLOCK),
      options.outputSampleRate ?? DEFAULT_OUTPUT_SAMPLE_RATE,
      options.masterVolume ?? 1
    );
  }

  /**
   * Release the underlying chips and their resources. Do not render after disposal.
   * @returns {void}
   */
  dispose() { this.chip.dispose(); }
  /**
   * Reset chip/playback state for a new pass. This is not pause/resume; replay setup writes afterward.
   * @returns {void}
   */
  reset() { this.chip.reset(); this.clearAdpcmRoms(); this.remainder = 0; this.lastLeft = 0; this.lastRight = 0; }
  /**
   * Return the rate used by process() and processFrames().
   * @returns {number} Output stereo frames per second (Hz).
   */
  sampleRate() { return this.outputSampleRate; }
  /**
   * Set the linear master gain; validation/clamping follows this engine.
   * @param {number} value Gain multiplier, not dB.
   */
  setMasterVolume(value) { this.masterVolume = clampVolume(value); return this.masterVolume; }
  /**
   * Read the current linear master gain.
   * @returns {number} Gain multiplier, not a dB value.
   */
  getMasterVolume() { return this.masterVolume; }
  /**
   * Dispatch a VGM register/command write to the corresponding sound chip.
   * @param {number} port Chip register bank/port (not a MIDI channel).
   * @param {number} register Register address within the selected chip bank.
   * @param {number} value Register/command data value.
   */
  writeYm2610B(port, register, value) {
    this.chip.write(port * 2, register);
    this.chip.write((port * 2) + 1, value);
  }

  loadAdpcmRom(type, data, offset, size) { this.chip.loadAdpcmRom(type, data, offset, size); }
  clearAdpcmRoms() { this.chip.clearAdpcmRoms?.(); }
  setSsgMuted(muted) { this.setSourceMuted(1, muted); }
  setRhythmMuted(muted) { this.setSourceMuted(2, muted); }
  setAdpcmBMuted(muted) { this.setSourceMuted(4, muted); }
  setSourceMuted(bit, muted) {
    this.sourceMuteMask = muted ? this.sourceMuteMask | bit : this.sourceMuteMask & ~bit;
    this.chip.setSourceMuteMask(this.sourceMuteMask);
  }
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
      this.remainder += this.chipSampleRate;
      const count = Math.floor(this.remainder / this.outputSampleRate);
      this.remainder -= count * this.outputSampleRate;
      // During upsampling, hold the previous sample without advancing the chip.
      if (count > 0) {
        const pcm = this.chip.generateStereo(count);
        let mixedLeft = 0;
        let mixedRight = 0;
        for (let sample = 0; sample < count; sample += 1) {
          mixedLeft += pcm.left[sample];
          mixedRight += pcm.right[sample];
        }
        this.lastLeft = mixedLeft / count;
        this.lastRight = mixedRight / count;
      }
      left[index] = this.lastLeft * this.masterVolume;
      right[index] = this.lastRight * this.masterVolume;
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

export async function createYm2610BAudioEngine(options) {
  return Ym2610BAudioEngine.create(options);
}

function clampVolume(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) throw new Error(`master volume must be a finite number, got ${value}`);
  return Math.min(3.8, Math.max(0, numeric));
}

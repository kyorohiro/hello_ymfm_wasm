import { Ym2610B, YM2610B_CLOCK } from "./ym2610b.js";

const DEFAULT_OUTPUT_SAMPLE_RATE = 44100;

/** FM-only browser audio engine for the YM2610B core. */
export class Ym2610BAudioEngine {
  constructor(chip, chipSampleRate, outputSampleRate, masterVolume = 1) {
    this.chip = chip;
    this.chipSampleRate = chipSampleRate;
    this.outputSampleRate = outputSampleRate;
    this.masterVolume = clampVolume(masterVolume);
    this.remainder = 0;
  }

  static async create(options = {}) {
    const chip = await Ym2610B.create({
      moduleFactory: options.moduleFactory,
      moduleOptions: options.moduleOptions,
    });
    return new Ym2610BAudioEngine(
      chip,
      chip.sampleRate(options.clock ?? YM2610B_CLOCK),
      options.outputSampleRate ?? DEFAULT_OUTPUT_SAMPLE_RATE,
      options.masterVolume ?? 1
    );
  }

  dispose() { this.chip.dispose(); }
  reset() { this.chip.reset(); this.remainder = 0; }
  sampleRate() { return this.outputSampleRate; }
  setMasterVolume(value) { this.masterVolume = clampVolume(value); return this.masterVolume; }
  getMasterVolume() { return this.masterVolume; }
  writeYm2610B(port, register, value) {
    this.chip.write(port * 2, register);
    this.chip.write((port * 2) + 1, value);
  }

  process(left, right, frames) {
    if (!(left instanceof Float32Array) || !(right instanceof Float32Array)) {
      throw new Error("process expects Float32Array buffers");
    }
    if (left.length < frames || right.length < frames) {
      throw new Error("process buffers are smaller than the requested frame count");
    }
    for (let index = 0; index < frames; index += 1) {
      this.remainder += this.chipSampleRate;
      const count = Math.max(1, Math.floor(this.remainder / this.outputSampleRate));
      this.remainder -= count * this.outputSampleRate;
      const pcm = this.chip.generateStereo(count);
      let mixedLeft = 0;
      let mixedRight = 0;
      for (let sample = 0; sample < count; sample += 1) {
        mixedLeft += pcm.left[sample];
        mixedRight += pcm.right[sample];
      }
      left[index] = mixedLeft / count * this.masterVolume;
      right[index] = mixedRight / count * this.masterVolume;
    }
  }

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

import { Ym2203, YM2203_CLOCK } from "./ym2203.js";

const DEFAULT_OUTPUT_SAMPLE_RATE = 44100;

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
    this._resampleRemainder = 0;
  }

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

  dispose() {
    this.ym2203.dispose();
  }

  reset() {
    this.ym2203.reset();
    this._resampleRemainder = 0;
  }

  sampleRate() {
    return this._sampleRate;
  }

  setMasterVolume(volume) {
    this._masterVolume = clampMasterVolume(volume);
    return this._masterVolume;
  }

  getMasterVolume() {
    return this._masterVolume;
  }

  writeYm2203(register, value) {
    this.ym2203.write(0, register);
    this.ym2203.write(1, value);
  }

  writePsg(_value) {}

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

      let samplesToMix = Math.floor(
        this._resampleRemainder /
          this._sampleRate
      );

      if (samplesToMix < 1) {
        samplesToMix = 1;
      }

      this._resampleRemainder -=
        samplesToMix *
        this._sampleRate;

      const ym =
        this.ym2203.generateStereo(
          samplesToMix
        );
      let mixedLeft = 0;
      let mixedRight = 0;

      for (
        let sampleIndex = 0;
        sampleIndex < samplesToMix;
        sampleIndex += 1
      ) {
        mixedLeft += ym.left[sampleIndex];
        mixedRight += ym.right[sampleIndex];
      }

      left[index] =
        (mixedLeft / samplesToMix) *
        this._masterVolume;
      right[index] =
        (mixedRight / samplesToMix) *
        this._masterVolume;
    }
  }

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

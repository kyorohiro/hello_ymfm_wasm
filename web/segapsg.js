export const SEGAPSG_CLOCK = 3579545;
export const SEGAPSG_SAMPLE_RATE = 44100;

/**
 * SegaPSG chip instance backed by WASM. No AudioContext or playback device is created.
 * Use create() to initialize and dispose() to release native resources.
 * Register writes program the chip; generateStereo() advances it to produce PCM.
 */
export class SegaPSG {
  /**
   * Wrap native resources allocated by create(); prefer the asynchronous factory.
   * @param {Object} module Initialized Emscripten module.
   * @param {number} handle Native chip handle owned by this instance.
   * @param {Object} api Bound native entry points.
   */
  constructor(module, handle, api) {
    this.module = module;
    this.handle = handle;
    this.api = api;
    this.leftPtr = 0;
    this.rightPtr = 0;
    this.bufferFrames = 0;
  }

  /**
   * Initialize SegaPSG and its native WASM module.
   * The generated module factory is injected so browser and Node callers can choose asset loading.
   * @param {Object} [options={}] Chip and Emscripten initialization settings.
   * @param {function(Object): (Object|Promise<Object>)} options.moduleFactory Generated WASM module factory.
   * @param {Object} [options.moduleOptions] Forwarded loader options, e.g. wasmBinary or locateFile.
   * @param {number} [options.clock] Input chip clock in Hz.
   * @param {number} [options.sampleRate=44100] Generated PCM frames per second.
   * @returns {Promise<SegaPSG>} Ready-to-use chip; the caller must dispose it.
   */
  static async create(options = {}) {
    const {
      moduleFactory,
      moduleOptions,
      sampleRate = SEGAPSG_SAMPLE_RATE,
      clock = SEGAPSG_CLOCK,
    } = options;

    if (!moduleFactory) {
      throw new Error("moduleFactory is required");
    }

    const module = await moduleFactory(moduleOptions || {});
    const api = {
      create: module.cwrap("segapsg_create", "number", ["number", "number"]),
      destroy: module.cwrap("segapsg_destroy", null, ["number"]),
      reset: module.cwrap("segapsg_reset", null, ["number"]),
      write: module.cwrap("segapsg_write", null, ["number", "number"]),
      sampleRate: module.cwrap("segapsg_sample_rate", "number", ["number"]),
      generate: module.cwrap("segapsg_generate", null, ["number", "number", "number", "number"]),
    };

    const handle = api.create(sampleRate, clock);
    return new SegaPSG(module, handle, api);
  }

  /**
   * Release native chip state and allocated WASM buffers. Do not use the chip afterward.
   * @returns {void}
   */
  dispose() {
    if (this.leftPtr) {
      this.module._free(this.leftPtr);
      this.leftPtr = 0;
    }
    if (this.rightPtr) {
      this.module._free(this.rightPtr);
      this.rightPtr = 0;
    }
    if (this.handle) {
      this.api.destroy(this.handle);
      this.handle = 0;
    }
  }

  /**
   * Reset synthesis state for a new playback pass. Reapply voice and key registers afterward.
   * @returns {void}
   */
  reset() {
    this.api.reset(this.handle);
  }

  /**
   * Send a latched tone/noise/attenuation byte to the Sega PSG.
   * @param {number} data PSG command byte, 0..255.
   * @returns {void}
   */
  write(data) {
    this.api.write(this.handle, data);
  }

  /**
   * Return the configured PCM output rate.
   * @returns {number} Stereo frames per second.
   */
  sampleRate() {
    return this.api.sampleRate(this.handle);
  }

  /**
   * Generate PCM synchronously, advancing the chip by the requested number of frames.
   * Returned arrays are copied from WASM memory and survive later generation/disposal.
   * @param {number} frames Nonnegative integer stereo frame count.
   * @returns {{left: Float32Array, right: Float32Array}} Owned PCM arrays at sampleRate().
   */
  generateStereo(frames) {
    this.#ensureBuffers(frames);
    this.api.generate(this.handle, this.leftPtr, this.rightPtr, frames);

    const leftStart = this.leftPtr >> 2;
    const rightStart = this.rightPtr >> 2;
    const left = new Float32Array(frames);
    const right = new Float32Array(frames);
    left.set(this.module.HEAPF32.subarray(leftStart, leftStart + frames));
    right.set(this.module.HEAPF32.subarray(rightStart, rightStart + frames));
    return { left, right };
  }

  #ensureBuffers(frames) {
    if (!Number.isInteger(frames) || frames < 0 || frames > 0x1000000) {
      throw new RangeError("Invalid frame count");
    }
    if (frames <= this.bufferFrames) {
      return;
    }

    if (this.leftPtr) {
      this.module._free(this.leftPtr);
    }
    if (this.rightPtr) {
      this.module._free(this.rightPtr);
    }

    const byteLength = frames * Float32Array.BYTES_PER_ELEMENT;
    this.leftPtr = this.module._malloc(byteLength);
    this.rightPtr = this.module._malloc(byteLength);
    this.bufferFrames = frames;
  }
}

/**
 * Convenience factory for SegaPSG. Does not create an audio device.
 * @param {function(Object): (Object|Promise<Object>)} moduleFactory Generated module factory.
 * @param {Object} [moduleOptions] Emscripten loader settings.
 * @returns {Promise<SegaPSG>} Chip instance owned by the caller.
 */
export async function createSegaPSG(moduleFactory, moduleOptions) {
  return SegaPSG.create({ moduleFactory, moduleOptions });
}

/**
 * @file rf5c164.js
 * 実行環境: Browser / Node.js
 * 依存: WASM（moduleFactory と moduleOptions で読み込み方法を注入）。
 * チップ操作・PCM 生成に DOM・AudioContext は不要。ローダーは実行環境に合わせて渡す。
 */
export const RF5C164_CLOCK = 12500000;
export const RF5C164_SAMPLE_RATE = 44100;

/**
 * Rf5c164 chip instance backed by WASM. No AudioContext or playback device is created.
 * Use create() to initialize and dispose() to release native resources.
 * Register writes program the chip; generateStereo() advances it to produce PCM.
 */
export class Rf5c164 {
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
   * Initialize Rf5c164 and its native WASM module.
   * The generated module factory is injected so browser and Node callers can choose asset loading.
   * @param {Object} [options={}] Chip and Emscripten initialization settings.
   * @param {function(Object): (Object|Promise<Object>)} options.moduleFactory Generated WASM module factory.
   * @param {Object} [options.moduleOptions] Forwarded loader options, e.g. wasmBinary or locateFile.
   * @param {number} [options.clock] Input chip clock in Hz.
   * @param {number} [options.sampleRate=44100] Generated PCM frames per second.
   * @returns {Promise<Rf5c164>} Ready-to-use chip; the caller must dispose it.
   */
  static async create(options = {}) {
    const {
      moduleFactory,
      moduleOptions,
      sampleRate = RF5C164_SAMPLE_RATE,
      clock = RF5C164_CLOCK,
    } = options;

    if (!moduleFactory) {
      throw new Error("moduleFactory is required");
    }

    for (const [name, value] of Object.entries({ sampleRate, clock })) {
      if (!Number.isInteger(value) || value <= 0 || value > 100000000) throw new RangeError(`Invalid ${name}`);
    }
    const module = await moduleFactory(moduleOptions || {});
    const api = {
      create: module.cwrap("rf5c164_create", "number", ["number", "number"]),
      destroy: module.cwrap("rf5c164_destroy", null, ["number"]),
      reset: module.cwrap("rf5c164_reset", null, ["number"]),
      write: module.cwrap("rf5c164_write", null, ["number", "number", "number"]),
      clearMemory: module.cwrap("rf5c164_clear_memory", null, ["number"]),
      writeMemory: module.cwrap("rf5c164_write_memory", null, ["number", "number", "number"]),
      readMemory: module.cwrap("rf5c164_read_memory", "number", ["number", "number"]),
      read: module.cwrap("rf5c164_read", "number", ["number", "number"]),
      bank: module.cwrap("rf5c164_bank", "number", ["number"]),
      load: module.cwrap("rf5c164_load", "number", ["number", "number", "number", "number"]),
      sampleRate: module.cwrap("rf5c164_sample_rate", "number", ["number"]),
      generate: module.cwrap("rf5c164_generate", null, ["number", "number", "number", "number"]),
    };

    const handle = api.create(sampleRate, clock);
    if (!handle) throw new Error("RF5C164 allocation failed");
    return new Rf5c164(module, handle, api);
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
   * Write a register directly without rendering audio.
   * @param {number} register Native control register index.
   * @param {number} value Register byte, 0..255.
   * @returns {void}
   */
  writeRegister(register, value) {
    this.api.write(this.handle, register, value);
  }

  clearMemory() { this.api.clearMemory(this.handle); }
  readMemory(offset) { return this.api.readMemory(this.handle, offset); }
  /**
   * Read a chip bus/status value; not a saved copy of all written voice registers.
   * @param {number} offset Native bus offset.
   * @returns {number} Native read result.
   */
  read(offset) { return this.api.read(this.handle, offset); }
  /**
   * Write through the currently selected 4 KiB CPU memory window.
   * @param {number} offset Window byte offset, 0..0xFFF.
   * @param {number} value Sample-memory byte.
   * @returns {void}
   */
  writeMemory(offset, value) {
    if (!Number.isInteger(offset) || offset < 0 || offset > 0xfff) throw new RangeError("RF5C164 memory window is 4 KiB");
    this.api.writeMemory(this.handle, offset, value);
  }

  // Absolute RAM access, independent of the currently selected CPU window.
  /**
   * Copy bytes into absolute sample RAM, independent of the selected CPU bank.
   * @param {Uint8Array} data Encoded sample bytes.
   * @param {number} [offset=0] Absolute byte address; the entire range must fit in 64 KiB.
   * @returns {void}
   * @throws {RangeError} If the destination range exceeds RAM.
   */
  loadMemory(data, offset = 0) {
    if (!(data instanceof Uint8Array)) throw new TypeError("Expected Uint8Array");
    if (!Number.isInteger(offset) || offset < 0 || offset > 65536 || data.length > 65536 - offset) {
      throw new RangeError("RF5C164 RAM range exceeds 64 KiB");
    }
    if (!data.length) return;
    const ptr = this.module._malloc(data.length);
    if (!ptr) throw new Error("RF5C164 sample allocation failed");
    try {
      this.module.HEAPU8.set(data, ptr);
      if (!this.api.load(this.handle, ptr, offset, data.length)) throw new RangeError("RF5C164 RAM range");
    } finally { this.module._free(ptr); }
  }

  // VGM RF5C RAM blocks start relative to the selected RAM bank.
  /**
   * Load a VGM RAM block relative to the selected bank.
   * @param {Uint8Array} data Encoded sample bytes.
   * @param {number} [offset=0] Offset combined with the current bank base using bitwise OR.
   * @returns {void}
   */
  loadBankedMemory(data, offset = 0) {
    if (!Number.isInteger(offset) || offset < 0 || offset > 65535) throw new RangeError("RF5C164 banked RAM offset");
    this.loadMemory(data, offset | this.api.bank(this.handle));
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
 * Convenience factory for Rf5c164. Does not create an audio device.
 * @param {function(Object): (Object|Promise<Object>)} moduleFactory Generated module factory.
 * @param {Object} [moduleOptions] Emscripten loader settings.
 * @returns {Promise<Rf5c164>} Chip instance owned by the caller.
 */
export async function createRf5c164(moduleFactory, moduleOptions) {
  return Rf5c164.create({ moduleFactory, moduleOptions });
}

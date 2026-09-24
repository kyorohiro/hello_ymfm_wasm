/**
 * @file ym3526.js
 * 実行環境: Browser / Node.js
 * 依存: WASM（moduleFactory と moduleOptions で読み込み方法を注入）。
 * チップ操作・PCM 生成に DOM・AudioContext は不要。ローダーは実行環境に合わせて渡す。
 */
export const YM3526_CLOCK = 3579545;

/**
 * Ym3526 chip instance backed by WASM. No AudioContext or playback device is created.
 * Use create() to initialize and dispose() to release native resources.
 * Register writes program the chip; generateStereo() advances it to produce PCM.
 */
export class Ym3526 {
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
    this.hooks = {
      onWrite: undefined,
      onRead: undefined,
      onIrq: undefined,
    };
    this.lastIrqState = undefined;
    this.leftPtr = 0;
    this.rightPtr = 0;
    this.bufferFrames = 0;
    this.muteMask = 0;
  }

  /**
   * Initialize Ym3526 and its native WASM module.
   * The generated module factory is injected so browser and Node callers can choose asset loading.
   * @param {Object} [options={}] Chip and Emscripten initialization settings.
   * @param {function(Object): (Object|Promise<Object>)} options.moduleFactory Generated WASM module factory.
   * @param {Object} [options.moduleOptions] Forwarded loader options, e.g. wasmBinary or locateFile.
   * @returns {Promise<Ym3526>} Ready-to-use chip; the caller must dispose it.
   */
  static async create(options = {}) {
    const { moduleFactory, moduleOptions } = options;
    if (!moduleFactory) {
      throw new Error("moduleFactory is required");
    }

    const module = await moduleFactory({ ...moduleOptions });
    const api = {
      create: module.cwrap("ym3526_create", "number", []),
      destroy: module.cwrap("ym3526_destroy", null, ["number"]),
      reset: module.cwrap("ym3526_reset", null, ["number"]),
      write: module.cwrap("ym3526_write", null, ["number", "number", "number"]),
      read: optionalCwrap(module, "ym3526_read", "number", ["number", "number"]),
      readStatus: optionalCwrap(module, "ym3526_read_status", "number", ["number"]),
      getIrq: optionalCwrap(module, "ym3526_get_irq", "number", ["number"]),
      sampleRate: module.cwrap("ym3526_sample_rate", "number", ["number", "number"]),
      setMuteMask: module.cwrap("ym3526_set_mute_mask", null, ["number", "number"]),
      generate: module.cwrap("ym3526_generate", null, ["number", "number", "number", "number"]),
    };

    const handle = api.create();
    return new Ym3526(module, handle, api);
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
   * Set native channel mute bits; a set bit suppresses that channel.
   * @param {number} mask Integer bit mask in the native chip channel layout.
   * @returns {void}
   */
  setMuteMask(mask) { this.muteMask = mask & 0x1ff; this.api.setMuteMask(this.handle, this.muteMask); }

  /**
   * Reset synthesis state for a new playback pass. Reapply voice and key registers afterward.
   * @returns {void}
   */
  reset() {
    // A chip reset leaves free-running envelope/LFO counters intact.
    // Start VGM replay/seek from the same power-on state each time.
    this.api.destroy(this.handle);
    this.handle = this.api.create();
    this.setMuteMask(this.muteMask);
    this.#syncIrq();
  }

  /**
   * Write one bus byte. Use the chip register protocol rather than a MIDI channel number.
   * @param {number} offset Native bus address/data port offset.
   * @param {number} data Byte value, 0..255.
   * @returns {void}
   */
  write(offset, data) {
    this.api.write(this.handle, offset, data);
    if (typeof this.hooks.onWrite === "function") {
      this.hooks.onWrite({ offset, data });
    }
    this.#syncIrq();
  }

  /**
   * Read a chip bus/status value; not a saved copy of all written voice registers.
   * @param {number} offset Native bus offset.
   * @returns {number} Native read result.
   */
  read(offset) {
    if (typeof this.api.read !== "function") {
      throw new Error("This YM3526 runtime does not support read(offset). Rebuild or reload the generated wasm runtime.");
    }
    const value = this.api.read(this.handle, offset);
    if (typeof this.hooks.onRead === "function") {
      this.hooks.onRead({ offset, value });
    }
    this.#syncIrq();
    return value;
  }

  /**
   * Read the primary status byte.
   * @returns {number} Status flags from the native core.
   */
  readStatus() {
    if (typeof this.api.readStatus !== "function") {
      return this.read(0);
    }
    const value = this.api.readStatus(this.handle);
    if (typeof this.hooks.onRead === "function") {
      this.hooks.onRead({ offset: 0, value });
    }
    this.#syncIrq();
    return value;
  }

  /**
   * Read the current native interrupt line state.
   * @returns {boolean} True when IRQ is asserted. Requires a runtime with IRQ support.
   */
  getIrq() {
    if (typeof this.api.getIrq !== "function") {
      return false;
    }
    return this.api.getIrq(this.handle) !== 0;
  }

  /**
   * Replace register/IRQ observers; omitted callbacks are removed.
   * Callbacks execute synchronously. IRQ notifications are checked at API boundaries.
   * @param {Object} [hooks={}] Optional callback functions.
   * @param {function({offset:number,data:number}):void} [hooks.onWrite] Called after a bus write.
   * @param {function({offset:number,value:number}):void} [hooks.onRead] Called after a read.
   * @param {function(boolean):void} [hooks.onIrq] Called with current/changed IRQ state.
   * @returns {void}
   */
  setHooks(hooks = {}) {
    const { onWrite, onRead, onIrq } = hooks;
    assertHook("onWrite", onWrite);
    assertHook("onRead", onRead);
    assertHook("onIrq", onIrq);
    this.hooks = { onWrite, onRead, onIrq };
    this.lastIrqState = undefined;
    this.#syncIrq();
  }

  /**
   * Return the native PCM rate for the requested clock; this does not resample audio.
   * @param {number} [clock] Chip input frequency in Hz.
   * @returns {number} Stereo frames per second.
   */
  sampleRate(clock = YM3526_CLOCK) {
    return this.api.sampleRate(this.handle, clock);
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
    this.#syncIrq();
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

  #syncIrq() {
    if (typeof this.api.getIrq !== "function" || typeof this.hooks.onIrq !== "function") {
      return;
    }

    const asserted = this.getIrq();
    if (this.lastIrqState === asserted) {
      return;
    }

    this.lastIrqState = asserted;
    this.hooks.onIrq(asserted);
  }
}

/**
 * Convenience factory for Ym3526. Does not create an audio device.
 * @param {function(Object): (Object|Promise<Object>)} moduleFactory Generated module factory.
 * @param {Object} [moduleOptions] Emscripten loader settings.
 * @returns {Promise<Ym3526>} Chip instance owned by the caller.
 */
export async function createYm3526(moduleFactory, moduleOptions) {
  return Ym3526.create({ moduleFactory, moduleOptions });
}

function assertHook(name, value) {
  if (value !== undefined && typeof value !== "function") {
    throw new Error(`${name} must be a function when provided`);
  }
}

function optionalCwrap(module, name, returnType, argTypes) {
  const table = module.asm || module;
  const exportedName = `_${name}`;
  if (typeof table[exportedName] !== "function") {
    return undefined;
  }
  return module.cwrap(name, returnType, argTypes);
}

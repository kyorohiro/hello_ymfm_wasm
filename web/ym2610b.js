/**
 * @file ym2610b.js
 * 実行環境: Browser / Node.js
 * 依存: WASM（moduleFactory と moduleOptions で読み込み方法を注入）。
 * チップ操作・PCM 生成に DOM・AudioContext は不要。ローダーは実行環境に合わせて渡す。
 */
export const YM2610B_CLOCK = 8000000;

/**
 * Ym2610B chip instance backed by WASM. No AudioContext or playback device is created.
 * Use create() to initialize and dispose() to release native resources.
 * Register writes program the chip; generateStereo() advances it to produce PCM.
 */
export class Ym2610B {
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
   * Initialize Ym2610B and its native WASM module.
   * The generated module factory is injected so browser and Node callers can choose asset loading.
   * @param {Object} [options={}] Chip and Emscripten initialization settings.
   * @param {function(Object): (Object|Promise<Object>)} options.moduleFactory Generated WASM module factory.
   * @param {Object} [options.moduleOptions] Forwarded loader options, e.g. wasmBinary or locateFile.
   * @param {boolean} [options.variant=true] True for YM2610B; false for YM2610.
   * @returns {Promise<Ym2610B>} Ready-to-use chip; the caller must dispose it.
   */
  static async create({ moduleFactory, moduleOptions, variant = true } = {}) {
    if (!moduleFactory) throw new Error("moduleFactory is required");
    const module = await moduleFactory(moduleOptions ?? {});
    const api = {
      createVariant: module.cwrap("ym2610b_create_variant", "number", ["number"]),
      loadRom: module.cwrap("ym2610b_load_rom", "number", ["number","number","number","number","number","number"]),
      clearRoms: module.cwrap("ym2610b_clear_roms", null, ["number"]),
      mute: module.cwrap("ym2610b_set_source_mute_mask", null, ["number","number"]),
      create: module.cwrap("ym2610b_create", "number", []),
      destroy: module.cwrap("ym2610b_destroy", null, ["number"]),
      reset: module.cwrap("ym2610b_reset", null, ["number"]),
      write: module.cwrap("ym2610b_write", null, ["number", "number", "number"]),
      read: module.cwrap("ym2610b_read", "number", ["number", "number"]),
      readStatus: module.cwrap("ym2610b_read_status", "number", ["number"]),
      readStatusHi: module.cwrap("ym2610b_read_status_hi", "number", ["number"]),
      getIrq: module.cwrap("ym2610b_get_irq", "number", ["number"]),
      sampleRate: module.cwrap("ym2610b_sample_rate", "number", ["number", "number"]),
      generate: module.cwrap("ym2610b_generate", null, ["number", "number", "number", "number"]),
    };
    return new Ym2610B(module, variant ? api.create() : api.createVariant(0), api);
  }

  /**
   * Release native chip state and allocated WASM buffers. Do not use the chip afterward.
   * @returns {void}
   */
  dispose() {
    if (this.leftPtr) this.module._free(this.leftPtr);
    if (this.rightPtr) this.module._free(this.rightPtr);
    this.leftPtr = 0;
    this.rightPtr = 0;
    if (this.handle) this.api.destroy(this.handle);
    this.handle = 0;
  }

  /**
   * Clear loaded ADPCM ROM regions.
   * @returns {void}
   */
  clearAdpcmRoms() { this.api.clearRoms(this.handle); }
  setSourceMuteMask(mask) { this.api.mute(this.handle, mask); }
  loadAdpcmRom(type, bytes, offset = 0, size = offset + bytes.length) {
    if (!(bytes instanceof Uint8Array) || ![0,1].includes(type) ||
      !Number.isInteger(offset) || !Number.isInteger(size) || offset < 0 || size < 0 ||
      size > 0x1000000 || offset > size || bytes.length > size-offset) throw new RangeError('Invalid YM2610 ADPCM ROM range');
    if (!bytes.length) { this.api.loadRom(this.handle,type,size,offset,0,0); return; }
    const ptr = this.module._malloc(bytes.length);
    if (!ptr) throw new Error('ADPCM ROM allocation failed');
    try {
      this.module.HEAPU8.set(bytes,ptr);
      if (!this.api.loadRom(this.handle,type,size,offset,ptr,bytes.length)) throw new Error('ADPCM ROM load failed');
    } finally { this.module._free(ptr); }
  }
  /**
   * Reset synthesis state for a new playback pass. Reapply voice and key registers afterward.
   * @returns {void}
   */
  reset() { this.api.reset(this.handle); }
  /**
   * Write one bus byte. Use the chip register protocol rather than a MIDI channel number.
   * @param {number} offset Native bus address/data port offset.
   * @param {number} data Byte value, 0..255.
   * @returns {void}
   */
  write(offset, data) { this.api.write(this.handle, offset, data); }
  /**
   * Read a chip bus/status value; not a saved copy of all written voice registers.
   * @param {number} offset Native bus offset.
   * @returns {number} Native read result.
   */
  read(offset) { return this.api.read(this.handle, offset); }
  /**
   * Read the primary status byte.
   * @returns {number} Status flags from the native core.
   */
  readStatus() { return this.api.readStatus(this.handle); }
  /**
   * Read the secondary status byte.
   * @returns {number} Secondary status flags from the native core.
   */
  readStatusHi() { return this.api.readStatusHi(this.handle); }
  /**
   * Read the current native interrupt line state.
   * @returns {boolean} True when IRQ is asserted. Requires a runtime with IRQ support.
   */
  getIrq() { return this.api.getIrq(this.handle) !== 0; }
  /**
   * Return the native PCM rate for the requested clock; this does not resample audio.
   * @param {number} [clock] Chip input frequency in Hz.
   * @returns {number} Stereo frames per second.
   */
  sampleRate(clock = YM2610B_CLOCK) { return this.api.sampleRate(this.handle, clock); }

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
    return {
      left: Float32Array.from(this.module.HEAPF32.subarray(leftStart, leftStart + frames)),
      right: Float32Array.from(this.module.HEAPF32.subarray(rightStart, rightStart + frames)),
    };
  }

  #ensureBuffers(frames) {
    if (!Number.isInteger(frames) || frames < 0 || frames > 0x1000000) {
      throw new RangeError("Invalid frame count");
    }
    if (frames <= this.bufferFrames) return;
    if (this.leftPtr) this.module._free(this.leftPtr);
    if (this.rightPtr) this.module._free(this.rightPtr);
    const size = frames * Float32Array.BYTES_PER_ELEMENT;
    this.leftPtr = this.module._malloc(size);
    this.rightPtr = this.module._malloc(size);
    this.bufferFrames = frames;
  }
}

/**
 * Convenience factory for Ym2610B. Does not create an audio device.
 * @param {function(Object): (Object|Promise<Object>)} moduleFactory Generated module factory.
 * @param {Object} [moduleOptions] Emscripten loader settings.
 * @returns {Promise<Ym2610B>} Chip instance owned by the caller.
 */
export async function createYm2610B(moduleFactory, moduleOptions) {
  return Ym2610B.create({ moduleFactory, moduleOptions });
}

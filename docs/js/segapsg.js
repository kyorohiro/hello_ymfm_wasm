/**
 * @file segapsg.js
 * 実行環境: Browser / Node.js
 * 依存: WASM（moduleFactory と moduleOptions で読み込み方法を注入）。
 * チップ操作・PCM 生成に DOM・AudioContext は不要。ローダーは実行環境に合わせて渡す。
 */
export const SEGAPSG_CLOCK = 3579545;
export const SEGAPSG_SAMPLE_RATE = 44100;

/**
 * SegaPSG chip instance backed by WASM. No AudioContext or playback device is created.
 * Use create() to initialize and dispose() to release native resources.
 * Register writes program the chip; generateStereo() advances it to produce PCM.
 */
export class SegaPSG {
  #states = new WeakMap();
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
    this.muteMask = 0;
  }

  /**
   * Initialize SegaPSG and its native WASM module.
   * The generated module factory is injected so browser and Node callers can choose asset loading.
   * @param {Object} [options={}] Chip and Emscripten initialization settings.
   * @param {import('./soundchip.js?v=native-extra-huc6280-1').WasmModuleFactory} options.moduleFactory Generated WASM module factory.
   * @param {import('./soundchip.js?v=native-extra-huc6280-1').WasmModuleOptions} [options.moduleOptions] Forwarded loader options, e.g. wasmBinary or locateFile.
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
      create: bindNumericExport(module, "segapsg_create", "number", ["number", "number"]),
      destroy: bindNumericExport(module, "segapsg_destroy", null, ["number"]),
      reset: bindNumericExport(module, "segapsg_reset", null, ["number"]),
      write: bindNumericExport(module, "segapsg_write", null, ["number", "number"]),
      setStereo: bindNumericExport(module, "segapsg_set_stereo", null, ["number", "number"]),
      setMuteMask: bindNumericExport(module, "segapsg_set_mute_mask", null, ["number", "number"]),
      sampleRate: bindNumericExport(module, "segapsg_sample_rate", "number", ["number"]),
      generate: bindNumericExport(module, "segapsg_generate", null, ["number", "number", "number", "number"]),
    };

    const handle = api.create(sampleRate, clock);
    return new SegaPSG(module, handle, api);
  }

  supportsState() { return !!this.handle && typeof this.module._segapsg_save_state === 'function' && typeof this.module._segapsg_load_state === 'function'; }

  // Opaque, same-instance, same-build state. Output buffers and hooks are not state.
  saveState() {
    if (!this.supportsState()) throw new Error('State saving unavailable');
    const size = this.module._segapsg_save_state(this.handle, 0);
    const ptr = this.module._malloc(size);
    if (!ptr) throw new Error('State allocation failed');
    try {
      this.module._segapsg_save_state(this.handle, ptr);
      const bytes = new Uint8Array(this.module.HEAPF32.buffer, ptr, size).slice();
      const state = Object.freeze({byteLength: size}); this.#states.set(state, bytes); return state;
    } finally { this.module._free(ptr); }
  }
  validateState(state) {
    if (!this.supportsState() || !this.#states.has(state)) throw new Error('Invalid or foreign chip state');
  }
  loadState(state) {
    this.validateState(state);
    const bytes = this.#states.get(state), ptr = this.module._malloc(bytes.length);
    if (!ptr) throw new Error('State allocation failed');
    try {
      new Uint8Array(this.module.HEAPF32.buffer, ptr, bytes.length).set(bytes);
      if (!this.module._segapsg_load_state(this.handle, ptr, bytes.length)) throw new Error('Invalid native state');
    } finally { this.module._free(ptr); }
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

  /** Game Gear routing: bits 0..3 right, bits 4..7 left; 0xff is mono. */
  setStereo(mask) {
    if (!Number.isInteger(mask) || mask < 0 || mask > 255) throw new RangeError('PSG stereo mask must be 0..255');
    this.api.setStereo(this.handle, mask);
  }

  /** Mute Tone 1–3 / Noise (0–3) without changing registers or oscillator state. */
  setChannelMuted(channel, muted) {
    if (!Number.isInteger(channel) || channel < 0 || channel > 3) throw new RangeError('Invalid Sega PSG channel');
    this.muteMask = muted ? this.muteMask | (1 << channel) : this.muteMask & ~(1 << channel);
    this.api.setMuteMask(this.handle, this.muteMask);
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

  /**
   * Reserve PCM capacity without advancing the chip (for realtime initialization).
   * @param {number} frames Maximum expected stereo frame count.
   * @returns {void}
   */
  reserveStereoFrames(frames) {
    this.#ensureBuffers(frames);
  }

  /**
   * Generate borrowed views of WASM PCM, reusing arrays and the result object.
   * Read only the first `frames` entries; array length is reserved capacity.
   * Consume immediately: generation, buffer growth, or disposal invalidates the data.
   * Do not retain/mutate these views. Use generateStereo() for owned copies.
   * @param {number} frames Nonnegative integer frame count, up to 16777216.
   * @returns {{left: Float32Array, right: Float32Array}} Borrowed PCM views.
   */
  generateStereoView(frames) {
    this.#ensureBuffers(frames);
    this.api.generate(this.handle, this.leftPtr, this.rightPtr, frames);
    const buffer = this.module.HEAPF32.buffer;
    const view = this.pcmView;
    if (!view || view.left.buffer !== buffer ||
        view.left.byteOffset !== this.leftPtr || view.right.byteOffset !== this.rightPtr ||
        view.left.length !== this.bufferFrames) {
      this.pcmView = {
        left: new Float32Array(buffer, this.leftPtr, this.bufferFrames),
        right: new Float32Array(buffer, this.rightPtr, this.bufferFrames),
      };
    }
    return this.pcmView;
  }

  /** @param {number} frames */
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

/**
 * Numeric-only ABI calls need no cwrap argument/return conversion. Keep the
 * generated Module export (including its assertions), bound once for render use.
 * Older injected module factories can still provide cwrap without direct exports.
 * @param {Object} module Initialized Emscripten module.
 * @param {string} name Native function name without the export underscore.
 * @param {string|null} returnType Emscripten return type; null for void.
 * @param {string[]} argTypes Emscripten numeric argument types.
 * @returns {(...args: number[]) => number} Bound numeric native callable (void returns are ignored).
 */
function bindNumericExport(module, name, returnType, argTypes) {
  const direct = module[`_${name}`];
  return typeof direct === "function"
    ? direct.bind(module)
    : module.cwrap(name, returnType, argTypes);
}

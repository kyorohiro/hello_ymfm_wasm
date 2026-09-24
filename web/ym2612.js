/**
 * Low-level YM2612 WASM wrapper shared by browser and Node callers.
 * It performs synchronous register I/O and offline PCM generation, without
 * scheduling playback or creating an audio device. For note/preset helpers,
 * connect this chip to YM2612Synth using YM2612DirectTransport.
 * @module
 */

/**
 * @typedef {Object} Ym2612ModuleOptions
 * @property {Uint8Array} [wasmBinary] Preloaded WASM bytes; Node Buffers are accepted.
 * @property {function(string, string): string} [locateFile]
 * Resolve an asset filename and loader prefix to its URL or filesystem path.
 * Other Emscripten module options are also passed through to the factory.
 */

/**
 * @callback Ym2612ModuleFactory
 * @param {Ym2612ModuleOptions} options Emscripten initialization options.
 * @returns {Object|Promise<Object>} Initialized module with cwrap, heap and allocation APIs.
 */

/**
 * @typedef {Object} Ym2612StereoPcm
 * @property {Float32Array} left Left PCM samples, copied out of WASM memory.
 * @property {Float32Array} right Right PCM samples, copied out of WASM memory.
 */

/**
 * @typedef {Object} Ym2612Hooks
 * @property {function({offset: number, data: number}): void} [onWrite]
 * Called after each bus write, with offset 0..3 and the supplied data byte.
 * @property {function({offset: number, value: number}): void} [onRead]
 * Called after each bus/status read, with the returned value.
 * @property {function(boolean): void} [onIrq]
 * Called with the current IRQ state when installed, then when a checked state changes.
 */

/** Default YM2612 input clock in Hz; this is not the PCM sample rate. @type {number} */
export const YM2612_CLOCK = 7670454;

/**
 * One mutable YM2612 emulation instance and its reusable WASM output buffers.
 * Create with {@link Ym2612.create} or {@link createYm2612}, and dispose when done.
 * Generation advances chip state; register writes alone do not render audio.
 */
export class Ym2612 {
  /**
   * Wrap an already allocated native chip. Prefer create() for normal use.
   * @param {Object} module Initialized Emscripten module.
   * @param {number} handle Native chip pointer owned by this instance.
   * @param {Object<string, Function>} api Bound native exports from create().
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
    this.envPtrs = [0, 0, 0, 0];
    this.bufferFrames = 0;
  }

  /**
   * Load the YM2612 WASM module and create a chip instance.
   * This creates the emulation core only, not an AudioContext, AudioWorklet,
   * or YM2612Synth. Use generateStereo() to generate PCM at sampleRate(),
   * and call dispose() when finished to release WASM resources.
   *
   * @param {object} [options={}] Initialization options; moduleFactory is required.
   * @param {Ym2612ModuleFactory} options.moduleFactory
   *   Default export of the generated ym2612_wasm.js Emscripten module.
   * @param {object} [options.moduleOptions] Options passed unchanged to moduleFactory.
   * @param {Uint8Array} [options.moduleOptions.wasmBinary]
   *   Preloaded WASM bytes (for example, a Buffer from node:fs/promises readFile).
   *   If omitted, the generated module uses its default WASM loading mechanism.
   * @param {function(string, string): string} [options.moduleOptions.locateFile]
   *   Resolve an asset path and loader prefix to a URL or filesystem path,
   *   when the WASM asset is hosted separately from the generated JavaScript.
   * @returns {Promise<Ym2612>} A chip ready for register writes and PCM generation.
   * @throws {Error} Rejects if moduleFactory is missing or module initialization fails.
   * @example
   * const chip = await Ym2612.create({ moduleFactory: ym2612ModuleFactory });
   * try {
   *   // Configure registers before generating sound.
   *   const pcm = chip.generateStereo(1024);
   * } finally {
   *   chip.dispose();
   * }
   */
  static async create(options = {}) {
    const { moduleFactory, moduleOptions } = options;
    if (!moduleFactory) {
      throw new Error("moduleFactory is required");
    }

    const module = await moduleFactory(moduleOptions || {});
    const api = {
      create: module.cwrap("ym2612_create", "number", []),
      destroy: module.cwrap("ym2612_destroy", null, ["number"]),
      reset: module.cwrap("ym2612_reset", null, ["number"]),
      write: module.cwrap("ym2612_write", null, ["number", "number", "number"]),
      read: optionalCwrap(module, "ym2612_read", "number", ["number", "number"]),
      readStatus: optionalCwrap(module, "ym2612_read_status", "number", ["number"]),
      getIrq: optionalCwrap(module, "ym2612_get_irq", "number", ["number"]),
      sampleRate: module.cwrap("ym2612_sample_rate", "number", ["number", "number"]),
      generate: module.cwrap("ym2612_generate", null, ["number", "number", "number", "number"]),
      generateWithInternalEnvelope: module.cwrap(
        "ym2612_generate_with_internal_envelope",
        null,
        ["number", "number", "number", "number", "number", "number", "number", "number", "number"]
      ),
    };

    const handle = api.create();
    return new Ym2612(module, handle, api);
  }

  /**
   * Free the chip and its WASM buffers. Repeated disposal is safe.
   * Previously returned PCM arrays remain valid because they are copies.
   * Do not read, write, reset or generate with this instance afterward.
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
    this.envPtrs.forEach((ptr, index) => {
      if (ptr) {
        this.module._free(ptr);
        this.envPtrs[index] = 0;
      }
    });
    if (this.handle) {
      this.api.destroy(this.handle);
      this.handle = 0;
    }
  }

  /**
   * Reset native registers and synthesis state, then check IRQ state.
   * Retains installed hooks and allocated output buffers. Reapply your voice
   * and frequency settings before generating the next sound.
   * @returns {void}
   */
  reset() {
    this.api.reset(this.handle);
    this.#syncIrq();
  }

  /**
   * Write one YM2612 bus byte, not a register/value pair.
   * Offsets: 0 = bank 0 address, 1 = bank 0 data,
   * 2 = bank 1 address, 3 = bank 1 data. Use writeRegister() for a pair.
   * Calls onWrite synchronously and checks IRQ after the write.
   * @param {number} offset Bus offset, 0..3.
   * @param {number} data Byte, 0..255. Values are passed to the native core.
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
   * Read a bus offset using the core's YM2612 read semantics.
   * This is not arbitrary register readback; keep a separate register shadow
   * if you need to inspect previously written voice parameters.
   * Calls onRead synchronously and checks IRQ.
   * @param {number} offset Bus offset, 0..3.
   * @returns {number} Native read result as an unsigned byte.
   * @throws {Error} If the loaded WASM runtime has no read export.
   */
  read(offset) {
    if (typeof this.api.read !== "function") {
      throw new Error("This YM2612 runtime does not support read(offset). Rebuild or reload the generated wasm runtime.");
    }
    const value = this.api.read(this.handle, offset);
    if (typeof this.hooks.onRead === "function") {
      this.hooks.onRead({ offset, value });
    }
    this.#syncIrq();
    return value;
  }

  /**
   * Read native status (including timer flags) and notify onRead at offset 0.
   * Falls back to read(0) when the dedicated status export is unavailable.
   * @returns {number} Status byte; interpretation follows the native core.
   * @throws {Error} If neither status nor bus reading is available.
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
   * Query whether the native IRQ line is asserted, without notifying hooks.
   * @returns {boolean} True when IRQ is asserted.
   * @throws {TypeError} If the loaded runtime lacks the optional IRQ export.
   */
  getIrq() {
    return this.api.getIrq(this.handle) !== 0;
  }

  /**
   * Replace all observation callbacks; omitted callbacks are removed.
   * Call with no arguments to clear them. Callbacks run synchronously and
   * their exceptions propagate. IRQ is checked after writes, reads, reset
   * and generation; this is not a per-sample IRQ trace during generation.
   * @param {Ym2612Hooks} [hooks={}] Optional observers, each a function or undefined.
   * @returns {void}
   * @throws {Error} If a supplied observer is not a function.
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
   * Write an address byte followed by a data byte to one register bank.
   * Unlike write(), port denotes the bank, not a bus offset.
   * Triggers two onWrite callbacks through write().
   * @param {number} register Register address within the bank, 0..255.
   * @param {number} value Register data byte, 0..255.
   * @param {number} [port=0] Bank 0 or 1 (implementation maps any nonzero value to 1).
   * @returns {void}
   */
  writeRegister(register, value, port = 0) {
    const addressOffset = port === 0 ? 0 : 2;
    const dataOffset = addressOffset + 1;
    this.write(addressOffset, register);
    this.write(dataOffset, value);
  }

  /**
   * Query the native PCM frame rate for an input clock in Hz.
   * Does not resample, configure an AudioContext or change the output buffers.
   * Interpret generated PCM at this rate; resample separately if you need 44.1 kHz.
   * @param {number} [clock=YM2612_CLOCK] Positive chip input clock in Hz.
   * @returns {number} Native stereo frames per second for the supplied clock.
   */
  sampleRate(clock = YM2612_CLOCK) {
    return this.api.sampleRate(this.handle, clock);
  }

  /**
   * Synchronously advance the chip and generate stereo PCM without real-time waits.
   * One frame contains one left and one right sample. The native wrapper
   * clips integer output to 16-bit range and divides by 32768.
   * Returned arrays are independent copies, safe across later generation/disposal.
   * Large requests allocate WASM buffers plus JS copies; use chunks for long audio.
   * @param {number} frames Integer frame count, 0..16777216 inclusive.
   * @returns {Ym2612StereoPcm} Two arrays of length frames, at sampleRate().
   * @throws {RangeError} If frames is not an integer in the supported range.
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

  /**
   * Generate full-chip stereo PCM and four envelope traces for one physical channel.
   * Advances synthesis just like generateStereo(); this is not a read-only peek.
   * Envelope arrays use register slot order (+0, +4, +8, +12), not algorithm
   * signal-flow order. Each value is 1 - min(attenuation, 1023) / 1023:
   * an internal attenuation visualization, not linear gain, RMS or operator audio.
   * All returned arrays are copies independent of the WASM heap.
   * @param {number} frames Integer frame count, 0..16777216 inclusive.
   * @param {number} [channel=0] Physical channel index 0..5 (CH1..CH6).
   * @returns {{left: Float32Array, right: Float32Array, envelopes: Float32Array[]}}
   * Full stereo mix plus four arrays of length frames for the selected channel.
   * @throws {RangeError} If frames is outside the supported integer range.
   */
  generateStereoWithInternalEnvelope(frames, channel = 0) {
    this.#ensureBuffers(frames);
    this.api.generateWithInternalEnvelope(
      this.handle,
      this.leftPtr,
      this.rightPtr,
      this.envPtrs[0],
      this.envPtrs[1],
      this.envPtrs[2],
      this.envPtrs[3],
      frames,
      channel
    );

    const leftStart = this.leftPtr >> 2;
    const rightStart = this.rightPtr >> 2;
    const left = new Float32Array(frames);
    const right = new Float32Array(frames);
    left.set(this.module.HEAPF32.subarray(leftStart, leftStart + frames));
    right.set(this.module.HEAPF32.subarray(rightStart, rightStart + frames));

    const envelopes = this.envPtrs.map((ptr) => {
      const start = ptr >> 2;
      const values = new Float32Array(frames);
      values.set(this.module.HEAPF32.subarray(start, start + frames));
      return values;
    });

    this.#syncIrq();
    return { left, right, envelopes };
  }

  /**
   * Grow reusable stereo/envelope WASM buffers as needed; never shrink them here.
   * @param {number} frames Requested frame capacity; validated before allocation.
   * @returns {void}
   * @throws {RangeError} For invalid frame counts.
   */
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
    this.envPtrs.forEach((ptr) => {
      if (ptr) {
        this.module._free(ptr);
      }
    });

    const byteLength = frames * Float32Array.BYTES_PER_ELEMENT;
    this.leftPtr = this.module._malloc(byteLength);
    this.rightPtr = this.module._malloc(byteLength);
    this.envPtrs = this.envPtrs.map(() => this.module._malloc(byteLength));
    this.bufferFrames = frames;
  }

  /**
   * Notify the IRQ observer on first check or a changed line state.
   * Does nothing if the observer or native IRQ export is unavailable.
   * @returns {void}
   */
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
 * Convenience form of Ym2612.create({ moduleFactory, moduleOptions }).
 * Returns the chip only; it does not create a Synth, AudioWorklet or audio device.
 * The caller owns the instance and must call dispose() when finished.
 * @param {Ym2612ModuleFactory} moduleFactory Generated ym2612_wasm.js default export.
 * @param {Ym2612ModuleOptions} [moduleOptions] WASM bytes, asset resolver or other loader options.
 * @returns {Promise<Ym2612>} Initialized native chip wrapper.
 * @throws {Error} Rejects when initialization fails or the factory is missing.
 * @example
 * const chip = await createYm2612(ym2612ModuleFactory);
 */
export async function createYm2612(moduleFactory, moduleOptions) {
  return Ym2612.create({ moduleFactory, moduleOptions });
}

/**
 * Validate an optional observer without invoking it.
 * @param {string} name Observer name for diagnostics.
 * @param {unknown} value Function or undefined.
 * @returns {void}
 * @throws {Error} If value is neither a function nor undefined.
 */
function assertHook(name, value) {
  if (value !== undefined && typeof value !== "function") {
    throw new Error(`${name} must be a function when provided`);
  }
}

/**
 * Bind a native function only when its Emscripten export exists.
 * @param {Object} module Initialized Emscripten module.
 * @param {string} name Native function name without the export underscore.
 * @param {string|null} returnType Emscripten return type; null for void.
 * @param {string[]} argTypes Emscripten argument types.
 * @returns {Function|undefined} Bound callable, or undefined for an older runtime.
 */
function optionalCwrap(module, name, returnType, argTypes) {
  const exportName = `_${name}`;
  if (typeof module[exportName] !== "function") {
    return undefined;
  }
  return module.cwrap(name, returnType, argTypes);
}

/**
 * Accurate SNES SPC playback and DSP-only synthesis. No DOM or audio device.
 * PCM is stereo Float32 at the fixed native rate of 32,000 frames/second.
 * Supply the generated spc_wasm module factory; resample at the output boundary.
 */
export const SPC_SAMPLE_RATE = 32000;
/** @typedef {{moduleFactory:(options?:{wasmBinary?:Uint8Array|ArrayBuffer})=>any,
 * moduleOptions?:{wasmBinary?:Uint8Array|ArrayBuffer}}} SpcCoreOptions */
const MAX_FILE_BYTES = 16 * 1024 * 1024;
const BLOCK_FRAMES = 1024;

function integer(value, name, min, max) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new RangeError(`${name} must be an integer from ${min} to ${max}`);
  }
  return value;
}
function bytesOf(value) {
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  throw new TypeError('Expected an ArrayBuffer or typed array');
}

class Core {
  /** @param {any} module @param {number} handle */
  constructor(module, handle) {
    this.module = module;
    this.handle = handle;
    this.sampleRate = SPC_SAMPLE_RATE;
    this._heapBuffer = null;
    this._left = null;
    this._right = null;
    this._syncViews();
  }
  static async _create(options = {}, dspOnly = false) {
    const { moduleFactory, moduleOptions } = options;
    if (typeof moduleFactory !== 'function') throw new TypeError('moduleFactory is required');
    const module = await moduleFactory({ ...moduleOptions });
    const handle = module._spc_create(dspOnly ? 1 : 0);
    if (!handle) throw new Error('SPC core initialization failed');
    return new this(module, handle);
  }
  _assertOpen() {
    if (!this.handle) throw new Error('SPC core has been disposed');
  }
  _syncViews() {
    const buffer = this.module.HEAPU8.buffer;
    if (buffer !== this._heapBuffer) {
      this._heapBuffer = buffer;
      this._left = new Float32Array(buffer, this.module._spc_left_ptr(this.handle), BLOCK_FRAMES);
      this._right = new Float32Array(buffer, this.module._spc_right_ptr(this.handle), BLOCK_FRAMES);
    }
  }
  _check(result) {
    if (!result) throw new Error(this.module.UTF8ToString(this.module._spc_error(this.handle)) || 'SPC operation failed');
  }
  _withBytes(bytes, callback) {
    this._assertOpen();
    const ptr = this.module._malloc(Math.max(bytes.length, 1));
    if (!ptr) throw new Error('SPC input allocation failed');
    try {
      this.module.HEAPU8.set(bytes, ptr);
      return callback(ptr);
    } finally { this.module._free(ptr); this._syncViews(); }
  }
  /** Total native 32 kHz sample pairs rendered since load/reset. @returns {number} */
  get nativeFrames() {
    this._assertOpen();
    return this.module._spc_native_frames(this.handle);
  }
  /**
   * Write native stereo frames into caller-owned arrays. The offset is an output
   * array index, not a source-file position or audio-clock reservation.
   * No temporary PCM arrays are allocated once WASM memory has stopped growing.
   * @param {Float32Array} left @param {Float32Array} right
   * @param {number} [frames] @param {number} [offset]
   */
  renderInto(left, right, frames = Math.min(left?.length ?? 0, right?.length ?? 0), offset = 0) {
    this._assertOpen();
    if (!(left instanceof Float32Array) || !(right instanceof Float32Array)) {
      throw new TypeError('left and right must be Float32Array');
    }
    integer(offset, 'offset', 0, Math.min(left.length, right.length));
    integer(frames, 'frames', 0, Math.min(left.length, right.length) - offset);
    if (left.buffer === this.module.HEAPU8.buffer || right.buffer === this.module.HEAPU8.buffer) {
      throw new TypeError('Output arrays must not alias WASM memory');
    }
    for (let written = 0; written < frames;) {
      const count = Math.min(BLOCK_FRAMES, frames - written);
      this._check(this.module._spc_render(this.handle, count));
      this._syncViews();
      for (let i = 0; i < count; i++) {
        left[offset + written + i] = this._left[i];
        right[offset + written + i] = this._right[i];
      }
      written += count;
    }
  }
  /**
   * Bits 0..7 select muted voices. Oscillators, envelopes, BRR and pitch
   * modulation keep advancing. Existing echo tails remain audible; newly mixed
   * dry output and echo sends from these voices are suppressed. No KOFF injected.
   * Samples already queued inside the upstream core are not rewritten.
   * @param {number} mask
   */
  setMuteMask(mask) {
    this._assertOpen();
    integer(mask, 'mask', 0, 255);
    this.module._spc_set_mute_mask(this.handle, mask);
  }
  /** Atomic copied analysis data, not a complete restorable emulator state.
   * @returns {{ram:Uint8Array,dsp:Uint8Array,nativeFrames:number}} */
  snapshot() {
    this._assertOpen();
    const ptr = this.module._spc_snapshot_ptr(this.handle);
    const heap = this.module.HEAPU8;
    return {
      ram: heap.slice(ptr + 0x100, ptr + 0x10100),
      dsp: heap.slice(ptr + 0x10100, ptr + 0x10180),
      nativeFrames: this.nativeFrames,
    };
  }
  /** Release this instance only. Idempotent. */
  dispose() {
    if (!this.handle) return;
    this.module._spc_destroy(this.handle);
    this.handle = 0;
    this._heapBuffer = this._left = this._right = null;
  }
}

export class SpcCore extends Core {
  /** @param {SpcCoreOptions} options @returns {Promise<SpcCore>} */
  static async create(options) { return /** @type {SpcCore} */ (await this._create(options, false)); }
  /** Load an SPC snapshot and reset nativeFrames. Failed validation preserves playback.
   * @param {ArrayBuffer|ArrayBufferView} value */
  load(value) {
    const bytes = bytesOf(value);
    integer(bytes.length, 'SPC byte length', 0x10180, MAX_FILE_BYTES);
    this._withBytes(bytes, ptr => this._check(this.module._spc_load(this.handle, ptr, bytes.length)));
  }
  /** Reload the original snapshot, including its original echo RAM. Keeps mute mask. */
  restart() {
    this._assertOpen();
    try { this._check(this.module._spc_restart(this.handle)); }
    finally { this._syncViews(); }
  }
  reset() { this.restart(); }
}
export { SpcCore as SpcPlayerCore };

/** DSP-only core for authored BRR instruments; no SPC700 CPU or driver runs. */
export class SnesDspCore extends Core {
  /** @param {SpcCoreOptions} options @returns {Promise<SnesDspCore>} */
  static async create(options) { return /** @type {SnesDspCore} */ (await this._create(options, true)); }
  /** Clear RAM and reset DSP registers, keeping the output mute mask. */
  reset() { this._assertOpen(); this._check(this.module._spc_restart(this.handle)); }
  /** @param {ArrayBuffer|ArrayBufferView} value @param {number} [offset] */
  loadRam(value, offset = 0) {
    const bytes = bytesOf(value);
    integer(offset, 'RAM offset', 0, 65536);
    integer(bytes.length, 'RAM byte length', 0, 65536 - offset);
    this._withBytes(bytes, ptr => this._check(this.module._spc_load_ram(this.handle, ptr, bytes.length, offset)));
  }
  /** @param {number} reg @param {number} value */
  writeDsp(reg, value) {
    this._assertOpen(); integer(reg, 'DSP register', 0, 127); integer(value, 'DSP value', 0, 255);
    this.module._spc_write_dsp(this.handle, reg, value);
  }
  /** @param {number} reg @returns {number} */
  readDsp(reg) {
    this._assertOpen(); integer(reg, 'DSP register', 0, 127);
    return this.module._spc_read_dsp(this.handle, reg);
  }
}

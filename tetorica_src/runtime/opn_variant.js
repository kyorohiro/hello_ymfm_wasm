/**
 * @file Shared low-level binding for YM3438 / YMF276 / YMF288.
 * 実行環境: Browser / Node.js。依存: 注入された WASM moduleFactory。
 * DOM・Web Audio は不要。
 */

/**
 * @typedef {Object} OpnVariantApi
 * @property {() => number} create
 * @property {(handle: number) => void} destroy
 * @property {(handle: number) => void} reset
 * @property {(handle: number, offset: number, value: number) => void} write
 * @property {(handle: number, offset: number) => number} read
 * @property {(handle: number) => number} readStatus
 * @property {(handle: number) => number} getIrq
 * @property {(handle: number, clock: number) => number} sampleRate
 * @property {(handle: number, left: number, right: number, frames: number) => void} generate
 */

/** Native chip lifecycle and synchronous PCM generation. Prefer a named chip's create(). */
export class OpnVariant {
  /**
   * @param {Object} module Initialized Emscripten module.
   * @param {number} clock Default input clock, Hz.
   */
  constructor(module, clock) {
    this.module = module;
    this.clock = clock;
    /** @type {OpnVariantApi} */
    this.api = {
      create: module.cwrap('opn_create', 'number', []),
      destroy: module.cwrap('opn_destroy', null, ['number']),
      reset: module.cwrap('opn_reset', null, ['number']),
      write: module.cwrap('opn_write', null, ['number', 'number', 'number']),
      read: module.cwrap('opn_read', 'number', ['number', 'number']),
      readStatus: module.cwrap('opn_read_status', 'number', ['number']),
      getIrq: module.cwrap('opn_get_irq', 'number', ['number']),
      sampleRate: module.cwrap('opn_sample_rate', 'number', ['number', 'number']),
      generate: module.cwrap('opn_generate', null, ['number', 'number', 'number', 'number']),
    };
    this.handle = this.api.create();
    if (!this.handle) throw new Error('Could not allocate OPN chip');
    this.ptr = 0;
    this.capacity = 0;
  }
  /** @private */
  assertAlive() { if (!this.handle) throw new Error('OPN chip is disposed'); }
  /** Reset registers and synthesis state; reapply presets afterward. @returns {void} */
  reset() { this.assertAlive(); this.api.reset(this.handle); }
  /** Release native resources. Repeated disposal is safe. @returns {void} */
  dispose() {
    if (this.ptr) this.module._free(this.ptr);
    if (this.handle) this.api.destroy(this.handle);
    this.ptr = this.handle = this.capacity = 0;
  }
  /**
   * Write one bus byte (even offsets select a register, odd offsets write its data).
   * @param {number} offset Bus port, 0..3.
   * @param {number} value Byte, 0..255.
   * @returns {void}
   */
  write(offset, value) {
    this.assertAlive();
    integer(offset, 3, 'offset'); integer(value, 255, 'value');
    this.api.write(this.handle, offset, value);
  }
  /**
   * @param {number} offset Bus port, 0..3 (not an arbitrary register address).
   * @returns {number} Chip read result.
   */
  read(offset) { this.assertAlive(); integer(offset, 3, 'offset'); return this.api.read(this.handle, offset); }
  /** @returns {number} Native status flags. */
  readStatus() { this.assertAlive(); return this.api.readStatus(this.handle); }
  /** @returns {boolean} Current IRQ state. */
  getIrq() { this.assertAlive(); return this.api.getIrq(this.handle) !== 0; }
  /**
   * Calculate output frames/second; does not resample or change the chip clock.
   * @param {number} [clock=this.clock] Positive integer input clock in Hz.
   * @returns {number} Native PCM sample rate.
   */
  sampleRate(clock = this.clock) {
    this.assertAlive(); integer(clock, 0xffffffff, 'clock');
    if (!clock) throw new RangeError('clock must be positive');
    return this.api.sampleRate(this.handle, clock);
  }
  /**
   * Advance synthesis and copy PCM out of WASM memory.
   * @param {number} frames Integer stereo frame count, 0..16777216.
   * @returns {{left: Float32Array, right: Float32Array}} Owned arrays surviving later calls/disposal.
   */
  generateStereo(frames) {
    this.assertAlive(); integer(frames, 0x1000000, 'frames');
    if (frames > this.capacity) {
      const ptr = this.module._malloc(frames * 8);
      if (!ptr) throw new Error('OPN PCM allocation failed');
      if (this.ptr) this.module._free(this.ptr);
      this.ptr = ptr; this.capacity = frames;
    }
    if (!frames) return {left: new Float32Array(), right: new Float32Array()};
    const rightPtr = this.ptr + this.capacity * 4;
    this.api.generate(this.handle, this.ptr, rightPtr, frames);
    const heap = this.module.HEAPF32;
    return {
      left: heap.slice(this.ptr / 4, this.ptr / 4 + frames),
      right: heap.slice(rightPtr / 4, rightPtr / 4 + frames),
    };
  }
}

function integer(value, max, name) {
  if (!Number.isInteger(value) || value < 0 || value > max) throw new RangeError(`Invalid ${name}`);
}

// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026, kyorohiro.
/** Experimental CPU-free MAME-derived PlayStation SPU. Browser / Worker / Node.
 * The caller injects a generated WASM factory; no AudioContext, BIOS or CPU is created.
 * See docs/ps1_spu.md for upstream accuracy limits and supported register modes.
 */
export const PS1_SPU_SAMPLE_RATE = 44100;
export const PS1_SPU_RAM_BYTES = 512 * 1024;
export const PS1_SPU_MAX_FRAMES = 1 << 20;

function integer(value, min, max, name) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new RangeError(`${name} must be an integer from ${min} to ${max}`);
  }
  return value;
}
function register(offset) {
  integer(offset, 0, 0x3fe, 'SPU register offset');
  if (offset & 1) throw new RangeError('SPU register offsets must be 16-bit aligned');
  return offset;
}
function range(address, length) {
  integer(address, 0, PS1_SPU_RAM_BYTES, 'SPU RAM address');
  integer(length, 0, PS1_SPU_RAM_BYTES - address, 'SPU RAM length');
}

/** Direct register/RAM/PCM interface to one independently owned SPU instance.
 * Byte offsets are relative to 0x1f801c00, not absolute PS1 bus addresses.
 * Stereo PCM has a fixed native rate of 44,100 Hz. This class does not resample,
 * normalize gain, allocate musical voices or decode PCM files into SPU ADPCM.
 */
export class Ps1Spu {
  #frames = 0;
  /** @param {object} module Initialized generated Emscripten module.
   * @param {number} handle Native instance created by Ps1Spu.create().
   * @param {object} api Bound native functions.
   */
  constructor(module, handle, api) {
    this.module = module;
    this.handle = handle;
    this.api = api;
    this.leftPtr = 0;
    this.rightPtr = 0;
    this.bufferFrames = 0;
  }

  /** Initialize an experimental standalone SPU with 512 KiB RAM and 24 voices.
   * @param {{moduleFactory:import('./soundchip.js?v=pokey-prepare-1').WasmModuleFactory,
   *   moduleOptions?:import('./soundchip.js?v=pokey-prepare-1').WasmModuleOptions}} options
   * @returns {Promise<Ps1Spu>}
   */
  static async create({moduleFactory, moduleOptions}) {
    if (typeof moduleFactory !== 'function') throw new TypeError('moduleFactory is required');
    const module = await moduleFactory(moduleOptions ?? {});
    const api = {
      create:module.cwrap('ps1_spu_create', 'number', []),
      destroy:module.cwrap('ps1_spu_destroy', null, ['number']),
      reset:module.cwrap('ps1_spu_reset', 'number', ['number','number']),
      rate:module.cwrap('ps1_spu_sample_rate', 'number', []),
      write:module.cwrap('ps1_spu_write', 'number', ['number','number','number']),
      read:module.cwrap('ps1_spu_read', 'number', ['number','number']),
      load:module.cwrap('ps1_spu_load_ram', 'number', ['number','number','number','number']),
      readRam:module.cwrap('ps1_spu_read_ram', 'number', ['number','number','number','number']),
      render:module.cwrap('ps1_spu_render', 'number', ['number','number','number','number']),
    };
    if (api.rate() !== PS1_SPU_SAMPLE_RATE) throw new Error('Unexpected SPU native sample rate');
    const handle = api.create();
    if (!handle) throw new Error('SPU creation failed');
    return new Ps1Spu(module, handle, api);
  }

  /** Fixed native PCM output rate. */
  get sampleRate() { return PS1_SPU_SAMPLE_RATE; }

  /** Number of generated native stereo frames since creation/reset. */
  get nativeFrames() { return this.#frames; }
  #open() { if (!this.handle) throw new Error('PS1 SPU is disposed'); }

  /** Reset registers, voices and decoder history. RAM is retained unless requested.
   * @param {{clearRam?:boolean}} [options]
   */
  reset(options = {}) {
    this.#open();
    if (!options || typeof options !== 'object' || Array.isArray(options) ||
        Reflect.ownKeys(options).some(key => key !== 'clearRam')) throw new TypeError('Invalid SPU reset options');
    const {clearRam = false} = options;
    if (typeof clearRam !== 'boolean') throw new TypeError('clearRam must be boolean');
    if (!this.api.reset(this.handle, Number(clearRam))) throw new Error('SPU reset failed');
    this.#frames = 0;
  }

  /** Write an even register byte offset (0..0x3fe) and an unsigned 16-bit value.
   * Unsupported modes are rejected by the standalone core before changing state.
   * @param {number} offset @param {number} value
   */
  write(offset, value) {
    this.#open(); register(offset); integer(value, 0, 65535, 'SPU register value');
    if (!this.api.write(this.handle, offset, value)) throw new RangeError('Unsupported SPU register value or mode');
  }

  /** Read a hardware register view, including live envelope/address/status values.
   * @param {number} offset @returns {number}
   */
  read(offset) {
    this.#open(); register(offset);
    const value = this.api.read(this.handle, offset) >>> 0;
    if (value === 0xffffffff) throw new RangeError('Unsupported SPU register read');
    return value;
  }

  /** Copy raw bytes into SPU RAM and invalidate affected decoder caches.
   * This expects already encoded SPU ADPCM or other raw RAM data, not PCM/WAV.
   * @param {Uint8Array} bytes @param {number} [address=0]
   */
  loadRam(bytes, address = 0) {
    this.#open();
    if (!(bytes instanceof Uint8Array)) throw new TypeError('SPU RAM data must be Uint8Array');
    range(address, bytes.length);
    if (!bytes.length) return;
    // A caller may hand back a view into this module. malloc can grow WASM
    // memory and detach that view, so stabilize it before allocating transfer RAM.
    if (bytes.buffer === this.module.HEAPU8.buffer) bytes = bytes.slice();
    const ptr = this.module._malloc(bytes.length);
    if (!ptr) throw new Error('SPU RAM transfer allocation failed');
    try {
      this.module.HEAPU8.set(bytes, ptr);
      if (!this.api.load(this.handle, address, ptr, bytes.length)) throw new Error('SPU RAM upload failed');
    } finally { this.module._free(ptr); }
  }

  /** Return an owned copy of a RAM range; default is the complete RAM image.
   * @param {number} [address=0] @param {number} [length]
   * @returns {Uint8Array}
   */
  readRam(address = 0, length = PS1_SPU_RAM_BYTES - address) {
    this.#open(); range(address, length);
    if (!length) return new Uint8Array();
    const ptr = this.module._malloc(length);
    if (!ptr) throw new Error('SPU RAM read allocation failed');
    try {
      if (!this.api.readRam(this.handle, address, ptr, length)) throw new Error('SPU RAM read failed');
      return this.module.HEAPU8.slice(ptr, ptr + length);
    } finally { this.module._free(ptr); }
  }

  #reserve(frames) {
    if (frames <= this.bufferFrames) return;
    const left = this.module._malloc(frames * 4);
    if (!left) throw new Error('SPU PCM allocation failed');
    const right = this.module._malloc(frames * 4);
    if (!right) { this.module._free(left); throw new Error('SPU PCM allocation failed'); }
    if (this.leftPtr) this.module._free(this.leftPtr);
    if (this.rightPtr) this.module._free(this.rightPtr);
    this.leftPtr = left; this.rightPtr = right; this.bufferFrames = frames;
  }

  /** Generate native-rate PCM into caller-owned, non-overlapping Float32 views.
   * Invalid destinations/counts are rejected before the SPU advances.
   * @param {Float32Array} left @param {Float32Array} right
   * @param {number} [frames] @param {number} [offset=0]
   */
  renderInto(left, right, frames = left?.length, offset = 0) {
    this.#open();
    if (!(left instanceof Float32Array) || !(right instanceof Float32Array)) throw new TypeError('SPU PCM outputs must be Float32Array');
    integer(frames, 0, PS1_SPU_MAX_FRAMES, 'SPU frame count');
    integer(offset, 0, Math.min(left.length, right.length), 'SPU PCM offset');
    if (frames > Math.min(left.length, right.length) - offset) throw new RangeError('SPU output buffers are too small');
    if (left.buffer === this.module.HEAPU8.buffer || right.buffer === this.module.HEAPU8.buffer) {
      throw new TypeError('SPU output buffers must be owned outside WASM memory');
    }
    if (frames && left.buffer === right.buffer &&
        Math.abs(left.byteOffset - right.byteOffset) < frames * 4) throw new RangeError('SPU output ranges must not overlap');
    if (!Number.isSafeInteger(this.#frames + frames)) throw new RangeError('SPU native frame counter overflow');
    if (!frames) return;
    this.#reserve(frames);
    if (!this.api.render(this.handle, this.leftPtr, this.rightPtr, frames)) throw new Error('SPU rendering failed');
    // Create views after rendering: native allocation may have grown WASM memory.
    left.set(new Float32Array(this.module.HEAPU8.buffer, this.leftPtr, frames), offset);
    right.set(new Float32Array(this.module.HEAPU8.buffer, this.rightPtr, frames), offset);
    this.#frames += frames;
  }

  /** @param {number} frames @returns {{left:Float32Array,right:Float32Array}} */
  generateStereo(frames) {
    this.#open(); integer(frames, 0, PS1_SPU_MAX_FRAMES, 'SPU frame count');
    const left = new Float32Array(frames), right = new Float32Array(frames);
    this.renderInto(left, right, frames);
    return {left, right};
  }

  /** Release this instance. Previously returned arrays remain owned by the caller. */
  dispose() {
    if (this.leftPtr) this.module._free(this.leftPtr);
    if (this.rightPtr) this.module._free(this.rightPtr);
    if (this.handle) this.api.destroy(this.handle);
    this.leftPtr = 0; this.rightPtr = 0; this.handle = 0; this.bufferFrames = 0;
  }
}

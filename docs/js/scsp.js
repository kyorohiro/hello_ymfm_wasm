// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026, kyorohiro.
/** Experimental CPU-free MAME-derived Saturn SCSP. Browser / Worker / Node.
 * Inject the generated WASM factory; no AudioContext, CPU, BIOS or SSF player.
 * See docs/scsp.md for the current PCM verification scope and unsupported modes.
 */
export const SCSP_SAMPLE_RATE = 44100;
export const SCSP_RAM_BYTES = 512 * 1024;
export const SCSP_MAX_FRAMES = 1 << 20;

function integer(value, min, max, name) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new RangeError(`${name} must be an integer from ${min} to ${max}`);
  }
  return value;
}
function register(offset) {
  integer(offset, 0, 0xee2, 'SCSP register offset');
  if (offset & 1) throw new RangeError('SCSP register offsets must be 16-bit aligned');
  return offset;
}
function range(address, length) {
  integer(address, 0, SCSP_RAM_BYTES, 'SCSP RAM address');
  integer(length, 0, SCSP_RAM_BYTES - address, 'SCSP RAM length');
}

/** Synchronous raw register/RAM/PCM API for one independently owned SCSP.
 * Even byte offsets are relative to SCSP register base. PCM8 is signed;
 * PCM16 RAM bytes are big endian. Native output is 44,100 Hz. No resampling,
 * normalization, musical voice allocation or sound-file decoding is added.
 */
export class Scsp {
  #frames = 0;
  /** @param {object} module Initialized generated Emscripten module.
   * @param {number} handle Native instance created by Scsp.create().
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

  /** Initialize an experimental standalone SCSP with 512 KiB RAM and 32 slots.
   * @param {{moduleFactory:import('./soundchip.js?v=pokey-prepare-1').WasmModuleFactory,
   *   moduleOptions?:import('./soundchip.js?v=pokey-prepare-1').WasmModuleOptions}} options
   * @returns {Promise<Scsp>}
   */
  static async create({moduleFactory, moduleOptions}) {
    if (typeof moduleFactory !== 'function') throw new TypeError('moduleFactory is required');
    const options={...(moduleOptions??{})};
    // This pinned loader does not consume wasmBinary in an AudioWorklet.
    // Compile supplied bytes explicitly, then use its supported instantiate hook;
    // never fall back to network/file loading when the caller supplied a binary.
    if(options.wasmBinary!==undefined&&options.instantiateWasm===undefined) {
      const compiled=await WebAssembly.compile(options.wasmBinary);
      options.instantiateWasm=(imports,receive)=>{
        const instance=new WebAssembly.Instance(compiled,imports);receive(instance);return instance.exports;
      };
    }
    const module = await moduleFactory(options);
    const api = {
      create:module.cwrap('scsp_create', 'number', []),
      destroy:module.cwrap('scsp_destroy', null, ['number']),
      reset:module.cwrap('scsp_reset', 'number', ['number','number']),
      rate:module.cwrap('scsp_sample_rate', 'number', []),
      write:module.cwrap('scsp_write', 'number', ['number','number','number','number']),
      read:module.cwrap('scsp_read', 'number', ['number','number']),
      load:module.cwrap('scsp_load_ram', 'number', ['number','number','number','number']),
      readRam:module.cwrap('scsp_read_ram', 'number', ['number','number','number','number']),
      render:module.cwrap('scsp_render', 'number', ['number','number','number','number']),
    };
    if (api.rate() !== SCSP_SAMPLE_RATE) throw new Error('Unexpected SCSP native sample rate');
    const handle = api.create();
    if (!handle) throw new Error('SCSP creation failed');
    return new Scsp(module, handle, api);
  }

  /** Fixed native PCM output rate. */
  get sampleRate() { return SCSP_SAMPLE_RATE; }

  /** Number of generated native stereo frames since creation/reset. */
  get nativeFrames() { return this.#frames; }
  #open() { if (!this.handle) throw new Error('SCSP is disposed'); }

  /** Reset registers, slots, effects and deterministic noise state. RAM is retained unless requested.
   * @param {{clearRam?:boolean}} [options]
   */
  reset(options = {}) {
    this.#open();
    if (!options || typeof options !== 'object' || Array.isArray(options) ||
        Reflect.ownKeys(options).some(key => key !== 'clearRam')) throw new TypeError('Invalid SCSP reset options');
    const {clearRam = false} = options;
    if (typeof clearRam !== 'boolean') throw new TypeError('clearRam must be boolean');
    if (!this.api.reset(this.handle, Number(clearRam))) throw new Error('SCSP reset failed');
    this.#frames = 0;
  }

  /** Write an even register byte offset (0..0xee2) and an unsigned 16-bit value.
   * Unsupported modes are rejected by the standalone core before changing state.
   * Set bits in mask select written bits; an omitted mask writes the full word.
   * @param {number} offset @param {number} value @param {number} [mask=65535]
   */
  write(offset, value, mask = 0xffff) {
    this.#open(); register(offset); integer(value, 0, 65535, 'SCSP register value'); integer(mask, 0, 65535, 'SCSP register mask');
    if (!this.api.write(this.handle, offset, value, mask)) throw new RangeError('Unsupported SCSP register value or mode');
  }

  /** Read a hardware register view, including live envelope/address/status values.
   * @param {number} offset @returns {number}
   */
  read(offset) {
    this.#open(); register(offset);
    const value = this.api.read(this.handle, offset) >>> 0;
    if (value === 0xffffffff) throw new RangeError('Unsupported SCSP register read');
    return value;
  }

  /** Copy raw bytes into SCSP RAM; host bounds are checked before mutation.
   * This expects signed PCM8, big-endian PCM16 or raw RAM bytes, not a WAV container.
   * @param {Uint8Array} bytes @param {number} [address=0]
   */
  loadRam(bytes, address = 0) {
    this.#open();
    if (!(bytes instanceof Uint8Array)) throw new TypeError('SCSP RAM data must be Uint8Array');
    range(address, bytes.length);
    if (!bytes.length) return;
    // A caller may hand back a view into this module. malloc can grow WASM
    // memory and detach that view, so stabilize it before allocating transfer RAM.
    if (bytes.buffer === this.module.HEAPU8.buffer) bytes = bytes.slice();
    const ptr = this.module._malloc(bytes.length);
    if (!ptr) throw new Error('SCSP RAM transfer allocation failed');
    try {
      this.module.HEAPU8.set(bytes, ptr);
      if (!this.api.load(this.handle, address, ptr, bytes.length)) throw new Error('SCSP RAM upload failed');
    } finally { this.module._free(ptr); }
  }

  /** Return an owned copy of a RAM range; default is the complete RAM image.
   * @param {number} [address=0] @param {number} [length]
   * @returns {Uint8Array}
   */
  readRam(address = 0, length = SCSP_RAM_BYTES - address) {
    this.#open(); range(address, length);
    if (!length) return new Uint8Array();
    const ptr = this.module._malloc(length);
    if (!ptr) throw new Error('SCSP RAM read allocation failed');
    try {
      if (!this.api.readRam(this.handle, address, ptr, length)) throw new Error('SCSP RAM read failed');
      return this.module.HEAPU8.slice(ptr, ptr + length);
    } finally { this.module._free(ptr); }
  }

  #reserve(frames) {
    if (frames <= this.bufferFrames) return;
    const left = this.module._malloc(frames * 4);
    if (!left) throw new Error('SCSP PCM allocation failed');
    const right = this.module._malloc(frames * 4);
    if (!right) { this.module._free(left); throw new Error('SCSP PCM allocation failed'); }
    if (this.leftPtr) this.module._free(this.leftPtr);
    if (this.rightPtr) this.module._free(this.rightPtr);
    this.leftPtr = left; this.rightPtr = right; this.bufferFrames = frames;
  }

  /** Preallocate transfer buffers outside a real-time callback. The native
   * core does not allocate during render; this adapter grows WASM transfer
   * storage only for blocks larger than previously prepared.
   * @param {number} frames */
  prepare(frames) {
    this.#open(); integer(frames,0,SCSP_MAX_FRAMES,'SCSP frame count');this.#reserve(frames);
  }

  /** Generate native-rate PCM into caller-owned, non-overlapping Float32 views.
   * Invalid destinations/counts are rejected before the SCSP advances.
   * @param {Float32Array} left @param {Float32Array} right
   * @param {number} [frames] @param {number} [offset=0]
   */
  renderInto(left, right, frames = left?.length, offset = 0) {
    this.#open();
    if (!(left instanceof Float32Array) || !(right instanceof Float32Array)) throw new TypeError('SCSP PCM outputs must be Float32Array');
    integer(frames, 0, SCSP_MAX_FRAMES, 'SCSP frame count');
    integer(offset, 0, Math.min(left.length, right.length), 'SCSP PCM offset');
    if (frames > Math.min(left.length, right.length) - offset) throw new RangeError('SCSP output buffers are too small');
    if (left.buffer === this.module.HEAPU8.buffer || right.buffer === this.module.HEAPU8.buffer) {
      throw new TypeError('SCSP output buffers must be owned outside WASM memory');
    }
    if (frames && left.buffer === right.buffer &&
        Math.abs(left.byteOffset - right.byteOffset) < frames * 4) throw new RangeError('SCSP output ranges must not overlap');
    if (!Number.isSafeInteger(this.#frames + frames)) throw new RangeError('SCSP native frame counter overflow');
    if (!frames) return;
    this.#reserve(frames);
    if (!this.api.render(this.handle, this.leftPtr, this.rightPtr, frames)) throw new Error('SCSP rendering failed');
    // Create views after rendering: native allocation may have grown WASM memory.
    left.set(new Float32Array(this.module.HEAPU8.buffer, this.leftPtr, frames), offset);
    right.set(new Float32Array(this.module.HEAPU8.buffer, this.rightPtr, frames), offset);
    this.#frames += frames;
  }

  /** @param {number} frames @returns {{left:Float32Array,right:Float32Array}} */
  generateStereo(frames) {
    this.#open(); integer(frames, 0, SCSP_MAX_FRAMES, 'SCSP frame count');
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

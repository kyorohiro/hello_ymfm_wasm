/**
 * Standalone Atari POKEY audio core for Browser / Worker / Node.js.
 * No AudioContext, CPU or ROM is created. Each handle owns its complete state.
 * See the fixed SDK vendor/libvgm-pokey/ for BSD provenance and I/O limits.
 */
export const POKEY_CLOCK = 1789790;

/** @param {number} value @param {number} minimum @param {number} maximum @param {string} label @returns {number} */
function integer(value, minimum, maximum, label) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`Invalid Pokey ${label}: expected ${minimum}..${maximum}`);
  }
  return value;
}

/** Synchronous register / mono PCM API (duplicated into planar L/R). Output
 * retains the unipolar, clipped legacy linear DAC scale and DC component.
 * No Mixer gain, board circuit or DC filter is applied.
 */
export class Pokey {
  #module; #handle; #clock; #rate;
  #pointer = 0; #capacity = 0; #heap = null; #viewFrames = -1;
  #shortHeap = null; #shortViews = null;
  #view = Object.freeze({left:new Float32Array(0), right:new Float32Array(0)});
  #empty = Object.freeze({left:new Float32Array(0), right:new Float32Array(0)});

  /** @param {{moduleFactory:Function,moduleOptions?:object,clock?:number,sampleRate?:number}} options
   * @returns {Promise<Pokey>}
   */
  static async create({moduleFactory, moduleOptions, clock = POKEY_CLOCK, sampleRate = 44100} = {}) {
    integer(clock, 1, 100000000, 'clock');
    integer(sampleRate, 8000, 384000, 'sample rate');
    if (typeof moduleFactory !== 'function') throw new TypeError('Pokey moduleFactory is required');
    const module = await moduleFactory({...moduleOptions});
    for (const name of ['create','destroy','reset','write','read','mute','generate']) {
      if (typeof module?.[`_pokey_${name}`] !== 'function') throw new TypeError(`Missing Pokey export: ${name}`);
    }
    if (typeof module._malloc !== 'function' || typeof module._free !== 'function' || !(module.HEAPF32 instanceof Float32Array)) {
      throw new TypeError('Invalid Pokey WASM memory interface');
    }
    const handle = module._pokey_create(clock, sampleRate);
    if (!handle) throw new Error('Pokey initialization failed');
    return new Pokey(module, handle, clock, sampleRate);
  }

  /** Prefer create(); this instance owns its handle and output buffer.
   * The WASM module may be shared with other independent chip instances.
   * @param {*} module Instantiated Emscripten Pokey module.
   * @param {number} handle Owned native sound-core handle.
   * @param {number} clock Input clock in Hz.
   * @param {number} rate Output sample rate in Hz.
   */
  constructor(module, handle, clock, rate) {
    this.#module = module; this.#handle = handle; this.#clock = clock; this.#rate = rate;
  }
  #alive() { if (!this.#handle) throw new Error('Pokey is disposed'); }
  /** @returns {number} Input clock in Hz. */
  get clock() { return this.#clock; }
  /** @returns {number} Output sample rate in Hz. */
  sampleRate() { this.#alive(); return this.#rate; }

  /** Deterministic cold reset: registers, counters, polynomial phase and mutes.
   * @returns {void}
   */
  reset() { this.#alive(); this.#module._pokey_reset(this.#handle); }

  /** Chip-local register offsets 0x00..0x0f, never Atari CPU addresses.
   * @param {number} address
   * @param {number} value
   * @returns {void}
   */
  writeRegister(address, value) {
    this.#alive(); integer(address, 0, 15, 'register address'); integer(value, 0, 255, 'register byte');
    this.#module._pokey_write(this.#handle, address, value);
  }
  /** Hardware read-register map (POT/status/RANDOM), not the write bank.
   * This is a non-timing status peek, not a CPU bus access.
   * @param {number} address @returns {number} Register byte. */
  readRegister(address) {
    this.#alive(); integer(address, 0, 15, 'register address');
    return this.#module._pokey_read(this.#handle, address);
  }
  /** Monitoring mute suppresses output while the voice continues advancing.
   * @param {number} channel Physical channel 0..3.
   * @param {boolean} muted
   * @returns {void}
   */
  setChannelMuted(channel, muted) {
    this.#alive(); integer(channel, 0, 3, 'channel');
    if (typeof muted !== 'boolean') throw new TypeError('Expected boolean Pokey mute');
    this.#module._pokey_mute(this.#handle, channel, Number(muted));
  }

  /** Reserve output memory before a real-time render loop. Capacity is retained.
   * Prefix views through 128 frames are prewarmed for AudioWorklet segments.
   * @param {number} frames
   * @returns {void}
   */
  reserveFrames(frames) {
    this.#alive(); integer(frames, 0, 0x1000000, 'frame count');
    if (frames <= this.#capacity) return;
    const capacity = 2 ** Math.ceil(Math.log2(frames));
    const pointer = this.#module._malloc(capacity * 8);
    if (!pointer) throw new Error('Pokey audio buffer allocation failed');
    if (this.#pointer) this.#module._free(this.#pointer);
    this.#pointer = pointer; this.#capacity = capacity; this.#heap = null;
    this.#prepareShortViews();
  }
  #prepareShortViews() {
    const heap=this.#module.HEAPF32,left=this.#pointer/4,right=left+this.#capacity;
    this.#shortViews=Array.from({length:Math.min(128,this.#capacity)+1},(_,frames)=>frames?
      Object.freeze({left:heap.subarray(left,left+frames),right:heap.subarray(right,right+frames)}):this.#empty);
    this.#shortHeap=heap;
  }
  /** Borrowed PCM views: consume immediately. A later render, reserveFrames()
   * expansion, heap growth or dispose invalidates their contents/lifetime.
   * No output gain is applied.
   * With fixed frame size and stable WASM memory, views and buffers are reused.
   * @param {number} frames
   * @returns {Readonly<{left:Float32Array,right:Float32Array}>}
   */
  generateStereoView(frames) {
    this.#alive(); integer(frames, 0, 0x1000000, 'frame count');
    if (!frames) return this.#empty;
    this.reserveFrames(frames);
    const right = this.#pointer + this.#capacity * 4;
    this.#module._pokey_generate(this.#handle, this.#pointer, right, frames);
    const heap = this.#module.HEAPF32;
    // Normal <=128-frame worklet spans reuse prewarmed wrappers even when
    // register scheduling alternates between short segment lengths.
    if(heap!==this.#shortHeap)this.#prepareShortViews();
    if(frames<=128)return this.#shortViews[frames];
    if (heap !== this.#heap || frames !== this.#viewFrames) {
      this.#view = Object.freeze({left:heap.subarray(this.#pointer / 4, this.#pointer / 4 + frames),
        right:heap.subarray(right / 4, right / 4 + frames)});
      this.#heap = heap; this.#viewFrames = frames;
    }
    return this.#view;
  }
  /** Owned PCM copies, valid after subsequent renders and disposal.
   * @param {number} frames
   * @returns {{left:Float32Array,right:Float32Array}}
   */
  generateStereo(frames) {
    const view = this.generateStereoView(frames);
    return {left:new Float32Array(view.left), right:new Float32Array(view.right)};
  }
  /** Render into caller-owned, separate stereo buffers.
   * @param {Float32Array} left
   * @param {Float32Array} right
   * @param {number} [frames=left.length]
   * @returns {void}
   */
  generateStereoInto(left, right, frames = left?.length) {
    this.#alive(); integer(frames, 0, 0x1000000, 'frame count');
    if (!(left instanceof Float32Array) || !(right instanceof Float32Array) || left.length < frames || right.length < frames) {
      throw new RangeError('Expected sufficiently large Pokey stereo Float32Arrays');
    }
    if (left.buffer === right.buffer && left.byteOffset < right.byteOffset + frames * 4 && right.byteOffset < left.byteOffset + frames * 4) {
      throw new RangeError('Pokey stereo output ranges must not overlap');
    }
    if (left.buffer === this.#module.HEAPF32.buffer || right.buffer === this.#module.HEAPF32.buffer) {
      throw new RangeError('Pokey output buffers must be owned outside WASM memory');
    }
    const view = this.generateStereoView(frames);
    left.set(view.left); right.set(view.right);
  }
  /** @returns {void} */
  dispose() {
    if (this.#pointer) this.#module._free(this.#pointer);
    if (this.#handle) this.#module._pokey_destroy(this.#handle);
    this.#pointer = this.#handle = this.#capacity = 0;
    this.#heap = null; this.#viewFrames = -1;
    this.#shortHeap = this.#shortViews = null;
    this.#view = this.#empty;
  }
}

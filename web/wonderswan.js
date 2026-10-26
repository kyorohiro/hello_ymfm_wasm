/**
 * Standalone WonderSwan sound core for Browser / Worker / Node.js.
 * No AudioContext, CPU, BIOS or ROM is created. See third_party/mame-wonderswan/
 * for provenance and the limits of this preliminary MAME-derived core.
 */
export const WONDERSWAN_CLOCK = 3072000;

function integer(value, minimum, maximum, label) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`Invalid WonderSwan ${label}: expected ${minimum}..${maximum}`);
  }
  return value;
}

/** Synchronous register / RAM / stereo PCM API. Output follows the raw,
 * unipolar MAME headphone DAC scale; no Mixer gain or DC filter is applied.
 */
export class WonderSwan {
  #module; #handle; #clock; #rate;
  #pointer = 0; #capacity = 0; #heap = null; #viewFrames = -1;
  #view = Object.freeze({left:new Float32Array(0), right:new Float32Array(0)});
  #empty = Object.freeze({left:new Float32Array(0), right:new Float32Array(0)});

  /** @param {{moduleFactory:Function,moduleOptions?:object,clock?:number,sampleRate?:number}} options */
  static async create({moduleFactory, moduleOptions, clock = WONDERSWAN_CLOCK, sampleRate = 44100} = {}) {
    integer(clock, 128, 100000000, 'clock');
    integer(sampleRate, 8000, 384000, 'sample rate');
    if (typeof moduleFactory !== 'function') throw new TypeError('WonderSwan moduleFactory is required');
    const module = await moduleFactory({...moduleOptions});
    for (const name of ['create','destroy','reset','write','read','write_memory','read_memory','mute','generate']) {
      if (typeof module?.[`_wonderswan_${name}`] !== 'function') throw new TypeError(`Missing WonderSwan export: ${name}`);
    }
    if (typeof module._malloc !== 'function' || typeof module._free !== 'function' || !(module.HEAPF32 instanceof Float32Array)) {
      throw new TypeError('Invalid WonderSwan WASM memory interface');
    }
    const handle = module._wonderswan_create(clock, sampleRate);
    if (!handle) throw new Error('WonderSwan initialization failed');
    return new WonderSwan(module, handle, clock, sampleRate);
  }

  /** Prefer create(); this instance owns its handle and output buffer.
   * The WASM module may be shared with other independent chip instances.
   */
  constructor(module, handle, clock, rate) {
    this.#module = module; this.#handle = handle; this.#clock = clock; this.#rate = rate;
  }
  #alive() { if (!this.#handle) throw new Error('WonderSwan is disposed'); }
  get clock() { return this.#clock; }
  sampleRate() { this.#alive(); return this.#rate; }

  /** Deterministic cold reset: RAM, registers, counters, held PCM and mutes. */
  reset() { this.#alive(); this.#module._wonderswan_reset(this.#handle); }

  /** Absolute byte addresses 0x80..0x9f, not VGM-relative register numbers.
   * Hyper Voice, DMA and CPU-side ports are outside this API's first version.
   */
  writeRegister(address, value) {
    this.#alive(); integer(address, 0x80, 0x9f, 'register address'); integer(value, 0, 255, 'register byte');
    this.#module._wonderswan_write(this.#handle, address, value);
  }
  readRegister(address) {
    this.#alive(); integer(address, 0x80, 0x9f, 'register address');
    return this.#module._wonderswan_read(this.#handle, address);
  }
  /** Write one byte of the sound core's owned 16 KiB wave RAM. */
  writeMemory(address, value) {
    this.#alive(); integer(address, 0, 0x3fff, 'RAM address'); integer(value, 0, 255, 'RAM byte');
    this.#module._wonderswan_write_memory(this.#handle, address, value);
  }
  readMemory(address) {
    this.#alive(); integer(address, 0, 0x3fff, 'RAM address');
    return this.#module._wonderswan_read_memory(this.#handle, address);
  }
  /** Copy packed wave RAM bytes. Each channel uses 16 bytes / 32 four-bit
   * samples, low nibble first, at (register 0x8f << 6) + channel * 16.
   */
  loadMemory(bytes, offset = 0) {
    this.#alive();
    if (!(bytes instanceof Uint8Array)) throw new TypeError('Expected WonderSwan RAM Uint8Array');
    integer(offset, 0, 0x4000, 'RAM offset');
    if (bytes.length > 0x4000 - offset) throw new RangeError('WonderSwan RAM upload exceeds 16 KiB');
    for (let i = 0; i < bytes.length; i++) this.#module._wonderswan_write_memory(this.#handle, offset + i, bytes[i]);
  }
  /** Monitoring mute suppresses output while the voice continues advancing. */
  setChannelMuted(channel, muted) {
    this.#alive(); integer(channel, 0, 3, 'channel');
    if (typeof muted !== 'boolean') throw new TypeError('Expected boolean WonderSwan mute');
    this.#module._wonderswan_mute(this.#handle, channel, Number(muted));
  }

  /** Reserve output memory before a real-time render loop. Capacity is retained. */
  reserveFrames(frames) {
    this.#alive(); integer(frames, 0, 0x1000000, 'frame count');
    if (frames <= this.#capacity) return;
    const capacity = 2 ** Math.ceil(Math.log2(frames));
    const pointer = this.#module._malloc(capacity * 8);
    if (!pointer) throw new Error('WonderSwan audio buffer allocation failed');
    if (this.#pointer) this.#module._free(this.#pointer);
    this.#pointer = pointer; this.#capacity = capacity; this.#heap = null;
  }
  /** Borrowed PCM views: consume immediately. A later render, reserveFrames()
   * expansion, heap growth or dispose invalidates their contents/lifetime.
   * No output gain is applied.
   * With fixed frame size and stable WASM memory, views and buffers are reused.
   */
  generateStereoView(frames) {
    this.#alive(); integer(frames, 0, 0x1000000, 'frame count');
    if (!frames) return this.#empty;
    this.reserveFrames(frames);
    const right = this.#pointer + this.#capacity * 4;
    this.#module._wonderswan_generate(this.#handle, this.#pointer, right, frames);
    const heap = this.#module.HEAPF32;
    if (heap !== this.#heap || frames !== this.#viewFrames) {
      this.#view = Object.freeze({left:heap.subarray(this.#pointer / 4, this.#pointer / 4 + frames),
        right:heap.subarray(right / 4, right / 4 + frames)});
      this.#heap = heap; this.#viewFrames = frames;
    }
    return this.#view;
  }
  /** Owned PCM copies, valid after subsequent renders and disposal. */
  generateStereo(frames) {
    const view = this.generateStereoView(frames);
    return {left:new Float32Array(view.left), right:new Float32Array(view.right)};
  }
  /** Render into caller-owned, separate stereo buffers. */
  generateStereoInto(left, right, frames = left?.length) {
    this.#alive(); integer(frames, 0, 0x1000000, 'frame count');
    if (!(left instanceof Float32Array) || !(right instanceof Float32Array) || left.length < frames || right.length < frames) {
      throw new RangeError('Expected sufficiently large WonderSwan stereo Float32Arrays');
    }
    if (left.buffer === right.buffer && left.byteOffset < right.byteOffset + frames * 4 && right.byteOffset < left.byteOffset + frames * 4) {
      throw new RangeError('WonderSwan stereo output ranges must not overlap');
    }
    if (left.buffer === this.#module.HEAPF32.buffer || right.buffer === this.#module.HEAPF32.buffer) {
      throw new RangeError('WonderSwan output buffers must be owned outside WASM memory');
    }
    const view = this.generateStereoView(frames);
    left.set(view.left); right.set(view.right);
  }
  dispose() {
    if (this.#pointer) this.#module._free(this.#pointer);
    if (this.#handle) this.#module._wonderswan_destroy(this.#handle);
    this.#pointer = this.#handle = this.#capacity = 0;
    this.#heap = null; this.#viewFrames = -1;
    this.#view = this.#empty;
  }
}

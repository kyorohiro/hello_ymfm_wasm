/**
 * Accurate SNES SPC playback and DSP-only synthesis. No DOM or audio device.
 * PCM is stereo Float32 at the fixed native rate of 32,000 frames/second.
 * Supply the generated spc_wasm module factory; resample at the output boundary.
 */
export const SPC_SAMPLE_RATE = 32000;
export const SPC_TRACE_CLOCK_RATE = 1024000;
export const SPC_TRACE_MAX_EVENTS = 1000000;
const MAX_TRACE_CLOCKS = 600 * SPC_TRACE_CLOCK_RATE;
/** Captured ordering at the accurate core's effective DSP clock, not CPU time.
 * events are packed [clock, kind, address, value] records; kind0 writes DSP,
 * kind1 writes RAM. Arrays remain editable before preparing a playback copy.
 * @typedef {{version:1,clockRate:1024000,durationClocks:number,
 * initialState:{ram:Uint8Array,dsp:Uint8Array,outputDelayFrames:4},
 * events:Uint32Array|number[]}} SpcTimeline
 */
/** @typedef {{loaded:boolean,positionFrames:number,totalFrames:number,ended:boolean}} SpcTimelineState */
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

/** Validate/copy an editable DSP/RAM trace without initializing WASM or audio.
 * Four uint32 words per event: effective DSP clock, kind (0 DSP / 1 RAM),
 * address, byte value. These clocks preserve the accurate core's observed
 * ordering, including its deferred DSP catch-up; they are not raw CPU timestamps.
 * Capture starts at a freshly loaded SPC's DSP.load phase, with upstream's
 * four-frame output FIFO. Arbitrary mid-song snapshots are not restorable here.
 * @param {SpcTimeline} trace
 * @returns {SpcTimeline & {events:Uint32Array}}
 */
export function prepareSpcTimeline(trace) {
  if (!trace || trace.version !== 1 || trace.clockRate !== SPC_TRACE_CLOCK_RATE) throw new TypeError('Expected SNES timeline version 1 at 1024000 clocks/second');
  integer(trace.durationClocks, 'durationClocks', 32, MAX_TRACE_CLOCKS);
  if (trace.durationClocks % 32) throw new RangeError('durationClocks must contain complete native 32000-Hz frames');
  if (trace.initialState?.outputDelayFrames !== 4) throw new RangeError('SNES timeline requires the original four-frame output delay');
  const ram = bytesOf(trace.initialState.ram), dsp = bytesOf(trace.initialState.dsp);
  if (ram.length !== 65536 || dsp.length !== 128) throw new RangeError('SNES timeline initialState requires 65536 RAM and 128 DSP bytes');
  const source = trace.events;
  if (!(source instanceof Uint32Array) && !Array.isArray(source)) throw new TypeError('SNES timeline events must be packed uint32 words');
  if (source.length % 4 || source.length > SPC_TRACE_MAX_EVENTS * 4) throw new RangeError('SNES timeline exceeds the event limit or contains an incomplete record');
  let previous = 0;
  for (let i = 0; i < source.length; i += 4) {
    const clock = source[i], kind = source[i + 1], address = source[i + 2], value = source[i + 3];
    integer(clock, 'event clock', previous, trace.durationClocks); integer(kind, 'event kind', 0, 1);
    integer(address, 'event address', 0, kind ? 65535 : 127); integer(value, 'event value', 0, 255);
    previous = clock;
  }
  return {version:1, clockRate:SPC_TRACE_CLOCK_RATE, durationClocks:trace.durationClocks,
    initialState:{ram:ram.slice(), dsp:dsp.slice(), outputDelayFrames:4}, events:Uint32Array.from(source)};
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
  /** Enable bounded DSP-write observation at the current position without
   * resetting phase/envelopes. Draining is independent of offline RAM tracing.
   * @param {{capacity?:number}} [options] */
  startDspObservation({capacity = 2048} = {}) {
    this._assertOpen(); integer(capacity, 'DSP observation capacity', 16, 8192);
    this._check(this.module._spc_observer_begin(this.handle, capacity)); this._syncViews();
    this._dspObserverCapacity = capacity;
    this._dspObserverWords = new Uint32Array(this.module.HEAPU8.buffer, this.module._spc_observer_ptr(this.handle), capacity * 4);
  }
  stopDspObservation() {this._assertOpen(); this.module._spc_observer_stop(this.handle);}
  /** Write ordered triples [absolute DSP clock, register, value] into owned
   * preallocated storage. Returns event count; clocks retain precision past 2^32.
   * @param {Float64Array} output @returns {number} */
  drainDspEventsInto(output) {
    this._assertOpen();
    if (!(output instanceof Float64Array) || output.length < (this._dspObserverCapacity ?? 0) * 3) throw new RangeError('DSP event output must fit the observation capacity');
    if (!this._dspObserverCapacity) return 0;
    if (this._dspObserverWords.buffer !== this.module.HEAPU8.buffer) this._dspObserverWords = new Uint32Array(this.module.HEAPU8.buffer,
      this.module._spc_observer_ptr(this.handle), this._dspObserverCapacity * 4);
    const count = this.module._spc_observer_drain(this.handle), words = this._dspObserverWords;
    for (let index = 0; index < count; index++) {
      output[index * 3] = words[index * 4] + words[index * 4 + 1] * 4294967296;
      output[index * 3 + 1] = words[index * 4 + 2]; output[index * 3 + 2] = words[index * 4 + 3];
    }
    return count;
  }
  /** Return/reset lost-write count. Overflow never stops or changes playback. */
  takeDspEventOverflow() {this._assertOpen(); return this.module._spc_observer_lost(this.handle);}
  /** @param {Uint8Array} output */
  readDspRegistersInto(output) {
    this._assertOpen(); if (!(output instanceof Uint8Array) || output.length < 128) throw new RangeError('DSP register output requires 128 bytes');
    const ptr = this.module._spc_observer_registers_ptr(this.handle);
    for (let index = 0; index < 128; index++) output[index] = this.module.HEAPU8[ptr + index];
  }
  /** Discover the union of physical DSP RAM reads over an offline interval.
   * Start fresh/unmuted, render with the same partition and duration as the
   * following trace, then restart before beginTrace({ramReadMask}). The bounded
   * 65536-byte mask includes directory, BRR and echo reads for silent voices too.
   */
  beginRamReadTracking() {
    this._assertOpen(); this._check(this.module._spc_ram_read_begin(this.handle)); this._syncViews();
  }
  /** End discovery and return an owned 65536-byte 0/1 mask.
   * @returns {Uint8Array} */
  endRamReadTracking() {
    this._assertOpen(); this._check(this.module._spc_ram_read_finish(this.handle)); this._syncViews();
    const ptr = this.module._spc_ram_read_mask_ptr(this.handle);
    return this.module.HEAPU8.slice(ptr, ptr + 65536);
  }
  /** Begin bounded offline recording before rendering any frames after load.
   * Same-address RAM writes between DSP advances are coalesced: the DSP never
   * observed those intermediate values. A limit failure rejects the whole trace.
   * Supply only a mask from a complete identical discovery pass; excluded working
   * RAM cannot later be repurposed by edits without capturing that data again.
   * @param {{maxEvents?:number,ramReadMask?:Uint8Array}} [options]
   */
  beginTrace({maxEvents = SPC_TRACE_MAX_EVENTS, ramReadMask} = {}) {
    this._assertOpen(); integer(maxEvents, 'maxEvents', 1, SPC_TRACE_MAX_EVENTS);
    if (ramReadMask !== undefined) {
      if (!(ramReadMask instanceof Uint8Array) || ramReadMask.length !== 65536 || ramReadMask.some(value => value > 1)) {
        throw new RangeError('DSP RAM read mask must be a Uint8Array of 65536 zero/one bytes');
      }
      this._withBytes(ramReadMask, ptr => this._check(this.module._spc_trace_begin(this.handle, maxEvents, ptr, ramReadMask.length)));
    } else {this._check(this.module._spc_trace_begin(this.handle, maxEvents, 0, 0)); this._syncViews();}
  }
  /** Stop capture and return independent copied initial bytes and packed events.
   * @returns {SpcTimeline & {events:Uint32Array}} */
  endTrace() {
    this._assertOpen(); this._check(this.module._spc_trace_finish(this.handle)); this._syncViews();
    const initial = this.module._spc_trace_initial_ptr(this.handle), count = this.module._spc_trace_event_count(this.handle);
    const events = new Uint32Array(this.module.HEAPU8.buffer, this.module._spc_trace_events_ptr(this.handle), count * 4).slice();
    return {version:1, clockRate:SPC_TRACE_CLOCK_RATE, durationClocks:this.nativeFrames * 32,
      initialState:{ram:this.module.HEAPU8.slice(initial, initial + 65536),
        dsp:this.module.HEAPU8.slice(initial + 65536, initial + 65536 + 128), outputDelayFrames:4}, events};
  }
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
  /** Prepare raw original RAM and exact sub-sample DSP/RAM events. Instrument
   * sample allocation/presets must not be mixed with this raw timeline mode.
   * @param {SpcTimeline} trace @returns {SpcTimelineState} */
  loadTimeline(trace) {
    const prepared = prepareSpcTimeline(trace), initialBytes = 65536 + 128;
    const bytes = new Uint8Array(initialBytes + prepared.events.byteLength);
    bytes.set(prepared.initialState.ram); bytes.set(prepared.initialState.dsp, 65536);
    new Uint32Array(bytes.buffer, initialBytes, prepared.events.length).set(prepared.events);
    this._withBytes(bytes, ptr => this._check(this.module._spc_load_timeline(this.handle, ptr, ptr + initialBytes,
      prepared.events.length / 4, prepared.durationClocks)));
    return this.getTimelineState();
  }
  /** Restart prepared state without reallocating/copying the event list. */
  restartTimeline() {this._assertOpen(); this._check(this.module._spc_restart_timeline(this.handle)); return this.getTimelineState();}
  /** @returns {SpcTimelineState} */
  getTimelineState() {
    this._assertOpen(); const totalFrames = this.module._spc_timeline_total_frames(this.handle), positionFrames = this.nativeFrames;
    return {loaded:totalFrames > 0, positionFrames, totalFrames, ended:totalFrames > 0 && positionFrames >= totalFrames};
  }
}

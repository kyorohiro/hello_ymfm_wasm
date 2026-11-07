// SPDX-License-Identifier: BSD-3-Clause
import {validateBrowserPsid} from '../js/sid_psid.js';

export const SID_PLAYER_CLOCK = 985248;
export const SID_PLAYER_FRAME_CYCLES = 19656;
const integer = (value, min, max, label) => {
  if (!Number.isInteger(value) || value < min || value > max) throw new RangeError(`${label} must be an integer ${min}..${max}`);
  return value;
};

/** A bounded PSID init/play host, not a complete C64. One CPU bus cycle clocks
 * one existing 6581 approximation tick. A PAL frame is exactly 19,656 ticks.
 * No ROM, CIA, VIC, IRQ player, resampling or hidden gain correction is added.
 * The same 12 Hz software DC blocker as the standalone SID core follows output.
 */
export class SidPlayerCore {
  static async create({sampleRate = 48000, wasmBinary, signal} = {}) {
    integer(sampleRate, 8000, 96000, 'SID player sample rate');
    signal?.throwIfAborted();
    let bytes = wasmBinary;
    if (!bytes) {
      const response = await fetch(new URL('../generated/sid-player/sid-player.wasm', import.meta.url), {signal});
      if (!response.ok) throw new Error(`SID player WASM could not load (HTTP ${response.status})`);
      bytes = await response.arrayBuffer();
    }
    signal?.throwIfAborted();
    const {instance} = await WebAssembly.instantiate(bytes, {
      env: {emscripten_notify_memory_growth() {}},
      wasi_snapshot_preview1: {proc_exit(code) {throw new Error(`SID player WASM exited (${code})`);}},
    });
    signal?.throwIfAborted();
    instance.exports._initialize?.();
    return new SidPlayerCore(instance.exports, sampleRate);
  }
  constructor(exports, sampleRate) {
    this.exports = exports; this.sampleRate = sampleRate;
    this.handle = 0; this.positionFrames = 0; this.subtune = null;
    this.declaredClock = this.declaredModel = null; this.targetSelection = null;
  }
  assertOpen() { if (!this.exports) throw new Error('SID player is disposed'); }
  nativeError(handle) {
    const pointer = this.exports.sidp_error(handle), memory = new Uint8Array(this.exports.memory.buffer);
    let end = pointer;
    while (end < Math.min(pointer + 1024, memory.length) && memory[end]) end++;
    // TextDecoder is not available in every AudioWorkletGlobalScope. Native
    // diagnostics are ASCII; decode without adding a worklet platform dependency.
    const message = String.fromCharCode(...memory.subarray(pointer, end)) || 'SID program execution failed';
    const error = new Error(message);
    error.code = this.exports.sidp_error_code(handle);
    error.address = this.exports.sidp_error_address(handle);
    if (error.address) error.message += ` (at $${error.address.toString(16).toUpperCase().padStart(4, '0')})`;
    return error;
  }
  /** Validate and initialize a candidate. A failed load keeps the old player's
   * CPU, SID, samples and selected subtune intact. Loading never renders a device.
   * @param {ArrayBuffer|ArrayBufferView} bytes @param {{subtune?:number,clock?:'pal',model?:'6581'}} [options]
   */
  load(bytes, {subtune, clock, model} = {}) {
    this.assertOpen();
    const parsed = validateBrowserPsid(bytes, {subtune, clock, model}), api = this.exports;
    const candidate = api.sidp_create(this.sampleRate);
    if (!candidate) throw new Error('SID player allocation failed');
    try {
      new Uint8Array(api.memory.buffer, api.sidp_input(candidate), parsed.program.length).set(parsed.program);
      if (!api.sidp_load(candidate, parsed.program.length, parsed.loadAddress, parsed.initAddress, parsed.playAddress, parsed.subtune - 1)) throw this.nativeError(candidate);
    } catch (error) {api.sidp_destroy(candidate); throw error;}
    if (this.handle) api.sidp_destroy(this.handle);
    this.handle = candidate; this.positionFrames = 0; this.subtune = parsed.subtune;
    this.declaredClock = parsed.clock; this.declaredModel = parsed.model;
    this.targetSelection = {...parsed.selection};
    return this.getState();
  }
  /** @param {Float32Array} output */
  renderInto(output) {
    this.assertOpen();
    if (!(output instanceof Float32Array)) throw new TypeError('SID player output must be Float32Array');
    if (!this.handle) {output.fill(0); return output;}
    try {
      for (let offset = 0; offset < output.length; offset += 4096) {
        const frames = Math.min(4096, output.length - offset);
        if (!this.exports.sidp_render(this.handle, frames)) throw this.nativeError(this.handle);
        output.set(new Float32Array(this.exports.memory.buffer, this.exports.sidp_output(this.handle), frames), offset);
        if (this.exports.sidp_state(this.handle) === 1) this.positionFrames += frames;
      }
    } catch (error) {output.fill(0); throw error;}
    return output;
  }
  render(frames) {
    integer(frames, 0, this.sampleRate * 600, 'SID player frames');
    return this.renderInto(new Float32Array(frames));
  }
  stop() {this.assertOpen(); if (this.handle) this.exports.sidp_stop(this.handle); return this.getState();}
  getState() {
    this.assertOpen();
    const api = this.exports, handle = this.handle, state = handle ? api.sidp_state(handle) : 0;
    return {
      loaded: !!handle, playing: state === 1, state, format: 'PSID', model: '6581', clockHz: SID_PLAYER_CLOCK,
      declaredClock: this.declaredClock, declaredModel: this.declaredModel,
      targetSelection: this.targetSelection ? {...this.targetSelection} : null,
      frameCycles: SID_PLAYER_FRAME_CYCLES, sampleRate: this.sampleRate, subtune: this.subtune,
      cycles: handle ? api.sidp_cycles(handle) : 0, initCycles: handle ? api.sidp_init_cycles(handle) : 0,
      playCalls: handle ? api.sidp_play_calls(handle) : 0, skippedVbis: handle ? api.sidp_skipped_vbis(handle) : 0,
      positionFrames: this.positionFrames,
      registers: Array.from({length: 32}, (_, index) => handle ? api.sidp_register(handle, index) : 0),
      voices: Array.from({length: 3}, (_, voice) => ({envelope: handle ? api.sidp_envelope(handle, voice) : 0, phase: handle ? api.sidp_phase(handle, voice) : 0})),
    };
  }
  /** Bounded diagnostic writes, in real CPU bus order. Reads and same-value
   * writes are not synthesized. A full trace drops later writes explicitly.
   */
  readTrace({clear = false} = {}) {
    this.assertOpen();
    if (!this.handle) return {writes: [], dropped: 0};
    const api = this.exports, count = api.sidp_trace_count(this.handle);
    const words = new Uint32Array(api.memory.buffer, api.sidp_trace(this.handle), count * 4), writes = [];
    for (let index = 0; index < count; index++) {
      const offset = index * 4;
      writes.push({cycle: words[offset] + words[offset + 1] * 4294967296, register: words[offset + 2], value: words[offset + 3]});
    }
    const result = {writes, dropped: api.sidp_dropped_trace(this.handle)};
    if (clear) api.sidp_clear_trace(this.handle);
    return result;
  }
  dispose() {
    if (this.handle) this.exports.sidp_destroy(this.handle);
    this.handle = 0; this.exports = null;
  }
}

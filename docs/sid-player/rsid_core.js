// SPDX-License-Identifier: BSD-3-Clause
import {validateBrowserRsid} from '../js/sid_rsid.js';
import {validateBrowserPsid} from '../js/sid_psid.js';
import {concatenateRoms} from './roms.js';

export const RSID_PLAYER_CLOCK = 985248;
export const RSID_PLAYER_FRAME_CYCLES = 19656;
const integer = (value, min, max, label) => {
  if (!Number.isInteger(value) || value < min || value > max) throw new RangeError(`${label} must be an integer ${min}..${max}`);
  return value;
};

/** A continuous C64 machine host for RSID and PSID CIA subtunes. CPU, both CIAs, VIC and SID run
 * together; no host-scheduled play routine is substituted for interrupts.
 * The minimal environment supplies an original, limited IRQ/NMI shim. Full
 * firmware mode uses only ROM bytes supplied by the caller. Neither is a claim
 * of real-hardware accuracy. Existing SID output/DC processing is preserved.
 */
export class RsidPlayerCore {
  static async create({sampleRate = 48000, wasmBinary, signal} = {}) {
    integer(sampleRate, 8000, 96000, 'RSID player sample rate');
    signal?.throwIfAborted();
    let bytes = wasmBinary;
    if (!bytes) {
      const response = await fetch(new URL('../generated/sid-rsid/sid-rsid.wasm', import.meta.url), {signal});
      if (!response.ok) throw new Error(`RSID player WASM could not load (HTTP ${response.status})`);
      bytes = await response.arrayBuffer();
    }
    signal?.throwIfAborted();
    const {instance} = await WebAssembly.instantiate(bytes, {
      env: {emscripten_notify_memory_growth() {}},
      wasi_snapshot_preview1: {proc_exit(code) {throw new Error(`RSID player WASM exited (${code})`);}},
    });
    signal?.throwIfAborted();
    instance.exports._initialize?.();
    return new RsidPlayerCore(instance.exports, sampleRate);
  }
  constructor(exports, sampleRate) {
    this.exports = exports; this.sampleRate = sampleRate;
    this.handle = 0; this.positionFrames = 0; this.subtune = null;
  }
  assertOpen() { if (!this.exports) throw new Error('RSID player is disposed'); }
  nativeError(handle) {
    const pointer = this.exports.sidr_error(handle), memory = new Uint8Array(this.exports.memory.buffer);
    let end = pointer;
    while (end < Math.min(pointer + 1024, memory.length) && memory[end]) end++;
    // TextDecoder is not available in every AudioWorkletGlobalScope. Native
    // diagnostics are ASCII; decode without adding a worklet platform dependency.
    const message = String.fromCharCode(...memory.subarray(pointer, end)) || 'SID program execution failed';
    const error = new Error(message);
    error.code = this.exports.sidr_error_code(handle);
    error.address = this.exports.sidr_error_address(handle);
    if (error.address) error.message += ` (at $${error.address.toString(16).toUpperCase().padStart(4, '0')})`;
    return error;
  }
  /** A failed candidate leaves the old C64/SID state and next PCM intact.
   * ROMs are optional in the limited environment and required in firmware mode.
   * @param {ArrayBuffer|ArrayBufferView} bytes
   * @param {{subtune?:number,environment?:'minimal'|'rom',clock?:'pal',model?:'6581',roms?:object}} [options]
   */
  load(bytes, {subtune, environment = 'minimal', clock, model, roms} = {}) {
    this.assertOpen();
    if (!['minimal', 'rom'].includes(environment)) throw new RangeError('C64 environment must be minimal or rom');
    const view = bytes instanceof ArrayBuffer ? new Uint8Array(bytes)
      : ArrayBuffer.isView(bytes) ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength) : null;
    const psid = view && view.length >= 4 && view[0] === 80 && view[1] === 83 && view[2] === 73 && view[3] === 68;
    const parsed = psid ? validateBrowserPsid(bytes, {subtune, clock, model})
      : validateBrowserRsid(bytes, {subtune, environment, clock, model});
    if (psid && parsed.timing !== 'cia') throw new Error('This PSID subtune uses VBI timing; load it through the VBI player');
    const firmware = environment === 'rom' ? concatenateRoms(roms) : null, api = this.exports;
    if (psid && typeof api.sidr_load_psid !== 'function') throw new Error('PSID CIA needs the updated C64 WASM. Reload the player.');
    const candidate = api.sidr_create(this.sampleRate);
    if (!candidate) throw new Error('RSID player allocation failed');
    try {
      new Uint8Array(api.memory.buffer, api.sidr_input(candidate), parsed.program.length).set(parsed.program);
      if (firmware) new Uint8Array(api.memory.buffer, api.sidr_rom_input(candidate), firmware.length).set(firmware);
      const loaded = psid
        ? api.sidr_load_psid(candidate, parsed.program.length, parsed.loadAddress, parsed.initAddress, parsed.playAddress,
          parsed.subtune - 1, Number(environment === 'rom'))
        : api.sidr_load(candidate, parsed.program.length, parsed.loadAddress, parsed.initAddress,
          parsed.subtune - 1, Number(parsed.basic), Number(environment === 'rom'));
      if (!loaded) throw this.nativeError(candidate);
    } catch (error) {api.sidr_destroy(candidate); throw error;}
    if (this.handle) api.sidr_destroy(this.handle);
    this.handle = candidate; this.positionFrames = 0; this.subtune = parsed.subtune;
    this.environment = environment; this.format = parsed.format; this.timing = psid ? 'cia' : 'c64-irq';
    this.declaredClock = parsed.clock; this.declaredModel = parsed.model; this.targetSelection = {...parsed.selection};
    return this.getState();
  }
  /** @param {Float32Array} output */
  renderInto(output) {
    this.assertOpen();
    if (!(output instanceof Float32Array)) throw new TypeError('RSID player output must be Float32Array');
    if (!this.handle) {output.fill(0); return output;}
    try {
      for (let offset = 0; offset < output.length; offset += 4096) {
        const frames = Math.min(4096, output.length - offset);
        if (!this.exports.sidr_render(this.handle, frames)) throw this.nativeError(this.handle);
        output.set(new Float32Array(this.exports.memory.buffer, this.exports.sidr_output(this.handle), frames), offset);
        if (this.exports.sidr_state(this.handle) === 1) this.positionFrames += frames;
      }
    } catch (error) {output.fill(0); throw error;}
    return output;
  }
  render(frames) {
    integer(frames, 0, this.sampleRate * 600, 'RSID player frames');
    return this.renderInto(new Float32Array(frames));
  }
  stop() {this.assertOpen(); if (this.handle) this.exports.sidr_stop(this.handle); return this.getState();}
  getState() {
    this.assertOpen();
    const api = this.exports, handle = this.handle, state = handle ? api.sidr_state(handle) : 0;
    return {
      loaded: !!handle, playing: state === 1, state, format: this.format ?? 'RSID', timing: this.timing ?? 'c64-irq', environment: this.environment ?? 'minimal',
      model: '6581', clockHz: RSID_PLAYER_CLOCK, frameCycles: RSID_PLAYER_FRAME_CYCLES,
      declaredClock: this.declaredClock ?? null, declaredModel: this.declaredModel ?? null,
      targetSelection: this.targetSelection ? {...this.targetSelection} : null,
      sampleRate: this.sampleRate, subtune: this.subtune, positionFrames: this.positionFrames,
      cycles: handle ? api.sidr_cycles(handle) : 0, initCycles: handle ? api.sidr_init_cycles(handle) : 0,
      bootCycles: handle ? api.sidr_boot_cycles(handle) : 0, initReturned: handle ? !!api.sidr_init_returned(handle) : false,
      irqCount: handle ? api.sidr_irq_count(handle) : 0, nmiCount: handle ? api.sidr_nmi_count(handle) : 0,
      playCalls: handle && api.sidr_play_calls ? api.sidr_play_calls(handle) : 0,
      readCount: handle ? api.sidr_read_count(handle) : 0, writeCount: handle ? api.sidr_write_count(handle) : 0,
      pc: handle ? api.sidr_pc(handle) : 0,
      registers: Array.from({length: 32}, (_, index) => handle ? api.sidr_register(handle, index) : 0),
      voices: Array.from({length: 3}, (_, voice) => ({envelope: handle ? api.sidr_envelope(handle, voice) : 0, phase: handle ? api.sidr_phase(handle, voice) : 0})),
    };
  }
  readRam(address) {
    this.assertOpen(); integer(address, 0, 65535, 'C64 RAM address');
    if (!this.handle) throw new Error('No SID is loaded');
    return this.exports.sidr_ram_read(this.handle, address);
  }
  /** Bounded diagnostic writes, in real CPU bus order. Reads and same-value
   * writes are not synthesized. A full trace drops later writes explicitly.
   */
  readTrace({clear = false} = {}) {
    this.assertOpen();
    if (!this.handle) return {writes: [], dropped: 0};
    const api = this.exports, count = api.sidr_trace_count(this.handle);
    const words = new Uint32Array(api.memory.buffer, api.sidr_trace(this.handle), count * 4), writes = [];
    for (let index = 0; index < count; index++) {
      const offset = index * 4;
      writes.push({cycle: words[offset] + words[offset + 1] * 4294967296, register: words[offset + 2], value: words[offset + 3]});
    }
    const result = {writes, dropped: api.sidr_dropped_trace(this.handle)};
    if (clear) api.sidr_clear_trace(this.handle);
    return result;
  }
  dispose() {
    if (this.handle) this.exports.sidr_destroy(this.handle);
    this.handle = 0; this.exports = null;
  }
}

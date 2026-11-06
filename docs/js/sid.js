/** Experimental MOS 6581 core. BSD-3-Clause wrapper; chip: zlib.
 * This module is independent of the current fixed SDK and npm public API.
 */
export const SID_PAL_CLOCK = 985248;
export const SID_NTSC_CLOCK = 1022727;
const integer = (value, min, max, label) => {
  if (!Number.isInteger(value) || value < min || value > max) throw new RangeError(`${label} must be an integer ${min}..${max}`);
  return value;
};

/** One independent, mono 6581. Reads/writes each advance one chip clock.
 * Render includes samples produced by these accesses. A 12 Hz software output
 * DC blocker follows the simplified chip model. No 8580 or C64 CPU is included.
 */
export class SidCore {
  /** @param {{sampleRate?:number,clockHz?:number,wasmUrl?:URL|string,wasmBinary?:BufferSource}} [options] */
  static async create({sampleRate = 48000, clockHz = SID_PAL_CLOCK, wasmUrl, wasmBinary} = {}) {
    integer(sampleRate, 8000, 96000, 'SID sampleRate');
    integer(clockHz, 900000, 1100000, 'SID clockHz');
    let bytes = wasmBinary;
    if (!bytes) {
      // URL and fetch are not present in every AudioWorkletGlobalScope. A
      // Worklet supplies wasmBinary; only the main-thread loader uses them.
      const response = await fetch(wasmUrl ?? new URL('../generated/sid/sid.wasm', import.meta.url));
      if (!response.ok) throw new Error(`SID WASM could not be loaded (${response.status})`);
      bytes = await response.arrayBuffer();
    }
    const {instance} = await WebAssembly.instantiate(bytes, {env: {
      emscripten_notify_memory_growth() {},
      // The bridge does not print or use files. Unexpected host calls fail.
    }, wasi_snapshot_preview1: {
      proc_exit(code) { throw new Error(`SID WASM exited (${code})`); },
    }});
    instance.exports._initialize?.();
    const handle = instance.exports.sid_create(sampleRate, clockHz);
    if (!handle) throw new Error('SID core allocation failed');
    return new SidCore(instance.exports, handle, sampleRate, clockHz);
  }
  constructor(exports, handle, sampleRate, clockHz) {
    this.exports = exports; this.handle = handle;
    this.sampleRate = sampleRate; this.clockHz = clockHz; this.model = '6581';
    this.registers = new Uint8Array(32);
  }
  assertOpen() { if (!this.handle) throw new Error('SID core is disposed'); }
  /** @param {number} register @param {number} value */
  writeRegister(register, value) {
    this.assertOpen(); integer(register, 0, 31, 'SID register'); integer(value, 0, 255, 'SID value');
    if (!this.exports.sid_write(this.handle, register, value)) throw new Error('SID access queue is full; render audio before more register accesses');
    this.registers[register] = value;
  }
  /** Hardware bus read, not a copy of the written register. OSC3=27, ENV3=28.
   * @param {number} register @returns {number} */
  readRegister(register) {
    this.assertOpen(); integer(register, 0, 31, 'SID register');
    const value = this.exports.sid_read(this.handle, register);
    if (value < 0) throw new Error('SID access queue is full; render audio before more register accesses');
    return value;
  }
  /** @param {Float32Array} output */
  renderInto(output) {
    this.assertOpen();
    if (!(output instanceof Float32Array)) throw new TypeError('SID output must be Float32Array');
    for (let offset = 0; offset < output.length; offset += 4096) {
      const frames = Math.min(4096, output.length - offset);
      if (!this.exports.sid_render(this.handle, frames)) throw new Error('SID render failed');
      output.set(new Float32Array(this.exports.memory.buffer, this.exports.sid_output(this.handle), frames), offset);
    }
    return output;
  }
  /** @param {number} frames @returns {Float32Array} */
  render(frames) { integer(frames, 0, this.sampleRate * 600, 'SID frames'); return this.renderInto(new Float32Array(frames)); }
  reset() { this.assertOpen(); this.exports.sid_reset(this.handle); this.registers.fill(0); }
  getState() {
    this.assertOpen();
    return {model: this.model, clockHz: this.clockHz, sampleRate: this.sampleRate,
      cycles: this.exports.sid_cycles(this.handle), registers: Array.from(this.registers),
      voices: [0, 1, 2].map(voice => ({envelope: this.exports.sid_envelope(this.handle, voice),
        phase: this.exports.sid_phase(this.handle, voice)}))};
  }
  dispose() { if (this.handle) this.exports.sid_destroy(this.handle); this.handle = 0; }
}

/** Frequency register conversion, with no hidden clamp.
 * @param {number} hz @param {number} [clockHz] */
export function sidFrequency(hz, clockHz = SID_PAL_CLOCK) {
  if (!Number.isFinite(hz) || hz < 0) throw new RangeError('SID frequency must be finite and nonnegative');
  integer(clockHz, 900000, 1100000, 'SID clockHz');
  const register = Math.round(hz * 16777216 / clockHz);
  return integer(register, 0, 65535, 'SID frequency register');
}

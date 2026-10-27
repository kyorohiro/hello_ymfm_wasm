// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026, kyorohiro.
// Fixed-memory shared C renderer. Analyzer's existing JS decoder is separate.
import {MSM5205_WASM_URL} from '../generated/msm5205_wasm.js';
export const MSM5205_PCM_MAX_BYTES = 65536;
export const MSM5205_PCM_DEFAULT_CLOCK = 1536000;
const BLOCK = 128;
const STATES = ['ready', 'playing', 'ended'];

/** Create a standalone mono ADPCM renderer. No AudioContext is required.
 * @param {{sampleRate?:number,clock?:number,wasmBinary?:ArrayBuffer|Uint8Array,
 * wasmBytes?:ArrayBuffer|Uint8Array,wasmURL?:string|URL}} [options]
 */
export async function createMSM5205PCM({sampleRate = 48000, clock = MSM5205_PCM_DEFAULT_CLOCK,
  wasmBinary, wasmBytes, wasmURL = MSM5205_WASM_URL} = {}) {
  if (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 384000 ||
      !Number.isInteger(clock) || clock < 1 || clock > 0x3fffffff) {
    throw new RangeError('Invalid MSM5205 output sample rate or clock.');
  }
  wasmBinary = wasmBinary || wasmBytes;
  if (!wasmBinary) {
    const response = await fetch(wasmURL);
    if (!response.ok) throw new Error(`MSM5205 WASM failed to load (${response.status}).`);
    wasmBinary = await response.arrayBuffer();
  }
  const {instance} = await WebAssembly.instantiate(wasmBinary, {});
  const e = instance.exports;
  if (!e.msm5205_wasm_init(sampleRate, clock)) throw new Error('MSM5205 initialization failed.');
  const input = new Uint8Array(e.memory.buffer, e.msm5205_wasm_input(), MSM5205_PCM_MAX_BYTES);
  const outputLeft = new Float32Array(e.memory.buffer, e.msm5205_wasm_left(), BLOCK);
  const outputRight = new Float32Array(e.memory.buffer, e.msm5205_wasm_right(), BLOCK);
  const check = (ok, action) => { if (!ok) throw new Error(`MSM5205 cannot ${action} in its current state.`); };
  const read = e.msm5205_wasm_read;
  const readState = () => ({
    mode: read(0) ? 'pce' : 'raw', state: STATES[read(1)], sourceBytes: read(2),
    offset: read(3), length: read(4), positionNibbles: read(5), cursor: read(5),
    loop: !!read(6), rate: read(7), phase: read(8), outputFrames: read(9),
    gain: read(10), muted: !!read(11), signal: read(12), step: read(13),
    resetLine: read(14), vclk: read(15), prescaler: read(16), bits: read(17), fifoCount: read(18), fifoLength: read(18),
    sampleRate, clock, effectiveSampleRate: clock / (48 * (16 - read(7))),
  });
  return {
    sampleRate, clock,
    /** Attach nonempty packed ADPCM; a fixed 64 KiB WASM RAM receives one copy.
     * Caller bytes are not retained. Render never allocates or grows memory.
     * @param {Uint8Array} bytes
     */
    prepare(bytes) {
      if (!(bytes instanceof Uint8Array) || !bytes.byteLength || bytes.byteLength > MSM5205_PCM_MAX_BYTES) {
        throw new RangeError('MSM5205 requires 1..65536 bytes of packed ADPCM.');
      }
      input.set(bytes);
      check(e.msm5205_wasm_prepare(bytes.byteLength), 'prepare RAM');
    },
    /** Offset and length use NIBBLES, high nibble first, not bytes.
     * @param {{offset?:number,length?:number,loop?:boolean,rate?:number}} [options]
     */
    play({offset = 0, length = read(2) * 2 - offset, loop = false, rate = 15} = {}) {
      if (!Number.isInteger(offset) || offset < 0 || offset > 131071 ||
          !Number.isInteger(length) || length < 1 || length > 131072 ||
          typeof loop !== 'boolean' || !Number.isInteger(rate) || rate < 0 || rate > 15) {
        throw new RangeError('Invalid MSM5205 nibble range, loop or rate (0..15).');
      }
      check(e.msm5205_wasm_play(offset, length, +loop, rate), 'play RAM');
    },
    stop() { check(e.msm5205_wasm_stop(), 'stop'); },
    reset() { check(e.msm5205_wasm_reset(), 'reset'); },
    /** @param {number} register @param {number} value */
    writeRegister(register, value) {
      if (!Number.isInteger(register) || register < 0 || register > 7 ||
          !Number.isInteger(value) || value < 0 || value > 15) throw new RangeError('Invalid MSM5205 raw register write.');
      check(e.msm5205_wasm_write(register, value), 'write a register');
    },
    /** @param {number} gain */
    setGain(gain) {
      if (!Number.isFinite(gain) || gain < 0 || gain > 16) throw new RangeError('MSM5205 gain must be finite, 0..16.');
      check(e.msm5205_wasm_gain(gain), 'set gain');
    },
    /** @param {boolean} muted */
    setMuted(muted) {
      if (typeof muted !== 'boolean') throw new TypeError('MSM5205 mute must be boolean.');
      check(e.msm5205_wasm_mute(+muted), 'set mute');
    },
    readState, status: readState,
    dispose() { e.msm5205_wasm_init(sampleRate, clock); },
    /** @param {Float32Array} left @param {Float32Array} right @param {number} [frames] */
    render(left, right, frames = left.length) {
      if (!(left instanceof Float32Array) || !(right instanceof Float32Array) || left === right ||
          !Number.isInteger(frames) || frames < 0 || frames > left.length || frames > right.length) {
        throw new RangeError('MSM5205 requires separate planar Float32 outputs and a valid frame count.');
      }
      for (let offset = 0; offset < frames; offset += BLOCK) {
        const count = Math.min(BLOCK, frames - offset);
        if (!e.msm5205_wasm_render(count)) throw new Error('MSM5205 render failed.');
        for (let i = 0; i < count; ++i) { left[offset + i] = outputLeft[i]; right[offset + i] = outputRight[i]; }
      }
    },
  };
}

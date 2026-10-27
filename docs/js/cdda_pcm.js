// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026, kyorohiro
// Low-level CD-DA PCM16 renderer. User-facing loading/track control belongs
// in the host. Source bytes remain immutable and borrowed until replacement.
import {CDDA_WASM_URL} from '../generated/cdda_wasm.js';

export const CDDA_PCM_RATE = 44100;
export const CDDA_PCM_MAX_BYTES = 256 * 1024 * 1024;
const STATES = ['ready', 'playing', 'paused', 'ended'];
const BLOCK = 128;
const WINDOW = 1024;

/** @typedef {{sampleRate?:number, wasmBytes?:ArrayBuffer|Uint8Array,
 * wasmBinary?:ArrayBuffer|Uint8Array, wasmURL?:string|URL}} CddaPCMOptions */
/** Create one fixed-memory PCM16 renderer. wasmBinary/wasmBytes contain the
 * compiled .wasm bytes, not an already instantiated WebAssembly.Module.
 * @param {CddaPCMOptions} [options]
 */
export async function createCDDAPCM({sampleRate = 48000, wasmBytes, wasmBinary, wasmURL = CDDA_WASM_URL} = {}) {
  if (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 384000) {
    throw new RangeError('CD-DA output sample rate must be an integer from 8000 to 384000.');
  }
  wasmBytes = wasmBytes || wasmBinary;
  if (!wasmBytes) {
    const response = await fetch(wasmURL);
    if (!response.ok) throw new Error(`CD-DA WASM failed to load (${response.status}).`);
    wasmBytes = await response.arrayBuffer();
  }
  const {instance} = await WebAssembly.instantiate(wasmBytes, {});
  const e = instance.exports;
  if (!e.cdda_wasm_init(sampleRate)) throw new Error('CD-DA renderer initialization failed.');
  const input = new Uint8Array(e.memory.buffer, e.cdda_wasm_input(), WINDOW * 4);
  const outputLeft = new Float32Array(e.memory.buffer, e.cdda_wasm_left(), BLOCK);
  const outputRight = new Float32Array(e.memory.buffer, e.cdda_wasm_right(), BLOCK);
  let pcm = null;
  let sourceFrames = 0;
  const requireSuccess = (ok, action) => {
    if (!ok) throw new Error(`CD-DA cannot ${action} in its current state.`);
  };
  return {
    sampleRate,
    // Validation precedes attachment; malformed replacement leaves the
    // active track unchanged. Do not mutate/detach bytes until replacement.
    /** @param {Uint8Array} bytes */
    prepare(bytes) {
      if (!(bytes instanceof Uint8Array) || !bytes.byteLength ||
          bytes.byteLength > CDDA_PCM_MAX_BYTES || bytes.byteLength % 4) {
        throw new RangeError('CD-DA requires nonempty stereo PCM16LE, at most 256 MiB, aligned to four bytes.');
      }
      requireSuccess(e.cdda_wasm_prepare(bytes.byteLength / 4), 'prepare the source');
      pcm = bytes;
      sourceFrames = bytes.byteLength / 4;
    },
    play() { requireSuccess(e.cdda_wasm_play(), 'play'); },
    pause() { requireSuccess(e.cdda_wasm_pause(), 'pause'); },
    resume() { requireSuccess(e.cdda_wasm_resume(), 'resume'); },
    stop() { requireSuccess(e.cdda_wasm_stop(), 'stop'); },
    /** @param {number} frame */
    seek(frame) {
      if (!Number.isSafeInteger(frame) || frame < 0 || frame > sourceFrames) throw new RangeError('Invalid CD-DA source frame.');
      requireSuccess(e.cdda_wasm_seek(frame), 'seek');
    },
    /** @param {number} gain */
    setGain(gain) {
      if (!Number.isFinite(gain) || gain < 0 || gain > 16) throw new RangeError('CD-DA gain must be finite, from 0 to 16.');
      requireSuccess(e.cdda_wasm_gain(gain), 'set gain');
    },
    /** @param {boolean} muted */
    setMuted(muted) {
      if (typeof muted !== 'boolean') throw new TypeError('CD-DA mute must be boolean.');
      requireSuccess(e.cdda_wasm_mute(muted ? 1 : 0), 'set mute');
    },
    status() {
      return {state: STATES[e.cdda_wasm_state()], frame: e.cdda_wasm_frame(),
        positionFrames: e.cdda_wasm_frame(), durationFrames: sourceFrames,
        phase: e.cdda_wasm_phase(), frames: sourceFrames, sampleRate,
        sourceRate: CDDA_PCM_RATE, outputFrames: e.cdda_wasm_output_frames(),
        gain: e.cdda_wasm_get_gain(), muted: !!e.cdda_wasm_muted()};
    },
    dispose() {
      e.cdda_wasm_init(sampleRate);
      pcm = null;
      sourceFrames = 0;
    },
    // Fixed scratch buffers and scalar copies: no temporary typed-array views,
    // malloc, memory growth, or complete-track Float32 decode during render.
    /** @param {Float32Array} left @param {Float32Array} right @param {number} [frames] */
    render(left, right, frames = left.length) {
      if (!(left instanceof Float32Array) || !(right instanceof Float32Array) || left === right ||
          !Number.isInteger(frames) || frames < 0 || frames > left.length || frames > right.length) {
        throw new RangeError('CD-DA requires separate planar Float32 outputs and a valid frame count.');
      }
      for (let offset = 0; offset < frames; offset += BLOCK) {
        const count = Math.min(BLOCK, frames - offset);
        const first = e.cdda_wasm_frame();
        if (pcm && first < sourceFrames && e.cdda_wasm_state() === 1 &&
            !e.cdda_wasm_muted() && e.cdda_wasm_get_gain() !== 0) {
          // Include the interpolation neighbour; at 8 kHz this is <=708 frames.
          const needed = Math.min(sourceFrames - first,
            Math.floor((e.cdda_wasm_phase() + (count - 1) * CDDA_PCM_RATE) / sampleRate) + 2);
          const start = first * 4;
          for (let i = 0; i < needed * 4; i++) input[i] = pcm[start + i];
          if (!e.cdda_wasm_window(first, needed)) throw new Error('CD-DA PCM window rejected.');
        }
        if (!e.cdda_wasm_render(count)) throw new Error('CD-DA render failed.');
        for (let i = 0; i < count; i++) {
          left[offset + i] = outputLeft[i];
          right[offset + i] = outputRight[i];
        }
      }
    },
  };
}

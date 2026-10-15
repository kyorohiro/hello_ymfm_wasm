import { parseSysex } from './sysex.js';
export { parseSysex, packVoice, unpackVoice, createVoiceSysex, createBankSysex, createInitVoice } from './sysex.js';

export const INTERNAL_SAMPLE_RATE = 44100;
// AudioWorkletGlobalScope has no URL constructor. The Worklet always receives
// wasmBytes from its main-thread controller and never needs this fallback.
export const DEFAULT_WASM_URL = typeof URL === 'function'
  ? new URL('../wasm/msfa.wasm', import.meta.url).href : '';
const MAX_RENDER_FRAMES = 1024;
const MAX_PUBLIC_RENDER_FRAMES = 16 * 1024 * 1024;

function integer(value, min, max, name) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new RangeError(`${name} must be an integer from ${min} to ${max}.`);
  }
  return value;
}

async function readWasm(options) {
  if (options.wasmBytes !== undefined) {
    const input = options.wasmBytes;
    if (input instanceof ArrayBuffer) return new Uint8Array(input);
    if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
    throw new TypeError('wasmBytes must be an ArrayBuffer or an ArrayBuffer view.');
  }
  const url = new URL(options.wasmUrl ?? DEFAULT_WASM_URL, import.meta.url);
  if (url.protocol === 'file:' && typeof process !== 'undefined' && process.versions?.node) {
    const { readFile } = await import('node:fs/promises');
    return readFile(url);
  }
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load DX7 WASM (${response.status}).`);
  return new Uint8Array(await response.arrayBuffer());
}

/** Create an independent offline/Node-compatible DX7 core. */
export async function createDX7(options = {}) {
  const sampleRate = options.sampleRate ?? INTERNAL_SAMPLE_RATE;
  if (sampleRate !== 44100 && sampleRate !== 48000) {
    throw new RangeError('MVP output sampleRate must be 44100 or 48000 Hz.');
  }
  const bytes = await readWasm(options);
  const abort = () => { throw new Error('DX7 WASM aborted.'); };
  const { instance } = await WebAssembly.instantiate(bytes, {
    env: { abort },
    wasi_snapshot_preview1: { proc_exit: abort },
  });
  const api = instance.exports;
  api._initialize?.();
  const handle = api.dx7_create();
  if (!handle) throw new Error('Could not create DX7 instance.');
  return new DX7Core(api, handle, sampleRate);
}

class DX7Core {
  #api; #handle; #view; #voiceView;
  #sourceIndex = 64; #phase = 0; #left = 0; #right = 0; #primed = false;
  #voices = []; #selected = -1;

  constructor(api, handle, sampleRate) {
    this.#api = api;
    this.#handle = handle;
    Object.defineProperties(this, {
      sampleRate: { value: sampleRate, enumerable: true },
      internalSampleRate: { value: INTERNAL_SAMPLE_RATE, enumerable: true },
    });
    this.#view = new Float32Array(api.memory.buffer, api.dx7_output_ptr(handle), MAX_RENDER_FRAMES);
    this.#voiceView = new Uint8Array(api.memory.buffer, api.dx7_voice_ptr(handle), 155);
  }

  get voices() { return this.#voices.map(({ name }, index) => ({ index, name })); }
  get selectedVoice() { return this.#selected; }
  #check() { if (!this.#handle) throw new Error('DX7 instance is disposed.'); }

  async loadSysex(input) {
    this.#check();
    const parsed = parseSysex(input);
    // Parse and validate the complete input before replacing a working bank.
    this.#voices = parsed.voices;
    this.selectVoice(0);
    return this.voices;
  }

  selectVoice(index) {
    this.#check();
    integer(index, 0, this.#voices.length - 1, 'Voice index');
    this.#voiceView.set(this.#voices[index].data);
    this.#api.dx7_set_voice(this.#handle);
    this.#selected = index;
  }

  noteOn(note, velocity = 100) {
    this.#check();
    integer(note, 0, 127, 'MIDI note');
    integer(velocity, 0, 127, 'Velocity');
    if (velocity === 0) return this.noteOff(note);
    this.#api.dx7_note_on(this.#handle, note, velocity);
  }

  noteOff(note) {
    this.#check();
    this.#api.dx7_note_off(this.#handle, integer(note, 0, 127, 'MIDI note'));
  }

  allNotesOff() {
    this.#check();
    this.#api.dx7_all_notes_off(this.#handle);
  }

  /** Immediate silence, including queued internal frames and release tails. */
  panic() {
    this.#check();
    this.#api.dx7_panic(this.#handle);
    this.#sourceIndex = 64;
    this.#phase = 0;
    this.#primed = false;
    this.#left = this.#right = 0;
  }

  render(frames) {
    this.#check();
    integer(frames, 0, MAX_PUBLIC_RENDER_FRAMES, 'Frame count');
    const output = new Float32Array(frames);
    this.renderInto(output);
    return output;
  }

  #nextInternal() {
    if (this.#sourceIndex === 64) {
      this.#api.dx7_render(this.#handle, 64);
      this.#sourceIndex = 0;
    }
    return this.#view[this.#sourceIndex++];
  }

  renderInto(output) {
    this.#check();
    if (!(output instanceof Float32Array)) throw new TypeError('renderInto requires a Float32Array.');
    if (output.length > MAX_PUBLIC_RENDER_FRAMES) throw new RangeError('Output buffer is too large.');
    if (!output.length) return;
    if (this.sampleRate === INTERNAL_SAMPLE_RATE) {
      for (let offset = 0; offset < output.length;) {
        const count = Math.min(MAX_RENDER_FRAMES, output.length - offset);
        this.#api.dx7_render(this.#handle, count);
        // Avoid subarray view allocation in the AudioWorklet process path.
        for (let i = 0; i < count; i++) output[offset + i] = this.#view[i];
        offset += count;
      }
      return;
    }
    // 44.1 -> 48 kHz linear interpolation. Integer phase is independent of
    // render partitioning; at most one 64-frame block is generated ahead.
    if (!this.#primed) {
      this.#left = this.#nextInternal();
      this.#right = this.#nextInternal();
      this.#primed = true;
    }
    for (let i = 0; i < output.length; i++) {
      output[i] = this.#left + (this.#right - this.#left) * (this.#phase / this.sampleRate);
      this.#phase += INTERNAL_SAMPLE_RATE;
      if (this.#phase >= this.sampleRate) {
        this.#phase -= this.sampleRate;
        this.#left = this.#right;
        this.#right = this.#nextInternal();
      }
    }
  }

  dispose() {
    if (!this.#handle) return;
    this.#api.dx7_destroy(this.#handle);
    this.#handle = 0;
    this.#voices = [];
    this.#view = this.#voiceView = null;
    this.#api = null;
  }
}

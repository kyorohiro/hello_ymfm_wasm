#!/usr/bin/env node
// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026, kyorohiro
// Test-only ABI harnesses. These are deliberately not npm/browser adapters:
// they instantiate only the explicit SDK WASM bytes and use bounded windows.
import assert from 'node:assert/strict';
import {mkdtemp, readFile, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {basename, join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026, kyorohiro
// Low-level CD-DA PCM16 renderer. User-facing loading/track control belongs
// in the host. Source bytes remain immutable and borrowed until replacement.

export const CDDA_PCM_RATE = 44100;
export const CDDA_PCM_MAX_BYTES = 256 * 1024 * 1024;
const CDDA_STATES = ['ready', 'playing', 'paused', 'ended'];
const CDDA_BLOCK = 128;
const CDDA_WINDOW = 1024;

/** @typedef {{sampleRate?:number, wasmBytes?:ArrayBuffer|Uint8Array,
 * wasmBinary?:ArrayBuffer|Uint8Array, wasmURL?:string|URL}} CddaPCMOptions */
/** Create one fixed-memory PCM16 renderer. wasmBinary/wasmBytes contain the
 * compiled .wasm bytes, not an already instantiated WebAssembly.Module.
 * @param {CddaPCMOptions} [options]
 */
export async function createCDDAPCM({sampleRate = 48000, wasmBytes, wasmBinary, wasmURL} = {}) {
  if (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 384000) {
    throw new RangeError('CD-DA output sample rate must be an integer from 8000 to 384000.');
  }
  wasmBytes = wasmBytes || wasmBinary;
  if (!wasmBytes) throw new Error('Test harness requires explicit compiled WASM bytes.');
  const {instance} = await WebAssembly.instantiate(wasmBytes, {});
  const e = instance.exports;
  if (!e.cdda_wasm_init(sampleRate)) throw new Error('CD-DA renderer initialization failed.');
  const input = new Uint8Array(e.memory.buffer, e.cdda_wasm_input(), CDDA_WINDOW * 4);
  const outputLeft = new Float32Array(e.memory.buffer, e.cdda_wasm_left(), CDDA_BLOCK);
  const outputRight = new Float32Array(e.memory.buffer, e.cdda_wasm_right(), CDDA_BLOCK);
  let pcm = null;
  let sourceFrames = 0;
  const requireSuccess = (ok, action) => {
    if (!ok) throw new Error(`CD-DA cannot ${action} in its current state.`);
  };
  return {
    abi: e, // Test-only direct access for ABI guards; not a shipped JS adapter.
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
      return {state: CDDA_STATES[e.cdda_wasm_state()], frame: e.cdda_wasm_frame(),
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
      for (let offset = 0; offset < frames; offset += CDDA_BLOCK) {
        const count = Math.min(CDDA_BLOCK, frames - offset);
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

// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026, kyorohiro.
// Fixed-memory shared C renderer. Analyzer's existing JS decoder is separate.
export const MSM5205_PCM_MAX_BYTES = 65536;
export const MSM5205_PCM_DEFAULT_CLOCK = 1536000;
const MSM5205_BLOCK = 128;
const MSM5205_STATES = ['ready', 'playing', 'ended'];

/** Create a standalone mono ADPCM renderer. No AudioContext is required.
 * @param {{sampleRate?:number,clock?:number,wasmBinary?:ArrayBuffer|Uint8Array,
 * wasmBytes?:ArrayBuffer|Uint8Array,wasmURL?:string|URL}} [options]
 */
export async function createMSM5205PCM({sampleRate = 48000, clock = MSM5205_PCM_DEFAULT_CLOCK,
  wasmBinary, wasmBytes, wasmURL} = {}) {
  if (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 384000 ||
      !Number.isInteger(clock) || clock < 1 || clock > 0x3fffffff) {
    throw new RangeError('Invalid MSM5205 output sample rate or clock.');
  }
  wasmBinary = wasmBinary || wasmBytes;
  if (!wasmBinary) throw new Error('Test harness requires explicit compiled WASM bytes.');
  const {instance} = await WebAssembly.instantiate(wasmBinary, {});
  const e = instance.exports;
  if (!e.msm5205_wasm_init(sampleRate, clock)) throw new Error('MSM5205 initialization failed.');
  const input = new Uint8Array(e.memory.buffer, e.msm5205_wasm_input(), MSM5205_PCM_MAX_BYTES);
  const outputLeft = new Float32Array(e.memory.buffer, e.msm5205_wasm_left(), MSM5205_BLOCK);
  const outputRight = new Float32Array(e.memory.buffer, e.msm5205_wasm_right(), MSM5205_BLOCK);
  const check = (ok, action) => { if (!ok) throw new Error(`MSM5205 cannot ${action} in its current state.`); };
  const read = e.msm5205_wasm_read;
  const readState = () => ({
    mode: read(0) ? 'pce' : 'raw', state: MSM5205_STATES[read(1)], sourceBytes: read(2),
    offset: read(3), length: read(4), positionNibbles: read(5), cursor: read(5),
    loop: !!read(6), rate: read(7), phase: read(8), outputFrames: read(9),
    gain: read(10), muted: !!read(11), signal: read(12), step: read(13),
    resetLine: read(14), vclk: read(15), prescaler: read(16), bits: read(17), fifoCount: read(18), fifoLength: read(18),
    sampleRate, clock, effectiveSampleRate: clock / (48 * (16 - read(7))),
  });
  return {
    abi: e, // Test-only direct access for ABI guards; not a shipped JS adapter.
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
      for (let offset = 0; offset < frames; offset += MSM5205_BLOCK) {
        const count = Math.min(MSM5205_BLOCK, frames - offset);
        if (!e.msm5205_wasm_render(count)) throw new Error('MSM5205 render failed.');
        for (let i = 0; i < count; ++i) { left[offset + i] = outputLeft[i]; right[offset + i] = outputRight[i]; }
      }
    },
  };
}

const ABI_EXPORTS = {
  cdda: ['init', 'input', 'left', 'right', 'prepare', 'window', 'play', 'pause',
    'resume', 'stop', 'seek', 'gain', 'mute', 'render', 'state', 'frame', 'phase',
    'output_frames', 'get_gain', 'muted'],
  msm5205: ['init', 'input', 'left', 'right', 'prepare', 'play', 'stop', 'reset',
    'write', 'gain', 'mute', 'render', 'read'],
};

/** Check the real generated pair without Emscripten runtime or host imports. */
export async function checkApplicationAudioArtifact(directory, artifact) {
  assert(Object.hasOwn(ABI_EXPORTS, artifact), 'Unknown application audio artifact.');
  const wasmBinary = await readFile(join(directory, `${artifact}_wasm.wasm`));
  const module = new WebAssembly.Module(wasmBinary);
  assert.deepEqual(WebAssembly.Module.imports(module), [], 'Standalone audio has no host imports.');
  const instance = new WebAssembly.Instance(module, {});
  assert.equal(instance.exports.memory.buffer.byteLength, 131072, 'Fixed 128 KiB memory.');
  assert.throws(() => instance.exports.memory.grow(1), RangeError, 'Memory cannot grow.');
  for (const name of ABI_EXPORTS[artifact]) {
    assert.equal(typeof instance.exports[`${artifact}_wasm_${name}`], 'function', `ABI export ${name}`);
  }

  // Copy only this generated pair: the loader must locate its adjacent WASM,
  // including when the loader itself is imported with a query and fragment.
  const temporary = await mkdtemp(join(tmpdir(), 'tetorica-application-audio-loader-'));
  try {
    const loaderPath = join(temporary, `${artifact}_wasm.mjs`);
    await writeFile(loaderPath, await readFile(join(directory, `${artifact}_wasm.js`)));
    await writeFile(join(temporary, `${artifact}_wasm.wasm`), wasmBinary);
    const descriptor = await import(pathToFileURL(loaderPath).href + '?smoke=1#descriptor');
    const prefix = artifact === 'cdda' ? 'CDDA' : 'MSM5205';
    assert.equal(descriptor[`${prefix}_PCM_ABI`], 1);
    const located = fileURLToPath(descriptor[`${prefix}_WASM_URL`]);
    assert.equal(basename(located), `${artifact}_wasm.wasm`);
    assert.deepEqual(await readFile(located), wasmBinary, 'Relocatable descriptor selects this exact pair.');
  } finally {
    await rm(temporary, {recursive: true, force: true});
  }
  return {artifact, wasmBinary, wasmBytes: wasmBinary.byteLength,
    wasmMemoryBytes: 131072, noHostImports: true, fixedMemory: true, descriptorABI: 1};
}

async function smokeCDDA(wasmBinary) {
  const results = [];
  for (const sampleRate of [8000, 44100, 48000, 384000]) {
    const core = await createCDDAPCM({sampleRate, wasmBinary}), e = core.abi;
    assert.equal(e.cdda_wasm_init(0), 0);
    assert.equal(e.cdda_wasm_render(129), 0, 'Bounded 128-frame bridge output.');
    assert.equal(e.cdda_wasm_window(0, 1025), 0, 'Bounded 1024-frame input window.');
    assert.equal(e.cdda_wasm_prepare(0), 0);
    assert.equal(e.cdda_wasm_prepare(CDDA_PCM_MAX_BYTES / 4 + 1), 0);
    assert.throws(() => core.play());
    const bytes = new Uint8Array(1201 * 4), view = new DataView(bytes.buffer);
    for (let frame = 0; frame < 1201; ++frame) {
      view.setInt16(frame * 4, (frame * 137) % 65536 - 32768, true);
      view.setInt16(frame * 4 + 2, 32767 - (frame * 71) % 65536, true);
    }
    core.prepare(bytes); core.play();
    let left = new Float32Array(129), right = new Float32Array(129);
    core.render(left, right);
    assert(left.some(value => value !== 0)); assert.notDeepEqual(left, right, 'Actual stereo PCM.');
    const cursor = core.status(); core.pause(); core.render(left, right);
    assert(left.every(value => value === 0) && right.every(value => value === 0));
    assert.equal(core.status().positionFrames, cursor.positionFrames);
    assert.equal(core.status().phase, cursor.phase);
    core.resume(); core.setMuted(true); core.render(left, right);
    assert(left.every(value => value === 0));
    assert(core.status().positionFrames > cursor.positionFrames || core.status().phase !== cursor.phase,
      'Mute advances the PCM timeline.');
    core.setMuted(false); core.play(); core.seek(1200);
    left = new Float32Array(Math.ceil(sampleRate / 44100) + 3); right = new Float32Array(left.length);
    core.render(left, right);
    assert.equal(core.status().state, 'ended'); assert.equal(core.status().positionFrames, 1201);
    assert.equal(left.at(-1), 0); assert.equal(right.at(-1), 0);
    core.play(); assert.equal(core.status().positionFrames, 0, 'Replay starts at source start.');
    core.stop(); core.render(left, right); assert(left.every(value => value === 0));
    core.dispose(); assert.equal(core.status().durationFrames, 0);
    results.push({sampleRate, stereo: true, pauseResumeSeekEOF: true, muteAdvances: true});
  }
  return results;
}

async function smokeMSM5205(wasmBinary) {
  const results = [], source = Uint8Array.from({length: 65536}, (_, i) => (i * 73 + (i >> 3) + 0x37) & 255);
  for (const sampleRate of [44100, 48000]) {
    const core = await createMSM5205PCM({sampleRate, wasmBinary}), e = core.abi;
    assert.equal(e.msm5205_wasm_init(0, 1536000), 0);
    assert.equal(e.msm5205_wasm_prepare(0), 0); assert.equal(e.msm5205_wasm_prepare(65537), 0);
    assert.equal(e.msm5205_wasm_render(129), 0);
    assert.equal(e.msm5205_wasm_write(8, 0), 0);
    assert.equal(e.msm5205_wasm_write(0, 16), 0);
    core.prepare(source);
    for (let rate = 0; rate < 16; ++rate) {
      core.play({offset: 3, length: 7, rate});
      const n = Math.ceil(7 * sampleRate * 48 * (16 - rate) / 1536000);
      const left = new Float32Array(n + 17), right = new Float32Array(n + 17);
      core.render(left, right);
      assert.deepEqual(right, left, 'Mono decoder duplicated left and right.');
      assert(left.subarray(0, n).some(value => value !== 0), `Rate ${rate} produces real decoded PCM.`);
      assert(left.subarray(n).every(value => value === 0), 'Exact EOF is silent.');
      assert.equal(core.readState().state, 'ended'); assert.equal(core.readState().cursor, 10);
      core.play({offset: 131071, length: 1, rate, loop: true});
      core.setMuted(true); core.render(left, right);
      assert(left.every(value => value === 0)); assert.equal(core.readState().state, 'playing');
      core.setMuted(false); core.render(left, right); assert.equal(core.readState().state, 'playing');
      core.stop(); core.render(left, right); assert(left.every(value => value === 0));
    }
    core.reset(); assert.equal(core.readState().sourceBytes, 65536, 'Reset preserves attached RAM.');
    core.writeRegister(0, 1); core.writeRegister(0, 0); core.writeRegister(4, 3);
    core.writeRegister(1, 7); core.writeRegister(2, 0); core.writeRegister(2, 1);
    assert.equal(core.readState().mode, 'raw'); assert.equal(core.readState().signal, 30);
    const left = new Float32Array(17), right = new Float32Array(17);
    core.render(left, right); assert(left.every(value => value === Math.fround(30 / 2048)));
    core.dispose(); assert.equal(core.readState().sourceBytes, 0);
    results.push({sampleRate, all16RateRegisters: true, oddNibbleRanges: true,
      full64KiBRAM: true, rawRegisterPath: true, loopMuteStop: true});
  }
  return results;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert(process.argv.length <= 4,
    'Usage: node tests/application_audio_wasm_smoke.mjs [wasm-directory] [cdda|msm5205]');
  const directory = resolve(process.argv[2] ?? 'dist/wasm');
  const selection = process.argv[3] ? [process.argv[3]] : ['cdda', 'msm5205'];
  const results = [];
  for (const artifact of selection) {
    const {wasmBinary, ...receipt} = await checkApplicationAudioArtifact(directory, artifact);
    results.push({...receipt, checks: await (artifact === 'cdda' ? smokeCDDA : smokeMSM5205)(wasmBinary)});
  }
  console.log(JSON.stringify({status: 'PASS', format: 'standalone-audio-wasm', results}, null, 2));
}

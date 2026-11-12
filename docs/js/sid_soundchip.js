// Common-factory loading only. The dedicated SID cores retain their original
// register/PCM semantics and their existing single software DC blocker.
import {SidCore, SID_PAL_CLOCK} from './sid.js';
import {Sid8580Core} from './sid8580.js';

/** @param {import('./soundchip.js?v=pokey-prepare-1').SoundChipOptions} [options] */
export function validateSidSoundChipOptions(options = {}) {
  options.signal?.throwIfAborted();
  if (options.moduleFactory !== undefined) throw new TypeError('SID uses its dedicated WASM core, not an Emscripten moduleFactory');
  const model = options.model ?? '6581', clockHz = options.clock ?? SID_PAL_CLOCK, sampleRate = options.sampleRate ?? 48000;
  if (!['6581', '8580'].includes(model)) throw new RangeError('SID model must be 6581 or 8580');
  if (!Number.isInteger(clockHz) || clockHz < 900000 || clockHz > 1100000) throw new RangeError('SID clock must be an integer 900000..1100000 Hz');
  if (model === '8580' && clockHz !== SID_PAL_CLOCK) throw new RangeError('SID 8580 Preview requires the PAL clock 985248 Hz');
  if (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 96000) throw new RangeError('SID sampleRate must be an integer 8000..96000 Hz');
  const bytes = options.wasmBinary ?? options.moduleOptions?.wasmBinary;
  if (bytes !== undefined && !(bytes instanceof ArrayBuffer) && !ArrayBuffer.isView(bytes)) throw new TypeError('SID wasmBinary must be an ArrayBuffer or typed array');
  return {model, clockHz, sampleRate};
}

/** Load only the selected SID binary. The common factory uses its generated/
 * directory; individual SidCore imports keep their own historical defaults.
 * @param {import('./soundchip.js?v=pokey-prepare-1').SoundChipOptions} [options]
 * @returns {Promise<BufferSource>} */
export async function loadSidSoundChipBinary(options = {}) {
  const {model} = validateSidSoundChipOptions(options);
  let bytes = options.wasmBinary ?? options.moduleOptions?.wasmBinary;
  if (bytes === undefined) {
    const base = new URL(options.assetBaseUrl ?? '../generated/', import.meta.url);
    const relative = model === '8580' ? 'sid8580-machine/sid8580-endpoint.wasm' : 'sid/sid.wasm';
    const url = options.wasmUrl === undefined ? new URL(relative, base) : new URL(options.wasmUrl, import.meta.url);
    if (url.protocol === 'file:' && typeof process !== 'undefined' && process.versions?.node) {
      const {readFile} = await import('node:fs/promises');
      bytes = await readFile(url, {signal: options.signal});
    } else {
      const response = await fetch(url, {signal: options.signal});
      if (!response.ok) throw new Error(`SID ${model} WASM could not load (HTTP ${response.status})`);
      bytes = await response.arrayBuffer();
    }
  }
  options.signal?.throwIfAborted();
  if (!(bytes instanceof ArrayBuffer) && !ArrayBuffer.isView(bytes)) throw new TypeError('SID wasmBinary must be an ArrayBuffer or typed array');
  return bytes;
}

/** Return the existing low-level core, without initializing voices or opening
 * an audio device. A cancellation during WASM creation retires the late core.
 * @param {import('./soundchip.js?v=pokey-prepare-1').SoundChipOptions} [options]
 * @returns {Promise<SidCore|Sid8580Core>} */
export async function createSidSoundChip(options = {}) {
  const settings = validateSidSoundChipOptions(options), wasmBinary = await loadSidSoundChipBinary(options);
  const core = settings.model === '8580'
    ? await Sid8580Core.create({clockHz:settings.clockHz, sampleRate:settings.sampleRate, wasmBinary, signal:options.signal})
    : await SidCore.create({clockHz:settings.clockHz, sampleRate:settings.sampleRate, wasmBinary});
  try { options.signal?.throwIfAborted(); return core; }
  catch (error) { core.dispose(); throw error; }
}

/** The audio quantum already matches the SID core's configured rate. Copy its
 * mono output into both channels without a second resampler, filter or gain.
 * @param {SidCore|Sid8580Core} core */
export function createSidPCMRenderer(core) {
  const spans = new Map();
  return {
    rate: core.sampleRate,
    resetHistory() {},
    renderInto(left, right, offset = 0, frames = left.length - offset) {
      if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(frames) || frames < 0 ||
          frames > left.length - offset || frames > right.length - offset) throw new RangeError('Invalid SID PCM output span');
      if (!frames) return;
      let span = spans.get(frames);
      if (!span) {span = new Float32Array(frames); if (spans.size < 128) spans.set(frames, span);}
      core.renderInto(span); left.set(span, offset); right.set(span, offset);
    },
  };
}

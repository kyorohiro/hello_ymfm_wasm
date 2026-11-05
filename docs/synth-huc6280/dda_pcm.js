// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 kyorohiro.

export const MAX_DDA_SAMPLES = 16_777_216;
export const MAX_PRESET_BYTES = 32 * 1024 * 1024;
export const MAX_AUDIO_FILE_BYTES = 32 * 1024 * 1024;
export const MAX_DECODED_SECONDS = 30 * 60;
const MAX_BASE64_LENGTH = Math.ceil(MAX_DDA_SAMPLES / 3) * 4;
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const alphabetCodes = new Int16Array(128).fill(-1);
for (let i = 0; i < ALPHABET.length; i++) alphabetCodes[ALPHABET.charCodeAt(i)] = i;
const empty = new Uint8Array(0), decodedCache = new Map();
const CHUNK = 12_288; // Divisible by three; no huge spread/apply argument lists.
const WORK_QUANTUM = 65_536;

export function createDefaultDda() {
  return {name:'', data:'', sampleRate:11025, rootNote:60, loop:false, speed:1};
}

function abort(signal) {
  if (signal?.aborted) throw new DOMException('Audio import cancelled', 'AbortError');
}
async function pause(signal) {
  abort(signal);
  await new Promise(resolve => setTimeout(resolve, 0));
  abort(signal);
}
function remember(data, samples) {
  decodedCache.delete(data);
  decodedCache.set(data, samples);
  if (decodedCache.size > 2) decodedCache.delete(decodedCache.keys().next().value);
  return samples;
}
function inputSamples(samples) {
  if (!(samples instanceof Uint8Array) && !Array.isArray(samples)) throw new TypeError('DDA samples must be a Uint8Array or array');
  if (samples.length > MAX_DDA_SAMPLES) throw new RangeError('DDA exceeds 16,777,216 DAC samples');
}
function code(value) {
  if (!Number.isInteger(value) || value < 0 || value > 31) throw new RangeError('DDA sample must be an integer from 0 to 31');
  return value;
}
function encodeChunk(samples, begin, end) {
  let text = '';
  for (let i = begin; i < end; i += 3) {
    const a = code(samples[i]), hasB = i + 1 < samples.length, hasC = i + 2 < samples.length;
    const b = hasB ? code(samples[i + 1]) : 0, c = hasC ? code(samples[i + 2]) : 0;
    text += ALPHABET[a >> 2] + ALPHABET[(a & 3) << 4 | b >> 4]
      + (hasB ? ALPHABET[(b & 15) << 2 | c >> 6] : '=') + (hasC ? ALPHABET[c & 63] : '=');
  }
  return text;
}

/** Encode one byte for each 0..31 DAC value. The copy in the two-entry cache
 * belongs to this module, so changing the caller's array cannot change a preset.
 * No DOM, atob/btoa, Buffer or Node globals are required in an AudioWorklet. */
export function encodeDdaData(samples) {
  inputSamples(samples);
  if (!samples.length) return '';
  const snapshot = samples instanceof Uint8Array ? samples.slice() : Array.prototype.slice.call(samples);
  const parts = [];
  for (let begin = 0; begin < snapshot.length; begin += CHUNK) parts.push(encodeChunk(snapshot, begin, Math.min(snapshot.length, begin + CHUNK)));
  const data = parts.join('');
  remember(data, snapshot instanceof Uint8Array ? snapshot : Uint8Array.from(snapshot));
  return data;
}

/** Yield during large browser imports, including the base64 stage. */
export async function encodeDdaDataAsync(samples, {signal} = {}) {
  abort(signal); inputSamples(samples);
  if (!samples.length) return '';
  const snapshot = samples instanceof Uint8Array ? samples.slice() : Array.prototype.slice.call(samples);
  const parts = [];
  for (let begin = 0; begin < snapshot.length; begin += CHUNK) {
    parts.push(encodeChunk(snapshot, begin, Math.min(snapshot.length, begin + CHUNK)));
    if (begin && begin % (CHUNK * 4) === 0) await pause(signal);
  }
  abort(signal);
  const data = parts.join('');
  remember(data, snapshot instanceof Uint8Array ? snapshot : Uint8Array.from(snapshot));
  return data;
}

/** Validate canonical standard base64, its padding bits and every five-bit DAC
 * value. Returns a borrowed READ-ONLY view: consumers must never mutate it.
 * At most two decoded arrays are retained, avoiding a scan on every live edit. */
export function decodeDdaData(data) {
  if (typeof data !== 'string') throw new TypeError('DDA data must be canonical base64');
  if (!data.length) return empty;
  if (data.length > MAX_BASE64_LENGTH) throw new RangeError('DDA exceeds 16,777,216 DAC samples');
  if (data.length % 4) throw new TypeError('DDA data must be canonical base64');
  const known = decodedCache.get(data);
  if (known) return remember(data, known);
  const padding = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0;
  const length = data.length / 4 * 3 - padding;
  if (length > MAX_DDA_SAMPLES) throw new RangeError('DDA exceeds 16,777,216 DAC samples');
  const samples = new Uint8Array(length);
  let output = 0;
  const digit = index => {
    const character = data.charCodeAt(index);
    const value = character < 128 ? alphabetCodes[character] : -1;
    if (value < 0) throw new TypeError('DDA data must be canonical base64');
    return value;
  };
  for (let i = 0; i < data.length; i += 4) {
    const last = i + 4 === data.length;
    const a = digit(i), b = digit(i + 1);
    const c = last && padding === 2 ? 0 : digit(i + 2);
    const d = last && padding ? 0 : digit(i + 3);
    if (last && padding && (data[i + 3] !== '=' || padding === 2 && data[i + 2] !== '=')) throw new TypeError('DDA data must be canonical base64');
    if (last && (padding === 2 && (b & 15) || padding === 1 && (c & 3))) {
      throw new TypeError('DDA data must be canonical base64');
    }
    if (output < length) samples[output++] = code(a << 2 | b >> 4);
    if (output < length) samples[output++] = code((b & 15) << 4 | c >> 2);
    if (output < length) samples[output++] = code((c & 3) << 6 | d);
  }
  return remember(data, samples);
}

function rate(value, minimum, maximum, label) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) throw new RangeError(`${label} must be an integer ${minimum}–${maximum} Hz`);
}

/** Software preparation, not a HuC6280 hardware PCM decoder. Channels are mixed
 * equally without normalization. Downsampling uses area averages; upsampling
 * linearly interpolates. Full-scale values are clipped to the DAC's 0..31,
 * with Math.round(16 + 16*x) making digital silence exactly DAC center 16.
 * Input channel arrays are borrowed and must stay unchanged until completion. */
export async function quantizeAudio(channels, sourceRate, targetRate, {signal} = {}) {
  abort(signal);
  rate(sourceRate, 8000, 384000, 'Source rate'); rate(targetRate, 8000, 44100, 'Conversion rate');
  if (!Array.isArray(channels) || channels.length < 1 || channels.length > 32 || channels.some(channel => !(channel instanceof Float32Array))) {
    throw new TypeError('Audio requires 1–32 Float32Array channels');
  }
  const frames = channels[0].length;
  if (!frames || channels.some(channel => channel.length !== frames)) throw new RangeError('Audio channels must have the same nonzero length');
  if (frames / sourceRate > MAX_DECODED_SECONDS) throw new RangeError('Decoded audio exceeds 30 minutes');
  const length = Math.ceil(frames * targetRate / sourceRate);
  if (length > MAX_DDA_SAMPLES) throw new RangeError('Converted audio exceeds 16,777,216 DAC samples; choose a lower conversion rate or shorter recording');
  let budget = WORK_QUANTUM;
  for (const channel of channels) for (const sample of channel) {
    if (!Number.isFinite(sample)) throw new TypeError('Audio samples must be finite');
    if (--budget === 0) {await pause(signal); budget = WORK_QUANTUM;}
  }
  const result = new Uint8Array(length), ratio = sourceRate / targetRate;
  const mono = frame => {
    let sum = 0;
    for (const channel of channels) {
      const sample = channel[frame];
      if (!Number.isFinite(sample)) throw new TypeError('Audio samples must be finite');
      sum += sample;
    }
    return sum / channels.length;
  };
  budget = WORK_QUANTUM;
  for (let i = 0; i < length; i++) {
    let value;
    if (targetRate >= sourceRate) {
      const position = Math.min(frames - 1, i * ratio), first = Math.floor(position), fraction = position - first;
      const a = mono(first), b = mono(Math.min(frames - 1, first + 1));
      value = a + (b - a) * fraction; budget -= channels.length * 2;
    } else {
      const first = i * ratio, end = Math.min(frames, (i + 1) * ratio);
      let sum = 0;
      for (let frame = Math.floor(first); frame < Math.ceil(end); frame++) {
        const weight = Math.min(end, frame + 1) - Math.max(first, frame);
        if (weight > 0) sum += mono(frame) * weight;
        budget -= channels.length;
      }
      value = sum / (end - first);
    }
    result[i] = Math.max(0, Math.min(31, Math.round(16 + 16 * value)));
    if (budget <= 0) {await pause(signal); budget = WORK_QUANTUM;}
  }
  abort(signal);
  return result;
}

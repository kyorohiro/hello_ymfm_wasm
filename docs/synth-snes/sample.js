// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 kyorohiro.

// S-DSP RAM is 64 KiB. This Synth reserves $0000..$03ff for the sample
// directory and uses one replaceable BRR sample, with Echo writes disabled.
export const MAX_BRR_BYTES = 64512;
export const MAX_PCM_FRAMES = MAX_BRR_BYTES / 9 * 16;
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const digits = new Int16Array(128).fill(-1);
for (let index = 0; index < ALPHABET.length; index++) digits[ALPHABET.charCodeAt(index)] = index;
const cache = new Map(), empty = new Uint8Array(0);

function remember(data, bytes) {
  cache.delete(data);cache.set(data, bytes);
  if (cache.size > 2) cache.delete(cache.keys().next().value);
  return bytes;
}

/** Portable byte encoding, usable in an AudioWorklet without DOM or Node APIs.
 * The cached snapshot belongs to this module, not the caller's input array. */
export function encodeBase64(bytes) {
  if (!(bytes instanceof Uint8Array)) throw new TypeError('BRR bytes must be a Uint8Array');
  if (bytes.length > MAX_BRR_BYTES) throw new RangeError('BRR exceeds the 64,512-byte sample RAM budget');
  if (!bytes.length) return '';
  const snapshot = bytes.slice(), parts = [];
  for (let begin = 0; begin < snapshot.length; begin += 12288) {
    let text = '';
    const end = Math.min(snapshot.length, begin + 12288);
    for (let index = begin; index < end; index += 3) {
      const a = snapshot[index], hasB = index + 1 < snapshot.length, hasC = index + 2 < snapshot.length;
      const b = hasB ? snapshot[index + 1] : 0, c = hasC ? snapshot[index + 2] : 0;
      text += ALPHABET[a >> 2] + ALPHABET[(a & 3) << 4 | b >> 4]
        + (hasB ? ALPHABET[(b & 15) << 2 | c >> 6] : '=') + (hasC ? ALPHABET[c & 63] : '=');
    }
    parts.push(text);
  }
  const data = parts.join('');remember(data, snapshot);return data;
}

/** Validate canonical standard base64 and return a borrowed READ-ONLY array.
 * Consumers must not mutate it. The two-entry cache avoids repeatedly decoding
 * BRR during live Envelope / volume edits. Empty data means no loaded sample. */
export function decodeBase64(data) {
  if (typeof data !== 'string') throw new TypeError('BRR data must be canonical base64');
  if (!data.length) return empty;
  if (data.length > Math.ceil(MAX_BRR_BYTES / 3) * 4) throw new RangeError('BRR exceeds the 64,512-byte sample RAM budget');
  if (data.length % 4) throw new TypeError('BRR data must be canonical base64');
  if (cache.has(data)) return remember(data, cache.get(data));
  const padding = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0;
  const length = data.length / 4 * 3 - padding;
  if (length > MAX_BRR_BYTES) throw new RangeError('BRR exceeds the 64,512-byte sample RAM budget');
  const bytes = new Uint8Array(length);
  const digit = index => {
    const character = data.charCodeAt(index), value = character < 128 ? digits[character] : -1;
    if (value < 0) throw new TypeError('BRR data must be canonical base64');
    return value;
  };
  let output = 0;
  for (let index = 0; index < data.length; index += 4) {
    const last = index + 4 === data.length;
    const a = digit(index), b = digit(index + 1), c = last && padding === 2 ? 0 : digit(index + 2);
    const d = last && padding ? 0 : digit(index + 3);
    if (last && padding && (data[index + 3] !== '=' || padding === 2 && data[index + 2] !== '=')) throw new TypeError('BRR data must be canonical base64');
    if (last && (padding === 2 && (b & 15) || padding === 1 && (c & 3))) throw new TypeError('BRR data must be canonical base64');
    if (output < length) bytes[output++] = a << 2 | b >> 4;
    if (output < length) bytes[output++] = (b & 15) << 4 | c >> 2;
    if (output < length) bytes[output++] = (c & 3) << 6 | d;
  }
  return remember(data, bytes);
}

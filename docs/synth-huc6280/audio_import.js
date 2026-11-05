// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 kyorohiro.
import {MAX_AUDIO_FILE_BYTES, MAX_DECODED_SECONDS, createDefaultDda, quantizeAudio, encodeDdaDataAsync} from './dda_pcm.js';

const abort = signal => {if (signal?.aborted) throw new DOMException('Audio import cancelled', 'AbortError');};
const cleanName = value => (typeof value === 'string' ? value : 'Audio sample').replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, ' ').trim().slice(0,120) || 'Audio sample';

/** Decode without starting an AudioContext or speaker output. WAV is the
 * portable choice; other formats depend on the browser's installed decoders.
 * OfflineAudioContext.decodeAudioData has no cancellable operation, so a
 * cancelled result is discarded immediately after decoding completes. */
export async function prepareDdaAudio(file, {sampleRate = 11025, signal} = {}) {
  abort(signal);
  if (!file || typeof file.arrayBuffer !== 'function' || !Number.isSafeInteger(file.size) || file.size < 1) throw new TypeError('Choose a nonempty audio file');
  if (file.size > MAX_AUDIO_FILE_BYTES) throw new RangeError('Choose an audio file no larger than 32 MiB');
  if (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 44100) throw new RangeError('Conversion rate must be an integer 8000–44100 Hz');
  const Context = globalThis.OfflineAudioContext ?? globalThis.webkitOfflineAudioContext;
  if (!Context) throw new Error('This browser does not support offline audio decoding');
  const bytes = await file.arrayBuffer(); abort(signal);
  if (!(bytes instanceof ArrayBuffer) || !bytes.byteLength || bytes.byteLength > MAX_AUDIO_FILE_BYTES) throw new RangeError('Audio file must contain at most 32 MiB');
  let buffer;
  try {
    const decoder = new Context(1, 1, 44100);
    buffer = await decoder.decodeAudioData(bytes);
  } catch (error) {
    abort(signal);
    throw new Error('This audio file could not be decoded. Try a WAV file; other formats depend on browser codec support.', {cause:error});
  }
  abort(signal);
  if (!buffer || !Number.isInteger(buffer.sampleRate) || buffer.sampleRate < 8000 || buffer.sampleRate > 384000 || !Number.isSafeInteger(buffer.length) || buffer.length < 1 ||
      !Number.isInteger(buffer.numberOfChannels) || buffer.numberOfChannels < 1 || buffer.numberOfChannels > 32 ||
      typeof buffer.getChannelData !== 'function') throw new Error('Decoded audio has an invalid channel layout');
  if (buffer.length / buffer.sampleRate > MAX_DECODED_SECONDS) throw new RangeError('Decoded audio exceeds 30 minutes');
  const channels = Array.from({length:buffer.numberOfChannels}, (_, channel) => buffer.getChannelData(channel));
  const samples = await quantizeAudio(channels, buffer.sampleRate, sampleRate, {signal});
  const data = await encodeDdaDataAsync(samples, {signal}); abort(signal);
  return {...createDefaultDda(), name:cleanName(file.name), data, sampleRate};
}

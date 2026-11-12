// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 kyorohiro.
import {preparePs1ADPCM} from '../js/ps1synth.js?v=ps1-oneshot-marker-1';

const FILTERS = [[0, 0], [60, 0], [115, -52], [98, -55], [122, -60]];

/** Decode the complete, validated sample once from zero predictor history.
 * This is raw source PCM, before interpolation, ADSR, Noise, PMON or mixing.
 * Length, tuning and loop metadata are neither inferred nor changed. A loop
 * is decoded through its final packet once, retaining the intro and history.
 * sampleId/token belong to the caller's stale-source fence, not the decoder.
 *
 * @param {{adpcm:Uint8Array,baseFrequencyHz:number,loopStartSamples?:number|null}} source
 * @returns {Float32Array} An owned, full-length PCM buffer in [-1, 1).
 */
export function decodeSpuSamplePcm(source) {
  if (!source || typeof source !== 'object' || Array.isArray(source) || !(source.adpcm instanceof Uint8Array))
    throw new TypeError('SPU sample PCM needs a source with Uint8Array ADPCM bytes.');
  const options = {baseFrequencyHz: source.baseFrequencyHz};
  if (source.loopStartSamples != null) options.loopStartSamples = source.loopStartSamples;
  const prepared = preparePs1ADPCM(source.adpcm, options);
  const pcm = new Float32Array(prepared.decodedFrames);
  let previous = 0, previous2 = 0, frame = 0;
  for (let at = 0; at < prepared.adpcm.length; at += 16) {
    const header = prepared.adpcm[at], shift = header & 15, [a, b] = FILTERS[header >> 4];
    for (let index = 0; index < 28; index++) {
      const packed = prepared.adpcm[at + 2 + (index >> 1)];
      const nibble = (packed >> ((index & 1) * 4)) & 15;
      const signed = (nibble << 28) >> 28;
      // The pinned native decoder wraps to signed short after prediction.
      // Clamping would change both this sample and every later prediction.
      const sum = ((signed << 12) >> shift) + ((previous * a + previous2 * b + 32) >> 6);
      const decoded = (sum << 16) >> 16;
      pcm[frame++] = decoded / 32768;
      previous2 = previous; previous = decoded;
    }
  }
  return pcm;
}

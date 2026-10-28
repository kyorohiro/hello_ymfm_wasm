// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026, kyorohiro.
/** Prepare-side only: encode one short original PCM cycle for the SPU editor.
 * AudioWorklet receives the bounded packets; it never runs this encoder.
 */
import {encodePs1Adpcm} from './ps1_adpcm_encoder.js?v=ps1-adpcm-encoder-1';
export const PS1_WAVEFORM_FRAMES = 112;
export const PS1_WAVEFORM_BYTES = 64;
export const PS1_WAVEFORM_FREQUENCY_HZ = 44100 / PS1_WAVEFORM_FRAMES;
/** @param {Float32Array|number[]} input */
export function preparePs1Waveform(input) {
  if (!(input instanceof Float32Array) && !Array.isArray(input)) throw new TypeError('PS1 waveform must be a Float32Array or number array');
  if (input.length !== PS1_WAVEFORM_FRAMES) throw new RangeError('PS1 waveform requires exactly 112 PCM samples');
  for (const value of input) if (!Number.isFinite(value) || value < -1 || value > 1) throw new RangeError('PS1 waveform PCM must be finite and in [-1, 1]');
  const pcm = Float32Array.from(input);
  const {adpcm} = encodePs1Adpcm(pcm, {loopStartSamples:0, maxBytes:PS1_WAVEFORM_BYTES});
  return {pcm:Array.from(pcm), adpcm};
}

// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026, kyorohiro.
/** Browser / Worker / Node: bounded mono PCM to Yamaha ADPCM-A conversion.
 * This is ADPCM-A sample data for YM2610/YM2610B, not ADPCM-B or PCM WAV.
 * No resampling, gain normalization, pitch inference or looping is performed.
 */

// Decoder constants and arithmetic follow ymfm's BSD-licensed ADPCM-A core
// (src/ymfm_adpcm.cpp, Copyright (c) 2021, Aaron Giles; see LICENSE).
const STEPS = [
  16, 17, 19, 21, 23, 25, 28,
  31, 34, 37, 41, 45, 50, 55,
  60, 66, 73, 80, 88, 97, 107,
  118, 130, 143, 157, 173, 190, 209,
  230, 253, 279, 307, 337, 371, 408,
  449, 494, 544, 598, 658, 724, 796,
  876, 963, 1060, 1166, 1282, 1411, 1552,
];
const STEP_INCREMENTS = [-1, -1, -1, -1, 2, 5, 7, 9];
const DELTAS = Int16Array.from({length:49 * 16}, (_, index) => {
  const code = index & 15;
  const magnitude = Math.floor((2 * (code & 7) + 1) * STEPS[index >> 4] / 8);
  return code & 8 ? -magnitude : magnitude;
});
const NEXT_STEPS = Uint8Array.from({length:49 * 16}, (_, index) =>
  Math.max(0, Math.min(48, (index >> 4) + STEP_INCREMENTS[index & 7])));

/** Encode normalized mono Float32 PCM as complete 256-byte ADPCM-A units.
 *
 * Input values must be finite and in [-1, 1]. The caller must supply PCM at
 * the chip's ADPCM-A playback rate: this function does not resample. ADPCM-A
 * has no stored sample rate or tuning metadata. At the standard 8 MHz YM2610
 * clock the decoded rate is clock / 432 (approximately 18,518.5 Hz).
 *
 * Each sample searches all 16 nibbles, choosing the smallest squared error
 * against the exact reconstructed signed 12-bit predictor divided by 2048.
 * Ties prefer the lower unsigned nibble. The predictor starts at zero, the
 * step index starts at zero, high nibbles come first, and accumulator overflow
 * wraps to 12 bits rather than clipping. These are ADPCM-A decoder rules;
 * ADPCM-B uses a different codec and cannot play these bytes.
 *
 * Padding to a 256-byte (512-frame) address unit is explicitly encoded toward
 * zero with the same predictor state. Zero-filled compressed bytes would not
 * produce silence. Even encoded zero PCM has a small quantization error.
 * The caller must stop playback at the encoded end; padding is not a loop.
 *
 * maxBytes defaults to 0xfff00 and is limited to that per-sample size by the
 * current YM2610BAdpcmASynth.setSample API. This is independent of the chip's
 * total ROM allocation and caller-managed sample bank placement. Capacity is
 * checked before encoding; input is never truncated or modified. Runtime is
 * linear in encoded frames and working memory is bounded apart from output.
 *
 * frames includes padding; sourceFrames and paddingFrames describe its size.
 * Metrics use the original input frames only, in normalized PCM units, before
 * chip attenuation, mixing or sample-rate conversion. snrDb is null for exact
 * reconstruction or a zero input signal; exact distinguishes those cases.
 * All metrics are finite numbers or null and can be stored as JSON.
 *
 * @param {Float32Array} pcm Normalized finite mono PCM, at the intended playback rate.
 * @param {{maxBytes?:number}} [options]
 * @returns {{bytes:Uint8Array,sourceFrames:number,frames:number,paddingFrames:number,
 *   metrics:{rmsError:number,maxError:number,signalRms:number,snrDb:number|null,errorFrames:number,exact:boolean}}}
 */
export function encodeAdpcmA(pcm, options = {}) {
  if (!(pcm instanceof Float32Array)) throw new TypeError('ADPCM-A PCM must be a mono Float32Array');
  if (!pcm.length) throw new RangeError('ADPCM-A PCM must contain at least one sample');
  if (options === null || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('ADPCM-A options must be an object');
  }
  for (const key of Reflect.ownKeys(options)) {
    if (key !== 'maxBytes') throw new TypeError(`Unknown ADPCM-A option: ${String(key)}`);
  }
  const {maxBytes = 0xfff00} = options;
  if (!Number.isInteger(maxBytes) || maxBytes < 256 || maxBytes > 0xfff00) {
    throw new RangeError('maxBytes must be an integer from 256 to 0xfff00');
  }
  const sourceFrames = pcm.length;
  const byteLength = Math.ceil(sourceFrames / 512) * 256;
  if (byteLength > maxBytes) throw new RangeError('ADPCM-A PCM exceeds maxBytes; input is not truncated');
  for (let i = 0; i < sourceFrames; i++) {
    if (!Number.isFinite(pcm[i]) || pcm[i] < -1 || pcm[i] > 1) {
      throw new RangeError(`ADPCM-A PCM sample ${i} must be finite and in [-1, 1]`);
    }
  }

  const bytes = new Uint8Array(byteLength);
  const frames = byteLength * 2;
  let predictor = 0, stepIndex = 0;
  let errorSquared = 0, signalSquared = 0, maxError = 0;
  for (let frame = 0; frame < frames; frame++) {
    const target = frame < sourceFrames ? pcm[frame] * 2048 : 0;
    const tableOffset = stepIndex << 4;
    let bestCode = 0, bestValue = 0, bestError = Infinity;
    for (let code = 0; code < 16; code++) {
      // Sign-extend the low 12 bits after addition, exactly as the core's
      // unsigned 12-bit accumulator is sign-extended for its raw PCM output.
      const value = ((predictor + DELTAS[tableOffset + code]) << 20) >> 20;
      const difference = target - value;
      const squared = difference * difference;
      if (squared < bestError) {
        bestError = squared;
        bestCode = code;
        bestValue = value;
      }
    }
    bytes[frame >> 1] |= bestCode << (frame & 1 ? 0 : 4);
    predictor = bestValue;
    stepIndex = NEXT_STEPS[tableOffset + bestCode];
    if (frame < sourceFrames) {
      errorSquared += bestError;
      signalSquared += target * target;
      maxError = Math.max(maxError, Math.abs(target - predictor));
    }
  }
  return {
    bytes, sourceFrames, frames, paddingFrames:frames - sourceFrames,
    metrics:{
      rmsError:Math.sqrt(errorSquared / sourceFrames) / 2048,
      maxError:maxError / 2048,
      signalRms:Math.sqrt(signalSquared / sourceFrames) / 2048,
      snrDb:errorSquared === 0 || signalSquared === 0 ? null : 10 * Math.log10(signalSquared / errorSquared),
      errorFrames:sourceFrames,
      exact:errorSquared === 0,
    },
  };
}

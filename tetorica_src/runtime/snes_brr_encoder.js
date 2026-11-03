/** Browser / Worker / Node: bounded mono PCM to SNES BRR conversion.
 * BRR is lossy sample data. This encoder does not resample, normalize gain,
 * infer a root note, or apply S-DSP interpolation, envelopes or effects.
 */
const BLOCK_SAMPLES = 16;
const BLOCK_BYTES = 9;
const RAM_BYTES = 65536;
/** Default space available to BRR samples in an otherwise empty SnesSynth. */
export const DEFAULT_BRR_MAX_BYTES = 64512;

function integer(value, min, max, name) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new RangeError(`${name} must be an integer from ${min} to ${max}`);
  }
  return value;
}

// Signed nibbles are searched in ascending order. Range 13..15 has a special
// hardware meaning and is deliberately never emitted by this encoder.
const RESIDUALS = Array.from({length:13}, (_, shift) =>
  Int16Array.from({length:16}, (_, index) => ((index - 8) << shift) >> 1));

/** Convert normalized mono Float32 PCM to complete 9-byte BRR blocks.
 * Input values must be finite and in [-1, 1]; samples are never clipped or
 * normalized before encoding. The input and loop marker use the same sample
 * units as the output: this function performs no sample-rate conversion.
 *
 * One-shots are explicitly zero-padded to 16 samples. Loops require an already
 * aligned input length and an aligned, in-bounds loopStartSamples. Filter 0 at
 * both the first and loop-start blocks makes those blocks independent of the
 * incoming predictor history. Later blocks choose the smallest block error
 * among filters 0..3 and shifts 0..12 using greedy, exhaustive nibble search.
 * Ties prefer the first filter, shift and signed nibble in ascending order.
 *
 * The output is bounded to one 64-KiB RAM image; maxBytes defaults to the
 * 64,512 bytes available in an empty SnesSynth. Callers using a SnesSynth with
 * existing samples or a different directory layout must manage its remaining
 * RAM budget. Capacity checks happen before encoding, and oversized input is
 * rejected rather than truncated.
 *
 * Metrics compare original input frames with exact reconstructed raw BRR PCM
 * before S-DSP interpolation/envelopes. Padding is excluded. rmsError,
 * maxError and signalRms use normalized PCM units. snrDb is null for an exact
 * match or a zero signal; exact distinguishes a lossless reconstruction. All
 * metrics can be saved as JSON. frames is the encoded length; paddingFrames
 * is the number of added zeros.
 *
 * @param {Float32Array} pcm
 * @param {{loopStartSamples?:number|null,maxBytes?:number}} [options]
 * @returns {{brr:Uint8Array,sourceFrames:number,frames:number,paddingFrames:number,
 *   blockCount:number,loopStartSamples:number|null,
 *   metrics:{rmsError:number,maxError:number,snrDb:number|null,signalRms:number,errorFrames:number,exact:boolean}}}
 */
export function encodeBrr(pcm, options = {}) {
  if (!(pcm instanceof Float32Array)) throw new TypeError('BRR PCM must be a mono Float32Array');
  if (!pcm.length) throw new RangeError('BRR PCM must contain at least one sample');
  if (options === null || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('BRR options must be an object');
  }
  for (const key of Reflect.ownKeys(options)) {
    if (key !== 'loopStartSamples' && key !== 'maxBytes') {
      throw new TypeError(`Unknown BRR option: ${String(key)}`);
    }
  }
  const {loopStartSamples = null, maxBytes = DEFAULT_BRR_MAX_BYTES} = options;
  integer(maxBytes, BLOCK_BYTES, RAM_BYTES, 'maxBytes');
  const sourceFrames = pcm.length;
  const blockCount = Math.ceil(sourceFrames / BLOCK_SAMPLES);
  const frames = blockCount * BLOCK_SAMPLES;
  if (blockCount * BLOCK_BYTES > maxBytes) throw new RangeError('BRR PCM exceeds maxBytes; input is not truncated');
  if (loopStartSamples !== null) {
    integer(loopStartSamples, 0, sourceFrames - 1, 'loopStartSamples');
    if (loopStartSamples % BLOCK_SAMPLES || sourceFrames % BLOCK_SAMPLES) {
      throw new RangeError('Loop start and looping PCM length must be aligned to 16 samples');
    }
  }
  for (let i = 0; i < sourceFrames; i++) {
    if (!Number.isFinite(pcm[i]) || pcm[i] < -1 || pcm[i] > 1) {
      throw new RangeError(`BRR PCM sample ${i} must be finite and in [-1, 1]`);
    }
  }

  const brr = new Uint8Array(blockCount * BLOCK_BYTES);
  const targets = new Float64Array(BLOCK_SAMPLES);
  const candidateNibbles = new Int8Array(BLOCK_SAMPLES);
  const candidateSamples = new Int16Array(BLOCK_SAMPLES);
  const bestNibbles = new Int8Array(BLOCK_SAMPLES);
  const bestSamples = new Int16Array(BLOCK_SAMPLES);
  let history1 = 0, history2 = 0;
  let errorSquared = 0, signalSquared = 0, maxError = 0;
  for (let block = 0; block < blockCount; block++) {
    const frameOffset = block * BLOCK_SAMPLES;
    for (let n = 0; n < BLOCK_SAMPLES; n++) {
      targets[n] = frameOffset + n < sourceFrames ? pcm[frameOffset + n] * 32768 : 0;
    }
    const lastFilter = block === 0 || frameOffset === loopStartSamples ? 0 : 3;
    let bestError = Infinity, bestFilter = 0, bestShift = 0;
    for (let filter = 0; filter <= lastFilter; filter++) {
      for (let shift = 0; shift <= 12; shift++) {
        const residuals = RESIDUALS[shift];
        let p1 = history1, p2 = history2, blockError = 0;
        for (let n = 0; n < BLOCK_SAMPLES; n++) {
          // Match snes_brr.js / the accurate S-DSP decoder's integer shifts,
          // clamp, then signed 15-bit wrap. Predictor state is decoded PCM.
          let prediction = 0;
          if (filter >= 2) {
            const halfP2 = p2 >> 1;
            prediction = p1 - halfP2;
            if (filter === 2) prediction += (halfP2 >> 4) + ((p1 * -3) >> 6);
            else prediction += ((p1 * -13) >> 7) + ((halfP2 * 3) >> 4);
          } else if (filter === 1) prediction = (p1 >> 1) + ((-p1) >> 5);
          let sampleError = Infinity, sampleValue = 0, sampleNibble = 0;
          for (let index = 0; index < 16; index++) {
            let value = residuals[index] + prediction;
            value = Math.max(-32768, Math.min(32767, value));
            value = (value * 2 << 16) >> 16;
            const difference = targets[n] - value;
            const squared = difference * difference;
            if (squared < sampleError) {
              sampleError = squared;
              sampleValue = value;
              sampleNibble = index - 8;
            }
          }
          candidateNibbles[n] = sampleNibble;
          candidateSamples[n] = sampleValue;
          p2 = p1; p1 = sampleValue;
          blockError += sampleError;
          // Remaining errors cannot improve a candidate that is already tied
          // or worse. Ascending search order resolves equal-error candidates.
          if (blockError >= bestError) break;
        }
        if (blockError < bestError) {
          bestError = blockError;
          bestFilter = filter;
          bestShift = shift;
          bestNibbles.set(candidateNibbles);
          bestSamples.set(candidateSamples);
        }
      }
    }
    const byteOffset = block * BLOCK_BYTES;
    const flags = block === blockCount - 1 ? (loopStartSamples === null ? 1 : 3) : 0;
    brr[byteOffset] = (bestShift << 4) | (bestFilter << 2) | flags;
    for (let n = 0; n < BLOCK_SAMPLES; n += 2) {
      brr[byteOffset + 1 + (n >> 1)] = ((bestNibbles[n] & 15) << 4) | (bestNibbles[n + 1] & 15);
    }
    history1 = bestSamples[15];
    history2 = bestSamples[14];
    for (let n = 0; n < BLOCK_SAMPLES && frameOffset + n < sourceFrames; n++) {
      const difference = targets[n] - bestSamples[n];
      errorSquared += difference * difference;
      signalSquared += targets[n] * targets[n];
      maxError = Math.max(maxError, Math.abs(difference));
    }
  }
  return {
    brr, sourceFrames, frames, paddingFrames:frames - sourceFrames, blockCount, loopStartSamples,
    metrics:{
      rmsError:Math.sqrt(errorSquared / sourceFrames) / 32768,
      maxError:maxError / 32768,
      snrDb:errorSquared === 0 || signalSquared === 0 ? null : 10 * Math.log10(signalSquared / errorSquared),
      signalRms:Math.sqrt(signalSquared / sourceFrames) / 32768,
      errorFrames:sourceFrames,
      exact:errorSquared === 0,
    },
  };
}

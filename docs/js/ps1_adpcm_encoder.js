// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026, kyorohiro.
/** Browser / Worker / Node: bounded mono PCM to PlayStation SPU ADPCM.
 * This original encoder uses the arithmetic of the pinned BSD-3-Clause
 * decoder in third_party/tetorica-soundchip-native/vendor/mame-ps1-spu/spu.cpp (pSXAuthor and R. Belmont; see its notices).
 * It does not resample, normalize, infer tuning, or apply SPU interpolation,
 * envelopes, volume, or effects. This module has no audio or core side effects.
 */
const BLOCK_SAMPLES = 28;
const BLOCK_BYTES = 16;
const RAM_BYTES = 524288;
/** Space available to sample uploads in an otherwise empty Ps1Synth. */
export const DEFAULT_PS1_ADPCM_MAX_BYTES = RAM_BYTES - 4096;

// The corresponding pinned decoder adds ((p1*f0+p2*f1+32)>>6) to the
// sign-extended nibble shifted right by the packet's shift, then writes short.
const FILTERS = [[0,0],[60,0],[115,-52],[98,-55],[122,-60]];
function integer(value,min,max,name) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new RangeError(`${name} must be an integer from ${min} to ${max}`);
  }
  return value;
}

/** Convert normalized mono Float32 PCM to 16-byte / 28-frame SPU packets.
 * Input values must be finite in [-1, 1]. Conversion neither clips nor rounds
 * input PCM to int16 first; quantization error therefore includes that step.
 * Input frames and loop positions are source-sample units, with no resampling.
 *
 * One-shots are explicitly zero-padded to a complete packet. Loops require an
 * already aligned length and aligned, in-bounds loopStartSamples. Filter 0 at
 * the first and loop-start packets makes entry independent of decoder history.
 * All later packets search filters 0..4 and shifts 0..12 for the smallest sum
 * of raw squared reconstruction errors. Each candidate greedily selects the
 * nearest admissible signed nibble, exactly equivalent to searching -8..7.
 * Equal errors prefer ascending filter, shift, then signed nibble.
 *
 * The native decoder wraps overflowing sums to signed short. This encoder
 * deliberately excludes every nibble with an overflowing unwrapped sum; an
 * entire candidate is rejected if it has no admissible nibble at any frame.
 * Filter 0 always supplies a valid fallback. Thus it cannot exploit wraparound
 * for a superficially smaller error, and its metrics match actual decoding.
 * Quantization is greedy within a packet, not a global optimal-path search.
 *
 * maxBytes defaults to the 520,192 bytes available in an empty Ps1Synth. An
 * explicit raw-RAM budget may be at most 512 KiB. Callers must subtract space
 * already allocated in their Synth. Capacity is checked before encoding;
 * oversized input is rejected, never truncated. Output plus fixed packet
 * scratch arrays are allocated; no full-size PCM copy is needed.
 *
 * Metrics compare original frames with reconstructed raw int16 PCM / 32768,
 * before interpolation, envelopes and effects; zero padding is excluded.
 * rmsError, maxError and signalRms use normalized PCM units. snrDb is null for
 * an exact match or zero signal. exact distinguishes lossless reconstruction.
 * Metrics are JSON-safe. frames includes padding; sourceFrames does not.
 *
 * @param {Float32Array} pcm
 * @param {{loopStartSamples?:number|null,maxBytes?:number}} [options]
 * @returns {{adpcm:Uint8Array,sourceFrames:number,frames:number,paddingFrames:number,
 *   blockCount:number,loopStartSamples:number|null,
 *   metrics:{rmsError:number,maxError:number,signalRms:number,snrDb:number|null,errorFrames:number,exact:boolean}}}
 */
export function encodePs1Adpcm(pcm,options={}) {
  if (!(pcm instanceof Float32Array)) throw new TypeError('PS1 ADPCM PCM must be a mono Float32Array');
  if (!pcm.length) throw new RangeError('PS1 ADPCM PCM must contain at least one sample');
  if (options === null || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('PS1 ADPCM options must be an object');
  }
  for (const key of Reflect.ownKeys(options)) {
    if (key !== 'loopStartSamples' && key !== 'maxBytes') {
      throw new TypeError(`Unknown PS1 ADPCM option: ${String(key)}`);
    }
  }
  const {loopStartSamples=null,maxBytes=DEFAULT_PS1_ADPCM_MAX_BYTES}=options;
  integer(maxBytes,BLOCK_BYTES,RAM_BYTES,'maxBytes');
  const sourceFrames=pcm.length,blockCount=Math.ceil(sourceFrames/BLOCK_SAMPLES);
  const frames=blockCount*BLOCK_SAMPLES;
  if (blockCount*BLOCK_BYTES > maxBytes) throw new RangeError('PS1 ADPCM PCM exceeds maxBytes; input is not truncated');
  if (loopStartSamples !== null) {
    integer(loopStartSamples,0,sourceFrames-1,'loopStartSamples');
    if (loopStartSamples%BLOCK_SAMPLES || sourceFrames%BLOCK_SAMPLES) {
      throw new RangeError('Loop start and looping PCM length must be aligned to 28 samples');
    }
  }
  for (let i=0;i<sourceFrames;i++) {
    if (!Number.isFinite(pcm[i]) || pcm[i] < -1 || pcm[i] > 1) {
      throw new RangeError(`PS1 ADPCM PCM sample ${i} must be finite and in [-1, 1]`);
    }
  }

  const adpcm=new Uint8Array(blockCount*BLOCK_BYTES);
  const targets=new Float64Array(BLOCK_SAMPLES);
  const candidateNibbles=new Int8Array(BLOCK_SAMPLES),candidateSamples=new Int16Array(BLOCK_SAMPLES);
  const bestNibbles=new Int8Array(BLOCK_SAMPLES),bestSamples=new Int16Array(BLOCK_SAMPLES);
  let history1=0,history2=0,errorSquared=0,signalSquared=0,maxError=0;
  for (let block=0;block<blockCount;block++) {
    const frameOffset=block*BLOCK_SAMPLES;
    for (let n=0;n<BLOCK_SAMPLES;n++) targets[n]=frameOffset+n<sourceFrames?pcm[frameOffset+n]*32768:0;
    const lastFilter=block===0 || frameOffset===loopStartSamples?0:4;
    let bestError=Infinity,bestFilter=0,bestShift=0;
    for (let filter=0;filter<=lastFilter;filter++) {
      const [f0,f1]=FILTERS[filter];
      for (let shift=0;shift<=12;shift++) {
        const step=4096>>shift;
        let p1=history1,p2=history2,blockError=0;
        for (let n=0;n<BLOCK_SAMPLES;n++) {
          const prediction=(p1*f0+p2*f1+32)>>6;
          const minNibble=Math.max(-8,Math.ceil((-32768-prediction)/step));
          const maxNibble=Math.min(7,Math.floor((32767-prediction)/step));
          if (minNibble>maxNibble) {blockError=Infinity;break;}
          // Halfway ties select the smaller signed nibble. Since residuals
          // form a uniform lattice, this is exact exhaustive nearest search.
          const nibble=Math.min(maxNibble,Math.max(minNibble,Math.ceil((targets[n]-prediction)/step-.5)));
          const value=prediction+nibble*step,difference=targets[n]-value;
          candidateNibbles[n]=nibble;candidateSamples[n]=value;
          p2=p1;p1=value;blockError+=difference*difference;
          if (blockError>=bestError) break;
        }
        if (blockError<bestError) {
          bestError=blockError;bestFilter=filter;bestShift=shift;
          bestNibbles.set(candidateNibbles);bestSamples.set(candidateSamples);
        }
        if (bestError===0) break;
      }
      if (bestError===0) break;
    }
    const byteOffset=block*BLOCK_BYTES;
    adpcm[byteOffset]=(bestFilter<<4)|bestShift;
    adpcm[byteOffset+1]=(block===blockCount-1?(loopStartSamples===null?1:3):0) |
      (frameOffset===loopStartSamples?6:0);
    for (let n=0;n<BLOCK_SAMPLES;n+=2) {
      adpcm[byteOffset+2+(n>>1)]=(bestNibbles[n]&15)|((bestNibbles[n+1]&15)<<4);
    }
    history1=bestSamples[27];history2=bestSamples[26];
    for (let n=0;n<BLOCK_SAMPLES && frameOffset+n<sourceFrames;n++) {
      const difference=targets[n]-bestSamples[n];
      errorSquared+=difference*difference;signalSquared+=targets[n]*targets[n];
      maxError=Math.max(maxError,Math.abs(difference));
    }
  }
  return {adpcm,sourceFrames,frames,paddingFrames:frames-sourceFrames,blockCount,loopStartSamples,
    metrics:{rmsError:Math.sqrt(errorSquared/sourceFrames)/32768,maxError:maxError/32768,
      signalRms:Math.sqrt(signalSquared/sourceFrames)/32768,
      snrDb:errorSquared===0 || signalSquared===0?null:10*Math.log10(signalSquared/errorSquared),
      errorFrames:sourceFrames,exact:errorSquared===0}};
}

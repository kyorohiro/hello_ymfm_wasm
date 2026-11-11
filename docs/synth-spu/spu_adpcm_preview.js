// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 kyorohiro.
import {decodePsfAdpcmPreview} from './psf_live_snapshot.js?v=psf-live-spu-1';

/** Immutable source bytes are the cache key, not a reusable sample ID. Reading
 * a preview never reads SPU RAM or scans past the first four ADPCM packets.
 * Failures are display-only and must not prevent an instrument from loading. */
export function createSpuAdpcmPreviewCache({decode=decodePsfAdpcmPreview}={}) {
  const cache=new WeakMap();
  return {
    read(bytes) {
      if(!(bytes instanceof Uint8Array))return {preview:null,unavailableReason:'Original ADPCM bytes are unavailable.'};
      if(cache.has(bytes))return cache.get(bytes);
      let result;
      try {
        const decoded=decode(bytes.subarray(0,Math.min(64,bytes.length)));
        const preview=Object.freeze({...decoded,pcm:Object.freeze(decoded.pcm.slice()),
          source:'sample-start',history:'zero-at-sample-start',sampleByteLength:bytes.length});
        result=Object.freeze({preview,unavailableReason:null});
      }catch(error) {
        result=Object.freeze({preview:null,unavailableReason:error?.message??String(error)});
      }
      cache.set(bytes,result);return result;
    },
  };
}

/** Display data is deliberately separate from the editable original PCM. */
export function appliedSpuAdpcmPreview(voice) {
  const value=voice?.adpcmPreview;
  return value&&value.sample===voice?.sample&&value.preview===true&&value.source==='sample-start'&&
    Number.isInteger(value.decodedFrames)&&value.decodedFrames>0&&value.decodedFrames<=112&&
    Array.isArray(value.pcm)&&value.pcm.length===112&&value.pcm.every(sample=>Number.isFinite(sample)&&sample>=-1&&sample<=1)
    ?value:null;
}

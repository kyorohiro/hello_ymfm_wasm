import {createPcmPreset,normalizePcmPreset,pcmSampleBytes} from './synth_pcm.js?v=pcm-live-end-1';

const sampleFields=['name','sampleRate','encoding','data'];
const encodeValue=value=>Math.min(126,Math.round(Math.abs(value)*126))|(value>=0?128:0);
function encodeBytes(bytes) {
  const chunks=[];
  for(let offset=0;offset<bytes.length;offset+=8192)chunks.push(String.fromCharCode(...bytes.subarray(offset,offset+8192)));
  return btoa(chunks.join(''));
}

/** One software drawing stroke over an existing RF5C164 sample.
 * Source bytes outside the stroke keep their exact encoding, including signed
 * zero and negative magnitude 127. Drawing itself uses magnitude 0..126 so it
 * can never create the reserved positive-127 (0xff) loop marker.
 * @param {Parameters<typeof normalizePcmPreset>[0]} preset
 */
export function createPcmWaveDraft(preset) {
  const original=normalizePcmPreset(preset),source=pcmSampleBytes(original.sample),bytes=source.slice();
  let previous=null;
  return {
    // Renderer view only. finish() still validates the entire resulting preset
    // before it can cross into the existing instrument/RAM-install path.
    bytes,
    /** Paint one point and every source frame from the preceding point.
     * @param {{index:number,value:number}} point
     * @returns {boolean} Whether this segment changed any encoded byte. */
    setPoint(point) {
      if(!point||typeof point!=='object'||Array.isArray(point))throw new TypeError('PCM drawing needs a frame and amplitude');
      const {index,value}=point;
      if(!Number.isInteger(index)||index<0||index>=bytes.length)throw new RangeError('PCM drawing frame is outside the sample');
      if(typeof value!=='number'||!Number.isFinite(value))throw new TypeError('PCM drawing amplitude must be finite');
      const next={index,value:Math.max(-1,Math.min(1,value))},start=previous??next;
      let changed=false;
      for(let frame=Math.min(start.index,index);frame<=Math.max(start.index,index);frame++) {
        const amount=index===start.index?1:(frame-start.index)/(index-start.index);
        const encoded=encodeValue(start.value+(next.value-start.value)*amount);
        if(bytes[frame]!==encoded){bytes[frame]=encoded;changed=true;}
      }
      previous=next;return changed;
    },
    /** Commit once, retaining settings changed during the stroke. A replacement
     * sample invalidates this draft rather than restoring its obsolete source.
     * @param {Parameters<typeof normalizePcmPreset>[0]} [currentPreset]
     * @returns {ReturnType<typeof normalizePcmPreset>|null} null means no byte changed. */
    finish(currentPreset=original) {
      const current=normalizePcmPreset(currentPreset);
      if(sampleFields.some(field=>current.sample[field]!==original.sample[field]))throw new Error('PCM sample changed while drawing; current sample kept');
      if(bytes.every((value,index)=>value===source[index]))return null;
      return createPcmPreset({sample:{...current.sample,data:encodeBytes(bytes)},settings:current.settings});
    },
  };
}

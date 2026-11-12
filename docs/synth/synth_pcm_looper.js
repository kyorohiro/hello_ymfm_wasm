import {SynthPcmRecordingManager} from './synth_pcm_recording.js?v=pcm-live-draw-1';
import {SynthLayerLooper,LAYER_LOOP_MIN_SECONDS,LAYER_LOOP_MAX_SECONDS,LAYER_LOOP_MAX_UNITS,LAYER_LOOP_MAX_PCM_BYTES} from './synth_layer_looper.js?v=pcm-looper-1';

export const PCM_LOOP_MIN_SECONDS=LAYER_LOOP_MIN_SECONDS;
export const PCM_LOOP_MAX_SECONDS=LAYER_LOOP_MAX_SECONDS;
export const PCM_LOOP_MAX_UNITS=LAYER_LOOP_MAX_UNITS;
export const PCM_LOOP_MAX_PCM_BYTES=LAYER_LOOP_MAX_PCM_BYTES;

/** Each layer captures its own complete PCM sample/settings, not the editor RAM. */
export class SynthPcmLooper extends SynthLayerLooper {
  constructor({getPreset,getPitchClock=()=>7670454,...options}={}) {
    if(typeof getPreset!=='function'||typeof getPitchClock!=='function')throw new TypeError('PCM looper preset and pitch clock must be functions');
    super({...options,label:'PCM',idPrefix:'pcm',maxTailSeconds:.006,
      createRecorder:({now})=>new SynthPcmRecordingManager({now,getPreset,getPitchClock})});
    this.getPreset=getPreset;this.getPitchClock=getPitchClock;
  }
}

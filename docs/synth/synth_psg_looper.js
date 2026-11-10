import {SynthPsgRecordingManager} from './synth_psg_recording.js?v=psg-event-rec-1';
import {SynthLayerLooper,LAYER_LOOP_MIN_SECONDS,LAYER_LOOP_MAX_SECONDS,LAYER_LOOP_MAX_UNITS,LAYER_LOOP_MAX_PCM_BYTES} from './synth_layer_looper.js?v=pcm-looper-1';

export const PSG_LOOP_MIN_SECONDS=LAYER_LOOP_MIN_SECONDS;
export const PSG_LOOP_MAX_SECONDS=LAYER_LOOP_MAX_SECONDS;
export const PSG_LOOP_MAX_UNITS=LAYER_LOOP_MAX_UNITS;
export const PSG_LOOP_MAX_PCM_BYTES=LAYER_LOOP_MAX_PCM_BYTES;

/** PSG event capture and release tails on the shared software-layer lifecycle. */
export class SynthPsgLooper extends SynthLayerLooper {
  constructor({getSettings,getPitchClock=()=>7670454,...options}={}) {
    if(typeof getSettings!=='function'||typeof getPitchClock!=='function')throw new TypeError('PSG looper settings and pitch clock must be functions');
    super({...options,label:'PSG',idPrefix:'psg',maxTailSeconds:5.01,
      createRecorder:({now})=>new SynthPsgRecordingManager({now,getSettings,getPitchClock})});
    this.getSettings=getSettings;this.getPitchClock=getPitchClock;
  }
}

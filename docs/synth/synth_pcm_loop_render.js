// Offline RF5C164 layer rendering. Only native PCM arrays are created here;
// this module never opens an AudioContext or connects a playback device.
import {Rf5c164} from '../js/rf5c164.js?v=audio-stability-2';
import factory from '../generated/rf5c164_wasm.js';
import {RF5C164Synth,RF5C164DirectTransport} from '../js/rf5c164synth.js?v=audio-stability-2';
import {normalizePcmRecording} from './synth_pcm_recording.js?v=pcm-live-end-1';
import {prepareSynthPcmRecording} from './synth_pcm_recording_prepare.js?v=pcm-live-end-1';
import {createSynthPcmRecordingPlayer} from './synth_pcm_recording_player.js?v=pcm-live-end-1';

export const SYNTH_PCM_LOOP_MAX_DURATION_SECONDS=120;
export const SYNTH_PCM_LOOP_MAX_PCM_BYTES=128*1024*1024;
const BLOCK_FRAMES=4096;
const YIELD_FRAMES=32768;
const yieldToHost=()=>new Promise(resolve=>setTimeout(resolve,0));

/**
 * Render a layer at raw native gain. The dedicated playback bus later applies
 * System PCM correction and Master once. The layer duration is the performed
 * take, with one stopped millisecond to flush native interpolation; Event Rec's
 * ten-millisecond loop padding is deliberately excluded.
 */
export async function renderSynthPcmLoop(recording,{
  sampleRate=48000,signal,moduleOptions={},yieldControl=yieldToHost,
}={}) {
  const selected=normalizePcmRecording(recording);
  if(!Number.isInteger(sampleRate)||sampleRate<8000||sampleRate>192000)throw new RangeError('PCM loop sample rate must be an integer in range 8000..192000');
  if(selected.durationSeconds>SYNTH_PCM_LOOP_MAX_DURATION_SECONDS)throw new RangeError('PCM loop rendering is limited to 120 seconds');
  if(!selected.commands.some(command=>command.type==='noteOn'))throw new Error('PCM loop needs at least one note');
  if(!moduleOptions||typeof moduleOptions!=='object'||Array.isArray(moduleOptions))throw new TypeError('Invalid PCM loop module options');
  if(typeof yieldControl!=='function')throw new TypeError('PCM loop renderer needs a yielding function');
  if(signal!==undefined&&typeof signal?.throwIfAborted!=='function')throw new TypeError('PCM loop rendering needs an AbortSignal');
  const check=()=>signal?.throwIfAborted();
  check();
  const bodyFrames=Math.max(1,Math.ceil(selected.durationSeconds*sampleRate));
  const safetyFrames=Math.max(1,Math.ceil(sampleRate/1000));
  const frameCount=bodyFrames+safetyFrames,byteLength=frameCount*Float32Array.BYTES_PER_ELEMENT*2;
  if(!Number.isSafeInteger(frameCount)||byteLength>SYNTH_PCM_LOOP_MAX_PCM_BYTES)throw new RangeError('PCM loop audio exceeds its 128 MiB limit');
  const compiled=prepareSynthPcmRecording(selected,{sampleRate});
  check();
  let chip=null,player=null;
  try {
    let wasmBinary=moduleOptions.wasmBinary;
    if(wasmBinary===undefined) {
      const response=await fetch(new URL('../generated/rf5c164_wasm.wasm',import.meta.url),{signal});
      if(!response.ok)throw new Error(`PCM loop WASM HTTP ${response.status}`);
      wasmBinary=await response.arrayBuffer();
    }
    check();
    chip=await Rf5c164.create({moduleFactory:factory,moduleOptions:{...moduleOptions,wasmBinary},sampleRate});
    check();
    const pcm=new RF5C164Synth({transport:new RF5C164DirectTransport(chip)});
    player=createSynthPcmRecordingPlayer({sampleRate,pcm});
    player.play(compiled,{session:1,loop:false});
    const left=new Float32Array(frameCount),right=new Float32Array(frameCount);
    const render=(l,r)=>{const output=chip.generateStereo(l.length);l.set(output.left);r.set(output.right);};
    let sinceYield=0;
    for(let offset=0;offset<bodyFrames;offset+=BLOCK_FRAMES) {
      check();
      const end=Math.min(bodyFrames,offset+BLOCK_FRAMES);
      player.render(left.subarray(offset,end),right.subarray(offset,end),render);
      sinceYield+=end-offset;
      if(sinceYield>=YIELD_FRAMES){sinceYield=0;await yieldControl();check();}
    }
    player.stop();render(left.subarray(bodyFrames),right.subarray(bodyFrames));
    check();
    return {left,right,sampleRate,durationSeconds:frameCount/sampleRate,byteLength};
  } finally {
    try{player?.stop();}finally{chip?.dispose();}
  }
}

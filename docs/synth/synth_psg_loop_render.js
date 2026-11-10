// Silent offline rendering for PSG Looper layers. This creates PCM arrays,
// never an AudioContext, speaker connection or browser playback device.
import {SegaPSG,SEGAPSG_CLOCK} from '../js/segapsg.js?v=audio-numeric-bindings-1';
import factory from '../generated/segapsg_wasm.js?v=audio-numeric-bindings-1';
import {createSegaPsgApi} from '../js/segapsg_api.js?v=audio-numeric-bindings-1';
import {createSynthPsgVoice} from './synth_psg.js?v=psg-event-rec-1';
import {createSynthPsgEnvelope} from './synth_psg_envelope.js?v=psg-envelope-1';
import {normalizePsgRecording} from './synth_psg_recording.js?v=psg-event-rec-1';
import {createSynthPsgRecordingPlayer} from './synth_psg_recording_player.js?v=psg-event-rec-1';

export const SYNTH_PSG_LOOP_MAX_DURATION_SECONDS=125;
export const SYNTH_PSG_LOOP_MAX_PCM_BYTES=128*1024*1024;
const RENDER_BLOCK_FRAMES=4096;
const YIELD_FRAMES=32768;
const yieldToHost=()=>new Promise(resolve=>setTimeout(resolve,0));

/**
 * Render one recorded layer, including its already-recorded release duration.
 * The returned samples are raw PSG output: Master and the System PSG gain
 * belong to the eventual playback bus and must each be applied only once.
 * A final silent millisecond makes the recorded end explicit; the Event Rec
 * player's ten-millisecond repeat padding is deliberately not part of a layer.
 */
export async function renderSynthPsgLoop(recording,{
  sampleRate=48000,signal,moduleOptions={},yieldControl=yieldToHost,
}={}) {
  const selected=normalizePsgRecording(recording);
  if(!Number.isInteger(sampleRate)||sampleRate<8000||sampleRate>192000)throw new RangeError('PSG loop sample rate must be an integer in range 8000..192000');
  if(selected.durationSeconds>SYNTH_PSG_LOOP_MAX_DURATION_SECONDS)throw new RangeError('PSG loop rendering is limited to 120 seconds plus 5 seconds of release');
  if(!selected.commands.some(command=>command.type==='noteOn'))throw new Error('PSG loop needs at least one note');
  if(!moduleOptions||typeof moduleOptions!=='object'||Array.isArray(moduleOptions))throw new TypeError('Invalid PSG loop module options');
  if(typeof yieldControl!=='function')throw new TypeError('PSG loop renderer needs a yielding function');
  if(signal!==undefined&&typeof signal?.throwIfAborted!=='function')throw new TypeError('PSG loop rendering needs an AbortSignal');
  const check=()=>signal?.throwIfAborted();
  check();
  const bodyFrames=Math.max(1,Math.ceil(selected.durationSeconds*sampleRate));
  const safetyFrames=Math.max(1,Math.ceil(sampleRate/1000));
  const frameCount=bodyFrames+safetyFrames,byteLength=frameCount*Float32Array.BYTES_PER_ELEMENT*2;
  if(!Number.isSafeInteger(frameCount)||byteLength>SYNTH_PSG_LOOP_MAX_PCM_BYTES)throw new RangeError('PSG loop PCM exceeds its 128 MiB limit');

  let chip=null,player=null;
  try {
    let wasmBinary=moduleOptions.wasmBinary;
    if(wasmBinary===undefined) {
      const response=await fetch(new URL('../generated/segapsg_wasm.wasm?v=audio-numeric-bindings-1',import.meta.url),{signal});
      if(!response.ok)throw new Error(`PSG loop WASM HTTP ${response.status}`);
      wasmBinary=await response.arrayBuffer();
    }
    check();
    chip=await SegaPSG.create({moduleFactory:factory,moduleOptions:{...moduleOptions,wasmBinary},sampleRate,clock:SEGAPSG_CLOCK});
    check();
    const left=new Float32Array(frameCount),right=new Float32Array(frameCount);
    let envelope;
    player=createSynthPsgRecordingPlayer({sampleRate,beginCycle:(settings,pitchClock)=>{
      chip.reset();
      const api=createSegaPsgApi({clock:SEGAPSG_CLOCK,write:value=>chip.write(value)});
      envelope=createSynthPsgEnvelope({sampleRate,setAttenuation:(channel,value)=>api.setAttenuation(channel,value)});
      api.envelopeNoteOn=(...args)=>envelope.noteOn(...args);
      api.envelopeNoteOff=channel=>envelope.noteOff(channel);
      api.stopEnvelopes=()=>envelope.stop();
      api.setEnvelopeAttenuation=value=>envelope.setAttenuation(value);
      api.allNotesOff();
      return createSynthPsgVoice({getPsg:()=>api,getPitchClock:()=>pitchClock,settings});
    }});
    player.play(selected,{session:1,loop:false});
    const renderChip=(l,r)=>{
      const pcm=chip.generateStereoView(l.length);
      l.set(pcm.left.subarray(0,l.length));r.set(pcm.right.subarray(0,r.length));
    };
    const renderEnvelope=(l,r)=>envelope.render(l,r,renderChip);
    let sinceYield=0;
    for(let offset=0;offset<bodyFrames;offset+=RENDER_BLOCK_FRAMES) {
      check();
      const end=Math.min(bodyFrames,offset+RENDER_BLOCK_FRAMES);
      player.render(left.subarray(offset,end),right.subarray(offset,end),renderEnvelope);
      sinceYield+=end-offset;
      if(sinceYield>=YIELD_FRAMES) {sinceYield=0;await yieldControl();check();}
    }
    // A layer ends at its recorded duration, not at the Event player's later
    // cycle-padding boundary. Captured takes already contain their releases.
    player.stop();
    renderEnvelope(left.subarray(bodyFrames),right.subarray(bodyFrames));
    check();
    return {left,right,sampleRate,durationSeconds:frameCount/sampleRate,byteLength};
  } finally {
    try {player?.stop();} finally {chip?.dispose();}
  }
}

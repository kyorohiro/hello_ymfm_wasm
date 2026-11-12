// Main-thread JSON / sample preparation stays outside AudioWorkletGlobalScope.
import {normalizePcmRecording,PCM_RECORDING_MAX_BANKS} from './synth_pcm_recording.js?v=pcm-live-draw-1';
import {normalizePcmPreset,pcmSampleBytes,PCM_NATIVE_RATE,PCM_RAM_BYTES} from './synth_pcm.js?v=pcm-live-draw-1';
import {PCM_RECORDING_MAX_COMPILED_BYTES,PCM_RECORDING_COMPILED_KIND} from './synth_pcm_recording_player.js?v=pcm-live-draw-1';

if(PCM_RECORDING_MAX_COMPILED_BYTES!==PCM_RECORDING_MAX_BANKS*PCM_RAM_BYTES)throw new Error('PCM recording RAM budgets differ');
const positive=(value,max,label)=>{
  if(typeof value!=='number'||!Number.isFinite(value)||value<=0||value>max)throw new RangeError(`Invalid PCM ${label}`);
  return value;
};

/**
 * Main-thread preparation. Decode each source waveform once and build one
 * guarded bank per distinct sample / Loop End. Nothing here runs per sample.
 */
export function prepareSynthPcmRecording(value,{sampleRate,ignorePatch=false,preset,pitchClock}={}) {
  positive(sampleRate,768000,'render sample rate');
  if(typeof ignorePatch!=='boolean')throw new TypeError('PCM ignore patch must be a boolean');
  const recording=normalizePcmRecording(value);
  if(!recording.commands.some(command=>command.type==='noteOn'))throw new Error('PCM recording contains no notes');
  let current=ignorePatch?normalizePcmPreset(preset):recording.initialState.preset;
  const clock=positive(ignorePatch?pitchClock:recording.initialState.pitchClock,1000000000,'pitch clock');
  const banks=[],samples=new Map(),bankIndexes=new Map();
  function configuration(document) {
    let source=samples.get(document.sample.data);
    if(!source){source=pcmSampleBytes(document.sample);samples.set(document.sample.data,source);}
    let ends=bankIndexes.get(document.sample.data);
    if(!ends)bankIndexes.set(document.sample.data,ends=new Map());
    let bank=ends.get(document.settings.loopEnd);
    if(bank===undefined) {
      if((banks.length+1)*PCM_RAM_BYTES>PCM_RECORDING_MAX_COMPILED_BYTES) {
        throw new RangeError('PCM recording exceeds 32 MiB of prepared sample RAM; use fewer sample / Loop End changes');
      }
      bank=banks.length;
      const bytes=new Uint8Array(PCM_RAM_BYTES);bytes.fill(255);
      bytes.set(source.subarray(0,document.settings.loopEnd));banks.push(bytes);ends.set(document.settings.loopEnd,bank);
    }
    const settings={...document.settings};
    const factor=document.sample.sampleRate/PCM_NATIVE_RATE*2048*clock/(144*2**20)/(440*2**((settings.rootNote-69)/12));
    return {bank,frames:source.length,settings,pitchFactors:Array.from({length:8},(_,block)=>factor*2**(block-1))};
  }
  const initial=configuration(current),events=[];
  for(const command of recording.commands) {
    const frame=Math.round(command.time*sampleRate),{time,...event}=command;
    if(command.type==='editSample') {
      if(ignorePatch)continue;
      current=command.preset;events.push({frame,type:'editSample',configuration:configuration(current)});
    } else if(command.type==='setPreset') {
      if(ignorePatch){events.push({frame,type:'stop'});continue;}
      current=command.preset;events.push({frame,type:'setPreset',configuration:configuration(current)});
    } else if(command.type==='setSettings') {
      if(ignorePatch)continue;
      current={...current,settings:command.settings};events.push({frame,type:'setSettings',configuration:configuration(current)});
    } else events.push({frame,...event});
  }
  return {kind:PCM_RECORDING_COMPILED_KIND,version:1,sampleRate,durationFrames:Math.round(recording.durationSeconds*sampleRate),
    byteLength:banks.length*PCM_RAM_BYTES,initial,banks,events};
}


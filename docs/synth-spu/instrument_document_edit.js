// Portable authoring edits. This module never writes registers or opens audio.
import {readSpuInstrument,writeSpuInstrument} from './spu_synth_instrument.js';
import {readMorph,morphPcm} from './spu_synth_morph.js';
import {readNoise} from './spu_synth_noise.js';
import {readPmon} from './spu_synth_pmon.js';
import {patchPs1Envelope,decodePs1Envelope} from '../js/ps1_parameters.js';
import {preparePs1Waveform} from '../js/ps1_waveform.js';
import {preparePs1ADPCM} from '../js/ps1synth.js';
import {createSpuAdpcmPreviewCache} from './spu_adpcm_preview.js';

export const SPU_DOCUMENT_METHODS=new Set(['setInstrumentPreset','setInstrumentEnvelope','setInstrumentWaveform',
  'setInstrumentMorph','setInstrumentNoise','setInstrumentPmon','setReverb','setInstrumentReverbPreset','setInstrumentSample','setInstrumentName']);
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const merge=(base,next,fields)=>({...base,...(Array.isArray(fields)?Object.fromEntries(fields.map(key=>[key,next[key]])):next)});
function setCycle(sound,pcm){
  const prepared=preparePs1Waveform(pcm);sound.version=1;sound.waveform=prepared.pcm;
  sound.sample={adpcm:prepared.adpcm,baseFrequencyHz:44100/112,loopStartSamples:0};
}
export function editSpuInstrumentDocument(value,method,args=[]){
  if(!SPU_DOCUMENT_METHODS.has(method)||!Array.isArray(args))throw TypeError('Unsupported SPU document edit');
  const sound=readSpuInstrument(value);let result=true;
  if(method==='setInstrumentPreset'){
    if(Object.hasOwn(args[0]??{},'sample'))throw TypeError('Load a sample instead of assigning a runtime sample ID to a file.');
    sound.preset={...sound.preset,...args[0]};
  }else if(method==='setInstrumentEnvelope')Object.assign(sound.preset,patchPs1Envelope(sound.preset.adsr1,sound.preset.adsr2,args[0]));
  else if(method==='setInstrumentWaveform'){setCycle(sound,args[0]);sound.morph={...sound.morph,enabled:false};}
  else if(method==='setInstrumentMorph'){
    sound.morph=readMorph(merge(sound.morph,args[0],args[1]));if(sound.morph.enabled)setCycle(sound,morphPcm(sound.morph));result=sound.morph;
  }else if(method==='setInstrumentNoise'){
    sound.noise=readNoise(merge(sound.noise,args[0],args[1]));if(sound.noise.enabled)sound.pmon={...sound.pmon,enabled:false};result=sound.noise;
  }else if(method==='setInstrumentPmon'){
    sound.pmon=readPmon(merge(sound.pmon,args[0],args[1]));if(sound.pmon.enabled)sound.noise={...sound.noise,enabled:false};result=sound.pmon;
  }else if(method==='setReverb'||method==='setInstrumentReverbPreset'){
    sound.reverb={...sound.reverb,...args[0]};
    if(method==='setInstrumentReverbPreset')sound.preset.reverb=sound.reverb.preset!=='off';
  }else if(method==='setInstrumentName')sound.name=args[0];
  else if(method==='setInstrumentSample'){
    if(sound.version!==1||sound.waveform||sound.noise.enabled)throw Error('Choose a full ADPCM sample before drawing.');
    if(args[0]?.adpcm?.byteLength!==sound.sample.adpcm.byteLength)throw RangeError('Full-sample drawing must preserve its original length.');
    const prepared=preparePs1ADPCM(args[0]?.adpcm,{baseFrequencyHz:sound.sample.baseFrequencyHz,...(sound.sample.loopStartSamples!==undefined?{loopStartSamples:sound.sample.loopStartSamples}:{})});
    if(prepared.adpcm.length!==sound.sample.adpcm.length)throw RangeError('Full-sample drawing must preserve its original length.');
    sound.sample={...sound.sample,adpcm:prepared.adpcm};
  }
  return{instrument:writeSpuInstrument(sound.name,sound),result};
}

/** Only changed fields reach a running Code voice. Packed ADSR companions,
 * note pitch/gates and unrelated live writes must not be replayed from a file. */
export function spuInstrumentDocumentChanges(previous,next){
  const before=readSpuInstrument(previous),after=readSpuInstrument(next),commands=[];
  if(before.version!==after.version||!same(previous.sample,next.sample)||!same(before.waveform,after.waveform))return null;
  const preset={};for(const key of ['volumeLeft','volumeRight','pitch','reverb'])if(before.preset[key]!==after.preset[key])preset[key]=after.preset[key];
  // ADSR2 bit 13 is not exposed as a named envelope field, but a raw JSON
  // edit must still be able to change it. Other edits keep this bit intact.
  if((before.preset.adsr2^after.preset.adsr2)&0x2000)preset.adsr2=after.preset.adsr2;
  if(Object.keys(preset).length)commands.push(['setInstrumentPreset',[preset]]);
  const a=decodePs1Envelope(before.preset.adsr1,before.preset.adsr2),b=decodePs1Envelope(after.preset.adsr1,after.preset.adsr2),envelope={};
  for(const key of Object.keys(b))if(a[key]!==b[key])envelope[key]=b[key];
  if(Object.keys(envelope).length)commands.push(['setInstrumentEnvelope',[envelope]]);
  const reverb={};for(const key of Object.keys(after.reverb))if(before.reverb[key]!==after.reverb[key])reverb[key]=after.reverb[key];
  if(Object.keys(reverb).length)commands.push(['setReverb',[reverb]]);
  for(const [key,method]of [['noise','setInstrumentNoise'],['pmon','setInstrumentPmon'],['morph','setInstrumentMorph']]){
    const fields=Object.keys(after[key]).filter(field=>!same(before[key][field],after[key][field]));
    if(fields.length)commands.push([method,[after[key],fields]]);
  }
  return commands;
}

const parsed=new WeakMap(),preview=createSpuAdpcmPreviewCache();
export function displaySpuInstrumentDocument(state,value,token='draft'){
  if(!state||!value)return state;
  let sound=parsed.get(value);if(!sound){sound=readSpuInstrument(value);parsed.set(value,sound);}
  const id=state.channels[0].sample,adpcm=sound.version===1?sound.sample.adpcm:null;
  const source=adpcm&&!sound.waveform&&!sound.noise.enabled?{sampleId:id,token}:null;
  const decoded=source?preview.read(adpcm):null;
  return{...state,reverb:sound.reverb,noise:sound.noise,pmon:sound.pmon,morph:sound.morph,
    hostAudio:sound.version===2?{...state.hostAudio,duration:sound.sample.pcm.length/44100,loop:sound.sample.loop}:null,
    samplePcmSource:source,
    channels:state.channels.map((voice,ch)=>ch?voice:{...voice,...sound.preset,
      waveform:sound.waveform?{sample:id,pcm:sound.waveform}:null,
      adpcmPreview:decoded?.preview?{sample:id,...decoded.preview}:null,adpcmPreviewUnavailable:decoded?.unavailableReason??null}),
  };
}

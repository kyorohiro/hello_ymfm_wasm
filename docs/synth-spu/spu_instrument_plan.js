// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 kyorohiro.
import {Ps1Synth,preparePs1ADPCM} from '../js/ps1synth.js?v=ps1-oneshot-marker-1';
import {readMorph,morphPcm} from './spu_synth_morph.js';
import {readNoise} from './spu_synth_noise.js';
import {readPmon} from './spu_synth_pmon.js';
import {patchPs1Envelope} from '../js/ps1_parameters.js?v=ps1-voice-editor-1';

const sameBytes=(a,b)=>a?.length===b.length&&b.every((value,index)=>value===a[index]);
function bankModel(source) {
  const writes=[],model=Object.create(Ps1Synth.prototype);
  Object.assign(model,{disposed:false,samples:source.samples.map(sample=>({...sample})),sampleBytes:source.sampleBytes.slice(),
    editorWaveforms:source.editorWaveforms.map(wave=>wave?{sample:wave.sample,pcm:wave.pcm.slice()}:null),
    channels:source.channels.map(preset=>({...preset})),reverb:{...source.reverb},nextAddress:source.nextAddress,
    core:{loadRam(bytes,address){writes.push({address,bytes:bytes.slice()});}}});
  return {model,writes};
}
function planned(source,model,writes,settings) {
  const ram=source.ram?(writes.length?source.ram.slice():source.ram):undefined;if(ram)for(const write of writes)ram.set(write.bytes,write.address);
  return {...source,samples:model.samples,sampleBytes:model.sampleBytes,editorWaveforms:model.editorWaveforms,channels:model.channels,
    reverb:model.reverb,nextAddress:model.nextAddress,...settings,writes,ram};
}
export const SPU_PARAMETER_METHODS=Object.freeze(['setInstrumentPreset','setInstrumentEnvelope','setReverb','setInstrumentReverbPreset',
  'setInstrumentWaveform','setInstrumentMorph','setInstrumentNoise','setInstrumentPmon']);
/** One touched parameter, on selected physical voices, without a DSP write.
 * The author plan uses all 24 canonical slots; a Code Live plan uses one CH.
 * Never infer untouched voice settings from a possibly newer Code snapshot.
 */
export function planSpuParameterEdit(source,method,args,targets=Array.from({length:24},(_,ch)=>ch)) {
  if(!SPU_PARAMETER_METHODS.includes(method)||!Array.isArray(args))throw new TypeError('Unsupported SPU parameter edit');
  if(targets.some(ch=>!Number.isInteger(ch)||ch<0||ch>23))throw new RangeError('SPU channel must be 0..23');
  if(['setInstrumentPreset','setInstrumentEnvelope','setInstrumentWaveform'].includes(method)&&args[1]!==undefined){
    const key=method==='setInstrumentWaveform'?'retrigger':'live',options=args[1];
    if(!options||typeof options!=='object'||Array.isArray(options)||Object.keys(options).some(name=>name!==key)||options[key]!==undefined&&typeof options[key]!=='boolean')throw new TypeError(`Expected {${key}?:boolean}`);
  }
  const {model,writes}=bankModel(source),settings={pmon:readPmon(source.pmon),noise:readNoise(source.noise),morph:readMorph(source.morph),
    pmonSampleId:source.pmonSampleId??null,pmonWaveform:source.pmonWaveform?.slice()??null,hostAudio:source.hostAudio??null,hostSlotId:source.hostSlotId??null};
  const fields=(value,list)=>Object.fromEntries((list??Object.keys(value)).map(key=>{if(!Object.hasOwn(value,key))throw new TypeError('Invalid SPU edited field');return[key,value[key]];}));
  let value=true;
  if(method==='setInstrumentPreset'||method==='setInstrumentEnvelope') {
    if(method==='setInstrumentPreset'&&Object.hasOwn(args[0]??{},'sample'))throw new TypeError('Select a sample using the instrument loader');
    for(const ch of targets)model.channels[ch]=model._preset(ch,method==='setInstrumentPreset'?args[0]:patchPs1Envelope(model.channels[ch].adsr1,model.channels[ch].adsr2,args[0]));
  } else if(method==='setReverb'||method==='setInstrumentReverbPreset') {
    model.reverb=model._reverb(args[0]);
    if(method==='setInstrumentReverbPreset')for(const ch of targets)model.channels[ch]=model._preset(ch,{reverb:args[0].preset!=='off'});
  } else if(method==='setInstrumentWaveform'||method==='setInstrumentMorph') {
    const morph=method==='setInstrumentMorph'?readMorph({...settings.morph,...fields(args[0],args[2])}):{...settings.morph,enabled:false};
    const prepared=method==='setInstrumentMorph'?args[1]:args[0];
    if(method==='setInstrumentWaveform'||morph.enabled) {
      if(morph.enabled&&morphPcm(morph).some((sample,index)=>sample!==prepared?.pcm[index]))throw new TypeError('Prepare matching Software morph waveform packets');
      for(const ch of targets)model.channels[ch]=model._preset(ch,{sample:model._setWaveformPrepared(ch,prepared)});
    }
    settings.morph=morph;value=method==='setInstrumentMorph'?morph:true;
  } else if(method==='setInstrumentNoise') {
    settings.noise=readNoise({...settings.noise,...fields(args[0],args[1])});
    if(settings.noise.enabled)for(const ch of targets){
      const bound=model.samples[source.noiseSupportSampleId];
      if(!bound?.loop&&!model.editorWaveforms[ch])model._setWaveformPrepared(ch,args[2]);
      if(model.channels[ch].sample===null)model.channels[ch]=model._preset(ch,{sample:bound?.loop?bound.id:model.editorWaveforms[ch].sample});
    }
    if(settings.noise.enabled)settings.pmon={...settings.pmon,enabled:false};value=settings.noise;
  } else if(method==='setInstrumentPmon') {
    const previous=settings.pmon;settings.pmon=readPmon({...previous,...fields(args[0],args[2])});
    if(settings.pmon.enabled) {
      const prepared=args[1];if(!prepared)throw new TypeError('Prepare the PMON source before editing');
      const checked=preparePs1ADPCM(prepared.adpcm,{baseFrequencyHz:44100/112,loopStartSamples:0});
      if(checked.adpcm.length!==64||!Array.isArray(prepared.pcm)||prepared.pcm.length!==112||prepared.pcm.some(sample=>!Number.isFinite(sample)||Math.abs(sample)>1))throw new TypeError('Invalid PMON waveform');
      if(!model.samples[settings.pmonSampleId])settings.pmonSampleId=model.loadADPCM(checked.adpcm,{baseFrequencyHz:44100/112,loopStartSamples:0}).id;
      else if(previous.depth!==settings.pmon.depth||previous.waveform!==settings.pmon.waveform||!previous.enabled){
        const sample=model.samples[settings.pmonSampleId];model.core.loadRam(checked.adpcm,sample.startAddress);model.sampleBytes[sample.id]=checked.adpcm;
      }
      settings.pmonWaveform=prepared.pcm.slice();settings.noise={...settings.noise,enabled:false};
    }
    value=settings.pmon;
  }
  return {...planned(source,model,writes,settings),value};
}
/** Plan a complete editor sound without touching the DSP. The authored bank
 * and a Code bank can have unrelated sample IDs (Code may clear RAM). Keep
 * existing IDs and resources in each bank; only append/reuse editor-owned
 * slots. Both plans must succeed before either bank is committed.
 * Encoders run on the main thread, never in this module or the Worklet.
 */
export function planSpuInstrument(source,value) {
  if(!value||typeof value!=='object')throw new TypeError('Expected a prepared SPU instrument');
  const pmon=readPmon(value.pmon),noise=readNoise(value.noise),morph=readMorph(value.morph);
  if(pmon.enabled&&noise.enabled)throw new TypeError('Noise and PMON cannot both be enabled');
  const writes=[];
  const model=Object.create(Ps1Synth.prototype);
  Object.assign(model,{disposed:false,samples:source.samples.map(sample=>({...sample})),
    sampleBytes:source.sampleBytes.slice(),editorWaveforms:source.editorWaveforms.map(wave=>wave?{sample:wave.sample,pcm:wave.pcm.slice()}:null),
    channels:source.channels.map(preset=>({...preset})),reverb:{...source.reverb},nextAddress:source.nextAddress,
    core:{loadRam(bytes,address){writes.push({address,bytes:bytes.slice()});}}});
  const reverb=model._reverb(value.reverb);
  let hostAudio=null,hostSlotId=source.hostSlotId??null,pmonSampleId=source.pmonSampleId??null,pmonWaveform=source.pmonWaveform?.slice()??null;
  let chosen;
  if(value.waveform) {
    if(morph.enabled&&morphPcm(morph).some((sample,index)=>sample!==value.waveform.pcm[index]))throw new TypeError('Software morph does not match the prepared cycle');
    chosen=Array.from({length:24},(_,ch)=>model._setWaveformPrepared(ch,value.waveform).id);
  } else if(value.hostAudio) {
    const {pcm,baseFrequencyHz,loop}=value.hostAudio;
    if(!(pcm instanceof Int16Array)||!pcm.length||!Number.isFinite(baseFrequencyHz)||baseFrequencyHz<=0||baseFrequencyHz>1000000||typeof loop!=='boolean'||loop&&pcm.length<4)throw new TypeError('Invalid software audio instrument');
    if(morph.enabled)throw new TypeError('Software audio cannot use a PCM cycle morph');
    let slot=model.samples[hostSlotId];
    if(!slot){const bytes=new Uint8Array(16);bytes[0]=12;bytes[1]=1;slot=model.samples[model.loadADPCM(bytes,{baseFrequencyHz}).id];}
    Object.assign(slot,{rootFrequencyHz:baseFrequencyHz,basePitch:4096,loop,loopStartSamples:loop?0:null,decodedFrames:pcm.length});
    hostSlotId=slot.id;hostAudio={pcm,baseFrequencyHz,loop};chosen=Array(24).fill(slot.id);
  } else {
    if(morph.enabled)throw new TypeError('Software morph requires a PCM cycle');
    const {adpcm,...options}=value.sample??{},checked=preparePs1ADPCM(adpcm,options);
    let sample=value.sampleEdit?model.samples[source.samplePcmSlotId]:null;
    if(sample&&(!sample.samplePcmEditable||sample.byteLength!==checked.adpcm.length||sample.rootFrequencyHz!==checked.rootFrequencyHz||sample.loop!==checked.loop||sample.loopStartSamples!==checked.loopStartSamples))sample=null;
    if(sample){model.core.loadRam(checked.adpcm,sample.startAddress);model.sampleBytes[sample.id]=checked.adpcm;}
    else sample=value.sampleEdit?null:model.samples.find(sample=>sample.editorChannel===undefined&&!sample.samplePcmEditable&&sample.id!==pmonSampleId&&sample.id!==hostSlotId&&
      sample.rootFrequencyHz===checked.rootFrequencyHz&&sample.loop===checked.loop&&sample.loopStartSamples===checked.loopStartSamples&&sameBytes(model.sampleBytes[sample.id],checked.adpcm));
    if(!sample)sample=model.loadADPCM(checked.adpcm,options);
    if(value.sampleEdit)model.samples[sample.id].samplePcmEditable=true;
    chosen=Array(24).fill(sample.id);
  }
  // Native Noise still advances an ADPCM decoder. Keep valid private support
  // loops even after Code reset({clearRam:true}), without reusing a script ID.
  if(noise.enabled)for(let ch=0;ch<24;ch++)if(!model.editorWaveforms[ch])model._setWaveformPrepared(ch,value.noiseWaveform);
  if(pmon.enabled) {
    const prepared=value.pmonWaveform;
    if(!prepared)throw new TypeError('Prepare the PMON source before selecting this sound');
    const checked=preparePs1ADPCM(prepared.adpcm,{baseFrequencyHz:44100/112,loopStartSamples:0});
    if(checked.adpcm.length!==64||!Array.isArray(prepared.pcm)||prepared.pcm.length!==112||prepared.pcm.some(sample=>!Number.isFinite(sample)||Math.abs(sample)>1))throw new TypeError('Invalid prepared PMON waveform');
    let sample=model.samples[pmonSampleId];
    if(!sample)sample=model.loadADPCM(checked.adpcm,{baseFrequencyHz:44100/112,loopStartSamples:0});
    else {model.core.loadRam(checked.adpcm,sample.startAddress);model.sampleBytes[sample.id]=checked.adpcm;}
    pmonSampleId=sample.id;pmonWaveform=prepared.pcm.slice();
  }
  for(let ch=0;ch<24;ch++)model.channels[ch]=model._preset(ch,{...value.preset,sample:chosen[ch]});
  const ram=source.ram?.slice();
  if(ram)for(const write of writes)ram.set(write.bytes,write.address);
  return {samples:model.samples,sampleBytes:model.sampleBytes,editorWaveforms:model.editorWaveforms,channels:model.channels,
    reverb,nextAddress:model.nextAddress,pmon,noise,morph,pmonSampleId,pmonWaveform,hostAudio,hostSlotId,writes,ram};
}

// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 kyorohiro.
import {Ps1Synth,preparePs1ADPCM} from '../js/ps1synth.js?v=ps1-oneshot-marker-1';
import {readMorph,morphPcm} from './spu_synth_morph.js';
import {readNoise} from './spu_synth_noise.js';
import {readPmon} from './spu_synth_pmon.js';

const sameBytes=(a,b)=>a?.length===b.length&&b.every((value,index)=>value===a[index]);
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
    let sample=model.samples.find(sample=>sample.editorChannel===undefined&&!sample.samplePcmEditable&&sample.id!==pmonSampleId&&sample.id!==hostSlotId&&
      sample.rootFrequencyHz===checked.rootFrequencyHz&&sample.loop===checked.loop&&sample.loopStartSamples===checked.loopStartSamples&&sameBytes(model.sampleBytes[sample.id],checked.adpcm));
    if(!sample)sample=model.loadADPCM(checked.adpcm,options);
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

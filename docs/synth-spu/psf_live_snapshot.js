// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 kyorohiro.
// Read-only, bounded PSF SPU observation. No rendering or whole-RAM scanning.
import {decodePs1Envelope,PS1_REVERB_PRESETS} from '../js/ps1_parameters.js?v=ps1-voice-editor-1';

export const PSF_PREVIEW_PACKETS=4;
export const PSF_PREVIEW_FRAMES=112;
const RAM_BYTES=512*1024,PACKET_BYTES=16;
// The same numeric ADPCM predictor coefficients as the fixed BSD SPU decoder.
const FILTERS=[[0,0],[60,0],[115,-52],[98,-55],[122,-60]];
const bit=(mask,ch)=>Boolean(mask&(1<<ch));
const signed16=value=>(value<<16)>>16;
const unit=value=>Math.max(-1,Math.min(1,value));
// Match the editor's normalized /0x3fff convention while keeping its allowed
// [-1,1] range for the asymmetric most-negative code. Raw words remain exact.
const volume15=value=>{value&=0x7fff;return unit((value&0x4000?value-0x8000:value)/0x3fff);};

/** Decode at most four consecutive packets from the programmed start, with
 * zero initial predictor history. This is a source preview, not the current
 * decoder position, Gaussian output, tuning, envelope or complete sample.
 * END terminates even when Repeat is set; previewing never follows a loop.
 * @param {Uint8Array} bytes
 */
export function decodePsfAdpcmPreview(bytes) {
  if(!(bytes instanceof Uint8Array)||!bytes.length||bytes.length>64||bytes.length%PACKET_BYTES)
    throw new TypeError('PSF ADPCM preview needs 1–4 complete packets.');
  const pcm=Array(PSF_PREVIEW_FRAMES).fill(0);
  let history1=0,history2=0,decodedFrames=0,packetCount=0,endReached=false,loop=null,loopStartSamples=null;
  for(let at=0;at<bytes.length;at+=PACKET_BYTES) {
    const header=bytes[at],flags=bytes[at+1],filter=header>>4,shift=header&15;
    if(filter>4||shift>12)throw new RangeError('ADPCM preview header has an unsupported predictor or shift.');
    if(flags&~7)throw new RangeError('ADPCM preview packet has unsupported flag bits.');
    if(flags&4)loopStartSamples=decodedFrames;
    const [f0,f1]=FILTERS[filter];
    for(let n=0;n<28;n++) {
      const code=(bytes[at+2+(n>>1)]>>((n&1)*4))&15;
      const nibble=(code<<28)>>28;
      // Match the fixed core's signed-short wrapping, including predictor
      // history across packet boundaries; do not silently clamp to int16.
      const sample=signed16(((nibble<<12)>>shift)+((history1*f0+history2*f1+32)>>6));
      pcm[decodedFrames++]=sample/32768;
      history2=history1;history1=sample;
    }
    packetCount++;
    if(flags&1){endReached=true;loop=Boolean(flags&2);break;}
  }
  return {pcm,preview:true,source:'programmed-start',history:'zero-at-programmed-start',
    decodedFrames,packetCount,byteLength:packetCount*PACKET_BYTES,endReached,truncated:!endReached,
    loop,loopStartSamples,paddingFrames:PSF_PREVIEW_FRAMES-decodedFrames,fullSampleKnown:false};
}

/** Build a detached state shaped like the existing Ps1Synth/Code Live panel.
 * A reader can copy at most 64 bytes per distinct programmed start (24 max).
 * Invalid/unconfigured previews are local to their voice; register failures
 * reject observation without advancing the machine or changing its audio.
 */
export function readPsfLiveSnapshot({readRegister,readRam,nativeFrames,keyGateMask,activeMask}) {
  const read=offset=>{
    const value=readRegister(offset);
    if(!Number.isInteger(value)||value<0||value>0xffff)throw new Error('PSF Live register observation failed.');
    return value;
  };
  if(!Number.isSafeInteger(nativeFrames)||nativeFrames<0||!Number.isInteger(keyGateMask)||!Number.isInteger(activeMask))
    throw new TypeError('PSF Live observation needs a valid native frame and voice masks.');
  keyGateMask&=0xffffff;activeMask&=0xffffff;
  const mask=offset=>(read(offset)|(read(offset+2)<<16))&0xffffff;
  const control=read(0x1aa),noiseMask=mask(0x194),pmonMask=mask(0x190),reverbMask=mask(0x198),endMask=mask(0x19c);
  const reverbRegisters=Array.from({length:32},(_,i)=>read(0x1c0+i*2));
  const knownReverb=PS1_REVERB_PRESETS.find(p=>p.registers.every((value,i)=>value===reverbRegisters[i]));
  const mainRawLeft=read(0x180),mainRawRight=read(0x182),returnRawLeft=read(0x184),returnRawRight=read(0x186);
  const main={volumeLeft:volume15(mainRawLeft),volumeRight:volume15(mainRawRight),rawVolumeLeft:mainRawLeft,rawVolumeRight:mainRawRight};
  const reverb={preset:knownReverb?.id??'custom',enabled:Boolean(control&0x80),
    volumeLeft:unit(signed16(returnRawLeft)/0x7fff),volumeRight:unit(signed16(returnRawRight)/0x7fff),
    rawVolumeLeft:returnRawLeft,rawVolumeRight:returnRawRight,baseAddress:read(0x1a2)*8,
    registers:reverbRegisters,approximation:'fixed-core-preset'};
  const previews=new Map(),samples=[];
  function previewAt(startAddress) {
    if(previews.has(startAddress))return previews.get(startAddress);
    let waveform=null,reason=null;
    try {
      if(startAddress<0x1000)throw new RangeError('Programmed start is in the SPU capture-buffer area.');
      const firstLength=Math.min(64,RAM_BYTES-startAddress),first=readRam(startAddress,firstLength);
      if(!(first instanceof Uint8Array)||first.length!==firstLength)throw new Error('Bounded SPU RAM preview could not be read.');
      const bytes=new Uint8Array(64);bytes.set(first);
      if(firstLength<64) {
        const rest=readRam(0,64-firstLength);
        if(!(rest instanceof Uint8Array)||rest.length!==64-firstLength)throw new Error('Wrapped SPU RAM preview could not be read.');
        bytes.set(rest,firstLength);
      }
      waveform={sample:startAddress,...decodePsfAdpcmPreview(bytes)};
    } catch(error){reason=error?.message??String(error);}
    const entry={id:startAddress,startAddress,byteLength:waveform?.byteLength??0,decodedFrames:waveform?.decodedFrames??0,
      preview:true,fullSampleKnown:false,rootNote:null,rootFrequencyHz:null,basePitch:null,
      loop:waveform?.loop??null,loopStartSamples:waveform?.loopStartSamples??null,
      endReached:waveform?.endReached??false,truncated:waveform?.truncated??false,unavailableReason:reason};
    samples.push(entry);
    const result={waveform,reason};previews.set(startAddress,result);return result;
  }
  const channels=Array.from({length:24},(_,channel)=>{
    const rawRegisters=Array.from({length:8},(_,i)=>read(channel*16+i*2));
    const startAddress=rawRegisters[3]*8,repeatAddress=rawRegisters[7]*8;
    const gate=bit(keyGateMask,channel),active=bit(activeMask,channel),configured=gate||active||rawRegisters.some(value=>value!==0);
    const result=configured?previewAt(startAddress):{waveform:null,reason:'Voice has no programmed sample settings.'};
    return {channel,type:'spu-adpcm',sample:configured?startAddress:null,startAddress,repeatAddress,
      volumeLeft:volume15(rawRegisters[0]),volumeRight:volume15(rawRegisters[1]),pitch:rawRegisters[2]&0x3fff,
      adsr1:rawRegisters[4],adsr2:rawRegisters[5],envelopeParameters:decodePs1Envelope(rawRegisters[4],rawRegisters[5]),
      gate,active,envelope:rawRegisters[6],ended:bit(endMask,channel),envelopeStage:null,
      reverb:bit(reverbMask,channel),noise:bit(noiseMask,channel),hardwarePmon:channel>0&&bit(pmonMask,channel),
      waveform:result.waveform?{...result.waveform,pcm:result.waveform.pcm.slice()}:null,
      waveformUnavailable:result.reason,rawRegisters};
  });
  return {kind:'ps1',sampleRate:44100,nativeSampleRate:44100,channelCount:24,nativeFrames,
    channels,samples,main,reverb,noise:{enabled:Boolean(noiseMask),clock:(control>>8)&63},
    pmon:{enabled:Boolean(pmonMask&0xfffffe)},morph:{enabled:false},hostAudio:null,auditions:[],
    observation:{kind:'psf',nativeFrames,control,noiseMask,pmonMask,reverbMask,keyGateMask,activeMask,
      mainVolume:{left:main.volumeLeft,right:main.volumeRight},waveform:'bounded-start-preview',
      previewMaxPackets:PSF_PREVIEW_PACKETS,previewMaxFrames:PSF_PREVIEW_FRAMES,
      envelopeStageAvailable:false,endMeaning:'ENDX marker latch; looping voices may remain active',rootNoteKnown:false}};
}

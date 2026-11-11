// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 kyorohiro.
// Pure PSF instrument capture: original ADPCM bytes, never PCM re-encoding.
import {writeSpuInstrument} from './spu_synth_instrument.js?v=spu-split-vab-1';
import {preparePs1ADPCM} from '../js/ps1synth.js?v=ps1-oneshot-marker-1';
import {noteToHz} from '../js/soundchip_pitch.js';

const RAM_BYTES=512*1024,SAMPLE_START=0x1000,PACKET_BYTES=16;
const fail=message=>{throw new Error(`PSF Capture: ${message}`);};
const integer=(value,min,max,name)=>{
  if(!Number.isSafeInteger(value)||value<min||value>max)fail(`${name} is invalid.`);
  return value;
};
function sourceInfo(source) {
  if(source===undefined||source===null)return {entry:'',title:'PSF'};
  if(typeof source==='string')source={entry:source,title:source};
  if(!source||typeof source!=='object'||Array.isArray(source))fail('Source metadata is invalid.');
  const {entry='',title='PSF'}=source;
  if(typeof entry!=='string'||typeof title!=='string'||entry.length>4096||title.length>4096)
    fail('Source metadata must contain bounded entry/title strings.');
  return {entry,title};
}

/** Prepare a portable instrument from the selected audible-boundary snapshot.
 * This does not modify the source, editor, transport or any sound core.
 * referenceNote is a user-selected reference, never an inferred root note.
 * The caller must provide the editor's shared reverb (not the song's effect).
 */
export function preparePsfVoiceCapture({state,ram,voice,frame,source}={},
  {referenceNote='C4',name,reverb}={}) {
  voice=integer(voice,0,23,'Voice');frame=integer(frame,0,Number.MAX_SAFE_INTEGER,'Frame');
  if(!state||state.observation?.kind!=='psf'||state.nativeFrames!==frame||state.observation.nativeFrames!==frame)
    fail('The selected voice and RAM must belong to the same PSF observation frame.');
  if(!Array.isArray(state.channels)||state.channels.length!==24||state.channels[voice]?.channel!==voice)
    fail('The selected physical voice is missing from this snapshot.');
  if(!(ram instanceof Uint8Array)||ram.length!==RAM_BYTES)fail('A complete same-frame 512 KiB SPU RAM copy is required.');
  const channel=state.channels[voice],raw=channel.rawRegisters;
  if(!Array.isArray(raw)||raw.length!==8||raw.some(value=>!Number.isInteger(value)||value<0||value>0xffff))
    fail('The selected voice has no valid raw register snapshot.');
  const rawPitch=raw[2]&0x3fff,startAddress=raw[3]*8,repeatAddress=raw[7]*8;
  if(channel.sample===null||channel.sample===undefined)fail('This voice has no configured ADPCM sample.');
  if(channel.startAddress!==startAddress||channel.repeatAddress!==repeatAddress||channel.pitch!==rawPitch||channel.adsr1!==raw[4]||channel.adsr2!==raw[5])
    fail('The selected voice settings do not match its raw register snapshot.');
  const noiseMask=integer(state.observation.noiseMask,0,0xffffff,'Noise mask');
  const pmonMask=integer(state.observation.pmonMask,0,0xffffff,'PMON mask');
  const sendMask=integer(state.observation.reverbMask,0,0xffffff,'Reverb mask');
  if(channel.noise||noiseMask&(1<<voice))fail('Noise voices cannot be captured as ADPCM instruments.');
  if(voice>0&&(channel.hardwarePmon||pmonMask&(1<<voice)))fail('PMON carriers require their modulator and cannot be captured as a single ADPCM voice.');
  if(!rawPitch)fail('PITCH is zero; choose a voice with a nonzero playback pitch.');
  if(startAddress<SAMPLE_START)fail('The programmed start is inside the SPU capture-buffer area.');
  if(startAddress>=RAM_BYTES||startAddress%PACKET_BYTES)fail('The sample start must be a 16-byte-aligned physical SPU RAM address.');
  for(const key of ['volumeLeft','volumeRight'])if(!Number.isFinite(channel[key])||channel[key]<-1||channel[key]>1)
    fail('The selected voice has invalid normalized volume settings.');
  if(!reverb||typeof reverb!=='object')fail('The current Synth shared reverb settings are required.');
  const referenceFrequencyHz=noteToHz(referenceNote),baseFrequencyHz=referenceFrequencyHz*4096/rawPitch;
  let endAddress=null,endFlags=0,markerAddress=null;
  // Strictly contiguous, forward-only and bounded by the physical RAM end.
  // No wrapping, following external repeat pointers, fabricated END or edits.
  for(let at=startAddress;at<=RAM_BYTES-PACKET_BYTES;at+=PACKET_BYTES) {
    const header=ram[at],flags=ram[at+1];
    if((header>>4)>4||(header&15)>12)fail(`Invalid ADPCM predictor/shift at RAM 0x${at.toString(16)}.`);
    if(flags&~7)fail(`Unsupported ADPCM flags at RAM 0x${at.toString(16)}.`);
    if(flags&4) {
      if(markerAddress!==null)fail('Multiple ADPCM Loop Start markers are not supported by a portable capture.');
      markerAddress=at;
    }
    if(flags&1){endAddress=at+PACKET_BYTES;endFlags=flags;break;}
  }
  if(endAddress===null)fail('No ADPCM END packet exists before the RAM boundary; wrapped or unterminated samples are not captured.');
  const loop=Boolean(endFlags&2);
  let loopStartSamples=null;
  if(loop) {
    if(repeatAddress<startAddress||repeatAddress>=endAddress||repeatAddress%PACKET_BYTES)
      fail('The repeat address must point to a 16-byte-aligned packet inside the captured contiguous sample; discontiguous loops are not supported.');
    if(markerAddress!==null&&markerAddress!==repeatAddress)
      fail('The Loop Start marker and current repeat address disagree.');
    loopStartSamples=(repeatAddress-startAddress)/PACKET_BYTES*28;
  }
  const adpcm=ram.slice(startAddress,endAddress),sample={adpcm,baseFrequencyHz};
  if(loop)sample.loopStartSamples=loopStartSamples;
  const prepared=preparePs1ADPCM(adpcm,{baseFrequencyHz,...(loop?{loopStartSamples}:{})});
  const sourceMetadata=sourceInfo(source),voiceReverb=Boolean(sendMask&(1<<voice));
  if(channel.reverb!==voiceReverb)fail('The selected voice reverb send does not match this snapshot.');
  const preset={volumeLeft:channel.volumeLeft,volumeRight:channel.volumeRight,adsr1:raw[4],adsr2:raw[5],pitch:rawPitch,reverb:voiceReverb};
  const instrument=writeSpuInstrument(name??`PSF CH ${voice+1} capture`,{preset,sample,
    reverb:{...reverb},waveform:null,pmon:{enabled:false},noise:{enabled:false},morph:{enabled:false}});
  return {instrument,capture:{voice,frame,source:sourceMetadata,startAddress,repeatAddress,
    byteLength:adpcm.length,packetCount:adpcm.length/PACKET_BYTES,decodedFrames:prepared.decodedFrames,
    loop,loopStartSamples,markerAddress,rawPitch,pitchRegister:raw[2],
    referenceNote,referenceFrequencyHz,baseFrequencyHz,tuning:'reference-key',rootNoteInferred:false,
    rawVolumeLeft:raw[0],rawVolumeRight:raw[1],sharedReverb:'editor-preserved',
    envelopeStateCaptured:false,notes:['Original ADPCM bytes; new key-on envelope, not a frozen running note.',
      'Reference key is user-selected, not an inferred sample root.',
      'Song main volume and shared reverb are not copied.']}};
}

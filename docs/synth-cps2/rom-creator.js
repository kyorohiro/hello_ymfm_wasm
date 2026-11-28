// SPDX-License-Identifier: BSD-3-Clause
import {encodePad,maxRom,padByteLength} from './samples.js';
import {QSOUND_PCM_RATE} from '../js/qsoundpcm.js';

import {fetchSample,setupSampleRomCreator} from '../synth/sample_rom_creator.js';

async function makeRom(entries,progress){
  const parts=[],presets=[];
  let size=0;
  for(const entry of entries){
    const {name,kind,file}=entry;
    progress(name);
    const pcm=kind==='PCM',hz=Math.round(pcm?QSOUND_PCM_RATE:QSOUND_PCM_RATE/3);
    const source=file??await fetchSample(name);
    const decoder=new OfflineAudioContext(1,1,hz);
    let audio;
    try{audio=await decoder.decodeAudioData(await source.arrayBuffer());}
    catch{throw Error('Could not decode '+name);}
    if(!pcm)padByteLength(audio.duration);
    // A PCM voice uses signed 16-bit addresses. Reserve a silent byte for its release loop.
    const count=pcm?Math.min(audio.length,32766):audio.length;
    const mono=new OfflineAudioContext(1,count,hz);
    const player=mono.createBufferSource();
    player.buffer=audio;player.playbackRate.value=audio.length/count;
    player.connect(mono.destination);player.start();
    const frames=(await mono.startRendering()).getChannelData(0);
    const samples=Uint8Array.from(frames,v=>Math.min(127,Math.max(-128,Math.round(v*128))));
    const bytes=pcm?new Uint8Array(count+1):encodePad({pcm:samples,seconds:audio.duration});
    if(pcm)bytes.set(samples);
    const boundary=pcm?32768:65536;
    if(size%boundary+bytes.length>=boundary)size=Math.ceil(size/boundary)*boundary;
    if(size+bytes.length>maxRom)throw Error('Samples exceed the 16 MiB ROM limit.');
    const start=size%65536;
    presets.push({name:name.replace(/\.(wav|flac)$/i,''),kind,bank:Math.floor(size/65536),start,
      end:start+bytes.length,...(pcm?{rate:Math.max(1,Math.round(4096*count/audio.duration/QSOUND_PCM_RATE)),loop:1}:{})});
    parts.push({offset:size,bytes});size+=bytes.length;
  }
  const rom=new Uint8Array(size);
  for(const {offset,bytes} of parts)rom.set(bytes,offset);
  return {rom,presets};
}

export function setupRomCreator(save,defaultName){
  return setupSampleRomCreator({build:makeRom,defaultName,formats:['PCM','ADPCM'],
    save:(name,{rom,presets})=>save(name,rom,presets)});
}

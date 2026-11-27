// SPDX-License-Identifier: BSD-3-Clause
import {encodeSample} from './kit.js';

export async function makeAudioBank(files) {
  if (!files.length || files.length>128) throw Error('Choose 1–128 samples per bank.');
  const rate=Math.round(1000000/132);
  const decoder=new OfflineAudioContext(1,1,rate);
  const samples=[];
  let size=0x400;
  for (const file of files) {
    if (file.size>16*1024*1024) throw Error(file.name+' exceeds 16 MiB.');
    let audio;
    try {audio=await decoder.decodeAudioData(await file.arrayBuffer());}
    catch {throw Error('Could not decode '+file.name);}
    if (size+Math.max(2,Math.ceil(audio.length/2))>0x40000)
      throw Error('Samples exceed the 256 KiB MSM6295 bank. Choose shorter clips.');
    const pcm=new Float32Array(audio.length);
    for (let ch=0;ch<audio.numberOfChannels;ch++) {
      const input=audio.getChannelData(ch);
      for (let i=0;i<pcm.length;i++) pcm[i]+=input[i]*(2047/audio.numberOfChannels);
    }
    const bytes=encodeSample(pcm);
    samples.push(bytes);size+=bytes.length;
  }
  const rom=new Uint8Array(size);
  let start=0x400;
  samples.forEach((bytes,id)=>{
    const end=start+bytes.length-1;
    rom.set([start>>16,start>>8,start,end>>16,end>>8,end],id*8);
    rom.set(bytes,start);start=end+1;
  });
  const names=files.map(file=>file.name);
  return {kind:'bank',bytes:rom,names,name:names.length===1?names[0]:names[0]+' + '+(names.length-1)};
}

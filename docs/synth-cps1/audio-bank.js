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

// Keep existing sample IDs and ranges so code and the other voices stay valid.
export function writeBankSample(bank,clip,slot=null) {
  if(slot!==null && (!Number.isInteger(slot)||slot<0||slot>127))throw Error('Choose sample 0–127.');
  const ranges=[], occupied=new Set();
  const address=pos=>((bank.bytes[pos]&3)<<16)|((bank.bytes[pos+1]??0)<<8)|(bank.bytes[pos+2]??0);
  for(let i=0;i<128 && i*8+6<=bank.bytes.length;i++) {
    const start=address(i*8),end=address(i*8+3);
    if(start>=end)continue;
    if(end>=bank.bytes.length)throw Error('Sample table points outside this bank.');
    occupied.add(i);
    if(i!==slot)ranges.push({start,end});
  }
  let id=slot;
  if(id===null){
    id=0;
    while(occupied.has(id))id++;
    if(id>=128)throw Error('All 128 sample slots are in use.');
  }
  if(ranges.some(({start,end})=>start<=id*8+5 && end>=id*8))
    throw Error('This table entry overlaps existing sample data.');
  if(!clip){
    if(slot===null || !occupied.has(id))throw Error('Choose an occupied sample slot.');
    const bytes=bank.bytes.slice(),names=Array.from({length:Math.max(bank.names.length,id+1)},(_,i)=>bank.names[i]??'');
    bytes.fill(0,id*8,id*8+6);names[id]='';
    return {bytes,names,id};
  }
  const data=clip.bytes.subarray(0x400);
  let start=0x400;
  for(const range of ranges.sort((a,b)=>a.start-b.start)){
    if(start+data.length<=range.start)break;
    start=Math.max(start,range.end+1);
  }
  const end=start+data.length-1;
  if(end>=0x40000)throw Error('No continuous ROM space for this sample.');
  const bytes=new Uint8Array(Math.max(bank.bytes.length,end+1));
  bytes.set(bank.bytes);bytes.set(data,start);
  bytes.set([start>>16,start>>8,start,end>>16,end>>8,end],id*8);
  const names=Array.from({length:Math.max(id+1,bank.names.length)},(_,i)=>bank.names[i]??'');
  names[id]=clip.names[0];
  return {bytes,names,id};
}

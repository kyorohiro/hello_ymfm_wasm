// SPDX-License-Identifier: BSD-3-Clause
import {demoRom} from './demo.js';
import {QSOUND_PCM_RATE,adpcmOutput,adpcmNextStep} from '../js/qsoundpcm.js';

export const isSamplePath=path=>/^\/samples\/[^/]+\.wav$/i.test(path);
export const maxRom=16*1024*1024;

// Keep the original WAV in Files. Convert to signed mono bytes for the chip.
// Fit each clip in a positive signed loop length, preserving its duration.
export function decodeSample(bytes,forPad=false){
  const d=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  const tag=i=>String.fromCharCode(...bytes.subarray(i,i+4));
  if(bytes.length<44 || tag(0)!=='RIFF' || tag(8)!=='WAVE')throw Error('Expected a RIFF WAVE file.');
  let format,channels,rate,stride,bits,data,size;
  for(let i=12;i+8<=bytes.length;){
    const count=d.getUint32(i+4,true),offset=i+8;
    if(offset+count>bytes.length)throw Error('Truncated WAV chunk.');
    if(tag(i)==='fmt ' && count>=16){
      format=d.getUint16(offset,true);channels=d.getUint16(offset+2,true);rate=d.getUint32(offset+4,true);
      stride=d.getUint16(offset+12,true);bits=d.getUint16(offset+14,true);
    }else if(tag(i)==='data'){data=offset;size=count;}
    i=offset+count+(count%2);
  }
  if(!size || !channels || !rate || stride!==channels*bits/8 ||
      !(format===1 && [8,16,24,32].includes(bits) || format===3 && bits===32))
    throw Error('Choose an 8/16/24/32-bit PCM or 32-bit float WAV.');
  const frames=Math.floor(size/stride);
  if(!frames)throw Error('WAV contains no complete frame.');
  const seconds=frames/rate;
  if(forPad)padByteLength(seconds);
  const length=forPad?Math.max(1,Math.round(seconds*QSOUND_PCM_RATE/3)):
    Math.min(frames,32767,Math.max(1,Math.round(seconds*QSOUND_PCM_RATE)));
  const pcm=new Uint8Array(length);

  for(let i=0;i<length;i++){
    const first=Math.floor(i*frames/length),next=Math.max(first+1,Math.floor((i+1)*frames/length));
    const count=(next-first)*channels;
    let sum=0;
    for(let frame=first;frame<next;frame++)for(let ch=0;ch<channels;ch++){
      const offset=data+frame*stride+ch*(bits/8);
      if(format===3)sum+=d.getFloat32(offset,true);
      else if(bits===8)sum+=(bytes[offset]-128)/128;
      else if(bits===16)sum+=d.getInt16(offset,true)/32768;
      else if(bits===24)sum+=((bytes[offset]<<8|bytes[offset+1]<<16|bytes[offset+2]<<24)>>8)/8388608;
      else sum+=d.getInt32(offset,true)/2147483648;
    }
    pcm[i]=Math.max(-128,Math.min(127,Math.round(sum*128/count)));
  }
  return {pcm,seconds:frames/rate,rate:Math.max(1,Math.round(4096*rate*length/frames/QSOUND_PCM_RATE))};
}

export function padByteLength(seconds){
  const length=Math.max(1,Math.ceil(seconds*QSOUND_PCM_RATE/6));
  if(length>65535)throw Error('WAV is too long for an ADPCM pad (about 16.35 s maximum).');
  return length;
}

// Choose each high/low nibble against the same predictor as the sound chip.
function encodePad({pcm,seconds}){
  const bytes=new Uint8Array(padByteLength(seconds));
  let previous=0,step=10;
  for(let i=0;i<bytes.length*2;i++){
    const target=((pcm[i]<<24)>>24)*128;
    let best=0,error=Infinity;
    for(let code=-8;code<=7;code++){
      const distance=Math.abs(target-adpcmOutput(previous,step,code,32767));
      if(distance<error){error=distance;best=code;}
    }
    previous=adpcmOutput(previous,step,best,32767);step=adpcmNextStep(step,best);
    bytes[i>>1]|=(best&15)<<(i%2?0:4);
  }
  return bytes;
}

// Reserve bank zero for factory instruments. Keep each clip in one signed
// address half so that the exclusive end and loop fit QSound's registers.
export function allocateSample(items,length,boundary=32768){
  let offset=65536;
  for(const item of [...items,{offset:maxRom,length:0}].sort((a,b)=>a.offset-b.offset)){
    if(offset%boundary+length>=boundary)offset=Math.ceil(offset/boundary)*boundary;
    if(offset+length<=item.offset)return offset;
    offset=Math.max(offset,item.offset+item.length);
  }
  throw Error('Sample ROM exceeds 16 MiB.');
}
export function sampleLibrary(files,placements={},padPlacements={}){
  const items=new Map(),padItems=new Map(),regions=[],factory=demoRom();
  let size=factory.length;
  function add(map,path,pcm,offset,rate,seconds){
    const boundary=map===padItems?65536:32768;
    if(!Number.isInteger(offset)||offset<65536||offset+pcm.length>maxRom||offset%boundary+pcm.length>=boundary)
      throw Error('Invalid sample ROM placement: '+path);
    const item={path,offset,length:pcm.length,bank:Math.floor(offset/65536),start:offset%65536,pcm,rate,seconds};
    map.set(path,item);regions.push(item);size=Math.max(size,offset+pcm.length);
  }
  for(const file of files.filter(f=>isSamplePath(f.path))){
    const decoded=decodeSample(file.data);
    add(items,file.path,decoded.pcm,placements[file.path],decoded.rate,decoded.seconds);
    if(Object.hasOwn(padPlacements,file.path))
      add(padItems,file.path,encodePad(decodeSample(file.data,true)),padPlacements[file.path],0,decoded.seconds);
  }
  let end=0;
  const rom=new Uint8Array(size);rom.set(factory);
  for(const item of regions.sort((a,b)=>a.offset-b.offset)){
    if(item.offset<end)throw Error('Overlapping WAV samples.');
    rom.set(item.pcm,item.offset);end=item.offset+item.length;
  }
  return {items,padItems,regions,rom};
}

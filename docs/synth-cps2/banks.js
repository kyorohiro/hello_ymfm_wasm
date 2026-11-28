// SPDX-License-Identifier: BSD-3-Clause
import {decodeSample,encodePad,maxRom} from './samples.js';
import {QSOUND_PCM_RATE} from '../js/qsoundpcm.js';
import {demoRom,pcmRate} from './demo.js';
import {cabinetPluck,cabinetSnare,duetSamplePath,drumPath} from './sample-duet.js';

export const defaultRom='/banks/0_default.rom';
export const isBankPath=p=>/^\/banks\/[^/]+\.rom$/i.test(p);
export function bankLibrary(rom,slots=[]){
  if(!(rom instanceof Uint8Array)||rom.length>maxRom||!Array.isArray(slots)||slots.length>128)throw Error('Invalid QSound ROM.');
  const items=new Map(),padItems=new Map(),regions=[];
  slots.forEach((s,i)=>{
    if(s==null)return;
    const {kind,offset,length,rate,path}=s,boundary=kind==='PCM'?32768:65536;
    if(!['PCM','ADPCM'].includes(kind)||typeof path!=='string'||!path.length||
      !Number.isInteger(offset)||offset<0||!Number.isInteger(length)||length<=0||
      offset%boundary+length>=boundary||offset+length>rom.length||!Number.isInteger(rate)||rate<0||rate>65535)
      throw Error('Invalid ROM slot '+i);
    if(regions.some(r=>offset<r.offset+r.length && offset+length>r.offset))throw Error('Overlapping ROM slots.');
    const item={...s,slot:i,bank:Math.floor(offset/65536),start:offset%65536,pcm:rom.subarray(offset,offset+length)};
    const map=kind==='PCM'?items:padItems;
    if(map.has(path))throw Error('Duplicate ROM sample name: '+path);
    map.set(path,item);regions.push(item);
  });
  return {rom,items,padItems,regions};
}
export function editSlot(rom,slots,index,wav,kind,name){
  if(!Number.isInteger(index)||index<0||index>=128)throw Error('Invalid sample slot.');
  const next=slots.slice(),old=slots[index];
  let bytes=rom.slice();
  if(old)bytes.fill(0,old.offset,old.offset+old.length);
  if(wav){
    const decoded=decodeSample(wav,kind==='ADPCM');
    const sample=kind==='PCM'?decoded.pcm:encodePad(decoded);
    const boundary=kind==='PCM'?32768:65536;
    let offset=old && sample.length<=old.length?old.offset:bytes.length;
    if(offset%boundary+sample.length>=boundary)offset=Math.ceil(offset/boundary)*boundary;
    if(offset+sample.length>maxRom)throw Error('Sample ROM exceeds 16 MiB.');
    if(offset+sample.length>bytes.length){
      const larger=new Uint8Array(offset+sample.length);larger.set(bytes);bytes=larger;
    }
    bytes.set(sample,offset);
    next[index]={kind,path:old?.path??('slot:'+index),name,offset,length:sample.length,rate:kind==='PCM'?decoded.rate:0};
  }else{
    next[index]=null;
    if(old && old.offset+old.length===bytes.length)bytes=bytes.slice(0,old.offset);
  }
  const library=bankLibrary(bytes,next);
  return {slots:next,library};
}
// Older scripts can assign a PCM sample to a pad by name. Re-encode its
// stored mono bytes without keeping an additional source WAV in the cassette.
export function padFromPcm(rom,slots,item){
  let index=0;while(index<128 && slots[index])index++;
  if(index===128)throw Error('No free slot for the ADPCM encoding.');
  const rate=Math.max(1,Math.round(item.rate*QSOUND_PCM_RATE/4096));
  const pcmCount=Math.max(1,Math.round(item.length/rate*QSOUND_PCM_RATE/3));
  if(pcmCount>131070)throw Error('Sample is too long for an ADPCM slot.');
  const pcm=new Uint8Array(pcmCount);
  for(let i=0;i<pcmCount;i++)pcm[i]=item.pcm[Math.floor(i*item.length/pcmCount)];
  const data=encodePad({pcm,seconds:item.length/rate});
  let offset=rom.length;
  if(offset%65536+data.length>=65536)offset=Math.ceil(offset/65536)*65536;
  if(offset+data.length>maxRom)throw Error('Sample ROM exceeds 16 MiB.');
  const bytes=new Uint8Array(offset+data.length);bytes.set(rom);bytes.set(data,offset);
  const next=slots.slice();next[index]={kind:'ADPCM',name:item.name,path:item.path,offset,length:data.length,rate:0};
  return {slots:next,library:bankLibrary(bytes,next)};
}
export function factoryBanks(){
  const bank=demoRom(),base=[
    {kind:'PCM',path:'reed',name:'Reed',offset:0,length:256,rate:pcmRate(60)},
    {kind:'PCM',path:'bell',name:'Bell',offset:256,length:256,rate:pcmRate(60)},
    ...[0,1,2].map(i=>({kind:'ADPCM',path:'pulse'+i,name:'Pulse '+(i+1),offset:512+i*512,length:512,rate:0})),
  ];
  const alt={rom:bank.slice(),slots:base.map(s=>({...s}))};
  // Preserve the original cassette bank addresses for authored scripts and presets.
  let rom=new Uint8Array(65536);rom.set(bank);
  let slots=base.slice();
  for(const [name,wav,kind] of [[duetSamplePath,cabinetPluck(),'PCM'],[drumPath,cabinetSnare(),'PCM'],[drumPath,cabinetSnare(),'ADPCM']]){
    const i=slots.length,result=editSlot(rom,slots,i,wav,kind,name.split('/').pop());
    rom=result.library.rom;slots=result.slots;slots[i].path=name;
  }
  return [[defaultRom,{rom,slots}],['/banks/1_sample.rom',alt],['/banks/99_empty.rom',{rom:new Uint8Array(),slots:[]}]];
}

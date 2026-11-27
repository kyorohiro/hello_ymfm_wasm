// SPDX-License-Identifier: BSD-3-Clause
import {Ym2612VGM} from '../js/ym2612vgm.js';

export function inspectSong(bytes,onRomBlock) {
  const parser = new Ym2612VGM(bytes);
  const {ym2151Clock,okim6295Clock} = parser.header;
  if (!(ym2151Clock || okim6295Clock) || (ym2151Clock & 0xc0000000) || (okim6295Clock & 0x40000000))
    throw Error('Choose a VGM for a single YM2151 and/or MSM6295.');
  let ticks = 0;
  while (!parser.ended) {
    const pos = parser.position, cmd = bytes[pos];
    if (!(cmd===0x54 && ym2151Clock || cmd===0xb8 && okim6295Clock ||
        cmd===0x67 && okim6295Clock && bytes[pos+2]===0x8b ||
        [0x61,0x62,0x63,0x66].includes(cmd) || cmd>=0x70 && cmd<=0x7f))
      throw Error('Unsupported CPS1 VGM command at '+pos+'.');
    const event = parser.step();
    if (parser.position>bytes.length || event.chipIndex) throw Error('Truncated or dual-chip CPS1 VGM.');
    if (event.type==='okim6295-rom-data') onRomBlock?.(event);
    if (event.type==='wait') ticks+=event.samples;
  }
  if (!ticks) throw Error('VGM contains no playback time.');
}

// The VGM image may contain several 18-bit chip address windows.
export function embeddedSongBanks(bytes) {
  const windows=new Map(), size=0x40000;
  let imageSize;
  inspectSong(bytes,({memorySize,offset,data})=>{
    if(imageSize!==memorySize){windows.clear();imageSize=memorySize;}
    for(let pos=0;pos<data.length;){
      const address=offset+pos,index=Math.floor(address/size),local=address%size;
      const length=Math.min(size-local,data.length-pos);
      if(!windows.has(index)){
        const capacity=Math.min(size,memorySize-index*size);
        windows.set(index,{rom:new Uint8Array(capacity),supplied:new Uint8Array(capacity)});
      }
      const {rom,supplied}=windows.get(index);
      rom.set(data.subarray(pos,pos+length),local);
      supplied.fill(1,local,local+length);
      pos+=length;
    }
  });
  const banks=[];
  for(const [index,{rom,supplied}] of windows){
    const bytes=completeBank(rom,supplied);
    if(bytes)banks.push({index,bytes});
  }
  return banks.sort((a,b)=>a.index-b.index);
}
function completeBank(rom,supplied){
  if(rom.length<8)return null;
  const address=p=>((rom[p]&3)<<16)|(rom[p+1]<<8)|rom[p+2];
  if(supplied.every(Boolean)){
    for(let p=0;p<0x400 && p+6<=rom.length;p+=8){
      if(address(p)<address(p+3) && address(p+3)<rom.length)return rom;
    }
    return null;
  }
  // Preserve addresses and clear entries whose table or payload was omitted.
  const missing=new Uint32Array(rom.length+1);
  for(let i=0;i<rom.length;i++)missing[i+1]=missing[i]+1-supplied[i];
  let complete=0;
  for(let p=0;p<0x400 && p+6<=rom.length;p+=8){
    const start=address(p),end=address(p+3);
    if(start>=0x400 && start<end && end<rom.length &&
       missing[p]===missing[p+6] && missing[start]===missing[end+1])complete++;
    else rom.fill(0,p,p+6);
  }
  return complete?rom:null;
}

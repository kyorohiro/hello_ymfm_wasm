// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 kyorohiro and Tetorica contributors.
// Bounded RSID input parsing only: this does not execute or certify C64 code.
// Format facts: HVSC SID_file_format.txt, 2026-10-09. No ROM or player code.
export const RSID_SPECIFICATION_URL='https://hvsc.c64.org/download/C64Music/DOCUMENTS/SID_file_format.txt';
export const RSID_HEADER_BYTES=0x7c;
export const RSID_MAX_FILE_BYTES=0x10000+RSID_HEADER_BYTES;

export class SidRsidError extends Error {
  constructor(message,code='RSID_INVALID'){super(`RSID: ${message}`);this.name='SidRsidError';this.code=code;}
}
const invalid=message=>{throw new SidRsidError(message);};
const unsupported=message=>{throw new SidRsidError(message,'RSID_UNSUPPORTED');};
const overlaps=(a,b,c,d)=>a<d&&c<b;
// AudioWorklet has no mandatory TextDecoder. Preserve the Windows-1252 C1
// mappings, including undefined control bytes, without any platform decoder.
const windows1252C1='\u20ac\u0081\u201a\u0192\u201e\u2026\u2020\u2021\u02c6\u2030\u0160\u2039\u0152\u008d\u017d\u008f\u0090\u2018\u2019\u201c\u201d\u2022\u2013\u2014\u02dc\u2122\u0161\u203a\u0153\u009d\u017e\u0178';
function text(bytes,offset){let result='';for(let i=offset;i<offset+32&&bytes[i]!==0;i++){const value=bytes[i];result+=value>=0x80&&value<=0x9f?windows1252C1[value-0x80]:String.fromCharCode(value);}return result;}

/** Parse the single-SID RSID v2 layout, retaining declared clock/model hints.
 * Unknown/either hints remain unknown/either; no target is silently assumed.
 * The payload may occupy RAM under ROM/I/O up to the exclusive end $10000.
 * A BASIC init value of zero means BASIC startup, not a machine-code call.
 * File validation cannot establish ROM independence or whole-tune compatibility.
 * @param {ArrayBuffer|ArrayBufferView} input
 * @param {{maxBytes?:number}} [options]
 */
export function parseRsid(input,{maxBytes=RSID_MAX_FILE_BYTES}={}){
  if(!Number.isSafeInteger(maxBytes)||maxBytes<RSID_HEADER_BYTES+3||maxBytes>RSID_MAX_FILE_BYTES)throw new RangeError(`RSID maxBytes must be an integer ${RSID_HEADER_BYTES+3}..${RSID_MAX_FILE_BYTES}`);
  const source=input instanceof ArrayBuffer?new Uint8Array(input)
    :ArrayBuffer.isView(input)?new Uint8Array(input.buffer,input.byteOffset,input.byteLength):null;
  if(!source)throw new TypeError('RSID input must be an ArrayBuffer or byte view');
  if(source.byteLength>maxBytes)throw new SidRsidError(`file exceeds the ${maxBytes}-byte limit`,'RSID_LIMIT');
  const originalBytes=Uint8Array.from(source);
  if(originalBytes.length<4)invalid('truncated signature');
  const magic=String.fromCharCode(...originalBytes.subarray(0,4));
  if(magic==='PSID')unsupported('PSID uses the separate PSID player and parser');
  if(magic!=='RSID')invalid('expected RSID signature');
  if(originalBytes.length<6)invalid('truncated version field');
  const view=new DataView(originalBytes.buffer),version=view.getUint16(4);
  if(version!==2)unsupported(`version ${version}; this player supports RSID v2 only`);
  if(originalBytes.length<RSID_HEADER_BYTES)invalid('truncated v2 header');
  const dataOffset=view.getUint16(6);
  if(dataOffset!==RSID_HEADER_BYTES)invalid('v2 dataOffset must be exactly 0x007C');
  const headerLoadAddress=view.getUint16(8),headerInitAddress=view.getUint16(10),playAddress=view.getUint16(12),speed=view.getUint32(18);
  if(headerLoadAddress!==0)invalid('the reserved header loadAddress must be zero');
  if(playAddress!==0)invalid('the reserved playAddress must be zero; RSID runs its own interrupts');
  if(speed!==0)invalid('the reserved speed field must be zero; it is not a VBI speed flag');
  const flags=view.getUint16(0x76);
  if(flags&1)unsupported('external MUS player data is not supported');
  if(flags&0xfc00)unsupported('reserved or newer-version flag bits are set');
  if(flags&0x03c0)unsupported('additional SID model flags are outside the single-SID subset');
  if(originalBytes[0x7a]||originalBytes[0x7b])invalid('v2 reserved second/third SID address fields must be zero');
  const basic=!!(flags&2),clockBits=(flags>>>2)&3,modelBits=(flags>>>4)&3;
  const clock=['unknown','pal','ntsc','any'][clockBits],model=['unknown','6581','8580','any'][modelBits];
  const songs=view.getUint16(14),startSong=view.getUint16(16);
  if(songs<1||songs>256)invalid('songs must be between 1 and 256');
  if(startSong<1||startSong>songs)invalid('startSong must be one-based and no greater than songs');
  if(originalBytes.length<dataOffset+2)invalid('missing embedded little-endian load address');
  const programOffset=dataOffset+2,loadAddress=view.getUint16(dataOffset,true),programLength=originalBytes.length-programOffset;
  if(programLength<1)invalid('empty C64 program payload');
  if(loadAddress<0x07e8)invalid('effective loadAddress must be at least $07E8');
  const endAddress=loadAddress+programLength;
  if(endAddress>0x10000)invalid('C64 load range exceeds the 64-KiB address space');
  let initAddress;
  if(basic){
    if(headerInitAddress!==0)invalid('the C64 BASIC flag requires header initAddress zero');
    initAddress=0;
  }else{
    initAddress=headerInitAddress||loadAddress;
    if(initAddress<loadAddress||initAddress>=endAddress)invalid('effective initAddress must lie inside the loaded C64 payload');
    if(initAddress<0x07e8||initAddress>=0xa000&&initAddress<0xc000||initAddress>=0xd000)invalid('machine-code initAddress must be in $07E8..$9FFF or $C000..$CFFF, outside ROM/I/O');
  }
  const startPage=originalBytes[0x78],pageLength=originalBytes[0x79];
  if(startPage===0||startPage===255){if(pageLength!==0)invalid('relocation pageLength must be zero for startPage 0 or 255');}
  else{
    if(pageLength===0||startPage+pageLength>256)invalid('relocation page range is empty or exceeds C64 memory');
    const from=startPage*256,to=(startPage+pageLength)*256;
    if(overlaps(from,to,loadAddress,endAddress))invalid('relocation pages overlap the loaded payload');
    if(overlaps(from,to,0,0x400)||overlaps(from,to,0xa000,0xc000)||overlaps(from,to,0xd000,0x10000))invalid('relocation pages overlap reserved memory or a ROM/I/O area');
  }
  return{
    format:'RSID',version,dataOffset,programOffset,fileSize:originalBytes.length,
    headerLoadAddress,headerInitAddress,loadAddressEmbedded:true,loadAddress,initAddress,playAddress,
    endAddress,programLength,songs,startSong,speed,flags,basic,clockBits,modelBits,clock,model,
    clockHz:clock==='pal'?985248:null,sidAddress:0xd400,sidCount:1,timing:'c64-irq',
    relocation:{startPage,pageLength},
    metadata:{name:text(originalBytes,0x16),author:text(originalBytes,0x36),released:text(originalBytes,0x56)},
    program:originalBytes.slice(programOffset),originalBytes,
  };
}

/** Select this first browser engine's PAL/6581 target without falsifying hints.
 * Unknown/either clock or model requires its corresponding explicit option.
 * Known NTSC/8580 is rejected even when an override was supplied. `rom` names
 * an execution mode only: the machine loader must separately validate all ROM
 * bytes and actually boot that environment before accepting a BASIC program.
 * @param {ArrayBuffer|ArrayBufferView} input
 * @param {{subtune?:number,clock?:'pal',model?:'6581',environment?:'minimal'|'rom',maxBytes?:number}} [options]
 * @returns {ReturnType<typeof parseRsid> & {subtune:number,selectedClock:'pal',selectedModel:'6581',clockHz:number,environment:'minimal'|'rom',selection:{clock:string,model:string}}}
 */
export function validateBrowserRsid(input,{subtune,clock,model,environment='minimal',maxBytes=RSID_MAX_FILE_BYTES}={}){
  if(clock!==undefined&&clock!=='pal')throw new RangeError('The browser RSID target clock option must be pal');
  if(model!==undefined&&model!=='6581')throw new RangeError('The browser RSID target model option must be 6581');
  if(environment!=='minimal'&&environment!=='rom')throw new RangeError('RSID environment must be minimal or rom');
  const parsed=parseRsid(input,{maxBytes});
  if(parsed.clock==='ntsc')unsupported('this browser engine does not support a tune declared as NTSC');
  if(parsed.model==='8580')unsupported('this browser engine does not support a tune declared as 8580');
  if(parsed.clock!=='pal'&&clock!=='pal')throw new SidRsidError('clock is unspecified or supports either standard; explicitly choose PAL to continue','RSID_CHOICE_REQUIRED');
  if(parsed.model!=='6581'&&model!=='6581')throw new SidRsidError('model is unspecified or supports either SID; explicitly choose 6581 to continue','RSID_CHOICE_REQUIRED');
  const selected=subtune===undefined?parsed.startSong:subtune;
  if(!Number.isInteger(selected)||selected<1||selected>parsed.songs)throw new RangeError(`RSID subtune must be an integer 1..${parsed.songs}`);
  if(parsed.basic&&environment==='minimal')throw new SidRsidError('C64 BASIC requires the ROM environment and three valid user-supplied ROM images','RSID_ROM_REQUIRED');
  return{...parsed,subtune:selected,selectedClock:'pal',selectedModel:'6581',clockHz:985248,environment,
    selection:{clock:parsed.clock==='pal'?'header':'explicit',model:parsed.model==='6581'?'header':'explicit'}};
}

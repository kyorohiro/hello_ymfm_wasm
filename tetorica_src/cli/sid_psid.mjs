// SPDX-License-Identifier: BSD-3-Clause
// Original bounded metadata parser; no C64 CPU, ROM or third-party player code.
// Format facts: HVSC SID_file_format.txt (2026-10-09), sections +00 through +7B.
export const PSID_SPECIFICATION_URL='https://hvsc.c64.org/download/C64Music/DOCUMENTS/SID_file_format.txt';
export const PSID_HEADER_BYTES=0x7c;
export const PSID_MAX_FILE_BYTES=0x10000+PSID_HEADER_BYTES;

export class SidPsidError extends Error {
  constructor(message,code='PSID_INVALID'){super(`PSID: ${message}`);this.name='SidPsidError';this.code=code;}
}
const invalid=message=>{throw new SidPsidError(message);};
const unsupported=message=>{throw new SidPsidError(message,'PSID_UNSUPPORTED');};
const overlaps=(a,b,c,d)=>a<d&&c<b;
const textDecoder=new TextDecoder('windows-1252');
function text(bytes,offset){const field=bytes.subarray(offset,offset+32),end=field.indexOf(0);return textDecoder.decode(end<0?field:field.subarray(0,end));}

/** Parse an explicitly PAL/6581, single-SID PSID v2/v3/v4 for reference tooling.
 * This bounded subset requires an explicit play subroutine inside the payload;
 * IRQ-installed and init-generated playback entry points are not implemented.
 * Speed flags are retained: callers must enforce their supported VBI/CIA mode.
 * Does not execute or prove the safety/ROM independence of the C64 program.
 * @param {ArrayBuffer|ArrayBufferView} input
 * @param {{maxBytes?:number}} [options]
 */
export function parsePsid(input,{maxBytes=PSID_MAX_FILE_BYTES}={}){
  if(!Number.isSafeInteger(maxBytes)||maxBytes<PSID_HEADER_BYTES+1||maxBytes>PSID_MAX_FILE_BYTES)throw new RangeError(`PSID maxBytes must be an integer ${PSID_HEADER_BYTES+1}..${PSID_MAX_FILE_BYTES}`);
  const source=input instanceof ArrayBuffer?new Uint8Array(input)
    :ArrayBuffer.isView(input)?new Uint8Array(input.buffer,input.byteOffset,input.byteLength):null;
  if(!source)throw new TypeError('PSID input must be an ArrayBuffer or byte view');
  if(source.byteLength>maxBytes)throw new SidPsidError(`file exceeds the ${maxBytes}-byte limit`,'PSID_LIMIT');
  const originalBytes=Uint8Array.from(source);
  if(originalBytes.length<4)invalid('truncated signature');
  const magic=String.fromCharCode(...originalBytes.subarray(0,4));
  if(magic==='RSID')unsupported('RSID/BASIC requires a real-C64 environment and is outside this reference subset');
  if(magic!=='PSID')invalid('expected PSID signature');
  if(originalBytes.length<6)invalid('truncated version field');
  const view=new DataView(originalBytes.buffer),version=view.getUint16(4);
  if(![2,3,4].includes(version))unsupported(`version ${version}; this parser supports PSID v2, v3 and v4 only`);
  if(originalBytes.length<PSID_HEADER_BYTES)invalid('truncated v2/v3/v4 header');
  const dataOffset=view.getUint16(6);
  if(dataOffset!==PSID_HEADER_BYTES)invalid('v2/v3/v4 dataOffset must be exactly 0x007C');
  const flags=view.getUint16(0x76);
  if(flags&1)unsupported('external MUS player data is not supported');
  if(flags&2)unsupported('PlaySID-specific player features are not supported');
  if(flags&0xfc00)unsupported('reserved or v5-only flag bits are set');
  if(flags&0x03c0)unsupported('additional SID model flags are outside the single-SID subset');
  const clockBits=(flags>>>2)&3,modelBits=(flags>>>4)&3;
  if(clockBits!==1)unsupported('the video standard must explicitly select PAL (not unknown, NTSC or both)');
  if(modelBits!==1)unsupported('the SID model must explicitly select 6581 (not unknown, 8580 or both)');
  const secondSidAddress=originalBytes[0x7a],thirdSidAddress=originalBytes[0x7b];
  if(version===2&&(secondSidAddress||thirdSidAddress))invalid('v2 reserved SID address fields must be zero');
  if(version===3&&thirdSidAddress)invalid('v3 reserved third-SID address field must be zero');
  if(secondSidAddress||thirdSidAddress)unsupported('additional SID address fields are outside the single-SID subset');
  const songs=view.getUint16(0x0e),startSong=view.getUint16(0x10),speed=view.getUint32(0x12);
  if(songs<1||songs>256)invalid('songs must be between 1 and 256');
  if(startSong<1||startSong>songs)invalid('startSong must be one-based and no greater than songs');
  const headerLoadAddress=view.getUint16(8),headerInitAddress=view.getUint16(0x0a),playAddress=view.getUint16(0x0c);
  const loadAddressEmbedded=headerLoadAddress===0;
  let programOffset=dataOffset,loadAddress=headerLoadAddress;
  if(loadAddressEmbedded){
    if(originalBytes.length<programOffset+2)invalid('missing embedded little-endian load address');
    loadAddress=view.getUint16(programOffset,true);programOffset+=2;
  }
  const programLength=originalBytes.length-programOffset;
  if(programLength<1)invalid('empty C64 program payload');
  const endAddress=loadAddress+programLength;
  if(endAddress>0x10000)invalid('C64 load range exceeds the 64-KiB address space');
  const initAddress=headerInitAddress||loadAddress;
  if(initAddress<loadAddress||initAddress>=endAddress)invalid('effective initAddress must lie inside the loaded C64 payload');
  if(playAddress===0)unsupported('playAddress 0 installs an IRQ handler; this subset requires an explicit play subroutine');
  if(playAddress<loadAddress||playAddress>=endAddress)unsupported('playAddress outside the loaded payload may require init-generated code and is not supported');
  const startPage=originalBytes[0x78],pageLength=originalBytes[0x79];
  if(startPage===0||startPage===255){if(pageLength!==0)invalid('relocation pageLength must be zero for startPage 0 or 255');}
  else{
    if(pageLength===0||startPage+pageLength>256)invalid('relocation page range is empty or exceeds C64 memory');
    if(overlaps(startPage*256,(startPage+pageLength)*256,loadAddress,endAddress))invalid('relocation pages overlap the loaded payload');
  }
  return {
    format:'PSID',version,dataOffset,programOffset,fileSize:originalBytes.length,
    headerLoadAddress,headerInitAddress,loadAddressEmbedded,loadAddress,initAddress,playAddress,
    endAddress,programLength,songs,startSong,speed,flags,
    clock:'pal',clockHz:985248,model:'6581',sidAddress:0xd400,sidCount:1,
    // With PlaySID-specific disabled, bit 31 covers songs 32 through 256.
    songSpeeds:Array.from({length:songs},(_,index)=>(speed>>>Math.min(index,31))&1?'cia':'vbi'),
    relocation:{startPage,pageLength},
    metadata:{name:text(originalBytes,0x16),author:text(originalBytes,0x36),released:text(originalBytes,0x56)},
    program:originalBytes.slice(programOffset),originalBytes,
  };
}

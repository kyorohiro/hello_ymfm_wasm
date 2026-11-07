// Generated research-only parser view; original BSD source follows unchanged.
// SPDX-License-Identifier: BSD-3-Clause
// Original bounded browser-safe metadata parser; no C64 CPU, ROM or third-party player code.
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
// AudioWorkletGlobalScope does not expose TextDecoder. Windows-1252 differs
// from the byte's Unicode value only in this 0x80..0x9F table; undefined C1
// entries retain their control-code values, matching the WHATWG decoder.
const windows1252C1='\u20ac\u0081\u201a\u0192\u201e\u2026\u2020\u2021\u02c6\u2030\u0160\u2039\u0152\u008d\u017d\u008f\u0090\u2018\u2019\u201c\u201d\u2022\u2013\u2014\u02dc\u2122\u0161\u203a\u0153\u009d\u017e\u0178';
function text(bytes,offset){let result='';for(let i=offset;i<offset+32&&bytes[i]!==0;i++){const value=bytes[i];result+=value>=0x80&&value<=0x9f?windows1252C1[value-0x80]:String.fromCharCode(value);}return result;}

/** Private common layout parser. Strict target guards retain the CLI's original
 * validation order; the browser reads raw hints before its explicit selection.
 * @param {ArrayBuffer|ArrayBufferView} input
 * @param {{maxBytes?:number}} [options]
 * @param {boolean} [strictTarget]
 */
function parsePsidStructure(input,{maxBytes=PSID_MAX_FILE_BYTES}={},strictTarget=false){
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
  if(strictTarget){
    if(clockBits!==1)unsupported('the video standard must explicitly select PAL (not unknown, NTSC or both)');
    if(modelBits!==1)unsupported('the SID model must explicitly select 6581 (not unknown, 8580 or both)');
  }
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
    clock:['unknown','pal','ntsc','any'][clockBits],clockHz:clockBits===1?985248:null,
    model:['unknown','6581','8580','any'][modelBits],sidAddress:0xd400,sidCount:1,
    // With PlaySID-specific disabled, bit 31 covers songs 32 through 256.
    songSpeeds:Array.from({length:songs},(_,index)=>(speed>>>Math.min(index,31))&1?'cia':'vbi'),
    relocation:{startPage,pageLength},
    metadata:{name:text(originalBytes,0x16),author:text(originalBytes,0x36),released:text(originalBytes,0x56)},
    program:originalBytes.slice(programOffset),originalBytes,
  };
}

/** Parse an explicitly PAL/6581, single-SID PSID v2/v3/v4 for reference tooling.
 * This entry remains strict: browser target choices cannot loosen the CLI.
 * An explicit play subroutine inside the payload is required; IRQ-installed
 * and init-generated playback entry points are not implemented. Speed flags
 * are retained, so callers enforce their supported VBI/CIA mode separately.
 * Does not execute or prove the safety/ROM independence of the C64 program.
 * @param {ArrayBuffer|ArrayBufferView} input
 * @param {{maxBytes?:number}} [options]
 */
export function parsePsid(input,{maxBytes=PSID_MAX_FILE_BYTES}={}){
  const parsed=parsePsidStructure(input,{maxBytes},true);
  return{...parsed,clock:'pal',clockHz:985248,model:'6581'};
}

/** Validate the smaller standalone browser-player subset and select a song.
 * This checks the file layout, not the program's instructions or behavior.
 * The selected song chooses its VBI or CIA runner. Each bounded CPU runner
 * must independently enforce its supported instructions and ROM dependencies.
 * Header initAddress 0 follows PSID's effective-load-address fallback.
 * Unknown/either clock and model hints need corresponding explicit options.
 * Known NTSC/8580 is rejected even if a PAL/6581 override was supplied. The
 * returned declaration fields and original header bytes are never rewritten.
 * @param {ArrayBuffer|ArrayBufferView} input
 * @param {{subtune?:number,clock?:'pal',model?:'6581',vbiBackend?:'direct'|'c64',maxBytes?:number}} [options]
 * @returns {ReturnType<typeof parsePsidStructure> & {subtune:number,timing:'vbi'|'cia',playbackBackend:'direct'|'c64',driverPage:number|null,selectedClock:'pal',selectedModel:'6581',clockHz:number,selection:{clock:string,model:string}}}
 */
export function validateBrowserPsid(input,{subtune,clock,model,vbiBackend='direct',maxBytes=PSID_MAX_FILE_BYTES}={}){
  if(clock!==undefined&&clock!=='pal')throw new RangeError('The browser PSID target clock option must be pal');
  if(model!==undefined&&model!=='6581')throw new RangeError('The browser PSID target model option must be 6581');
  if(vbiBackend!=='direct'&&vbiBackend!=='c64')throw new RangeError('The PSID VBI backend must be direct or c64');
  const parsed=parsePsidStructure(input,{maxBytes});
  if(parsed.version!==2)unsupported('the browser player supports PSID v2 only');
  if(parsed.loadAddress<0x0800||parsed.endAddress>0xd000)unsupported('the browser player supports program RAM $0800..$CFFF only');
  if(parsed.clock==='ntsc')unsupported('this browser engine does not support a tune declared as NTSC');
  if(parsed.model==='8580')unsupported('this browser engine does not support a tune declared as 8580');
  if(parsed.clock!=='pal'&&clock!=='pal')throw new SidPsidError('clock is unspecified or supports either standard; explicitly choose PAL to continue','PSID_CHOICE_REQUIRED');
  if(parsed.model!=='6581'&&model!=='6581')throw new SidPsidError('model is unspecified or supports either SID; explicitly choose 6581 to continue','PSID_CHOICE_REQUIRED');
  const selected=subtune===undefined?parsed.startSong:subtune;
  if(!Number.isInteger(selected)||selected<1||selected>parsed.songs)throw new RangeError(`PSID subtune must be an integer 1..${parsed.songs}`);
  const timing=parsed.songSpeeds[selected-1];
  const playbackBackend=timing==='cia'||vbiBackend==='c64'?'c64':'direct';
  let driverPage=null;
  if(playbackBackend==='c64'){
    const {startPage,pageLength}=parsed.relocation;
    const hint=timing==='vbi'?'; select Direct VBI in Playback settings to try the limited host':'';
    if(startPage===255)unsupported(`this ${timing.toUpperCase()} subtune needs a free RAM page for its C64 player driver, but the header declares none ($FF/0)${hint}`);
    if(startPage===0)driverPage=0; // Existing clean-file driver layout.
    else{
      // Relocation describes free DRIVER RAM, not a new payload load address.
      // The packed original driver needs one page visible under both $37/$36.
      for(let page=startPage;page<startPage+pageLength;page++){
        if(page>=4&&(page<0xa0||page>=0xc0&&page<0xd0)){driverPage=page;break;}
      }
      if(driverPage===null)unsupported(`the declared relocation range has no always-visible RAM page for the ${timing.toUpperCase()} C64 player driver${hint}`);
    }
  }
  return {...parsed,subtune:selected,timing,playbackBackend,driverPage,selectedClock:'pal',selectedModel:'6581',clockHz:985248,
    selection:{clock:parsed.clock==='pal'?'header':'explicit',model:parsed.model==='6581'?'header':'explicit'}};
}

// Research code applies its own explicit PAL/8580 selection.
export {parsePsidStructure};

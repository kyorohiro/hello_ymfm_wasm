import {Ym2612VGM, rawCommandLength} from '../js/ym2612vgm.js';

const hex = bytes => {
  const chunks=[];
  for(let start=0;start<bytes.length;start+=8192)
    chunks.push(Array.from(bytes.subarray(start,start+8192),v=>v.toString(16).padStart(2,'0')).join(''));
  return chunks.join('');
};
function unhex(value) {
  if(typeof value!=='string' || value.length%2 || !/^[0-9a-f]*$/i.test(value))
    throw new Error('Expected an even-length hexadecimal string');
  const bytes=new Uint8Array(value.length/2);
  for(let i=0;i<bytes.length;i++)bytes[i]=parseInt(value.slice(i*2,i*2+2),16);
  return bytes;
}

/** Lossless, fixed-layout representation of decompressed VGM bytes. */
export function vgmToJson(source, {comments=false} = {}) {
  const parser=new Ym2612VGM(source,{logger:null});
  const bytes=parser.bytes, start=parser.header.dataOffset;
  if(start<64 || start>bytes.length)throw new Error('Invalid VGM data offset');
  const commands=[];
  const warnings=[];
  let offset=start;
  while(offset<bytes.length){
    let length;
    try {length=rawCommandLength(bytes,parser.view,offset);}
    catch {warnings.push(`Unrecognized or truncated command at byte ${offset}; remaining bytes preserved as tail.`);break;}
    if(offset+length>bytes.length){warnings.push(`Truncated command at byte ${offset}; remaining bytes preserved as tail.`);break;}
    commands.push({offset,hex:hex(bytes.subarray(offset,offset+length)),
      ...(comments ? {comment:parser.describeCommandAt(offset)} : {})});
    const end=bytes[offset]===0x66;
    offset+=length;
    if(end)break;
  }
  return {schemaVersion:1,format:'tetorica-vgm-lossless',byteLength:bytes.length,
    headerHex:hex(bytes.subarray(0,start)),commands,tail:{offset,hex:hex(bytes.subarray(offset))},warnings};
}

/** Restore bytes without normalizing headers, waits, metadata or unknown data. */
export function jsonToVgm(document) {
  if(!document || document.schemaVersion!==1 || document.format!=='tetorica-vgm-lossless')
    throw new Error('Unsupported VGM JSON schema');
  if(!Number.isSafeInteger(document.byteLength) || document.byteLength<64 || document.byteLength>0xffffffff)
    throw new Error('Invalid VGM byteLength');
  if(!Array.isArray(document.commands) || !document.tail)throw new Error('Missing commands or tail');
  const header=unhex(document.headerHex);
  const parts=[header];
  let offset=header.length;
  for(const entry of [...document.commands,document.tail]){
    if(!entry || entry.offset!==offset)throw new Error('Fixed-layout JSON requires contiguous original offsets and unchanged byte lengths');
    const bytes=unhex(entry.hex);
    parts.push(bytes);offset+=bytes.length;
    if(offset>document.byteLength)throw new Error('VGM byteLength mismatch');
  }
  if(offset!==document.byteLength)throw new Error('VGM byteLength mismatch');
  // Allocate only after validating the actual payload size.
  const bytes=new Uint8Array(offset);
  offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}
  const canonical=vgmToJson(bytes);
  if(canonical.headerHex.length!==document.headerHex.length || canonical.commands.length!==document.commands.length ||
    canonical.commands.some((c,i)=>c.offset!==document.commands[i].offset || c.hex.length!==document.commands[i].hex.length) ||
    canonical.tail.offset!==document.tail.offset)
    throw new Error('Edited bytes change command boundaries; only fixed-layout edits are supported');
  return bytes;
}

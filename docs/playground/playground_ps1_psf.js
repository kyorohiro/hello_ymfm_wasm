// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 kyorohiro.
// PSF1 static extraction only; no CPU/driver execution or network file access.
// https://gist.github.com/SaxxonPike/11618bd321a45a70c01febae43ff564e
import {MAX_VAB_FILE_BYTES,readVab,prepareVabTone} from './playground_ps1_vab.js';

export const PSF_FILES = /\.(?:psf1?|minipsf1?|psflib|psf1lib)$/i;
export const MAX_PSF_FILE_BYTES = 4*1024*1024;
const RAM_BYTES=2*1024*1024, MAX_EXE_BYTES=2033664, MAX_FILES=512, MAX_SET_BYTES=64*1024*1024;
const fail=message=>{throw new Error(`PSF: ${message}`);};
const check=signal=>signal?.throwIfAborted();
const bytesOf=input=>{
  if(input instanceof ArrayBuffer)return new Uint8Array(input);
  if(ArrayBuffer.isView(input))return new Uint8Array(input.buffer,input.byteOffset,input.byteLength);
  throw new TypeError('Expected PSF bytes');
};
const text=(bytes)=>new TextDecoder().decode(bytes);
const signature=(bytes,at,value)=>value.split('').every((char,i)=>bytes[at+i]===char.charCodeAt(0));
const crcTable=Uint32Array.from({length:256},(_,value)=>{for(let bit=0;bit<8;bit++)value=(value>>>1)^((value&1)?0xedb88320:0);return value>>>0;});
export function psfCrc32(bytes){let crc=0xffffffff;for(const byte of bytes)crc=crcTable[(crc^byte)&255]^(crc>>>8);return (crc^0xffffffff)>>>0;}

function pathOf(value,base='') {
  if(typeof value!=='string'||!value||value.length>1024||/[\x00-\x1f:]/.test(value)||/^[\\/]/.test(value))fail('expected a relative library/file path');
  const parts=base?base.split('/'):[];
  for(const part of value.replaceAll('\\','/').split('/')) {
    if(!part||part==='.')continue;
    if(part==='..'){if(!parts.length)fail('library path escapes the selected set');parts.pop();}
    else parts.push(part);
  }
  if(!parts.length)fail('empty file path');
  return parts.join('/');
}

/** Header + compressed CRC are checked before any decompression. */
export function readPsfFile(input) {
  const bytes=bytesOf(input);
  if(bytes.length<16||bytes.length>MAX_PSF_FILE_BYTES||!signature(bytes,0,'PSF'))fail('expected a PSF file of at most 4 MiB');
  if(bytes[3]!==1)fail(`unsupported version ${bytes[3]} (PSF1 only; PSF2 is for PS2)`);
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  const reserved=view.getUint32(4,true),size=view.getUint32(8,true),start=16+reserved,end=start+size;
  if(end>bytes.length)fail('truncated reserved/compressed section');
  const compressed=bytes.slice(start,end);
  if(psfCrc32(compressed)!==view.getUint32(12,true))fail('compressed program CRC-32 mismatch');
  const tags=new Map();
  if(signature(bytes,end,'[TAG]')) {
    if(bytes.length-end-5>50000)fail('tags exceed 50,000 bytes');
    const raw=text(bytes.subarray(end+5));if(raw.includes('\0'))fail('NUL in tags');
    const trim=value=>value.replace(/^[\x01-\x20]+|[\x01-\x20]+$/g,'');
    for(const line of raw.split('\n')) {
      const equal=line.indexOf('=');if(equal<0)continue;
      const name=trim(line.slice(0,equal)).toLowerCase(),value=trim(line.slice(equal+1));
      if(!/^[a-z_][a-z_0-9]*$/.test(name))continue;
      if(/^_lib(?:\d+)?$/.test(name)&&tags.has(name))fail(`duplicate ${name} tag`);
      tags.set(name,tags.has(name)?`${tags.get(name)}\n${value}`:value);
    }
  }
  return {compressed,tags};
}

/** Files retain their selected relative paths; library names never cause fetch. */
export async function readPsfFileSet(files,{signal}={}) {
  if(!files.length||files.length>MAX_FILES)fail('select 1–512 PSF/library files');
  let total=0;
  for(const file of files){if(!Number.isSafeInteger(file.size)||file.size<16||file.size>MAX_PSF_FILE_BYTES)fail('each file must be 16 bytes–4 MiB');total+=file.size;}
  if(total>MAX_SET_BYTES)fail('selected files exceed 64 MiB');
  const records=new Map(),folded=new Map();
  for(const file of files) {
    check(signal);
    const path=pathOf(file.webkitRelativePath||file.name);
    if(records.has(path))fail(`duplicate path: ${path}. Use folder selection to retain subdirectories.`);
    const bytes=await file.arrayBuffer();check(signal);
    if(bytes.byteLength!==file.size)fail(`file size changed: ${path}`);
    const record={path,...readPsfFile(bytes)};records.set(path,record);
    const key=path.toLowerCase();folded.set(key,folded.has(key)?null:path);
  }
  const songs=[...records.values()].filter(record=>!/\.(?:psflib|psf1lib)$/i.test(record.path));
  return {records,folded,entries:(songs.length?songs:[...records.values()]).map(record=>({path:record.path,title:record.tags.get('title')??''})),totalBytes:total};
}

async function inflateProgram(compressed,signal) {
  check(signal);if(!compressed.length)return new Uint8Array();
  if(typeof DecompressionStream!=='function')fail('this browser needs zlib DecompressionStream support');
  const reader=new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate')).getReader();
  const chunks=[];let size=0;
  const abort=()=>{void reader.cancel(signal.reason).catch(()=>{});};
  signal?.addEventListener('abort',abort,{once:true});
  try {
    while(true){check(signal);const {done,value}=await reader.read();check(signal);if(done)break;
      size+=value.length;if(size>MAX_EXE_BYTES){await reader.cancel();fail('expanded PS-X EXE exceeds 2,033,664 bytes');}chunks.push(value);
    }
  } catch(error){check(signal);fail(`zlib decompression failed: ${error.message}`);}
  finally{signal?.removeEventListener('abort',abort);reader.releaseLock();}
  const result=new Uint8Array(size);let at=0;for(const chunk of chunks){result.set(chunk,at);at+=chunk.length;}return result;
}

function exeSegment(exe) {
  if(!exe.length)return {address:0,data:exe};
  if(exe.length<0x800||!signature(exe,0,'PS-X EXE'))fail('program is not a PS-X EXE');
  const view=new DataView(exe.buffer,exe.byteOffset,exe.byteLength),address=view.getUint32(0x18,true),size=view.getUint32(0x1c,true);
  if(size>exe.length-0x800)fail('truncated PS-X EXE text section');
  // PS1's three RAM aliases, with 2 MiB mirrors inside each 8 MiB window.
  const physical=address&0x1fffffff;
  if(!((address<0x800000)||(address>=0x80000000&&address<0x80800000)||(address>=0xa0000000&&address<0xa0800000))||physical>=0x800000)fail('EXE load address is outside PS1 RAM');
  const offset=physical&0x1fffff;
  if(offset+size>RAM_BYTES)fail('EXE text crosses the end of the 2 MiB RAM image');
  return {address:offset,data:exe.slice(0x800,0x800+size)};
}

/** _lib -> own text -> _lib2, _lib3... (stop at the first absent number). */
export async function composePsfRam(set,entryPath,{signal}={}) {
  if(!set.records.has(entryPath))fail('choose a PSF entry');
  const ram=new Uint8Array(RAM_BYTES),coverage=new Uint8Array(RAM_BYTES),cache=new Map(),loadedFiles=[];
  let expanded=0,visits=0;
  async function segment(record) {
    if(cache.has(record.path))return cache.get(record.path);
    const exe=await inflateProgram(record.compressed,signal);expanded+=exe.length;
    if(expanded>32*1024*1024)fail('dependency programs exceed the 32 MiB expanded budget');
    const value=exeSegment(exe);cache.set(record.path,value);return value;
  }
  function library(record,name) {
    const requested=pathOf(name,record.path.split('/').slice(0,-1).join('/'));
    if(set.records.has(requested))return set.records.get(requested);
    const match=set.folded.get(requested.toLowerCase());
    if(match)return set.records.get(match);
    if(set.folded.has(requested.toLowerCase()))fail(`ambiguous library path: ${requested}`);
    fail(`missing PSFLib ${requested} (from ${record.path}). Select the related files together or open their folder.`);
  }
  async function load(record,stack=[]) {
    check(signal);
    if(stack.includes(record.path))fail(`cyclic library reference: ${[...stack,record.path].join(' → ')}`);
    if(stack.length>=10||++visits>256)fail('library depth/visit limit exceeded');
    const next=[...stack,record.path];
    if(record.tags.has('_lib'))await load(library(record,record.tags.get('_lib')),next);
    const {address,data}=await segment(record);check(signal);ram.set(data,address);coverage.fill(1,address,address+data.length);loadedFiles.push(record.path);
    for(let index=2;record.tags.has(`_lib${index}`);index++)await load(library(record,record.tags.get(`_lib${index}`)),next);
  }
  await load(set.records.get(entryPath));
  return {ram,coverage,loadedFiles,expandedBytes:expanded,entryPath};
}

const ramAddress=at=>`0x${(0x80000000+at).toString(16)}`;

/** Shared UI diagnostic; never includes sample data. */
export function psfRejectionSummary({diagnostics=[]}) {
  if(!diagnostics.length)return '';
  const details=diagnostics.slice(0,3).map(item=>`${ramAddress(item.address)}: ${item.reason}`).join('; ');
  return ` Skipped ${diagnostics.length} VAB candidate(s): ${details}${diagnostics.length>3?'; …':''}.`;
}

/** Only contiguous, fully loaded VAB headers+bodies are matched initially.
 * A playable Tone is insufficient when the assumed body contains another
 * validated header. This is a conservative layout guard, not a VH/VB resolver. */
export function findPsfVabs({ram,coverage}) {
  const banks=[],headers=[],sequences=[],records=[],diagnostics=[];let candidates=0,extracted=0;
  const view=new DataView(ram.buffer,ram.byteOffset,ram.byteLength);
  const loaded=(start,end)=>coverage.subarray(start,end).every(byte=>byte===1);
  for(let at=0;at+15<=ram.length;at++) {
    if(ram[at]!==0x70)continue;
    // Sony SEQ v1 header: big-endian version, resolution, tempo and rhythm.
    // https://psx-spx.consoledev.net/cdromfileformats/#seq-single-sequence
    // Magic alone (or SEP's shared magic) does not establish a conflict.
    // Some SEQs leave both rhythm bytes zero (observed in Crash Bandicoot).
    if(signature(ram,at,'pQES')&&loaded(at,at+15)&&view.getUint32(at+4,false)===1&&
      view.getUint16(at+8,false)>0&&(ram[at+10]||ram[at+11]||ram[at+12])&&
      ((ram[at+13]>0&&ram[at+13]<128&&ram[at+14]<=7)||(ram[at+13]===0&&ram[at+14]===0))) {
      if(sequences.length>=256)fail('too many structured SEQ headers');
      sequences.push(at);
    }
    if(at+0x20>ram.length||!signature(ram,at,'pBAV'))continue;
    if(++candidates>256)fail('too many VAB candidates');
    const size=view.getUint32(at+12,true),headerBytes=0xa20+view.getUint16(at+0x12,true)*0x200;
    const record={address:at,size,headerBytes};records.push(record);
    if(size<0xa20||size>MAX_VAB_FILE_BYTES||at+size>ram.length||headerBytes>size||!loaded(at,at+headerBytes)) {
      Object.assign(record,{code:'unloaded-or-invalid-range',reason:'header/body range is invalid or not fully loaded'});continue;
    }
    try {
      // Body bytes are not interpreted by readVab. Validate the whole header
      // even if its own VB is missing or none of its Tones can be prepared.
      readVab(ram.subarray(at,at+size));headers.push(record);
      if(!loaded(at,at+size))Object.assign(record,{code:'unloaded-or-invalid-range',reason:'header/body range is invalid or not fully loaded'});
    } catch(error){Object.assign(record,{code:'invalid-vab',reason:error.message});}
  }
  for(const record of records) {
    const {address:at,size,headerBytes}=record;
    if(!record.code) {
      const nested=headers.find(other=>other.address>=at+headerBytes&&other.address<at+size);
      const sequence=sequences.find(address=>address>=at+headerBytes&&address<at+size);
      if(nested)Object.assign(record,{code:'ambiguous-vab-body',conflictAddress:nested.address,reason:`assumed sample body contains another VAB header at ${ramAddress(nested.address)}; VH/VB mapping is uncertain`});
      else if(sequence!==undefined)Object.assign(record,{code:'ambiguous-seq-body',conflictAddress:sequence,reason:`assumed sample body contains a structured SEQ header at ${ramAddress(sequence)}; VH/VB mapping is uncertain`});
    }
    if(!record.code) {
      const bank=readVab(ram.subarray(at,at+size));
      if(!bank.tones.some((_,index)=>{try{prepareVabTone(bank,index);return true;}catch{return false;}}))Object.assign(record,{code:'no-supported-tone',reason:'no Tone passes sample validation'});
      else {
        extracted+=size;if(banks.length>=32||extracted>8*1024*1024)fail('extracted bank limit exceeded');
        banks.push({bank,address:at,bytes:size});
      }
    }
    if(record.code)diagnostics.push({address:at,code:record.code,reason:record.reason,...(record.conflictAddress!==undefined?{conflictAddress:record.conflictAddress}:{})});
  }
  return {banks,candidates,rejected:diagnostics.length,diagnostics};
}

export async function extractPsfVabs(set,entryPath,options={}) {
  const image=await composePsfRam(set,entryPath,options);check(options.signal);
  return {...findPsfVabs(image),loadedFiles:image.loadedFiles,expandedBytes:image.expandedBytes,entryPath};
}

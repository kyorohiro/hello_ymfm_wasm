// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 kyorohiro.
// Bounded local PSF1 container / overlay loader; no CPU or network file access.
// https://gist.github.com/SaxxonPike/11618bd321a45a70c01febae43ff564e
import {MAX_VAB_FILE_BYTES,readVab,prepareVabTone} from './playground_ps1_vab.js?v=ps1-vab-export-1';

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
  if(!exe.length)return {address:0,data:exe,registers:null,region:''};
  if(exe.length<0x800||!signature(exe,0,'PS-X EXE'))fail('program is not a PS-X EXE');
  const view=new DataView(exe.buffer,exe.byteOffset,exe.byteLength),address=view.getUint32(0x18,true),size=view.getUint32(0x1c,true);
  if(size>exe.length-0x800)fail('truncated PS-X EXE text section');
  // PS1's three RAM aliases, with 2 MiB mirrors inside each 8 MiB window.
  const physical=address&0x1fffffff;
  if(!((address<0x800000)||(address>=0x80000000&&address<0x80800000)||(address>=0xa0000000&&address<0xa0800000))||physical>=0x800000)fail('EXE load address is outside PS1 RAM');
  const offset=physical&0x1fffff;
  if(offset+size>RAM_BYTES)fail('EXE text crosses the end of the 2 MiB RAM image');
  return {address:offset,data:exe.slice(0x800,0x800+size),
    registers:{pc:view.getUint32(0x10,true),gp:view.getUint32(0x14,true),sp:view.getUint32(0x30,true)},
    region:text(exe.subarray(0x4c,0x100))};
}

/** _lib -> own text -> _lib2, _lib3... (stop at the first absent number). */
export async function composePsfRam(set,entryPath,{signal}={}) {
  if(!set.records.has(entryPath))fail('choose a PSF entry');
  const ram=new Uint8Array(RAM_BYTES),coverage=new Uint8Array(RAM_BYTES),cache=new Map(),loadedFiles=[];
  let expanded=0,visits=0,refreshOverride=null;
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
    if(refreshOverride===null&&record.tags.has('_refresh')) {
      const value=record.tags.get('_refresh');
      if(value==='50'||value==='60')refreshOverride=Number(value);
    }
    const next=[...stack,record.path];
    const primary=record.tags.has('_lib')?await load(library(record,record.tags.get('_lib')),next):null;
    const own=await segment(record),{address,data}=own;check(signal);ram.set(data,address);coverage.fill(1,address,address+data.length);loadedFiles.push(record.path);
    for(let index=2;record.tags.has(`_lib${index}`);index++)await load(library(record,record.tags.get(`_lib${index}`)),next);
    // Auxiliary libraries overlay RAM but never replace the entry PC/SP.
    return {registers:primary?.registers??own.registers,region:own.region};
  }
  const boot=await load(set.records.get(entryPath));
  return {ram,coverage,loadedFiles,expandedBytes:expanded,entryPath,
    registers:boot.registers,refresh:refreshOverride??(/Europe/i.test(boot.region)?50:60)};
}

const ramAddress=at=>`0x${(0x80000000+at).toString(16)}`;

/** Shared UI diagnostic; never includes sample data. */
export function psfRejectionSummary({diagnostics=[]}) {
  if(!diagnostics.length)return '';
  const details=diagnostics.slice(0,3).map(item=>`${ramAddress(item.address)}: ${item.reason}`).join('; ');
  return ` Skipped ${diagnostics.length} VAB candidate(s): ${details}${diagnostics.length>3?'; …':''}.`;
}

/** Match loaded Sony headers to one defensible sample body. The legacy
 * contiguous path retains bytes after END. A separated body needs exact sample
 * boundaries and a unique structural match; this is inference, not driver
 * pointer provenance. Zero padding is never treated as an address.
 * All searches stay inside the supplied image and have explicit work limits. */
export function findPsfVabs({ram,coverage}) {
  const banks=[],headers=[],sequences=[],records=[],diagnostics=[];
  let candidates=0,extracted=0,parsedBodyBytes=0,searchWork=0;
  const view=new DataView(ram.buffer,ram.byteOffset,ram.byteLength);
  const words=Math.ceil(ram.length/8),unloaded=new Uint32Array(words+1);
  for(let word=0;word<words;word++) {
    let missing=false;for(let at=word*8;at<Math.min(ram.length,word*8+8);at++)if(coverage[at]!==1){missing=true;break;}
    unloaded[word+1]=unloaded[word]+Number(missing);
  }
  const loaded=(start,end)=>{
    if(start<0||end<start||end>ram.length)return false;
    const first=Math.ceil(start/8),last=Math.floor(end/8);
    if(last>=first&&unloaded[last]!==unloaded[first])return false;
    for(let at=start;at<Math.min(end,first*8);at++)if(coverage[at]!==1)return false;
    for(let at=Math.max(start,last*8);at<end;at++)if(coverage[at]!==1)return false;
    return true;
  };
  const overlap=(a,b,c,d)=>a<d&&c<b;
  const rangeLookup=ranges=>{
    const merged=[];
    for(const [start,end]of ranges.sort((a,b)=>a[0]-b[0])) {
      const last=merged.at(-1);if(last&&start<=last[1])last[1]=Math.max(last[1],end);else merged.push([start,end]);
    }
    return(start,end)=>{
      let low=0,high=merged.length;
      while(low<high){const mid=(low+high)>>>1;if(merged[mid][1]<=start)low=mid+1;else high=mid;}
      return low<merged.length&&merged[low][0]<end;
    };
  };
  for(let at=0;at+15<=ram.length;at++) {
    if(ram[at]!==0x70)continue;
    // A validated SEQ is a conflicting structured file, not an ADPCM body.
    if(signature(ram,at,'pQES')&&loaded(at,at+15)&&view.getUint32(at+4,false)===1&&
      view.getUint16(at+8,false)>0&&(ram[at+10]||ram[at+11]||ram[at+12])&&
      ((ram[at+13]>0&&ram[at+13]<128&&ram[at+14]<=7)||(ram[at+13]===0&&ram[at+14]===0))) {
      if(sequences.length>=256)fail('too many structured SEQ headers');
      sequences.push(at);
    }
    if(at+0x20>ram.length||!signature(ram,at,'pBAV'))continue;
    if(++candidates>256)fail('too many VAB candidates');
    const size=view.getUint32(at+12,true),headerBytes=0xa20+view.getUint16(at+0x12,true)*0x200;
    const bodyBytes=size-headerBytes,record={address:at,size,headerBytes,bodyBytes};records.push(record);
    if(size<0xa20||size>MAX_VAB_FILE_BYTES||headerBytes>size||at+headerBytes>ram.length||!loaded(at,at+headerBytes)) {
      Object.assign(record,{code:'unloaded-or-invalid-range',reason:'header range is invalid or not fully loaded'});continue;
    }
    try {
      // Parse metadata without assuming where VB resides. readVab only copies
      // body bytes here; its sample/ADPCM content is checked below.
      parsedBodyBytes+=bodyBytes;
      if(parsedBodyBytes>32*1024*1024)fail('VAB metadata validation budget exceeded');
      const metadata=readVab(ram.subarray(at,at+headerBytes),new Uint8Array(bodyBytes));
      record.prefix=view.getUint16(at+headerBytes-0x200,true)*8;
      record.lengths=metadata.samples.map(sample=>sample.bytes.length);
      record.used=new Set(metadata.tones.map(tone=>tone.sample).filter(index=>index>0&&index<255&&index<=metadata.samples.length));
      headers.push(record);
    } catch(error) {
      if(parsedBodyBytes>32*1024*1024)throw error;
      Object.assign(record,{code:'invalid-vab',reason:error.message});
    }
  }
  // Preserve structured-file guards even if the nested header's own body is
  // absent or unsupported. A split guess must not hide an ambiguous old range.
  for(const record of headers) {
    const {address:at,size,headerBytes}=record,body=at+headerBytes;
    record.contiguous=body;
    if(at+size>ram.length||!loaded(body,at+size)) {
      record.contiguousError={code:'unloaded-or-invalid-range',reason:'contiguous body range is not fully loaded'};continue;
    }
    const nested=headers.find(other=>other!==record&&other.address>=body&&other.address<at+size);
    const sequence=sequences.find(address=>address>=body&&address<at+size);
    if(nested)Object.assign(record,{code:'ambiguous-vab-body',conflictAddress:nested.address,reason:`assumed sample body contains another VAB header at ${ramAddress(nested.address)}; VH/VB mapping is uncertain`});
    else if(sequence!==undefined)Object.assign(record,{code:'ambiguous-seq-body',conflictAddress:sequence,reason:`assumed sample body contains a structured SEQ header at ${ramAddress(sequence)}; VH/VB mapping is uncertain`});
  }
  const validPacket=at=>{
    const h=ram[at],f=ram[at+1];return at+16<=ram.length&&(h>>4)<=4&&(h&15)<=12&&!(f&~7);
  };
  // The existing contiguous format may contain padding after each sample's
  // first END. But every referenced sample must actually contain an END;
  // accepting just one Tone can mistake a later sample's tail for another one.
  // Unsupported predictor/flag values stay individual Tone diagnostics here,
  // so one bad sample does not hide other sounds in a known contiguous bank.
  for(const record of headers) {
    if(record.code||record.contiguousError)continue;
    let offset=record.contiguous+record.prefix,valid=record.used.size>0;
    for(let index=0;index<record.lengths.length;index++) {
      const length=record.lengths[index];
      if(record.used.has(index+1)) {
        let ended=false;
        for(let at=offset;at+16<=offset+length;at+=16) {
          if(ram[at+1]&1){ended=true;break;}
        }
        if(!ended)valid=false;
      }
      offset+=length;
    }
    record.contiguousValid=valid;
    if(!valid)record.contiguousError={code:'invalid-vab-body',reason:'contiguous body has an unterminated referenced sample'};
  }
  // Two parity lanes cover all 8-byte-aligned SPU addresses. Prefix counts make
  // each strict sample check constant-time, including a very large candidate.
  const invalid=new Uint32Array(words+2),ends=new Uint32Array(words+2),markers=new Uint32Array(words+2),endPackets=[];
  if(headers.some(record=>!record.code))for(let word=0;word+1<words;word++) {
    const at=word*8,valid=validPacket(at)&&unloaded[word+2]===unloaded[word],flags=ram[at+1];
    invalid[word+2]=invalid[word]+Number(!valid);
    ends[word+2]=ends[word]+Number(Boolean(flags&1));
    markers[word+2]=markers[word]+Number(Boolean(flags&4));
    if(valid&&(flags&1))endPackets.push(at);
  }
  const strictSample=(at,length)=>{
    if(length%16||at%8||at<0||at+length>ram.length)return false;
    const first=at/8,last=(at+length)/8;
    return invalid[last]===invalid[first]&&ends[last]-ends[first]===1&&markers[last]-markers[first]<=1&&Boolean(ram[at+length-15]&1);
  };
  const ownedBodies=headers.filter(record=>!record.code&&record.contiguousValid);
  const structured=rangeLookup([...headers.map(record=>[record.address,record.address+record.headerBytes]),...sequences.map(address=>[address,address+15])]);
  for(const record of headers) {
    if(record.code)continue;
    record.matches=[];
    const otherOwned=rangeLookup(ownedBodies.filter(other=>other!==record).map(other=>[other.contiguous,other.address+other.size]));
    const sampleBytes=record.lengths.reduce((total,length)=>total+length,record.prefix);
    if(record.lengths.length&&sampleBytes===record.bodyBytes)for(const end of endPackets) {
      if(++searchWork>1000000)fail('VB candidate search budget exceeded');
      const body=end+16-record.prefix-record.lengths[0],bodyEnd=body+record.bodyBytes;
      if(body===record.contiguous&&!record.contiguousValid)continue;
      if(body<0||body%8||!loaded(body,bodyEnd))continue;
      if(structured(body,bodyEnd))continue;
      // A distinct validated contiguous bank already owns its body. Do not
      // cross-pair common sample tables from ordinary multi-bank PSF images.
      if(otherOwned(body,bodyEnd))continue;
      let at=body+record.prefix,valid=true;
      for(const length of record.lengths) {
        if(++searchWork>1000000)fail('VB candidate search budget exceeded');
        if(!strictSample(at,length)){valid=false;break;}at+=length;
      }
      if(valid) {
        record.matches.push(body);
        // Retain all bounded matches so a later header cannot claim a body
        // also matched by an already ambiguous header.
        if(record.matches.length>256)fail('too many matching VB candidates');
      }
    }
    const alternatives=record.matches.filter(body=>body!==record.contiguous);
    if(record.matches.length>1||record.contiguousValid&&alternatives.length) {
      Object.assign(record,{code:'ambiguous-vb-candidates',reason:'multiple defensible sample bodies match this header; no VB was selected'});continue;
    }
    if(record.contiguousValid)record.bodyAddress=record.contiguous;
    else if(record.matches.length===1)record.bodyAddress=record.matches[0];
    else Object.assign(record,record.contiguousError??{code:'no-vb-body',reason:'no unique fully loaded sample body matches this header'});
  }
  // One unclaimed VB cannot establish ownership for two separated headers.
  for(const record of headers)if(!record.code&&record.bodyAddress!==record.contiguous) {
    if(headers.some(other=>other!==record&&other.matches?.some(body=>overlap(record.bodyAddress,record.bodyAddress+record.bodyBytes,body,body+other.bodyBytes))))
      record.sharedBody=true;
  }
  for(const record of headers)if(record.sharedBody)Object.assign(record,{code:'ambiguous-shared-vb',reason:'the same separated sample body matches multiple VAB headers; no bank was selected'});
  for(const record of records) {
    const {address:at,size,headerBytes,bodyBytes,bodyAddress}=record;
    if(!record.code) {
      const bank=readVab(ram.subarray(at,at+headerBytes),ram.subarray(bodyAddress,bodyAddress+bodyBytes));
      if(!bank.tones.some((_,index)=>{try{prepareVabTone(bank,index);return true;}catch{return false;}}))Object.assign(record,{code:'no-supported-tone',reason:'no Tone passes sample validation'});
      else {
        extracted+=size;if(banks.length>=32||extracted>8*1024*1024)fail('extracted bank limit exceeded');
        const layout=bodyAddress===record.contiguous?'contiguous':'split';
        banks.push({bank,address:at,bodyAddress,headerBytes,bodyBytes,layout,bodyMatch:layout==='split'?'unique-structural':'contiguous',bytes:size});
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

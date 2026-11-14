// SPDX-License-Identifier: BSD-3-Clause
// Disk-backed session references only. Nothing enters Files, IndexedDB,
// Cassette, a Float32 decoder, an AudioContext or an output route here.
import {CDDA_MAX_TRACK_BYTES} from '../js/cdda_source.js';

export const CDDA_SESSION_ROOT='/session-cdda';
export const CDDA_SESSION_MAX_FILES=99;
export const CDDA_SESSION_HEADER_BYTES=1024*1024;
export const CDDA_SESSION_MAX_FILE_BYTES=CDDA_MAX_TRACK_BYTES+CDDA_SESSION_HEADER_BYTES;
export const CDDA_SESSION_MAX_TOTAL_BYTES=512*1024*1024;
export const isCddaSessionPath=path=>typeof path==='string'&&(path===CDDA_SESSION_ROOT||path.startsWith(CDDA_SESSION_ROOT+'/'));
const aborted=()=>new DOMException('CD-DA session read cancelled','AbortError');
const invalid=message=>new Error('CD-DA session WAVs: '+message);
const MAX_PREFLIGHT_CHUNKS=256;

// A file slightly above the PCM ceiling may be a valid 256 MiB track plus
// RIFF headers. Inspect only its small chunk headers before allocating the
// complete selected WAV, so oversized data is rejected without that copy.
// The existing shared parser still validates the actual PCM format afterward.
async function preflightLargeWav(file,size,checkCurrent) {
  const read=async(start,length)=>{
    checkCurrent();const bytes=await file.slice(start,start+length).arrayBuffer();checkCurrent();
    if(!(bytes instanceof ArrayBuffer)||bytes.byteLength!==length)throw invalid('truncated large WAV header');
    return new Uint8Array(bytes);
  };
  const tag=(bytes,offset=0)=>String.fromCharCode(bytes[offset],bytes[offset+1],bytes[offset+2],bytes[offset+3]);
  const riff=await read(0,12),view=new DataView(riff.buffer,riff.byteOffset,riff.byteLength);
  if(tag(riff)!=='RIFF'||tag(riff,8)!=='WAVE'||view.getUint32(4,true)+8!==size)throw invalid('large session file must have a complete little-endian RIFF/WAVE header');
  let offset=12,headerBytes=12,chunks=0,sawData=false,sawFormat=false;
  while(offset<size) {
    if(++chunks>MAX_PREFLIGHT_CHUNKS)throw invalid('large WAV exceeds the bounded 256-chunk header preflight');
    if(size-offset<8)throw invalid('truncated large WAV chunk header');
    const header=await read(offset,8),chunkBytes=new DataView(header.buffer,header.byteOffset,header.byteLength).getUint32(4,true);
    const id=tag(header),start=offset+8,end=start+chunkBytes,paddedEnd=end+(chunkBytes&1);
    if(paddedEnd>size)throw invalid('large WAV chunk exceeds its File size');
    headerBytes+=8;
    if(id==='data') {
      if(sawData)throw invalid('multiple WAV data chunks are unsupported');
      if(chunkBytes>CDDA_MAX_TRACK_BYTES)throw new RangeError('CD-DA session WAV PCM exceeds the 256 MiB limit');
      sawData=true;headerBytes+=chunkBytes&1;
    } else {
      if(id==='fmt ')sawFormat=true;
      headerBytes+=chunkBytes+(chunkBytes&1);
    }
    if(headerBytes>CDDA_SESSION_HEADER_BYTES)throw invalid('large WAV non-audio headers exceed the 1 MiB session header budget');
    offset=paddedEnd;
  }
  if(!sawData||!sawFormat)throw invalid('large WAV requires fmt and data chunks');
}

function metadata(file) {
  if(typeof Blob==='undefined'||!(file instanceof Blob))throw new TypeError('CD-DA session WAVs require File or Blob references');
  const size=file.size;
  if(!Number.isSafeInteger(size)||size<1||size>CDDA_SESSION_MAX_FILE_BYTES)throw new RangeError('CD-DA session WAV must contain 1..269484032 bytes (256 MiB PCM plus up to 1 MiB of headers)');
  const original=file.name===undefined?'Session.wav':file.name;
  if(typeof original!=='string'||!/\.wav$/i.test(original))throw invalid('choose WAV files; compressed audio is unsupported');
  const name=original.split(/[\\/]/).at(-1).replace(/[\u0000-\u001f\u007f\u2028\u2029]/g,' ').trim();
  if(!name||!/\.wav$/i.test(name))throw invalid('WAV file name is missing');
  const stem=name.slice(0,-4).normalize('NFKC').replace(/[^A-Za-z0-9._-]+/g,'-').replace(/\.{2,}/g,'.').replace(/^[.\s-]+|[.\s-]+$/g,'').slice(0,96)||'track';
  return {file,name,size,stem};
}

/** Retain at most 99 local File/Blob references, with bounded metadata sizes.
 * addFiles/list never read file contents. Only the selected readFile allocates
 * WAV bytes. Native Blob.arrayBuffer() returns a fresh owned buffer: wrapping
 * it avoids an unnecessary second 257 MiB copy and does not detach the Blob.
 * A clear/dispose generation fences even file reads that cannot be cancelled.
 */
export function createCddaSessionFiles() {
  const entries=new Map(),issuedPaths=new Set(),listeners=new Set();
  let generation=0,totalBytes=0,disposed=false;
  const check=()=>{if(disposed)throw aborted();};
  const list=()=>Object.freeze([...entries.values()].map(entry=>entry.public));
  const notify=()=>{const values=list();for(const listener of listeners)listener(values);};
  return Object.freeze({
    list,
    has:path=>!disposed&&entries.has(path),
    get totalBytes(){return totalBytes;},
    get generation(){return generation;},
    subscribe(listener){check();if(typeof listener!=='function')throw new TypeError('Expected a CD-DA session listener');listeners.add(listener);return()=>listeners.delete(listener);},
    addFiles(files) {
      check();
      if(!files||typeof files[Symbol.iterator]!=='function')throw new TypeError('Choose an iterable of session WAV File references');
      const batch=[];
      for(const file of files){
        if(entries.size+batch.length>=CDDA_SESSION_MAX_FILES)throw new RangeError('CD-DA session supports at most 99 WAV files');
        batch.push(file);
      }
      if(!batch.length)return Object.freeze([]);
      if(entries.size+batch.length>CDDA_SESSION_MAX_FILES)throw new RangeError('CD-DA session supports at most 99 WAV files');
      const candidates=batch.map(metadata),reserved=new Set(issuedPaths);let nextTotal=totalBytes;
      for(const entry of candidates) {
        nextTotal+=entry.size;
        if(nextTotal>CDDA_SESSION_MAX_TOTAL_BYTES)throw new RangeError('CD-DA session WAVs exceed the 512 MiB aggregate limit');
        let suffix=1,path;
        do{path=`${CDDA_SESSION_ROOT}/${entry.stem}${suffix===1?'':'-'+suffix}.wav`;suffix++;}while(reserved.has(path.toLowerCase()));
        reserved.add(path.toLowerCase());entry.path=path;
        entry.public=Object.freeze({path,name:entry.name,size:entry.size,session:true});
      }
      // Validate the entire batch before retaining any reference or path.
      for(const entry of candidates){entries.set(entry.path,entry);issuedPaths.add(entry.path.toLowerCase());}
      totalBytes=nextTotal;notify();return Object.freeze(candidates.map(entry=>entry.path));
    },
    async readFile(path,{signal}={}) {
      check();signal?.throwIfAborted();const token=generation,entry=entries.get(path);
      if(!entry)throw invalid('session file is no longer available: '+String(path));
      const checkCurrent=()=>{signal?.throwIfAborted();if(disposed||generation!==token||entries.get(path)!==entry)throw aborted();};
      if(entry.size>CDDA_MAX_TRACK_BYTES)await preflightLargeWav(entry.file,entry.size,checkCurrent);
      checkCurrent();
      const bytes=await entry.file.arrayBuffer();
      checkCurrent();
      if(!(bytes instanceof ArrayBuffer)||bytes.byteLength!==entry.size)throw invalid('selected WAV bytes differ from their File metadata');
      return new Uint8Array(bytes);
    },
    clear(){check();generation++;entries.clear();totalBytes=0;notify();},
    dispose(){if(disposed)return;disposed=true;generation++;entries.clear();issuedPaths.clear();totalBytes=0;listeners.clear();},
  });
}

import {createSynthProject,isSynthTonePath,synthStatePath} from './synth_project.js';
import {CHECKPOINT_ROOT} from '../js/tetorica_virtual_files/filesystem.js';
import {resolvePath} from '../js/tetorica_virtual_files/path.js';

const KIND='tetorica-fm2612-synth-recovery';
const MAX_BYTES=128*1024;
const encoder=new TextEncoder();
const validWorkspace=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);

function validateIdentity(workspaceId,generation) {
  if(!validWorkspace(workspaceId))throw Error('Invalid Synth recovery workspace identity');
  if(!Number.isSafeInteger(generation)||generation<0)throw Error('Invalid Synth recovery generation');
}
function validatePath(path) {
  if(typeof path!=='string'||!path.startsWith('/')||resolvePath(path)!==path||!isSynthTonePath(path)||path==='/sys'||path.startsWith('/sys/'))throw Error('Invalid Synth recovery instrument path');
  return path;
}
function record(file) {
  if(!file)throw Error('Synth recovery requires the current instrument and its state');
  if((file.type==='binary'?file.data.byteLength:encoder.encode(file.data).byteLength)>MAX_BYTES)throw Error('Synth recovery exceeds the 128 KiB limit');
  return {path:file.path,type:file.type,data:file.type==='binary'?Array.from(file.data):file.data};
}

/** Serialize only a small complete tone and its checkpoints, never the Cassette.
 * Caller owns persistence and workspace/generation ordering.
 * @param {ReturnType<typeof createSynthProject>} project
 * @param {string} path
 * @param {string} workspaceId
 * @param {number} generation
 * @returns {string} */
export function createToneRecovery(project,path,workspaceId,generation) {
  validateIdentity(workspaceId,generation);path=validatePath(path);
  const read=target=>{
    if(!project.fs.has(target))return null;
    if(project.fs.stat(target).size>MAX_BYTES)throw Error('Synth recovery exceeds the 128 KiB limit');
    return record(project.fs.get(target));
  };
  const state=synthStatePath(path),entries=[read(path),read(state)];
  if(entries.some(entry=>!entry))throw Error('Synth recovery requires the current instrument and its state');
  for(const extra of [CHECKPOINT_ROOT+path,CHECKPOINT_ROOT+state,'/.gitignore']){
    const entry=read(extra);if(entry)entries.push(entry);
  }
  const raw=JSON.stringify({version:1,kind:KIND,workspaceId,generation,activeTonePath:path,entries});
  // Use the same validation for locally produced and recovered records.
  parseToneRecovery(raw);
  return raw;
}

/** Validate recovery data without changing the live project.
 * @param {string} raw
 * @returns {{workspaceId:string,generation:number,activeTonePath:string,entries:Array<{path:string,type:'text'|'binary',data:string|Uint8Array}>}} */
export function parseToneRecovery(raw) {
  if(typeof raw!=='string'||raw.length>MAX_BYTES||encoder.encode(raw).byteLength>MAX_BYTES)throw Error('Synth recovery exceeds the 128 KiB limit');
  let value;
  try{value=JSON.parse(raw);}catch{throw Error('Invalid Synth recovery JSON');}
  if(!value||value.version!==1||value.kind!==KIND||!Array.isArray(value.entries)||value.entries.length<2||value.entries.length>5)throw Error('Unsupported Synth recovery format');
  validateIdentity(value.workspaceId,value.generation);
  const path=validatePath(value.activeTonePath),state=synthStatePath(path);
  const allowed=new Set([path,state,CHECKPOINT_ROOT+path,CHECKPOINT_ROOT+state,'/.gitignore']),seen=new Set(),entries=[];
  for(const entry of value.entries){
    if(!entry||typeof entry!=='object'||Object.keys(entry).some(key=>!['path','type','data'].includes(key))||!allowed.has(entry.path)||seen.has(entry.path))throw Error('Invalid or duplicate Synth recovery path');
    seen.add(entry.path);
    let data;
    if(entry.type==='text'&&typeof entry.data==='string')data=entry.data;
    else if(entry.type==='binary'&&Array.isArray(entry.data)&&entry.data.length<=MAX_BYTES&&entry.data.every(byte=>Number.isInteger(byte)&&byte>=0&&byte<=255))data=Uint8Array.from(entry.data);
    else throw Error(`Invalid Synth recovery file data: ${entry.path}`);
    entries.push({path:entry.path,type:entry.type,data});
  }
  if(!seen.has(path)||!seen.has(state))throw Error('Incomplete Synth recovery instrument pair');
  const saved=CHECKPOINT_ROOT+path,savedState=CHECKPOINT_ROOT+state;
  if(seen.has(saved)!==seen.has(savedState))throw Error('Incomplete Synth recovery checkpoint pair');
  const current=entries.find(entry=>entry.path===path);
  if(current.type!=='binary')throw Error('Synth recovery instrument must contain binary TFI/VGI data');
  createSynthProject({snapshot:{version:1,files:entries,directories:[]}}).readTone(path);
  if(seen.has(saved)){
    const old=entries.filter(entry=>entry.path===saved||entry.path===savedState).map(entry=>({...entry,path:entry.path.slice(CHECKPOINT_ROOT.length)}));
    if(old.find(entry=>entry.path===path).type!=='binary')throw Error('Synth recovery checkpoint must contain binary TFI/VGI data');
    createSynthProject({snapshot:{version:1,files:old,directories:[]}}).readTone(path);
  }
  return {workspaceId:value.workspaceId,generation:value.generation,activeTonePath:path,entries};
}

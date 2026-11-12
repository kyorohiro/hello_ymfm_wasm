// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 kyorohiro.
// Local input discovery and per-entry dependency loading. No audio or CPU runs.
import {constants} from 'node:fs';
import {lstat,open,opendir,realpath} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {MAX_PSF_FILE_BYTES,PSF_FILES,readPsfFile} from '../docs/playground/playground_ps1_psf.js';

const MAX_FILES=512,MAX_INPUT_BYTES=64*1024*1024,MAX_VISITED=16384,MAX_DEPTH=64;
const MAX_WARNINGS=64,MAX_WARNING_CHARS=512;
const libraryFile=/\.(?:psflib|psf1lib)$/i;
const order=(a,b)=>a<b?-1:a>b?1:0;
const check=signal=>signal?.throwIfAborted();
function fail(code,message,cause) {
  const error=new Error(message,cause?{cause}:undefined);error.code=code;throw error;
}
const identity=stat=>({dev:stat.dev,ino:stat.ino,size:stat.size,mtimeMs:stat.mtimeMs});
const same=(stat,value)=>stat.dev===value.dev&&stat.ino===value.ino&&stat.size===value.size&&stat.mtimeMs===value.mtimeMs;

// Keep the container loader's path and relative-library rules. Filesystem
// discovery emits their canonical form; dependency tags may use backslashes.
function pathOf(value,base='') {
  if(typeof value!=='string'||!value||value.length>1024||/[\x00-\x1f:]/.test(value)||/^[\\/]/.test(value))
    fail('invalid-path','PSF: expected a relative library/file path');
  const parts=base?base.split('/'):[];
  for(const part of value.replaceAll('\\','/').split('/')) {
    if(!part||part==='.')continue;
    if(part==='..') {
      if(!parts.length)fail('invalid-path','PSF: library path escapes the selected set');
      parts.pop();
    } else parts.push(part);
  }
  if(!parts.length)fail('invalid-path','PSF: empty file path');
  return parts.join('/');
}
function canonicalPath(value) {
  const result=pathOf(value);
  if(result!==value)fail('invalid-path','PSF batch manifest paths must be canonical POSIX relative paths');
  return result;
}
function statSize(value) {
  if(!Number.isSafeInteger(value)||value<0)fail('invalid-container','PSF input has an invalid file size');
  return value;
}
const readableSize=size=>size>=16&&size<=MAX_PSF_FILE_BYTES;
function ensureInside(root,value) {
  const relative=path.relative(root,value);
  if(relative==='..'||relative.startsWith(`..${path.sep}`)||path.isAbsolute(relative))
    fail('input-changed','PSF input path no longer belongs to the selected directory');
}

/**
 * Discover only matching PSF paths. Invalid container sizes remain in the
 * manifest, so an unrelated bad song cannot prevent valid entries loading.
 * No file contents are read here. Symlinks are never traversed.
 */
export async function collectPsfBatchInputs(directory,{signal}={}) {
  check(signal);
  if(typeof directory!=='string'||!directory)throw new TypeError('PSF batch needs a directory path');
  const root=await realpath(path.resolve(directory));check(signal);
  const rootStat=await lstat(root);
  if(!rootStat.isDirectory()||rootStat.isSymbolicLink())throw new TypeError('PSF batch input must be a directory');
  const files=[],warnings=[];
  let visited=0,inputBytes=0,budgetedInputBytes=0;
  function warn(message) {
    if(warnings.length<MAX_WARNINGS)warnings.push(message.slice(0,MAX_WARNING_CHARS));
    else if(warnings.at(-1)!=='Further input warnings omitted.')warnings[MAX_WARNINGS-1]='Further input warnings omitted.';
  }
  async function walk(relative,depth) {
    check(signal);
    if(depth>MAX_DEPTH)fail('input-limit',`PSF directory depth exceeds ${MAX_DEPTH}`);
    const absolute=relative?path.join(root,...relative.split('/')):root;
    const before=await lstat(absolute);check(signal);
    if(before.isSymbolicLink()||!before.isDirectory()) {
      warn(`Skipped changed directory: ${relative||'.'}`);return;
    }
    const resolved=await realpath(absolute);check(signal);ensureInside(root,resolved);
    if(resolved!==absolute) {warn(`Skipped redirected directory: ${relative||'.'}`);return;}
    const names=[];
    let handle;
    try {
      handle=await opendir(absolute);
      for await(const entry of handle) {
        check(signal);
        if(++visited>MAX_VISITED)fail('input-limit',`PSF directory scan exceeds ${MAX_VISITED} entries`);
        names.push(entry.name);
      }
    } finally {if(handle)await handle.close().catch(error=>{if(error.code!=='ERR_DIR_CLOSED')throw error;});}
    check(signal);
    const after=await lstat(absolute);
    if(after.isSymbolicLink()||!after.isDirectory()||!same(after,identity(before)))
      fail('input-changed',`PSF directory changed while scanning: ${relative||'.'}`);
    for(const name of names.sort(order)) {
      check(signal);
      const child=relative?`${relative}/${name}`:name;
      try {canonicalPath(child);} catch {warn(`Skipped unsupported relative path: ${child}`);continue;}
      let stat;
      try {stat=await lstat(path.join(absolute,name));}
      catch(error) {warn(`Skipped unreadable path: ${child} (${error.code??'stat failed'})`);continue;}
      check(signal);
      if(stat.isSymbolicLink()) {warn(`Skipped symlink: ${child}`);continue;}
      if(stat.isDirectory())await walk(child,depth+1);
      else if(stat.isFile()&&PSF_FILES.test(child)) {
        if(files.length>=MAX_FILES)fail('input-limit',`PSF input exceeds ${MAX_FILES} matching files`);
        const bytes=statSize(stat.size);inputBytes+=bytes;
        if(!Number.isSafeInteger(inputBytes))fail('input-limit','PSF input byte total is not representable');
        if(readableSize(bytes))budgetedInputBytes+=bytes;
        if(budgetedInputBytes>MAX_INPUT_BYTES)fail('input-limit','Readable PSF inputs exceed 64 MiB');
        files.push({path:child,bytes,identity:identity(stat)});
      } else if(!stat.isFile())warn(`Skipped non-regular path: ${child}`);
    }
  }
  await walk('',0);check(signal);
  files.sort((a,b)=>order(a.path,b.path));
  return {root,files,entries:files.filter(file=>!libraryFile.test(file.path)).map(file=>file.path),
    warnings,visited,inputBytes,budgetedInputBytes};
}

// Inspect ancestors before/after opening, then require the file descriptor's
// identity to match the collected manifest before reading any bytes. A raced
// parent rename cannot make a different target pass that descriptor check.
async function checkParents(root,relative,signal) {
  let absolute=root;
  const parts=relative.split('/');
  for(let index=0;index<parts.length-1;index++) {
    check(signal);absolute=path.join(absolute,parts[index]);
    const stat=await lstat(absolute);
    if(stat.isSymbolicLink()||!stat.isDirectory())fail('input-changed',`PSF input parent changed: ${relative}`);
  }
  const resolved=await realpath(absolute);check(signal);ensureInside(root,resolved);
  if(resolved!==absolute)fail('input-changed',`PSF input parent was redirected: ${relative}`);
}
async function readStableFile(root,file,signal) {
  check(signal);
  const size=statSize(file.bytes);
  if(!readableSize(size))fail('invalid-container',`PSF: each file must be 16 bytes–4 MiB: ${file.path}`);
  const expected=file.identity;
  if(!expected||expected.size!==size)fail('input-changed',`PSF manifest identity is invalid: ${file.path}`);
  let handle;
  try {
    await checkParents(root,file.path,signal);
    const absolute=path.join(root,...file.path.split('/'));
    const before=await lstat(absolute);check(signal);
    if(before.isSymbolicLink()||!before.isFile()||!same(before,expected))
      fail('input-changed',`PSF input changed since discovery: ${file.path}`);
    handle=await open(absolute,constants.O_RDONLY|(constants.O_NOFOLLOW??0));check(signal);
    const opened=await handle.stat();
    if(!opened.isFile()||!same(opened,expected))fail('input-changed',`PSF input changed while opening: ${file.path}`);
    const bytes=new Uint8Array(size);
    for(let offset=0;offset<size;) {
      check(signal);
      const count=Math.min(65536,size-offset),result=await handle.read(bytes,offset,count,offset);
      if(!result.bytesRead)fail('input-changed',`PSF input was truncated while reading: ${file.path}`);
      offset+=result.bytesRead;
    }
    check(signal);
    const after=await handle.stat(),atPath=await lstat(absolute);
    if(!same(after,expected)||atPath.isSymbolicLink()||!atPath.isFile()||!same(atPath,expected))
      fail('input-changed',`PSF input changed while reading: ${file.path}`);
    await checkParents(root,file.path,signal);check(signal);
    return bytes;
  } catch(error) {
    check(signal);
    if(['ENOENT','ENOTDIR','ELOOP'].includes(error.code))
      fail('input-changed',`PSF input disappeared or became a symlink: ${file.path}`,error);
    throw error;
  } finally {if(handle)await handle.close();}
}

/**
 * Load only one entry's recursive closure. The case-fold index covers the full
 * manifest, including unused files, exactly as in readPsfFileSet(). The shared
 * composePsfRam() subsequently performs decompression and RAM overlays.
 */
export async function loadPsfBatchEntry(root,files,entry,{signal}={}) {
  check(signal);
  if(typeof root!=='string'||!path.isAbsolute(root)||await realpath(root)!==root)
    throw new TypeError('PSF batch root must be its absolute real path');
  if(!Array.isArray(files)||!files.length||files.length>MAX_FILES)
    fail('input-limit','PSF: select 1–512 PSF/library files');
  const manifest=new Map(),folded=new Map();let budgeted=0;
  for(const file of files) {
    const relative=canonicalPath(file.path),bytes=statSize(file.bytes);
    if(manifest.has(relative))fail('invalid-path',`PSF: duplicate path: ${relative}. Use folder selection to retain subdirectories.`);
    manifest.set(relative,file);
    const key=relative.toLowerCase();folded.set(key,folded.has(key)?null:relative);
    if(readableSize(bytes))budgeted+=bytes;
  }
  if(budgeted>MAX_INPUT_BYTES)fail('input-limit','Readable PSF inputs exceed 64 MiB');
  entry=canonicalPath(entry);
  if(!manifest.has(entry)||libraryFile.test(entry))fail('invalid-path','PSF: choose a playable PSF entry');
  const records=new Map(),sources=new Map();let visits=0,totalBytes=0;
  async function record(relative) {
    if(records.has(relative))return records.get(relative);
    const file=manifest.get(relative),bytes=await readStableFile(root,file,signal);check(signal);
    let parsed;
    try {parsed=readPsfFile(bytes);}
    catch(error) {
      if(!error.code)error.code=/unsupported version/.test(error.message)?'unsupported-psf-version':'invalid-container';
      throw error;
    }
    const result={path:relative,...parsed};records.set(relative,result);totalBytes+=bytes.byteLength;
    sources.set(relative,{path:relative,bytes:bytes.byteLength,sha256:createHash('sha256').update(bytes).digest('hex')});
    return result;
  }
  function library(from,name) {
    const requested=pathOf(name,from.path.split('/').slice(0,-1).join('/'));
    if(manifest.has(requested))return requested;
    const match=folded.get(requested.toLowerCase());
    if(match)return match;
    if(folded.has(requested.toLowerCase()))fail('ambiguous-library',`PSF: ambiguous library path: ${requested}`);
    fail('missing-library',`PSF: missing PSFLib ${requested} (from ${from.path}). Select the related files together or open their folder.`);
  }
  async function load(relative,stack=[]) {
    check(signal);
    if(stack.includes(relative))fail('invalid-container',`PSF: cyclic library reference: ${[...stack,relative].join(' → ')}`);
    if(stack.length>=10||++visits>256)fail('input-limit','PSF: library depth/visit limit exceeded');
    const value=await record(relative),next=[...stack,relative];
    if(value.tags.has('_lib'))await load(library(value,value.tags.get('_lib')),next);
    for(let index=2;value.tags.has(`_lib${index}`);index++)await load(library(value,value.tags.get(`_lib${index}`)),next);
  }
  await load(entry);check(signal);
  const songs=[...records.values()].filter(value=>!libraryFile.test(value.path)).sort((a,b)=>order(a.path,b.path));
  const set={records,folded,entries:songs.map(value=>({path:value.path,title:value.tags.get('title')??''})),totalBytes};
  return {set,entry,title:records.get(entry).tags.get('title')??'',sources:[...sources.values()].sort((a,b)=>order(a.path,b.path))};
}

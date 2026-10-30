// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 kyorohiro.
// Local static compatibility report; never emits sample bytes or executes PSF code.
import {createHash} from 'node:crypto';
import {lstat, opendir, readFile, writeFile} from 'node:fs/promises';
import {basename, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {PSF_FILES, MAX_PSF_FILE_BYTES, readPsfFileSet, extractPsfVabs} from '../docs/playground/playground_ps1_psf.js';
import {prepareVabTone} from '../docs/playground/playground_ps1_vab.js';

const usage='Usage: node scripts/inspect_psf_banks.mjs DIRECTORY [--entry relative/song.minipsf] [--out REPORT.json]';

async function collectFiles(directory) {
  if (!(await lstat(directory)).isDirectory()) throw new Error('Expected a directory containing an extracted PSF set');
  const files=[]; let visited=0,total=0;
  async function visit(dir,prefix='',depth=0) {
    if(depth>64)throw new Error('PSF folder nesting exceeds 64 directories');
    const entries=await opendir(dir);
    for await (const item of entries) {
      if(++visited>16384)throw new Error('PSF folder exceeds 16,384 directory entries; choose a single game set');
      const path=prefix?`${prefix}/${item.name}`:item.name,absolute=join(dir,item.name);
      if(item.isDirectory())await visit(absolute,path,depth+1);
      else if(item.isFile() && PSF_FILES.test(item.name)) {
        const stat=await lstat(absolute);
        if(!stat.isFile())throw new Error(`Input file changed: ${path}`);
        if(stat.size<16 || stat.size>MAX_PSF_FILE_BYTES)throw new Error(`PSF file must be 16 bytes–4 MiB: ${path}`);
        total+=stat.size;
        if(files.length>=512 || total>64*1024*1024)throw new Error('PSF set exceeds 512 files or 64 MiB; choose a single game set');
        const file={name:basename(path),webkitRelativePath:path,size:stat.size,sha256:null,arrayBuffer:async()=>{
          const bytes=await readFile(absolute);
          if(bytes.length!==file.size)throw new Error(`Input file size changed: ${path}`);
          file.sha256=createHash('sha256').update(bytes).digest('hex');
          return bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);
        }};
        files.push(file);
      }
      // Symlinks are deliberately not followed; dependencies stay in this set.
    }
  }
  await visit(directory);
  return files.sort((a,b)=>a.webkitRelativePath<b.webkitRelativePath?-1:a.webkitRelativePath>b.webkitRelativePath?1:0);
}

function summarizeBank({bank,address,bytes}) {
  const reasons=new Map();let playable=0,firstPlayableTone=null;
  for(const [listIndex,tone] of bank.tones.entries()) {
    try {
      prepareVabTone(bank,listIndex);playable++;
      firstPlayableTone??={listIndex,program:tone.program,tone:tone.index,sample:tone.sample};
    } catch(error) {reasons.set(error.message,(reasons.get(error.message)??0)+1);}
  }
  return {address:`0x${(0x80000000+address).toString(16)}`,bytes,version:bank.version,id:bank.id,
    programs:bank.programs.length,tones:bank.tones.length,samples:bank.samples.length,
    playableTones:playable,unavailableTones:bank.tones.length-playable,firstPlayableTone,
    unavailableReasons:[...reasons].map(([reason,tones])=>({reason,tones}))};
}

/** Uses the same static extraction and Tone validation as both browser UIs.
 * A no-bank result is valid data, not a file/dependency error or a claim that
 * the game has no instruments. This does not render or assess sound fidelity. */
export async function inspectPsfFolder(directory,{entry}={}) {
  const files=await collectFiles(resolve(directory)),set=await readPsfFileSet(files);
  const selected=entry===undefined?set.entries:set.entries.filter(item=>item.path===entry.replaceAll('\\','/'));
  if(!selected.length)throw new Error(`Unknown PSF entry: ${entry}`);
  const results=[];
  for(const song of selected) {
    try {
      const result=await extractPsfVabs(set,song.path);
      results.push({entry:song.path,title:song.title,status:result.banks.length?'banks':'no-bank',
        loadedFiles:result.loadedFiles,expandedBytes:result.expandedBytes,candidates:result.candidates,
        rejectedCandidates:result.rejected,diagnostics:result.diagnostics,banks:result.banks.map(summarizeBank)});
    } catch(error) {results.push({entry:song.path,title:song.title,status:'error',error:error.message});}
  }
  return {schemaVersion:1,scope:'PSF1/MiniPSF static contiguous VAB compatibility; no playback or fidelity assessment',
    files:files.map(file=>({path:file.webkitRelativePath,bytes:file.size,sha256:file.sha256})),inputBytes:set.totalBytes,
    entriesInSet:set.entries.length,entriesScanned:results.length,
    summary:{withBanks:results.filter(r=>r.status==='banks').length,withoutBanks:results.filter(r=>r.status==='no-bank').length,errors:results.filter(r=>r.status==='error').length},results};
}

export async function runPsfInspection(args,{stdout=console.log,stderr=console.error}={}) {
  if(args.length===1 && args[0]==='--help'){stdout(usage);return 0;}
  try {
    const [directory,...rest]=args;
    if(!directory || directory.startsWith('--'))throw new Error(usage);
    const options={};let out;
    for(let i=0;i<rest.length;i++) {
      const flag=rest[i],value=rest[++i];
      if(!['--entry','--out'].includes(flag)||!value||value.startsWith('--'))throw new Error(usage);
      if(flag==='--entry'){if(options.entry!==undefined)throw new Error(usage);options.entry=value;}
      else {if(out!==undefined)throw new Error(usage);out=value;}
    }
    const report=await inspectPsfFolder(directory,options),json=JSON.stringify(report,null,2)+'\n';
    // Do not overwrite a PSF/library input through a mistaken --out argument.
    if(out && PSF_FILES.test(out))throw new Error('--out must not name a PSF or PSFLib file');
    if(out)await writeFile(out,json);
    stdout(json.trimEnd());return report.summary.errors?1:0;
  } catch(error) {stderr(error.message);return 1;}
}

if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url))process.exitCode=await runPsfInspection(process.argv.slice(2));

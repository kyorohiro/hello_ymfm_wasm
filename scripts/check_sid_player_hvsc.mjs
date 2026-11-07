// SPDX-License-Identifier: BSD-3-Clause
// Optional local metadata audit. Never copies music or executes C64 programs.
import {open,readdir,readFile,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {dirname,relative,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {validateBrowserPsid,PSID_MAX_FILE_BYTES,SidPsidError} from '../tetorica_src/runtime/sid_psid.js';

const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const increment=(counts,key)=>{counts[key]=(counts[key]??0)+1;};
const sortedCounts=counts=>Object.fromEntries(Object.entries(counts).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])));
async function* sidFiles(directory){
  const entries=(await readdir(directory,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name));
  for(const entry of entries){
    const path=resolve(directory,entry.name);
    if(entry.isDirectory())yield* sidFiles(path);
    else if(entry.isFile()&&/\.sid$/i.test(entry.name))yield path;
  }
}
async function boundedInput(path){
  const file=await open(path,'r');
  try{
    const stat=await file.stat();
    if(!stat.isFile())throw new Error('Not a regular file');
    if(stat.size>PSID_MAX_FILE_BYTES)throw new SidPsidError(`file exceeds the ${PSID_MAX_FILE_BYTES}-byte limit`,'PSID_LIMIT');
    const buffer=Buffer.alloc(PSID_MAX_FILE_BYTES+1);
    let length=0;
    while(length<buffer.length){const {bytesRead}=await file.read(buffer,length,buffer.length-length,null);if(!bytesRead)break;length+=bytesRead;}
    if(length>PSID_MAX_FILE_BYTES)throw new SidPsidError(`file exceeds the ${PSID_MAX_FILE_BYTES}-byte limit`,'PSID_LIMIT');
    return buffer.subarray(0,length);
  }finally{await file.close();}
}
// This raw-byte heuristic is not a disassembler. Operand-like patterns in data
// can be false positives; absent patterns cannot prove ROM independence.
function rawRomCallPatterns(psid){
  let count=0;
  for(let i=0;i+2<psid.program.length;i++){
    if(psid.program[i]!==0x20&&psid.program[i]!==0x4c)continue;
    const address=psid.program[i+1]|(psid.program[i+2]<<8);
    if((address>=0xa000&&address<0xc000||address>=0xe000)&&!(address>=psid.loadAddress&&address<psid.endAddress))count++;
  }
  return count;
}
function representativeCandidates(supported,count){
  const preferred=/commando|monty_on_the_run|last_ninja|delta\.sid|green_beret|rambo|boulder_dash|arkanoid|turrican|cybernoid|wizball|sanxion/i;
  const pool=supported.filter(item=>/^(?:GAMES|MUSICIANS)\//.test(item.path));
  pool.sort((a,b)=>(a.rawRomCallPatterns!==0)-(b.rawRomCallPatterns!==0)||Number(!preferred.test(a.path))-Number(!preferred.test(b.path))||Number(b.songs>1)-Number(a.songs>1)||a.bytes-b.bytes||a.path.localeCompare(b.path));
  const selected=[],authors=new Set();
  for(const section of ['GAMES','MUSICIANS']){
    const target=Math.min(section==='GAMES'?3:7,count-selected.length);
    for(const item of pool){
      if(selected.filter(entry=>entry.path.startsWith(`${section}/`)).length>=target)break;
      if(!item.path.startsWith(`${section}/`)||authors.has(item.metadata.author))continue;
      selected.push(item);authors.add(item.metadata.author);
    }
  }
  for(const item of pool){if(selected.length>=count)break;if(!selected.includes(item))selected.push(item);}
  return selected;
}

/** Scan a user-provided corpus; report metadata only, never musical payloads.
 * Passing the header validator is not a playback, CPU or ROM-safety guarantee.
 */
export async function scanSidPlayerCorpus({root,out,candidateCount=10}={}){
  if(typeof root!=='string'||!root)throw new TypeError('An explicit local --root directory is required');
  if(!Number.isInteger(candidateCount)||candidateCount<1||candidateCount>50)throw new RangeError('candidateCount must be 1..50');
  const directory=resolve(root),supported=[],rejections={},categories={},versions={};
  let total=0;
  for await(const path of sidFiles(directory)){
    total++;
    const name=relative(directory,path).replaceAll('\\','/'),section=name.split('/')[0];
    const category=categories[section]??={total:0,supported:0,rejected:0};category.total++;
    try{
      const bytes=await boundedInput(path);
      if(bytes.length>=6)increment(versions,`${String.fromCharCode(...bytes.subarray(0,4))} v${bytes.readUInt16BE(4)}`);
      const psid=validateBrowserPsid(bytes);
      category.supported++;
      supported.push({path:name,bytes:bytes.length,sha256:sha256(bytes),metadata:psid.metadata,songs:psid.songs,startSong:psid.startSong,
        loadAddress:psid.loadAddress,initAddress:psid.initAddress,playAddress:psid.playAddress,programLength:psid.programLength,
        headerInitAddress:psid.headerInitAddress,rawRomCallPatterns:rawRomCallPatterns(psid)});
    }catch(error){
      category.rejected++;
      increment(rejections,`${error.code??error.name}: ${error.message}`);
    }
  }
  let corpusVersion;
  try{const document=await readFile(resolve(directory,'DOCUMENTS/HVSC.txt'),'utf8');corpusVersion=document.match(/^\s*(Release\s+\d+)\s*$/m)?.[1];}catch{}
  const report={format:'tetorica-sid-player-metadata-audit',version:1,corpus:{root:relative(process.cwd(),directory).replaceAll('\\','/'),versionHint:corpusVersion},
    parserSha256:sha256(await readFile(new URL('../tetorica_src/runtime/sid_psid.js',import.meta.url))),
    scope:'Metadata/header validation only. No C64 program execution, musical data copy or audio test. Rejection reasons count the first failing rule only.',
    subset:'PSID v2, explicit PAL 6581, one SID, all VBI speed bits zero, relocation 0/0, RAM $0800..$CFFF, effective init and explicit play inside payload.',
    total,supported:supported.length,rejected:total-supported.length,supportedMultipleSongs:supported.filter(item=>item.songs>1).length,
    supportedTotalSongs:supported.reduce((sum,item)=>sum+item.songs,0),categories,headerVersions:sortedCounts(versions),rejections:sortedCounts(rejections),
    candidateHeuristic:'Candidates favor distinct authors, multiple songs, known game names and zero raw JSR/JMP-to-ROM byte patterns outside loaded RAM. This is not disassembly or proof of ROM independence.',
    candidates:representativeCandidates(supported,candidateCount)};
  if(out){await mkdir(dirname(resolve(out)),{recursive:true});await writeFile(out,`${JSON.stringify(report,null,2)}\n`);}
  return report;
}

if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  const options={};
  for(let i=2;i<process.argv.length;i++){
    const key=process.argv[i];
    if(!['--root','--out','--candidates'].includes(key)||!process.argv[i+1])throw new Error('Usage: node scripts/check_sid_player_hvsc.mjs --root LOCAL_C64MUSIC [--out REPORT.json] [--candidates 10]');
    options[key==='--candidates'?'candidateCount':key.slice(2)]=key==='--candidates'?Number(process.argv[++i]):process.argv[++i];
  }
  const report=await scanSidPlayerCorpus(options);
  console.log(JSON.stringify({total:report.total,supported:report.supported,rejected:report.rejected,supportedMultipleSongs:report.supportedMultipleSongs,out:options.out??null,candidates:report.candidates.map(item=>item.path)},null,2));
}

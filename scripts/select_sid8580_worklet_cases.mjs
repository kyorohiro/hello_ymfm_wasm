#!/usr/bin/env node
// SPDX-License-Identifier: BSD-3-Clause
// Metadata-only selection. Never execute, modify or copy the user's SID music.
import assert from 'node:assert/strict';
import {open,readFile,readdir,mkdir,writeFile} from 'node:fs/promises';
import {resolve,relative,dirname,sep} from 'node:path';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {validateResearchSid} from '../docs/sid8580-lab/parser.js';

const options={root:resolve('ww/C64Music'),out:resolve('docs/issues/sid8580_worklet_cases_plan_01.json'),check:false};
for(let i=2;i<process.argv.length;i++){
  const name=process.argv[i];
  if(name==='--check'){options.check=true;continue;}
  assert(['--root','--out'].includes(name)&&process.argv[i+1], 'Usage: --root DIR --out JSON [--check]');
  options[name.slice(2)]=resolve(process.argv[++i]);
}
const record=bytes=>({bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
const sorted=(a,b)=>a<b?-1:a>b?1:0;
async function walk(directory){
  const files=[];
  for(const entry of await readdir(directory,{withFileTypes:true})){
    const path=resolve(directory,entry.name);
    if(entry.isDirectory())files.push(...await walk(path));
    else if(entry.isFile()&&entry.name.toLowerCase().endsWith('.sid'))files.push(path);
  }
  return files;
}
const paths=(await walk(options.root)).sort((a,b)=>sorted(relative(options.root,a),relative(options.root,b)));
const metadata=new Array(paths.length);let cursor=0;
// Header reads only; bounded concurrency keeps this separate from a corpus run.
await Promise.all(Array.from({length:8},async()=>{
  while(cursor<paths.length){
    const i=cursor++,path=paths[i];assert(path.startsWith(options.root+sep));
    const file=await open(path,'r');
    try{
      const header=new Uint8Array(128),{bytesRead}=await file.read(header,0,header.length,0);
      const row={path:relative(options.root,path).split(sep).join('/'),headerBytesRead:bytesRead};metadata[i]=row;
      if(bytesRead<124){row.category='short-header';continue;}
      const view=new DataView(header.buffer),format=String.fromCharCode(...header.subarray(0,4)),version=view.getUint16(4),flags=view.getUint16(118);
      row.format=format;row.version=version;row.flags=flags;row.songs=view.getUint16(14);row.startSong=view.getUint16(16);row.speed=view.getUint32(18);
      row.basic=format==='RSID'&&Boolean(flags&2);
      row.category=!['PSID','RSID'].includes(format)?'other-signature'
        :version!==2?'not-version-2':((flags>>2)&3)!==1?'not-declared-PAL'
        :((flags>>4)&3)!==2?'not-declared-8580'
        :(flags&0x3c0)||header[122]||header[123]?'multiple-SID-flags'
        :row.basic?'BASIC-requires-user-ROMs':'header-target-candidate';
    }finally{await file.close();}
  }
}));
const categories={},structuralRejections={},eligible=[];
for(const row of metadata){
  categories[row.category]=(categories[row.category]??0)+1;
  if(row.category!=='header-target-candidate')continue;
  const bytes=await readFile(resolve(options.root,row.path));
  try{
    const parsed=validateResearchSid(bytes,{environment:'minimal'});
    assert.equal(parsed.clock,'pal');assert.equal(parsed.model,'8580');assert.equal(parsed.sidCount,1);
    eligible.push({row,parsed,input:record(bytes)});
  }catch(error){const reason=error.message;structuralRejections[reason]=(structuralRejections[reason]??0)+1;}
}
// Decide solely from metadata/structural validation; do not replace runtime failures.
eligible.sort((a,b)=>Number(b.parsed.songs>1)-Number(a.parsed.songs>1)||sorted(a.row.path,b.row.path));
const groups=[['psid-vbi','PSID','vbi'],['psid-cia','PSID','cia'],['rsid','RSID','c64-irq']];
const selected=[],cases=[],unavailable=[];
for(const [group,format,timing]of groups){
  const candidate=eligible.find(c=>c.parsed.format===format&&!selected.some(f=>f.path===c.row.path)
    &&(format==='RSID'||c.parsed.songSpeeds.includes(timing)));
  if(!candidate){unavailable.push({group,reason:'No distinct structurally accepted declared PAL/MOS8580 single-SID v2 file in the minimal environment matches the metadata rule.'});continue;}
  const {row,parsed,input}=candidate;
  const primary=format==='RSID'||parsed.songSpeeds[parsed.startSong-1]===timing?parsed.startSong:parsed.songSpeeds.indexOf(timing)+1;
  const subtunes=[primary];
  if(parsed.songs>1)subtunes.push(primary!==parsed.startSong?parsed.startSong:primary===1?2:1);
  const fileId=group,fileCases=subtunes.map((subtune,i)=>({id:`${fileId}-song-${subtune}`,fileId,path:row.path,subtune,
    timing:format==='RSID'?'c64-irq':parsed.songSpeeds[subtune-1],selectionRole:i?'alternate':subtune===parsed.startSong?'default':'first-matching-timing'}));
  selected.push({id:fileId,group,path:row.path,input,metadata:parsed.metadata,
    header:{format:parsed.format,version:parsed.version,flags:parsed.flags,clock:parsed.clock,model:parsed.model,
      sidCount:parsed.sidCount,songs:parsed.songs,startSong:parsed.startSong,speed:parsed.speed,
      loadAddress:parsed.loadAddress,initAddress:parsed.initAddress,playAddress:parsed.playAddress,
      basic:Boolean(parsed.basic),relocation:parsed.relocation??null},
    structuralValidation:{accepted:true,environment:'minimal',executionPerformed:false,romIndependenceProven:false},cases:fileCases});
  cases.push(...fileCases);
}
const inputs={};
for(const name of ['scripts/select_sid8580_worklet_cases.mjs','docs/sid8580-lab/parser.js','docs/sid8580-lab/psid_structure.js','docs/js/sid_rsid.js'])inputs[name]=record(await readFile(resolve(name)));
const plan={format:'tetorica-sid8580-worklet-cases-plan',version:1,frozenOn:'2026-11-08',
  corpus:{root:relative(resolve('.'),options.root).split(sep).join('/')},
  scope:'Metadata-only selection before any real-file Worklet execution. Original declared PAL/MOS8580 single-SID v2 bytes only. No music, firmware or PCM copied.',
  selection:{metadataOnly:true,runtimeExecution:false,
    rule:'For each group in order PSID VBI, PSID CIA, RSID, select the first distinct structurally accepted file after multi-subtune-first then codepoint-lexical relative-path ordering. Minimal environment excludes BASIC. A timing-specific primary is the header default if matching, otherwise the first matching song. An alternate is the header default if different, otherwise song 1 or 2. No execution-based replacement.',
    headerReadLimit:128,groups:groups.map(([id,format,timing])=>({id,format,timing})),maximumFiles:3,maximumCases:6},
  target:{clock:'pal',model:'8580',environment:'minimal'},profiles:{resonance:false,cutoff:false},secondsPerCase:30,
  inputs,scan:{files:metadata.length,categories,structurallyAccepted:eligible.length,structuralRejections},
  files:selected,cases,unavailable,
  summary:{files:selected.length,cases:cases.length,groupsSelected:selected.map(f=>f.group),
    filesWithMultipleSubtunes:selected.filter(f=>f.header.songs>1).length,
    timingClasses:[...new Set(cases.map(c=>c.timing))].sort()},
  interpretation:'Selection and parser acceptance are not playback success, ROM independence, listening approval, full-song compatibility or hardware fidelity. Original declarations are retained; failed runtime cases remain in the result.'};
assert(plan.files.length<=3&&plan.cases.length<=6);
if(options.check){assert(isDeepStrictEqual(JSON.parse(await readFile(options.out,'utf8')),plan),'Plan differs from current metadata, selected file bytes or source inputs');}
else{await mkdir(dirname(options.out),{recursive:true});await writeFile(options.out,JSON.stringify(plan,null,2)+'\n');}
console.log(JSON.stringify({checked:options.check,out:options.out,...plan.summary,unavailable},null,2));

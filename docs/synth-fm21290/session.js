// SPDX-License-Identifier: BSD-3-Clause
import {createPlaygroundCassetteZip,loadPlaygroundCassette} from '../playground/playground_cassette.js';
import {createVoiceSysex,parseSysex} from '../js/msfa_dx7/src/sysex.js';
import {parseMidiFile} from '../js/midi_file.js';
import {createVirtualFileSystem} from '../js/tetorica_virtual_files/filesystem.js';
import {normalizeVirtualPath} from '../js/tetorica_virtual_files/path.js';

export const textPath=path=>/\.(?:m?js|json|txt)$/i.test(path);
const reserved=['/fm21290.json','/metadata.json','/cassette.metadata.js','/bank.syx','/song.mid'];
export function projectPath(path){
  if(path==='/' || normalizeVirtualPath(path)!==path || path.split('/').includes('__proto__') ||
      reserved.some(p=>path===p || path.startsWith(p+'/')) || path.startsWith('/index.js/'))
    throw Error('Invalid or reserved project path: '+path);
  return path;
}

export const defaultWheel=Object.freeze({value:0,range:99,assign:1});
function readWheel(wheel){
  if(wheel===undefined)return {...defaultWheel};
  for(const [key,max] of [['range',99],['assign',7],['value',127]]){
    if(!Number.isInteger(wheel?.[key])||wheel[key]<0||wheel[key]>max)throw Error('Invalid Mod wheel in Cassette');
  }
  return {value:wheel.value,range:wheel.range,assign:wheel.assign};
}
function availablePath(fs,base,suffix=''){
  let path=base+suffix,index=1;
  while(fs.has(path)||fs.listDirectories().includes(path))path=base+' ('+(++index)+')'+suffix;
  return path;
}
export function storePresetDump(fs,dump,filename){
  const stem=name=>name.replace(/[^\p{L}\p{N} _.-]/gu,'_').replace(/^[. ]+|[. ]+$/g,'').replace(/^__proto__$/,'Voice')||'Voice';
  const base='/presets/'+stem(filename.replace(/\.syx$/i,''));
  const folder=dump.format==='bank'?availablePath(fs,base):null;
  return dump.voices.map(({name,data},i)=>{
    const path=folder?folder+'/'+String(i+1).padStart(2,'0')+' '+stem(name)+'.syx':availablePath(fs,base,'.syx');
    fs.writeBinary(path,createVoiceSysex(data,{channel:dump.channel}));
    return path;
  });
}
export function exportSession({voice, code, song, wheel, entries=[], directories=[], activePath='/index.js'}) {
  const files=[
    {path:'/index.js',type:'text',data:code},
    {path:'/fm21290.json',type:'text',data:JSON.stringify({version:2,voice:Array.from(voice),activePath,wheel:readWheel(wheel)})}
  ];
  if(song) files.push({path:'/song.mid',type:'binary',data:song});
  for(const entry of entries){projectPath(entry.path);files.push(entry);}
  return createPlaygroundCassetteZip(files,{directories});
}
export async function importSession(bytes) {
  const {files,directories}=await loadPlaygroundCassette(bytes);
  const decoder=new TextDecoder('utf-8',{fatal:true});
  const meta=JSON.parse(decoder.decode(files.get('fm21290.json')));
  const entries=[];
  for(const [name,bytes] of files){
    const path='/'+name;
    if(reserved.includes(path))continue;
    entries.push({path,data:textPath(path)?decoder.decode(bytes):bytes});
  }
  return readProject(meta,files.get('bank.syx'),files.get('song.mid'),entries,directories);
}

// Both the portable Cassette and the structured IndexedDB draft are validated
// before the live project is replaced.
export function readProject(meta,bank,song,entries,directories){
  const legacy=meta?.version===1;
  if(!(meta?.version===2 || legacy && Number.isInteger(meta.selected) && meta.selected>=0 && meta.selected<=31))
    throw Error('Invalid FM21290 project');
  const bytes=meta.voice;
  if(Array.isArray(bytes)&&!bytes.every(b=>Number.isInteger(b)&&b>=0&&b<=255))throw Error('Invalid project voice bytes');
  const dump=parseSysex(legacy?bank:Array.isArray(bytes)?Uint8Array.from(bytes):bytes);
  if(dump.format!==(legacy?'bank':'voice'))throw Error('Invalid project voice data');
  for(const entry of entries){
    projectPath(entry.path);
    if(textPath(entry.path)!==(typeof entry.data==='string'))throw Error('Invalid project file: '+entry.path);
  }
  for(const path of directories)if(path!=='/')projectPath(path);
  const fs=createVirtualFileSystem();
  fs.replace(entries,directories);
  if(!fs.has('/index.js'))throw Error('Project needs index.js');
  const activePath=meta.activePath??'/index.js';
  projectPath(activePath);
  if(!textPath(activePath)||!fs.has(activePath))throw Error('Invalid editor path in Cassette');
  if(legacy)storePresetDump(fs,dump,'Recovered');
  return {fs,activePath,voice:dump.voices[legacy?meta.selected:0].data,channel:dump.channel,wheel:readWheel(meta.wheel),code:fs.get('/index.js').data,song,midi:song?parseMidiFile(song):null};
}

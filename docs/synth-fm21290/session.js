// SPDX-License-Identifier: BSD-3-Clause
import {createPlaygroundCassetteZip,loadPlaygroundCassette} from '../playground/playground_cassette.js';
import {parseSysex} from '../js/msfa_dx7/src/sysex.js';
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
export function exportSession({bank, selected, code, song, wheel, entries=[], directories=[], activePath='/index.js'}) {
  const files=[
    {path:'/bank.syx',type:'binary',data:bank},
    {path:'/index.js',type:'text',data:code},
    {path:'/fm21290.json',type:'text',data:JSON.stringify({version:1,selected,activePath,wheel:readWheel(wheel)})}
  ];
  if(song) files.push({path:'/song.mid',type:'binary',data:song});
  for(const entry of entries){projectPath(entry.path);files.push(entry);}
  return createPlaygroundCassetteZip(files,{directories});
}
export async function importSession(bytes) {
  const {files,directories}=await loadPlaygroundCassette(bytes);
  const decoder=new TextDecoder('utf-8',{fatal:true});
  const meta=JSON.parse(decoder.decode(files.get('fm21290.json')));
  if(meta?.version!==1 || !Number.isInteger(meta.selected) || meta.selected<0 || meta.selected>31)
    throw Error('Invalid FM21290 Cassette');
  const dump=parseSysex(files.get('bank.syx'));
  if(dump.format!=='bank'||!files.has('index.js'))throw Error('Cassette needs bank.syx and index.js');
  const song=files.get('song.mid');
  const entries=[];
  for(const [name,bytes] of files){
    const path='/'+name;
    if(reserved.includes(path))continue;
    projectPath(path);
    entries.push({path,data:textPath(path)?decoder.decode(bytes):bytes});
  }
  for(const path of directories)projectPath(path);
  const fs=createVirtualFileSystem();
  fs.replace(entries,directories);
  const activePath=meta.activePath??'/index.js';
  projectPath(activePath);
  if(!textPath(activePath)||!fs.has(activePath))throw Error('Invalid editor path in Cassette');
  return {fs,activePath,dump,wheel:readWheel(meta.wheel),selected:meta.selected,code:fs.get('/index.js').data,song,midi:song?parseMidiFile(song):null};
}

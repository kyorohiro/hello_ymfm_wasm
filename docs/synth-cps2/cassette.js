// SPDX-License-Identifier: BSD-3-Clause
import {createPlaygroundCassetteZip,loadPlaygroundCassette} from '../playground/playground_cassette.js';
import {createVirtualFileSystem} from '../js/tetorica_virtual_files/filesystem.js';
import {checkPath} from '../synth-cps1/project-tree.js';

export function scriptPath(path) {
  checkPath(path);
  if (!path.endsWith('.js')) throw Error('Choose a .js file name.');
  return path;
}

function number(value,min,max) {
  if (!Number.isInteger(value) || value<min || value>max) throw Error('Invalid CPS2 instrument setting.');
  return value;
}

export function validateProject(project) {
  if (project?.version!==1 || !Array.isArray(project.channels) || project.channels.length!==16 ||
      !Array.isArray(project.pads) || project.pads.length!==3) throw Error('Expected a CPS2 cassette.');
  const channels=project.channels.map(v=>{
    const sample=number(v.sample,0,1), start=sample*256, end=number(v.end,start+1,start+256);
    return {sample,end,loop:number(v.loop,0,end-start),pan:number(v.pan,0,32),volume:number(v.volume,0,16384),
      send:number(v.send,-32768,32767),rate:number(v.rate,0,65535),note:number(v.note,0,127),
      referenceNote:number(v.referenceNote,0,127),referenceRate:v.referenceRate===null?null:number(v.referenceRate,0,65535)};
  });
  const pads=project.pads.map(p=>({sample:number(p.sample,0,2),pan:number(p.pan,0,32),volume:number(p.volume,0,32767)}));
  const echo={delay:number(project.echo.delay,0,1024),feedback:number(project.echo.feedback,-32768,32767)};
  const files=createVirtualFileSystem();
  files.replace(project.files.map(({path,data})=>{
    if (data instanceof Uint8Array && /\.(vgm|vgz)$/i.test(path)) return {path:checkPath(path),data};
    if (typeof data!=='string') throw Error('Expected JavaScript source.');
    return {path:scriptPath(path),data};
  }));
  if (!files.has('/index.js') || files.get(project.active)?.type!=='text') throw Error('Cassette is missing its entry or selected file.');
  const song=project.song??null;
  if(song!==null && files.get(song)?.type!=='binary')throw Error('Cassette is missing its selected song.');
  return {version:1,song,files:files.list(),active:project.active,selected:number(project.selected,0,15),pads,channels,echo};
}

export function exportProject(project) {
  const {files,...settings}=validateProject(project);
  return createPlaygroundCassetteZip(files,{metadata:{cps2:settings}});
}

export async function importProject(bytes) {
  const archive=await loadPlaygroundCassette(bytes);
  const files=[];
  const decoder=new TextDecoder('utf-8',{fatal:true});
  for (const [path,data] of archive.files) {
    if (path==='metadata.json' || path==='cassette.metadata.js') continue;
    files.push({path:'/'+path,data:/\.(vgm|vgz)$/i.test(path)?data:decoder.decode(data)});
  }
  return validateProject({...archive.metadata.cps2,files});
}

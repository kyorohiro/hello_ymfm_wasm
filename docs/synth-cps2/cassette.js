// SPDX-License-Identifier: BSD-3-Clause
import {createPlaygroundCassetteZip,loadPlaygroundCassette} from '../playground/playground_cassette.js';
import {createVirtualFileSystem} from '../js/tetorica_virtual_files/filesystem.js';
import {isPresetPath,readPreset} from './preset.js';
import {isSamplePath,sampleLibrary} from './samples.js';
import {bankLibrary,isBankPath} from './banks.js';
import {isCatalogPath,readCatalog,catalogPath} from './range-presets.js';
import {validateMix} from './mixer.js';
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
  const placements=project.placements??{};
  const padPlacements=project.padPlacements??{};
  const bankSlots={...project.bankSlots},bankPath=project.bankPath;
  for(const f of project.files.filter(f=>isCatalogPath(f.path))){
    const matches=project.files.filter(r=>isBankPath(r.path)&&catalogPath(r.path)===f.path);
    if(matches.length!==1)throw Error('Missing or ambiguous ROM for '+f.path);
    bankSlots[matches[0].path]=readCatalog(f.data).slots;
  }
  for(const [path,slots] of Object.entries(bankSlots)){
    if(!isBankPath(path))throw Error('Invalid ROM path.');
    bankLibrary(project.files.find(f=>f.path===path)?.data,slots);
  }
  if(bankPath && !isBankPath(bankPath))throw Error('Invalid selected ROM.');
  const {items,padItems}=bankPath?bankLibrary(project.files.find(f=>f.path===bankPath)?.data,bankSlots[bankPath]):
    sampleLibrary(project.files,placements,padPlacements);
  function pcmVoice(v,auto=false){
    const sample=number(v.sample,0,1), item=items.get(v.samplePath),start=item?.start??number(v.start??sample*256,0,65535);
    if(v.samplePath && !item)throw Error('Missing WAV sample.');
    const end=number(v.end,!item?0:start+1,item?start+item.length:65535);
    return {sample,bank:number(v.bank??0,0,32767),start,samplePath:v.samplePath??null,end,loop:number(v.loop,0,!item?65535:end-start),pan:number(v.pan,auto?-0x110:0,auto?65535-0x110:32),volume:number(v.volume,auto?-32768:0,auto?32767:16384),
      send:number(v.send,-32768,32767),rate:number(v.rate,0,65535),note:number(v.note,0,127),
      referenceNote:number(v.referenceNote,0,127),referenceRate:v.referenceRate===null?null:number(v.referenceRate,0,65535)};
  }
  const channels=project.channels.map(v=>pcmVoice(v));
  const pads=project.pads.map(p=>{
    const sample=number(p.sample,0,2),start=(sample+1)*512;
    if(p.samplePath && !padItems.has(p.samplePath))throw Error('Missing ADPCM sample.');
    return {sample,samplePath:p.samplePath??null,start:number(p.start??start,0,65535),end:number(p.end??start+512,0,65535),
      bank:number(p.bank??0,0,32767),pan:number(p.pan,0,32),volume:number(p.volume,-32768,32767)};
  });
  const echo={delay:number(project.echo.delay,0,1024),feedback:number(project.echo.feedback,-32768,32767)};
  const files=createVirtualFileSystem();
  files.replace(project.files.map(({path,data})=>{
    if (data instanceof Uint8Array && (/\.(vgm|vgz)$/i.test(path)||isSamplePath(path)||isBankPath(path))) return {path:checkPath(path),data};
    if (typeof data!=='string') throw Error('Expected JavaScript source.');
    if(isCatalogPath(path))return {path:checkPath(path),data};
    if(isPresetPath(path)){readPreset(data);return {path:checkPath(path),data};}
    return {path:scriptPath(path),data};
  }));
  for(const file of files.list().filter(f=>isPresetPath(f.path))){
    const {source}=readPreset(file.data);
    if(source && files.get(source.path)?.type!=='binary')throw Error('Missing preset source '+source.path);
  }
  scriptPath(project.active);
  if (!files.has('/index.js') || files.get(project.active)?.type!=='text') throw Error('Cassette is missing its entry or selected file.');
  const song=project.song??null;
  if(song!==null && (!/\.vg[mz]$/i.test(song)||files.get(song)?.type!=='binary'))throw Error('Cassette is missing its selected song.');
  return {version:1,autoFade:project.autoFade!==false,...(bankPath?{bankPath,bankSlots}:{}),padPlacements:Object.fromEntries([...padItems].map(([path,i])=>[path,i.offset])),placements:Object.fromEntries([...items].map(([path,i])=>[path,i.offset])),mix:validateMix(project.mix),song,files:files.list(),active:project.active,autoChannel:project.autoChannel===true,autoVoice:pcmVoice(project.autoVoice??project.channels[project.selected],true),selected:number(project.selected,0,15),pads,channels,echo};
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
    files.push({path:'/'+path,data:/\.(vgm|vgz|wav|rom|bin)$/i.test(path)?data:decoder.decode(data)});
  }
  return validateProject({...archive.metadata.cps2,files});
}

// SPDX-License-Identifier: BSD-3-Clause
import {createPlaygroundCassetteZip,loadPlaygroundCassette} from '../playground/playground_cassette.js';
import {Ym2151VoiceInspector} from '../js/playground_ym2151_inspector.js';
import {maybeDecodeVgmFile} from '../js/vgm_file.js';
import {createSampleBank} from './kit.js';
import {inspectSong,embeddedSongBanks} from './vgm.js';
import {playableSamples} from './sample-view.js';
import {makeAudioBank,writeBankSample} from './audio-bank.js';
import {parseOpm} from './opm.js';
import {installProjectTree,base,checkPath,inside} from './project-tree.js';
import {createVirtualFileSystem} from '../js/tetorica_virtual_files/filesystem.js';
import {dirname} from '../js/tetorica_virtual_files/path.js';

const decode=bytes=>new TextDecoder('utf-8',{fatal:true}).decode(bytes);
const voicePatch=({algorithm,feedback,pan,ams,pms,operators})=>({algorithm,feedback,pan,ams,pms,operators});
const voicePath=i=>'presets/ch'+(i+1)+'.fm.json';
const defaultPath='/banks/0_default.rom';
const bankPath=i=>'banks/'+i+'.rom';
const songPath=(i,name)=>'songs/'+i+(/\.vgz$/i.test(name)?'.vgz':'.vgm');
const presetPath=i=>'presets/saved-'+(i+1)+'.fm.json';
const entry='/index.js';
const el=id=>document.getElementById(id);
const report=text=>{el('fileStatus').textContent=text;};
async function loadSong(name,raw,onBank) {
  const bytes=new Uint8Array(await maybeDecodeVgmFile(raw,{maxBytes:16*1024*1024}));
  if(onBank)onBank(embeddedSongBanks(bytes));else inspectSong(bytes);
  return {name,bytes,raw};
}
function validateVoice(patch,validator) {
  if(!Array.isArray(patch?.operators)||patch.operators.length!==4)throw Error('Invalid YM2151 voice.');
  const {keyMask=15,...voice}=patch;
  if(!Number.isInteger(keyMask)||keyMask<0||keyMask>15)throw Error('Invalid operator mask.');
  validator.invoke('setVoice',[0,voice]);return patch;
}

export function setupFiles({inspector,panel,keyMasks,defaultBank,defaults,initialCode,store,draft,applyBank,stop,playSong,stopSong,openFiles}) {
  let files=new Map(),folders=[],selected=entry,editor=entry,activeBank,presetChannel=null,opmBank=null,revision=0;
  let pending=new Map(),editPath=null,saveTimer;
  const songBanks=new WeakMap();
  const initial=inspector.read(), history=[];
  const currentVoice=ch=>({...voicePatch(inspector.read().channels[ch]),keyMask:keyMasks[ch]});
  const initialVoices=initial.channels.map((_,i)=>currentVoice(i));
  function applyVoice(ch,{keyMask=15,...patch}) {
    inspector.invoke('setVoice',[ch,patch]);keyMasks[ch]=keyMask;
  }
  const fm=()=>document.querySelector('[data-tab="fm"]').click();
  const items=kind=>[...files].filter(([,v])=>v.kind===kind);
  const songEntries=()=>items('song');
  function script(path,show=true) {
    editor=path;el('editor').disabled=el('run').disabled=!path;
    el('editor').value=files.get(path)?.text??'';el('codeFile').value=path??'';
    if(show)document.querySelector('[data-tab="code"]').click();
  }
  function useBank(path) {
    activeBank=path;const bank=files.get(path)??defaultBank;
    applyBank(bank.bytes,bank.names,path?base(path):'—',bank.voiceSamples);
  }
  function open(path) {
    const v=files.get(path);if(!v)return;
    selected=path;editPath=path;opmBank=null;presetChannel=null;
    if(v.kind==='code')script(path);
    if(v.kind==='channel'){panel.selectChannel(v.ch);files.set(path,{...v,voice:currentVoice(v.ch)});fm();}
    if(v.kind==='voice'){presetChannel=panel.getSelectedChannel();applyVoice(presetChannel,v.voice);fm();}
    if(v.kind==='opm'){
      opmBank=v;el('opmVoice').replaceChildren(...v.voices.map((voice,i)=>new Option(voice.name,i)));
      el('opmVoice').onchange();fm();
    }
    if(v.kind==='bank'){stopSong();useBank(path);document.querySelector('[data-tab="pcm"]').click();}
    if(v.kind==='song')stopSong();
    render();
    if(v.kind==='song')el('songs').value=String(songEntries().findIndex(([p])=>p===path));
  }
  function render() {
    tree();
    const banks=items('bank');
    el('romList').replaceChildren(...banks.map(([path])=>new Option(base(path),path)));
    el('romList').value=activeBank??'';
    el('romList').disabled=!banks.length;
    const oldSong=el('songs').selectedOptions[0]?.dataset.path;
    const songs=songEntries();
    el('songs').replaceChildren(...songs.map(([path,v],i)=>{
      const option=new Option(v.name,i);option.dataset.path=path;option.selected=path===oldSong;return option;
    }));
    el('referenceSong').hidden=!songs.length;el('songs').disabled=el('playSong').disabled=!songs.length;
    el('codeFile').replaceChildren(...items('code').map(([path])=>new Option(path,path)));
    el('codeFile').value=editor;
    el('copyChannelFile').hidden=files.get(selected)?.kind!=='channel';
    el('opmPick').hidden=el('opmGlobals').hidden=!opmBank;
    updateButtons();
  }
  function updateButtons(){
    const v=files.get(selected);
    el('copyChannelFile').hidden=v?.kind!=='channel';
    el('filePath').textContent=selected;
    const marked=new Set();
    for (const path of pending.keys()) {
      for (let item=path;!marked.has(item);item=dirname(item)) {
        marked.add(item);
        if (item==='/') break;
      }
    }
    for (const row of el('fileTree').querySelectorAll('[data-file-path]'))
      row.toggleAttribute('data-draft',marked.has(row.dataset.filePath));
    el('fileSave').disabled=!v;
    el('fileSaveAll').disabled=!pending.size;el('fileDiscard').disabled=!pending.has(selected);
  }
  function persist(){
    clearTimeout(saveTimer);
    saveTimer=setTimeout(writeDraft,180);
  }
  function writeDraft(){
    clearTimeout(saveTimer);saveTimer=null;
    store.write({...capture(),...soundState()}).catch(error=>report('Local save failed: '+error.message));
  }
  function soundState() {
    const state=inspector.read();
    return {voices:state.channels.map((_,i)=>currentVoice(i)),lfo:state.lfo,noise:state.noise,
      auto:el('fileAuto').checked,name:el('cassetteName').textContent};
  }
  function restoreSound(state) {
    state.voices.forEach((voice,ch)=>applyVoice(ch,voice));
    inspector.invoke('setLFO',[state.lfo]);inspector.invoke('setNoise',[state.noise]);
    el('fileAuto').checked=state.auto;el('cassetteName').textContent=state.name;
  }
  window.addEventListener('pagehide',()=>{if(saveTimer)writeDraft();});
  function editFile(path,value) {
    if(!el('fileAuto').checked&&!pending.has(path))pending.set(path,files.get(path));
    files.set(path,value);updateButtons();persist();
  }
  function save(all=false){
    if(all)pending.clear();else pending.delete(selected);
    updateButtons();persist();report(all?'Saved all files.':'Saved '+selected);
  }
  el('fileSave').onclick=()=>save();
  el('fileSaveAll').onclick=()=>save(true);
  el('fileAuto').onchange=()=>{if(el('fileAuto').checked)save(true);else persist();};
  el('fileDiscard').onclick=()=>{
    const saved=pending.get(selected);if(!saved)return;
    files.set(selected,saved);pending.delete(selected);
    if(saved.kind==='channel')applyVoice(saved.ch,saved.voice);
    open(selected);persist();
  };
  window.addEventListener('keydown',event=>{
    if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='s'){
      event.preventDefault();if(files.has(selected))save();
    }
  });
  function capture(){
    return {starterBanksVersion:1,files:new Map(files),folders:[...folders],selected,editor,activeBank,presetChannel,editPath,pending:new Map(pending)};
  }
  function remember(extra={}){history.push({...capture(),...extra});if(history.length>20)history.shift();}
  function nextPath(make,start=0,pendingFiles) {
    let i=start,path;
    do {path='/'+make(i++);}while(occupied(path)||pendingFiles?.has(path));
    return path;
  }
  function occupied(path) {
    return files.has(path)||folders.includes(path)||[...files.keys()].some(p=>p.startsWith(path+'/'));
  }
  function makeVoice(path) {
    presetChannel=panel.getSelectedChannel();files.set(path,{kind:'voice',voice:currentVoice(presetChannel)});
    selected=editPath=path;opmBank=null;
  }
  function create(action,path) {
    remember();
    if(action==='folder'){folders.push(path);selected=path;}
    if(action==='code'){files.set(path,{kind:'code',text:''});open(path);}
    if(action==='instrument')makeVoice(path);
    render();writeDraft();report('Created '+path);
  }
  function change({from,to,copy=false,moves=[],folders:nextFolders}) {
    remember();
    for(const move of moves) {
      let v=files.get(move.from);
      if(copy && v.kind==='channel')v={kind:'voice',voice:currentVoice(v.ch)};
      if(v.kind==='song'||v.kind==='bank')v={...v,name:base(move.to)};
      files.set(move.to,v);
      if(!copy&&pending.has(move.from))pending.set(move.to,pending.get(move.from));
    }
    const moved=path=>!copy&&inside(path,from)?(to?to+path.slice(from.length):null):path;
    if(!copy)for(const path of [...files.keys()])if(inside(path,from)){files.delete(path);pending.delete(path);}
    folders=nextFolders;
    if(!to && !copy)stopSong();
    const bank=moved(activeBank);
    if(!bank)useBank(items('bank')[0]?.[0]??null);
    else if(bank!==activeBank)useBank(bank);
    const nextEditor=moved(editor)??items('code')[0]?.[0]??null;
    if(nextEditor!==editor)script(nextEditor,false);
    editPath=moved(editPath);selected=to??nextEditor??'/';opmBank=null;
    if(copy&&['code','voice'].includes(files.get(to)?.kind))open(to);else render();
    writeDraft();
    report((copy?'Duplicated ':to?'Moved ':'Deleted ')+from);
  }
  function restoreKit() {
    let path=items('bank').find(([,bank])=>bank.bytes===defaultBank.bytes||(bank.name===defaultBank.name&&bank.bytes.length===defaultBank.bytes.length&&bank.bytes.every((b,i)=>b===defaultBank.bytes[i])))?.[0];
    if(!path){path=nextPath(i=>'banks/0_default'+(i?' ('+i+')':'')+'.rom');files.set(path,{kind:'bank',...defaultBank});}
    useBank(path);
  }
  function undo(){
    const state=history.pop();if(!state)return;
    if(state.voices){revision++;stop();restoreSound(state);}else stopSong();
    files=state.files;folders=state.folders;selected=state.selected;presetChannel=state.presetChannel;editPath=state.editPath;pending=state.pending;opmBank=null;
    useBank(state.activeBank);script(state.editor,false);render();persist();report('Undid file operation.');
  }
  el('romList').onchange=()=>{open(el('romList').value);persist();};
  el('copyChannelFile').onclick=()=>{applyVoice(panel.getSelectedChannel(),currentVoice(files.get(selected).ch));persist();};
  el('opmVoice').onchange=()=>{
    const voice=opmBank?.voices[Number(el('opmVoice').value)];
    if(voice)applyVoice(panel.getSelectedChannel(),{...voice.patch,keyMask:voice.mask});
  };
  el('opmGlobals').onclick=()=>{
    const v=opmBank?.voices[Number(el('opmVoice').value)];
    if(v){inspector.invoke('setLFO',[v.lfo]);inspector.invoke('setNoise',[v.noise]);}
  };
  el('playSong').onclick=()=>{
    const song=songEntries()[Number(el('songs').value)]?.[1];
    if(!song)return;
    if(!songBanks.has(song.bytes))songBanks.set(song.bytes,embeddedSongBanks(song.bytes));
    const banks=songBanks.get(song.bytes);
    if(!song.bankPaths){
      song.bankPaths=stageSongBanks(song,banks,files,true);
      render();persist();
    }
    playSong({...song,banks});
  };
  el('songs').onchange=stopSong;el('stopSong').onclick=()=>stopSong(true);
  el('codeFile').onchange=()=>open(el('codeFile').value);
  el('editor').oninput=()=>{
    editFile(editor,{kind:'code',text:el('editor').value});
    persistCode();
  };
  function persistCode() {
    try {localStorage.setItem('cps1.scripts.v2',JSON.stringify(items('code').map(([path,v])=>[path,v.text])));} catch {}
  }
  function newBank(bank){
    const ids=playableSamples(bank.bytes);
    return {...bank,voiceSamples:Array.from({length:4},(_,voice)=>ids[voice]??-1)};
  }
  function addBank(bytes,names,name){
    const filename=base(name),dot=filename.lastIndexOf('.');
    const stem=dot>0?filename.slice(0,dot):filename, ext=dot>0?filename.slice(dot):'';
    const path=checkPath(nextPath(i=>'banks/'+stem+(i?' ('+i+')':'')+ext));
    remember();files.set(path,newBank({kind:'bank',bytes,names,name}));open(path);persist();
  }
  function stageSongBanks(song,banks,additions,recover=false){
    const paths={};
    for(const {index,bytes} of banks){
      const stem=song.name.replace(/\.vg[zm]$/i,'')+(banks.length>1||index?'-bank'+index:'');
      const existing=recover && items('bank').find(([path,bank])=>base(path)===stem+'.rom' &&
        bank.bytes.length===bytes.length && bytes.every((b,i)=>b===bank.bytes[i]));
      const path=existing?.[0] || checkPath(nextPath(i=>'banks/'+stem+(i?' ('+i+')':'')+'.rom',0,additions));
      if(!existing)additions.set(path,newBank({kind:'bank',bytes,name:base(path),names:Array(128).fill('')}));
      paths[index]=path;
    }
    return paths;
  }
  async function importFiles(incoming,parent,numbered=false) {
    const epoch=revision, additions=new Map();
    if(incoming.length===1&&/\.cassette\.zip$/i.test(incoming[0].name)){await importCassette(incoming[0]);return;}
    const audioFiles=incoming.filter(file=>/\.(wav|wave|flac)$/i.test(file.name));
    if(audioFiles.length){
      openFiles();report('Encoding MSM6295 samples…');
      const bank=await makeAudioBank(audioFiles);
      const path=nextPath(i=>(numbered?'banks/':parent==='/'?'':parent.slice(1)+'/')+'samples-'+i+'.rom');
      additions.set(path,newBank(bank));
    }
    for(const f of incoming.filter(file=>!audioFiles.includes(file))) {
      if(f.size>16*1024*1024)throw Error('File exceeds 16 MiB.');
      let extracted;
      let path=checkPath((parent==='/'?'':parent)+'/'+f.name),v;
      if(/\.vg[zm]$/i.test(path)){
        v={kind:'song',...await loadSong(f.name,new Uint8Array(await f.arrayBuffer()),bytes=>{extracted=bytes;})};
        if(numbered)path=nextPath(i=>songPath(i,f.name),songEntries().length,additions);
      }else if(/\.opm$/i.test(path)){
        const source=await f.text();v={kind:'opm',source,voices:parseOpm(source)};
        if(numbered)path=nextPath(i=>'presets/import-'+i+'.opm');
      }else if(/\.m?js$/i.test(path))v={kind:'code',text:await f.text()};
      else if(/\.fm\.json$/i.test(path))v={kind:'voice',voice:validateVoice(JSON.parse(await f.text()),new Ym2151VoiceInspector({dispatch(){}}))};
      else if(/\.(bin|rom)$/i.test(path)&&f.size>=8&&f.size<=0x40000)v=newBank({kind:'bank',bytes:new Uint8Array(await f.arrayBuffer()),names:Array(128).fill('ROM sample'),name:f.name});
      else throw Error('Unsupported file: '+f.name);
      if(occupied(path)||additions.has(path))throw Error('Already exists: '+path);
      additions.set(path,v);
      if(extracted){songBanks.set(v.bytes,extracted);v.bankPaths=stageSongBanks(v,extracted,additions);}
    }
    if(epoch!==revision)return;
    for(const path of additions.keys())if(occupied(path))throw Error('Already exists: '+path);
    remember();for(const [path,v] of additions)files.set(path,v);
    openFiles();open(additions.keys().next().value);persist();report('Imported '+incoming.map(f=>f.name).join(', '));
  }
  for(const [button,input] of [['chooseVgm','vgmFile'],['chooseOpm','importOpm'],['chooseSamples','audioSamples']]) {
    el(button).onclick=()=>el(input).click();
    el(input).onchange=event=>{
      const incoming=[...event.target.files];event.target.value='';
      if(incoming.length)importFiles(incoming,'/',true).catch(error=>report(error.message));
    };
  }
  const tree=installProjectTree({select:path=>{selected=path;
    for(const row of el('fileTree').querySelectorAll('[data-file-path]'))row.setAttribute('aria-current',String(row.dataset.filePath===path));
    updateButtons();},root:el('fileTree'),getFiles:()=>files,getFolders:()=>folders,selected:()=>selected,open,
    label:file=>file.kind==='bank'?undefined:file.name,create,change,undo,canUndo:()=>history.length>0,importFiles,report});
  function factory(code=defaults) {
    const docs=new Map([...code].map(([path,text])=>[path,{kind:'code',text}]));
    initialVoices.forEach((_,ch)=>docs.set('/'+voicePath(ch),{kind:'channel',ch}));
    docs.set(defaultPath,{kind:'bank',...defaultBank});
    docs.set('/banks/1_sample.rom',createSampleBank());
    docs.set('/banks/99_empty.rom',{kind:'bank',name:'99_empty.rom',names:[''],bytes:new Uint8Array(0x400),voiceSamples:[0,1,2,3]});
    return {docs,dirs:[],active:defaultPath,voices:initialVoices,lfo:initial.lfo,noise:initial.noise};
  }
  function replace(project) {
    remember(soundState());revision++;stop();files=project.docs;folders=project.dirs;editor=files.has(entry)?entry:items('code')[0]?.[0]??null;selected=editor??'/';editPath=opmBank=presetChannel=null;pending.clear();
    project.voices.forEach((v,i)=>applyVoice(i,v));
    inspector.invoke('setLFO',[project.lfo]);inspector.invoke('setNoise',[project.noise]);
    useBank(project.active);script(editor,false);render();persistCode();persist();el('rom').value='';
  }
  el('newCassette').onclick=()=>{
    if(confirm('Start a new Cassette? This replaces the current voices, sample banks and code.')){
      replace(factory());el('cassetteName').textContent='tetorica-cps1.cassette.zip';writeDraft();report('New Cassette');
    }
  };
  function serialize(){
    const state=inspector.read(),records=[],entries=[];
    for(const [path,v] of files) {
      const record={path,kind:v.kind};let data;
      switch(v.kind) {
        case 'channel':record.ch=v.ch;data=JSON.stringify(currentVoice(v.ch));break;
        case 'voice':data=JSON.stringify(v.voice);break;
        case 'bank':record.names=v.names;record.name=v.name;record.voiceSamples=v.voiceSamples;data=v.bytes;break;
        case 'song':record.bankPaths=v.bankPaths;record.name=v.name;data=v.raw;break;
        case 'opm':data=v.source;break;
        case 'code':data=v.text;break;
      }
      entries.push({path,type:typeof data==='string'?'text':'binary',data});records.push(record);
    }
    const cps1={version:2,records,active:activeBank,voices:state.channels.map((_,i)=>currentVoice(i)),lfo:state.lfo,noise:state.noise};
    return createPlaygroundCassetteZip(entries,{directories:folders,metadata:{cps1}});
  }
  el('exportCassette').onclick=()=>{
    try{
      const url=URL.createObjectURL(new Blob([serialize()],{type:'application/zip'}));
      const a=document.createElement('a');a.href=url;a.download='tetorica-cps1.cassette.zip';a.click();
      setTimeout(()=>URL.revokeObjectURL(url),1000);report('Exported Cassette');
    }catch(error){report(error.message);}
  };
  async function parseProject(archive) {
    const m=archive.metadata.cps1,validator=new Ym2151VoiceInspector({dispatch(){}});
    const docs=new Map(),read=path=>{
      if(!archive.files.has(path))throw Error('Missing '+path);
      return archive.files.get(path);
    };
    let active,voices;
    if(m?.version===2){
      if(!Array.isArray(m.records)||m.records.length>archive.files.size||m.voices?.length!==8)throw Error('Invalid project records.');
      voices=m.voices.map(v=>validateVoice(v,validator));active=m.active;
      for(const r of m.records) {
        const path=checkPath(r.path),bytes=read(path.slice(1));
        if(docs.has(path))throw Error('Duplicate file: '+path);
        let value;
        switch(r.kind) {
          case 'channel':
            if(!Number.isInteger(r.ch)||r.ch<0||r.ch>7)throw Error('Invalid channel.');
            value={ch:r.ch};break;
          case 'voice':value={voice:validateVoice(JSON.parse(decode(bytes)),validator)};break;
          case 'code':value={text:decode(bytes)};break;
          case 'opm':{const source=decode(bytes);value={source,voices:parseOpm(source)};break;}
          case 'song':value=await loadSong(r.name,bytes);if(r.bankPaths && Object.values(r.bankPaths).every(p=>typeof p==='string'))value.bankPaths=r.bankPaths;break;
          case 'bank':value={bytes,name:r.name,names:r.names,voiceSamples:r.voiceSamples};break;
          default:throw Error('Unknown CPS1 file type.');
        }
        docs.set(path,{kind:r.kind,...value});
      }
    }else if(m?.version===1){
      const numbers=(n,fn)=>{
        if(!Number.isInteger(n)||n<0||n>archive.files.size)throw Error('Invalid cassette file count.');
        return Array.from({length:n},(_,i)=>fn(i));
      };
      voices=numbers(8,i=>validateVoice(JSON.parse(decode(read(voicePath(i)))),validator));
      for(const [path,text] of defaults)docs.set(path,{kind:'code',text:archive.files.has(path.slice(1))?decode(read(path.slice(1))):text});
      voices.forEach((_,ch)=>docs.set('/'+voicePath(ch),{kind:'channel',ch}));
      numbers(m.presets,i=>docs.set('/'+presetPath(i),{kind:'voice',voice:validateVoice(JSON.parse(decode(read(presetPath(i)))),validator)}));
      numbers(m.opmBanks??0,i=>{
        const path='presets/import-'+i+'.opm',source=decode(read(path));docs.set('/'+path,{kind:'opm',source,voices:parseOpm(source)});
      });
      active='/'+bankPath(m.active);
      m.banks.forEach(({name,names},i)=>docs.set('/'+bankPath(i),{kind:'bank',name,names,bytes:read(bankPath(i))}));
      for(const [i,name] of (m.songs??[]).entries()){
        const path=songPath(i,name);docs.set('/'+path,{kind:'song',...await loadSong(name,read(path))});
      }
    }else throw Error('Unsupported CPS1 cassette.');
    for(const v of docs.values()) {
      if(v.kind==='bank'&&(typeof v.name!=='string'||!Array.isArray(v.names)||v.names.length<1||v.names.length>128||
        !v.names.every(n=>typeof n==='string')||v.bytes.length<8||v.bytes.length>0x40000))throw Error('Invalid sample bank.');
      if(v.kind==='bank' && v.voiceSamples!==undefined && (!Array.isArray(v.voiceSamples) || v.voiceSamples.length!==4 ||
        !v.voiceSamples.every(id=>Number.isInteger(id)&&id>=-1&&id<128)))throw Error('Invalid PCM voice samples.');
      if(v.kind==='song'&&typeof v.name!=='string')throw Error('Invalid song name.');
    }
    if(active!==null&&docs.get(active)?.kind!=='bank')throw Error('Missing active ROM.');
    const dirs=archive.directories.filter(p=>p!=='/').map(checkPath);
    createVirtualFileSystem().replace(Array.from(docs.keys(),path=>({path,data:''})),dirs);
    validator.invoke('setLFO',[m.lfo]);validator.invoke('setNoise',[m.noise]);
    return {docs,dirs,active,voices,lfo:m.lfo,noise:m.noise};
  }
  async function importCassette(file){
    const epoch=revision;
    if(file.size>16*1024*1024)throw Error('Cassette exceeds 16 MiB.');
    const project=await parseProject(await loadPlaygroundCassette(await file.arrayBuffer()));
    if(epoch!==revision||!confirm('Replace the current voices, sample banks and code with this Cassette?'))return;
    replace(project);el('cassetteName').textContent=file.name;writeDraft();report('Imported '+file.name);
  }
  el('importCassette').onchange=event=>{
    const file=event.target.files[0];event.target.value='';
    if(file)importCassette(file).catch(error=>report(error.message));
  };
  const start=factory(initialCode);
  files=start.docs;folders=start.dirs;activeBank=start.active;script(entry,false);render();
  if(draft?.files instanceof Map){
    files=draft.files;folders=draft.folders;selected=draft.selected;editPath=draft.editPath;presetChannel=draft.presetChannel;
    if(!draft.starterBanksVersion && files.get('/banks/0.rom')?.kind==='bank'){
      for(const [path,file] of start.docs)if(file.kind==='bank' && !occupied(path))files.set(path,file);
    }
    pending=draft.pending??new Map();restoreSound(draft);
    useBank(draft.activeBank);script(draft.editor,false);el('cassetteName').textContent=draft.name;render();
  }
  function editableBank(){
    if(!activeBank || !files.has(activeBank))restoreKit();
    return files.get(activeBank);
  }
  function assignSample(voice,id){
    const bank=editableBank(),voiceSamples=[...(bank.voiceSamples??Array(4).fill(-1))];
    voiceSamples[voice]=id;
    editFile(activeBank,{...bank,voiceSamples});
  }
  async function loadSampleFile(file,slot){
    const bank=editableBank(),path=activeBank;
    const clip=await makeAudioBank([file]);
    if(path!==activeBank || files.get(path)!==bank)throw Error('Sample bank changed. Select the file again.');
    updateSample(bank,clip,slot);
  }
  function updateSample(bank,clip,slot){
    const path=activeBank;
    const {bytes,names}=writeBankSample(bank,clip,slot);
    remember();
    editFile(path,{...bank,bytes,names});
    applyBank(bytes,names,base(path),bank.voiceSamples,false,slot);
  }
  function keepSongBank(path,bytes,assignments){
    if(!bytes?.length || !path)return false;
    const matches=bank=>bank?.kind==='bank' && (bank.bytes===bytes ||
      bank.bytes.length===bytes.length && bytes.every((b,i)=>b===bank.bytes[i]));
    let bank=files.get(path);
    if(!matches(bank)){
      // A user may have renamed or edited the extracted copy since import.
      const existing=items('bank').find(([,v])=>matches(v));
      if(existing)[path,bank]=existing;
      else {
        const stem=base(path).replace(/\.rom$/i,'');
        path=nextPath(i=>'banks/'+stem+(i?' ('+i+')':'')+'.rom');
        bank=newBank({kind:'bank',bytes,names:Array(128).fill(''),name:base(path)});
        files.set(path,bank);
        render();
      }
    }
    activeBank=path;
    editFile(path,{...bank,voiceSamples:assignments});
    useBank(path);el('romList').value=path;
    return true;
  }
  return {keepSongBank,persist,addBank,assignSample,loadSampleFile,deleteSample(slot){updateSample(editableBank(),null,slot);},restoreKit(){restoreKit();render();persist();},recordEdit(ch){
    const target=files.get(editPath);
    if(target?.kind==='channel'&&target.ch===ch)editFile(editPath,{...target,voice:currentVoice(ch)});
    else if(ch===presetChannel&&target?.kind==='voice')editFile(editPath,{kind:'voice',voice:currentVoice(ch)});
    else persist();
  },copySongVoice(ch,voice,mask){applyVoice(ch,{...voicePatch(voice),keyMask:mask});}};
}

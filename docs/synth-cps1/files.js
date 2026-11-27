import {renderFileTree} from '../playground/playground_file_tree.js';
// SPDX-License-Identifier: BSD-3-Clause
import {createPlaygroundCassetteZip,loadPlaygroundCassette} from '../playground/playground_cassette.js';
import {Ym2151VoiceInspector} from '../js/playground_ym2151_inspector.js';

import {maybeDecodeVgmFile} from '../js/vgm_file.js';
import {inspectSong} from './vgm.js';
import {parseOpm} from './opm.js';

const decode = bytes => new TextDecoder('utf-8',{fatal:true}).decode(bytes);
const voicePatch = ({algorithm,feedback,pan,ams,pms,operators}) => ({algorithm,feedback,pan,ams,pms,operators});
const voicePath = i => 'presets/ch'+(i+1)+'.fm.json';
const bankPath = i => 'banks/'+i+'.rom';
const songPath = (i,name) => 'songs/'+i+(/\.vgz$/i.test(name) ? '.vgz' : '.vgm');
const presetPath = i => 'presets/saved-'+(i+1)+'.fm.json';

export function setupFiles({inspector,panel,defaultBank,defaultCode,applyBank,getCode,scriptSource,examplePaths,setCode,stop,playSong,stopSong,openFiles,openScript,keyMasks}) {
  const el = id => document.getElementById(id);
  let banks = [defaultBank], presets = [], opmBanks = [], active = 0;
  const initial = inspector.read();
  const initialVoices = initial.channels.map(voice => ({...voicePatch(voice),keyMask:keyMasks[voice.channel]}));
  let selectedPath='/index.js', selectedOpmBank=null, presetChannel=null;
  const expanded=new Map([['/examples',true]]);
  let cassetteRevision = 0, songs=[];
  async function loadSong(name,raw) {
    const bytes=new Uint8Array(await maybeDecodeVgmFile(raw,{maxBytes:16*1024*1024}));
    inspectSong(bytes);
    return {name,raw,bytes};
  }
  function renderSongs() {
    el('songs').replaceChildren(...songs.map((song,i)=>new Option(song.name,i)));
    el('referenceSong').hidden=!songs.length;
    el('songs').disabled=el('playSong').disabled=!songs.length;
  }
  el('chooseVgm').onclick=()=>el('vgmFile').click();
  el('vgmFile').onchange=async event=>{
    const file=event.target.files[0], revision=cassetteRevision;
    event.target.value='';
    if (!file) return;
    openFiles();
    try {
      if (file.size>16*1024*1024) throw Error('VGM exceeds 16 MiB.');
      const song=await loadSong(file.name,new Uint8Array(await file.arrayBuffer()));
      if (revision!==cassetteRevision) return;
      stopSong();songs.push(song);renderSongs();el('songs').value=String(songs.length-1);selectFile('/'+songPath(songs.length-1,song.name));
      report('Imported '+song.name);
    } catch(error) {if (revision===cassetteRevision) report(error.message);}
  };
  el('playSong').onclick=()=>playSong(songs[Number(el('songs').value)]);
  el('songs').onchange=stopSong;
  el('stopSong').onclick=stopSong;
  const report = message => {el('fileStatus').textContent = message;};
  function fileActions() {
    const actions=new Map();
    for (const path of ['/index.js',...examplePaths]) actions.set(path,()=>openScript(path));
    const fm=()=>document.querySelector('[data-tab="fm"]').click();
    for (let i=0;i<8;i++) actions.set('/'+voicePath(i),()=>{panel.selectChannel(i);fm();});
    presets.forEach((v,i)=>actions.set('/'+presetPath(i),()=>{presetChannel=panel.getSelectedChannel();applyVoice(presetChannel,v);fm();}));
    opmBanks.forEach((bank,i)=>actions.set('/presets/import-'+i+'.opm',()=>{
      selectedOpmBank=bank;
      el('opmVoice').replaceChildren(...bank.voices.map((v,index)=>new Option(v.name,index)));
      el('opmVoice').onchange();fm();
    }));
    banks.forEach((bank,i)=>actions.set('/'+bankPath(i),()=>{
      useBank(i);report(bank.name);document.querySelector('[data-tab="pcm"]').click();
    }));
    songs.forEach((song,i)=>actions.set('/'+songPath(i,song.name),()=>{
      stopSong();el('songs').value=String(i);report(song.name);
    }));
    return actions;
  }
  function selectFile(path) {
    selectedPath=path;selectedOpmBank=null;presetChannel=null;
    expanded.set(path.slice(0,path.lastIndexOf('/')),true);
    fileActions().get(path)?.();
    render();
  }
  function render() {
    renderFileTree(el('fileTree'),[...fileActions().keys()].map(path=>({path})),{
      selectedPath,expanded,onOpen:selectFile,
    });
    function describe(path,label) {
      const node=el('fileTree').querySelector('button[data-file-path="'+path+'"]');
      if (node) {node.textContent=label;node.title=path;}
    }
    banks.forEach((bank,i)=>describe('/'+bankPath(i),bank.name));
    songs.forEach((song,i)=>describe('/'+songPath(i,song.name),song.name));
    el('copyChannelFile').hidden=!/^\/presets\/ch[1-8]\.fm\.json$/.test(selectedPath);
    el('opmPick').hidden=el('opmGlobals').hidden=!selectedOpmBank;
  }
  function useBank(index) {
    active=index;
    const {bytes,names,name}=banks[index];applyBank(bytes,names,name);
  }
  function addBank(bytes,names,name) {
    banks.push({bytes,names,name});selectFile('/'+bankPath(banks.length-1));
  }
  function currentVoice(ch) {
    return {...voicePatch(inspector.read().channels[ch]),keyMask:keyMasks[ch]};
  }
  function applyVoice(ch,{keyMask=15,...patch}) {
    inspector.invoke('setVoice',[ch,patch]); keyMasks[ch]=keyMask;
  }
  el('copyChannelFile').onclick=()=>{
    const source=Number(selectedPath.match(/ch([1-8])/)[1])-1, target=panel.getSelectedChannel();
    applyVoice(target,currentVoice(source));report('Loaded voice on CH'+(target+1));
  };
  function selectedOpm() {return selectedOpmBank?.voices[Number(el('opmVoice').value)];}
  el('chooseOpm').onclick=()=>el('importOpm').click();
  el('opmVoice').onchange=()=>{
    const voice=selectedOpm();
    if (voice) applyVoice(panel.getSelectedChannel(),{...voice.patch,keyMask:voice.mask});
  };
  el('opmGlobals').onclick = () => {
    const v=selectedOpm();
    if (!v) return;
    inspector.invoke('setLFO',[v.lfo]); inspector.invoke('setNoise',[v.noise]);
    report('Applied shared LFO and CH8 noise from '+v.name);
  };
  el('importOpm').onchange = async event => {
    const revision=cassetteRevision;
    const file=event.target.files[0]; event.target.value='';
    if (!file) return;
    try {
      if (file.size>1024*1024) throw Error('OPM exceeds 1 MiB.');
      const source=await file.text(), voices=parseOpm(source);
      if (revision!==cassetteRevision) return;
      opmBanks.push({source,voices});openFiles();
      selectFile('/presets/import-'+(opmBanks.length-1)+'.opm');
      report('Imported '+voices.length+' voice(s). '+voices[0].name+' loaded on CH'+(panel.getSelectedChannel()+1));
    } catch (error) {report(error.message);}
  };
  el('saveVoice').onclick = () => {
    presets.push(currentVoice(panel.getSelectedChannel()));
    presetChannel=panel.getSelectedChannel();selectedPath='/'+presetPath(presets.length-1);selectedOpmBank=null;expanded.set('/presets',true);render();
    report('Saved /'+presetPath(presets.length-1));
  };
  function replaceCassette(project) {
    cassetteRevision++;
    stop();songs=project.songs ?? [];renderSongs();
    project.voices.forEach((voice,ch) => applyVoice(ch,voice));
    inspector.invoke('setLFO',[project.lfo]);
    inspector.invoke('setNoise',[project.noise]);
    banks=project.banks; presets=project.presets; opmBanks=project.opmBanks; active=project.active;
    selectedPath="/index.js";selectedOpmBank=null;render(); useBank(active); setCode(project.code,project.examples);
    el('rom').value='';
  }
  el('newCassette').onclick = () => {
    if (!window.confirm('Start a new Cassette? This replaces the current voices, sample banks and code.')) return;
    replaceCassette({voices:initialVoices,lfo:initial.lfo,noise:initial.noise,
      banks:[defaultBank],active:0,presets:[],opmBanks:[],code:defaultCode});
    el('cassetteName').textContent='tetorica-cps1.cassette.zip';report('New Cassette');
  };
  el('exportCassette').onclick = async () => {
    try {
      const sources = await Promise.all(examplePaths.map(scriptSource));
      const state = inspector.read();
      const text = (path,data) => ({path,type:'text',data});
      const files = [text('index.js',getCode()),...examplePaths.map((path,i)=>text(path.slice(1),sources[i]))];
      state.channels.forEach((v,i) => files.push(text(voicePath(i),JSON.stringify(currentVoice(i)))));
      presets.forEach((v,i) => files.push(text(presetPath(i),JSON.stringify(v))));
      opmBanks.forEach(({source},i) => files.push(text('presets/import-'+i+'.opm',source)));
      banks.forEach(({bytes},i) => files.push({path:bankPath(i),type:'binary',data:bytes}));
      songs.forEach(({name,raw},i)=>files.push({path:songPath(i,name),type:'binary',data:raw}));
      const cps1 = {version:1,songs:songs.map(song=>song.name),lfo:state.lfo,noise:state.noise,active,opmBanks:opmBanks.length,presets:presets.length,
        banks:banks.map(({name,names}) => ({name,names}))};
      const zip = createPlaygroundCassetteZip(files,{metadata:{cps1}});
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([zip],{type:'application/zip'}));
      a.download = 'tetorica-cps1.cassette.zip'; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href),1000);
      report('Exported Cassette');
    } catch (error) {report(error.message);}
  };
  el('importCassette').onchange = async event => {
    const revision=cassetteRevision;
    const file = event.target.files[0]; event.target.value = '';
    if (!file) return;
    try {
      if (file.size > 16*1024*1024) throw Error('Cassette exceeds 16 MiB.');
      const {files,metadata} = await loadPlaygroundCassette(await file.arrayBuffer());
      const m = metadata.cps1;
      if (m?.version!==1 || !Array.isArray(m.banks) || !m.banks.length ||
          !Number.isInteger(m.active) || !m.banks[m.active] || !Number.isInteger(m.presets) ||
          m.presets<0 || m.presets>files.size) throw Error('Invalid CPS1 Cassette.');
      const read = path => {
        if (!files.has(path)) throw Error('Missing '+path);
        return files.get(path);
      };
      const nextCode = decode(read('index.js'));
      const examples = new Map();
      for (const path of examplePaths) {
        if (files.has(path.slice(1))) examples.set(path,decode(read(path.slice(1))));
      }
      const nextBanks = m.banks.map(({name,names},i) => {
        const bytes = read(bankPath(i));
        if (typeof name!=='string' || !Array.isArray(names) || !names.length || names.length>128 ||
            !names.every(v=>typeof v==='string') || bytes.length<8 || bytes.length>0x40000) throw Error('Invalid sample bank.');
        return {name,names,bytes};
      });
      const validator = new Ym2151VoiceInspector({dispatch(){}});
      const loadVoice = path => {
        const patch = JSON.parse(decode(read(path)));
        if (!Array.isArray(patch?.operators) || patch.operators.length!==4) throw Error('Invalid FM voice in '+path);
        const {keyMask=15,...voice} = patch;
        if (!Number.isInteger(keyMask) || keyMask<0 || keyMask>15) throw Error('Invalid operator mask.');
        validator.invoke('setVoice',[0,voice]); return patch;
      };
      const voices = Array.from({length:8},(_,i) => loadVoice(voicePath(i)));
      const nextPresets = Array.from({length:m.presets},(_,i) => loadVoice(presetPath(i)));
      validator.invoke('setLFO',[m.lfo]); validator.invoke('setNoise',[m.noise]);
      const count=m.opmBanks ?? 0;
      if (!Number.isInteger(count) || count<0 || count>files.size) throw Error('Invalid OPM bank count.');
      const nextOpmBanks=Array.from({length:count},(_,i) => {
        const source=decode(read('presets/import-'+i+'.opm'));
        return {source,voices:parseOpm(source)};
      });
      const songNames=m.songs ?? [];
      if (!Array.isArray(songNames) || songNames.length>files.size) throw Error('Invalid VGM list.');
      const nextSongs=[];
      for (const [i,name] of songNames.entries()) {
        if (typeof name!=='string') throw Error('Invalid VGM name.');
        nextSongs.push(await loadSong(name,read(songPath(i,name))));
      }
      if (revision!==cassetteRevision) return;
      if (!window.confirm('Replace the current voices, sample banks and code with this Cassette?')) return;
      replaceCassette({voices,songs:nextSongs,lfo:m.lfo,noise:m.noise,banks:nextBanks,active:m.active,
        presets:nextPresets,opmBanks:nextOpmBanks,code:nextCode,examples});
      el('cassetteName').textContent=file.name;report('Imported '+file.name);
    } catch (error) {report(error.message);}
  };
  render();
  return {addBank,recordEdit(ch) {
    if (ch!==presetChannel) return;
    const index=presets.findIndex((_,i)=>selectedPath==='/'+presetPath(i));
    if (index>=0) presets[index]=currentVoice(ch);
  },copySongVoice(ch,voice,mask) {
    applyVoice(ch,{...voicePatch(voice),keyMask:mask});
  },restoreKit() {
    let i=banks.findIndex(bank=>bank===defaultBank);
    if (i<0) {banks.push(defaultBank);i=banks.length-1;render();}
    useBank(i);
  }};
}

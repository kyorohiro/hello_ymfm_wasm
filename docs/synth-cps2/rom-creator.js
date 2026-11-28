// SPDX-License-Identifier: BSD-3-Clause
import {encodePad,maxRom,padByteLength} from './samples.js';
import {QSOUND_PCM_RATE} from '../js/qsoundpcm.js';

const libraryUrl=new URL('../playground/samples/sonic-pi/',import.meta.url);
async function fetchSample(name){
  const response=await fetch(new URL(encodeURIComponent(name),libraryUrl));
  if(!response.ok)throw Error('Could not load '+name);
  return response;
}

async function makeRom(entries,progress){
  const parts=[],presets=[];
  let size=0;
  for(const entry of entries){
    const {name,kind,file}=entry;
    progress(name);
    const pcm=kind==='PCM',hz=Math.round(pcm?QSOUND_PCM_RATE:QSOUND_PCM_RATE/3);
    const source=file??await fetchSample(name);
    const decoder=new OfflineAudioContext(1,1,hz);
    let audio;
    try{audio=await decoder.decodeAudioData(await source.arrayBuffer());}
    catch{throw Error('Could not decode '+name);}
    if(!pcm)padByteLength(audio.duration);
    // A PCM voice uses signed 16-bit addresses. Reserve a silent byte for its release loop.
    const count=pcm?Math.min(audio.length,32766):audio.length;
    const mono=new OfflineAudioContext(1,count,hz);
    const player=mono.createBufferSource();
    player.buffer=audio;player.playbackRate.value=audio.length/count;
    player.connect(mono.destination);player.start();
    const frames=(await mono.startRendering()).getChannelData(0);
    const samples=Uint8Array.from(frames,v=>Math.min(127,Math.max(-128,Math.round(v*128))));
    const bytes=pcm?new Uint8Array(count+1):encodePad({pcm:samples,seconds:audio.duration});
    if(pcm)bytes.set(samples);
    const boundary=pcm?32768:65536;
    if(size%boundary+bytes.length>=boundary)size=Math.ceil(size/boundary)*boundary;
    if(size+bytes.length>maxRom)throw Error('Samples exceed the 16 MiB ROM limit.');
    const start=size%65536;
    presets.push({name:name.replace(/\.(wav|flac)$/i,''),kind,bank:Math.floor(size/65536),start,
      end:start+bytes.length,...(pcm?{rate:Math.max(1,Math.round(4096*count/audio.duration/QSOUND_PCM_RATE)),loop:1}:{})});
    parts.push({offset:size,bytes});size+=bytes.length;
  }
  const rom=new Uint8Array(size);
  for(const {offset,bytes} of parts)rom.set(bytes,offset);
  return {rom,presets};
}

export function setupRomCreator(save){
  const el=id=>document.getElementById('creator-'+id);
  const entries=[];
  let names=[],loading=false,revision=0;
  function showLibrary(){
    const query=el('filter').value.toLowerCase();
    el('library').replaceChildren(...names.filter(n=>n.includes(query)).map(n=>new Option(n,n)));
  }
  function render(){
    el('list').replaceChildren(...entries.map(entry=>{
      const row=document.createElement('li'),label=document.createElement('span');
      label.textContent=entry.name;
      const kind=document.createElement('select');kind.setAttribute('aria-label',entry.name+' format');
      for(const format of ['PCM','ADPCM'])kind.add(new Option(format,format));
      kind.value=entry.kind;kind.onchange=()=>{entry.kind=kind.value;};
      const remove=document.createElement('button');remove.textContent='Remove';
      remove.onclick=()=>{entries.splice(entries.indexOf(entry),1);render();};
      row.append(label,kind,remove);return row;
    }));
    el('build').disabled=!entries.length;
  }
  function add(name,file){
    if(entries.some(e=>e.name===name && e.file===file))return;
    entries.push({name,file,kind:'PCM'});
  }
  el('filter').oninput=showLibrary;
  el('add').onclick=()=>{
    for(const option of el('library').selectedOptions)add(option.value);
    render();
  };
  el('files').onchange=e=>{
    for(const file of e.target.files)add(file.name,file);
    e.target.value='';render();
  };
  el('build').onclick=async()=>{
    const name=el('name').value.trim();
    if(!name){el('status').textContent='Enter a ROM name.';return;}
    const buildRevision=revision;
    el('controls').disabled=true;
    try{
      const {rom,presets}=await makeRom([...entries],n=>{
        if(revision!==buildRevision)throw Error('Cassette changed.');
        el('status').textContent='Converting '+n;
      });
      if(revision!==buildRevision)return;
      save(name,rom,presets);
      el('status').textContent='Created '+name+' · '+presets.length+' presets';
    }catch(error){if(revision===buildRevision)el('status').textContent=error.message;}
    finally{if(revision===buildRevision)el('controls').disabled=false;}
  };
  async function load(){
    if(names.length||loading)return;
    loading=true;
    try{
      const response=await fetchSample('samples.txt');
      names=(await response.text()).trim().split(/\r?\n/);
      showLibrary();
    }catch(error){el('status').textContent=error.message;}
    finally{loading=false;}
  }
  function reset(){
    revision++;entries.length=0;
    el('controls').disabled=false;
    el('status').textContent='';
    el('name').value='my-samples.rom';
    render();
  }
  return {load,reset};
}

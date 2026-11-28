// SPDX-License-Identifier: BSD-3-Clause
import {Ym2612VGM} from '../js/ym2612vgm.js';
import {QSoundPcm} from '../js/qsoundpcm.js';
import {drawSampleWave,drawLoopRegion} from '../synth-cps2/bank-wave.js';

// Replay timestamped register and ROM writes at the audible head. Without
// rendering frames, voice.address retains the last programmed Start register.
export function createQSoundCursor(bytes){
  const parser=new Ym2612VGM(bytes,{logger:null});
  const chip=new QSoundPcm(new Uint8Array(),44100);
  let next=0,loopStart=-1,revision=0;
  return {chip,get revision(){return revision;},
    seek(target,looping){
      for(let count=0;next<=target;count++){
        if(parser.ended){
          if(!looping || loopStart<0 || next<=loopStart)break;
          parser.position=parser.header.loopOffset;parser.ended=false;
        }
        if(count>=32768)return false;
        if(parser.hasLoop() && parser.position===parser.header.loopOffset)loopStart=next;
        const e=parser.step();
        if(e.type==='wait')next+=e.samples;
        else if(e.type==='qsound-write')chip.writeRegister(e.register,e.value);
        else if(e.type==='qsound-rom-data'){
          if(chip.rom.length!==e.memorySize)chip.rom=new Uint8Array(e.memorySize);
          chip.rom.set(e.data,e.offset);revision++;
        }
      }
      return true;
    }};
}

export function mountQSoundMonitor(root){
  root.innerHTML='<div class="fm-channels" role="group" aria-label="QSound PCM channel"></div><p></p><canvas width="768" height="112" style="width:100%;max-width:48rem;background:#102c43" aria-label="Selected PCM range with loop region" hidden></canvas>';
  const group=root.querySelector('div'),caption=root.querySelector('p'),canvas=root.querySelector('canvas');
  let buffer,cursor,position=0,loop=false,selected=0,previous='',failure=false;
  const buttons=Array.from({length:16},(_,i)=>{
    const button=document.createElement('button');
    button.type='button';button.textContent='CH'+(i+1);
    button.onclick=()=>{selected=i;render(position,loop);};
    group.append(button);return button;
  });
  const hex=n=>'0x'+n.toString(16).toUpperCase().padStart(4,'0');
  function render(target,looping){
    if(!buffer || failure)return;
    try{
      if(!cursor || target<position){cursor=createQSoundCursor(buffer);previous='';}
      position=target;loop=looping;
      buttons.forEach((button,i)=>{
        const pressed=String(i===selected);
        if(button.getAttribute('aria-pressed')!==pressed)button.setAttribute('aria-pressed',pressed);
      });
      if(!cursor.seek(target,loop)){
        caption.textContent='Reading QSound commands…';canvas.hidden=true;previous='';return;
      }
      const {chip}=cursor,v=chip.voices[selected];
      const start=v.address&65535,end=v.end&65535,length=(end-start)&65535,repeat=v.loop&65535;
      const configured=chip.lastWrites[selected*8+5]>=0;
      const key=[selected,configured,v.bank,start,end,repeat,v.rate,cursor.revision].join(',');
      if(key===previous)return;
      previous=key;canvas.hidden=true;
      if(!configured){caption.textContent='No PCM range configured on CH'+(selected+1)+'.';return;}
      const base=v.bank*65536,first=Math.min(length,65536-start);
      caption.textContent='Bank '+hex(v.bank)+' · Start '+hex(start)+' · End '+hex(end)+' (exclusive) · Loop '+(repeat?hex((end-repeat)&65535)+' ('+repeat+' bytes)':'off')+' · Rate '+v.rate;
      if(!length)return;
      if(base+start+first>chip.rom.length || base+length-first>chip.rom.length){
        caption.textContent+=' · Range outside loaded ROM';return;
      }
      let pcm=chip.rom.subarray(base+start,base+start+first);
      if(first<length){
        const wrapped=new Uint8Array(length);wrapped.set(pcm);wrapped.set(chip.rom.subarray(base,base+length-first),first);pcm=wrapped;
      }
      canvas.hidden=false;
      drawSampleWave(canvas,{kind:'PCM',pcm,length});
      drawLoopRegion(canvas,start,length,end,repeat);
    }catch(error){failure=true;caption.textContent=error.message;canvas.hidden=true;}
  }
  return {render,load(bytes){
    if(buffer===bytes)return;
    buffer=bytes;cursor=null;previous='';selected=position=0;failure=false;loop=false;canvas.hidden=true;caption.textContent='';
  }};
}

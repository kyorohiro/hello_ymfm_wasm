// SPDX-License-Identifier: BSD-3-Clause
import {readSnesVoices} from '../js/snes_brr.js';
import {parseSpcSnapshotVoices} from './spc_import.js?v=spc-sample-inspection-1';
export function spcVariant(candidate,{includeEcho=false,includePmon=false}={}){
 const pair=includePmon&&candidate?.voice.pitchModulation&&!candidate.voice.noise;
 return pair?candidate?.[includeEcho?'pmonEchoVariant':'pmonVariant']:includeEcho?candidate?.echoVariant:candidate;
}
/** Auto owns the authored instrument; CH tabs inspect detached SPC state. */
export function createSnesChannelView({player,getOptions,onView=()=>{},onState=()=>{},onBeforeSelect=async()=>{},onCopy,document:doc=globalThis.document,onError=()=>{}}){
 let selected=null,live=true,sourceId=null,lastRevision=-1,view=null,disposed=false,operation=0,song=player.read(),voices=[];const listeners=[];
 const $=id=>doc.getElementById(id),tabs=$('snesChannelTabs'),buttons=[];
 const listen=(node,type,fn)=>{node.addEventListener(type,fn);listeners.push(()=>node.removeEventListener(type,fn));};
 const read=()=>({selected,sourceId,live,view,playing:song.playing,busy:song.busy,transportRevision:song.transportRevision});
 function render(){$('snesChannelBody')?.setAttribute('aria-labelledby',selected===null?'snesChannelAuto':'snesChannel'+(selected+1));buttons.forEach((button,index)=>{const active=(index===0?null:index-1)===selected,voice=voices[index-1],zero=Boolean(voice&&!voice.noise&&voice.pitch===0);button.dataset.pitchZero=String(zero);button.title=index===0?'Auto · authored instrument':zero?`CH${index} · PITCH 0: sample playback speed is zero. Select to inspect or edit.`:`CH${index} · inspect this SPC voice`;button.setAttribute('aria-label',index===0?'Auto':zero?`CH${index}, PITCH 0, sample playback speed is zero`:`CH${index}`);button.disabled=index>0&&!song.loaded;button.setAttribute('aria-selected',String(active));button.tabIndex=active?0:-1;});$('snesChannelLive').checked=live;$('snesChannelLive').disabled=selected===null;$('snesChannelCopy').disabled=selected===null||song.busy||song.playing||!view?.preset;
  $('snesChannelStatus').textContent=selected===null?'Auto · edit and play':`CH${selected+1} · ${song.playing&&live?'Live':'Frozen'} · ${(view?.position??0).toFixed(2)} s · ${view?.reason|| (song.playing?'Edit the SPC voice below; the driver may overwrite changes.':'Edit this SPC voice or audition its snapshot. Copy to Auto to save.')}`;
  onState(read());
 }
 function refresh(force=false){
  if(disposed)return;const revision=song.analysisRevision;
  if((selected===null||force||live||!song.playing)&&(force||revision!==lastRevision)){
   lastRevision=revision;const data=player.analysis();voices=data?readSnesVoices(data.snapshot):[];
   if(selected!==null){
    if(data){const batch=parseSpcSnapshotVoices(data.snapshot,{name:data.name,metadata:data.metadata}),candidate=batch.candidates[selected],choice=spcVariant(candidate,getOptions());view={candidate,preset:choice?.preset??null,reason:choice?.reason??'',position:data.snapshot.positionSeconds};}
    else view=null;
    onView(read());
   }
  }render();
 }
 async function select(value){const token=++operation;await player.cancelEdits?.();await onBeforeSelect(value);if(disposed||token!==operation)return;selected=value;view=null;lastRevision=-1;if(selected===null){await onView(read());render();}else refresh(true);}
 for(let index=0;index<9;index++){const button=doc.createElement('button');button.type='button';button.id='snesChannel'+(index?index:'Auto');button.textContent=index?`CH${index}`:'Auto';button.dataset.snesChannel=index?String(index-1):'auto';button.setAttribute('role','tab');button.setAttribute('aria-controls','snesChannelBody');tabs.append(button);buttons.push(button);listen(button,'click',()=>{button.blur();void select(index?index-1:null).catch(onError);});listen(button,'keydown',event=>{const enabled=buttons.filter(button=>!button.disabled);let at=enabled.indexOf(button),next=event.key==='Home'?0:event.key==='End'?enabled.length-1:event.key==='ArrowRight'?(at+1)%enabled.length:event.key==='ArrowLeft'?(at+enabled.length-1)%enabled.length:null;if(next===null)return;event.preventDefault();const target=enabled[next];target.focus();void select(target.dataset.snesChannel==='auto'?null:Number(target.dataset.snesChannel)).catch(onError);});}
 listen($('snesChannelLive'),'change',()=>{live=$('snesChannelLive').checked;refresh(true);});
 listen($('snesChannelCopy'),'click',()=>{const current=view;if(!current?.preset||song.playing)return;void Promise.resolve(onCopy(current.candidate)).catch(onError);});
 return {read,select,
 async edit(changes){const channel=selected,token=operation,id=sourceId;if(channel===null)throw Error('Select a SPC channel.');await player.editVoice(channel,changes,{isCurrent:()=>!disposed&&operation===token&&selected===channel&&sourceId===id});if(disposed||operation!==token||sourceId!==id)throw new DOMException('SPC edit superseded','AbortError');refresh(true);},
 reset(){operation++;void player.cancelEdits?.().catch(onError);selected=null;view=null;lastRevision=-1;render();},refresh:()=>refresh(true),update(next){song=next;if(sourceId!==next.source?.id){const was=selected;sourceId=next.source?.id;selected=null;view=null;lastRevision=-1;if(was!==null)onView(read());}refresh();},dispose(){disposed=true;operation++;for(const cleanup of listeners)cleanup();}};
}

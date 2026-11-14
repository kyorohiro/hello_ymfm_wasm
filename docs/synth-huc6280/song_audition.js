// SPDX-License-Identifier: BSD-3-Clause
// A private trial instrument shares the Master bus, never the song/author PSG.
import {prepareHuc6280SongVoice} from './song_voice.js';
import {createSynthCodeOutput} from '../synth/synth_code_output.js';

const cancelled=()=>new DOMException('Paused HuC6280 audition cancelled','AbortError');
const isAbort=error=>error?.name==='AbortError';
function identity(id){if(typeof id!=='string'||!id.length||id.length>128)throw TypeError('Audition identity must contain 1–128 characters');}

/** getSelection() is null or {key,snapshot,channel}; key identifies the paused
 * source/run/frame/channel. This controller never calls the song transport or
 * authored chip. Each retired lease owns only its private node and fade gain. */
export function createHuc6280SongAudition({ensureAudio,getAudio,getSelection,onUpdate=()=>{},createOutput=createSynthCodeOutput}={}){
  for(const callback of [ensureAudio,getAudio,getSelection,onUpdate,createOutput])if(typeof callback!=='function')throw TypeError('Paused HuC6280 audition needs host callbacks');
  let disposed=false,epoch=0,lease=null,tail=Promise.resolve(),pending=0,stopping=0,lastError='',pitch=0,pitchRevision=0;
  const notes=new Map();
  function read(){
    const active=Boolean(lease||pending||notes.size),state=stopping||lease?.retiring?'stopping':lease?.ready?'ready':active?'preparing':lastError?'error':'idle';
    return{state,active,heldCount:notes.size,soundingCount:lease?.sounding?1:0,channel:lease?.prepared.channel??null,
      source:lease?.prepared.source??null,pitch:lease?.prepared.source==='noise'?0:pitch,error:Boolean(lastError),
      message:lastError||(state==='ready'?`Paused VGM CH ${lease.prepared.channel+1} audition · ${notes.size} held`:state==='preparing'?'Preparing the paused HuC6280 voice…':state==='stopping'?'Stopping the paused audition…':'Paused VGM audition stopped.')};
  }
  const emit=()=>{if(!disposed)try{onUpdate(read());}catch{}};
  function enqueue(work){pending++;emit();const result=tail.then(work).finally(()=>{pending--;emit();});tail=result.catch(()=>{});return result;}
  function selection(){
    const value=getSelection();if(value==null)return null;
    if(typeof value.key!=='string'||!value.key.length||value.key.length>8192)throw TypeError('Paused audition needs a stable selection key');
    const prepared=value.prepared??prepareHuc6280SongVoice(value.snapshot,value.channel);
    return{key:value.key,channel:value.channel,prepared,fingerprint:JSON.stringify([value.key,value.channel,prepared.positionFrames,prepared.preset])};
  }
  const sameSelection=item=>{try{return selection()?.fingerprint===item.selected.fingerprint;}catch{return false;}};
  const current=item=>!disposed&&lease===item&&!item.retiring&&item.epoch===epoch&&sameSelection(item)&&getAudio()===item.engine;
  const check=item=>{if(!current(item)||item.client?.isCurrent?.()===false)throw cancelled();};
  const noteCurrent=note=>{if(notes.get(note.id)!==note||note.released)return false;try{return note.isCurrent()!==false;}catch{return false;}};
  const forget=note=>{note.released=true;if(notes.get(note.id)===note)notes.delete(note.id);};
  function retire(item){
    if(!item)return Promise.resolve();if(item.retirement)return item.retirement;
    item.retiring=true;emit();
    return item.retirement=(async()=>{
      try{await item.output?.fadeOut();}
      finally{
        try{item.controller.abort();await item.client?.dispose();}
        finally{item.output?.dispose();item.sounding=null;
          if(lease===item)lease=null;for(const note of notes.values())if(note.lease===item)forget(note);emit();}
      }
    })();
  }
  async function prepare(selected,requestEpoch){
    if(lease?.ready&&lease.epoch===requestEpoch&&lease.selected.fingerprint===selected.fingerprint&&current(lease))return lease;
    if(lease)await retire(lease);
    if(disposed||requestEpoch!==epoch||selection()?.fingerprint!==selected.fingerprint)throw cancelled();
    await ensureAudio();
    if(disposed||requestEpoch!==epoch||selection()?.fingerprint!==selected.fingerprint)throw cancelled();
    const engine=getAudio();if(!engine||typeof engine.createAuditionVoice!=='function')throw Error('Paused audition needs the existing HuC6280 audio engine');
    const item=lease={engine,epoch:requestEpoch,selected,prepared:selected.prepared,controller:new AbortController(),client:null,output:null,ready:false,retiring:false,retirement:null,sounding:null};emit();
    try{
      item.client=await engine.createAuditionVoice(selected.prepared.preset,{signal:item.controller.signal,isCurrent:()=>current(item),onError:error=>{
        if(lease!==item||item.retiring)return;lastError=error?.message??String(error);for(const note of notes.values())if(note.lease===item)forget(note);
        void retire(item).catch(()=>{});emit();
      }});
      item.output=createOutput({getContext:()=>item.client.context,getGain:()=>item.client.outputGain});
      check(item);item.ready=true;emit();return item;
    }catch(error){await retire(item);throw error;}
  }
  async function release(item,note){
    if(!item||!note||item.sounding!==note)return false;
    await item.output?.fadeOut();
    if(item.sounding===note){if(current(item))await item.client.noteOff(note.id);item.sounding=null;note.gated=false;}
    emit();return true;
  }
  function noteOn(id,midi,{isCurrent=()=>true}={}){
    identity(id);if(!Number.isInteger(midi)||midi<0||midi>127)throw RangeError('Audition note must be MIDI 0–127');
    if(typeof isCurrent!=='function')throw TypeError('Audition isCurrent must be a function');
    if(disposed)return Promise.reject(Error('Paused HuC6280 audition is disposed'));
    if(notes.has(id))return Promise.reject(Error('Audition identity is already held'));
    const selected=selection();if(!selected)return Promise.reject(Error('Pause the VGM and select a song channel to audition it'));
    if(!selected.prepared.playable)return Promise.reject(Error(selected.prepared.reason));
    const stolenId=[...notes.values()].at(-1)?.id??null;
    for(const note of notes.values())forget(note);
    const note={id,midi,isCurrent,selected,epoch,lease:null,gated:false,released:false};notes.set(id,note);lastError='';emit();
    return enqueue(async()=>{
      if(!noteCurrent(note)||note.epoch!==epoch){forget(note);if(note.epoch===epoch&&!notes.size&&lease?.epoch===epoch)await release(lease,lease.sounding);return null;}
      let item;
      try{
        item=await prepare(selected,note.epoch);note.lease=item;
        if(!noteCurrent(note)){forget(note);if(!notes.size)await retire(item);return null;}
        check(item);await item.output.fadeOut();check(item);await item.client.command('stop');item.sounding=null;check(item);
        await item.client.setPitch(item.prepared.source==='noise'?0:pitch);check(item);
        if(!noteCurrent(note)){forget(note);if(!notes.size)await retire(item);return null;}
        const result=await item.client.noteOn(id,midi);item.sounding=note;note.gated=true;
        if(!noteCurrent(note)||!current(item)){await release(item,note);forget(note);if(!notes.size)await retire(item);return null;}
        item.output.open({freshInput:true});emit();return{channel:item.prepared.channel,physicalChannel:result?.channel,stolenId};
      }catch(error){forget(note);if(item)await retire(item);if(isAbort(error))return null;lastError=error?.message??String(error);emit();throw error;}
    });
  }
  function noteOff(id){identity(id);const note=notes.get(id);if(!note)return Promise.resolve(false);forget(note);emit();return enqueue(async()=>{
    try{return await release(note.lease,note);}catch(error){await retire(note.lease);if(isAbort(error))return false;lastError=error?.message??String(error);emit();throw error;}
  });}
  function setPitch(value){
    if(!Number.isFinite(value)||value< -24||value>24)throw RangeError('Audition Pitch must be within ±24 semitones');
    if(disposed)return Promise.reject(Error('Paused HuC6280 audition is disposed'));
    const selected=selection();if(selected?.prepared.source==='noise'){pitch=0;return Promise.resolve(read());}
    pitch=value;const request=++pitchRevision,requestEpoch=epoch;
    return enqueue(async()=>{const item=lease;if(request!==pitchRevision||requestEpoch!==epoch||!item?.sounding||!current(item)||item.prepared.source==='noise')return read();
      try{await item.client.setPitch(pitch);check(item);emit();return read();}catch(error){await retire(item);if(isAbort(error))return read();lastError=error?.message??String(error);emit();throw error;}
    });
  }
  function stop(){
    epoch++;pitchRevision++;pitch=0;lastError='';const item=lease;for(const note of notes.values())forget(note);
    // Abort a not-yet-ready worklet immediately; a sounding node first fades.
    if(item&&!item.ready)item.controller.abort();stopping++;emit();
    return enqueue(async()=>{try{await retire(item);}finally{stopping--;emit();}});
  }
  async function dispose(){if(disposed)return tail;disposed=true;await stop();}
  return{noteOn,noteOff,setPitch,stop,invalidate:stop,allNotesOff:stop,read,isRunning:()=>read().active,dispose};
}

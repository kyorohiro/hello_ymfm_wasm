// SPDX-License-Identifier: BSD-3-Clause
// A temporary performance on the editor's existing APU/checkpoint/output.
import {prepareGameboySongVoice} from './song_voice.js';
import {createSynthCodeOutput} from '../synth/synth_code_output.js';

const cancelled=()=>new DOMException('Paused DMG audition cancelled','AbortError');
const isAbort=error=>error?.name==='AbortError';
function identity(id){if(typeof id!=='string'||!id.length||id.length>128)throw new TypeError('Audition identity must contain 1–128 characters');}
function frequency(midi,pitch,source){
  const hz=440*2**((midi-69+pitch)/12),period=Math.round(2048-4194304/((source==='wave'?64:32)*hz));
  if(!Number.isFinite(hz)||!Number.isInteger(period)||period<0||period>2047)throw new RangeError('Note is outside this Game Boy channel frequency range');
  return hz;
}

/** getSelection() returns null, or {key,snapshot,channel}. Its key identifies
 * the paused song/frame/view and selected physical CH. Nothing here calls the
 * song transport, creates an APU/context or changes the saved instrument.
 * stop() invalidates pending notes synchronously, then awaits the host fade
 * and the borrowed client's exact native/editor checkpoint restoration. */
export function createGameboySongAudition({ensureAudio,getAudio,getSelection,onUpdate=()=>{},createOutput=createSynthCodeOutput}={}){
  for(const callback of [ensureAudio,getAudio,getSelection,onUpdate,createOutput])if(typeof callback!=='function')throw new TypeError('Paused DMG audition needs host callbacks');
  let disposed=false,epoch=0,lease=null,tail=Promise.resolve(),pending=0,stopping=0,lastError='',pitch=0,pitchRevision=0;
  const notes=new Map();
  function read(){
    const active=Boolean(lease||pending||notes.size),state=stopping||lease?.retiring?'stopping':lease?.ready?'ready':active?'preparing':lastError?'error':'idle';
    return {state,active,heldCount:notes.size,soundingCount:lease?.sounding?1:0,channel:lease?.prepared.channel??null,
      source:lease?.prepared.source??null,pitch:lease?.prepared.source==='noise'?0:pitch,error:Boolean(lastError),
      message:lastError||(state==='ready'?`Paused VGM CH ${lease.prepared.channel+1} audition · ${notes.size} held`:
        state==='preparing'?'Preparing the paused Game Boy voice…':state==='stopping'?'Restoring your edited sound…':'Paused VGM audition stopped.')};
  }
  function emit(){try{onUpdate(read());}catch{}}
  function enqueue(work){pending++;emit();const task=tail.then(work).finally(()=>{pending--;emit();});tail=task.catch(()=>{});return task;}
  function selection(){
    const value=getSelection();if(value==null)return null;
    if(typeof value.key!=='string'||!value.key.length||value.key.length>8192)throw new TypeError('Paused DMG audition needs a stable selection key');
    const prepared=prepareGameboySongVoice(value.snapshot,value.channel);
    return {key:value.key,snapshot:value.snapshot,channel:value.channel,prepared,
      fingerprint:JSON.stringify([value.key,value.channel,prepared.positionFrames,value.snapshot.registers,value.snapshot.voice])};
  }
  function sameSelection(item){try{return selection()?.fingerprint===item.selected.fingerprint;}catch{return false;}}
  const ownsOutput=item=>!item.outputDetached&&getAudio()===item.engine&&item.client?.ownsOutput?.()===true;
  const valid=item=>!disposed&&lease===item&&!item.retiring&&item.epoch===epoch&&sameSelection(item)&&ownsOutput(item);
  const check=item=>{if(!valid(item))throw cancelled();};
  function noteCurrent(note){if(notes.get(note.id)!==note||note.released)return false;try{return note.isCurrent()!==false;}catch{return false;}}
  function forget(note){note.released=true;if(notes.get(note.id)===note)notes.delete(note.id);}
  function retire(item){
    if(!item)return Promise.resolve();if(item.retirement)return item.retirement;
    item.retiring=true;emit();
    item.retirement=(async()=>{
      try{
        if(ownsOutput(item))await item.output?.fadeOut();
        if(item.client){try{await item.client.dispose();}catch(error){if(!isAbort(error))throw error;}}
        // Only this lease's successful neutral restoration can reopen the
        // author route. A late cleanup never opens a newer Code/trial owner.
        if(ownsOutput(item))item.output?.open();
      }finally{
        item.sounding=null;item.outputDetached=true;item.output?.dispose();
        if(lease===item)lease=null;
        for(const note of notes.values())if(note.lease===item)forget(note);
        emit();
      }
    })();return item.retirement;
  }
  async function prepare(selected,requestEpoch){
    if(lease?.ready&&lease.epoch===requestEpoch&&lease.selected.fingerprint===selected.fingerprint&&valid(lease))return lease;
    if(lease)await retire(lease);
    if(disposed||requestEpoch!==epoch||selection()?.fingerprint!==selected.fingerprint)throw cancelled();
    if(!selected.prepared.playable)throw new Error(selected.prepared.reason);
    await ensureAudio();
    if(disposed||requestEpoch!==epoch||selection()?.fingerprint!==selected.fingerprint)throw cancelled();
    const engine=getAudio();if(!engine||typeof engine.getGameboyClient!=='function')throw new Error('Paused audition needs the existing DMG audio engine');
    const item=lease={engine,epoch:requestEpoch,selected,prepared:selected.prepared,client:null,output:null,outputDetached:false,
      ready:false,retiring:false,retirement:null,sounding:null};emit();
    try{
      item.client=await engine.getGameboyClient();
      if(typeof item.client?.ownsOutput!=='function')throw new Error('Paused audition needs an ownership-safe Game Boy client');
      item.output=createOutput({getContext:()=>ownsOutput(item)?engine.context:null,getGain:()=>ownsOutput(item)?engine.codeFadeNode:null});
      check(item);await item.output.fadeOut();check(item);
      await item.client.initialize();check(item);
      await item.client.allNotesOff();check(item);
      const {preset,source,channel}=item.prepared;
      if(source==='pulse'){
        const {duty,volume,envelope,sweep}=preset.pulse;
        await item.client.pulse.setVoice(channel,{duty,volume,envelope});check(item);
        if(channel===0){await item.client.pulse.setSweep(sweep.enabled?{direction:sweep.direction,period:sweep.period,shift:sweep.shift}:{direction:'up',period:0,shift:0});check(item);}
      }else if(source==='wave'){
        await item.client.wave.stopAndSetWaveform(preset.wave.samples);check(item);
        await item.client.wave.setLevel(preset.wave.level);check(item);
      }else{await item.client.noise.setVoice(preset.noise);check(item);}
      await item.client.setPan(channel,preset.pan.left,preset.pan.right);check(item);
      item.ready=true;emit();return item;
    }catch(error){await retire(item);throw error;}
  }
  async function release(item,note){
    if(!item||!note||item.sounding!==note)return false;
    if(ownsOutput(item)){
      await item.output.fadeOut();
      if(ownsOutput(item))try{await item.client.keyOff(item.prepared.channel);}catch(error){if(!isAbort(error))throw error;}
    }
    if(item.sounding===note)item.sounding=null;note.gated=false;emit();return true;
  }
  function noteOn(id,midi,{isCurrent=()=>true}={}){
    identity(id);if(!Number.isInteger(midi)||midi<0||midi>127)throw new RangeError('Audition note must be MIDI 0..127');
    if(typeof isCurrent!=='function')throw new TypeError('Audition isCurrent must be a function');
    if(disposed)return Promise.reject(new Error('Paused DMG audition is disposed'));
    if(notes.has(id))return Promise.reject(new Error('Audition identity is already held'));
    const selected=selection();if(!selected)return Promise.reject(new Error('Pause the VGM and select a song channel to audition it'));
    if(!selected.prepared.playable)return Promise.reject(new Error(selected.prepared.reason));
    // A malformed/out-of-range new key cannot cut off the currently held one.
    if(selected.prepared.source!=='noise')frequency(midi,pitch,selected.prepared.source);
    const previous=[...notes.values()].at(-1),stolenId=previous?.id??null;
    for(const note of notes.values())forget(note);
    const note={id,midi,isCurrent,selected,epoch,lease:null,gated:false,released:false};
    notes.set(id,note);lastError='';emit();
    return enqueue(async()=>{
      if(!noteCurrent(note)||note.epoch!==epoch){
        forget(note);
        // A quick replacement key can be released before its queued work
        // starts. Its stolen predecessor must not become an orphaned Gate.
        if(note.epoch===epoch&&!notes.size&&lease?.epoch===epoch)await release(lease,lease.sounding);
        return null;
      }
      let item=null;
      try{
        item=await prepare(selected,note.epoch);note.lease=item;
        if(!noteCurrent(note)){forget(note);if(!notes.size)await retire(item);return null;}
        check(item);
        await item.output.fadeOut();check(item);
        if(item.sounding){await item.client.keyOff(item.prepared.channel);item.sounding=null;check(item);}
        if(item.prepared.source!=='noise'){
          await item.client.setFrequency(item.prepared.channel,frequency(midi,pitch,item.prepared.source));check(item);
        }
        if(!noteCurrent(note)){forget(note);if(!notes.size)await retire(item);return null;}
        await item.client.keyOn(item.prepared.channel);item.sounding=note;note.gated=true;
        if(!noteCurrent(note)||!valid(item)){await release(item,note);forget(note);if(!notes.size)await retire(item);return null;}
        item.output.open({freshInput:true});emit();return{channel:item.prepared.channel,stolenId};
      }catch(error){
        forget(note);if(item)await retire(item);
        if(isAbort(error))return null;
        lastError=error?.message??String(error);emit();throw error;
      }finally{emit();}
    });
  }
  function noteOff(id){identity(id);const note=notes.get(id);if(!note)return Promise.resolve(false);forget(note);emit();return enqueue(()=>release(note.lease,note));}
  function allNotesOff(){
    const held=[...notes.values()],requestEpoch=epoch;for(const note of held)forget(note);emit();
    return enqueue(async()=>{
      for(const note of held)await release(note.lease,note);
      if(requestEpoch===epoch&&lease?.epoch===epoch)await release(lease,lease.sounding);
    });
  }
  function setPitch(value){
    if(!Number.isFinite(value)||value < -24||value > 24)throw new RangeError('Audition Pitch must be within ±24 semitones');
    if(disposed)return Promise.reject(new Error('Paused DMG audition is disposed'));
    const selected=selection(),note=[...notes.values()].at(-1);
    if(selected?.prepared.source==='noise'){pitch=0;return Promise.resolve(read());}
    if(note)frequency(note.midi,value,selected?.prepared.source??note.selected.prepared.source);
    pitch=value;const request=++pitchRevision,requestEpoch=epoch;
    return enqueue(async()=>{
      const item=lease;
      if(request!==pitchRevision||requestEpoch!==epoch||!item?.sounding||!valid(item)||item.prepared.source==='noise')return read();
      await item.client.setFrequency(item.prepared.channel,frequency(item.sounding.midi,pitch,item.prepared.source));check(item);emit();return read();
    });
  }
  function stop(){
    epoch++;pitchRevision++;pitch=0;lastError='';const item=lease;
    for(const note of notes.values())forget(note);stopping++;emit();
    return enqueue(async()=>{try{await retire(item);}finally{stopping--;emit();}});
  }
  async function dispose(){if(disposed)return tail;disposed=true;await stop();}
  return {noteOn,noteOff,allNotesOff,setPitch,stop,invalidate:stop,read,isRunning:()=>read().active,dispose};
}

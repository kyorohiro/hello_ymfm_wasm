// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 kyorohiro.
// A temporary performance in the editor's existing SPU/checkpoint/output.
import {preparePsfVoiceCapture} from './psf_capture.js?v=psf-marker-capture-1';
import {readSpuInstrument} from './spu_synth_instrument.js?v=spu-split-vab-1';
import {SpuRoundRobinVoices} from './spu_synth_voices.js?v=spu-synth-2';
import {createSynthCodeOutput} from '../synth/synth_code_output.js';

const cancelled=()=>new DOMException('Paused PSF audition was cancelled','AbortError');
const isAbort=error=>error?.name==='AbortError';
function identity(id) {
  if(typeof id!=='string'||!id.length||id.length>128)throw new TypeError('Audition identity must contain 1–128 characters');
}

/** getSelection() is cheap and returns null, or {key,referenceNote,reverb}.
 * key identifies the paused source/frame/CH/reference and audio owner.
 * getCapturePayload() copies historical RAM only when a new lease is prepared.
 * stop()/invalidate() invalidate pending gates immediately, then await the
 * output fade and exact editor checkpoint restoration. No PSF transport call,
 * engine.stop(), FX node, AudioContext or native output is owned here.
 */
export function createPsfPausedAudition({getAudio,getSelection,getCapturePayload,onUpdate=()=>{},
  createOutput=createSynthCodeOutput}={}) {
  for(const fn of [getAudio,getSelection,getCapturePayload,onUpdate,createOutput])
    if(typeof fn!=='function')throw new TypeError('Paused PSF audition requires host callbacks');
  let disposed=false,epoch=0,lease=null,tail=Promise.resolve(),pendingTasks=0,stopping=0,lastError='';
  const notes=new Map();
  function read() {
    const active=Boolean(lease||pendingTasks||notes.size),state=stopping||lease?.retiring?'stopping':
      lease?.ready?'ready':active?'preparing':lastError?'error':'idle';
    return {state,active,heldCount:notes.size,soundingCount:lease?.voices.entries().filter(value=>notes.get(value.id)?.gated).length??0,
      sourceVoice:lease?.capture?.voice??null,referenceNote:lease?.instrument.noise.enabled?null:lease?.selection.referenceNote??null,
      error:Boolean(lastError),message:lastError|| (state==='ready'?`Paused PSF CH ${lease.capture.voice+1} audition · ${notes.size} held`:
        state==='preparing'?'Preparing the paused PSF voice…':state==='stopping'?'Restoring the edited instrument…':'Paused PSF audition stopped.')};
  }
  function emit(){try{onUpdate(read());}catch{}}
  function enqueue(work) {
    pendingTasks++;emit();
    const task=tail.then(work).finally(()=>{pendingTasks--;emit();});
    tail=task.catch(()=>{});return task;
  }
  function selection() {
    const value=getSelection();if(value==null)return null;
    if(typeof value.key!=='string'||!value.key.length||value.key.length>8192)
      throw new TypeError('Paused PSF audition needs a stable selection key');
    const reverb=value.reverb?{preset:value.reverb.preset,volumeLeft:value.reverb.volumeLeft,volumeRight:value.reverb.volumeRight}:null;
    const referenceNote=value.referenceNote??'C4';
    return {key:value.key,referenceNote,reverb,fingerprint:JSON.stringify([value.key,referenceNote,reverb])};
  }
  function sameSelection(item) {
    try{return selection()?.fingerprint===item.selection.fingerprint;}catch{return false;}
  }
  const ownsOutput=item=>!item.outputDetached&&getAudio()===item.engine&&item.client?.ownsOutput?.()===true;
  const valid=item=>!disposed&&lease===item&&!item.retiring&&item.epoch===epoch&&getAudio()===item.engine&&sameSelection(item)&&ownsOutput(item);
  function noteCurrent(note) {
    if(notes.get(note.id)!==note||note.released)return false;
    try{return note.isCurrent?.()!==false;}catch{return false;}
  }
  function check(item){if(!valid(item))throw cancelled();}
  function forget(note) {note.released=true;if(notes.get(note.id)===note)notes.delete(note.id);}
  function retire(item) {
    if(!item)return Promise.resolve();
    if(item.retirement)return item.retirement;
    item.retiring=true;emit();
    item.retirement=(async()=>{
      try {
        if(ownsOutput(item))await item.output?.fadeOut();
        if(item.client) {
          try {await item.client.dispose();}catch(error){if(!isAbort(error))throw error;}
        }
        if(ownsOutput(item))item.output?.open();
      } finally {
        // dispose() normally forces a gate to zero. Detach our gain accessor
        // first, after reopening the restored neutral editor route.
        item.outputDetached=true;item.output?.dispose();item.voices.reset();
        if(lease===item)lease=null;
        for(const note of notes.values())if(note.lease===item)forget(note);
        emit();
      }
    })();return item.retirement;
  }
  async function prepare(selected,requestEpoch) {
    if(lease?.ready&&lease.epoch===requestEpoch&&lease.selection.fingerprint===selected.fingerprint&&valid(lease))return lease;
    if(lease)await retire(lease);
    if(disposed||requestEpoch!==epoch||selection()?.fingerprint!==selected.fingerprint)throw cancelled();
    // Validation precedes checkpoint creation or any change to the editor.
    const prepared=preparePsfVoiceCapture(getCapturePayload(),{referenceNote:selected.referenceNote,reverb:selected.reverb});
    const instrument=readSpuInstrument(prepared.instrument),engine=getAudio();
    if(!engine||typeof engine.getPs1Client!=='function')throw new Error('Paused PSF audition needs the existing SPU audio engine');
    const item=lease={engine,epoch:requestEpoch,selection:selected,capture:prepared.capture,instrument,
      client:null,output:null,outputDetached:false,ready:false,retiring:false,retirement:null,
      voices:new SpuRoundRobinVoices(),programmed:new Set(),sample:null};
    emit();
    try {
      item.client=await engine.getPs1Client();
      if(typeof item.client?.ownsOutput!=='function')throw new Error('Paused PSF audition needs an ownership-safe SPU client');
      item.output=createOutput({getContext:()=>ownsOutput(item)?engine.context:null,getGain:()=>ownsOutput(item)?engine.codeFadeNode:null});
      check(item);
      await item.client.reset({clearRam:true});check(item);
      const {adpcm,...options}=instrument.sample;
      item.sample=await item.client.loadADPCM(adpcm,options);check(item);
      if(instrument.noise.enabled) {
        if(typeof item.client._setAuditionNoise!=='function')throw new Error('Paused Noise audition needs the temporary Noise SPU client');
        await item.client._setAuditionNoise(instrument.noise,item.sample.id);check(item);
      }
      await item.client.setReverb(instrument.reverb);check(item);
      item.ready=true;item.output.open();emit();return item;
    } catch(error) {await retire(item);throw error;}
  }
  async function release(item,note) {
    if(!item)return false;
    const channel=item.voices.release(note.id);
    if(channel===null)return false;
    note.gated=false;
    if(ownsOutput(item)) {
      try {await item.client.noteOff(channel);}catch(error){if(!isAbort(error))throw error;}
    }
    return true;
  }
  function noteOn(id,midi,{isCurrent=()=>true}={}) {
    identity(id);
    if(!Number.isInteger(midi)||midi<0||midi>127)throw new RangeError('Audition note must be MIDI 0..127');
    if(typeof isCurrent!=='function')throw new TypeError('Audition isCurrent must be a function');
    if(disposed)return Promise.reject(new Error('Paused PSF audition is disposed'));
    if(notes.has(id))return Promise.reject(new Error('Audition identity is already held'));
    const selected=selection();
    if(!selected)return Promise.reject(new Error('Pause the PSF song with Live enabled to audition its selected voice'));
    const note={id,midi,isCurrent,selection:selected,epoch,lease:null,channel:null,gated:false,released:false};
    notes.set(id,note);lastError='';emit();
    return enqueue(async()=>{
      if(!noteCurrent(note)||note.epoch!==epoch){forget(note);return null;}
      let item=null;
      try {
        item=await prepare(selected,note.epoch);note.lease=item;
        if(!noteCurrent(note)){forget(note);if(!notes.size)await retire(item);return null;}
        check(item);
        const pitch=Math.round(4096*440*2**((midi-69)/12)/item.instrument.sample.baseFrequencyHz);
        if(!item.instrument.noise.enabled&&(pitch<1||pitch>0x3fff)) {
          const error=new RangeError('Frequency is outside PS1 SPU PITCH range');error.noteOnly=true;throw error;
        }
        const allocated=item.voices.allocate(id);note.channel=allocated.channel;
        if(allocated.stolen) {
          const previous=notes.get(allocated.stolen.id);if(previous)forget(previous);
          await item.client.noteOff(allocated.channel);check(item);
        }
        if(!item.programmed.has(note.channel)) {
          await item.client.setPreset(note.channel,{...item.instrument.preset,sample:item.sample});
          item.programmed.add(note.channel);check(item);
        }
        if(!noteCurrent(note)){await release(item,note);forget(note);return null;}
        await item.client.noteOn(note.channel,midi);note.gated=true;
        if(!noteCurrent(note)||!valid(item)){await release(item,note);forget(note);return null;}
        emit();return {channel:note.channel,stolenId:allocated.stolen?.id??null};
      } catch(error) {
        if(item&&!error.noteOnly)await release(item,note);
        forget(note);
        if(item&&!error.noteOnly)await retire(item);
        if(isAbort(error))return null;
        lastError=error?.message??String(error);emit();throw error;
      } finally {emit();}
    });
  }
  function noteOff(id) {
    identity(id);const note=notes.get(id);if(!note)return Promise.resolve(false);
    forget(note);emit();
    return enqueue(()=>release(note.lease,note));
  }
  function allNotesOff() {
    const held=[...notes.values()];for(const note of held)forget(note);emit();
    return enqueue(async()=>{for(const note of held)await release(note.lease,note);});
  }
  function stop() {
    epoch++;lastError='';const item=lease;for(const note of notes.values())forget(note);
    stopping++;emit();
    return enqueue(async()=>{try{await retire(item);}finally{stopping--;emit();}});
  }
  async function dispose(){if(disposed)return tail;disposed=true;await stop();}
  return {read,noteOn,noteOff,allNotesOff,stop,invalidate:stop,dispose};
}

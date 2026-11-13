// SPDX-License-Identifier: BSD-3-Clause
// Temporary hand edits on the very PSG used by the reference VGM. Install last
// and dispose first. No second chip, reset, software envelope or startup tone.
import {createPsgRegisterState} from './synth_song_psg_state.js';

const RATES=['low','medium','high','tone3'];
const copy=value=>JSON.parse(JSON.stringify(value));
const integer=(value,max,label)=>{
  if(!Number.isInteger(value)||value<0||value>max)throw new RangeError(`${label} must be 0..${max}`);
  return value;
};
const channelNumber=value=>integer(value,3,'PSG channel');
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);

/** Validate a whole edit before touching the native PSG. */
export function readSynthPsgSongEdit(value) {
  const channel=channelNumber(value?.channel),changes=value?.changes;
  if(!object(changes))throw new TypeError('Expected PSG edit changes');
  const result={};
  for(const [field,next]of Object.entries(changes)) {
    if(field==='attenuation')integer(next,15,'PSG attenuation');
    else if(field==='period')integer(next,1023,'PSG period');
    else if(field==='noiseType') {if(channel!==3||!['white','periodic'].includes(next))throw new RangeError('Noise type is a Noise-channel setting');}
    else if(field==='noiseRate') {if(channel!==3||!RATES.includes(next))throw new RangeError('Noise clock is a Noise-channel setting');}
    else throw new TypeError(`Unknown PSG hand-edit field: ${field}`);
    result[field]=next;
  }
  return {channel,changes:result};
}

function refreshDerived(snapshot) {
  const noiseType=snapshot.noiseMode&4?'white':'periodic',noiseRate=RATES[snapshot.noiseMode&3];
  snapshot.channels.forEach((voice,channel)=>{
    const period=channel<3?snapshot.periods[channel]:noiseRate==='tone3'?snapshot.periods[2]:[16,32,64][snapshot.noiseMode&3];
    const noiseClockHz=channel===3?snapshot.clockHz/(32*Math.max(1,period)):null;
    const constantOutput=channel<3&&period<=1;
    const frequencyHz=channel===3?(noiseType==='periodic'?noiseClockHz/16:null):constantOutput?null:snapshot.clockHz/(32*period);
    Object.assign(voice,{period,attenuation:snapshot.attenuations[channel],lastAttenuation:snapshot.lastAttenuations[channel],
      active:snapshot.attenuations[channel]<15,noiseType,noiseRate,noiseClockHz,constantOutput,
      frequencyHz,midi:frequencyHz>0?69+12*Math.log2(frequencyHz/440):null});
    Object.assign(voice.preset,{attenuation:voice.attenuation,noiseType,noiseRate});
  });
  return snapshot;
}

/** Only deliberate fields change; Tone 3's physical noise-clock link follows. */
export function patchSynthPsgSongSnapshotEdit(snapshot,value) {
  const edit=readSynthPsgSongEdit(value);
  if(!snapshot?.channels?.[edit.channel])return snapshot;
  const next=copy(snapshot),own=field=>Object.hasOwn(edit.changes,field);
  if(own('noiseType'))next.noiseMode=(next.noiseMode&3)|(edit.changes.noiseType==='white'?4:0);
  if(own('noiseRate'))next.noiseMode=(next.noiseMode&4)|RATES.indexOf(edit.changes.noiseRate);
  if(own('period')) {
    if(edit.channel===3&&(next.noiseMode&3)!==3)throw new RangeError('Fixed noise has no editable Tone 3 period');
    next.periods[edit.channel===3?2:edit.channel]=edit.changes.period;
  }
  if(own('attenuation')) {
    next.attenuations[edit.channel]=edit.changes.attenuation;
    if(edit.changes.attenuation<15)next.lastAttenuations[edit.channel]=edit.changes.attenuation;
  }
  return refreshDerived(next);
}

export function createSynthPsgSongInteraction(engine,{clockHz=3579545}={}) {
  for(const field of ['writePsg','processFrames','reset'])if(typeof engine?.[field]!=='function')throw new TypeError('Expected a reference PSG engine');
  const original={write:engine.writePsg,process:engine.processFrames,reset:engine.reset};
  const decoder=createPsgRegisterState(clockHz),voices=new Map(),slots=Array(4).fill(null),pitchSlots=Array(3).fill(null);
  const edits=new Map(),levels=new Map();
  let sourceLatch=0,generatedFrames=0,pitch=0,disposed=false;
  const open=()=>{if(disposed){const error=new Error('PSG song interaction is disposed');error.name='AbortError';throw error;}};
  const clear=()=>{voices.clear();slots.fill(null);pitchSlots.fill(null);edits.clear();levels.clear();pitch=0;};
  function losePitch(voice) {
    if(!voice)return;
    voice.pitchOwned=false;
    if(voice.pitchChannel!==null&&pitchSlots[voice.pitchChannel]===voice)pitchSlots[voice.pitchChannel]=null;
  }
  function forget(channel) {
    const voice=slots[channel];if(!voice)return;
    losePitch(voice);voices.delete(voice.id);slots[channel]=null;
  }
  const send=value=>{const result=original.write.call(engine,value);decoder.write(value);return result;};
  function write(value) {
    integer(value,255,'PSG byte');
    if(value&128)sourceLatch=(value>>4)&7;
    const current=decoder.snapshot(generatedFrames),channel=sourceLatch>>1;
    let result;
    // Manual writes change the physical latch. The VGM's implicit data-byte
    // destination is a separate cursor: select it only when the next source
    // byte arrives. Restoring Noise eagerly would reset its LFSR a second time.
    if(value&128||current.latched===sourceLatch)result=send(value);
    else if(sourceLatch&1||sourceLatch===6)result=send(0x80|(sourceLatch<<4)|(value&(sourceLatch===6?7:15)));
    else {
      send(0x80|(sourceLatch<<4)|(current.periods[channel]&15));
      result=send(value); // The unchanged low nibble never resets tone phase.
    }
    if(sourceLatch&1) {
      forget(channel);
      const level=levels.get(channel);if(level)level.until=generatedFrames;
    } else if(channel===3)forget(3);
    else {
      forget(channel);
      // Tone 3 supplies Noise's clock, not its gate/volume. Its new pitch must
      // defeat an old wheel reset, while Noise key-up still releases our gate.
      if(channel===2&&current.channels[3].noiseRate==='tone3')losePitch(slots[3]);
    }
    return result;
  }
  function process(frames) {const result=original.process.call(this,frames);generatedFrames+=frames;return result;}
  function reset(...args) {const result=original.reset.apply(this,args);decoder.reset();generatedFrames=sourceLatch=0;clear();return result;}
  engine.writePsg=write;engine.processFrames=process;engine.reset=reset;

  const selectedLevel=channel=>{const item=levels.get(channel);return item?.until===Infinity?item.value:undefined;};
  function read() {
    const snapshot=decoder.snapshot(generatedFrames);
    return {...snapshot,channels:snapshot.channels.map(voice=>selectedLevel(voice.channel)===undefined?voice:{...voice,selectedAttenuation:selectedLevel(voice.channel)}),
      generatedFrames,sourceLatch,pitch,disposed,pendingDisplayEdits:edits.size,
      voices:[...voices.values()].map(({id,channel,pitchChannel,pitchOwned})=>({id,channel,pitchChannel,pitchOwned}))};
  }
  function description(channel) {
    open();channelNumber(channel);const voice=decoder.snapshot().channels[channel];
    const attenuation=selectedLevel(channel)??(voice.attenuation<15?voice.attenuation:voice.lastAttenuation<15?voice.lastAttenuation:6);
    return {playable:true,reason:'',channel,source:voice.source,attenuation,noiseType:voice.noiseType,noiseRate:voice.noiseRate};
  }
  function record(values) {
    for(const edit of values)for(const [field,value]of Object.entries(edit.changes))edits.set(`${edit.channel}:${field}`,
      {frame:generatedFrames,edit:{channel:edit.channel,changes:{[field]:value}}});
  }
  function setPeriod(channel,period) {
    send(0x80|(channel<<5)|(period&15));send(period>>4);
  }
  function invalidatePitch(channel) {losePitch(pitchSlots[channel]);}
  function applyEdit(value) {
    open();const edit=readSynthPsgSongEdit(value),next=edit.changes,own=field=>Object.hasOwn(next,field),head=decoder.snapshot();
    if(!Object.keys(next).length)return false;
    const noiseRate=next.noiseRate??head.channels[3].noiseRate;
    if(edit.channel===3&&own('period')&&noiseRate!=='tone3')throw new RangeError('Fixed noise has no editable Tone 3 period');
    const normalized=[];
    if(own('noiseType')||own('noiseRate')) {
      send(0xe0|((next.noiseType??head.channels[3].noiseType)==='white'?4:0)|RATES.indexOf(noiseRate));
      const held=slots[3];
      if(held&&own('noiseRate')) {
        losePitch(held);held.pitchChannel=noiseRate==='tone3'?2:null;
        // Choosing a physical clock source changes only this register. Do not
        // replace Tone3's current period with a stale keyboard pitch. A fresh
        // manual key may claim that shared frequency on its next Note On.
      }
    }
    const changes={...next};
    if(own('period')) {
      const target=edit.channel===3?2:edit.channel;invalidatePitch(target);setPeriod(target,next.period);
      if(edit.channel===3){delete changes.period;normalized.push({channel:2,changes:{period:next.period}});}
    }
    if(own('attenuation')) {
      send(0x90|(edit.channel<<5)|next.attenuation);
      levels.set(edit.channel,{value:next.attenuation,frame:generatedFrames,until:Infinity});
    }
    if(Object.keys(changes).length)normalized.push({channel:edit.channel,changes});
    record(normalized);return {...read(),edit,edits:normalized};
  }
  function applyPreset(channel,value) {
    open();channelNumber(channel);const settings=value?.settings??value;
    if(!object(settings))throw new TypeError('Expected PSG preset settings');
    const changes={};
    for(const field of ['attenuation','period',...(channel===3?['noiseType','noiseRate']:[])])if(settings[field]!==undefined)changes[field]=settings[field];
    const edit=readSynthPsgSongEdit({channel,changes}),head=decoder.snapshot().channels[channel];
    if(Object.hasOwn(changes,'period')&&channel===3&&(changes.noiseRate??head.noiseRate)!=='tone3')throw new RangeError('Fixed noise has no editable Tone 3 period');
    const attenuation=changes.attenuation,idle=head.attenuation===15&&attenuation!==undefined;
    if(idle)delete edit.changes.attenuation;
    const result=applyEdit(edit);
    if(idle)levels.set(channel,{value:attenuation,frame:generatedFrames,until:Infinity});
    return result?{...result,...read()}:idle?{...read(),edit,edits:[edit]}:false;
  }
  function claimPitch(voice) {
    if(voice.pitchChannel===null)return;
    losePitch(pitchSlots[voice.pitchChannel]);pitchSlots[voice.pitchChannel]=voice;voice.pitchOwned=true;
  }
  function updateFrequency(voice,semitones) {
    const hz=voice.fnum*voice.pitchClock*2**(voice.block-1)/(144*2**20)*2**(semitones/12);
    const period=Math.max(2,Math.min(1023,Math.round(clockHz/(32*hz))));
    setPeriod(voice.pitchChannel,period);return period;
  }
  function noteOn(id,note,{channel,pitchClock=7670454}={}) {
    open();channelNumber(channel);
    if(typeof id!=='string'||!id.length||id.length>128)throw new TypeError('Expected a keyboard identity of 1–128 characters');
    if(voices.has(id))throw new Error('Keyboard identity is already active');
    if(!object(note))throw new TypeError('PSG keyboard needs a block/fnum pitch');
    const block=integer(note.block,7,'Keyboard block'),fnum=integer(note.fnum,2047,'Keyboard fnum');
    if(!fnum||!Number.isFinite(pitchClock)||pitchClock<=0)throw new RangeError('PSG keyboard needs a positive pitch and clock');
    const settings=description(channel),previous=slots[channel];forget(channel);
    const voice={id,channel,block,fnum,pitchClock,pitchChannel:channel<3?channel:settings.noiseRate==='tone3'?2:null,pitchOwned:false};
    claimPitch(voice);const period=voice.pitchChannel===null?null:updateFrequency(voice,pitch);
    if(channel===3)send(0xe0|(settings.noiseType==='white'?4:0)|RATES.indexOf(settings.noiseRate));
    send(0x90|(channel<<5)|settings.attenuation);
    voices.set(id,voice);slots[channel]=voice;
    return {id,channel,period,attenuation:settings.attenuation,stolenId:previous?.id??null};
  }
  function noteOff(id) {
    open();const voice=voices.get(id);if(!voice||slots[voice.channel]!==voice)return false;
    send(0x90|(voice.channel<<5)|15);forget(voice.channel);return true;
  }
  function forgetKeyboard(id) {open();const voice=voices.get(id);if(!voice)return false;forget(voice.channel);return true;}
  function retuneKeyboard(id,note,{pitchClock=7670454}={}) {
    open();const block=integer(note?.block,7,'Keyboard block'),fnum=integer(note?.fnum,2047,'Keyboard fnum');
    if(!fnum||!Number.isFinite(pitchClock)||pitchClock<=0)throw new RangeError('PSG keyboard needs a positive pitch and clock');
    const voice=voices.get(id);if(!voice||slots[voice.channel]!==voice||!voice.pitchOwned||pitchSlots[voice.pitchChannel]!==voice)return false;
    Object.assign(voice,{block,fnum,pitchClock});return updateFrequency(voice,0);
  }
  function releaseKeyboard() {open();const ids=[...voices.keys()];for(const id of ids)noteOff(id);pitch=0;return ids.length?{...read(),released:ids}:false;}
  function setPitch(value) {
    open();if(!Number.isFinite(value)||value< -24||value>24)throw new RangeError('Keyboard Pitch must be -24..24 semitones');
    for(const voice of voices.values())if(voice.pitchOwned&&pitchSlots[voice.pitchChannel]===voice)updateFrequency(voice,value);
    pitch=value;return read();
  }
  function readSnapshot(snapshot,consumedFrame=0,{frozen=false}={}) {
    open();if(!snapshot)return snapshot;
    const changes=new Map();
    for(const pending of edits.values())if(frozen?pending.frame>=(snapshot.frame??0):pending.frame>consumedFrame) {
      if(!changes.has(pending.edit.channel))changes.set(pending.edit.channel,{});
      Object.assign(changes.get(pending.edit.channel),pending.edit.changes);
    }
    let next=snapshot;
    // Apply noise mode before its derived Tone3 period, independent of edit
    // insertion order. A frozen fixed clock may have just been changed by hand.
    const ordered=[...changes].sort(([a],[b])=>b-a);
    for(const [channel,fields]of ordered)next=patchSynthPsgSongSnapshotEdit(next,{channel,changes:fields});
    for(const [channel,level]of levels)if(frozen?level.frame>=(snapshot.frame??0):consumedFrame<level.until) {
      if(next===snapshot)next=copy(snapshot);
      next.channels[channel].selectedAttenuation=level.value;
    }
    return next;
  }
  function saveState() {open();return {version:1,generatedFrames,sourceLatch,decoder:decoder.saveState()};}
  function loadState(value) {
    open();if(value?.version!==1)throw new TypeError('Invalid PSG interaction state');
    const frames=integer(value.generatedFrames,Number.MAX_SAFE_INTEGER,'PSG generated frames'),latch=integer(value.sourceLatch,7,'PSG source latch');
    decoder.loadState(value.decoder);generatedFrames=frames;sourceLatch=latch;clear();
  }
  function dispose() {
    if(disposed)return;disposed=true;clear();
    if(engine.writePsg===write)engine.writePsg=original.write;
    if(engine.processFrames===process)engine.processFrames=original.process;
    if(engine.reset===reset)engine.reset=original.reset;
  }
  return {applyEdit,applyPreset,noteOn,noteOff,forgetKeyboard,retuneKeyboard,releaseKeyboard,setPitch,read,readSnapshot,description,describe:description,
    saveState,loadState,dispose,get generatedFrames(){return generatedFrames;}};
}

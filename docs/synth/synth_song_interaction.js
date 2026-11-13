// SPDX-License-Identifier: BSD-3-Clause
// Temporary hand edits on the reference YM2612, not a second keyboard chip.
// Install after output mixing and the written-register timelines; dispose first.
import {createYm2612RegisterState} from './synth_song_state.js';
import {describeSynthSongVoice, setSynthSongVoiceFrequency} from './synth_song_voice.js';
import {midiToOpnPitch} from '../js/soundchip_pitch.js';

const SLOT = [0, 8, 4, 12], KEY_CHANNEL = [0, 1, 2, 4, 5, 6];
const OP_FIELDS = {
  dt:[0x30,0x70,4,7], multi:[0x30,0x0f,0,15], tl:[0x40,0x7f,0,127],
  rs:[0x50,0xc0,6,3], ar:[0x50,0x1f,0,31], am:[0x60,0x80,7,'boolean'],
  d1r:[0x60,0x1f,0,31], d2r:[0x70,0x1f,0,31], sl:[0x80,0xf0,4,15],
  rr:[0x80,0x0f,0,15], ssg:[0x90,0x0f,0,15],
};
const COMMON_FIELDS = {
  algorithm:[0xb0,7,0,7], feedback:[0xb0,0x38,3,7],
  ams:[0xb4,0x30,4,3], pms:[0xb4,7,0,7],
  'pan.left':[0xb4,0x80,7,'boolean'], 'pan.right':[0xb4,0x40,6,'boolean'],
  'lfo.enabled':[0x22,8,3,'boolean'], 'lfo.frequency':[0x22,7,0,7],
};
function integer(value, max, label) {
  if (!Number.isInteger(value) || value < 0 || value > max) throw new RangeError(`${label} must be 0..${max}`);
  return value;
}
const channelNumber = value => integer(value, 5, 'YM2612 channel');
const copy = value => JSON.parse(JSON.stringify(value));
const fieldInfo = path => {
  if (COMMON_FIELDS[path]) return {info:COMMON_FIELDS[path]};
  if (path === 'keyMask') return {key:true,info:[0x28,0xf0,4,15]};
  const gate = /^gates\.([1-4])$/.exec(path);
  if (gate) return {key:true,gate:Number(gate[1])-1,info:[0x28,0xf0,4,'boolean']};
  const match = /^operators\.([1-4])\.(\w+)$/.exec(path);
  if (match && OP_FIELDS[match[2]]) return {operator:Number(match[1])-1,info:OP_FIELDS[match[2]]};
  throw new TypeError(`Unknown YM2612 hand-edit field: ${path}`);
};

/** Validate every field before any hardware write. Logical operators are 1..4. */
export function readSynthSongEdit(value) {
  const channel = channelNumber(value?.channel), changes = value?.changes;
  if (!changes || typeof changes !== 'object' || Array.isArray(changes)) throw new TypeError('Expected YM2612 edit changes');
  const result = {};
  for (const [path,next] of Object.entries(changes)) {
    const maximum = fieldInfo(path).info[3];
    if (maximum === 'boolean') {if (typeof next !== 'boolean') throw new TypeError(`${path} must be boolean`);}
    else integer(next, maximum, path);
    result[path] = next;
  }
  return {channel,changes:result};
}

/** Patch display fields only. Other channels and untouched packed fields stay put. */
export function patchSynthSongSnapshotEdit(snapshot, value) {
  const edit = readSynthSongEdit(value);
  if (!snapshot?.channels?.[edit.channel]) return snapshot;
  const next = copy(snapshot), voice = next.channels[edit.channel];
  for (const [path,item] of Object.entries(edit.changes)) {
    if (path.startsWith('lfo.')) {
      next.lfo[path.slice(4)] = item;
      for (const channel of next.channels) channel.preset.lfo[path.slice(4)] = item;
    } else if (path.startsWith('gates.')) {
      const bit=1<<(Number(path.slice(6))-1),mask=voice.selectedKeyMask??voice.keyMask??voice.lastKeyMask??15;
      voice.selectedKeyMask=item?mask|bit:mask&~bit;
      if(voice.gate)voice.keyMask=voice.selectedKeyMask;
    } else if (path === 'keyMask') {
      voice.selectedKeyMask=item;
      if(voice.gate){voice.keyMask=item;voice.gate=item!==0;if(item)voice.lastKeyMask=item;}
    } else {
      const parts = path.split('.'); let target = voice.preset;
      for (const part of parts.slice(0,-1)) target = target[part];
      target[parts.at(-1)] = item;
    }
  }
  voice.preset.b4 = (voice.preset.b4 & 8) | (voice.preset.pan.left?128:0) |
    (voice.preset.pan.right?64:0) | (voice.preset.ams<<4) | voice.preset.pms;
  return next;
}

function presetEdit(channel,preset) {
  channelNumber(channel);
  if (!preset || typeof preset !== 'object') throw new TypeError('Expected YM2612 preset');
  const changes = {};
  for (const path of ['algorithm','feedback','ams','pms']) if (preset[path] !== undefined) changes[path] = preset[path];
  for (const part of ['left','right']) if (preset.pan?.[part] !== undefined) changes['pan.'+part] = preset.pan[part];
  for (const part of ['enabled','frequency']) if (preset.lfo?.[part] !== undefined) changes['lfo.'+part] = preset.lfo[part];
  if (preset.keyMask !== undefined) changes.keyMask = preset.keyMask;
  if (preset.operators !== undefined) {
    if (!preset.operators || typeof preset.operators !== 'object') throw new TypeError('Expected YM2612 preset operators');
    const array = Array.isArray(preset.operators) || Object.hasOwn(preset.operators,0);
    for (let index=0;index<4;index++) {
      const operator = preset.operators[array?index:index+1];
      if (operator === undefined) continue;
      if (!operator || typeof operator !== 'object') throw new TypeError('Expected YM2612 operator');
      for (const field of Object.keys(OP_FIELDS)) if (operator[field] !== undefined) changes[`operators.${index+1}.${field}`] = operator[field];
      if (operator.sr !== undefined && operator.d2r === undefined) changes[`operators.${index+1}.d2r`] = operator.sr;
    }
  }
  return readSynthSongEdit({channel,changes});
}

function ratioPitch(source,ratio) {
  let {block,fnum} = source; fnum *= ratio;
  while (fnum > 2047 && block < 7) {fnum /= 2; block++;}
  while (fnum > 0 && fnum < 1024 && block > 0) {fnum *= 2; block--;}
  return {block,fnum:Math.max(0,Math.min(2047,Math.round(fnum)))};
}

export function createSynthSongInteraction(engine,{clockHz=7670454}={}) {
  for (const method of ['writeYm2612','processFrames','reset']) if (typeof engine?.[method] !== 'function') throw new TypeError('Expected a reference YM2612 engine');
  const original = {write:engine.writeYm2612,process:engine.processFrames,reset:engine.reset};
  const decoder = createYm2612RegisterState(clockHz), voices = new Map(), slots = Array(6).fill(null);
  // The latest value per known field bounds memory even while Live is frozen.
  const edits = new Map(), selectedMasks = new Map(), maskDisplay = new Map();
  let generatedFrames=0,pitch=0,disposed=false;
  const open = () => {if(disposed){const error=new Error('YM2612 song interaction is disposed');error.name='AbortError';throw error;}};
  const forget = channel => {const voice=slots[channel];if(voice)voices.delete(voice.id);slots[channel]=null;};
  const clear = () => {voices.clear();slots.fill(null);selectedMasks.clear();maskDisplay.clear();edits.clear();pitch=0;};
  const send = (port,register,value) => {
    const result=original.write.call(engine,port,register,value);
    decoder.write(port,register,value);return result;
  };
  function write(port,register,value) {
    const oldMode=port===0&&register===0x27?decoder.snapshot().modeRegister:0;
    const result=original.write.call(this,port,register,value);
    if(disposed)return result;
    decoder.write(port,register,value);
    if(port===0&&register===0x28&&(value&3)!==3) {
      const channel=(value&3)+(value&4?3:0);forget(channel);selectedMasks.delete(channel);
      const display=maskDisplay.get(channel);if(display)display.until=generatedFrames;
    } else if(port===0&&register===0x2b&&value&128) forget(5);
    else if(port===0&&register===0x27) {
      if(value&128)forget(2); // CSM now supplies CH3's envelope triggers.
      else if((oldMode^value)&0x40&&slots[2])slots[2].pitchOwned=false;
      // Timer start/acknowledge writes with unchanged channel mode do not take
      // ownership of a manual gate. Its physical key-up must still reach CH3.
    }
    // A subsequent VGM pitch commit owns that pitch. Releasing an old wheel
    // must not silently restore a keyboard pitch over it.
    if(register>=0xa0&&register<=0xa2) {const voice=slots[port*3+register-0xa0];if(voice)voice.pitchOwned=false;}
    if(port===0&&register>=0xa8&&register<=0xaa&&slots[2])slots[2].pitchOwned=false;
    return result;
  }
  function process(frames) {const result=original.process.call(this,frames);generatedFrames+=frames;return result;}
  function reset(...args) {const result=original.reset.apply(this,args);decoder.reset();generatedFrames=0;clear();return result;}
  engine.writeYm2612=write;engine.processFrames=process;engine.reset=reset;

  function read() {
    const snapshot=decoder.snapshot(generatedFrames);
    return {...snapshot,channels:snapshot.channels.map(voice=>selectedMasks.has(voice.channel)?{...voice,selectedKeyMask:selectedMasks.get(voice.channel)}:voice),generatedFrames,pitch,disposed,
      voices:[...voices.values()].map(({id,channel,midi,pitchOwned})=>({id,channel,midi,pitchOwned})),pendingDisplayEdits:edits.size};
  }
  function description(channel) {
    open();channelNumber(channel);
    const result=describeSynthSongVoice(decoder.snapshot(generatedFrames),channel);
    if(selectedMasks.has(channel))result.keyMask=selectedMasks.get(channel);
    if(!result.keyMask){result.playable=false;result.reason='No operators selected for this channel.';}
    return result;
  }
  function applyEdit(value) {
    open();const edit=readSynthSongEdit(value),bank=decoder.saveState().registers,plan=new Map();
    if(!Object.keys(edit.changes).length)return false;
    const current=decoder.snapshot(generatedFrames).channels[edit.channel];
    let nextMask=selectedMasks.get(edit.channel)??(current.keyMask||current.lastKeyMask||15),hasMask=false;
    for(const [path,next] of Object.entries(edit.changes)) {
      const {operator,info,key,gate}=fieldInfo(path),[base,mask,shift]=info;
      if(key){hasMask=true;nextMask=gate===undefined?next:next?nextMask|(1<<gate):nextMask&~(1<<gate);continue;}
      const port=path.startsWith('lfo.')||key?0:edit.channel>=3?1:0;
      const register=base+(path.startsWith('lfo.')||key?0:edit.channel%3+(operator===undefined?0:SLOT[operator]));
      const id=port+':'+register,previous=plan.get(id)?.value??bank[port][register];
      const value=(previous&~mask)|(Number(next)<<shift);
      plan.set(id,{port,register,value});
    }
    for(const item of plan.values())send(item.port,item.register,item.value);
    if(hasMask){
      selectedMasks.set(edit.channel,nextMask);
      maskDisplay.set(edit.channel,{mask:nextMask,frame:generatedFrames,until:Infinity});
      if(current.gate)send(0,0x28,(nextMask<<4)|KEY_CHANNEL[edit.channel]);
      delete edit.changes.keyMask;
      for(const path of Object.keys(edit.changes))if(path.startsWith('gates.'))delete edit.changes[path];
      edit.changes.keyMask=nextMask;
    }
    for(const [path,value]of Object.entries(edit.changes))edits.set(path.startsWith('lfo.')?path:`${edit.channel}:${path}`,
      {frame:generatedFrames,edit:{channel:edit.channel,changes:{[path]:value}}});
    return {...read(),edit,edits:[edit]};
  }
  function applyPreset(channel,preset) {return applyEdit(presetEdit(channel,preset));}
  function setFrequency(channel,block,fnum) {
    const port=channel>=3?1:0,offset=channel%3;
    send(port,0xa4+offset,(block<<3)|(fnum>>8));send(port,0xa0+offset,fnum&255);
  }
  const frequencyAdapter={setFrequency,setChannel3SpecialFrequency(operator,block,fnum){
    const low=[0xa9,0xaa,0xa8,0xa2][operator];
    send(0,low+4,(block<<3)|(fnum>>8));send(0,low,fnum&255);
  }};
  function voicePitch(voice,semitones) {
    return voice.rawPitch?ratioPitch(voice.rawPitch,2**((semitones-voice.pitchAtStart)/12)):midiToOpnPitch(voice.midi+semitones,clockHz);
  }
  function updateFrequency(voice,semitones) {
    const next=voicePitch(voice,semitones);
    setSynthSongVoiceFrequency(frequencyAdapter,voice.channel,next.block,next.fnum,voice.specialFrequencies);
  }
  function noteOn(id,note,{channel}={}) {
    open();channelNumber(channel);
    if(typeof id!=='string'||!id.length||id.length>128)throw new TypeError('Expected a keyboard identity of 1–128 characters');
    if(voices.has(id))throw new Error('Keyboard identity is already active');
    let rawPitch=null,midi=null;
    if(note&&typeof note==='object')rawPitch={block:integer(note.block,7,'YM2612 block'),fnum:integer(note.fnum,2047,'YM2612 fnum')};
    else midi=integer(note,127,'MIDI note');
    const eligibility=description(channel);if(!eligibility.playable)throw new Error(eligibility.reason);
    const current=decoder.snapshot(generatedFrames).channels[channel],previous=slots[channel];
    const voice={id,channel,midi,rawPitch,pitchAtStart:0,pitchOwned:true,
      specialFrequencies:current.specialMode?current.specialFrequencies:null};
    // Force an edge for a new manual key, keeping the VGM's partial OP mask.
    send(0,0x28,KEY_CHANNEL[channel]);forget(channel);
    updateFrequency(voice,pitch);send(0,0x28,(eligibility.keyMask<<4)|KEY_CHANNEL[channel]);
    voices.set(id,voice);slots[channel]=voice;
    return {id,channel,midi,keyMask:eligibility.keyMask,stolenId:previous?.id??null};
  }
  function noteOff(id) {open();const voice=voices.get(id);if(!voice||slots[voice.channel]!==voice)return false;
    send(0,0x28,KEY_CHANNEL[voice.channel]);forget(voice.channel);return true;}
  function forgetKeyboard(id) {open();const voice=voices.get(id);if(!voice)return false;forget(voice.channel);return true;}
  function retuneKeyboard(id,note) {
    open();const next={block:integer(note?.block,7,'YM2612 block'),fnum:integer(note?.fnum,2047,'YM2612 fnum')};
    const voice=voices.get(id);if(!voice||slots[voice.channel]!==voice||!voice.pitchOwned)return false;
    voice.rawPitch=next;voice.pitchAtStart=0;updateFrequency(voice,0);return next;
  }
  function releaseKeyboard() {open();const ids=[...voices.keys()];for(const id of ids)noteOff(id);pitch=0;return ids.length?{...read(),released:ids}:false;}
  function setPitch(value) {
    open();if(!Number.isFinite(value)||value< -24||value>24)throw new RangeError('Keyboard Pitch must be -24..24 semitones');
    for(const voice of voices.values())if(voice.pitchOwned)updateFrequency(voice,value);
    pitch=value;return read();
  }
  function readSnapshot(snapshot,consumedFrame=0,{frozen=false}={}) {
    open();if(!snapshot)return snapshot;
    // Batch a full preset by channel instead of cloning all six channels once
    // for each of its hundreds of fields on every display update.
    const changes=new Map();
    for(const pending of edits.values())if(frozen?pending.frame>=(snapshot.frame??0):pending.frame>consumedFrame) {
      const {channel}=pending.edit;
      if(!changes.has(channel))changes.set(channel,{});
      Object.assign(changes.get(channel),pending.edit.changes);
    }
    let next=snapshot;
    for(const [channel,fields] of changes)next=patchSynthSongSnapshotEdit(next,{channel,changes:fields});
    for(const [channel,selection]of maskDisplay)if(frozen?selection.frame>=(snapshot.frame??0):consumedFrame<selection.until){
      if(next===snapshot)next=copy(snapshot);
      if(next.channels?.[channel])next.channels[channel].selectedKeyMask=selection.mask;
    }
    return next;
  }
  function saveState() {open();return {version:1,generatedFrames,decoder:decoder.saveState()};}
  function loadState(value) {
    open();if(value?.version!==1||!Number.isSafeInteger(value.generatedFrames)||value.generatedFrames<0)throw new TypeError('Invalid YM2612 interaction state');
    decoder.loadState(value.decoder);generatedFrames=value.generatedFrames;clear();
  }
  function dispose() {
    if(disposed)return;disposed=true;clear();
    if(engine.writeYm2612===write)engine.writeYm2612=original.write;
    if(engine.processFrames===process)engine.processFrames=original.process;
    if(engine.reset===reset)engine.reset=original.reset;
  }
  return {applyEdit,applyPreset,noteOn,noteOff,forgetKeyboard,retuneKeyboard,releaseKeyboard,setPitch,description,describe:description,read,readSnapshot,saveState,loadState,dispose,
    get generatedFrames(){return generatedFrames;}};
}

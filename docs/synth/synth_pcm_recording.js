import {normalizePcmPreset,normalizePcmSettings,PCM_MAX_FRAMES,PCM_SETTINGS_DEFAULTS} from './synth_pcm.js?v=pcm-live-end-1';

export const PCM_RECORDING_FORMAT='tetorica-rf5c164-recording-v1';
export const PCM_RECORDING_MAX_SECONDS=86400;
export const PCM_RECORDING_MAX_COMMANDS=100000;
export const PCM_RECORDING_MAX_JSON_BYTES=16*1024*1024;
export const PCM_RECORDING_MAX_BYTES=PCM_RECORDING_MAX_JSON_BYTES;
export const PCM_RECORDING_MAX_BANKS=512;
const SETTINGS_FIELDS=Object.keys(PCM_SETTINGS_DEFAULTS);
const STOP_RESERVE=8;
const STOP_JSON_RESERVE=2048;
const HEADER_RESERVE=4096;
const clone=value=>structuredClone(value);
const object=(value,label)=>{
  if(!value||typeof value!=='object'||Array.isArray(value)||
    ![Object.prototype,null].includes(Object.getPrototypeOf(value)))throw new TypeError(`Invalid ${label}`);
};
const exact=(value,fields,label)=>{
  object(value,label);
  if(Reflect.ownKeys(value).length!==fields.length||fields.some(key=>!Object.hasOwn(value,key)))throw new TypeError(`Invalid ${label} fields`);
};
const integer=(value,max,label,min=0)=>{
  if(!Number.isInteger(value)||value<min||value>max)throw new RangeError(`${label} must be an integer in range ${min}..${max}`);
  return value;
};
const seconds=(value,label)=>{
  if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>PCM_RECORDING_MAX_SECONDS)throw new RangeError(`${label} must be a finite time in range 0..${PCM_RECORDING_MAX_SECONDS}`);
  return value;
};
const pitchClock=value=>{
  if(typeof value!=='number'||!Number.isFinite(value)||value<=0||value>1000000000)throw new RangeError('Invalid PCM recording pitch clock');
  return value;
};
const framesOf=preset=>preset.sample.data.length/4*3-(preset.sample.data.endsWith('==')?2:preset.sample.data.endsWith('=')?1:0);
// The format helpers also load inside an AudioWorklet, where TextEncoder may
// not exist. Count UTF-8 bytes without allocating another full JSON buffer.
function utf8Bytes(text) {
  let bytes=0;
  for(let index=0;index<text.length;index++) {
    const value=text.charCodeAt(index);
    if(value<128)bytes++;
    else if(value<2048)bytes+=2;
    else if(value>=0xd800&&value<=0xdbff&&index+1<text.length&&text.charCodeAt(index+1)>=0xdc00&&text.charCodeAt(index+1)<=0xdfff) {
      bytes+=4;index++;
    } else bytes+=3;
  }
  return bytes;
}
const jsonBytes=value=>utf8Bytes(JSON.stringify(value,null,2));
// This deliberately overestimates indentation for an entry nested in commands.
// Reserve also covers closing the array, duration digits and eight final key-ups.
const commandBytes=command=>{
  const json=JSON.stringify(command,null,2);
  return utf8Bytes(json)+(json.split('\n').length*4)+2;
};
function initialBudget(initialState) {
  return jsonBytes({format:PCM_RECORDING_FORMAT,version:1,durationSeconds:PCM_RECORDING_MAX_SECONDS,initialState,commands:[]})+HEADER_RESERVE;
}
function checkBudget(bytes) {
  if(bytes>PCM_RECORDING_MAX_JSON_BYTES)throw new RangeError('PCM recording exceeds the 16 MiB JSON budget');
  return bytes;
}
function fullSettings(value,frames) {
  exact(value,SETTINGS_FIELDS,'PCM recording settings');
  return normalizePcmSettings(value,frames);
}

function bankBudget(initialPreset) {
  const samples=new Map();let count=0;
  function check(preset,loopEnd=preset.settings.loopEnd) {
    const sample=preset.sample.data,ends=samples.get(sample);
    if(ends?.has(loopEnd))return ()=>{};
    if(count>=PCM_RECORDING_MAX_BANKS)throw new RangeError(`PCM recording exceeds ${PCM_RECORDING_MAX_BANKS} prepared RAM banks (32 MiB)`);
    return ()=>{
      if(!samples.has(sample))samples.set(sample,new Set());
      samples.get(sample).add(loopEnd);count++;
    };
  }
  check(initialPreset)();return {check};
}
function checkCommandBank(budget,command,currentPreset) {
  return command.type==='setPreset'?budget.check(command.preset):
    command.type==='setSettings'?budget.check(currentPreset,command.settings.loopEnd):()=>{};
}

/** Validate an applied semantic operation; persisted operations also carry time. */
export function normalizePcmRecordingCommand(command,{frames=PCM_MAX_FRAMES}={}) {
  object(command,'PCM recording command');
  integer(frames,PCM_MAX_FRAMES,'PCM recording sample frame count',1);
  const shapes={noteOn:['type','channel','block','fnum'],noteOff:['type','channel'],
    setFrequency:['type','channel','block','fnum'],setSettings:['type','settings'],
    setPreset:['type','preset'],stop:['type']};
  if(!Object.hasOwn(shapes,command.type))throw new Error(`Unknown PCM recording command: ${String(command.type)}`);
  const fields=shapes[command.type],timed=Object.hasOwn(command,'time');
  exact(command,timed?[...fields,'time']:fields,'PCM recording command');
  const next={type:command.type};
  if(timed)next.time=seconds(command.time,'PCM command time');
  if(Object.hasOwn(command,'channel'))next.channel=integer(command.channel,7,'PCM recording channel');
  if(command.type==='noteOn'||command.type==='setFrequency') {
    next.block=integer(command.block,7,'PCM recording block');
    next.fnum=integer(command.fnum,2047,'PCM recording fnum',1);
  }
  if(command.type==='setSettings')next.settings=fullSettings(command.settings,frames);
  if(command.type==='setPreset')next.preset=normalizePcmPreset(command.preset);
  return next;
}

/** Self-contained PCM event stream. Foreign FM/PSG recordings are never coerced. */
export function normalizePcmRecording(value) {
  exact(value,['format','version','durationSeconds','initialState','commands'],'PCM recording');
  if(value.format!==PCM_RECORDING_FORMAT||value.version!==1)throw new Error(`Unsupported PCM recording format or version: ${String(value.format)}`);
  const durationSeconds=seconds(value.durationSeconds,'PCM recording duration');
  exact(value.initialState,['preset','pitchClock'],'PCM recording initial state');
  const initialState={preset:normalizePcmPreset(value.initialState.preset),pitchClock:pitchClock(value.initialState.pitchClock)};
  if(!Array.isArray(value.commands)||value.commands.length>PCM_RECORDING_MAX_COMMANDS)throw new RangeError('Invalid PCM recording command count');
  let currentPreset=initialState.preset,lastTime=0,bytes=checkBudget(initialBudget(initialState));
  const banks=bankBudget(initialState.preset);
  const commands=value.commands.map(command=>{
    if(!Object.hasOwn(command??{},'time'))throw new TypeError('PCM recording commands require time');
    const next=normalizePcmRecordingCommand(command,{frames:framesOf(currentPreset)});
    if(next.time<lastTime||next.time>durationSeconds)throw new Error('PCM recording commands must be ordered and inside the recording duration');
    lastTime=next.time;
    bytes=checkBudget(bytes+commandBytes(next));
    checkCommandBank(banks,next,currentPreset)();
    if(next.type==='setPreset')currentPreset=next.preset;
    else if(next.type==='setSettings')currentPreset={...currentPreset,settings:next.settings};
    return next;
  });
  return {format:PCM_RECORDING_FORMAT,version:1,durationSeconds,initialState,commands};
}

function tracker(initialPreset) {
  let preset=initialPreset;
  const held=new Set();
  return {
    get preset(){return preset;},
    get frames(){return framesOf(preset);},
    get heldChannels(){return [...held].sort((a,b)=>a-b);},
    apply(command) {
      if(command.type==='stop')held.clear();
      else if(command.type==='setPreset'){preset=command.preset;held.clear();}
      else if(command.type==='setSettings') {
        preset={...preset,settings:command.settings};
      } else if(command.type==='noteOn')held.add(command.channel);
      else if(command.type==='noteOff')held.delete(command.channel);
    },
  };
}

/** Host-clock capture; playback uses an independent sample-clock endpoint. */
export class SynthPcmRecordingManager {
  constructor({now=()=>performance.now()/1000,getPreset,getPitchClock=()=>7670454,onChange=()=>{},onPlaybackStopped=()=>{},
    startPlayback=async()=>{},stopPlayback=()=>{}}={}) {
    for(const [label,value]of Object.entries({now,getPreset,getPitchClock,onChange,onPlaybackStopped,startPlayback,stopPlayback})) {
      if(typeof value!=='function')throw new TypeError(`PCM recording ${label} must be a function`);
    }
    Object.assign(this,{now,getPreset,getPitchClock,onChange,onPlaybackStopped,startPlayback,stopPlayback});
    this.recording=false;this.playing=false;this.currentRecording=null;this.lastRecording=null;
    this._recordHasNotes=false;this._lastHasNotes=false;this._bytes=0;this._banks=null;
    this._startedAt=0;this._tracker=null;this._playGeneration=0;this._playController=null;
  }
  _notify(reason){this.onChange({reason,recording:this.recording,playing:this.playing,commandCount:this.commandCount});}
  get commandCount(){return (this.currentRecording??this.lastRecording)?.commands.length??0;}
  get hasNotes(){return this.currentRecording?this._recordHasNotes:this._lastHasNotes;}
  _elapsed() {
    const value=this.now()-this._startedAt;
    if(!Number.isFinite(value))throw new RangeError('Invalid PCM recording clock');
    return Math.max(0,value,this.currentRecording?.commands.at(-1)?.time??0);
  }
  startRecord() {
    if(this.recording)throw new Error('Stop PCM recording before starting a new take');
    const initialState={preset:normalizePcmPreset(this.getPreset()),pitchClock:pitchClock(this.getPitchClock())};
    const startedAt=this.now();if(!Number.isFinite(startedAt))throw new RangeError('Invalid PCM recording clock');
    const bytes=checkBudget(initialBudget(initialState));
    this.stopRecordingPlayback();
    this._startedAt=startedAt;this._tracker=tracker(initialState.preset);this._bytes=bytes;this._banks=bankBudget(initialState.preset);this.recording=true;
    this._recordHasNotes=false;
    this.currentRecording={format:PCM_RECORDING_FORMAT,version:1,durationSeconds:0,initialState,commands:[]};
    this._notify('record-start');return this.exportRecording();
  }
  recordCommand(command) {
    if(!this.recording||!this.currentRecording||this.playing)return false;
    const normalized=normalizePcmRecordingCommand(command,{frames:this._tracker.frames});
    if(Object.hasOwn(normalized,'time'))throw new TypeError('Live PCM commands cannot supply a recording time');
    const time=seconds(this._elapsed(),'PCM recording time');
    if(this.currentRecording.commands.length>=PCM_RECORDING_MAX_COMMANDS-STOP_RESERVE)throw new RangeError('PCM recording has reached its command limit');
    const timed={time,...normalized},bytes=this._bytes+commandBytes(timed);
    checkBudget(bytes+STOP_JSON_RESERVE);
    const acceptBank=checkCommandBank(this._banks,normalized,this._tracker.preset);
    acceptBank();
    this.currentRecording.commands.push(timed);this._bytes=bytes;this._tracker.apply(normalized);
    if(normalized.type==='noteOn')this._recordHasNotes=true;
    this._notify('record-command');return true;
  }
  stopRecord() {
    if(!this.recording||!this.currentRecording)return this.exportRecording();
    const durationSeconds=Math.min(PCM_RECORDING_MAX_SECONDS,this._elapsed());
    for(const channel of this._tracker.heldChannels) {
      const command={time:durationSeconds,type:'noteOff',channel};
      this.currentRecording.commands.push(command);this._tracker.apply(command);
    }
    const selected={...this.currentRecording,durationSeconds};
    if(!this._recordHasNotes)selected.commands=[];
    const normalized=normalizePcmRecording(selected);
    this.lastRecording=normalized;this.currentRecording=null;this._tracker=null;this._banks=null;this.recording=false;
    this._lastHasNotes=this._recordHasNotes;this._recordHasNotes=false;this._bytes=0;
    this._notify('record-stop');return clone(normalized);
  }
  exportRecording() {
    if(this.currentRecording)return clone({...this.currentRecording,durationSeconds:Math.min(PCM_RECORDING_MAX_SECONDS,this._elapsed())});
    return this.lastRecording?clone(this.lastRecording):null;
  }
  importRecording(recording) {
    const normalized=normalizePcmRecording(recording);
    if(this.recording)throw new Error('Stop PCM recording before importing a take');
    this.lastRecording=normalized;this._lastHasNotes=normalized.commands.some(command=>command.type==='noteOn');
    this._notify('import');return clone(normalized);
  }
  isRecording(){return this.recording;}
  isRecordingPlaybackActive(){return this.playing;}
  async playRecording(recording=null,options={}) {
    const selected=recording??this.exportRecording();if(!selected)return null;
    const normalized=normalizePcmRecording(selected);
    object(options,'PCM playback options');
    for(const key of ['loop','ignorePatch'])if(options[key]!==undefined&&typeof options[key]!=='boolean')throw new TypeError(`PCM playback ${key} must be a boolean`);
    if(this.recording)throw new Error('Stop PCM recording before playback');
    if(!normalized.commands.some(command=>command.type==='noteOn'))return null;
    const ignorePatch=options.ignorePatch===true,loop=options.loop===true;
    const playbackPreset=ignorePatch?normalizePcmPreset(this.getPreset()):clone(normalized.initialState.preset);
    const playbackClock=ignorePatch?pitchClock(this.getPitchClock()):normalized.initialState.pitchClock;
    this.stopRecordingPlayback();
    const generation=++this._playGeneration,controller=new AbortController();
    this._playController=controller;this.playing=true;this._notify('playback-pending');
    const onEnded=()=>{
      if(this._playGeneration!==generation||this._playController!==controller||controller.signal.aborted)return;
      this._playController=null;this.playing=false;this._notify('playback-ended');this.onPlaybackStopped();
    };
    try {
      await this.startPlayback(clone(normalized),{loop,ignorePatch,preset:playbackPreset,pitchClock:playbackClock,signal:controller.signal,onEnded});
      if(this._playGeneration!==generation||controller.signal.aborted||this._playController!==controller)return null;
      this._notify('playback-start');return clone(normalized);
    } catch(error) {
      if(this._playGeneration!==generation||controller.signal.aborted)return null;
      this.stopRecordingPlayback();throw error;
    }
  }
  stopRecordingPlayback() {
    const active=Boolean(this._playController)||this.playing;
    ++this._playGeneration;
    const controller=this._playController;this._playController=null;this.playing=false;
    controller?.abort(new DOMException('PCM event playback cancelled','AbortError'));
    if(active){try{this.stopPlayback();}finally{this._notify('playback-stop');this.onPlaybackStopped();}}
    return active;
  }
}

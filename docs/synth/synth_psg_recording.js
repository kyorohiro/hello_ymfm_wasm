import {normalizePsgPreset,PSG_PRESET_KIND,PSG_PRESET_VERSION} from './synth_psg_preset.js?v=psg-event-rec-1';

export const PSG_RECORDING_FORMAT='tetorica-sega-psg-recording-v1';
export const PSG_RECORDING_MAX_SECONDS=86400;
export const PSG_RECORDING_MAX_COMMANDS=100000;
const MAX_RELEASE_SECONDS=5;
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
  if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>PSG_RECORDING_MAX_SECONDS)throw new RangeError(`${label} must be a finite time in range 0..${PSG_RECORDING_MAX_SECONDS}`);
  return value;
};
const pitchClock=value=>{
  if(typeof value!=='number'||!Number.isFinite(value)||value<=0||value>1000000000)throw new RangeError('Invalid PSG recording pitch clock');
  return value;
};
const settings=value=>normalizePsgPreset({version:PSG_PRESET_VERSION,kind:PSG_PRESET_KIND,settings:value}).settings;

/** Validate an applied semantic command, optionally including its file time. */
export function normalizePsgRecordingCommand(command,{settings:currentSettings=null}={}) {
  object(command,'PSG recording command');
  const shapes={noteOn:['type','channel','block','fnum'],noteOff:['type','channel'],
    setFrequency:['type','channel','block','fnum'],setSettings:['type','settings'],stop:['type']};
  if(!Object.hasOwn(shapes,command.type))throw new Error(`Unknown PSG recording command: ${String(command.type)}`);
  const fields=shapes[command.type];
  const timed=Object.hasOwn(command,'time');
  exact(command,timed?[...fields,'time']:fields,'PSG recording command');
  const next={type:command.type};
  if(timed)next.time=seconds(command.time,'PSG command time');
  if(Object.hasOwn(command,'channel')) {
    next.channel=integer(command.channel,3,'PSG recording channel');
    if(currentSettings&&((currentSettings.source==='tone'&&next.channel===3)||(currentSettings.source==='noise'&&next.channel!==3))) {
      throw new Error('PSG recording channel does not match the selected source');
    }
  }
  if(command.type==='noteOn'||command.type==='setFrequency') {
    next.block=integer(command.block,7,'PSG recording block');
    next.fnum=integer(command.fnum,2047,'PSG recording fnum',1);
  }
  if(command.type==='setSettings')next.settings=settings(command.settings);
  return next;
}

/** A detached, bounded PSG-only event stream. Legacy FM files are not coerced. */
export function normalizePsgRecording(value) {
  exact(value,['format','version','durationSeconds','initialState','commands'],'PSG recording');
  if(value.format!==PSG_RECORDING_FORMAT||value.version!==1)throw new Error(`Unsupported PSG recording format or version: ${String(value.format)}`);
  const durationSeconds=seconds(value.durationSeconds,'PSG recording duration');
  exact(value.initialState,['settings','pitchClock'],'PSG recording initial state');
  const initialState={settings:settings(value.initialState.settings),pitchClock:pitchClock(value.initialState.pitchClock)};
  if(!Array.isArray(value.commands)||value.commands.length>PSG_RECORDING_MAX_COMMANDS)throw new RangeError('Invalid PSG recording command count');
  let currentSettings=initialState.settings,lastTime=0;
  const commands=value.commands.map(command=>{
    if(!Object.hasOwn(command??{},'time'))throw new TypeError('PSG recording commands require time');
    const next=normalizePsgRecordingCommand(command,{settings:currentSettings});
    if(next.time<lastTime||next.time>durationSeconds)throw new Error('PSG recording commands must be ordered and inside the recording duration');
    lastTime=next.time;
    if(next.type==='setSettings')currentSettings=next.settings;
    return next;
  });
  return {format:PSG_RECORDING_FORMAT,version:1,durationSeconds,initialState,commands};
}

function tracker(initialSettings) {
  let current=settings(initialSettings);
  const voices=new Map();
  return {
    get settings(){return current;},
    get heldChannels(){return [...voices].filter(([,voice])=>voice.held).map(([channel])=>channel).sort((a,b)=>a-b);},
    get releaseEnd(){return Math.max(0,...[...voices.values()].map(voice=>voice.releaseEnd??0));},
    apply(command,time) {
      if(command.type==='stop')voices.clear();
      else if(command.type==='setSettings') {
        if(command.settings.source!==current.source||command.settings.envelope.enabled!==current.envelope.enabled)voices.clear();
        current=command.settings;
      } else if(command.type==='noteOn') {
        voices.set(command.channel,{held:true,releaseSeconds:current.envelope.enabled?current.envelope.releaseMs/1000:0,releaseEnd:null});
      } else if(command.type==='noteOff') {
        const voice=voices.get(command.channel);
        if(voice?.held) {
          voice.held=false;voice.releaseEnd=time+voice.releaseSeconds;
          if(!voice.releaseSeconds)voices.delete(command.channel);
        }
      }
    },
  };
}

/** Capture uses the host audio clock; playback belongs to the audio endpoint. */
export class SynthPsgRecordingManager {
  constructor({now=()=>performance.now()/1000,getSettings,getPitchClock=()=>7670454,onChange=()=>{},onPlaybackStopped=()=>{},
    startPlayback=async()=>{},stopPlayback=()=>{}}={}) {
    for(const [label,value] of Object.entries({now,getSettings,getPitchClock,onChange,onPlaybackStopped,startPlayback,stopPlayback})) {
      if(typeof value!=='function')throw new TypeError(`PSG recording ${label} must be a function`);
    }
    Object.assign(this,{now,getSettings,getPitchClock,onChange,onPlaybackStopped,startPlayback,stopPlayback});
    this.recording=false;this.playing=false;this.currentRecording=null;this.lastRecording=null;
    this._recordHasNotes=false;this._lastHasNotes=false;
    this._startedAt=0;this._tracker=null;this._playGeneration=0;this._playController=null;this._playRecording=null;
  }
  _notify(reason) {this.onChange({reason,recording:this.recording,playing:this.playing,commandCount:this.commandCount});}
  get commandCount(){return (this.currentRecording??this.lastRecording)?.commands.length??0;}
  get hasNotes(){return this.currentRecording?this._recordHasNotes:this._lastHasNotes;}
  _elapsed() {
    const value=this.now()-this._startedAt;
    if(!Number.isFinite(value))throw new RangeError('Invalid PSG recording clock');
    return Math.max(0,value,this.currentRecording?.commands.at(-1)?.time??0);
  }
  startRecord() {
    const initialState={settings:settings(this.getSettings()),pitchClock:pitchClock(this.getPitchClock())};
    const startedAt=this.now();if(!Number.isFinite(startedAt))throw new RangeError('Invalid PSG recording clock');
    this.stopRecordingPlayback();
    this._startedAt=startedAt;this._tracker=tracker(initialState.settings);this.recording=true;
    this._recordHasNotes=false;
    this.currentRecording={format:PSG_RECORDING_FORMAT,version:1,durationSeconds:0,initialState,commands:[]};
    this._notify('record-start');return this.exportRecording();
  }
  recordCommand(command) {
    if(!this.recording||!this.currentRecording||this.playing)return false;
    const normalized=normalizePsgRecordingCommand(command,{settings:this._tracker.settings});
    if(Object.hasOwn(normalized,'time'))throw new TypeError('Live PSG commands cannot supply a recording time');
    const time=seconds(this._elapsed(),'PSG recording time');
    if(time>PSG_RECORDING_MAX_SECONDS-MAX_RELEASE_SECONDS)throw new RangeError('PSG recording has reached its duration limit');
    if(this.currentRecording.commands.length>=PSG_RECORDING_MAX_COMMANDS-4)throw new RangeError('PSG recording has reached its command limit');
    this.currentRecording.commands.push({time,...normalized});this._tracker.apply(normalized,time);
    if(normalized.type==='noteOn')this._recordHasNotes=true;
    this._notify('record-command');return true;
  }
  stopRecord() {
    if(!this.recording||!this.currentRecording)return this.exportRecording();
    const elapsed=Math.min(PSG_RECORDING_MAX_SECONDS-MAX_RELEASE_SECONDS,this._elapsed());
    for(const channel of this._tracker.heldChannels) {
      const command={time:elapsed,type:'noteOff',channel};
      this.currentRecording.commands.push(command);this._tracker.apply(command,elapsed);
    }
    // A software release is sample-clock work after key-up. Leave that tail in
    // the take instead of cutting it off or leaking it into the next loop.
    const durationSeconds=Math.max(elapsed,this._tracker.releaseEnd);
    const selected={...this.currentRecording,durationSeconds};
    if(!this._recordHasNotes)selected.commands=[];
    const normalized=normalizePsgRecording(selected);
    this.lastRecording=normalized;this.currentRecording=null;this._tracker=null;this.recording=false;
    this._lastHasNotes=this._recordHasNotes;this._recordHasNotes=false;
    this._notify('record-stop');return clone(normalized);
  }
  exportRecording() {
    if(this.currentRecording)return clone({...this.currentRecording,durationSeconds:Math.min(PSG_RECORDING_MAX_SECONDS,this._elapsed())});
    return this.lastRecording?clone(this.lastRecording):null;
  }
  importRecording(recording) {
    const normalized=normalizePsgRecording(recording);
    if(this.recording)throw new Error('Stop PSG recording before importing a take');
    this.lastRecording=normalized;this._lastHasNotes=normalized.commands.some(command=>command.type==='noteOn');
    this._notify('import');return clone(normalized);
  }
  isRecording(){return this.recording;}
  isRecordingPlaybackActive(){return this.playing;}
  async playRecording(recording=null,options={}) {
    const selected=recording??this.exportRecording();if(!selected)return null;
    const normalized=normalizePsgRecording(selected);
    object(options,'PSG playback options');
    for(const key of ['loop','ignorePatch'])if(options[key]!==undefined&&typeof options[key]!=='boolean')throw new TypeError(`PSG playback ${key} must be a boolean`);
    if(this.recording)throw new Error('Stop PSG recording before playback');
    if(!normalized.commands.some(command=>command.type==='noteOn'))return null;
    const ignorePatch=options.ignorePatch===true,loop=options.loop===true;
    const playbackSettings=ignorePatch?settings(this.getSettings()):clone(normalized.initialState.settings);
    const playbackClock=ignorePatch?pitchClock(this.getPitchClock()):normalized.initialState.pitchClock;
    this.stopRecordingPlayback();
    const generation=++this._playGeneration,controller=new AbortController();
    this._playController=controller;this._playRecording=normalized;this.playing=true;this._notify('playback-pending');
    const onEnded=()=>{
      if(this._playGeneration!==generation||this._playController!==controller||controller.signal.aborted)return;
      this._playController=null;this._playRecording=null;this.playing=false;
      this._notify('playback-ended');this.onPlaybackStopped();
    };
    try {
      await this.startPlayback(clone(normalized),{loop,ignorePatch,settings:playbackSettings,pitchClock:playbackClock,signal:controller.signal,onEnded});
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
    const controller=this._playController;this._playController=null;this._playRecording=null;this.playing=false;
    controller?.abort(new DOMException('PSG event playback cancelled','AbortError'));
    if(active) {
      try {this.stopPlayback();}finally{this._notify('playback-stop');this.onPlaybackStopped();}
    }
    return active;
  }
}

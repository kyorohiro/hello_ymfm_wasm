import {MegaSynthLooper} from '../js/looper.js';
import {normalizeCapturedVoice} from './synth_performance.js?v=op-gates-1';

const CHANNELS=[0,1,2,3,4,5];
const CANCEL_CAPTURE=Symbol('cancelled Synth loop capture');
const clone=value=>value==null?value:structuredClone(value);
const voiceFor=(event,patch)=>normalizeCapturedVoice(Object.hasOwn(event,'capturedVoice')?event.capturedVoice:patch?.capturedVoice);

/** Program a loop's patch without clearing another channel's special mode. */
export function applySynthLooperPatch(synth,patch,channel) {
  if(!synth||!patch)return;
  const voice=normalizeCapturedVoice(patch.capturedVoice);
  synth.setLfo(patch.lfoEnabled??false,patch.lfoFrequency??0);
  synth.setDacEnabled(patch.dacEnabled??false);
  if(channel===2) {
    synth.setChannel3SpecialMode(Boolean(voice?.specialMode));
    if(voice?.specialMode)voice.specialFrequencies.forEach((pitch,operator)=>
      synth.setChannel3SpecialFrequency(operator,pitch.block,pitch.fnum));
  }
  for(let operator=0;operator<4;operator++) {
    const params=patch.operators?.[operator];
    if(params)synth.setOperator(channel,operator,{...params,am:params.am===true});
  }
  synth.setAlgo(channel,patch.algorithm??7,patch.feedback??0);
  synth.setPan(channel,patch.pan?.left??true,patch.pan?.right??true,patch.ams??0,patch.pms??0);
}

/**
 * Synth-specific performance metadata on the existing lightweight looper.
 * PCM layers retain their own sound. The event fallback reserves the physical
 * CH3 for special-mode notes and never remaps those notes to ordinary voices.
 */
export class SynthLooper extends MegaSynthLooper {
  constructor(options={}) {
    super(options);
    this._epoch=0;
    this._starting=null;
    this._recordStarting=null;
    this._finishing=null;
    this._stopping=null;
    this._liveNotes=new Map();
    this._playbackOwners=new Map();
    this._mapUnits=new WeakMap();
    const startCapture=this.startAudioCapture;
    this.startAudioCapture=async()=>{
      if(!this.running)throw CANCEL_CAPTURE;
      const epoch=this._epoch;
      try {await startCapture();}
      catch(error) {await this.stopAudioCapture();throw error;}
      if(epoch!==this._epoch||!this.running) {
        await this.stopAudioCapture();
        throw CANCEL_CAPTURE;
      }
    };
  }

  async start() {
    if(this._stopping)await this._stopping;
    if(this.running)return this;
    if(this._starting)return this._starting;
    const epoch=this._epoch;
    const task=Promise.resolve().then(async()=>{
      if(typeof this.synth.start==='function')await this.synth.start();
      if(epoch!==this._epoch)return this;
      this.running=true;
      this.startedAt=this.now();
      if(this.loopLength!==null&&this.units.length) {
        this.loopStartedAt=this.startedAt;
        this._scheduleLoopCycle(this.loopStartedAt);
      }
      this._notifyStateChange('start');
      return this;
    });
    this._starting=task;
    try{return await task;}
    finally {if(this._starting===task)this._starting=null;}
  }

  async startRecording() {
    if(!this.running)throw new Error('MegaSynthLooper must be started before recording');
    const epoch=this._epoch;
    if(this._finishing)await this._finishing;
    if(epoch!==this._epoch||!this.running)return null;
    if(this.recording)return this.currentUnit;
    if(this._recordStarting)return this._recordStarting;
    const startedAt=this.now();
    const unit={id:`unit-${this.units.length+1}`,startedAt,
      startedLoopTime:this.loopLength===null?0:this._getLoopPosition(startedAt),
      patch:this._clonePatch(this.getPatch()),events:[]};
    normalizeCapturedVoice(unit.patch?.capturedVoice);
    this.currentUnit=unit;
    const task=Promise.resolve().then(async()=>{
      await this.startAudioCapture();
      if(epoch!==this._epoch||!this.running||this.currentUnit!==unit) {
        await this.stopAudioCapture();
        return null;
      }
      this.recording=true;
      this.armed=false;
      this._clearArmTimer();
      this._scheduleRecordStopTimer();
      this._notifyStateChange('record-start');
      return unit;
    }).catch(error=>{if(error===CANCEL_CAPTURE)return null;throw error;});
    this._recordStarting=task;
    try{return await task;}
    catch(error) {if(this.currentUnit===unit)this.currentUnit=null;throw error;}
    finally {if(this._recordStarting===task)this._recordStarting=null;}
  }

  async finishRecording(options={}) {
    if(this._finishing)return this._finishing;
    if(!this.recording||!this.currentUnit)return null;
    const task=super.finishRecording(options).catch(error=>{if(error===CANCEL_CAPTURE)return null;throw error;});
    this._finishing=task;
    try{return await task;}
    finally {if(this._finishing===task)this._finishing=null;}
  }

  stop() {
    if(this._stopping)return this._stopping;
    ++this._epoch;
    this._starting=null;
    // Stop scheduling synchronously, including while capture is preparing or
    // a finished take is still being converted to an AudioBuffer.
    this.running=false;
    this.armed=false;
    this._clearScheduledTimers();
    this._clearRecordStopTimer();
    this._clearArmTimer();
    this.stopAudioPlayback();
    this._allNotesOff();
    const finishing=this.recording?this.finishRecording():this._finishing;
    if(!this.recording)this.currentUnit=null;
    const tasks=[this._recordStarting,finishing].filter(Boolean);
    const task=Promise.resolve().then(async()=>{
      try {await Promise.all(tasks);}
      finally {
        this.running=this.recording=this.armed=false;
        this.startedAt=this.loopStartedAt=null;
        this.currentUnit=null;
        this._clearScheduledTimers();this._clearRecordStopTimer();this._clearArmTimer();
        this.stopAudioPlayback();this._allNotesOff();
        this._notifyStateChange('stop');
      }
    });
    this._stopping=task;
    task.then(()=>{if(this._stopping===task)this._stopping=null;},()=>{if(this._stopping===task)this._stopping=null;});
    return task;
  }

  async undo() {
    if(this._recordStarting) {
      const id=this.currentUnit?.id??null,task=this._recordStarting;
      ++this._epoch;this.currentUnit=null;
      await task;
      this._notifyStateChange('record-cancel',{unit:id?{id}:null});
      return {type:'record-cancel',id};
    }
    const epoch=this._epoch;
    if(this._finishing)await this._finishing;
    if(epoch!==this._epoch)return null;
    const result=await super.undo();
    if(result)for(const [channel,owner] of this._playbackOwners)if(owner.unit===result) {
      this.playbackTarget.noteOff(channel,null);
      this._playbackOwners.delete(channel);this._activeChannels.delete(channel);
    }
    return result;
  }

  getUnits() {
    return super.getUnits().map(unit=>({...unit,events:unit.events.map(clone)}));
  }

  /** Change a held note's OP gates without restarting its pitch or envelopes. */
  setKeyMask(channel,voiceOverride) {
    this._dispatchPerformanceEvent({type:'keyMask',channel,
      ...(voiceOverride!==undefined?{capturedVoice:voiceOverride}:{})},true);
  }

  _dispatchPerformanceEvent(event,shouldRecord,patch=null,playbackChannelMap=null) {
    const target=shouldRecord?this.liveTarget:this.playbackTarget;
    const sourcePatch=shouldRecord?this.getPatch():patch;
    let voice=voiceFor(event,sourcePatch);
    const live=this._liveNotes.get(event.channel);
    if(shouldRecord&&event.type==='noteOff'&&live)voice=live.voice;
    // A silent (all-Off) mask is still a held note. Keep its ownership so a
    // later mask can open its gates without another key press.
    if(event.type==='keyMask'&&shouldRecord&&!live)return;
    const channel=event.type==='keyMask'&&shouldRecord?live.channel:voice?.specialMode?2:shouldRecord?event.channel:
      this._resolvePlaybackChannel(event.channel,playbackChannelMap);
    const unit=this._mapUnits.get(playbackChannelMap)??playbackChannelMap;
    const owner=this._playbackOwners.get(channel);
    if((event.type==='noteOff'||event.type==='keyMask')&&!shouldRecord&&
      (!owner||owner.unit!==unit||owner.source!==event.channel))return;
    if(event.type==='noteOn') {
      if(!shouldRecord&&patch)this.applyPatch({...this._clonePatch(patch),capturedVoice:voice},channel,event);
      target.noteOn(channel,event.block,event.fnum,voice);
      if(shouldRecord)this._liveNotes.set(event.channel,{channel,voice});
      else this._playbackOwners.set(channel,{unit,source:event.channel});
      this._activeChannels.add(channel);
    } else if(event.type==='keyMask') {
      target.setKeyMask(channel,voice);
      if(shouldRecord)this._liveNotes.set(event.channel,{...live,voice});
    } else if(event.type==='noteOff') {
      target.noteOff(channel,voice);
      if(shouldRecord)this._liveNotes.delete(event.channel);
      else this._playbackOwners.delete(channel);
      this._activeChannels.delete(channel);
    } else throw new Error(`Unsupported looper event type: ${event.type}`);
    if(shouldRecord)this._recordEvent({...event,channel,
      ...(voice||this.currentUnit?.patch?.capturedVoice||Object.hasOwn(event,'capturedVoice')?{capturedVoice:clone(voice)}:{})});
  }

  _allNotesOff() {
    super._allNotesOff();
    this._liveNotes?.clear();
    this._playbackOwners?.clear();
  }

  _allNotesOffOnTarget(target) {
    if(typeof target?.noteOff!=='function')return;
    // A current special voice maps ordinary noteOff calls onto CH3. Cleanup
    // must instead address all physical channels, including earlier voices.
    for(const channel of CHANNELS)target.noteOff(channel,null);
  }

  _hasSpecialEvents(unit) {
    return !this._unitHasAudio(unit)&&unit.events.some(event=>event.type==='noteOn'&&voiceFor(event,unit.patch)?.specialMode);
  }

  _assignPlaybackChannelMap(unit,usedPlaybackChannels=null) {
    if(!usedPlaybackChannels) {this._rebuildPlaybackChannelMaps();return;}
    const reserved=this.units.some(candidate=>this._hasSpecialEvents(candidate));
    const available=reserved?CHANNELS.filter(channel=>channel!==2):CHANNELS;
    const previous=unit.playbackChannelMap??{},map={};
    for(const source of this._collectUnitChannels(unit)) {
      const notes=unit.events.filter(event=>event.channel===source&&event.type==='noteOn');
      if(notes.length&&notes.every(event=>voiceFor(event,unit.patch)?.specialMode))map[source]=2;
      else if(this._unitHasAudio(unit))map[source]=source;
      else {
        const preferred=available.includes(source)?source:available[0];
        map[source]=!usedPlaybackChannels.has(preferred)?preferred:
          available.find(channel=>!usedPlaybackChannels.has(channel))??preferred;
      }
      if(!this._unitHasAudio(unit))usedPlaybackChannels.add(map[source]);
    }
    // Avoid changing identity/ownership for units whose allocation stayed put.
    const same=JSON.stringify(previous)===JSON.stringify(map);
    unit.playbackChannelMap=same?previous:map;
    this._mapUnits.set(unit.playbackChannelMap,unit);
    if(!same)for(const [channel,owner] of this._playbackOwners)if(owner.unit===unit) {
      this.playbackTarget.noteOff(channel,null);
      this._playbackOwners.delete(channel);this._activeChannels.delete(channel);
    }
  }
}

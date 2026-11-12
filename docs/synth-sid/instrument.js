// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 kyorohiro.
import {SidSynth} from '../js/sidsynth.js?sid-waves=1';
import {SID_PAL_CLOCK,sidFrequency} from '../js/sid.js';
import {createDefaultPreset,readPreset} from './preset.js?sid-waves=1';
import {createChannelSettings,readChannelSettings,applyChannelPreset,editChannelPreset,channelPlaybackPlan} from './channel_settings.js?sid-channels=3&sid-waves=1&sid-keys=1';

const pair=preset=>preset.modulation.sync||preset.modulation.ring;
// Internal settings have already passed the boundary validator. Reuse their
// selected patch while planning register writes instead of revalidating it.
const selected=settings=>settings.channels[settings.target==='round-robin'?0:settings.target];
const topology=settings=>{
  const plan=channelPlaybackPlan(settings);
  return `${settings.target}/${settings.keyboardMode}/${plan.channels.map(channel=>{const preset=settings.channels[channel];return `${channel}:${preset.modulation.sync}/${preset.modulation.ring}/${preset.voice.test}`;}).join(',')}`;
};
const noteHz=midi=>440*2**((midi-69)/12);
const changes=(next,previous)=>Object.fromEntries(Object.entries(next).filter(([key,value])=>!previous||previous[key]!==value));
const codeMethods=new Set(['setNote','setFrequency','noteOn','noteOff','keyOn','keyOff','allNotesOff',
  'setVoice','setFilter','writeRegister','readRegister','getRegisterSnapshot','getState','initialize','reset','setClock']);
const codeCancelled=()=>{const error=new Error('SID Code session was stopped or its instrument changed');error.name='AbortError';return error;};

/** Software key allocation over three physical PAL SID voices. A fixed target
 * edits and plays that channel; Round robin preserves each channel's patch.
 * Sync/Ring use the carrier's physical predecessor as a silent Triangle source,
 * with no hidden voice, added gain or software envelope.
 * Core ownership transfers to this object, including disposal.
 */
export class SidInstrument{
  constructor(core){
    if(!core||typeof core.writeRegister!=='function'||typeof core.reset!=='function'||typeof core.renderInto!=='function'||typeof core.getState!=='function'||typeof core.dispose!=='function')throw new TypeError('Expected a SidCore');
    if(!['6581','8580'].includes(core.model)||core.clockHz!==SID_PAL_CLOCK)throw new RangeError('SID Synth requires model 6581 or 8580 at PAL 985248 Hz');
    this.core=core;this.synth=new SidSynth({core});this.preset=createDefaultPreset({model:core.model});
    this.disposed=false;this.pitch=0;this.cursor=0;this.sequence=0;this.voices=new Map();this.slots=Array(3).fill(null);
    this.codeEpoch=0;this.codeActive=false;this.codeFrames=0;
    this._replace(createChannelSettings(this.preset));
  }
  _open(){if(this.disposed)throw new Error('SID instrument is disposed');}
  _legato(){return this.channelSettings.target!=='round-robin'&&this.channelSettings.keyboardMode==='legato';}
  _channels(){return channelPlaybackPlan(this.channelSettings).channels;}
  _voice(settings,channel,plan){
    const {carrier,source}=plan,preset=settings.channels[carrier];
    if(source===channel)return {waveform:'triangle',pulseWidth:2048,attack:0,decay:0,sustain:0,release:0,test:false,sync:false,ring:false};
    return {...settings.channels[channel].voice,sync:pair(preset)&&channel===carrier&&preset.modulation.sync,ring:pair(preset)&&channel===carrier&&preset.modulation.ring};
  }
  _filter(settings,plan){const preset=selected(settings);return {mode:preset.filter.enabled?preset.filter.mode:'off',cutoff:preset.filter.cutoff,resonance:preset.filter.resonance,
    routing:preset.filter.enabled?plan.channels.reduce((mask,channel)=>mask|1<<channel,0):0,volume:preset.filter.volume,voice3off:plan.source===2};}
  _apply(previous){
    const plan=channelPlaybackPlan(this.channelSettings),previousPlan=previous?channelPlaybackPlan(previous):null;
    for(let channel=0;channel<3;channel++){
      const patch=changes(this._voice(this.channelSettings,channel,plan),previous?this._voice(previous,channel,previousPlan):null);
      if(Object.keys(patch).length)this.synth.setVoice(channel,patch);
    }
    const filter=changes(this._filter(this.channelSettings,plan),previous?this._filter(previous,previousPlan):null);
    if(Object.keys(filter).length)this.synth.setFilter(filter);
  }
  _replace(settings,keepCode=false){
    const preset=selected(settings);
    if(preset.model!==this.core.model)throw new RangeError('SID preset model must match its core; replace the instrument to change model');
    // initialize resets the owned core, including its access queue and software
    // DC history. Reapplying the silent patch preserves authored parameters.
    if(!keepCode){this.codeEpoch++;this.codeActive=false;}
    this.synth.initialize();this.channelSettings=settings;this.preset=preset;this.pitch=0;this.cursor=0;this.sequence=0;this.voices.clear();this.slots.fill(null);this._apply(null);
  }
  _tuning(midi,preset,pitch=this.pitch){
    const carrier=noteHz(midi+pitch),carrierRegister=sidFrequency(carrier,SID_PAL_CLOCK);
    if(carrierRegister===0)throw new RangeError('SID carrier frequency is below the register range');
    const source=pair(preset)?carrier*preset.modulation.ratio:null;
    if(source!==null&&sidFrequency(source,SID_PAL_CLOCK)===0)throw new RangeError('SID modulator frequency is below the register range');
    return {carrier,source};
  }
  _live(state=this.core.getState()){
    // An unavailable envelope is not evidence of silence. Retain at most one
    // metadata record per physical slot until that slot is actually reused.
    return this.slots.filter(voice=>{if(!voice)return false;const envelope=state.voices?.[voice.channel]?.envelope;
      return !voice.released||!Number.isFinite(envelope)||envelope>0;});
  }
  _prepareTuning(settings=this.channelSettings,pitch=this.pitch){
    const state=this.core.getState(),tuning=[],live=this._live(state);
    for(const voice of live){
      try{tuning.push({voice,tuning:this._tuning(voice.midi,settings.channels[voice.channel],pitch)});}
      catch(error){
        // Unknown released tails may already be silent. They keep their last
        // valid frequency when a new tuning is out of range, instead of making
        // a valid held-key edit fail. Known/audible and held voices stay strict.
        if(!(error instanceof RangeError)||!voice.released||Number.isFinite(state.voices?.[voice.channel]?.envelope))throw error;
      }
    }
    // A fixed-channel Legato stack can return to any still-held key. Validate
    // those fallback notes too, without retuning their shared physical slot.
    // This keeps a later key release from discovering an invalid Pitch/ratio.
    if(this._legato())for(const voice of this.voices.values())if(!live.includes(voice))
      this._tuning(voice.midi,settings.channels[voice.channel],pitch);
    return tuning;
  }
  read(){
    this._open();return {model:this.core.model,preset:readPreset(this.preset),voices:[...this.voices.values()].map(({id,midi,channel})=>({id,midi,channel})),
      channelSettings:readChannelSettings(this.channelSettings),capacity:this._channels().length,pitch:this.pitch,registers:Array.from(this.synth.getRegisterSnapshot())};
  }
  setPreset(value){
    this._open();return this.setChannelSettings(editChannelPreset(this.channelSettings,readPreset(value)));
  }
  setChannelSettings(value){
    this._open();const next=readChannelSettings(value),preset=selected(next);
    if(preset.model!==this.core.model)throw new RangeError('SID preset model must match its core; replace the instrument to change model');
    if(topology(next)!==topology(this.channelSettings)){this._replace(next,this.codeActive);return this.read();}
    const tuning=this._prepareTuning(next),previous=this.channelSettings,plan=channelPlaybackPlan(next);
    this.channelSettings=next;this.preset=preset;this._apply(previous);
    for(const item of tuning)if(item.tuning.source!==null&&previous.channels[item.voice.channel].modulation.ratio!==next.channels[item.voice.channel].modulation.ratio)
      this.synth.setFrequency(plan.source,item.tuning.source);
    return this.read();
  }
  loadPreset(value){this._open();return this.loadChannelSettings(applyChannelPreset(this.channelSettings,readPreset(value)));}
  loadChannelSettings(value){this._open();const next=readChannelSettings(value);this._replace(next,this.codeActive);return this.read();}
  noteOn(id,midi){
    this._open();
    if(this.codeActive)throw new Error('SID Code owns the physical channels; stop Code before playing the keyboard');
    if(typeof id!=='string'||!id.length||id.length>128)throw new TypeError('Expected a note identity of 1–128 characters');
    if(this.voices.has(id))throw new Error('Note identity is already active');
    if(!Number.isInteger(midi)||midi<0||midi>127)throw new RangeError('Expected a MIDI note 0–127');
    const plan=channelPlaybackPlan(this.channelSettings),channels=plan.channels,state=this.core.getState();let channel;
    for(let offset=0;offset<channels.length;offset++){
      const candidate=channels[(this.cursor+offset)%channels.length],voice=this.slots[candidate];
      const envelope=state.voices?.[candidate]?.envelope;
      if(!voice||voice.released&&Number.isFinite(envelope)&&envelope===0){channel=candidate;break;}
    }
    if(channel===undefined){
      const released=channels.filter(candidate=>this.slots[candidate].released),eligible=released.length?released:channels;
      channel=eligible.reduce((oldest,candidate)=>this.slots[candidate].order<this.slots[oldest].order?candidate:oldest,eligible[0]);
    }
    // Choose the physical voice first, then validate its stored patch and source
    // ratio before retiring an old key or changing any hardware register.
    const tuning=this._tuning(midi,this.channelSettings.channels[channel]);
    const previous=this.slots[channel],overlap=this._legato()&&previous&&!previous.released&&this.voices.get(previous.id)===previous;
    const stolenId=previous&&!previous.released&&!overlap?previous.id:null;
    if(previous&&!previous.released&&!overlap)this.synth.keyOff(channel);
    this.synth.setFrequency(channel,tuning.carrier);
    if(tuning.source!==null)this.synth.setFrequency(plan.source,tuning.source);
    if(!overlap)this.synth.keyOn(channel);
    if(previous&&!overlap&&this.voices.get(previous.id)===previous)this.voices.delete(previous.id);
    const voice={id,midi,channel,order:++this.sequence,released:false};this.slots[channel]=voice;this.voices.set(id,voice);this.cursor=(channels.indexOf(channel)+1)%channels.length;
    return {channel,stolenId};
  }
  noteOff(id){
    this._open();const voice=this.voices.get(id);if(!voice)return false;
    if(this._legato()){
      if(this.slots[voice.channel]!==voice){this.voices.delete(id);return true;}
      const fallback=[...this.voices.values()].filter(value=>value!==voice&&value.channel===voice.channel)
        .reduce((last,value)=>!last||value.order>last.order?value:last,null);
      if(fallback){
        const plan=channelPlaybackPlan(this.channelSettings),tuning=this._tuning(fallback.midi,this.channelSettings.channels[fallback.channel]);
        this.synth.setFrequency(fallback.channel,tuning.carrier);
        if(tuning.source!==null)this.synth.setFrequency(plan.source,tuning.source);
        this.voices.delete(id);this.slots[voice.channel]=fallback;return true;
      }
    }
    if(this.slots[voice.channel]!==voice)return false;
    this.synth.keyOff(voice.channel);this.voices.delete(id);voice.released=true;return true;
  }
  setPitch(semitones){
    this._open();if(!Number.isFinite(semitones)||semitones < -24||semitones>24)throw new RangeError('Pitch must be between -24 and +24 semitones');
    const tuning=this._prepareTuning(this.channelSettings,semitones),plan=channelPlaybackPlan(this.channelSettings);
    for(const item of tuning){this.synth.setFrequency(item.voice.channel,item.tuning.carrier);if(item.tuning.source!==null)this.synth.setFrequency(plan.source,item.tuning.source);}
    this.pitch=semitones;return this.read();
  }
  /** Code borrows this same chip, but owns physical voices rather than key IDs.
   * Starting the session clears the keyboard allocator and restores its patch.
   * Sound loads may restart hardware notes, while retaining this Code token.
   * Explicit Stop invalidates every earlier session token.
   */
  beginCode(){
    this._open();this.stop();this.codeActive=true;this.codeFrames=0;
    return {session:this.codeEpoch,clock:this.synth.clock,model:this.core.model,channels:3};
  }
  /** Internal same-Worklet handoff after a model candidate is ready. The
   * processor keeps its public session; this instrument owns its new token. */
  adoptCode(previous){
    this._open();
    if(!previous?.codeActive||!Number.isSafeInteger(previous.codeFrames)||previous.codeFrames<0)
      throw new TypeError('Expected an active SID Code owner');
    this.codeActive=true;this.codeFrames=previous.codeFrames;
    return {session:this.codeEpoch,clock:this.synth.clock,model:this.core.model,channels:3};
  }
  /** One coherent, non-clocking observation of the applied Code state. This
   * never replaces the saved preset or acquires/restarts a Code session. */
  observeCode(...args){
    this._open();if(args.length)throw new TypeError('SID Code observation takes no arguments');
    if(!this.codeActive)return null;
    const state=this.core.getState();
    return {model:this.core.model,clockHz:this.core.clockHz,sampleRate:this.core.sampleRate,positionFrames:this.codeFrames,
      registers:Array.from(state.registers),voices:Array.from({length:3},(_,channel)=>{
        const envelope=state.voices?.[channel]?.envelope;
        return {envelope:Number.isInteger(envelope)&&envelope>=0&&envelope<=255?envelope:null};
      })};
  }
  code(session,method,args=[]){
    this._open();
    if(!this.codeActive||session!==this.codeEpoch)throw codeCancelled();
    if(!codeMethods.has(method))throw new Error('Unknown SID Code method');
    if(!Array.isArray(args))throw new TypeError('SID Code arguments must be an array');
    if(method==='getState')return this.synth._getState();
    // These are shared-instrument resets, not ownership/disposal operations.
    // Preserve the Code token while restoring the latest authored patch.
    if(method==='initialize'||method==='reset'){
      if(args.length)throw new TypeError('SID Code reset takes no arguments');
      this._replace(this.channelSettings,true);return;
    }
    return this.synth[method](...args);
  }
  stop(){this._open();this._replace(this.channelSettings);return this.read();}
  renderInto(output){this._open();if(!(output instanceof Float32Array))throw new TypeError('SID output must be Float32Array');const result=this.core.renderInto(output);if(this.codeActive)this.codeFrames+=output.length;return result;}
  dispose(){if(this.disposed)return;this.voices.clear();this.slots.fill(null);try{this.synth.dispose();}finally{this.disposed=true;this.core.dispose();}}
}

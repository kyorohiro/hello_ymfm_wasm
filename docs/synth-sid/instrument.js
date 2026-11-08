// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 kyorohiro.
import {SidSynth} from '../js/sidsynth.js';
import {SID_PAL_CLOCK,sidFrequency} from '../js/sid.js';
import {createDefaultPreset,readPreset} from './preset.js';

const pair=preset=>preset.modulation.sync||preset.modulation.ring;
const topology=preset=>`${preset.modulation.sync}/${preset.modulation.ring}/${preset.voice.test}`;
const noteHz=midi=>440*2**((midi-69)/12);
const changes=(next,previous)=>Object.fromEntries(Object.entries(next).filter(([key,value])=>!previous||previous[key]!==value));

/** Software key allocation over three physical PAL SID voices. Sync/Ring use the
 * physical oscillator 3 -> 1 connection: one carrier and one silent Triangle
 * source, with no hidden voice, added gain or software envelope.
 * Core ownership transfers to this object, including disposal.
 */
export class SidInstrument{
  constructor(core){
    if(!core||typeof core.writeRegister!=='function'||typeof core.reset!=='function'||typeof core.renderInto!=='function'||typeof core.getState!=='function'||typeof core.dispose!=='function')throw new TypeError('Expected a SidCore');
    if(!['6581','8580'].includes(core.model)||core.clockHz!==SID_PAL_CLOCK)throw new RangeError('SID Synth requires model 6581 or 8580 at PAL 985248 Hz');
    this.core=core;this.synth=new SidSynth({core});this.preset=createDefaultPreset({model:core.model});
    this.disposed=false;this.pitch=0;this.cursor=0;this.sequence=0;this.voices=new Map();this.slots=Array(3).fill(null);
    this._replace(this.preset);
  }
  _open(){if(this.disposed)throw new Error('SID instrument is disposed');}
  _channels(){return pair(this.preset)?[0]:[0,1,2];}
  _voice(preset,channel){
    if(pair(preset)&&channel===2)return {waveform:'triangle',pulseWidth:2048,attack:0,decay:0,sustain:0,release:0,test:false,sync:false,ring:false};
    return {...preset.voice,sync:pair(preset)&&channel===0&&preset.modulation.sync,ring:pair(preset)&&channel===0&&preset.modulation.ring};
  }
  _filter(preset){return {mode:preset.filter.enabled?preset.filter.mode:'off',cutoff:preset.filter.cutoff,resonance:preset.filter.resonance,
    routing:preset.filter.enabled?(pair(preset)?1:7):0,volume:preset.filter.volume,voice3off:pair(preset)};}
  _apply(previous){
    for(let channel=0;channel<3;channel++){
      const patch=changes(this._voice(this.preset,channel),previous?this._voice(previous,channel):null);
      if(Object.keys(patch).length)this.synth.setVoice(channel,patch);
    }
    const filter=changes(this._filter(this.preset),previous?this._filter(previous):null);
    if(Object.keys(filter).length)this.synth.setFilter(filter);
  }
  _replace(preset){
    if(preset.model!==this.core.model)throw new RangeError('SID preset model must match its core; replace the instrument to change model');
    // initialize resets the owned core, including its access queue and software
    // DC history. Reapplying the silent patch preserves authored parameters.
    this.synth.initialize();this.preset=preset;this.pitch=0;this.cursor=0;this.sequence=0;this.voices.clear();this.slots.fill(null);this._apply(null);
  }
  _tuning(midi,preset=this.preset,pitch=this.pitch){
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
  _prepareTuning(preset=this.preset,pitch=this.pitch){
    const state=this.core.getState(),tuning=[];
    for(const voice of this._live(state)){
      try{tuning.push({voice,tuning:this._tuning(voice.midi,preset,pitch)});}
      catch(error){
        // Unknown released tails may already be silent. They keep their last
        // valid frequency when a new tuning is out of range, instead of making
        // a valid held-key edit fail. Known/audible and held voices stay strict.
        if(!(error instanceof RangeError)||!voice.released||Number.isFinite(state.voices?.[voice.channel]?.envelope))throw error;
      }
    }
    return tuning;
  }
  read(){
    this._open();return {model:this.core.model,preset:readPreset(this.preset),voices:[...this.voices.values()].map(({id,midi,channel})=>({id,midi,channel})),
      capacity:this._channels().length,pitch:this.pitch,registers:Array.from(this.synth.getRegisterSnapshot())};
  }
  setPreset(value){
    this._open();const next=readPreset(value);
    if(next.model!==this.core.model)throw new RangeError('SID preset model must match its core; replace the instrument to change model');
    if(topology(next)!==topology(this.preset)){this._replace(next);return this.read();}
    const tuning=this._prepareTuning(next),previous=this.preset;this.preset=next;this._apply(previous);
    if(pair(next)&&previous.modulation.ratio!==next.modulation.ratio)for(const item of tuning)this.synth.setFrequency(2,item.tuning.source);
    return this.read();
  }
  loadPreset(value){this._open();const next=readPreset(value);this._replace(next);return this.read();}
  noteOn(id,midi){
    this._open();
    if(typeof id!=='string'||!id.length||id.length>128)throw new TypeError('Expected a note identity of 1–128 characters');
    if(this.voices.has(id))throw new Error('Note identity is already active');
    if(!Number.isInteger(midi)||midi<0||midi>127)throw new RangeError('Expected a MIDI note 0–127');
    // Validate even the source ratio before retiring or modifying another key.
    const tuning=this._tuning(midi),channels=this._channels(),state=this.core.getState();let channel;
    for(let offset=0;offset<channels.length;offset++){
      const candidate=channels[(this.cursor+offset)%channels.length],voice=this.slots[candidate];
      const envelope=state.voices?.[candidate]?.envelope;
      if(!voice||voice.released&&Number.isFinite(envelope)&&envelope===0){channel=candidate;break;}
    }
    if(channel===undefined){
      const released=channels.filter(candidate=>this.slots[candidate].released),eligible=released.length?released:channels;
      channel=eligible.reduce((oldest,candidate)=>this.slots[candidate].order<this.slots[oldest].order?candidate:oldest,eligible[0]);
    }
    const previous=this.slots[channel],stolenId=previous&&!previous.released?previous.id:null;
    if(previous&&!previous.released)this.synth.keyOff(channel);
    this.synth.setFrequency(channel,tuning.carrier);
    if(tuning.source!==null)this.synth.setFrequency(2,tuning.source);
    this.synth.keyOn(channel);
    if(previous&&this.voices.get(previous.id)===previous)this.voices.delete(previous.id);
    const voice={id,midi,channel,order:++this.sequence,released:false};this.slots[channel]=voice;this.voices.set(id,voice);this.cursor=(channels.indexOf(channel)+1)%channels.length;
    return {channel,stolenId};
  }
  noteOff(id){
    this._open();const voice=this.voices.get(id);if(!voice||this.slots[voice.channel]!==voice)return false;
    this.synth.keyOff(voice.channel);this.voices.delete(id);voice.released=true;return true;
  }
  setPitch(semitones){
    this._open();if(!Number.isFinite(semitones)||semitones < -24||semitones>24)throw new RangeError('Pitch must be between -24 and +24 semitones');
    const tuning=this._prepareTuning(this.preset,semitones);
    for(const item of tuning){this.synth.setFrequency(item.voice.channel,item.tuning.carrier);if(item.tuning.source!==null)this.synth.setFrequency(2,item.tuning.source);}
    this.pitch=semitones;return this.read();
  }
  stop(){this._open();this._replace(this.preset);return this.read();}
  renderInto(output){this._open();if(!(output instanceof Float32Array))throw new TypeError('SID output must be Float32Array');return this.core.renderInto(output);}
  dispose(){if(this.disposed)return;this.voices.clear();this.slots.fill(null);try{this.synth.dispose();}finally{this.disposed=true;this.core.dispose();}}
}

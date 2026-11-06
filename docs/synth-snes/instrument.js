// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 kyorohiro.
import {SnesSynth} from '../js/snessynth.js';
import {encodeBrr} from '../js/snes_brr_encoder.js';
import {decodeBase64} from './sample.js';
import {createDefaultPreset,readPreset,envelopeRegisters,modulatorEnvelopeRegisters,echoOptions,createNoiseCarrier,pmonActive,sampleBudget,presetBankKey} from './preset.js';

const noteHz=midi=>440*2**((midi-69)/12);
const clampPitch=value=>Math.max(1,Math.min(0x3fff,Math.round(value)));

/** Host keyboard allocation over eight physical S-DSP voices, native 32 kHz.
 * Core ownership transfers to this object. Echo uses reserved hardware RAM;
 * Noise uses the shared generator. PMON pairs adjacent physical voices and
 * keeps each modulator out of both the dry mix and the Echo send.
 */
export class SnesInstrument {
  constructor(core) {
    if(!core||typeof core.writeDsp!=='function'||typeof core.renderInto!=='function'||typeof core.reset!=='function') throw new TypeError('Expected a SnesDspCore');
    this.core=core;this.synth=new SnesSynth({core});this.preset=createDefaultPreset();
    this.disposed=false;this.pitch=0;this.cursor=0;this.sequence=0;this.generation=0;
    this.voices=new Map();this.slots=Array(8).fill(null);this.sample=null;this.modulatorSample=null;
    this._replace(this.preset);
  }
  _open(){if(this.disposed)throw new Error('S-DSP instrument is disposed');}
  _sampleKey(p) {return presetBankKey(p);}
  _channels() {return pmonActive(this.preset)?[1,3,5,7]:[0,1,2,3,4,5,6,7];}
  _voiceChannels(voice) {return voice.modulatorChannel===undefined?[voice.channel]:[voice.modulatorChannel,voice.channel];}
  _echoOptions(p) {const options=echoOptions(p.echo);return {...options,sendMask:options.sendMask&(pmonActive(p)?0xaa:255)};}
  _prepare(p) {
    let carrier;
    if(p.source==='noise')carrier={bytes:createNoiseCarrier(),options:{rootNote:60,basePitch:4096,loopStartSamples:0}};
    else if(p.source==='wave')carrier={bytes:encodeBrr(Float32Array.from(p.wave),{loopStartSamples:0}).brr,options:{baseFrequencyHz:250,loopStartSamples:0}};
    else carrier={bytes:decodeBase64(p.brr.data),options:{rootNote:p.brr.rootNote,basePitch:p.brr.basePitch,...(p.brr.loopStartSamples===null?{}:{loopStartSamples:p.brr.loopStartSamples})}};
    let modulator=null;
    if(pmonActive(p))modulator=p.pmon.source==='brr'
      ?{bytes:decodeBase64(p.pmon.brr.data),options:{rootNote:p.pmon.brr.rootNote,basePitch:p.pmon.brr.basePitch,...(p.pmon.brr.loopStartSamples===null?{}:{loopStartSamples:p.pmon.brr.loopStartSamples})}}
      :{bytes:encodeBrr(Float32Array.from(p.pmon.wave),{loopStartSamples:0}).brr,options:{baseFrequencyHz:250,loopStartSamples:0}};
    return {...carrier,modulator};
  }
  _replace(p,prepared=this._prepare(p)) {
    // Recreate only the bank bookkeeping; the owned DSP stays in place. This
    // returns all RAM after every authored sample edit instead of appending.
    this.synth=new SnesSynth({core:this.core});
    this.synth.setEcho(this._echoOptions(p));
    this.sample=prepared.bytes.length?this.synth.loadBRR(prepared.bytes,prepared.options):null;
    this.modulatorSample=prepared.modulator?.bytes.length?this.synth.loadBRR(prepared.modulator.bytes,prepared.modulator.options):null;
    this.voices.clear();this.slots.fill(null);this.cursor=0;this.generation++;
    this.preset=p;if(p.source==='noise')this.pitch=0;this._applyChannels();
  }
  _pitch(midi,p=this.preset,pitch=this.pitch) {
    if(p.source==='noise')return 4096;
    const value=p.source==='wave'?4096*noteHz(midi+pitch)/250:p.brr.basePitch*2**((midi+pitch-p.brr.rootNote)/12);
    return clampPitch(value);
  }
  _modulatorPitch(midi,p=this.preset,pitch=this.pitch) {
    const base=p.pmon.source==='brr'?p.pmon.brr.basePitch*2**((midi+pitch-p.pmon.brr.rootNote)/12):4096*noteHz(midi+pitch)/250;
    return clampPitch(base*p.pmon.ratio);
  }
  _applyChannels() {
    const active=pmonActive(this.preset),env=envelopeRegisters(this.preset),modulatorEnv=active?modulatorEnvelopeRegisters(this.preset):null;
    this.synth.setEcho(this._echoOptions(this.preset));
    if(this.sample&&this.preset.source==='brr') {
      const tuning={rootNote:this.preset.brr.rootNote,rootFrequencyHz:noteHz(this.preset.brr.rootNote),basePitch:this.preset.brr.basePitch};
      Object.assign(this.sample,tuning);Object.assign(this.synth.samples[this.sample.id],tuning);
    }
    if(this.modulatorSample&&this.preset.pmon.source==='brr') {
      const brr=this.preset.pmon.brr,tuning={rootNote:brr.rootNote,rootFrequencyHz:noteHz(brr.rootNote),basePitch:brr.basePitch};
      Object.assign(this.modulatorSample,tuning);Object.assign(this.synth.samples[this.modulatorSample.id],tuning);
    }
    for(let channel=0;channel<8;channel++) {
      const modulator=active&&channel%2===0,voice=this.slots[modulator?channel+1:channel],sample=modulator?this.modulatorSample:this.sample;
      this.synth.setPreset(channel,{...(sample?{sample:sample.id}:{}),...(modulator?modulatorEnv:env),
        volumeLeft:modulator?0:this.preset.volume.left,volumeRight:modulator?0:this.preset.volume.right,
        pitch:voice?(modulator?this._modulatorPitch(voice.midi):this._pitch(voice.midi)):0x1000});
    }
    const noise=this.preset.source==='noise';
    this.synth.writeDsp(0x2d,active?0xaa:0);
    this.synth.writeDsp(0x3d,noise?255:0);
    this.synth.writeDsp(0x6c,(this.synth.readDsp(0x6c)&0xe0)|(noise?this.preset.noise.clock:0));
  }
  _prune() {
    for(let channel=0;channel<8;channel++) {
      const voice=this.slots[channel];
      if(voice?.released&&this._voiceChannels(voice).every(ch=>this.core.readDsp((ch<<4)+8)===0))this.slots[channel]=null;
    }
  }
  read() {
    this._open();this._prune();
    return {preset:readPreset(this.preset),voices:[...this.voices.values()].map(({id,midi,channel,modulatorChannel})=>({id,midi,channel,...(modulatorChannel===undefined?{}:{modulatorChannel})})),
      tails:this.slots.filter(voice=>voice?.released).map(({id,channel,modulatorChannel})=>({id,channel,...(modulatorChannel===undefined?{}:{modulatorChannel})})),capacity:this._channels().length,pitch:this.pitch,generation:this.generation,
      nativeFrames:this.core.nativeFrames,sample:this.sample?{...this.sample}:null,modulatorSample:this.modulatorSample?{...this.modulatorSample}:null,
      pmon:{enabled:this.preset.pmon.enabled,active:pmonActive(this.preset),ratio:this.preset.pmon.ratio},pmonRegisters:{mask:this.core.readDsp(0x2d)},
      noise:{enabled:this.preset.source==='noise',clock:this.preset.noise.clock,shared:true},
      noiseRegisters:{non:this.core.readDsp(0x3d),flg:this.core.readDsp(0x6c),clock:this.core.readDsp(0x6c)&31},
      echo:this.synth.getEcho(),memory:{directoryAddress:this.core.readDsp(0x5d)<<8,maxSampleBytes:sampleBudget(this.preset)},
      echoRegisters:{flg:this.core.readDsp(0x6c),esa:this.core.readDsp(0x6d),edl:this.core.readDsp(0x7d),efb:this.core.readDsp(0x0d),
        eon:this.core.readDsp(0x4d),volumeLeft:this.core.readDsp(0x2c),volumeRight:this.core.readDsp(0x3c),
        fir:Array.from({length:8},(_,index)=>this.core.readDsp(0x0f+index*16))},
      registers:Array.from({length:8},(_,channel)=>Array.from({length:10},(_,register)=>this.core.readDsp((channel<<4)+register)))};
  }
  setPreset(value) {
    this._open();const next=readPreset(value);
    if(this._sampleKey(next)!==this._sampleKey(this.preset)) {
      const prepared=this._prepare(next);this._replace(next,prepared);
    } else {this.preset=next;this._applyChannels();}
    return this.read();
  }
  loadPreset(value) {
    this._open();const next=readPreset(value),prepared=this._prepare(next);
    this.pitch=0;this._replace(next,prepared);return this.read();
  }
  noteOn(id,midi) {
    this._open();
    if(typeof id!=='string'||!id.length||id.length>128)throw new TypeError('Expected a note identity of 1–128 characters');
    if(this.voices.has(id))throw new Error('Note identity is already active');
    if(!Number.isInteger(midi)||midi<0||midi>127)throw new RangeError('Expected a MIDI note 0–127');
    if(!this.sample)throw new Error('Load a BRR or audio sample before playing');
    if(pmonActive(this.preset)&&!this.modulatorSample)throw new Error('Load a PMON modulator BRR sample before playing');
    this._prune();const channels=this._channels();let channel;
    for(let offset=0;offset<channels.length;offset++) {const candidate=channels[(this.cursor+offset)%channels.length];if(this.slots[candidate]===null){channel=candidate;break;}}
    if(channel===undefined)channel=channels.reduce((oldest,candidate)=>{
      const voice=this.slots[candidate],previous=this.slots[oldest];
      return voice.released&&!previous.released||voice.released===previous.released&&voice.order<previous.order?candidate:oldest;
    },channels[0]);
    const previous=this.slots[channel];
    if(previous){for(const ch of this._voiceChannels(previous))this.synth.keyOff(ch);if(this.voices.get(previous.id)===previous)this.voices.delete(previous.id);}
    const voice={id,midi,channel,...(pmonActive(this.preset)?{modulatorChannel:channel-1}:{}),order:++this.sequence,released:false};
    this.synth.setPitch(channel,this._pitch(midi));
    if(voice.modulatorChannel!==undefined)this.synth.setPitch(voice.modulatorChannel,this._modulatorPitch(midi));
    for(const ch of this._voiceChannels(voice))this.synth.keyOn(ch);
    this.slots[channel]=voice;this.voices.set(id,voice);this.cursor=(channels.indexOf(channel)+1)%channels.length;
    return {channel,stolenId:previous&&!previous.released?previous.id:null};
  }
  noteOff(id) {
    this._open();const voice=this.voices.get(id);
    if(!voice||this.slots[voice.channel]!==voice)return false;
    this.voices.delete(id);voice.released=true;for(const ch of this._voiceChannels(voice))this.synth.keyOff(ch);return true;
  }
  setPitch(semitones) {
    this._open();if(!Number.isFinite(semitones)||semitones < -24||semitones>24)throw new RangeError('Pitch must be between -24 and +24 semitones');
    if(this.preset.source==='noise'){this.pitch=0;return this.read();}
    for(const voice of this.slots)if(voice) {
      this.synth.setPitch(voice.channel,this._pitch(voice.midi,this.preset,semitones));
      if(voice.modulatorChannel!==undefined)this.synth.setPitch(voice.modulatorChannel,this._modulatorPitch(voice.midi,this.preset,semitones));
    }
    this.pitch=semitones;return this.read();
  }
  stop(){this._open();this._replace(this.preset);return this.read();}
  renderInto(left,right,frames=Math.min(left?.length??0,right?.length??0),offset=0) {
    this._open();this.synth.renderInto(left,right,frames,offset);this._prune();
  }
  dispose(){if(this.disposed)return;this.voices.clear();this.slots.fill(null);this.synth.dispose();this.disposed=true;}
}

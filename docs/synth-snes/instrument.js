// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 kyorohiro.
import {SnesSynth} from '../js/snessynth.js';
import {encodeBrr} from '../js/snes_brr_encoder.js';
import {decodeBase64} from './sample.js';
import {createDefaultPreset,readPreset,envelopeRegisters,echoOptions,ECHO_BRR_MAX_BYTES} from './preset.js';

const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const noteHz=midi=>440*2**((midi-69)/12);

/** Host keyboard allocation over eight physical S-DSP voices, native 32 kHz.
 * Core ownership transfers to this object. Echo uses reserved hardware RAM;
 * PMON and Noise stay disabled.
 */
export class SnesInstrument {
  constructor(core) {
    if(!core||typeof core.writeDsp!=='function'||typeof core.renderInto!=='function'||typeof core.reset!=='function') throw new TypeError('Expected a SnesDspCore');
    this.core=core;this.synth=new SnesSynth({core});this.preset=createDefaultPreset();
    this.disposed=false;this.pitch=0;this.cursor=0;this.sequence=0;this.generation=0;
    this.voices=new Map();this.slots=Array(8).fill(null);this.sample=null;
    this._replace(this.preset);
  }
  _open(){if(this.disposed)throw new Error('S-DSP instrument is disposed');}
  _sampleKey(p) {return p.source==='wave'?JSON.stringify(['wave',p.echo.enabled,p.wave]):JSON.stringify(['brr',p.echo.enabled,p.brr.data,p.brr.loopStartSamples]);}
  _prepare(p) {
    if(p.source==='wave')return {bytes:encodeBrr(Float32Array.from(p.wave),{loopStartSamples:0}).brr,options:{baseFrequencyHz:250,loopStartSamples:0}};
    const bytes=decodeBase64(p.brr.data);
    return {bytes,options:{rootNote:p.brr.rootNote,basePitch:p.brr.basePitch,...(p.brr.loopStartSamples===null?{}:{loopStartSamples:p.brr.loopStartSamples})}};
  }
  _replace(p,prepared=this._prepare(p)) {
    // Recreate only the bank bookkeeping; the owned DSP stays in place. This
    // returns all RAM after every authored sample edit instead of appending.
    this.synth=new SnesSynth({core:this.core});
    this.synth.setEcho(echoOptions(p.echo));
    this.sample=prepared.bytes.length?this.synth.loadBRR(prepared.bytes,prepared.options):null;
    this.voices.clear();this.slots.fill(null);this.cursor=0;this.generation++;
    this.preset=p;this._applyChannels();
  }
  _pitch(midi,p=this.preset,pitch=this.pitch) {
    const value=p.source==='wave'?4096*noteHz(midi+pitch)/250:p.brr.basePitch*2**((midi+pitch-p.brr.rootNote)/12);
    return Math.max(1,Math.min(0x3fff,Math.round(value)));
  }
  _applyChannels() {
    const env=envelopeRegisters(this.preset);
    this.synth.setEcho(echoOptions(this.preset.echo));
    if(this.sample&&this.preset.source==='brr') {
      const tuning={rootNote:this.preset.brr.rootNote,rootFrequencyHz:noteHz(this.preset.brr.rootNote),basePitch:this.preset.brr.basePitch};
      Object.assign(this.sample,tuning);Object.assign(this.synth.samples[this.sample.id],tuning);
    }
    for(let channel=0;channel<8;channel++) {
      this.synth.setPreset(channel,{...(this.sample?{sample:this.sample.id}:{}),...env,
        volumeLeft:this.preset.volume.left,volumeRight:this.preset.volume.right,
        pitch:this.slots[channel]?this._pitch(this.slots[channel].midi):0x1000});
    }
  }
  _prune() {
    for(let channel=0;channel<8;channel++)if(this.slots[channel]?.released&&this.core.readDsp((channel<<4)+8)===0) this.slots[channel]=null;
  }
  read() {
    this._open();this._prune();
    return {preset:readPreset(this.preset),voices:[...this.voices.values()].map(({id,midi,channel})=>({id,midi,channel})),
      tails:this.slots.filter(voice=>voice?.released).map(({id,channel})=>({id,channel})),capacity:8,pitch:this.pitch,generation:this.generation,
      nativeFrames:this.core.nativeFrames,sample:this.sample?{...this.sample}:null,
      echo:this.synth.getEcho(),memory:{directoryAddress:this.core.readDsp(0x5d)<<8,maxSampleBytes:this.preset.echo.enabled?ECHO_BRR_MAX_BYTES:64512},
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
    this._prune();let channel;
    for(let offset=0;offset<8;offset++) {const candidate=(this.cursor+offset)%8;if(this.slots[candidate]===null){channel=candidate;break;}}
    if(channel===undefined)channel=this.slots.reduce((oldest,voice,index)=>{
      const previous=this.slots[oldest];
      return voice.released&&!previous.released||voice.released===previous.released&&voice.order<previous.order?index:oldest;
    },0);
    const previous=this.slots[channel];
    if(previous){this.synth.keyOff(channel);if(this.voices.get(previous.id)===previous)this.voices.delete(previous.id);}
    const voice={id,midi,channel,order:++this.sequence,released:false};
    this.synth.setPitch(channel,this._pitch(midi));this.synth.keyOn(channel);
    this.slots[channel]=voice;this.voices.set(id,voice);this.cursor=(channel+1)%8;
    return {channel,stolenId:previous&&!previous.released?previous.id:null};
  }
  noteOff(id) {
    this._open();const voice=this.voices.get(id);
    if(!voice||this.slots[voice.channel]!==voice)return false;
    this.voices.delete(id);voice.released=true;this.synth.keyOff(voice.channel);return true;
  }
  setPitch(semitones) {
    this._open();if(!Number.isFinite(semitones)||semitones < -24||semitones>24)throw new RangeError('Pitch must be between -24 and +24 semitones');
    for(const voice of this.slots)if(voice)this.synth.setPitch(voice.channel,this._pitch(voice.midi,this.preset,semitones));
    this.pitch=semitones;return this.read();
  }
  stop(){this._open();this._replace(this.preset);return this.read();}
  renderInto(left,right,frames=Math.min(left?.length??0,right?.length??0),offset=0) {
    this._open();this.synth.renderInto(left,right,frames,offset);this._prune();
  }
  dispose(){if(this.disposed)return;this.voices.clear();this.slots.fill(null);this.synth.dispose();this.disposed=true;}
}

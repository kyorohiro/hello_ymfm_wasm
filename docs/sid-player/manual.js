// SPDX-License-Identifier: BSD-3-Clause
import {sidWaveformBits,sidWaveformFromBits} from '../js/sid_waveforms.js?sid-waves=1';

const modes=['off','lowpass','bandpass','lowpass+bandpass','highpass','notch','bandpass+highpass','lowpass+bandpass+highpass'];
const integer=(value,min,max,label)=>{if(!Number.isInteger(value)||value<min||value>max)throw new RangeError(`${label} must be ${min}..${max}`);return value;};
const object=(value,keys,label)=>{
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!keys.includes(key)))throw new TypeError(`Invalid ${label}`);
};
const pitchValue=value=>{if(!Number.isFinite(value)||value < -24||value>24)throw new RangeError('SID Pitch must be -24..24');return value;};
const identity=id=>{if(typeof id!=='string'||!id.length||id.length>128)throw new TypeError('SID key identity must be 1..128 characters');return id;};
const boolean=(value,label)=>{if(typeof value!=='boolean')throw new TypeError(`SID ${label} must be boolean`);};

// Small, pure register planner. It shares the hardware packing used by
// sidsynth.js, but imports no standalone sound core or unused WASM loader into
// the C64 player. Its writes are only data until the complete edit validates.
function registerPlan(state,writes){
  const r=state.registers.slice(),send=(reg,value)=>{writes.push([reg,value]);r[reg]=value;};
  return {
    setVoice(channel,value){
      for(const key of ['attack','decay','sustain','release'])if(Object.hasOwn(value,key))integer(value[key],0,15,`SID ${key}`);
      for(const key of ['sync','ring','test'])if(Object.hasOwn(value,key))boolean(value[key],key);
      if(Object.hasOwn(value,'pulseWidth'))integer(value.pulseWidth,0,4095,'SID pulse width');
      const wave=Object.hasOwn(value,'waveform')?sidWaveformBits(value.waveform):null,base=channel*7;
      if(Object.hasOwn(value,'pulseWidth')){send(base+2,value.pulseWidth&255);send(base+3,(r[base+3]&240)|(value.pulseWidth>>8));}
      if(Object.hasOwn(value,'attack')||Object.hasOwn(value,'decay'))send(base+5,((value.attack??r[base+5]>>4)<<4)|(value.decay??r[base+5]&15));
      if(Object.hasOwn(value,'sustain')||Object.hasOwn(value,'release'))send(base+6,((value.sustain??r[base+6]>>4)<<4)|(value.release??r[base+6]&15));
      let control=r[base+4],changed=wave!==null;if(changed)control=(control&15)|(wave<<4);
      for(const [key,bit]of [['sync',2],['ring',4],['test',8]])if(Object.hasOwn(value,key)){control=(control&~bit)|(value[key]?bit:0);changed=true;}
      if(changed)send(base+4,control);
    },
    setFilter(value){
      for(const [key,max]of [['cutoff',2047],['resonance',15],['routing',7],['volume',15]])if(Object.hasOwn(value,key))integer(value[key],0,max,`SID ${key}`);
      if(Object.hasOwn(value,'mode')&&!modes.includes(value.mode))throw new RangeError('Unknown SID filter mode');
      if(Object.hasOwn(value,'cutoff')){send(21,(r[21]&248)|(value.cutoff&7));send(22,value.cutoff>>3);}
      if(Object.hasOwn(value,'resonance')||Object.hasOwn(value,'routing'))send(23,((value.resonance??r[23]>>4)<<4)|(r[23]&8)|(value.routing??r[23]&7));
      let control=r[24],changed=false;
      if(Object.hasOwn(value,'mode')){control=(control&143)|(modes.indexOf(value.mode)<<4);changed=true;}
      if(Object.hasOwn(value,'volume')){control=(control&240)|value.volume;changed=true;}
      if(changed)send(24,control);
    },
    setFrequency(channel,hz){
      if(!Number.isFinite(hz)||hz<=0)throw new RangeError('SID frequency must be positive finite Hz');
      const value=integer(Math.round(hz*16777216/state.clockHz),1,65535,'SID frequency register');
      send(channel*7,value&255);send(channel*7+1,value>>8);
    },
    keyOn(channel){send(channel*7+4,r[channel*7+4]|1);},
    keyOff(channel){send(channel*7+4,r[channel*7+4]&254);},
  };
}

/** Front-panel intervention on the actual song SID. C64 writes always retain
 * their order; source revisions include same-value writes and never depend on
 * the bounded diagnostic trace. All partial edits are staged/validated before
 * touching the chip, then committed without advancing CPU or audio time.
 */
export class SidPlayerManual {
  constructor(core){this.core=core;this.voices=new Map();this.pitch=0;}
  reset(){this.voices.clear();this.pitch=0;}
  _snapshot(){
    const state=this.core.getState();
    if(!state.loaded||!state.playing)throw new Error('Start the SID song before editing it');
    return {state,revisions:this.core.readSourceRevisions()};
  }
  _stage(state,run){
    const writes=[];run(registerPlan(state,writes));return writes;
  }
  _commit(writes,{owner=null}={}){
    // Any other manual operation on this oscillator supersedes its old pitch
    // owner, even though source-only revisions deliberately remain unchanged.
    for(const [r]of writes)if(r<21&&(r%7===0||r%7===1)){
      const channel=Math.floor(r/7);
      for(const voice of this.voices.values())if(voice.channel===channel&&voice!==owner)voice.pitchLost=true;
    }
    for(const [r,v]of writes)this.core.manualWriteRegister(r,v);
  }
  _gateOwned(voice,revisions){return voice.gateRevision===revisions[voice.channel*7+4]&&this.voices.get(voice.id)===voice;}
  _pitchOwned(voice,revisions){return !voice.pitchLost&&this._gateOwned(voice,revisions)&&voice.pitchRevisions.every((revision,index)=>revision===revisions[voice.channel*7+index]);}
  describe(){
    if(!this.voices.size)return {manualVoices:[],manualPitch:this.pitch};
    const revisions=this.core.readSourceRevisions();
    return {manualVoices:[...this.voices.values()].map(v=>({id:v.id,channel:v.channel,midi:v.midi,
      gateOwned:this._gateOwned(v,revisions),pitchOwned:this._pitchOwned(v,revisions)})),manualPitch:this.pitch};
  }
  edit(channel,patch,masks={}){
    integer(channel,0,2,'SID channel');object(patch,['voice','modulation','filter'],'SID song edit');
    object(masks,['waveformBits','filterModeBits'],'SID edit masks');
    if(Object.hasOwn(masks,'waveformBits'))integer(masks.waveformBits,0,15,'SID waveform edit mask');
    if(Object.hasOwn(masks,'filterModeBits'))integer(masks.filterModeBits,0,7,'SID filter edit mask');
    for(const [group,keys]of [['voice',['waveform','pulseWidth','attack','decay','sustain','release','test']],['modulation',['sync','ring','ratio']],['filter',['enabled','mode','cutoff','resonance','volume']]])
      if(Object.hasOwn(patch,group))object(patch[group],keys,`SID ${group} edit`);
    const {state}=this._snapshot(),voice={...patch.voice},filter={...patch.filter},modulation=patch.modulation??{},r=state.registers;
    if(Object.hasOwn(voice,'waveform')&&Object.hasOwn(masks,'waveformBits')){
      const wanted=sidWaveformBits(voice.waveform),current=r[channel*7+4]>>4,mask=masks.waveformBits;
      voice.waveform=sidWaveformFromBits((current&~mask)|(wanted&mask));
    }
    for(const key of ['sync','ring'])if(Object.hasOwn(modulation,key))voice[key]=modulation[key];
    if(Object.hasOwn(filter,'enabled')&&typeof filter.enabled!=='boolean')throw new TypeError('SID filter enabled must be boolean');
    if(Object.hasOwn(filter,'mode')&&Object.hasOwn(masks,'filterModeBits')){
      const wanted=modes.indexOf(filter.mode);if(wanted<0)throw new RangeError('Unknown SID filter mode');
      const current=(r[24]>>4)&7,mask=masks.filterModeBits;filter.mode=modes[(current&~mask)|(wanted&mask)];
      // LP/BP/HP clicks carry automatic enable/bypass intent. Recompute that
      // intent from the merged current mask, not a stale displayed mode.
      filter.enabled=filter.mode!=='off';
    }
    if(Object.hasOwn(filter,'enabled')){
      filter.routing=filter.enabled?(r[23]&7)|(1<<channel):(r[23]&7)&~(1<<channel);delete filter.enabled;
    }
    let sourceHz=null;
    if(Object.hasOwn(modulation,'ratio')){
      if(!Number.isFinite(modulation.ratio)||modulation.ratio<.125||modulation.ratio>8)throw new RangeError('Software modulator ratio must be .125..8');
      sourceHz=(r[channel*7]|r[channel*7+1]<<8)*state.clockHz/16777216*modulation.ratio;
    }
    const writes=this._stage(state,synth=>{
      if(Object.keys(voice).length)synth.setVoice(channel,voice);
      if(Object.keys(filter).length)synth.setFilter(filter);
      if(sourceHz!==null)synth.setFrequency((channel+2)%3,sourceHz);
    });
    this._commit(writes);return this.describe();
  }
  noteOn(id,channel,midi,pitch=0){
    identity(id);integer(channel,0,2,'SID channel');integer(midi,0,127,'SID MIDI note');pitchValue(pitch);
    if(this.voices.has(id))throw new Error('SID key identity is already active');
    const {state,revisions}=this._snapshot(),hz=440*2**((midi+pitch-69)/12);
    const writes=this._stage(state,synth=>{synth.keyOff(channel);synth.setFrequency(channel,hz);synth.keyOn(channel);});
    // Validate first; only then retire the former key for this physical slot.
    for(const [key,voice]of this.voices)if(voice.channel===channel)this.voices.delete(key);
    this._commit(writes);
    this.voices.set(id,{id,channel,midi,gateRevision:revisions[channel*7+4],pitchRevisions:revisions.slice(channel*7,channel*7+2),pitchLost:false});
    this.pitch=pitch;return this.describe();
  }
  noteOff(id){
    identity(id);const voice=this.voices.get(id);if(!voice)return this.describe();
    const {state,revisions}=this._snapshot();
    if(this._gateOwned(voice,revisions))this._commit(this._stage(state,synth=>synth.keyOff(voice.channel)));
    this.voices.delete(id);return this.describe();
  }
  setPitch(value){
    pitchValue(value);const {state,revisions}=this._snapshot();
    const voices=[...this.voices.values()].filter(voice=>this._pitchOwned(voice,revisions));
    // A multi-key bend is transactional: an unrepresentable upper note cannot
    // leave the other voices half-retuned.
    const groups=voices.map(voice=>({voice,writes:this._stage(state,synth=>synth.setFrequency(voice.channel,440*2**((voice.midi+value-69)/12)))}));
    for(const {voice,writes}of groups)this._commit(writes,{owner:voice});
    this.pitch=value;return this.describe();
  }
  release(){
    if(!this.voices.size)return this.describe();
    const {state,revisions}=this._snapshot();
    const writes=this._stage(state,synth=>{for(const voice of this.voices.values())if(this._gateOwned(voice,revisions))synth.keyOff(voice.channel);});
    this._commit(writes);this.voices.clear();return this.describe();
  }
}

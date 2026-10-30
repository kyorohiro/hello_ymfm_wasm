// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026, kyorohiro.
import {noteToHz} from './soundchip_pitch.js';
import {SCSP_SAMPLE_RATE, SCSP_RAM_BYTES} from './scsp.js?v=scsp-native-1';
export const SCSP_SLOT_COUNT = 32;
let bankSequence=0;
const int = (v,lo,hi,name) => {
  if (!Number.isSafeInteger(v)||v<lo||v>hi) throw new RangeError(`${name} must be ${lo}..${hi}`);
  return v;
};
const positive = (v,name) => {
  if (!Number.isFinite(v)||v<=0) throw new RangeError(`${name} must be positive and finite`);
  return v;
};
function keys(value,allowed,name) {
  if (!value||typeof value!=='object'||Array.isArray(value)||Reflect.ownKeys(value).some(k=>!allowed.includes(k))) throw new TypeError(`Invalid ${name}`);
}
const envelopeDefaults = () => ({attackRate:31,decay1Rate:0,decay2Rate:0,decayLevel:0,releaseRate:31,keyRateScaling:15});
const voiceDefaults = () => ({sample:null,frequencyHz:440,totalLevel:0,directLevel:7,pan:0,envelope:envelopeDefaults()});
function envelope(value) {
  keys(value,Object.keys(envelopeDefaults()),'SCSP envelope');
  const result={...envelopeDefaults(),...value};
  for (const k of Object.keys(result)) int(result[k],0,k==='keyRateScaling'?15:31,k);
  return Object.freeze(result);
}
/** Quantize a source advance ratio to signed OCT / FNS. No silent clamping. */
export function scspPitch(ratio) {
  positive(ratio,'SCSP pitch ratio');
  if (ratio<1/256||ratio>2047/8) throw new RangeError('SCSP pitch ratio exceeds OCT/FNS range');
  let octave=Math.floor(Math.log2(ratio));
  let fine=Math.round((ratio/2**octave-1)*1024);
  if (fine===1024) { octave++;fine=0; }
  if (octave>7) {octave=7;fine=1023;}
  return {word:((octave&15)<<11)|fine,ratio:(1+fine/1024)*2**octave};
}

/** Musical PCM adapter over an exclusively owned Scsp. No device, automatic voice
 * allocation, public sample replacement, DSP, FM or file decoder. Do not write the raw
 * core while this adapter owns its registers/RAM. Preset changes take effect on
 * the next keyOn; setFrequency and setMix are explicit live controls.
 */
export class ScspSynth {
  #bankId=`scsp-${Date.now().toString(36)}-${++bankSequence}-${Math.random().toString(36).slice(2)}`;
  #editorPages=[]; #core; #samples=new Map(); #nextId=1; #used=0; #voices=Array.from({length:32},voiceDefaults); #gates=Array(32).fill(false); #playing=Array(32).fill(null); #disposed=false;
  constructor(core) {
    if (!core||core.sampleRate!==44100||!['write','loadRam','reset','renderInto','dispose'].every(k=>typeof core[k]==='function')) throw new TypeError('ScspSynth requires an exclusively owned Scsp');
    this.#core=core;
    core.reset();core.write(0x400,0x020f);
  }
  #open() {if(this.#disposed)throw new Error('ScspSynth is disposed');}
  #slot(slot) {this.#open();return int(slot,0,31,'SCSP slot');}
  #sample(sample) {
    if (!sample||this.#samples.get(sample.id)!==sample) throw new TypeError('SCSP sample belongs to another bank or was cleared');
    return sample;
  }
  #pitch(voice) {
    const s=this.#sample(voice.sample),pitch=scspPitch(voice.frequencyHz/s.rootFrequencyHz*s.sourceSampleRate/SCSP_SAMPLE_RATE);
    // The inherited loop engine wraps once per frame. Do not let a short loop
    // advance into another allocation when a single step exceeds its length.
    if(s.loopStartSamples!==null&&pitch.ratio>s.length-s.loopStartSamples)throw new RangeError('SCSP pitch step exceeds forward loop length');
    return pitch;
  }
  get sampleRate() {return SCSP_SAMPLE_RATE;}
  get nativeFrames() {return this.#core.nativeFrames;}
  /** Copy signed PCM8 or PCM16. Each waveform has 2..65535 samples. Tuning is
   * explicit: exactly one rootNote/baseFrequencyHz, measured at sourceSampleRate.
   * A forward loop uses [loopStartSamples, length); omitted means one shot.
   * Bank allocation is append-only until reset({clearRam:true}). */
  loadPCM(pcm,options) {
    this.#open();keys(options,['rootNote','baseFrequencyHz','sourceSampleRate','loopStartSamples'],'SCSP PCM options');
    if (!(pcm instanceof Int8Array)&&!(pcm instanceof Int16Array)) throw new TypeError('SCSP PCM must be Int8Array or Int16Array');
    int(pcm.length,2,65535,'SCSP PCM sample count');
    if ((options.rootNote===undefined)===(options.baseFrequencyHz===undefined)) throw new TypeError('Supply exactly one rootNote or baseFrequencyHz');
    const rootFrequencyHz=options.rootNote===undefined?positive(options.baseFrequencyHz,'baseFrequencyHz'):noteToHz(options.rootNote);
    const sourceSampleRate=positive(options.sourceSampleRate??44100,'sourceSampleRate');
    const loopStartSamples=options.loopStartSamples===undefined?null:int(options.loopStartSamples,0,pcm.length-1,'loopStartSamples');
    const bits=pcm.BYTES_PER_ELEMENT*8,address=(this.#used+1)&~1;
    // One guard sample isolates the initial interpolation read from adjacent RAM.
    const bytes=new Uint8Array((pcm.length+1)*pcm.BYTES_PER_ELEMENT);
    if(address+bytes.length>SCSP_RAM_BYTES)throw new RangeError('SCSP sample RAM is full; clear the bank before loading more PCM');
    const view=new DataView(bytes.buffer);
    for(let i=0;i<=pcm.length;i++) {
      const v=pcm[i===pcm.length?(loopStartSamples??pcm.length-1):i];
      if(bits===8)view.setInt8(i,v);else view.setInt16(i*2,v,false);
    }
    this.#core.loadRam(bytes,address);
    const sample=Object.freeze({bankId:this.#bankId,id:this.#nextId++,address,byteLength:bytes.length,length:pcm.length,bits,rootFrequencyHz,sourceSampleRate,loopStartSamples});
    this.#samples.set(sample.id,sample);this.#used=address+bytes.length;return sample;
  }
  /** Internal editor pool. Ordinary loadPCM allocations remain permanent.
   * Retired editor handles expire on reuse; queued commands must inhibit reuse.
   * Requested presets and even released native voices pin their sample until
   * retrigger or Stop. Never infer native silence from a requested gate bit.
   */
  _editPCM(slot,pcm,options,{reuse=true}={}) {
    slot=this.#slot(slot);if(typeof reuse!=='boolean')throw new TypeError('reuse must be boolean');
    let encoded,template;
    const check=new ScspSynth({sampleRate:44100,reset(){},write(){},loadRam(bytes){encoded=bytes;},renderInto(){},dispose(){}});
    try {
      check._adoptState({...this.getState(),ramUsedBytes:0});
      template=check.loadPCM(pcm,options);check.setPreset(slot,{sample:template});
    }finally{check.dispose();}
    const pinned=sample=>this.#playing.includes(sample)||this.#voices.some((v,i)=>i!==slot&&v.sample===sample);
    let page=reuse?this.#editorPages.filter(p=>p.capacity>=encoded.length&&!pinned(p.sample)).sort((a,b)=>a.capacity-b.capacity)[0]:null;
    if(!page){
      const capacity=2**Math.ceil(Math.log2(encoded.length)),address=(this.#used+1)&~1;
      if(address+capacity>SCSP_RAM_BYTES)throw new RangeError('SCSP editor RAM is full or protected by voices / queued notes. Stop playback or use a shorter selection.');
      page={address,capacity,sample:null};
    }
    // All validation/allocation decisions precede the single RAM write.
    this.#core.loadRam(encoded,page.address);
    const previous=page.sample,sample=Object.freeze({...template,bankId:this.#bankId,id:this.#nextId++,address:page.address,editorOwned:true});
    if(previous)this.#samples.delete(previous.id);
    this.#samples.set(sample.id,sample);this.#voices[slot]={...this.#voices[slot],sample};page.sample=sample;
    if(!this.#editorPages.includes(page)){this.#editorPages.push(page);this.#used=page.address+page.capacity;}
    return sample;
  }
  /** Configure a slot for its next keyOn. Invalid patches leave the slot intact. */
  setPreset(slot,patch) {
    slot=this.#slot(slot);keys(patch,['sample','frequencyHz','totalLevel','directLevel','pan','envelope'],'SCSP preset');
    const current=this.#voices[slot],next={...current,...patch};
    if(next.sample!==null)this.#sample(next.sample);
    positive(next.frequencyHz,'frequencyHz');int(next.totalLevel,0,255,'totalLevel');int(next.directLevel,0,7,'directLevel');int(next.pan,0,31,'pan');
    next.envelope=envelope({...current.envelope,...(patch.envelope??{})});
    if(Object.hasOwn(patch,'envelope'))keys(patch.envelope,Object.keys(envelopeDefaults()),'SCSP envelope');
    if(next.sample)this.#pitch(next);
    this.#voices[slot]=next;
  }
  setEnvelope(slot,patch) {
    slot=this.#slot(slot);keys(patch,Object.keys(envelopeDefaults()),'SCSP envelope');
    this.setPreset(slot,{envelope:patch});
  }
  /** Live pitch; returns the realized frequency after hardware quantization. */
  setFrequency(slot,frequencyHz) {
    slot=this.#slot(slot);positive(frequencyHz,'frequencyHz');
    const next={...this.#voices[slot],frequencyHz};
    this.#pitch(next);
    const sample=this.#playing[slot]??next.sample,pitch=this.#pitch({...next,sample});
    this.#core.write(slot*32+0x10,pitch.word);this.#voices[slot]=next;
    return pitch.ratio*sample.rootFrequencyHz*44100/sample.sourceSampleRate;
  }
  setNote(slot,note) {return this.setFrequency(slot,noteToHz(note));}
  /** Raw hardware attenuation/send/pan codes. TL=0 is loudest, DISDL=0 mute;
   * DIPAN=0 center, 15 right-only, 31 left-only. No software gain compensation. */
  setMix(slot,patch) {
    slot=this.#slot(slot);keys(patch,['totalLevel','directLevel','pan'],'SCSP mix');
    const next={...this.#voices[slot],...patch};
    int(next.totalLevel,0,255,'totalLevel');int(next.directLevel,0,7,'directLevel');int(next.pan,0,31,'pan');
    this.#core.write(slot*32+12,next.totalLevel);
    this.#core.write(slot*32+22,(next.directLevel<<13)|(next.pan<<8));this.#voices[slot]=next;
  }
  keyOn(slot) {
    slot=this.#slot(slot);const v=this.#voices[slot],s=this.#sample(v.sample),pitch=this.#pitch(v),b=slot*32,e=v.envelope;
    // Explicit off/on also retriggers an already sounding slot. KEYONEX scans
    // all 32 slots; mask only our KEYONB so other held voices keep their gates.
    this.#core.write(b,0x1000,0x1800);
    const control=(s.address>>>16)|(s.bits===8?16:0)|(s.loopStartSamples===null?0:32);
    for(const [r,value]of [[2,s.address&65535],[4,s.loopStartSamples??0],[6,s.length],
      [8,(e.decay2Rate<<11)|(e.decay1Rate<<6)|e.attackRate],
      [10,(e.keyRateScaling<<10)|(e.decayLevel<<5)|e.releaseRate],[12,v.totalLevel],[14,0],[16,pitch.word],[18,0],[20,0],[22,(v.directLevel<<13)|(v.pan<<8)]])this.#core.write(b+r,value);
    this.#core.write(b,control|0x1800);this.#gates[slot]=true;this.#playing[slot]=s;
  }
  keyOff(slot) {slot=this.#slot(slot);this.#core.write(slot*32,0x1000,0x1800);this.#gates[slot]=false;}
  noteOn(slot,note) {
    slot=this.#slot(slot);const frequencyHz=noteToHz(note),next={...this.#voices[slot],frequencyHz};
    this.#pitch(next);this.#voices[slot]=next;this.keyOn(slot);
  }
  noteOff(slot) {this.keyOff(slot);}
  allNotesOff() {
    this.#open();for(let slot=0;slot<32;slot++)this.#core.write(slot*32,0,0x1800);
    this.#core.write(0,0x1000,0x1000);this.#gates.fill(false);
  }
  /** Immediate silence, including infinite releases. Retains bank/presets;
   * resets the native frame clock. Reset the downstream resampler as well. */
  stopVoices() {this.#open();this.#core.reset();this.#core.write(0x400,0x020f);this.#gates.fill(false);this.#playing.fill(null);}
  reset(options={}) {
    this.#open();keys(options,['clearRam'],'SCSP reset options');
    if(options.clearRam!==undefined&&typeof options.clearRam!=='boolean')throw new TypeError('clearRam must be boolean');
    this.#core.reset(options);this.#core.write(0x400,0x020f);this.#gates.fill(false);this.#playing.fill(null);this.#voices=Array.from({length:32},voiceDefaults);
    if(options.clearRam){this.#samples.clear();this.#editorPages=[];this.#used=0;}
  }
  /** Internal structured-clone transport bridge. Public PCM handles stay owned. */
  _resolveSample(value) {
    this.#open();const sample=this.#samples.get(value?.id);
    if(!sample||value.bankId!==sample.bankId)throw new TypeError('SCSP sample belongs to another bank or was cleared');
    return sample;
  }
  /** Internal trusted Worklet resource snapshot; never uploads or writes RAM. */
  _adoptResources(state) {
    this.#open();
    const previous=this.#samples,next=new Map(state.samples.map(s=>[s.id,previous.get(s.id)?.bankId===s.bankId?previous.get(s.id):Object.freeze({...s})]));
    this.#samples=next;this.#used=state.ramUsedBytes;this.#nextId=state.nextSampleId;
    this.#bankId=state.bankId;
    for(let i=0;i<32;i++) {
      const s=this.#voices[i].sample;
      if(s&&next.get(s.id)!==s){
        const actual=state.slots?.[i],replacement=actual?.sample?next.get(actual.sample.id):null;
        this.#voices[i]=actual?{...actual,envelope:{...actual.envelope},sample:replacement}:{...this.#voices[i],sample:null};
        this.#gates[i]=actual?.gate??false;
        if(next.get(this.#playing[i]?.id)!==this.#playing[i])this.#playing[i]=null;
      }
    }
  }
  /** Internal editor metadata delta; the caller has excluded scheduled commands. */
  _adoptEditorState(slot,state) {
    slot=this.#slot(slot);this._adoptResources(state);const v=state.slots[slot];
    this.#voices[slot]={...v,envelope:{...v.envelope},sample:v.sample?this._resolveSample(v.sample):null};
    this.#gates[slot]=!!v.gate;
    const id=state.playingSampleIds?.[slot];this.#playing[slot]=id==null?null:this.#samples.get(id)??null;
  }
  _adoptState(state) {
    this._adoptResources(state);
    this.#voices=state.slots.map(v=>({...v,sample:v.sample?this._resolveSample(v.sample):null,envelope:{...v.envelope}}));
    this.#gates=state.slots.map(v=>!!v.gate);this.#playing=state.playingSampleIds?state.playingSampleIds.map(id=>id==null?null:this.#samples.get(id)??null):this.#voices.map(v=>v.sample);
  }
  /** Trusted transport staging: copy pool reservations without sharing pages. */
  _copyTransportState(source) {
    this._adoptState(source.getState());
    this.#editorPages=source.#editorPages.map(p=>({...p,sample:p.sample?this.#samples.get(p.sample.id):null}));
  }
  getState() {
    this.#open();return {sampleRate:44100,bankId:this.#bankId,nextSampleId:this.#nextId,ramUsedBytes:this.#used,ramFreeBytes:SCSP_RAM_BYTES-this.#used,playingSampleIds:this.#playing.map(s=>s?.id??null),samples:[...this.#samples.values()],
      slots:this.#voices.map((v,i)=>({...v,envelope:{...v.envelope},gate:this.#gates[i]}))};
  }
  prepare(frames) {this.#open();this.#core.prepare(frames);}
  renderInto(left,right,frames=left?.length,offset=0) {this.#open();this.#core.renderInto(left,right,frames,offset);}
  generateStereo(frames) {this.#open();return this.#core.generateStereo(frames);}
  dispose() {if(!this.#disposed){this.#core.dispose();this.#disposed=true;this.#samples.clear();this.#editorPages=[];}}
}

/** Original, low-level sine for examples. Root is 44100/64 Hz; not A4. */
export function createScspInitSample() {
  return {pcm:Int16Array.from({length:64},(_,i)=>Math.round(8192*Math.sin(2*Math.PI*i/64))),
    options:{baseFrequencyHz:44100/64,loopStartSamples:0}};
}

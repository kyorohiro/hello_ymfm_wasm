// SPDX-License-Identifier: BSD-3-Clause
// Software voice grouping over the unchanged hardware slot synthesizer.
import {ScspSynth,createScspInitSample} from '../js/scspsynth.js';
const createScspValidation=()=>new ScspSynth({sampleRate:44100,reset(){},write(){},loadRam(){},renderInto(){},dispose(){}});
const scspCommandArgs=(synth,method,args)=>method==='setPreset'&&args[1]?.sample?[args[0],{...args[1],sample:synth._resolveSample(args[1].sample)}]:args;
import {settings,pcmOptions,readPatch,writePatch,FM_MAX_DEPTH} from './patch.js';
const clone=v=>Array.isArray(v)?v.map(clone):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,clone(x)])):v;
const sourceSlot=n=>{if(n!==0&&n!==1)throw new RangeError('Choose Carrier or Modulator');return n;};
const hz=(midi,transpose)=>440*2**((midi-69+transpose)/12);
const patchOf=v=>({sample:v.sample,envelope:v.envelope,lfo:v.lfo,totalLevel:v.totalLevel,directLevel:v.directLevel,pan:v.pan,modulation:{depth:0,xOffset:0,yOffset:0,writeInhibit:false}});
export class SynthInstrument {
  constructor(core){
    this.core=core;this.synth=new ScspSynth(core);this.config=settings({mode:'pcm',fm:{depth:9,ratio:2},transpose:0});this.groups=new Map();this.sequence=0;
    const {pcm,options}=createScspInitSample();
    const carrier=this.synth.loadPCM(pcm,{...options,modulationDepth:FM_MAX_DEPTH}),modulator=this.synth.loadPCM(pcm,options);
    this.synth.setPreset(0,{sample:carrier,totalLevel:12});this.synth.setPreset(1,{sample:modulator,directLevel:0});
  }
  #check(commands,config=this.config){
    const check=createScspValidation();try{
      check._adoptState(this.synth.getState());for(const [method,args]of commands)check[method](...scspCommandArgs(check,method,args));
      // Also validate the next voice at A4, before changing authoring metadata.
      for(const [method,args]of this.#noteCommands(check,config,{midi:69,slots:config.mode==='fm2'?[2,3]:[2]}))check[method](...scspCommandArgs(check,method,args));
    }finally{check.dispose();}
  }
  #apply(commands){for(const [method,args]of commands)this.synth[method](...args);}
  #noteCommands(synth,config,group){
    const state=synth.getState(),carrier=state.slots[0],modulator=state.slots[1],frequency=hz(group.midi,config.transpose),c=group.slots.at(-1),commands=[];
    if(config.mode==='fm2'){
      if(carrier.sample?.loopStartSamples!==0)throw new RangeError('FM carrier needs a full forward loop: set loop start to 0 before Apply');
      const m=group.slots[0];commands.push(['setPreset',[m,{...patchOf(modulator),directLevel:0,frequencyHz:frequency*config.fm.ratio}]],['setPreset',[c,{...patchOf(carrier),frequencyHz:frequency,modulation:{depth:config.fm.depth,xOffset:63,yOffset:63,writeInhibit:false}}]],['keyOn',[m]],['keyOn',[c]]);
    }else commands.push(['setPreset',[c,{...patchOf(carrier),frequencyHz:frequency}]],['keyOn',[c]]);
    return commands;
  }
  noteOn(id,midi){
    if(typeof id!=='string'||!id.length||id.length>128||this.groups.has(id))throw new TypeError('Invalid or duplicate voice identity');
    if(!Number.isInteger(midi)||midi<0||midi>127)throw new RangeError('MIDI note must be 0..127');
    const pool=this.config.mode==='fm2'?Array.from({length:15},(_,i)=>[2+i*2,3+i*2]):Array.from({length:30},(_,i)=>[i+2]);
    const used=new Set([...this.groups.values()].flatMap(g=>g.slots));
    let slots=pool.find(pair=>pair.every(s=>!used.has(s))),victim;
    if(!slots){victim=[...this.groups.values()].sort((a,b)=>Number(a.held)-Number(b.held)||a.order-b.order)[0];slots=victim.slots;}
    const group={id,midi,slots:[...slots],held:true,order:++this.sequence,mode:this.config.mode};
    const commands=this.#noteCommands(this.synth,this.config,group);this.#check(commands);
    this.#apply(commands);if(victim)this.groups.delete(victim.id);this.groups.set(id,group);
    return {slots:[...slots],stolenId:victim?.id??null};
  }
  noteOff(id){const group=this.groups.get(id);if(!group||!group.held)return false;this.#apply(group.slots.map(slot=>['keyOff',[slot]]));group.held=false;return true;}
  stopVoices(){
    this.synth.stopVoices();this.groups.clear();
    for(let slot=2;slot<32;slot++)this.synth.setPreset(slot,{sample:null,modulation:{depth:0}});
    return true;
  }
  setConfig(patch){
    if(!patch||typeof patch!=='object'||Array.isArray(patch)||Object.keys(patch).some(k=>!['mode','fm','transpose'].includes(k)))throw new TypeError('Invalid voice settings');
    if(patch.fm!==undefined&&(!patch.fm||typeof patch.fm!=='object'||Array.isArray(patch.fm)||Object.keys(patch.fm).some(k=>!['depth','ratio'].includes(k))))throw new TypeError('Invalid FM settings');
    const next=settings({...this.config,...patch,fm:{...this.config.fm,...patch.fm}}),commands=[];
    if(next.mode===this.config.mode)for(const group of this.groups.values()){
      const c=group.slots.at(-1),frequency=hz(group.midi,next.transpose);
      commands.push(['setFrequency',[c,frequency]]);
      if(group.mode==='fm2')commands.push(['setFrequency',[group.slots[0],frequency*next.fm.ratio]],['setModulation',[c,{depth:next.fm.depth}]]);
    }
    this.#check(commands,next);
    if(next.mode!==this.config.mode)this.stopVoices();else this.#apply(commands);
    this.config=next;return clone(next);
  }
  invoke(method,args=[]){
    const slot=sourceSlot(args[0]);
    if(method==='getPCM'){
      const voice=this.synth.getState().slots[slot],sample=voice.sample,bytes=this.core.readRam(sample.address,sample.length*sample.bits/8),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
      return {voice,sample,pcm:sample.bits===8?Int8Array.from(bytes,v=>v>127?v-256:v):Int16Array.from({length:sample.length},(_,i)=>view.getInt16(i*2,false))};
    }
    if(method==='applyPCM'){
      const [_,pcm,options]=args;
      if(slot===0&&this.config.mode==='fm2'&&options.loopStartSamples!==0)throw new RangeError('FM carrier needs a full forward loop: set loop start to 0 before Apply');
      const prepared=pcmOptions({options},slot===0?'carrier':'modulator'),check=createScspValidation();
      try{check._copyTransportState(this.synth);check._editPCM(slot,pcm,prepared);for(const [method,args]of this.#noteCommands(check,this.config,{midi:69,slots:this.config.mode==='fm2'?[2,3]:[2]}))check[method](...scspCommandArgs(check,method,args));}finally{check.dispose();}
      return this.synth._editPCM(slot,pcm,prepared);
    }
    if(!['setEnvelope','setMix','setLfo','setPreset'].includes(method))throw new Error('Unsupported operator edit');
    const patch=clone(args[1]);
    if(patch.modulation!==undefined)throw new TypeError('Use the paired FM depth control');
    if(slot===1&&patch.directLevel!==undefined&&patch.directLevel!==0)throw new RangeError('Modulator direct level is fixed at 0; TL controls modulation strength');
    if(method==='setPreset'&&patch.sample)patch.sample=this.synth._resolveSample(patch.sample);
    const commands=[[method,[slot,patch]]];
    if(['setMix','setLfo'].includes(method))for(const group of this.groups.values()){
      const target=slot===0?group.slots.at(-1):group.mode==='fm2'?group.slots[0]:null;
      if(target!==null)commands.push([method,[target,patch]]);
    }
    this.#check(commands);this.#apply(commands);return true;
  }
  exportPatch(){return writePatch(this.config,{carrier:this.invoke('getPCM',[0]),modulator:this.invoke('getPCM',[1])});}
  loadPatch(value){
    const patch=readPatch(value); // complete validation before Stop or RAM reset
    this.stopVoices();this.synth.reset({clearRam:true});
    for(const [kind,slot]of [['carrier',0],['modulator',1]]){
      const operator=patch.operators[kind],sample=this.synth.loadPCM(operator.pcm,pcmOptions(operator,kind));this.synth.setPreset(slot,{...operator.voice,sample,directLevel:slot===1?0:operator.voice.directLevel});
    }
    this.config=settings(patch);return true;
  }
  read(){const state=this.synth.getState();return {...state,kind:'scsp',config:clone(this.config),voiceCapacity:this.config.mode==='fm2'?15:30,voiceGroups:[...this.groups.values()].map(g=>clone(g)),channels:state.slots.map((v,channel)=>({...v,channel,type:'scsp-pcm',active:v.gate}))};}
  dispose(){this.groups.clear();this.synth.dispose();}
}

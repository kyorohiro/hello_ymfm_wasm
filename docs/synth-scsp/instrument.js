// SPDX-License-Identifier: BSD-3-Clause
// Software voice grouping over the unchanged hardware slot synthesizer.
import {ScspSynth,createScspInitSample} from '../js/scspsynth.js';
const createScspValidation=()=>new ScspSynth({sampleRate:44100,reset(){},write(){},loadRam(){},renderInto(){},dispose(){}});
const scspCommandArgs=(synth,method,args)=>method==='setPreset'&&args[1]?.sample?[args[0],{...args[1],sample:synth._resolveSample(args[1].sample)}]:args;
import {settings,pcmOptions,readPatch,writePatch,FM_MAX_DEPTH} from './patch.js';
import {DspDelay,reserveDspRam,DSP_RAM_BYTES} from './dsp.js';
import {SOURCE_COUNT,OPERATOR_KEYS,operatorCount,routing,voiceCommands,operatorSlot} from './routing.js';
const clone=v=>Array.isArray(v)?v.map(clone):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,clone(x)])):v;
const sourceSlot=n=>{if(!Number.isInteger(n)||n<0||n>=SOURCE_COUNT)throw new RangeError('Choose operator A–F');return n;};
const hz=(midi,transpose)=>440*2**((midi-69+transpose)/12);
export class SynthInstrument {
  constructor(core){
    this.core=core;this.synth=new ScspSynth(core);this.config=settings({mode:'pcm',fm:{depth:9,ratio:2},transpose:0});this.groups=new Map();this.sequence=0;
    this.reserved=reserveDspRam(this.synth);this.effect=new DspDelay(core,this.config.effect);
    const {pcm,options}=createScspInitSample();
    for(let slot=0;slot<SOURCE_COUNT;slot++){
      const sample=this.synth.loadPCM(pcm,{...options,modulationDepth:FM_MAX_DEPTH});
      this.synth.setPreset(slot,{sample,totalLevel:slot===0?12:0});
    }
  }
  #check(commands,config=this.config){
    const check=createScspValidation();try{
      check._adoptState(this.synth.getState());for(const [method,args]of commands)check[method](...scspCommandArgs(check,method,args));
      // Also validate the next voice at A4, before changing authoring metadata.
      for(const [method,args]of voiceCommands(check,config,{midi:69,slots:Array.from({length:operatorCount(config.mode)},(_,i)=>SOURCE_COUNT+i)}))check[method](...scspCommandArgs(check,method,args));
    }finally{check.dispose();}
  }
  #routeEffect(){const outputs=routing(this.config).outputs;this.effect.route([...this.groups.values()].flatMap(group=>outputs.map(index=>operatorSlot(group,index))));}
  #apply(commands){for(const [method,args]of commands)this.synth[method](...args);}
  setEffect(patch){const effect=this.effect.configure(patch);this.config={...this.config,effect};this.#routeEffect();return effect;}
  noteOn(id,midi){
    if(typeof id!=='string'||!id.length||id.length>128||this.groups.has(id))throw new TypeError('Invalid or duplicate voice identity');
    if(!Number.isInteger(midi)||midi<0||midi>127)throw new RangeError('MIDI note must be 0..127');
    const count=operatorCount(this.config.mode),pool=Array.from({length:Math.floor((32-SOURCE_COUNT)/count)},(_,i)=>Array.from({length:count},(_,j)=>SOURCE_COUNT+i*count+j));
    const used=new Set([...this.groups.values()].flatMap(g=>g.slots));
    let slots=pool.find(pair=>pair.every(s=>!used.has(s))),victim;
    if(!slots){victim=[...this.groups.values()].sort((a,b)=>Number(a.held)-Number(b.held)||a.order-b.order)[0];slots=victim.slots;}
    const group={id,midi,slots:[...slots],held:true,order:++this.sequence,mode:this.config.mode};
    const commands=voiceCommands(this.synth,this.config,group);this.#check(commands);
    this.#apply(commands);if(victim)this.groups.delete(victim.id);this.groups.set(id,group);this.#routeEffect();
    return {slots:[...slots],stolenId:victim?.id??null};
  }
  noteOff(id){const group=this.groups.get(id);if(!group||!group.held)return false;this.#apply(group.slots.map(slot=>['keyOff',[slot]]));group.held=false;return true;}
  stopVoices(){
    this.synth.stopVoices();this.groups.clear();
    for(let slot=SOURCE_COUNT;slot<32;slot++)this.synth.setPreset(slot,{sample:null,modulation:{depth:0}});
    this.effect.install();this.#routeEffect();return true;
  }
  setConfig(patch){
    if(!patch||typeof patch!=='object'||Array.isArray(patch)||Object.keys(patch).some(k=>!['mode','fm','transpose'].includes(k)))throw new TypeError('Invalid voice settings');
    if(patch.fm!==undefined&&(!patch.fm||typeof patch.fm!=='object'||Array.isArray(patch.fm)||Object.keys(patch.fm).some(k=>!['depth','ratio','ratios','algorithm'].includes(k))))throw new TypeError('Invalid FM settings');
    const fm={...this.config.fm,...patch.fm};
    if(patch.fm?.ratio!==undefined&&patch.fm.ratios===undefined)fm.ratios=[1,...Array(5).fill(patch.fm.ratio)];
    const next=settings({...this.config,...patch,fm}),commands=[],routeChanged=next.mode!==this.config.mode||next.fm.algorithm!==this.config.fm.algorithm;
    if(!routeChanged)for(const group of this.groups.values()){
      const frequency=hz(group.midi,next.transpose),{inputs}=routing(next);
      for(let index=0;index<group.slots.length;index++){
        const slot=operatorSlot(group,index);
        commands.push(['setFrequency',[slot,frequency*(next.mode==='pcm'?1:next.fm.ratios[index])]]);
        if(inputs[index].length)commands.push(['setModulation',[slot,{depth:next.fm.depth}]]);
      }
    }
    this.#check(commands,next);
    if(routeChanged)this.stopVoices();else this.#apply(commands);
    this.config=next;this.#routeEffect();return clone(next);
  }
  invoke(method,args=[]){
    const slot=sourceSlot(args[0]);
    if(method==='getPCM'){
      const voice=this.synth.getState().slots[slot],sample=voice.sample,bytes=this.core.readRam(sample.address,sample.length*sample.bits/8),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
      return {voice,sample,pcm:sample.bits===8?Int8Array.from(bytes,v=>v>127?v-256:v):Int16Array.from({length:sample.length},(_,i)=>view.getInt16(i*2,false))};
    }
    if(method==='applyPCM'){
      const [_,pcm,options]=args;
      if(routing(this.config).inputs[slot]?.length&&options.loopStartSamples!==0)throw new RangeError('FM input needs a full forward loop (loop start 0) before Apply');
      const prepared=pcmOptions({options}),check=createScspValidation();
      try{check._copyTransportState(this.synth);check._editPCM(slot,pcm,prepared);for(const [method,args]of voiceCommands(check,this.config,{midi:69,slots:Array.from({length:operatorCount(this.config.mode)},(_,i)=>SOURCE_COUNT+i)}))check[method](...scspCommandArgs(check,method,args));}finally{check.dispose();}
      return this.synth._editPCM(slot,pcm,prepared);
    }
    if(!['setEnvelope','setMix','setLfo','setPreset'].includes(method))throw new Error('Unsupported operator edit');
    const patch=clone(args[1]);
    if(patch.modulation!==undefined)throw new TypeError('Use the voice FM depth control');
    if(method==='setPreset'&&patch.sample){patch.sample=this.synth._resolveSample(patch.sample);if(patch.sample===this.reserved)throw new RangeError('DSP ring is not a playable sample');}
    const commands=[[method,[slot,patch]]];
    if(['setMix','setLfo'].includes(method))for(const group of this.groups.values()){
      const target=operatorSlot(group,slot);
      if(target!==null){const live={...patch};if(method==='setMix'&&!routing(this.config).outputs.includes(slot))live.directLevel=0;commands.push([method,[target,live]]);}
    }
    this.#check(commands);this.#apply(commands);this.#routeEffect();return true;
  }
  exportPatch(){return writePatch(this.config,Object.fromEntries(OPERATOR_KEYS.map((key,slot)=>[key,this.invoke('getPCM',[slot])])));}
  loadPatch(value){
    const patch=readPatch(value); // complete validation before Stop or RAM reset
    this.stopVoices();this.synth.reset({clearRam:true});this.reserved=reserveDspRam(this.synth);
    for(const [slot,kind]of OPERATOR_KEYS.entries()){
      const operator=patch.operators[kind],sample=this.synth.loadPCM(operator.pcm,pcmOptions(operator));this.synth.setPreset(slot,{...operator.voice,sample});
    }
    this.config=settings(patch);this.effect.settings=this.config.effect;this.effect.install();this.#routeEffect();return true;
  }
  read(){const state=this.synth.getState();return {...state,samples:state.samples.filter(sample=>sample.id!==this.reserved.id),dspRamBytes:DSP_RAM_BYTES,kind:'scsp',config:clone(this.config),voiceCapacity:Math.floor((32-SOURCE_COUNT)/operatorCount(this.config.mode)),sourceCount:SOURCE_COUNT,routing:routing(this.config),voiceGroups:[...this.groups.values()].map(g=>clone(g)),channels:state.slots.map((v,channel)=>({...v,channel,type:'scsp-pcm',active:v.gate}))};}
  dispose(){this.groups.clear();this.synth.dispose();}
}

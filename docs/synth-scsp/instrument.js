// SPDX-License-Identifier: BSD-3-Clause
// Software voice grouping over the unchanged hardware slot synthesizer.
import {ScspSynth,createScspInitSample} from '../js/scspsynth.js';
const createScspValidation=()=>new ScspSynth({sampleRate:44100,reset(){},write(){},loadRam(){},renderInto(){},dispose(){}});
const scspCommandArgs=(synth,method,args)=>method==='setPreset'&&args[1]?.sample?[args[0],{...args[1],sample:synth._resolveSample(args[1].sample)}]:args;
import {settings,pcmOptions,readPatch,writePatch,FM_MAX_DEPTH} from './patch.js';
import {DspDelay,reserveDspRam,DSP_RAM_BYTES} from './dsp.js';
import {SOURCE_COUNT,OPERATOR_KEYS,operatorCount,routing,voiceCommands,operatorSlot} from './routing.js';
import {noteToHz} from '../js/soundchip_pitch.js';
import {validateScspCodeCall,scspCodeCancelled} from './code_endpoint.js';
const clone=v=>Array.isArray(v)?v.map(clone):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,clone(x)])):v;
const sourceSlot=n=>{if(!Number.isInteger(n)||n<0||n>=SOURCE_COUNT)throw new RangeError('Choose operator A–F');return n;};
const hz=(midi,transpose)=>440*2**((midi-69+transpose)/12);
export class SynthInstrument {
  constructor(core){
    this.core=core;this.synth=new ScspSynth(core);this.config=settings({mode:'pcm',fm:{depth:9,ratio:2},transpose:0});this.groups=new Map();this.sequence=0;this.pitchBend=0;
    this.codeSession=0;this.codeActive=false;this.codeLanes=Array.from({length:32},()=>({midi:69,id:null}));
    this.reserved=reserveDspRam(this.synth);this.effect=new DspDelay(core,this.config.effect);
    const {pcm,options}=createScspInitSample();
    for(let slot=0;slot<SOURCE_COUNT;slot++){
      const sample=this.synth.loadPCM(pcm,{...options,modulationDepth:FM_MAX_DEPTH});
      this.synth.setPreset(slot,{sample,totalLevel:slot===0?12:0});
    }
  }
  #voiceConfig(config=this.config,pitchBend=this.pitchBend){return {...config,transpose:config.transpose+pitchBend};}
  #check(commands,config=this.config,pitchBend=this.pitchBend){
    const check=createScspValidation();try{
      check._adoptState(this.synth.getState());for(const [method,args]of commands)check[method](...scspCommandArgs(check,method,args));
      // Also validate the next voice at A4, before changing authoring metadata.
      for(const [method,args]of voiceCommands(check,this.#voiceConfig(config,pitchBend),{midi:69,slots:Array.from({length:operatorCount(config.mode)},(_,i)=>SOURCE_COUNT+i)}))check[method](...scspCommandArgs(check,method,args));
    }finally{check.dispose();}
  }
  #routeEffect(){this.effect.route([...this.groups.values()].flatMap(group=>routing(group.config??this.config).outputs.map(index=>operatorSlot(group,index))));}
  #apply(commands){for(const [method,args]of commands)this.synth[method](...args);}
  setEffect(patch){const effect=this.effect.configure(patch);this.config={...this.config,effect};this.#routeEffect();return effect;}
  #bendCommands(semitones){
    const commands=[];
    for(const group of this.groups.values()){
      const config=group.config??this.config,frequency=hz(group.midi,config.transpose+semitones);
      for(let index=0;index<group.slots.length;index++)commands.push(['setFrequency',[operatorSlot(group,index),frequency*(config.mode==='pcm'?1:config.fm.ratios[index])]]);
    }
    return commands;
  }
  /** Transient performance bend. Portable preset transpose stays integer. */
  setPitchBend(semitones){
    if(!Number.isFinite(semitones)||semitones< -2||semitones>2)throw new RangeError('Pitch bend must be finite -2..2 semitones');
    const commands=this.#bendCommands(semitones);
    this.#check(commands,this.config,semitones);this.#apply(commands);this.pitchBend=semitones;return semitones;
  }
  noteOn(id,midi){
    if(typeof id!=='string'||!id.length||id.length>128||this.groups.has(id))throw new TypeError('Invalid or duplicate voice identity');
    if(!Number.isInteger(midi)||midi<0||midi>127)throw new RangeError('MIDI note must be 0..127');
    return this.#attack(id,midi,{kind:'keyboard'});
  }
  #silence(group){
    // A per-group Stop must never reset the shared SCSP, DSP or keyboard.
    // Keep native sample references pinned until these slots are retriggered.
    for(const slot of group.slots){this.synth.keyOff(slot);this.synth.setMix(slot,{directLevel:0});this.synth.setModulation(slot,{depth:0});this.synth.setPreset(slot,{sample:null});}
  }
  #attack(id,midi,owner){
    const count=operatorCount(this.config.mode),pool=Array.from({length:Math.floor((32-SOURCE_COUNT)/count)},(_,i)=>Array.from({length:count},(_,j)=>SOURCE_COUNT+i*count+j));
    const previous=this.groups.get(id),victims=previous?[previous]:[],candidates=[...this.groups.values()].filter(g=>g!==previous).sort((a,b)=>Number(a.held)-Number(b.held)||a.order-b.order);
    const free=()=>{const used=new Set([...this.groups.values()].filter(g=>!victims.includes(g)).flatMap(g=>g.slots));return pool.find(pair=>pair.every(s=>!used.has(s)));};
    let slots=free();while(!slots&&candidates.length){victims.push(candidates.shift());slots=free();}
    if(!slots)throw new RangeError('No SCSP voice group is available');
    const group={id,midi,slots:[...slots],held:true,order:this.sequence+1,mode:this.config.mode,config:clone(this.config),owner};
    const commands=voiceCommands(this.synth,this.#voiceConfig(),group);this.#check(commands);
    for(const victim of victims){this.#silence(victim);this.groups.delete(victim.id);}
    this.#apply(commands);this.sequence++;this.groups.set(id,group);this.#routeEffect();
    return {slots:[...slots],stolenId:victims.find(v=>v!==previous)?.id??null};
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
      const live={...(group.config??this.config),transpose:next.transpose,fm:{...(group.config??this.config).fm,depth:next.fm.depth,ratios:next.fm.ratios}},frequency=hz(group.midi,next.transpose+this.pitchBend),{inputs}=routing(live);
      for(let index=0;index<group.slots.length;index++){
        const slot=operatorSlot(group,index);
        commands.push(['setFrequency',[slot,frequency*(live.mode==='pcm'?1:next.fm.ratios[index])]]);
        if(inputs[index].length)commands.push(['setModulation',[slot,{depth:next.fm.depth}]]);
      }
    }
    this.#check(commands,next);
    if(routeChanged)this.stopVoices();else{this.#apply(commands);for(const group of this.groups.values())group.config={...(group.config??this.config),transpose:next.transpose,fm:{...(group.config??this.config).fm,depth:next.fm.depth,ratios:[...next.fm.ratios]}};}
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
      try{check._copyTransportState(this.synth);check._editPCM(slot,pcm,prepared);for(const [method,args]of voiceCommands(check,this.#voiceConfig(),{midi:69,slots:Array.from({length:operatorCount(this.config.mode)},(_,i)=>SOURCE_COUNT+i)}))check[method](...scspCommandArgs(check,method,args));}finally{check.dispose();}
      return this.synth._editPCM(slot,pcm,prepared);
    }
    if(!['setEnvelope','setMix','setLfo','setPreset'].includes(method))throw new Error('Unsupported operator edit');
    const patch=clone(args[1]);
    if(patch.modulation!==undefined)throw new TypeError('Use the voice FM depth control');
    if(method==='setPreset'&&patch.sample){patch.sample=this.synth._resolveSample(patch.sample);if(patch.sample===this.reserved)throw new RangeError('DSP ring is not a playable sample');}
    const commands=[[method,[slot,patch]]];
    if(['setMix','setLfo'].includes(method))for(const group of this.groups.values()){
      const target=operatorSlot(group,slot);
      if(target!==null){const live={...patch};if(method==='setMix'&&!routing(group.config??this.config).outputs.includes(slot))live.directLevel=0;commands.push([method,[target,live]]);}
    }
    this.#check(commands);this.#apply(commands);this.#routeEffect();return true;
  }
  exportPatch(){return writePatch(this.config,Object.fromEntries(OPERATOR_KEYS.map((key,slot)=>[key,this.invoke('getPCM',[slot])])));}
  loadPatch(value){
    const patch=readPatch(value); // complete validation before Stop or RAM reset
    if(this.codeActive){
      // Running Code keeps its session and current sample references. Stage the
      // entire replacement against the same protected editor pool before writes.
      const replace=(synth,slot,op)=>{
        // Validate the replacement against its own pitch/LFO, rather than the
        // previous source's unrelated settings. This only changes metadata;
        // native voices retain their separately tracked sample references.
        synth.setPreset(slot,{...op.voice,sample:null});
        const sample=synth._editPCM(slot,op.pcm,pcmOptions(op));synth.setPreset(slot,{...op.voice,sample});
      };
      const check=createScspValidation(),neutralCommands=this.#bendCommands(0);
      try{
        check._copyTransportState(this.synth);
        for(const [slot,key]of OPERATOR_KEYS.entries())replace(check,slot,patch.operators[key]);
        for(const [method,args]of neutralCommands)check[method](...args);
        for(const [method,args]of voiceCommands(check,patch,{midi:69,slots:Array.from({length:operatorCount(patch.mode)},(_,i)=>SOURCE_COUNT+i)}))check[method](...scspCommandArgs(check,method,args));
      }finally{check.dispose();}
      for(const [slot,key]of OPERATOR_KEYS.entries())replace(this.synth,slot,patch.operators[key]);
      this.#apply(neutralCommands);this.pitchBend=0;
      this.config=settings(patch);this.effect.configure(this.config.effect);this.#routeEffect();return true;
    }
    this.stopVoices();this.synth.reset({clearRam:true});this.reserved=reserveDspRam(this.synth);
    for(const [slot,kind]of OPERATOR_KEYS.entries()){
      const operator=patch.operators[kind],sample=this.synth.loadPCM(operator.pcm,pcmOptions(operator));this.synth.setPreset(slot,{...operator.voice,sample});
    }
    this.config=settings(patch);this.pitchBend=0;this.effect.settings=this.config.effect;this.effect.install();this.#routeEffect();return true;
  }
  beginCode(...args){
    if(args.length)throw new TypeError('Code session takes no arguments');
    if(this.codeActive)this.endCode(this.codeSession);
    this.codeActive=true;this.codeLanes=Array.from({length:32},()=>({midi:69,id:null}));
    return {session:++this.codeSession,channels:32,operators:SOURCE_COUNT,sampleRate:44100};
  }
  #codeGroup(channel){const lane=this.codeLanes[channel],group=this.groups.get(lane.id);return group?.owner?.kind==='code'&&group.owner.session===this.codeSession?group:null;}
  #stopCodeGroups(session){
    let changed=false;
    for(const group of [...this.groups.values()])if(group.owner?.kind==='code'&&group.owner.session===session){this.#silence(group);this.groups.delete(group.id);changed=true;}
    this.#routeEffect();return changed;
  }
  endCode(session){if(!this.codeActive||session!==this.codeSession)return false;this.#stopCodeGroups(session);this.codeActive=false;return true;}
  code(session,method,args=[]){
    if(!this.codeActive||session!==this.codeSession)throw scspCodeCancelled();
    validateScspCodeCall(method,args);
    if(method==='getState')return this.read();
    if(method==='dispose')return this.endCode(session);
    if(method==='allNotesOff'){for(const group of this.groups.values())if(group.owner?.kind==='code'&&group.owner.session===session)this.noteOff(group.id);return true;}
    if(method==='loadPCM')return this.synth.loadPCM(...args);
    if(['getPCM','applyPCM','setPreset','setEnvelope','setMix','setLfo'].includes(method))return this.invoke(method,args);
    if(['setConfig','setEffect','exportPatch','loadPatch'].includes(method))return this[method](...args);
    const [channel,value]=args,lane=this.codeLanes[channel],group=this.#codeGroup(channel);
    if(method==='noteOff'||method==='keyOff')return group?this.noteOff(group.id):false;
    if(method==='noteOn'||method==='keyOn'){
      const midi=method==='noteOn'?69+12*Math.log2(noteToHz(value)/440):lane.midi,id=`code:${session}:${channel}`;
      const result=this.#attack(id,midi,{kind:'code',session,channel});lane.midi=midi;lane.id=id;return result;
    }
    const frequency=method==='setNote'?noteToHz(value):value,midi=69+12*Math.log2(frequency/440),config=group?.config??this.config,commands=[];
    if(group)for(let index=0;index<group.slots.length;index++)commands.push(['setFrequency',[operatorSlot(group,index),frequency*2**((config.transpose+this.pitchBend)/12)*(config.mode==='pcm'?1:config.fm.ratios[index])]]);
    else for(const [method,args]of voiceCommands(this.synth,this.#voiceConfig(),{midi,slots:Array.from({length:operatorCount(this.config.mode)},(_,i)=>SOURCE_COUNT+i)}))if(method==='setPreset')commands.push([method,args]);
    this.#check(commands);if(group){this.#apply(commands);group.midi=midi;}lane.midi=midi;return frequency;
  }
  readAuthoring(sampleKeys=[]){
    if(!Array.isArray(sampleKeys)||sampleKeys.length>SOURCE_COUNT||sampleKeys.some(key=>key!==null&&typeof key!=='string'))throw new TypeError('Expected up to six cached sample keys');
    const state=this.read(),operators=Array.from({length:SOURCE_COUNT},(_,slot)=>{const sample=state.slots[slot].sample;return sampleKeys[slot]===`${sample.bankId}:${sample.id}`?null:this.invoke('getPCM',[slot]);});
    return {state,operators};
  }
  read(){const state=this.synth.getState();return {...state,samples:state.samples.filter(sample=>sample.id!==this.reserved.id),dspRamBytes:DSP_RAM_BYTES,kind:'scsp',config:clone(this.config),pitchBend:this.pitchBend,voiceCapacity:Math.floor((32-SOURCE_COUNT)/operatorCount(this.config.mode)),sourceCount:SOURCE_COUNT,routing:routing(this.config),voiceGroups:[...this.groups.values()].map(g=>clone(g)),codeActive:this.codeActive,codeSession:this.codeSession,codeLanes:this.codeLanes.map((lane,channel)=>({channel,midi:lane.midi,groupId:this.#codeGroup(channel)?.id??null,slots:[...(this.#codeGroup(channel)?.slots??[])]})),channels:state.slots.map((v,channel)=>({...v,channel,type:'scsp-pcm',active:v.gate}))};}
  dispose(){this.groups.clear();this.synth.dispose();}
}

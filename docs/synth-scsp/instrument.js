// SPDX-License-Identifier: BSD-3-Clause
// Software voice grouping over the unchanged hardware slot synthesizer.
import {ScspSynth,createScspInitSample} from '../js/scspsynth.js';
const createScspValidation=()=>new ScspSynth({sampleRate:44100,reset(){},write(){},loadRam(){},renderInto(){},dispose(){}});
const scspCommandArgs=(synth,method,args)=>method==='setPreset'&&args[1]?.sample?[args[0],{...args[1],sample:synth._resolveSample(args[1].sample)}]:args;
import {settings,pcmOptions,readPatch,writePatch,FM_MAX_DEPTH} from './patch.js?v=scsp-fm-self-1';
import {DspDelay,reserveDspRam,DSP_RAM_BYTES} from './dsp.js?v=scsp-dsp-ui-routing-1';
import {SOURCE_COUNT,OPERATOR_KEYS,operatorCount,routing,voiceCommands,operatorSlot,customOperatorSlots,customRouting,resizeCustomRouting,operatorDepth,operatorDepths} from './routing.js?v=scsp-fm-self-1';
import {noteToHz} from '../js/soundchip_pitch.js';
import {validateScspCodeCall,scspCodeCancelled} from './code_endpoint.js?v=scsp-dsp-code-1';
import {ScspReleaseGuard} from './release_guard.js';
const clone=v=>Array.isArray(v)?v.map(clone):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,clone(x)])):v;
const sourceSlot=n=>{if(!Number.isInteger(n)||n<0||n>=SOURCE_COUNT)throw new RangeError('Choose operator A–F');return n;};
const physicalSlot=n=>{if(!Number.isInteger(n)||n<0||n>=32)throw new RangeError('Choose physical SCSP slot 0–31');return n;};
const hz=(midi,transpose)=>440*2**((midi-69+transpose)/12);
const IDLE_RAM_BYTES=524288;
const idleInteger=(value,minimum,maximum,name)=>{if(!Number.isSafeInteger(value)||value<minimum||value>maximum)throw new RangeError(`Idle ${name} must be ${minimum}..${maximum}`);};
const sameIdleSample=(a,b)=>!!a&&!!b&&Object.keys(a).length===Object.keys(b).length&&Object.keys(a).every(key=>Object.hasOwn(b,key)&&a[key]===b[key]);
function dspSendPatch(patch,current){
  if(patch===null)return null;
  if(!patch||typeof patch!=='object'||Array.isArray(patch)||Reflect.ownKeys(patch).some(key=>!['input','level'].includes(key)))throw new TypeError('Invalid DSP send settings');
  const values={...patch},next={...(typeof current==='function'?current():current),...values};
  if(!Number.isInteger(next.input)||next.input<0||next.input>1)throw new RangeError('DSP input must be 0 or 1');
  if(!Number.isInteger(next.level)||next.level<0||next.level>7)throw new RangeError('DSP Send level must be 0..7');
  return next;
}
function dspRoutingState(value){
  if(!value||typeof value!=='object'||Reflect.ownKeys(value).length!==2||!Object.hasOwn(value,'overrides')||!Object.hasOwn(value,'returns'))throw new TypeError('Invalid idle DSP routing state');
  const overrides=value.overrides;
  if(!overrides||typeof overrides!=='object'||Reflect.ownKeys(overrides).length!==2||!Object.hasOwn(overrides,'sources')||!Object.hasOwn(overrides,'slots'))throw new TypeError('Invalid idle DSP routing overrides');
  const arrays={};
  for(const [key,count]of [['sources',SOURCE_COUNT],['slots',32]]){
    const input=overrides[key];if(!Array.isArray(input)||input.length!==count||Reflect.ownKeys(input).length!==count+1)throw new TypeError('Invalid idle DSP routing '+key);
    arrays[key]=Array.from(input,entry=>{if(entry!==null&&(!entry||Reflect.ownKeys(entry).length!==2||!Object.hasOwn(entry,'input')||!Object.hasOwn(entry,'level')))throw new TypeError('Incomplete idle DSP send');return dspSendPatch(entry,{input:0,level:0});});
  }
  if(!Array.isArray(value.returns)||value.returns.length!==2||Reflect.ownKeys(value.returns).length!==3)throw new TypeError('Invalid idle DSP returns');
  const returns=Array.from(value.returns,entry=>{
    if(!entry||typeof entry!=='object'||Reflect.ownKeys(entry).length!==2||!Object.hasOwn(entry,'level')||!Object.hasOwn(entry,'pan'))throw new TypeError('Invalid idle DSP return');
    const value={level:entry.level,pan:entry.pan};
    if(!Number.isInteger(value.level)||value.level<0||value.level>7||!Number.isInteger(value.pan)||value.pan<0||value.pan>31)throw new TypeError('Invalid idle DSP return');
    return value;
  });
  return {overrides:arrays,returns};
}
function validateIdleTransport(state){
  if(!state||state.sampleRate!==44100||!Array.isArray(state.slots)||state.slots.length!==32||state.slots.some(voice=>voice?.gate!==false))throw new TypeError('Idle state requires 32 released requested slots');
  for(const key of ['playingFrequencies','playingLfos','playingModulations','playingSampleIds'])if(!Array.isArray(state[key])||state[key].length!==32||state[key].some(value=>value!==null))throw new TypeError('Idle state cannot contain playing references');
}
function validateIdleResources(state,reserved){
  if(typeof state.bankId!=='string'||!state.bankId.length||state.bankId.length>256)throw new TypeError('Invalid idle sample bank');
  idleInteger(state.ramUsedBytes,0,IDLE_RAM_BYTES,'RAM use');
  if(state.ramFreeBytes!==IDLE_RAM_BYTES-state.ramUsedBytes)throw new RangeError('Invalid idle free RAM');
  idleInteger(state.nextSampleId,1,Number.MAX_SAFE_INTEGER,'next sample ID');
  if(!Array.isArray(state.samples)||!state.samples.length||state.samples.length>Math.floor(IDLE_RAM_BYTES/3))throw new TypeError('Invalid idle sample resources');
  const samples=new Map(),ranges=[],allowed=['bankId','id','address','allocationAddress','modulationDepth','byteLength','length','bits','editorOwned','rootFrequencyHz','sourceSampleRate','loopStartSamples'];
  for(const sample of state.samples){
    if(!sample||typeof sample!=='object'||Reflect.ownKeys(sample).some(key=>!allowed.includes(key))||sample.bankId!==state.bankId)throw new TypeError('Invalid idle sample metadata');
    idleInteger(sample.id,1,state.nextSampleId-1,'sample ID');if(samples.has(sample.id))throw new TypeError('Duplicate idle sample ID');
    if(![8,16].includes(sample.bits))throw new TypeError('Invalid idle PCM format');
    idleInteger(sample.length,2,65535,'sample length');
    if(!Number.isFinite(sample.rootFrequencyHz)||sample.rootFrequencyHz<=0||!Number.isFinite(sample.sourceSampleRate)||sample.sourceSampleRate<=0)throw new RangeError('Invalid idle sample tuning');
    if(sample.loopStartSamples!==null)idleInteger(sample.loopStartSamples,0,sample.length-1,'loop start');
    const depth=sample.modulationDepth??0;idleInteger(depth,0,15,'modulation padding');
    if(depth&&sample.loopStartSamples!==0)throw new RangeError('Idle modulation PCM requires a full loop');
    if(sample.editorOwned!==undefined&&sample.editorOwned!==true)throw new TypeError('Invalid idle editor ownership');
    const padding=depth?2**(depth-1):0,bytes=sample.bits/8,start=depth?sample.allocationAddress:sample.address;
    idleInteger(start,0,IDLE_RAM_BYTES-1,'allocation address');
    if(start&1||sample.address!==start+padding*bytes||(!depth&&sample.allocationAddress!==undefined))throw new RangeError('Invalid idle PCM alignment or padding');
    if(sample.byteLength!==(sample.length+1+padding*2)*bytes||start+sample.byteLength>state.ramUsedBytes)throw new RangeError('Idle PCM exceeds its reserved RAM range');
    samples.set(sample.id,sample);ranges.push({start,end:start+sample.byteLength});
  }
  ranges.sort((a,b)=>a.start-b.start);for(let i=1;i<ranges.length;i++)if(ranges[i].start<ranges[i-1].end)throw new RangeError('Idle sample allocations overlap');
  const ring=samples.get(reserved?.id);
  if(!sameIdleSample(ring,reserved)||ring.address!==0||ring.bits!==16||ring.length!==DSP_RAM_BYTES/2-1||ring.byteLength!==DSP_RAM_BYTES||ring.loopStartSamples!==null||ring.modulationDepth||ring.editorOwned||ring.rootFrequencyHz!==440||ring.sourceSampleRate!==44100)throw new TypeError('Idle DSP RAM reservation is missing or invalid');
  for(let slot=0;slot<32;slot++){
    const sample=state.slots[slot].sample;
    if(sample!==null&&(!sameIdleSample(sample,samples.get(sample?.id))||sample.id===ring.id))throw new TypeError('Idle slot has an invalid sample reference');
    if(slot<SOURCE_COUNT&&!sample)throw new TypeError('Idle Auto sources need PCM');
  }
}
export class SynthInstrument {
  constructor(core){
    this.core=core;this.synth=new ScspSynth(core);this.releaseGuard=new ScspReleaseGuard(core);this.config=settings({mode:'pcm',fm:{depth:9,ratio:2},transpose:0});this.groups=new Map();this.manualVoices=new Map();this.sequence=0;this.pitchBend=0;
    this.codeSession=0;this.codeActive=false;this.codeLanes=Array.from({length:32},()=>({midi:69,id:null}));
    this.dspSourceSends=Array(SOURCE_COUNT).fill(null);this.dspSlotSends=Array(32).fill(null);this.dspRoutingActive=false;
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
  #sourceForSlot(slot){for(const group of this.groups.values())for(let index=0;index<operatorCount((group.config??this.config).mode);index++)if(operatorSlot(group,index)===slot)return index;return null;}
  #sendForSlot(slot){const source=this.#sourceForSlot(slot);return this.dspSlotSends[slot]??(source===null?null:this.dspSourceSends[source]);}
  readDspRoutingOverrides(){return {sources:clone(this.dspSourceSends),slots:clone(this.dspSlotSends)};}
  readDspRouting(){const defaults={input:0,level:this.config.effect.send};return {sources:this.dspSourceSends.map(value=>({...defaults,...value})),slots:Array.from({length:32},(_,slot)=>({...defaults,...this.#sendForSlot(slot)}))};}
  #routeEffect(){
    const state=this.synth.getState(),outputs=[...this.groups.values()].flatMap(group=>routing(group.config??this.config).outputs.map(index=>operatorSlot(group,index))).concat([...this.manualVoices.values()].filter(voice=>state.slots[voice.slot].directLevel>0).map(voice=>voice.slot));
    // Explicit sends may expose a silent modulator, but never a retired voice
    // whose gate/release is still active in hardware. Requested routes survive
    // Code Stop; only slots with a current owner retain an audible wet send.
    const owned=new Set([...this.groups.values()].flatMap(group=>group.slots).concat([...this.manualVoices.values()].map(voice=>voice.slot)));
    this.effect.route(outputs,this.dspRoutingActive?Array.from({length:32},(_,slot)=>owned.has(slot)?this.#sendForSlot(slot):null):undefined);
  }
  #changeDspRouting(change){
    const before={sources:clone(this.dspSourceSends),slots:clone(this.dspSlotSends),active:this.dspRoutingActive};
    const addresses=Array.from({length:32},(_,slot)=>slot*32+20).concat([22,54,0x702,0x780]);
    const words=typeof this.core.read==='function'?addresses.map(address=>this.core.read(address)):null;
    change();this.dspRoutingActive=true;
    try{this.#routeEffect();}
    catch(error){
      this.dspSourceSends=before.sources;this.dspSlotSends=before.slots;this.dspRoutingActive=before.active;
      const failures=[];if(words)for(let index=0;index<addresses.length;index++)try{this.core.write(addresses[index],words[index]);}catch(failure){failures.push(failure);}
      if(failures.length){const fatal=new Error('DSP routing update failed and rollback could not restore the audio owner. Restart audio before continuing.',{cause:new AggregateError([error,...failures])});fatal.name='ScspDspRollbackError';fatal.fatal=true;throw fatal;}
      throw error;
    }
  }
  setDspSend(slot,patch){
    slot=physicalSlot(slot);const next=dspSendPatch(patch,()=>this.readDspRouting().slots[slot]);
    this.#changeDspRouting(()=>{this.dspSlotSends[slot]=next;});return {...this.readDspRouting().slots[slot]};
  }
  setDspSourceSend(operator,patch){
    operator=sourceSlot(operator);const next=dspSendPatch(patch,()=>this.readDspRouting().sources[operator]);
    this.#changeDspRouting(()=>{
      this.dspSourceSends[operator]=next;
      // Auto authoring follows the same fanout as source mix controls. A later
      // Auto allocation may overwrite physical edits; manual owners stay local.
      for(const group of this.groups.values()){const slot=operatorSlot(group,operator);if(slot!==null)this.dspSlotSends[slot]=null;}
    });return {...this.readDspRouting().sources[operator]};
  }
  setDspReturn(output,patch){const value=this.effect.setReturn(output,patch);this.dspRoutingActive=true;this.config={...this.config,effect:{...this.effect.settings}};return value;}
  #resetDspRouting(){this.dspSourceSends=Array(SOURCE_COUNT).fill(null);this.dspSlotSends=Array(32).fill(null);this.dspRoutingActive=false;this.effect.resetReturns();}
  #latchRelease(slot){this.releaseGuard.keyOn(slot,typeof this.core.read==='function'?undefined:this.synth.getState().slots[slot]);}
  #apply(commands){for(const [method,args]of commands){this.synth[method](...args);if(method==='keyOn')this.#latchRelease(args[0]);}}
  setClickGuard(value){return this.releaseGuard.setEnabled(value);}
  setEffect(patch){const effect=this.effect.configure(patch);this.config={...this.config,effect};this.#routeEffect();return effect;}
  readDspProgram(){return this.effect.readProgram();}
  readDspSetup(...args){
    if(args.length)throw new TypeError('readDspSetup takes no arguments');
    return {...this.readDspProgram(),coefficients:this.readDspCoefficients(),effect:{...this.config.effect},...(this.dspRoutingActive?{dspRouting:this.readDspRouting(),dspRoutingOverrides:this.readDspRoutingOverrides(),dspReturns:this.effect.readReturns()}:{})};
  }
  applyDspProgram(words,options){
    const result=this.effect.applyProgram(words,options);
    if(options!==undefined)this.config={...this.config,effect:{...this.effect.settings}};
    return result;
  }
  readDspCoefficients(){return this.effect.readCoefficients();}
  setDspCoefficients(patch){
    const result=this.effect.setCoefficients(patch);
    this.config={...this.config,effect:{...this.effect.settings}};
    return result;
  }
  #bendCommands(semitones){
    const commands=[];
    for(const group of this.groups.values()){
      const config=group.config??this.config,frequency=hz(group.midi,config.transpose+semitones);
      for(let index=0;index<group.slots.length;index++)commands.push(['setFrequency',[operatorSlot(group,index),frequency*(config.mode==='pcm'?1:config.fm.ratios[index])]]);
    }
    for(const voice of this.manualVoices.values())commands.push(['setFrequency',[voice.slot,voice.baseFrequencyHz*2**(semitones/12)]]);
    return commands;
  }
  /** Transient performance bend. Portable preset transpose stays integer. */
  setPitchBend(semitones){
    if(!Number.isFinite(semitones)||semitones< -2||semitones>2)throw new RangeError('Pitch bend must be finite -2..2 semitones');
    const commands=this.#bendCommands(semitones);
    this.#check(commands,this.config,semitones);this.#apply(commands);this.pitchBend=semitones;return semitones;
  }
  noteOn(id,midi){
    if(typeof id!=='string'||!id.length||id.length>128||this.groups.has(id)||this.manualVoices.has(id))throw new TypeError('Invalid or duplicate voice identity');
    if(!Number.isInteger(midi)||midi<0||midi>127)throw new RangeError('MIDI note must be 0..127');
    return this.#attack(id,midi,{kind:'keyboard'});
  }
  #silence(group,{except=null,muteStack=false}={}){
    // A per-group Stop must never reset the shared SCSP, DSP or keyboard.
    // Keep native sample references pinned until these slots are retriggered.
    for(const slot of group.slots)if(slot!==except){this.releaseGuard.retire(slot);this.synth.keyOff(slot);this.synth.setMix(slot,{directLevel:0,...(muteStack?{totalLevel:255}:{})});this.synth.setModulation(slot,{depth:0});this.synth.setPreset(slot,{sample:null});}
  }
  #attack(id,midi,owner){
    if(this.manualVoices.has(id))throw new TypeError('Duplicate physical voice identity');
    const count=operatorCount(this.config.mode),pool=Array.from({length:Math.floor((32-SOURCE_COUNT)/count)},(_,i)=>Array.from({length:count},(_,j)=>SOURCE_COUNT+i*count+j));
    const previous=this.groups.get(id),victims=previous?[previous]:[],candidates=[...this.groups.values()].filter(g=>g!==previous).sort((a,b)=>Number(a.held)-Number(b.held)||a.order-b.order);
    const free=()=>{const used=new Set([...this.groups.values()].filter(g=>!victims.includes(g)).flatMap(g=>g.slots));return pool.find(pair=>pair.every(s=>!used.has(s)));};
    let slots=free();while(!slots&&candidates.length){victims.push(candidates.shift());slots=free();}
    if(!slots)throw new RangeError('No SCSP voice group is available');
    const group={id,midi,slots:[...slots],held:true,order:this.sequence+1,mode:this.config.mode,config:clone(this.config),owner};
    if(this.config.fm.algorithm==='custom')group.operatorSlots=customOperatorSlots(this.config,group.slots);
    const commands=voiceCommands(this.synth,this.#voiceConfig(),group);this.#check(commands);
    for(const victim of victims){this.#silence(victim);this.groups.delete(victim.id);}
    for(const [key,manual]of this.manualVoices)if(slots.includes(manual.slot))this.manualVoices.delete(key);
    // An actual Auto allocation owns these slots and replaces prior physical
    // routing choices with its source template / global default.
    for(const slot of slots)this.dspSlotSends[slot]=null;
    // Software voice initialization, not a change to SCSP history semantics.
    // Only a new owned self voice starts from silence; live edits preserve its
    // feedback and non-self/manual voices never clear sound-stack history.
    routing(group.config).inputs.forEach((sources,index)=>{if(sources.includes(index)){
      const slot=operatorSlot(group,index);this.core.write(0x600+slot*2,0);this.core.write(0x600+(slot+32)*2,0);
    }});
    this.#apply(commands);this.sequence++;this.groups.set(id,group);this.#routeEffect();
    return {slots:[...slots],stolenId:victims.find(v=>v!==previous)?.id??null};
  }
  #releaseGroup(id,raw=false){const group=this.groups.get(id);if(!group||!group.held)return false;for(const slot of group.slots)this.releaseGuard.release(slot,{raw});this.#apply(group.slots.map(slot=>['keyOff',[slot]]));group.held=false;return true;}
  noteOff(id){return this.#releaseGroup(id);}
  stopVoices(){
    const autoSlots=new Set([...this.groups.values()].flatMap(group=>group.slots));
    this.synth.stopVoices();this.groups.clear();this.manualVoices.clear();this.releaseGuard.clear();
    for(const slot of autoSlots)if(slot>=SOURCE_COUNT)this.synth.setPreset(slot,{sample:null,modulation:{depth:0}});
    this.effect.install();this.#routeEffect();return true;
  }
  setConfig(patch){
    if(!patch||typeof patch!=='object'||Array.isArray(patch)||Reflect.ownKeys(patch).some(k=>!['mode','fm','transpose'].includes(k)))throw new TypeError('Invalid voice settings');
    patch={...patch};
    if(patch.fm!==undefined){
      if(!patch.fm||typeof patch.fm!=='object'||Array.isArray(patch.fm)||Reflect.ownKeys(patch.fm).some(k=>!['depth','depths','ratio','ratios','algorithm','custom'].includes(k)))throw new TypeError('Invalid FM settings');
      patch.fm={...patch.fm};
      // Materialize a custom request before merging with live settings. A
      // completed nested setter in a getter must not be replaced by stale data.
      if(Object.hasOwn(patch.fm,'custom'))patch.fm.custom=customRouting(patch.fm.custom);
      if(Object.hasOwn(patch.fm,'depths'))patch.fm.depths=operatorDepths(patch.fm.depths);
    }
    const fm={...this.config.fm,...patch.fm};
    if(Object.hasOwn(patch.fm??{},'depth')&&!Object.hasOwn(patch.fm,'depths'))delete fm.depths;
    if(patch.fm?.ratio!==undefined&&patch.fm.ratios===undefined)fm.ratios=[1,...Array(5).fill(patch.fm.ratio)];
    const mode=patch.mode??this.config.mode;
    if(fm.algorithm==='custom'&&mode!=='pcm'&&!Object.hasOwn(patch.fm??{},'custom')){
      if(fm.custom)fm.custom=resizeCustomRouting(fm.custom,operatorCount(mode));
      else{
        // Enter Custom from the selected fixed template at the desired size.
        // A dormant Custom graph instead keeps its own routes when resized.
        const template=routing({mode,fm:{algorithm:this.config.fm.algorithm==='custom'?'chain':this.config.fm.algorithm}});
        fm.custom={inputs:template.inputs,outputs:template.outputs};
      }
    }
    const next=settings({...this.config,...patch,fm}),commands=[],groupConfigs=new Map(),routeChanged=next.mode!==this.config.mode||next.fm.algorithm!==this.config.fm.algorithm||next.fm.algorithm==='custom'&&JSON.stringify(next.fm.custom)!==JSON.stringify(this.config.fm.custom);
    if(!routeChanged)for(const group of this.groups.values()){
      const live={...(group.config??this.config),transpose:next.transpose,fm:{...(group.config??this.config).fm,depth:next.fm.depth,ratios:[...next.fm.ratios]}},frequency=hz(group.midi,next.transpose+this.pitchBend);
      delete live.fm.depths;if(next.fm.depths)live.fm.depths=[...next.fm.depths];
      const {inputs}=routing(live);groupConfigs.set(group,live);
      for(let index=0;index<group.slots.length;index++){
        const slot=operatorSlot(group,index);
        commands.push(['setFrequency',[slot,frequency*(live.mode==='pcm'?1:next.fm.ratios[index])]]);
        if(inputs[index].length)commands.push(['setModulation',[slot,{depth:operatorDepth(live,index)}]]);
      }
    }
    this.#check(commands,next);
    if(routeChanged){if(this.manualVoices.size){for(const group of this.groups.values())this.#silence(group,{muteStack:true});this.groups.clear();this.#routeEffect();}else this.stopVoices();}else{this.#apply(commands);for(const group of this.groups.values())group.config=groupConfigs.get(group);}
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
    if(['dspSend','dspInput'].some(key=>Object.hasOwn(patch,key)))throw new TypeError('Use setDspSourceSend for Synth DSP routing');
    if(patch.modulation!==undefined)throw new TypeError('Use the voice FM depth control');
    if(method==='setPreset'&&patch.sample){patch.sample=this.synth._resolveSample(patch.sample);if(patch.sample===this.reserved)throw new RangeError('DSP ring is not a playable sample');}
    const commands=[[method,[slot,patch]]];
    if(['setMix','setLfo'].includes(method))for(const group of this.groups.values()){
      const target=operatorSlot(group,slot);
      if(target!==null){const live={...patch};if(method==='setMix'&&!routing(group.config??this.config).outputs.includes(slot))live.directLevel=0;commands.push([method,[target,live]]);}
    }
    this.#check(commands);this.#apply(commands);this.#routeEffect();return true;
  }
  /** Inspect requested physical state only. An empty slot remains empty. */
  readPhysical(slot){
    slot=physicalSlot(slot);const voice=this.synth.getState().slots[slot],sample=voice.sample;
    if(!sample)return {slot,voice,sample:null,pcm:null};
    const bytes=this.core.readRam(sample.address,sample.length*sample.bits/8),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
    return {slot,voice,sample,pcm:sample.bits===8?Int8Array.from(bytes,v=>v>127?v-256:v):Int16Array.from({length:sample.length},(_,i)=>view.getInt16(i*2,false))};
  }
  /** Direct physical edits never fan out to the other operators / voices. */
  invokePhysical(method,args=[]){
    if(!Array.isArray(args))throw new TypeError('Physical arguments must be an array');
    const slot=physicalSlot(args[0]),arity=method==='getPCM'?1:method==='applyPCM'?3:2;
    if(args.length!==arity)throw new TypeError(`${method} takes ${arity} physical arguments`);
    if(method==='getPCM')return this.readPhysical(slot);
    if(method==='applyPCM'){
      if(slot<SOURCE_COUNT){
        const [_,pcm,options]=args,depth=options?.modulationDepth;
        if(depth!==undefined&&(!Number.isInteger(depth)||depth<0||depth>15))throw new RangeError('SCSP modulation padding must be 0..15');
        if(depth>0&&options.loopStartSamples!==0)throw new RangeError('Modulation PCM requires a full forward loop (loopStartSamples:0)');
        if(routing(this.config).inputs[slot]?.length&&options?.loopStartSamples!==0)throw new RangeError('FM input needs a full forward loop (loop start 0) before Apply');
        const prepared=pcmOptions({options}),check=createScspValidation();
        if(depth!==undefined)prepared.modulationDepth=Math.max(prepared.modulationDepth??0,depth);
        try{check._copyTransportState(this.synth);check._editPCM(slot,pcm,prepared);for(const [name,values]of voiceCommands(check,this.#voiceConfig(),{midi:69,slots:Array.from({length:operatorCount(this.config.mode)},(_,i)=>SOURCE_COUNT+i)}))check[name](...scspCommandArgs(check,name,values));}finally{check.dispose();}
        return this.synth._editPCM(slot,pcm,prepared);
      }
      const check=createScspValidation();try{check._copyTransportState(this.synth);check._editPCM(slot,args[1],args[2]);}finally{check.dispose();}
      return this.synth._editPCM(slot,args[1],args[2]);
    }
    if(!['setPreset','setEnvelope','setMix','setLfo','setModulation','setFrequency'].includes(method))throw new Error('Unsupported physical edit');
    const value=clone(args[1]);
    if(['dspSend','dspInput'].some(key=>value&&Object.hasOwn(value,key)))throw new TypeError('Use setDspSend for Synth DSP routing');
    if(method==='setPreset'&&value?.sample){value.sample=this.synth._resolveSample(value.sample);if(value.sample===this.reserved)throw new RangeError('DSP ring is not a playable sample');}
    const check=createScspValidation();try{
      check._adoptState(this.synth.getState());check[method](...scspCommandArgs(check,method,[slot,value]));
      if(slot<SOURCE_COUNT){
        const voice=check.getState().slots[slot];
        if(!voice.sample)throw new TypeError('Auto source operators need a sample');
        for(const [name,values]of voiceCommands(check,this.#voiceConfig(),{midi:69,slots:Array.from({length:operatorCount(this.config.mode)},(_,i)=>SOURCE_COUNT+i)}))check[name](...scspCommandArgs(check,name,values));
      }
    }finally{check.dispose();}
    const result=this.synth[method](slot,value);
    if(method==='setFrequency')for(const voice of this.manualVoices.values())if(voice.slot===slot)voice.baseFrequencyHz=value/2**(this.pitchBend/12);
    this.#routeEffect();return method==='setFrequency'?result:true;
  }
  /** A direct key owns one physical slot. Last key / Auto allocation wins. */
  physicalNoteOn(id,slot,midi){
    slot=physicalSlot(slot);
    if(typeof id!=='string'||!id.length||id.length>128||this.groups.has(id)||this.manualVoices.has(id))throw new TypeError('Invalid or duplicate physical voice identity');
    if(!Number.isInteger(midi)||midi<0||midi>127)throw new RangeError('MIDI note must be 0..127');
    const state=this.synth.getState(),empty=!state.slots[slot].sample;
    const voice=empty?state.slots[0]:state.slots[slot],{gate:_,...previous}=voice,preset={...previous,frequencyHz:hz(midi,this.pitchBend)};
    const check=createScspValidation();try{check._adoptState(state);check.setPreset(slot,{...preset,sample:check._resolveSample(preset.sample)});check.keyOn(slot);}finally{check.dispose();}
    const retiredGroupIds=[],stolenManualIds=[];
    for(const [key,group]of this.groups)if(group.slots.includes(slot)){this.#silence(group,{except:slot,muteStack:true});this.groups.delete(key);retiredGroupIds.push(key);}
    for(const [key,manual]of this.manualVoices)if(manual.slot===slot){this.manualVoices.delete(key);stolenManualIds.push(key);}
    this.synth.setPreset(slot,preset);this.synth.keyOn(slot);
    this.#latchRelease(slot);
    this.manualVoices.set(id,{id,slot,midi,baseFrequencyHz:hz(midi,0),held:true,order:++this.sequence});this.#routeEffect();
    return {slot,slots:[slot],initializedFromSource:empty?0:null,retiredGroupIds,stolenManualIds};
  }
  physicalNoteOff(id){const voice=this.manualVoices.get(id);if(!voice||!voice.held)return false;this.releaseGuard.release(voice.slot);this.synth.keyOff(voice.slot);voice.held=false;return true;}
  /** Release only owned physical gates, following the Synth click preference. */
  stopPhysicalVoices(){for(const voice of this.manualVoices.values())if(voice.held)this.physicalNoteOff(voice.id);return true;}
  exportPatch(){return writePatch(this.config,Object.fromEntries(OPERATOR_KEYS.map((key,slot)=>[key,this.invoke('getPCM',[slot])])));}
  /** Internal cold migration only. Requested physical slots are retained, but
   * no running voice, session, gate or audio phase may cross this boundary. */
  exportIdleState(){
    if(this.groups.size||this.manualVoices.size||this.codeActive)throw new TypeError('Idle migration requires no keyboard or Code owners');
    const synthState=this.synth.getState();validateIdleTransport(synthState);
    return {format:'tetorica-scsp-idle-state',version:1,config:settings(this.config),synthState,ram:this.core.readRam(0,IDLE_RAM_BYTES),reserved:this.reserved,...(this.dspRoutingActive?{dspRoutingState:{overrides:this.readDspRoutingOverrides(),returns:this.effect.readReturns()}}:{})};
  }
  loadIdleState(snapshot){
    if(snapshot?.format!=='tetorica-scsp-idle-state'||snapshot.version!==1||Reflect.ownKeys(snapshot).length!==(Object.hasOwn(snapshot,'dspRoutingState')?7:6)||Reflect.ownKeys(snapshot).some(key=>!['format','version','config','synthState','ram','reserved','dspRoutingState'].includes(key))||!(snapshot.ram instanceof Uint8Array)||snapshot.ram.length!==IDLE_RAM_BYTES)throw new TypeError('Invalid SCSP idle migration snapshot');
    const config=settings(snapshot.config),state=snapshot.synthState;
    const dsp=Object.hasOwn(snapshot,'dspRoutingState')?dspRoutingState(snapshot.dspRoutingState):null;
    if(dsp&&dsp.returns[0].level!==config.effect.returnLevel)throw new TypeError('Idle DSP return differs from legacy effect level');
    validateIdleTransport(state);validateIdleResources(state,snapshot.reserved);
    const check=createScspValidation();try{
      check._adoptState(state);
      for(let slot=0;slot<32;slot++){const {gate:_,...voice}=state.slots[slot];check.setPreset(slot,{...voice,sample:voice.sample?check._resolveSample(voice.sample):null});}
      for(const [method,args]of voiceCommands(check,config,{midi:69,slots:Array.from({length:operatorCount(config.mode)},(_,i)=>SOURCE_COUNT+i)}))check[method](...scspCommandArgs(check,method,args));
    }finally{check.dispose();}
    // A cold destination keeps migrated allocations permanent until Reset.
    // Editor page reuse metadata is intentionally not serialized or inferred.
    this.stopVoices();this.synth.reset({clearRam:true});this.core.loadRam(snapshot.ram,0);this.synth._adoptState(state);
    this.reserved=this.synth._resolveSample(snapshot.reserved);this.config=config;this.pitchBend=0;
    this.codeActive=false;this.codeLanes=Array.from({length:32},()=>({midi:69,id:null}));
    this.#resetDspRouting();this.effect.settings=config.effect;
    if(dsp){this.dspSourceSends=dsp.overrides.sources;this.dspSlotSends=dsp.overrides.slots;this.dspRoutingActive=true;for(let output=0;output<2;output++)this.effect.setReturn(output,dsp.returns[output]);}
    this.effect.install();this.#routeEffect();return true;
  }
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
      this.#resetDspRouting();this.config=settings(patch);this.effect.configure(this.config.effect);this.#routeEffect();return true;
    }
    this.stopVoices();this.synth.reset({clearRam:true});this.reserved=reserveDspRam(this.synth);
    for(const [slot,kind]of OPERATOR_KEYS.entries()){
      const operator=patch.operators[kind],sample=this.synth.loadPCM(operator.pcm,pcmOptions(operator));this.synth.setPreset(slot,{...operator.voice,sample});
    }
    this.#resetDspRouting();this.config=settings(patch);this.pitchBend=0;this.effect.settings=this.config.effect;this.effect.install();this.#routeEffect();return true;
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
    if(method==='getDspProgram')return {...this.readDspProgram(),coefficients:this.readDspCoefficients()};
    if(method==='applyDspProgram')return {...this.applyDspProgram(...args),coefficients:this.readDspCoefficients()};
    if(method==='getDspCoefficients')return this.readDspCoefficients();
    if(method==='setDspCoefficients')return this.setDspCoefficients(...args);
    if(['setDspSend','setDspSourceSend','setDspReturn'].includes(method))return this[method](...args);
    if(method==='dispose')return this.endCode(session);
    if(method==='allNotesOff'){for(const group of this.groups.values())if(group.owner?.kind==='code'&&group.owner.session===session)this.noteOff(group.id);return true;}
    if(method==='loadPCM')return this.synth.loadPCM(...args);
    if(['getPCM','applyPCM','setPreset','setEnvelope','setMix','setLfo'].includes(method))return this.invoke(method,args);
    if(['setConfig','setEffect','exportPatch','loadPatch'].includes(method))return this[method](...args);
    const [channel,value]=args,lane=this.codeLanes[channel],group=this.#codeGroup(channel);
    if(method==='noteOff'||method==='keyOff')return group?this.#releaseGroup(group.id,method==='keyOff'):false;
    if(method==='noteOn'||method==='keyOn'){
      const midi=method==='noteOn'?69+12*Math.log2(noteToHz(value)/440):lane.midi,id=`code:${session}:${channel}`;
      const result=this.#attack(id,midi,{kind:'code',session,channel});lane.midi=midi;lane.id=id;return result;
    }
    const frequency=method==='setNote'?noteToHz(value):value,midi=69+12*Math.log2(frequency/440),config=group?.config??this.config,commands=[];
    if(group)for(let index=0;index<group.slots.length;index++)commands.push(['setFrequency',[operatorSlot(group,index),frequency*2**((config.transpose+this.pitchBend)/12)*(config.mode==='pcm'?1:config.fm.ratios[index])]]);
    else for(const [method,args]of voiceCommands(this.synth,this.#voiceConfig(),{midi,slots:Array.from({length:operatorCount(this.config.mode)},(_,i)=>SOURCE_COUNT+i)}))if(method==='setPreset'&&![...this.manualVoices.values()].some(voice=>voice.slot===args[0]))commands.push([method,args]);
    this.#check(commands);if(group){this.#apply(commands);group.midi=midi;}lane.midi=midi;return frequency;
  }
  readAuthoring(sampleKeys=[]){
    if(!Array.isArray(sampleKeys)||sampleKeys.length>SOURCE_COUNT||sampleKeys.some(key=>key!==null&&typeof key!=='string'))throw new TypeError('Expected up to six cached sample keys');
    const state=this.read(),operators=Array.from({length:SOURCE_COUNT},(_,slot)=>{const sample=state.slots[slot].sample;return sampleKeys[slot]===`${sample.bankId}:${sample.id}`?null:this.invoke('getPCM',[slot]);});
    return {state,operators};
  }
  read(){const state=this.synth.getState();return {...state,samples:state.samples.filter(sample=>sample.id!==this.reserved.id),dspRamBytes:DSP_RAM_BYTES,dspCoefficients:this.effect.readCoefficients().codes,dspRouting:this.readDspRouting(),dspRoutingOverrides:this.readDspRoutingOverrides(),dspReturns:this.effect.readReturns(),kind:'scsp',config:clone(this.config),pitchBend:this.pitchBend,clickGuard:this.releaseGuard.enabled,voiceCapacity:Math.floor((32-SOURCE_COUNT)/operatorCount(this.config.mode)),sourceCount:SOURCE_COUNT,routing:routing(this.config),voiceGroups:[...this.groups.values()].map(g=>clone(g)),manualVoices:[...this.manualVoices.values()].map(voice=>({...voice})),codeActive:this.codeActive,codeSession:this.codeSession,codeLanes:this.codeLanes.map((lane,channel)=>({channel,midi:lane.midi,groupId:this.#codeGroup(channel)?.id??null,slots:[...(this.#codeGroup(channel)?.slots??[])]})),channels:state.slots.map((v,channel)=>({...v,channel,type:'scsp-pcm',active:v.gate}))};}
  dispose(){this.groups.clear();this.manualVoices.clear();this.releaseGuard.clear();this.synth.dispose();}
}

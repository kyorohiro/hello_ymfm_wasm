import {presetToVoice,voiceToPreset,validatePreset,validateOperator,validateOperators} from './msfa_dx7/src/preset.js';
import {nativeVoiceChannel} from './playground_performance_processor.js?v=scsp-native-1';

const integer=(value,max,label)=>{if(!Number.isInteger(value)||value<0||value>max)throw new RangeError(`${label} must be 0..${max}`);return value;};
const identity=id=>{if(typeof id!=='string'||!id.length||id.length>128)throw new TypeError('Audition identity must contain 1..128 characters');return `voice-editor:${id}`;};
const voiceName=bytes=>{let name='';for(let index=145;index<155;index++)name+=bytes[index]<32||bytes[index]===127?' ':String.fromCharCode(bytes[index]);return name.trimEnd();};
// AudioWorkletGlobalScope does not expose Window's structuredClone API.
const copy=value=>Array.isArray(value)?value.map(copy):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([key,entry])=>[key,copy(entry)])):value;

/** Applied DX7 patch and note-gate observations, independent of accepted future edits.
 * Reading copies bytes only; it never renders PCM, queries a live envelope or flushes reservations.
 */
export class Dx7VoiceInspector {
  /** @param {{sampleRate:number,internalSampleRate?:number,
   * getApplied:()=>{selectedVoice:number,voices:Uint8Array[]},
   * getLogical:()=>{selectedVoice:number,voices:Uint8Array[],pendingCommands:number},
   * dispatch:(command:{method:string,args?:any[]},owner?:string)=>void,
   * beginAudition:(midi:number,owner:string)=>void,endAudition:(midi:number,owner:string)=>void}} options */
  constructor({sampleRate,internalSampleRate=44100,getApplied,getLogical,dispatch,beginAudition,endAudition}){
    this.sampleRate=sampleRate;this.internalSampleRate=internalSampleRate;this.getApplied=getApplied;this.getLogical=getLogical;
    this.dispatch=dispatch;this.beginAudition=beginAudition;this.endAudition=endAudition;
    this.notes=new Map();this.auditions=new Map();this.byMidi=new Map();
  }
  resetAuditions(){for(const [id,{midi}]of this.auditions)this.endAudition(midi,identity(id));this.auditions.clear();this.byMidi.clear();}
  observe(command){
    const [midi,velocity=100]=command.args??[];
    if(command.method==='noteOn'){if(velocity)this.notes.set(midi,velocity);else this.notes.delete(midi);}
    if(command.method==='noteOff')this.notes.delete(midi);
    if(['panic','allNotesOff'].includes(command.method))this.notes.clear();
  }
  blocked(command){
    if(!this.auditions.size)return false;
    const key=nativeVoiceChannel('dx7',command);
    return key==='all'||this.byMidi.has(key);
  }
  edit(command){
    const id=this.auditions.keys().next().value;
    this.dispatch(command,id===undefined?undefined:identity(id));
    return this.read();
  }
  invoke(method,args=[]){
    if(method==='auditionAllOff'){for(const id of [...this.auditions.keys()])this.invoke('auditionOff',[0,id]);return true;}
    if(method==='auditionOff'){
      const [channel,id]=args;integer(channel,0,'DX7 instrument');const owner=identity(id),entry=this.auditions.get(id);
      if(!entry||this.byMidi.get(entry.midi)!==id)return false;
      try{this.dispatch({method:'noteOff',args:[entry.midi]},owner);}
      finally{this.auditions.delete(id);this.byMidi.delete(entry.midi);this.endAudition(entry.midi,owner);}
      return true;
    }
    if(method==='auditionOn'){
      const [channel,midi,id,velocity=100]=args;integer(channel,0,'DX7 instrument');integer(midi,127,'MIDI note');integer(velocity,127,'Velocity');
      const owner=identity(id);if(!velocity)return this.invoke('auditionOff',[channel,id]);
      if(!this.byMidi.has(midi)&&this.auditions.size>=16&&!this.auditions.has(id))throw new RangeError('DX7 supports up to 16 audition notes');
      const previous=this.byMidi.get(midi),sameId=this.auditions.get(id);
      // Validate every argument before replacing any existing note or lease.
      if(sameId&&sameId.midi!==midi)this.invoke('auditionOff',[0,id]);
      if(previous!==undefined){this.auditions.delete(previous);this.endAudition(midi,identity(previous));}
      this.auditions.set(id,{midi,velocity});this.byMidi.set(midi,id);this.beginAudition(midi,owner);
      this.dispatch({method:'noteOff',args:[midi]},owner);
      this.dispatch({method:'noteOn',args:[midi,velocity]},owner);return true;
    }
    if(method==='selectVoice'){
      const index=integer(args[0],this.getApplied().voices.length-1,'DX7 bank slot');
      return this.edit({method:'selectVoice',args:[index]});
    }
    if(method==='setPreset'){
      const [patch]=args;validatePreset(patch);
      const state=this.getApplied(),preset=voiceToPreset(presetToVoice(patch,state.voices[state.selectedVoice]));
      // Inspector patches retain all omitted fields. The public setPreset API
      // intentionally starts from INIT and keeps that separate behavior.
      if(Object.keys(patch).length===1&&Object.hasOwn(patch,'feedback'))return this.edit({method:'setFeedback',args:[patch.feedback]});
      return this.edit({method:'setPreset',args:[preset]});
    }
    if(method==='setOperator'){validateOperator(args[0],args[1]);return this.edit({method,args:copy(args)});}
    if(method==='setOperators'){validateOperators(args[0]);return this.edit({method,args:copy(args)});}
    if(method==='setFeedback'){integer(args[0],7,'Feedback');return this.edit({method,args:[args[0]]});}
    throw new Error('Unsupported DX7 inspector operation');
  }
  read(){
    const applied=this.getApplied(),logical=this.getLogical();
    const bank=voices=>voices.map((bytes,index)=>({index,name:voiceName(bytes)}));
    return {kind:'dx7',sampleRate:this.sampleRate,internalSampleRate:this.internalSampleRate,polyphony:16,
      selectedVoice:applied.selectedVoice,voices:bank(applied.voices),preset:voiceToPreset(applied.voices[applied.selectedVoice]),
      activeSource:'applied-note-gates',activeNotes:[...this.notes].map(([midi,velocity])=>({midi,velocity,manual:this.byMidi.has(midi)})),
      auditions:[...this.auditions].map(([id,{midi}])=>({channel:0,midi,id})),
      logical:{selectedVoice:logical.selectedVoice,voices:bank(logical.voices),preset:voiceToPreset(logical.voices[logical.selectedVoice]),pendingCommands:logical.pendingCommands}};
  }
}

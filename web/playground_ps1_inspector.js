import {noteToHz} from './soundchip_pitch.js';
const channel=value=>{if(!Number.isInteger(value)||value<0||value>23)throw new RangeError('PS1 SPU channel must be 0..23');return value;};
function identity(value){if(typeof value!=='string'||!value.length||value.length>128)throw new TypeError('Audition identity must contain 1..128 characters');return `voice-editor:${value}`;}
/** Applied instrument state and identity-safe manual channel leases. Reads do not render. */
export class Ps1VoiceInspector {
  /** @param {import('./ps1synth.js').Ps1Synth} synth @param {import('./playground_native_voice_inspector.js').NativeVoiceInspectorOptions} [options] */
  constructor(synth,{sampleRate=44100,dispatch,beginAudition=()=>{},endAudition=()=>{}}={}){
    this.synth=synth;this.sampleRate=sampleRate;this.dispatch=dispatch??(command=>synth[command.method](...(command.args??[])));this.beginAudition=beginAudition;this.endAudition=endAudition;this.auditions=new Map();
  }
  resetAuditions(){for(const [ch,id]of this.auditions)this.endAudition(ch,identity(id));this.auditions.clear();}
  read(){const state=this.synth.getState();return {...state,channels:state.channels.map((p,channel)=>({...p,channel,active:p.gate,type:'spu-adpcm'})),kind:'ps1',sampleRate:this.sampleRate,nativeSampleRate:44100,auditions:[...this.auditions].map(([channel,id])=>({channel,id}))};}
  invoke(method,args=[]){
    if(method==='auditionAllOff'){for(const [ch,id]of [...this.auditions])this.invoke('auditionOff',[ch,id]);return true;}
    if(method==='auditionOff'){
      const[ch,id]=args;channel(ch);const owner=identity(id);if(this.auditions.get(ch)!==id)return false;
      try{this.dispatch({method:'keyOff',args:[ch]},owner);}finally{this.auditions.delete(ch);this.endAudition(ch,owner);}return true;
    }
    if(method==='auditionOn'){
      const[ch,midi,id]=args;channel(ch);if(!Number.isInteger(midi)||midi<0||midi>127)throw new RangeError('MIDI note must be 0..127');const owner=identity(id),preset=this.synth.getPreset(ch),sample=this.synth.samples[preset.sample];
      if(!sample)throw new Error('Assign a PS1 SPU ADPCM sample before using Keyboard');
      const pitch=Math.round(sample.basePitch*noteToHz(midi)/sample.rootFrequencyHz);if(pitch<1||pitch>0x3fff)throw new RangeError('Frequency is outside PS1 SPU PITCH range');
      this.auditions.set(ch,id);this.beginAudition(ch,owner);
      this.dispatch({method:'setPitch',args:[ch,pitch]},owner);this.dispatch({method:'keyOn',args:[ch]},owner);return true;
    }
    if(['setPreset','setChannel','setPitch','setFrequency','setNote'].includes(method)){
      const ch=channel(args[0]);
      if(method==='setPreset'||method==='setChannel')this.synth._preset(ch,args[1]);
      else {const previous=this.synth.channels[ch],write=this.synth.core.write;this.synth.channels[ch]={...previous};this.synth.core.write=()=>{};try{this.synth[method](...args);}finally{this.synth.core.write=write;this.synth.channels[ch]=previous;}}
      const held=this.auditions.get(ch);this.dispatch({method,args:structuredClone(args)},held?identity(held):undefined);return true;
    }
    throw new Error('Unsupported PS1 SPU inspector operation');
  }
}

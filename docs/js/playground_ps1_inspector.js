import {noteToHz} from './soundchip_pitch.js';
import {patchPs1Envelope} from './ps1_parameters.js?v=ps1-voice-editor-1';
import {preparePs1ADPCM} from './ps1synth.js?v=ps1-deferred-release-1';
const channel=value=>{if(!Number.isInteger(value)||value<0||value>23)throw new RangeError('PS1 SPU channel must be 0..23');return value;};
function identity(value){if(typeof value!=='string'||!value.length||value.length>128)throw new TypeError('Audition identity must contain 1..128 characters');return `voice-editor:${value}`;}
function retriggerOption(value={}){
  if(!value||typeof value!=='object'||Array.isArray(value)||Reflect.ownKeys(value).some(key=>key!=='retrigger')||value.retrigger!==undefined&&typeof value.retrigger!=='boolean')throw new TypeError('Expected {retrigger?:boolean}');
  return value.retrigger===true;
}
function envelopeOptions(value={}){
  if(!value||typeof value!=='object'||Array.isArray(value)||Reflect.ownKeys(value).some(key=>!['retrigger','live'].includes(key))||['retrigger','live'].some(key=>value[key]!==undefined&&typeof value[key]!=='boolean'))throw new TypeError('Expected {live?:boolean,retrigger?:boolean}');
  return {live:value.live===true,retrigger:value.retrigger===true};
}
/** Applied instrument state and identity-safe manual channel leases. Reads do not render. */
export class Ps1VoiceInspector {
  /** @param {import('./ps1synth.js?v=audio-stability-2').Ps1Synth} synth @param {import('./playground_native_voice_inspector.js?v=pokey-mode-1').NativeVoiceInspectorOptions & {onResourcesChanged?:()=>void}} [options] */
  constructor(synth,{sampleRate=44100,dispatch,beginAudition=()=>{},endAudition=()=>{},onResourcesChanged=()=>{}}={}){
    this.synth=synth;this.sampleRate=sampleRate;this.dispatch=dispatch??(command=>synth[command.method](...(command.args??[])));this.beginAudition=beginAudition;this.endAudition=endAudition;this.onResourcesChanged=onResourcesChanged;this.auditions=new Map();
  }
  resetAuditions(){for(const [ch,id]of this.auditions)this.endAudition(ch,identity(id));this.auditions.clear();}
  read(){const state=this.synth.getState();return {...state,channels:state.channels.map((p,channel)=>({...p,channel,active:p.gate,type:'spu-adpcm'})),kind:'ps1',sampleRate:this.sampleRate,nativeSampleRate:44100,auditions:[...this.auditions].map(([channel,id])=>({channel,id}))};}
  invoke(method,args=[]){
    if(method==='loadTone'){
      const ch=channel(args[0]),prepared=preparePs1ADPCM(args[1],args[2]),preset=args[3];
      if(!preset||typeof preset!=='object'||Array.isArray(preset)||Reflect.ownKeys(preset).some(key=>!['adsr1','adsr2','pitch','volumeLeft','volumeRight','reverb'].includes(key)))throw new TypeError('Expected an SPU Tone preset without a sample ID');
      this.synth._preset(ch,preset);
      // Reuse only an actual matching public sample. Comparing current bytes
      // avoids stale sample IDs when Run/reset replaces the live bank.
      let sample=this.synth.samples.find(entry=>entry.editorChannel===undefined &&
        entry.rootFrequencyHz===prepared.rootFrequencyHz && entry.loopStartSamples===prepared.loopStartSamples &&
        entry.byteLength===prepared.adpcm.length && this.synth.sampleBytes[entry.id]?.every((byte,index)=>byte===prepared.adpcm[index]));
      // loadADPCM checks capacity before touching RAM. Invalid data/presets or
      // insufficient RAM therefore keep the old voice and manual lease intact.
      if(!sample){sample=this.synth.loadADPCM(prepared.adpcm,args[2]);this.onResourcesChanged();}
      const held=this.auditions.get(ch);
      if(held)this.invoke('auditionOff',[ch,held]);
      this.dispatch({method:'keyOff',args:[ch]},undefined,{preserveOwner:true});
      this.dispatch({method:'setPreset',args:[ch,{...preset,sample:sample.id}]},undefined,{preserveOwner:true});
      return sample;
    }
    if(method==='auditionAllOff'){for(const [ch,id]of [...this.auditions])this.invoke('auditionOff',[ch,id]);return true;}
    if(method==='auditionOff'){
      const[ch,id]=args;channel(ch);const owner=identity(id);if(this.auditions.get(ch)!==id)return false;
      try{this.dispatch({method:'_auditionKeyOff',args:[ch]},owner);}finally{this.auditions.delete(ch);this.endAudition(ch,owner);}return true;
    }
    if(method==='auditionOn'){
      const[ch,midi,id]=args;channel(ch);if(!Number.isInteger(midi)||midi<0||midi>127)throw new RangeError('MIDI note must be 0..127');const owner=identity(id),preset=this.synth.getPreset(ch),sample=this.synth.samples[preset.sample];
      if(!sample)throw new Error('Assign a PS1 SPU ADPCM sample before using Keyboard');
      const pitch=Math.round(sample.basePitch*noteToHz(midi)/sample.rootFrequencyHz);if(pitch<1||pitch>0x3fff)throw new RangeError('Frequency is outside PS1 SPU PITCH range');
      this.auditions.set(ch,id);this.beginAudition(ch,owner);
      this.dispatch({method:'setPitch',args:[ch,pitch]},owner);this.dispatch({method:'_auditionKeyOn',args:[ch]},owner);return true;
    }
    if(method==='setReverb'){
      this.synth._reverb(args[0]);
      const held=this.auditions.values().next().value;
      this.dispatch({method,args:[{...args[0]}]},held?identity(held):undefined,{preserveOwner:true});return true;
    }
    if(method==='setWaveform'){
      const ch=channel(args[0]),retrigger=retriggerOption(args[2]);
      const sample=this.synth._setWaveformPrepared(ch,args[1]);
      this.onResourcesChanged();
      const held=this.auditions.get(ch),owner=held?identity(held):undefined;
      this.dispatch({method:'setPreset',args:[ch,{sample:sample.id}]},owner,{preserveOwner:true});
      if(retrigger&&held)this.dispatch({method:'_auditionKeyOn',args:[ch]},owner);
      return sample;
    }
    if(['setPreset','setChannel','setEnvelope','setPitch','setFrequency','setNote'].includes(method)){
      const ch=channel(args[0]);
      const envelopeEdit=method==='setEnvelope'||(method==='setPreset'||method==='setChannel')&&['adsr1','adsr2'].some(key=>Object.hasOwn(args[1]??{},key));
      const options=['setPreset','setChannel','setEnvelope'].includes(method)?envelopeOptions(args[2]):{live:false,retrigger:false};
      let envelopeChanged=false;
      if(method==='setEnvelope'){
        const current=this.synth.getPreset(ch),next=patchPs1Envelope(current.adsr1,current.adsr2,args[1]);envelopeChanged=next.adsr1!==current.adsr1||next.adsr2!==current.adsr2;
      }else if(method==='setPreset'||method==='setChannel'){
        const current=this.synth.getPreset(ch),next=this.synth._preset(ch,args[1]);envelopeChanged=next.adsr1!==current.adsr1||next.adsr2!==current.adsr2;
      }
      else {const previous=this.synth.channels[ch],write=this.synth.core.write;this.synth.channels[ch]={...previous};this.synth.core.write=()=>{};try{this.synth[method](...args);}finally{this.synth.core.write=write;this.synth.channels[ch]=previous;}}
      const held=this.auditions.get(ch),owner=held?identity(held):undefined;
      // WorkletGlobalScope does not provide structuredClone in all browsers.
      // Validated patches contain scalar fields; normalize a sample descriptor
      // to its scalar ID instead of retaining any caller-owned nested object.
      const value=['setPreset','setChannel','setEnvelope'].includes(method)?{...args[1]}:args[1];
      if(value&&typeof value==='object'&&value.sample&&typeof value.sample==='object')value.sample=value.sample.id;
      // The editor's checkbox controls the selected voice's current envelope,
      // including a Release tail after its manual key lease has ended.
      this.dispatch({method,args:envelopeEdit?[ch,value,{live:false}]:[ch,value]},owner,{preserveOwner:true});
      // Refreshing changes no note owner or gate. Retriggering remains limited
      // to this editor's held audition, and never restarts a released voice.
      if(envelopeEdit){if(options.live){if(envelopeChanged)this.dispatch({method:'_refreshEnvelope',args:[ch]},owner,{preserveOwner:true});}else if(options.retrigger&&held)this.dispatch({method:'_auditionKeyOn',args:[ch]},owner);}
      return true;
    }
    throw new Error('Unsupported PS1 SPU inspector operation');
  }
}

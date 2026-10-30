// SPDX-License-Identifier: BSD-3-Clause
const slot=value=>{if(!Number.isInteger(value)||value<0||value>31)throw new RangeError('SCSP slot must be 0..31');return value;};
const identity=value=>{if(typeof value!=='string'||!value.length||value.length>128)throw new TypeError('Invalid audition identity');return `voice-editor:${value}`;};
/** Slot editing, PCM copies and identity-safe manual Keyboard leases. */
export class ScspVoiceInspector {
  /** @param {import('./scspsynth.js?v=audio-stability-2').ScspSynth} synth
   * @param {import('./playground_native_voice_inspector.js?v=pokey-mode-1').NativeVoiceInspectorOptions & {validate?:(command:any)=>void, readPCM?:(sample:any)=>any, editPCM?:(ch:number,pcm:any,options:any)=>any}} [options] */
  constructor(synth,{sampleRate=44100,dispatch,validate=()=>{},readPCM,editPCM,beginAudition=()=>{},endAudition=()=>{}}={}) {
    Object.assign(this,{synth,sampleRate,dispatch,validate,readPCM,editPCM,beginAudition,endAudition});this.auditions=new Map();
  }
  read(){const state=this.synth.getState();return {...state,kind:'scsp',nativeSampleRate:44100,sampleRate:this.sampleRate,channels:state.slots.map((v,channel)=>({...v,channel,type:'scsp-pcm',active:v.gate})),auditions:[...this.auditions].map(([channel,id])=>({channel,id}))};}
  resetAuditions(){for(const [ch,id]of this.auditions)this.endAudition(ch,identity(id));this.auditions.clear();}
  invoke(method,args=[]) {
    if(method==='auditionAllOff'){for(const [ch,id]of [...this.auditions])this.invoke('auditionOff',[ch,id]);return true;}
    const ch=slot(args[0]);
    if(method==='getPCM') {
      const voice=this.synth.getState().slots[ch],sample=voice.sample;
      if(!sample)throw new Error('Assign PCM first');
      return {sample,voice,pcm:this.readPCM(sample)};
    }
    if(method==='applyPCM')return this.editPCM(ch,args[1],args[2]);
    if(['setEnvelope','setLfo','setModulation','setMix','setPreset'].includes(method)) {
      const patch=method==='setPreset'&&args[1]?.sample?{...args[1],sample:this.synth._resolveSample(args[1].sample)}:args[1];
      const command={method,args:[ch,patch]};this.validate(command);
      if(this.dispatch(command,this.auditions.has(ch)?identity(this.auditions.get(ch)):`voice-editor:settings:${ch}`)===false)throw new Error('SCSP edit was blocked');
      return true;
    }
    if(method==='auditionOff') {
      const owner=identity(args[1]);if(this.auditions.get(ch)!==args[1])return false;
      try{this.dispatch({method:'keyOff',args:[ch]},owner);}finally{this.auditions.delete(ch);this.endAudition(ch,owner);}return true;
    }
    if(method!=='auditionOn')throw new Error('Unsupported SCSP inspector operation');
    const [,midi,id]=args;const owner=identity(id);if(!Number.isInteger(midi)||midi<0||midi>127)throw new RangeError('MIDI note must be 0..127');
    // Validate before taking the manual lease, including sample/pitch limits.
    const state=this.synth.getState(),v=state.slots[ch];
    if(!v.sample)throw new Error('Assign PCM to this SCSP slot before using Keyboard');
    const command={method:'noteOn',args:[ch,midi]};this.validate(command);
    const previous=this.auditions.get(ch);this.beginAudition(ch,owner);
    try {
      if(this.dispatch(command,owner)===false)throw new Error('SCSP audition was blocked');
      this.auditions.set(ch,id);return true;
    }catch(error){if(previous)this.beginAudition(ch,identity(previous));else this.endAudition(ch,owner);throw error;}
  }
}

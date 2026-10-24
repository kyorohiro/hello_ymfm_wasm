import {noteToHz} from './soundchip_pitch.js';

const channel=value=>{if(!Number.isInteger(value)||value<0||value>7)throw new RangeError('SNES channel must be 0..7');return value;};
function identity(value){if(typeof value!=='string'||!value.length||value.length>128)throw new TypeError('Audition identity must contain 1..128 characters');return `voice-editor:${value}`;}

/** Applied DSP settings and manual channel leases. No sample is created here.
 * Reading never renders or changes the current instrument/timeline.
 */
export class SnesVoiceInspector {
  /** @param {import('./snessynth.js?v=spc-song-js-1').SnesSynth} synth
   * @param {import('./playground_native_voice_inspector.js?v=extra-ym2610b-1').NativeVoiceInspectorOptions} [options] */
  constructor(synth,{sampleRate=44100,dispatch,beginAudition=()=>{},endAudition=()=>{}}={}){
    this.synth=synth;this.sampleRate=sampleRate;this.dispatch=dispatch??(command=>synth[command.method](...(command.args??[])));
    this.beginAudition=beginAudition;this.endAudition=endAudition;this.auditions=new Map();this.gates=0;this.assignedSamples=new Map();
    const write=synth.core.writeDsp.bind(synth.core);
    synth.core.writeDsp=(register,value)=>{const result=write(register,value);this.observeWrite(register,value);return result;};
    const reset=synth.reset.bind(synth);synth.reset=()=>{this.resetAuditions();this.gates=0;this.assignedSamples.clear();return reset();};
  }
  observeWrite(register,value){if(register===0x4c)this.gates|=value;if(register===0x5c)this.gates&=~value;if((register&15)===4&&register<0x80)this.assignedSamples.set(register>>4,value);}
  resetAuditions(){for(const [ch,id]of this.auditions)this.endAudition(ch,identity(id));this.auditions.clear();}
  voice(ch){
    channel(ch);const b=ch<<4,read=offset=>this.synth.readDsp(b+offset),signed=value=>value>127?value-256:value;
    const sample=this.assignedSamples.get(ch)??this.synth.channels[ch].sample??null;
    return {sample,adsr1:read(5),adsr2:read(6),gain:read(7),volumeLeft:signed(read(0)),volumeRight:signed(read(1)),pitch:read(2)|((read(3)&63)<<8)};
  }
  read(){
    const synth=this.synth,state=synth.getState();
    return {kind:'snes',sampleRate:this.sampleRate,nativeSampleRate:32000,activeSource:'applied-register-gates',samples:state.samples,
      channels:Array.from({length:8},(_,ch)=>{const voice=this.voice(ch),sample=state.samples[voice.sample];return {channel:ch,type:'brr',...voice,active:!!(this.gates&(1<<ch)),frequency:sample?sample.rootFrequencyHz*voice.pitch/sample.basePitch:null};}),
      auditions:[...this.auditions].map(([channel,id])=>({channel,id})),timeline:synth.getTimelineState()};
  }
  invoke(method,args=[]){
    if(['setPreset','setChannel','setPitch','setFrequency','setNote'].includes(method)){
      const ch=channel(args[0]);if(this.synth.timeline)throw new Error('SNES timeline playback has no editable keyboard instrument');
      // Validate against the audible voice without emitting validation writes.
      const p=this.voice(ch);if(method==='setPreset'||method==='setChannel')this.synth._preset(ch,args[1]);
      else{const previous=this.synth.channels[ch];this.synth.channels[ch]={...p};const write=this.synth.core.writeDsp;this.synth.core.writeDsp=()=>{};try{this.synth[method](...args);}finally{this.synth.core.writeDsp=write;this.synth.channels[ch]=previous;}}
      this.dispatch({method,args:structuredClone(args)});return true;
    }
    if(method==='auditionAllOff'){for(const [ch,id]of [...this.auditions])this.invoke('auditionOff',[ch,id]);return true;}
    if(method==='auditionOff'){
      const [ch,id]=args;channel(ch);const owner=identity(id);if(this.auditions.get(ch)!==id)return false;
      try{this.dispatch({method:'keyOff',args:[ch]},owner);}finally{this.auditions.delete(ch);this.endAudition(ch,owner);}return true;
    }
    if(method==='auditionOn'){
      const [ch,midi,id]=args;channel(ch);if(!Number.isInteger(midi)||midi<0||midi>127)throw new RangeError('MIDI note must be 0..127');const owner=identity(id);
      if(this.synth.timeline)throw new Error('SNES timeline playback has no editable keyboard instrument');
      const preset=this.voice(ch),sample=this.synth.samples[preset.sample];if(!sample)throw new Error('Assign a BRR sample to this SNES channel before using Keyboard');
      const pitch=Math.round(sample.basePitch*noteToHz(midi)/sample.rootFrequencyHz);if(pitch<1||pitch>0x3fff)throw new RangeError('Frequency is outside SNES PITCH range');
      this.auditions.set(ch,id);this.beginAudition(ch,owner);
      this.dispatch({method:'setPreset',args:[ch,{...preset,pitch}]},owner);this.dispatch({method:'keyOn',args:[ch]},owner);return true;
    }
    throw new Error('Unsupported SNES inspector operation');
  }
}

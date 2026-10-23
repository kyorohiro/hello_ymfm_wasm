import {AY8910Synth} from './ay8910synth.js?v=audio-numeric-bindings-1';
import {keyboardChannels} from './playground_keyboard_channels.js?v=native-extra-dx7-1';
import {nativeVoiceChannel} from './playground_performance_processor.js?v=audio-numeric-bindings-1';
const identity=value=>{if(typeof value!=='string'||!value.length||value.length>128)throw new TypeError('Audition identity must contain 1..128 characters');return `voice-editor:${value}`;};
const channel=value=>{if(typeof value==='string'&&/^[0-2]$/.test(value))value=Number(value);if(!Number.isInteger(value)||value<0||value>2)throw new RangeError('AY8910 channel must be 0..2');return value;};
/** Applied AY state; no inspection path renders audio or replays controls. */
export class Ay8910VoiceInspector{
  /** @param {import('./playground_native_voice_inspector.js?v=nes-wasm-1').NativeVoiceInspectorOptions} [options] */
  constructor({clock=()=>1789773,sampleRate=44100,dispatch,beginAudition=()=>{},endAudition=()=>{}}={}){this.clock=typeof clock==='function'?clock:()=>clock;this.sampleRate=sampleRate;this.dispatch=dispatch;this.beginAudition=beginAudition;this.endAudition=endAudition;this.auditions=new Map();this.reset();}
  resetAuditions(){for(const [ch,id]of this.auditions)this.endAudition(ch,identity(id));this.auditions.clear();}
  reset(){this.resetAuditions();this.registers=new Uint8Array(16);this.levels=[9,9,9];}
  observeWrite(register,value){this.registers[register]=value;if(register>=8&&register<=10&&(value&31))this.levels[register-8]=value&31;}
  getState(){return {registers:Array.from(this.registers),levels:[...this.levels]};}
  stage(callback,owner){
    const commands=[],api=new AY8910Synth({clock:this.clock(),transport:{writeRegister:(register,value)=>commands.push({method:'writeRegister',args:[register,value]}),reset:()=>commands.push({method:'reset',args:[]})}});
    api._adoptState(this.getState());const result=callback(api,commands),state=api._getState();
    for(const command of commands){const physical=nativeVoiceChannel('ay8910',command),held=[...this.auditions].find(([ch])=>physical==='all'||physical===ch);this.dispatch(command,owner??(held?identity(held[1]):undefined),{preserveOwner:!owner});}
    this.levels=[...state.levels];return result;
  }
  invoke(method,args=[]){
    if(method==='auditionAllOff'){for(const [ch,id]of [...this.auditions])this.invoke('auditionOff',[ch,id]);return true;}
    if(method==='auditionOff'){
      const [input,id]=args,ch=channel(input),owner=identity(id);if(this.auditions.get(ch)!==id)return false;
      try{this.dispatch({method:'forceKeyOff',args:[ch]},owner);}finally{this.auditions.delete(ch);this.endAudition(ch,owner);}return true;
    }
    if(method==='auditionOn'){
      const [input,midi,id]=args,ch=channel(input),owner=identity(id);if(!Number.isInteger(midi)||midi<0||midi>127)throw new RangeError('MIDI note must be 0..127');
      const prepared=[];this.stage((api,commands)=>{api.setNote(ch,midi);api.keyOn(ch);prepared.push(...commands);commands.length=0;});
      const previous=this.auditions.get(ch);if(previous!==undefined)this.invoke('auditionOff',[ch,previous]);
      this.auditions.set(ch,id);this.beginAudition(ch,owner);this.dispatch({method:'forceKeyOff',args:[ch]},owner);for(const command of prepared)this.dispatch(command,owner);return true;
    }
    if(!['setVoice','tone','setTone','noise','setMixer','setVolume','setNoisePeriod','setEnvelope','setTonePeriod','setFrequency','setNote'].includes(method))throw new Error('Unsupported AY8910 inspector operation');
    return this.stage(api=>api[method](...args));
  }
  read(){
    const r=this.registers,clock=this.clock(),mixer=r[7],noisePeriod=r[6]&31,envelopePeriod=r[11]|(r[12]<<8),shape=r[13]&15;
    const channels=Array.from({length:3},(_,ch)=>{const period=r[ch*2]|((r[ch*2+1]&15)<<8),toneEnabled=!(mixer&(1<<ch)),noiseEnabled=!(mixer&(8<<ch)),frequency=clock/(16*Math.max(1,period)),volume=r[8+ch]&15,envelope=!!(r[8+ch]&16);return {channel:ch,type:'tone-noise',period,frequency,midi:69+12*Math.log2(frequency/440),toneEnabled,noiseEnabled,volume,envelope,configuredVolume:this.levels[ch]&15,configuredEnvelope:!!(this.levels[ch]&16),active:!!(r[8+ch]&31)};});
    return {kind:'ay8910',clock,sampleRate:this.sampleRate,registers:Array.from(r),channels,noise:{period:noisePeriod,frequency:clock/(16*Math.max(1,noisePeriod))},envelope:{period:envelopePeriod,shape,frequency:clock/(256*Math.max(1,envelopePeriod)),continue:!!(shape&8),attack:!!(shape&4),alternate:!!(shape&2),hold:!!(shape&1)},keyboardChannels:keyboardChannels('ay8910'),held:[...this.auditions.keys()]};
  }
}

import {PokeySynth} from './pokeysynth.js?v=pokey-mode-1';
import {keyboardChannels} from './playground_keyboard_channels.js?v=pokey-mode-1';
import {nativeVoiceChannel} from './playground_performance_processor.js?v=pokey-mode-1';
const identity=value=>{if(typeof value!=='string'||!value.length||value.length>128)throw new TypeError('Audition identity must contain 1..128 characters');return `voice-editor:${value}`;};
const channel=value=>{if(typeof value==='string'&&/^[0-3]$/.test(value))value=Number(value);if(!Number.isInteger(value)||value<0||value>3)throw new RangeError('POKEY channel must be 0..3');return value;};

export class PokeyVoiceInspector{
  /** @param {import('./playground_native_voice_inspector.js?v=pokey-mode-1').NativeVoiceInspectorOptions} [options] */
  constructor({clock=()=>1789790,sampleRate=44100,dispatch,beginAudition=()=>{},endAudition=()=>{}}={}){
    this.clock=typeof clock==='function'?clock:()=>clock;this.sampleRate=sampleRate;this.dispatch=dispatch;this.beginAudition=beginAudition;this.endAudition=endAudition;this.auditions=new Map();this.reset();
  }
  resetAuditions(){for(const [ch,id]of this.auditions)this.endAudition(ch,identity(id));this.auditions.clear();}
  reset(){this.resetAuditions();this.registers=new Uint8Array(16);this.levels=[8,8,8,8];}
  observeWrite(register,value){this.registers[register]=value;if(register<8&&(register&1)&&(value&15))this.levels[register>>1]=value&15;}
  getState(){return {clock:this.clock(),initialized:true,registers:Array.from(this.registers),levels:[...this.levels]};}
  stage(callback,owner){
    const commands=[],api=new PokeySynth({clock:this.clock(),transport:{writeRegister:(register,value)=>commands.push({method:'writeRegister',args:[register,value]}),reset:()=>commands.push({method:'reset',args:[]})}});
    api._adoptState(this.getState());const result=callback(api,commands),state=api._getState();
    for(const command of commands){const physical=nativeVoiceChannel('pokey',command,{pokeyRegisters:this.registers}),held=[...this.auditions].find(([ch])=>physical==='all'||physical===ch);this.dispatch(command,owner??(held?identity(held[1]):undefined),{preserveOwner:!owner});}
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
    if(!['setFrequency','setNote','setVolume','setDistortion','setVolumeOnly','setHighClock','setJoined','setBaseClock','setPoly9'].includes(method))throw new Error('Unsupported POKEY inspector operation');
    return this.stage(api=>api[method](...args));
  }
  read(){
    const r=this.registers,clock=this.clock();
    const channels=Array.from({length:4},(_,ch)=>{const lower=ch&2,joined=!!(r[8]&(lower===0?16:8)),helper=joined&&ch===lower;
      const high=!!(r[8]&(lower===0?64:32))&&(joined||ch===lower),divider=high?1:(r[8]&1?114:28),offset=high?(joined?7:4):1;
      const period=joined?(r[lower*2]|r[(lower+1)*2]<<8):r[ch*2],frequency=clock/(2*divider*(period+offset));
      return {channel:ch,period,frequency,joined,helper,highClock:high,distortion:r[ch*2+1]>>5,volume:r[ch*2+1]&15,configuredVolume:this.levels[ch],volumeOnly:!!(r[ch*2+1]&16),active:!!(r[ch*2+1]&15)};
    });
    return {kind:'pokey',clock,sampleRate:this.sampleRate,registers:Array.from(r),channels,keyboardChannels:keyboardChannels('pokey'),held:[...this.auditions.keys()]};
  }
}

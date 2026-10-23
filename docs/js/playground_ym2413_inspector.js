import {YM2413Synth,YM2413_INSTRUMENTS} from './ym2413synth.js?v=audio-numeric-bindings-1';
import {keyboardChannels} from './playground_keyboard_channels.js?v=native-extra-snes-1';
import {nativeVoiceChannel} from './playground_performance_processor.js?v=audio-numeric-bindings-1';
const DRUMS=['bassDrum','snare','tom','cymbal','hiHat'],PHYSICAL=[6,7,8,8,7];
const identity=value=>{if(typeof value!=='string'||!value.length||value.length>128)throw new TypeError('Audition identity must contain 1..128 characters');return `voice-editor:${value}`;};
/** Applied YM2413 state. Register reads neither replay controls nor advance audio. */
export class Ym2413VoiceInspector{
  /** @param {import('./playground_native_voice_inspector.js?v=nes-wasm-1').NativeVoiceInspectorOptions} [options] */
  constructor({clock=()=>3579545,sampleRate=44100,dispatch,beginAudition=()=>{},endAudition=()=>{}}={}){this.clock=typeof clock==='function'?clock:()=>clock;this.sampleRate=sampleRate;this.dispatch=dispatch;this.beginAudition=beginAudition;this.endAudition=endAudition;this.auditions=new Map();this.reset();}
  resetAuditions(){for(const [key,id]of this.auditions)this.endAudition(this.voice(key).physical,identity(id));this.auditions.clear();}
  reset(){this.resetAuditions();this.registers=new Uint8Array(64);}
  observeWrite(register,value){this.registers[register]=value;}
  voice(key){
    if(typeof key==='string'&&/^rhythm:[0-4]$/.test(key)){const index=Number(key.slice(7));return {key,drum:index,physical:PHYSICAL[index]};}
    const ch=typeof key==='string'&&/^[0-8]$/.test(key)?Number(key):key;
    if(!Number.isInteger(ch)||ch<0||ch>8)throw new RangeError('YM2413 voice must be 0..8 or rhythm:0..4');return {key:ch,physical:ch};
  }
  stage(callback,owner){
    const commands=[],api=new YM2413Synth({clock:this.clock(),transport:{writeRegister:(register,value)=>commands.push({method:'writeRegister',args:[register,value]}),reset:()=>commands.push({method:'reset',args:[]})}});
    api.adoptRegisterSnapshot(this.registers);const result=callback(api,commands);
    if(this.auditions.size&&commands.some(({method,args})=>method==='writeRegister'&&args[0]===0x0e&&!!((args[1]^this.registers[0x0e])&32)))this.invoke('auditionAllOff');
    for(const command of commands){const physical=nativeVoiceChannel('ym2413',command);const held=[...this.auditions].find(([key])=>physical==='all'||this.voice(key).physical===physical);this.dispatch(command,owner??(held?identity(held[1]):undefined),{preserveOwner:!owner});}
    return result;
  }
  invoke(method,args=[]){
    if(method==='auditionAllOff'){for(const [key,id]of [...this.auditions])this.invoke('auditionOff',[key,id]);return true;}
    if(method==='auditionOff'){
      const [input,id]=args,voice=this.voice(input),owner=identity(id);if(this.auditions.get(voice.key)!==id)return false;
      try{this.dispatch({method:voice.drum===undefined?'forceKeyOff':'forceRhythmOff',args:[voice.drum??voice.physical]},owner);}finally{this.auditions.delete(voice.key);this.endAudition(voice.physical,owner);}return true;
    }
    if(method==='auditionOn'){
      const [input,midi,id]=args,voice=this.voice(input),owner=identity(id);if(!Number.isInteger(midi)||midi<0||midi>127)throw new RangeError('MIDI note must be 0..127');
      const prepared=[];
      this.stage((api,commands)=>{
        if(voice.drum===undefined){api.keyOff(voice.physical);commands.length=0;api.setNote(voice.physical,midi);const pitchWrites=commands.length;api.keyOn(voice.physical);commands.length=pitchWrites;}
        else if(!(this.registers[0x0e]&32))throw new Error('Enable YM2413 rhythm mode before auditioning a drum');
        prepared.push(...commands);commands.length=0;
      });
      // Hi-hat/snare and tom/cymbal share physical operators. One manual lease
      // owns the complete hardware channel, including its counterpart voice.
      for(const [key,oldId]of [...this.auditions])if(this.voice(key).physical===voice.physical)this.invoke('auditionOff',[key,oldId]);
      this.auditions.set(voice.key,id);this.beginAudition(voice.physical,owner);
      if(voice.drum===undefined)this.dispatch({method:'forceKeyOff',args:[voice.physical]},owner);
      else for(let index=0;index<PHYSICAL.length;index++)if(PHYSICAL[index]===voice.physical)this.dispatch({method:'forceRhythmOff',args:[index]},owner);
      for(const command of prepared)this.dispatch(command,owner);
      this.dispatch({method:voice.drum===undefined?'auditionKeyOn':'auditionRhythmOn',args:[voice.drum??voice.physical]},owner);return true;
    }
    if(!['setVoice','setPreset','setInstrument','setAttenuation','setSustain','setUserPatch','setUserOperator','setNote','setFrequency','setPitch','setRhythm','setRhythmLevels','setRhythmLevel'].includes(method))throw new Error('Unsupported YM2413 inspector operation');
    return this.stage(api=>api[method](...args));
  }
  read(){
    const r=this.registers,clock=this.clock(),enabled=!!(r[0x0e]&32);
    const operators=[0,1].map(op=>{const a=r[op],c=r[4+op],d=r[6+op],waveform=(r[3]>>(op?4:3))&1;return {am:!!(a&128),vibrato:!!(a&64),egt:!!(a&32),sustain:!!(a&32),ksr:!!(a&16),multi:a&15,mul:a&15,ksl:r[2+op]>>6,ar:c>>4,dr:c&15,sl:d>>4,rr:d&15,waveform,...(op===0?{tl:r[2]&63}:{})};});
    const levels={bassDrum:r[0x36]&15,snare:r[0x37]&15,tom:r[0x38]>>4,cymbal:r[0x38]&15,hiHat:r[0x37]>>4};
    const channels=Array.from({length:9},(_,channel)=>{const low=r[0x10+channel],high=r[0x20+channel],voice=r[0x30+channel],fnum=low|((high&1)<<8),block=high>>1&7,frequency=fnum*2**block*clock/(72*2**19);return {channel,type:'fm',available:!(enabled&&channel>=6),active:!(enabled&&channel>=6)&&!!(high&16),instrument:voice>>4,instrumentName:YM2413_INSTRUMENTS[voice>>4],attenuation:voice&15,sustain:!!(high&32),fnum,block,frequency,midi:frequency?69+12*Math.log2(frequency/440):null};});
    return {kind:'ym2413',clock,sampleRate:this.sampleRate,activeSource:'applied-register-gates',registers:Array.from(r),channels,userPatch:{feedback:r[3]&7,operators,bytes:Array.from(r.slice(0,8)),shared:true},
      rhythm:{enabled,...Object.fromEntries(DRUMS.map((name,index)=>[name,enabled&&!!(r[0x0e]&(16>>index))])),levels},keyboardChannels:keyboardChannels('ym2413',{registers:r}),held:[...this.auditions.keys()]};
  }
}

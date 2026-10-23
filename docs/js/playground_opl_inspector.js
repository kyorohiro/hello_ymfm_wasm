import {OPLSynth} from './opl_synth.js?v=audio-numeric-bindings-1';
import {keyboardChannels} from './playground_keyboard_channels.js?v=native-extra-opl3-1';
import {nativeVoiceChannel} from './playground_performance_processor.js?v=audio-numeric-bindings-1';
const SLOTS=[0,1,2,8,9,10,16,17,18], PAIRS=[0,1,2,9,10,11];
const identity=value=>{if(typeof value!=='string'||!value.length||value.length>128)throw new TypeError('Audition identity must contain 1..128 characters');return `voice-editor:${value}`;};
/** Applied OPL registers. Reads never write audio or advance chip time. */
export class OplVoiceInspector {
  /** @param {import('./playground_native_voice_inspector.js?v=nes-wasm-1').NativeVoiceInspectorOptions & {chip?:import('./opl_synth.js?v=audio-numeric-bindings-1').OPLChip}} [options] */
  constructor({chip='ym3812',clock=()=>chip==='ymf262'?14318180:3579545,sampleRate=44100,dispatch,beginAudition=()=>{},endAudition=()=>{}}={}) {
    this.kind=chip;this.clock=typeof clock==='function'?clock:()=>clock;this.sampleRate=sampleRate;
    this.dispatch=dispatch;this.beginAudition=beginAudition;this.endAudition=endAudition;this.auditions=new Map();this.reset();
  }
  resetAuditions(){for(const [ch,id]of this.auditions){this.endAudition(ch,identity(id));const pair=this.paired(ch);if(pair!==null)this.endAudition(pair,identity(id));}this.auditions.clear();}
  reset(){this.resetAuditions();this.registers=new Uint8Array(this.kind==='ymf262'?512:256);}
  observeWrite(register,value,bank=0){this.registers[(bank<<8)|register]=value;}
  stage(callback,owner){
    const commands=[],api=new OPLSynth({chip:this.kind,clock:this.clock(),transport:{writeRegister:(register,value,bank=0)=>commands.push({method:'writeRegister',args:[register,value,bank]}),reset:()=>commands.push({method:'reset',args:[]})}});
    api.adoptRegisterSnapshot(this.registers);const result=callback(api,commands);
    if(this.auditions.size&&commands.some(({method,args})=>method==='writeRegister'&&(args[2]===1&&args[0]===4||args[2]===0&&args[0]===0xbd&&!!((args[1]^this.registers[0xbd])&32))))this.invoke('auditionAllOff');
    for(const command of commands){const ch=nativeVoiceChannel(this.kind,command),held=ch==='all'?this.auditions.values().next().value:this.auditions.get(ch);this.dispatch(command,owner??(held?identity(held):undefined),{preserveOwner:!owner});}
    return result;
  }
  paired(ch){const bit=PAIRS.indexOf(ch);return bit>=0&&(this.registers[0x104]&(1<<bit))?ch+3:null;}
  channel(ch){if(!Number.isInteger(ch)||ch<0||ch>=(this.kind==='ymf262'?18:9))throw new RangeError('Invalid OPL channel');return ch;}
  invoke(method,args=[]){
    if(method==='auditionAllOff'){for(const [ch,id]of [...this.auditions])this.invoke('auditionOff',[ch,id]);return true;}
    if(method==='auditionOff'){
      const [ch,id]=args;this.channel(ch);const owner=identity(id);if(this.auditions.get(ch)!==id)return false;
      try{this.dispatch({method:'forceKeyOff',args:[ch]},owner);}finally{this.auditions.delete(ch);this.endAudition(ch,owner);const pair=this.paired(ch);if(pair!==null)this.endAudition(pair,owner);}return true;
    }
    if(method==='auditionOn'){
      const [ch,midi,id]=args;this.channel(ch);if(!Number.isInteger(midi)||midi<0||midi>127)throw new RangeError('MIDI note must be 0..127');const owner=identity(id);
      // Validate the complete note before taking a lease or touching hardware.
      const prepared=[];this.stage((api,commands)=>{api.keyOff(ch);commands.length=0;api.setNote(ch,midi);const noteWrites=commands.length;api.keyOn(ch);commands.length=noteWrites;prepared.push(...commands);commands.length=0;});
      this.auditions.set(ch,id);this.beginAudition(ch,owner);const pair=this.paired(ch);if(pair!==null)this.beginAudition(pair,owner);this.dispatch({method:'forceKeyOff',args:[ch]},owner);
      for(const command of prepared)this.dispatch(command,owner);
      this.dispatch({method:'auditionKeyOn',args:[ch]},owner);return true;
    }
    if(!['setOperator','setPreset','setAlgo','setPan','setNote','setFrequency','setPitch','setFourOp','setRhythm','setLFO'].includes(method))throw new Error('Unsupported OPL inspector operation');
    return this.stage(api=>api[method](...args));
  }
  read(){
    const r=this.registers,clock=this.clock(),opl3=this.kind==='ymf262',rhythm=!!(r[0xbd]&32),pairMask=r[0x104]??0;
    const channels=Array.from({length:opl3?18:9},(_,ch)=>{
      const bank=ch>=9?256:0,local=ch%9,pairIndex=PAIRS.indexOf(ch),secondaryIndex=PAIRS.indexOf(ch-3);
      const fourOp=pairIndex>=0&&!!(pairMask&(1<<pairIndex)),secondary=secondaryIndex>=0&&!!(pairMask&(1<<secondaryIndex));
      const fnum=r[bank+0xa0+local]|((r[bank+0xb0+local]&3)<<8),block=r[bank+0xb0+local]>>2&7;
      const frequency=fnum*2**(block-1)*clock/((opl3?288:72)*2**19);
      const operators=Array.from({length:fourOp?4:2},(_,op)=>{
        const physical=ch+(op>=2?3:0),offset=(physical>=9?256:0)+SLOTS[physical%9]+(op%2?3:0),a=r[0x20+offset],b=r[0x40+offset],c=r[0x60+offset],d=r[0x80+offset];
        return {am:!!(a&128),vibrato:!!(a&64),egt:!!(a&32),sustain:!!(a&32),ksr:!!(a&16),multi:a&15,mul:a&15,ksl:b>>6,tl:b&63,ar:c>>4,dr:c&15,sl:d>>4,rr:d&15,waveform:opl3?r[0xe0+offset]&7:this.kind==='ym3812'&&(r[1]&32)?r[0xe0+offset]&3:0};
      });
      return {channel:ch,type:'fm',active:!secondary&&!(rhythm&&ch>=6&&ch<=8)&&!!(r[bank+0xb0+local]&32),available:!secondary&&!(rhythm&&ch>=6&&ch<=8),fnum,block,frequency,midi:frequency?69+12*Math.log2(frequency/440):null,
        algorithm:fourOp?(r[bank+0xc0+local]&1)|((r[bank+0xc0+local+3]&1)<<1):r[bank+0xc0+local]&1,feedback:r[bank+0xc0+local]>>1&7,
        pan:{left:!opl3||!!(r[bank+0xc0+local]&16),right:!opl3||!!(r[bank+0xc0+local]&32)},fourOp,pairedWith:fourOp?ch+3:secondary?ch-3:null,operators};
    });
    return {kind:this.kind,clock,sampleRate:this.sampleRate,activeSource:'applied-register-gates',registers:Array.from(r),channels,
      rhythm:{enabled:rhythm,bassDrum:!!(r[0xbd]&16),snare:!!(r[0xbd]&8),tom:!!(r[0xbd]&4),cymbal:!!(r[0xbd]&2),hiHat:!!(r[0xbd]&1)},
      lfo:{amDepth:!!(r[0xbd]&128),pmDepth:!!(r[0xbd]&64)},keyboardChannels:keyboardChannels(this.kind,{registers:r}),held:[...this.auditions.keys()]};
  }
}

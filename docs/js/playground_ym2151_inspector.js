import {noteToHz,opmPitchFromHz} from './soundchip_pitch.js';
import {nativeVoiceChannel} from './playground_performance_processor.js?v=scsp-fm-1';

// Algorithm operator order is M1, M2, C1, C2. The bus stores M1, C1, M2, C2.
const SLOTS=[0,16,8,24];
const FIELDS={dt1:[0x40,4,7],mul:[0x40,0,15],tl:[0x60,0,127],ks:[0x80,6,3],ar:[0x80,0,31],am:[0xa0,7,1],d1r:[0xa0,0,31],dt2:[0xc0,6,3],d2r:[0xc0,0,31],d1l:[0xe0,4,15],rr:[0xe0,0,15]};
const integer=(value,max,label)=>{if(!Number.isInteger(value)||value<0||value>max)throw new RangeError(`${label} must be 0..${max}`);return value;};
const boolean=(value,label)=>{if(typeof value!=='boolean')throw new TypeError(`${label} must be boolean`);return value;};
const channel=value=>integer(value,7,'YM2151 channel');
function object(value,keys,label){if(!value||typeof value!=='object'||Array.isArray(value))throw new TypeError(`${label} must be an object`);for(const key of Object.keys(value))if(!keys.includes(key))throw new TypeError(`Unknown ${label} field: ${key}`);}
function identity(value){if(typeof value!=='string'||!value.length||value.length>128)throw new TypeError('Audition identity must contain 1..128 characters');return `voice-editor:${value}`;}

/** Snapshot of applied OPM writes, independent of a Main/Worker client's shadow.
 * Reads never write the chip, advance audio or flush the performance queue.
 */
export class Ym2151VoiceInspector {
  /** @param {import('./playground_native_voice_inspector.js?v=pokey-mode-1').NativeVoiceInspectorOptions} [options] */
  constructor({clock=()=>3579545,sampleRate=44100,dispatch,beginAudition=()=>{},endAudition=()=>{}}={}){
    this.clock=typeof clock==='function'?clock:()=>clock;this.sampleRate=sampleRate;
    this.dispatch=dispatch;this.beginAudition=beginAudition;this.endAudition=endAudition;this.auditions=new Map();this.reset();
  }
  resetAuditions(){for(const [ch,id]of this.auditions)this.endAudition(ch,identity(id));this.auditions.clear();}
  reset(){this.resetAuditions();this.registers=new Uint8Array(256);this.keyMasks=new Uint8Array(8);this.amDepth=0;this.pmDepth=0;}
  observeWrite(register,value){
    this.registers[register]=value;
    if(register===8)this.keyMasks[value&7]=(value>>3)&15;
    if(register===0x19){if(value&128)this.pmDepth=value&127;else this.amDepth=value&127;}
  }
  observeKeyOff(ch){this.keyMasks[ch]=0;}
  ownsAudition(ch,owner){const id=this.auditions.get(ch);return id!==undefined&&identity(id)===owner;}
  /** Validate a complete edit against a private register copy before dispatching. */
  stage(callback,owner){
    const registers=this.registers.slice(),commands=[];
    const write=(register,value)=>{registers[register]=value;commands.push({method:'writeRegister',args:[register,value]});};
    const bits=(register,mask,value)=>write(register,(registers[register]&~mask)|value);
    const result=callback({registers,write,bits,commands});
    for(const command of commands){
      const ch=nativeVoiceChannel('ym2151',command),held=ch==='all'?this.auditions.values().next().value:this.auditions.get(ch);
      this.dispatch(command,owner??(held?identity(held):undefined));
    }
    return result;
  }
  operator(stage,ch,op,patch){
    channel(ch);integer(op,3,'Operator');object(patch,Object.keys(FIELDS),'YM2151 operator');
    for(const [field,value]of Object.entries(patch)){
      const [base,shift,max]=FIELDS[field],normalized=field==='am'&&typeof value==='boolean'?Number(value):integer(value,max,field);
      stage.bits(base+SLOTS[op]+ch,max<<shift,normalized<<shift);
    }
  }
  pitch(stage,ch,keyCode,keyFraction){channel(ch);integer(keyCode,127,'Key code');integer(keyFraction,63,'Key fraction');stage.bits(0x28+ch,127,keyCode);stage.bits(0x30+ch,252,keyFraction<<2);}
  frequency(stage,ch,hz){const pitch=opmPitchFromHz(hz,this.clock());this.pitch(stage,ch,pitch.keyCode,pitch.keyFraction);return pitch;}
  invoke(method,args=[]){
    if(method==='auditionAllOff'){for(const [ch,id]of [...this.auditions])this.invoke('auditionOff',[ch,id]);return true;}
    if(method==='auditionOff'){
      const [ch,id]=args;channel(ch);const owner=identity(id);if(this.auditions.get(ch)!==id)return false;
      try{this.dispatch({method:'forceKeyOff',args:[ch]},owner);}finally{this.auditions.delete(ch);this.endAudition(ch,owner);}return true;
    }
    if(method==='auditionOn'){
      const [ch,midi,id]=args;channel(ch);integer(midi,127,'MIDI note');const owner=identity(id),pitch=opmPitchFromHz(noteToHz(midi),this.clock());
      // Validate identity and pitch before acquiring/replacing a channel lease.
      this.auditions.set(ch,id);this.beginAudition(ch,owner);
      this.dispatch({method:'forceKeyOff',args:[ch]},owner);
      this.stage(stage=>{this.pitch(stage,ch,pitch.keyCode,pitch.keyFraction);stage.commands.push({method:'auditionKeyOn',args:[ch,15]});},owner);return true;
    }
    if(method==='setOperator')return this.stage(stage=>this.operator(stage,...args));
    if(method==='setFrequency')return this.stage(stage=>this.frequency(stage,...args));
    if(method==='setNote')return this.stage(stage=>this.frequency(stage,args[0],noteToHz(args[1])));
    if(method==='setPitch')return this.stage(stage=>this.pitch(stage,args[0],args[1],args[2]??0));
    if(method==='setVoice')return this.stage(stage=>{
      const [ch,patch]=args;channel(ch);object(patch,['algorithm','feedback','pan','ams','pms','keyCode','keyFraction','frequency','operators'],'YM2151 voice');
      if('algorithm'in patch)stage.bits(0x20+ch,7,integer(patch.algorithm,7,'Algorithm'));
      if('feedback'in patch)stage.bits(0x20+ch,56,integer(patch.feedback,7,'Feedback')<<3);
      if('pan'in patch){object(patch.pan,['left','right'],'pan');if('left'in patch.pan)stage.bits(0x20+ch,64,boolean(patch.pan.left,'Left pan')?64:0);if('right'in patch.pan)stage.bits(0x20+ch,128,boolean(patch.pan.right,'Right pan')?128:0);}
      if('ams'in patch)stage.bits(0x38+ch,3,integer(patch.ams,3,'AMS'));
      if('pms'in patch)stage.bits(0x38+ch,112,integer(patch.pms,7,'PMS')<<4);
      if('frequency'in patch){if('keyCode'in patch||'keyFraction'in patch)throw new TypeError('Specify frequency or raw key code/fraction');this.frequency(stage,ch,patch.frequency);}
      else if('keyCode'in patch||'keyFraction'in patch)this.pitch(stage,ch,patch.keyCode??(stage.registers[0x28+ch]&127),patch.keyFraction??(stage.registers[0x30+ch]>>2));
      if('operators'in patch){if(!Array.isArray(patch.operators)||patch.operators.length>4)throw new TypeError('Operators must contain up to four entries');for(let op=0;op<patch.operators.length;op++)if(patch.operators[op]!==undefined)this.operator(stage,ch,op,patch.operators[op]);}
    });
    if(method==='setLFO')return this.stage(stage=>{
      const [patch]=args;object(patch,['frequency','amDepth','pmDepth','waveform'],'YM2151 LFO');
      if('frequency'in patch)stage.write(0x18,integer(patch.frequency,255,'LFO frequency'));
      if('amDepth'in patch)stage.write(0x19,integer(patch.amDepth,127,'AM depth'));
      if('pmDepth'in patch)stage.write(0x19,128|integer(patch.pmDepth,127,'PM depth'));
      if('waveform'in patch)stage.bits(0x1b,3,integer(patch.waveform,3,'LFO waveform'));
    });
    if(method==='setNoise')return this.stage(stage=>{
      const [patch]=args;object(patch,['enabled','frequency'],'YM2151 noise');
      if('enabled'in patch)stage.bits(0x0f,128,boolean(patch.enabled,'Noise enabled')?128:0);
      if('frequency'in patch)stage.bits(0x0f,31,integer(patch.frequency,31,'Noise frequency'));
    });
    throw new Error('Unsupported YM2151 inspector operation');
  }
  read(){
    const r=this.registers,clock=this.clock();
    const channels=Array.from({length:8},(_,ch)=>{
      const keyCode=r[0x28+ch]&127,keyFraction=r[0x30+ch]>>2,midi=13+(keyCode>>4)*12+(keyCode&15)-((keyCode&15)>>2)+keyFraction/64+12*Math.log2(clock/3579545);
      const operators=SLOTS.map(slot=>Object.fromEntries(Object.entries(FIELDS).map(([field,[base,shift,max]])=>{const value=(r[base+slot+ch]>>shift)&max;return [field,field==='am'?!!value:value];})));
      return {channel:ch,type:'fm',active:!!this.keyMasks[ch],keyMask:this.keyMasks[ch],keyCode,keyFraction,midi,frequency:440*2**((midi-69)/12),algorithm:r[0x20+ch]&7,feedback:r[0x20+ch]>>3&7,pan:{left:!!(r[0x20+ch]&64),right:!!(r[0x20+ch]&128)},ams:r[0x38+ch]&3,pms:r[0x38+ch]>>4&7,operators};
    });
    return {kind:'ym2151',clock,sampleRate:this.sampleRate,activeSource:'applied-register-gates',registers:Array.from(r),channels,lfo:{frequency:r[0x18],amDepth:this.amDepth,pmDepth:this.pmDepth,waveform:r[0x1b]&3},noise:{enabled:!!(r[0x0f]&128),frequency:r[0x0f]&31}};
  }
}

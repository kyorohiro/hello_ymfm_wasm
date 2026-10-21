import {noteToHz} from './soundchip_pitch.js';
import {validateChipClock} from './playground_chip_clock.js?v=audio-numeric-bindings-1';
import {nativeVoiceChannel} from './playground_performance_processor.js?v=audio-numeric-bindings-1';

const integer=(v,max,label)=>{if(!Number.isInteger(v)||v<0||v>max)throw new RangeError(`${label} must be 0..${max}`);return v;};
const boolean=(v,label)=>{if(typeof v!=='boolean')throw new TypeError(`${label} must be boolean`);return v;};
function object(v,keys,label){if(!v||typeof v!=='object'||Array.isArray(v))throw new TypeError(`${label} must be an object`);for(const key of Object.keys(v))if(!keys.includes(key))throw new TypeError(`Unknown ${label} field: ${key}`);}
function identity(v){if(typeof v!=='string'||!v.length||v.length>128)throw new TypeError('Audition identity must contain 1..128 characters');return `voice-editor:${v}`;}

/** Applied register/RAM mirror. No reads advance the chip or change its latch. */
export class Huc6280VoiceInspector {
  /** @param {import('./playground_native_voice_inspector.js?v=audio-numeric-bindings-1').NativeVoiceInspectorOptions} [options] */
  constructor({clock=()=>3579545,sampleRate=44100,dispatch,beginAudition=()=>{},endAudition=()=>{}}={}){
    this.clock=typeof clock==='function'?clock:()=>clock;this.sampleRate=sampleRate;this.dispatch=dispatch;this.beginAudition=beginAudition;this.endAudition=endAudition;this.auditions=new Map();this.reset();
  }
  resetAuditions(){for(const [ch,id]of this.auditions)this.endAudition(ch,identity(id));this.auditions.clear();}
  reset(){this.resetAuditions();this.selected=0;this.globals=new Uint8Array(10);this.registers=Array.from({length:8},()=>new Uint8Array(8));this.waveforms=Array.from({length:8},()=>new Uint8Array(32));this.indices=new Uint8Array(8);this.pointerKnown=new Uint8Array(8).fill(1);this.waveformKnown=new Uint8Array(8).fill(1);this.knownSamples=new Uint32Array(8).fill(0xffffffff);this.ddaValues=new Uint8Array(8);}
  observeWrite(register,value){
    if(register===0){this.selected=value&7;this.globals[0]=value;return;}
    if([1,8,9].includes(register)){this.globals[register]=value;return;}
    const ch=this.selected,r=this.registers[ch];
    if(register===4&&(r[4]&64)&&!(value&64)){this.indices[ch]=0;this.pointerKnown[ch]=1;}
    if(register===6){
      if(r[4]&64)this.ddaValues[ch]=value&31;
      else if(this.pointerKnown[ch]){const index=this.indices[ch];this.waveforms[ch][index]=value&31;this.knownSamples[ch]|=1<<index;if(this.knownSamples[ch]===0xffffffff)this.waveformKnown[ch]=1;if(!(r[4]&128))this.indices[ch]=(index+1)&31;}
      else {this.waveformKnown[ch]=0;this.knownSamples[ch]=0;}
    }
    r[register]=value;
  }
  observeRendered(){
    const depth=this.globals[9]&3,waveActive=ch=>!!(this.registers[ch][4]&128)&&!(this.registers[ch][4]&64)&&!(ch>=4&&(this.registers[ch][7]&128));
    for(let ch=0;ch<6;ch++)if(waveActive(ch)&&!(depth&&ch===1))this.pointerKnown[ch]=0;
    if(depth&&waveActive(0)){if(this.globals[9]&128){this.indices[1]=0;this.pointerKnown[1]=1;}else this.pointerKnown[1]=0;}
  }
  stage(callback,owner,preserveOwner=true){
    const commands=[],registers=this.registers.map(r=>r.slice()),globals=this.globals.slice();
    const write=(ch,register,value)=>{if([1,8,9].includes(register))globals[register]=value;else registers[ch][register]=value;commands.push({method:'writeRegister',args:[register,value],channel:ch});};
    const value=callback({registers,globals,write,commands});
    for(const command of commands){const ch=nativeVoiceChannel('huc6280',command),held=ch==='all'?this.auditions.values().next().value:this.auditions.get(ch);this.dispatch(command,owner??(held?identity(held):undefined),{preserveOwner});}return value;
  }
  frequency(stage,ch,hz){integer(ch,5,'Channel');if(!Number.isFinite(hz)||hz<=0)throw new RangeError('Frequency must be positive finite Hz');const period=Math.round(this.clock()/(32*hz));if(period<1||period>4096)throw new RangeError('Frequency is outside the HuC6280 period range');this.period(stage,ch,period&4095);return this.clock()/(32*period);}
  period(stage,ch,period){integer(period,4095,'Period');stage.write(ch,2,period&255);stage.write(ch,3,(stage.registers[ch][3]&240)|(period>>8));}
  waveform(stage,ch,values){
    if(!(Array.isArray(values)||values instanceof Uint8Array)||values.length!==32)throw new RangeError('Expected 32 five-bit samples');const samples=Array.from(values,v=>integer(v,31,'Wave sample'));
    stage.commands.push({method:'setWaveform',args:[ch,samples],channel:ch});
  }
  invoke(method,args=[]){
    if(method==='auditionAllOff'){for(const [ch,id]of [...this.auditions])this.invoke('auditionOff',[ch,id]);return true;}
    if(method==='auditionOff'){const [ch,id]=args;integer(ch,5,'Channel');const owner=identity(id);if(this.auditions.get(ch)!==id)return false;try{this.dispatch({method:'keyOff',args:[ch]},owner);}finally{this.auditions.delete(ch);this.endAudition(ch,owner);}return true;}
    if(method==='auditionOn'){
      const [ch,midi,id]=args;integer(ch,5,'Channel');integer(midi,127,'MIDI note');const owner=identity(id);if(this.registers[ch][4]&64)throw new Error('DDA is a direct DAC mode; disable DDA before note audition');
      // Validate pitch before the previous audition or physical key is touched.
      const noise=ch>=4&&(this.registers[ch][7]&128),period=noise?null:Math.round(this.clock()/(32*noteToHz(midi)));if(!noise&&(period<1||period>4096))throw new RangeError('Frequency is outside the HuC6280 period range');
      this.auditions.set(ch,id);this.beginAudition(ch,owner);this.dispatch({method:'keyOff',args:[ch]},owner);
      this.stage(stage=>{if(!noise)this.period(stage,ch,period&4095);stage.write(ch,4,stage.registers[ch][4]|128);},owner,false);return true;
    }
    if(method==='setFrequency')return this.stage(s=>this.frequency(s,...args));
    if(method==='setNote')return this.stage(s=>this.frequency(s,args[0],noteToHz(args[1])));
    if(method==='setWaveform'){integer(args[0],5,'Channel');return this.stage(s=>this.waveform(s,...args));}
    if(method==='setClock'){const clock=validateChipClock(args[0]);return this.stage(s=>s.commands.push({method:'clock',args:[clock]}));}
    if(method==='setMasterVolume')return this.stage(s=>{const [patch]=args;object(patch,['left','right'],'master volume');let value=s.globals[1];if('left'in patch)value=(value&15)|(integer(patch.left,15,'Master left')<<4);if('right'in patch)value=(value&240)|integer(patch.right,15,'Master right');s.write(0,1,value);});
    if(method==='setLfo')return this.stage(s=>{const [patch]=args;object(patch,['frequency','depth','reset'],'LFO');if('frequency'in patch)s.write(0,8,integer(patch.frequency,255,'LFO frequency'));let control=s.globals[9];if('depth'in patch)control=(control&252)|integer(patch.depth,3,'LFO depth');if('reset'in patch)control=(control&127)|(boolean(patch.reset,'LFO reset')?128:0);if('depth'in patch||'reset'in patch)s.write(0,9,control);});
    if(method==='setVoice'){
      const result=this.stage(s=>{
      const [ch,patch]=args;integer(ch,5,'Channel');object(patch,['volume','pan','period','frequency','dda','ddaValue','noise','waveform'],'HuC6280 voice');const r=s.registers[ch];
      if('volume'in patch)s.write(ch,4,(r[4]&224)|integer(patch.volume,31,'Volume'));
      if('pan'in patch){object(patch.pan,['left','right'],'pan');let value=r[5];if('left'in patch.pan)value=(value&15)|(integer(patch.pan.left,15,'Left balance')<<4);if('right'in patch.pan)value=(value&240)|integer(patch.pan.right,15,'Right balance');s.write(ch,5,value);}
      if('frequency'in patch){if('period'in patch)throw new TypeError('Specify frequency or raw period');this.frequency(s,ch,patch.frequency);}else if('period'in patch)this.period(s,ch,patch.period);
      if('noise'in patch){if(ch<4)throw new RangeError('Noise is available on channels 4 and 5');object(patch.noise,['enabled','frequency'],'noise');let value=r[7];if('enabled'in patch.noise)value=(value&127)|(boolean(patch.noise.enabled,'Noise enabled')?128:0);if('frequency'in patch.noise)value=(value&224)|integer(patch.noise.frequency,31,'Noise frequency');s.write(ch,7,value);}
      if('waveform'in patch)this.waveform(s,ch,patch.waveform);
      if('dda'in patch)s.write(ch,4,(r[4]&63)|(boolean(patch.dda,'DDA mode')?64:0));
      if('ddaValue'in patch){if(!(r[4]&64))throw new Error('Enable DDA before setting its DAC value');s.write(ch,4,r[4]&127);s.write(ch,6,integer(patch.ddaValue,31,'DDA sample'));}
      });
      if('dda'in args[1]||'ddaValue'in args[1]){const id=this.auditions.get(args[0]);if(id!==undefined)this.invoke('auditionOff',[args[0],id]);}
      return result;
    }
    throw new Error('Unsupported HuC6280 inspector operation');
  }
  read(){const clock=this.clock(),channels=Array.from({length:6},(_,ch)=>{const r=this.registers[ch],period=r[2]|((r[3]&15)<<8),noise=ch>=4?{enabled:!!(r[7]&128),frequency:r[7]&31}:null;return {channel:ch,type:noise?.enabled?'noise':r[4]&64?'dda':'wave',active:!!(r[4]&128),enabled:!!(r[4]&128),dda:!!(r[4]&64),ddaValue:this.ddaValues[ch],volume:r[4]&31,pan:{left:r[5]>>4,right:r[5]&15},period,frequency:clock/(32*(period||4096)),waveform:Array.from(this.waveforms[ch]),waveformKnown:!!this.waveformKnown[ch],waveformPointer:this.pointerKnown[ch]?this.indices[ch]:null,noise,registers:Array.from(r)};});return {kind:'huc6280',clock,sampleRate:this.sampleRate,activeSource:'applied-register-gates',selectedChannel:this.selected,masterVolume:{left:this.globals[1]>>4,right:this.globals[1]&15},lfo:{frequency:this.globals[8],depth:this.globals[9]&3,reset:!!(this.globals[9]&128)},globals:Array.from(this.globals),channels};}
}

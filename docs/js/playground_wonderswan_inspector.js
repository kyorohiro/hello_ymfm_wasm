import {noteToHz} from './soundchip_pitch.js';
import {validateChipClock} from './playground_chip_clock.js?v=wonderswan-mode-2';

const integer=(value,min,max,label)=>{if(!Number.isInteger(value)||value<min||value>max)throw new RangeError(`${label} must be ${min}..${max}`);return value;};
const boolean=(value,label)=>{if(typeof value!=='boolean')throw new TypeError(`${label} must be boolean`);return value;};
function object(value,keys,label){if(!value||typeof value!=='object'||Array.isArray(value))throw new TypeError(`${label} must be an object`);for(const key of Object.keys(value))if(!keys.includes(key))throw new TypeError(`Unknown ${label} field: ${key}`);}
function identity(value){if(typeof value!=='string'||!value.length||value.length>128)throw new TypeError('Audition identity must contain 1..128 characters');return `voice-editor:${value}`;}

/** Applied register/RAM mirror. Reading never generates audio or writes a register. */
export class WonderSwanVoiceInspector {
  /** @param {{clock?:number|(()=>number),sampleRate?:number,dispatch?:(command:any,owner?:string,metadata?:any)=>any,beginAudition?:(channel:number,owner:string)=>void,endAudition?:(channel:number,owner:string)=>void}} [options] */
  constructor({clock=()=>3072000,sampleRate=44100,dispatch,beginAudition=()=>{},endAudition=()=>{}}={}){
    this.clock=typeof clock==='function'?clock:()=>clock;this.sampleRate=sampleRate;this.dispatch=dispatch;this.beginAudition=beginAudition;this.endAudition=endAudition;this.auditions=new Map();this.reset();
  }
  resetAuditions(){for(const [ch,id] of this.auditions)this.endAudition(ch,identity(id));this.auditions.clear();}
  reset(){this.resetAuditions();this.registers=new Uint8Array(32);this.memory=new Uint8Array(16384);}
  observeWrite(address,value){this.registers[address-0x80]=address===0x8e?value&~8:value;}
  observeMemory(address,value){this.memory[address]=value;}
  effectiveClock(){return Math.floor(this.clock()/128)*128;}
  stage(callback,owner,preserveOwner=true){
    const registers=this.registers.slice(),commands=[];
    const write=(address,value,channel,controlMask)=>{registers[address-0x80]=value;commands.push({method:'writeRegister',args:[address,value],...(channel!==undefined?{channel}:{}),...(controlMask!==undefined?{controlMask}:{})});};
    const result=callback({registers,commands,write});
    for(const command of commands){let ch=command.channel;if(ch===undefined&&command.method==='writeRegister'&&command.args[0]>=0x80&&command.args[0]<=0x8b)ch=command.args[0]<0x88?(command.args[0]-0x80)>>1:command.args[0]-0x88;const held=ch===undefined?this.auditions.values().next().value:this.auditions.get(ch);this.dispatch(command,owner??(held?identity(held):undefined),{preserveOwner});}
    return result;
  }
  frequency(stage,ch,hz){integer(ch,0,3,'Channel');if(!Number.isFinite(hz)||hz<=0)throw new RangeError('Frequency must be positive finite Hz');const period=Math.round(this.effectiveClock()/(32*hz));if(period<1||period>2048)throw new RangeError('Frequency is outside the WonderSwan period range');this.period(stage,ch,period);return this.effectiveClock()/(32*period);}
  period(stage,ch,period){integer(ch,0,3,'Channel');integer(period,1,2048,'Period');const value=2048-period;stage.write(0x80+ch*2,value&255,ch);stage.write(0x81+ch*2,value>>8,ch);}
  waveform(stage,ch,values){
    integer(ch,0,3,'Channel');if(!(Array.isArray(values)||values instanceof Uint8Array)||values.length!==32)throw new RangeError('Expected 32 four-bit samples');const samples=Array.from(values,value=>integer(value,0,15,'Wave sample')),base=((stage.registers[15]<<6)+ch*16)&0x3fff;
    for(let i=0;i<16;i++)stage.commands.push({method:'writeMemory',args:[(base+i)&0x3fff,samples[i*2]|(samples[i*2+1]<<4)],channel:ch});
  }
  invoke(method,args=[]){
    if(method==='auditionAllOff'){for(const [ch,id] of [...this.auditions])this.invoke('auditionOff',[ch,id]);return true;}
    if(method==='auditionOff'){const [ch,id]=args;integer(ch,0,3,'Channel');const owner=identity(id);if(this.auditions.get(ch)!==id)return false;try{this.dispatch({method:'keyOff',args:[ch]},owner);}finally{this.auditions.delete(ch);this.endAudition(ch,owner);}return true;}
    if(method==='auditionOn'){
      const [ch,midi,id]=args;integer(ch,0,3,'Channel');integer(midi,0,127,'MIDI note');const owner=identity(id),control=this.registers[16];if(ch===1&&(control&32))throw new Error('PCM is a direct DAC mode; disable PCM before note audition');
      const period=Math.round(this.effectiveClock()/(32*noteToHz(midi)));if(period<1||period>2048)throw new RangeError('Frequency is outside the WonderSwan period range');
      // The endpoint may have an accepted clock reservation. Let its preflight
      // reject before replacing either the inspector lease or physical note.
      this.beginAudition(ch,owner);this.auditions.set(ch,id);this.dispatch({method:'keyOff',args:[ch]},owner);
      this.stage(stage=>{if(period!==null)this.period(stage,ch,period);stage.write(0x90,stage.registers[16]|(1<<ch),ch,1<<ch);},owner,false);return true;
    }
    if(method==='setClock'){const hz=validateChipClock(args[0]);return this.stage(stage=>stage.commands.push({method:'clock',args:[hz]}));}
    if(method==='setFrequency')return this.stage(stage=>this.frequency(stage,...args));
    if(method==='setNote')return this.stage(stage=>this.frequency(stage,args[0],noteToHz(args[1])));
    if(method==='setWaveform')return this.stage(stage=>this.waveform(stage,...args));
    if(method==='setVoice')return this.stage(stage=>{
      const [ch,patch]=args;integer(ch,0,3,'Channel');object(patch,['pan','frequency','period','frequencyRegister','waveform'],'WonderSwan voice');
      if('pan'in patch){object(patch.pan,['left','right'],'pan');let value=stage.registers[8+ch];if('left'in patch.pan)value=(value&15)|(integer(patch.pan.left,0,15,'Left volume')<<4);if('right'in patch.pan)value=(value&240)|integer(patch.pan.right,0,15,'Right volume');stage.write(0x88+ch,value,ch);}
      if(['frequency','period','frequencyRegister'].filter(key=>key in patch).length>1)throw new TypeError('Specify frequency or one raw period');if('frequency'in patch)this.frequency(stage,ch,patch.frequency);if('period'in patch)this.period(stage,ch,patch.period);if('frequencyRegister'in patch)this.period(stage,ch,2048-integer(patch.frequencyRegister,0,2047,'Frequency register'));if('waveform'in patch)this.waveform(stage,ch,patch.waveform);
    });
    if(method==='setSweep')return this.stage(stage=>{
      const [patch]=args;object(patch,['enabled','step','time'],'sweep');if('step'in patch)stage.write(0x8c,integer(patch.step,-128,127,'Sweep step')&255,2);if('time'in patch)stage.write(0x8d,integer(patch.time,0,31,'Sweep time'),2);if('enabled'in patch)stage.write(0x90,(stage.registers[16]&~64)|(boolean(patch.enabled,'Sweep enabled')?64:0),2,64);
    });
    if(method==='setNoise')return this.stage(stage=>{
      const [patch]=args;object(patch,['enabled','type','reset'],'noise');let value=stage.registers[14]&23;if('type'in patch)value=(value&16)|integer(patch.type,0,7,'Noise type');if('enabled'in patch)value=(value&7)|(boolean(patch.enabled,'Noise enabled')?16:0);if('reset'in patch&&boolean(patch.reset,'Noise reset'))value|=8;stage.write(0x8e,value,3);if('enabled'in patch)stage.write(0x90,(stage.registers[16]&~128)|(patch.enabled?128:0),3,128);
    });
    if(method==='setVoiceMode'){
      const enabled=boolean(args[0],'PCM mode');const result=this.stage(stage=>stage.write(0x90,(stage.registers[16]&~32)|(enabled?32:0),1,32));if(enabled){const id=this.auditions.get(1);if(id!==undefined)this.invoke('auditionOff',[1,id]);}return result;
    }
    if(method==='setPcmVolume')return this.stage(stage=>stage.write(0x94,integer(args[0],0,15,'PCM volume'),1));
    throw new Error('Unsupported WonderSwan inspector operation');
  }
  read(){
    const r=this.registers,clock=this.clock(),effectiveClock=this.effectiveClock(),control=r[16],sampleAddress=r[15]<<6,channels=Array.from({length:4},(_,channel)=>{const frequencyRegister=r[channel*2]|((r[channel*2+1]&7)<<8),period=2048-frequencyRegister,base=(sampleAddress+channel*16)&0x3fff,pcm=channel===1&&!!(control&32),noise=channel===3&&!!(control&128);return {channel,type:pcm?'pcm':noise?'noise':'wave',active:!!(control&(1<<channel)),enabled:!!(control&(1<<channel)),frequency:effectiveClock/(32*period),frequencyRegister,period,pan:{left:r[8+channel]>>4,right:r[8+channel]&15},waveform:Array.from({length:32},(_,i)=>this.memory[(base+(i>>1))&0x3fff]>>((i&1)*4)&15),waveformKnown:true,registers:[r[channel*2],r[channel*2+1],r[8+channel]]};});
    return {kind:'wonderswan',clock,effectiveClock,sampleRate:this.sampleRate,activeSource:'applied-register-gates',outputEnabled:!!(r[17]&8),sampleAddress,voiceMode:!!(control&32),sweep:{enabled:!!(control&64),step:r[12]<128?r[12]:r[12]-256,time:r[13]&31},noise:{enabled:!!(r[14]&16)&&!!(control&128),type:r[14]&7},pcmVolume:r[20]&15,registers:Array.from(r),channels};
  }
}

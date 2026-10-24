import {GameboySynth} from './gameboysynth.js?v=audio-stability-2';
import {NesApuSynth} from './nesapusynth.js?v=nes-wasm-1';
import {nativeVoiceChannel} from './playground_performance_processor.js?v=extra-ym2612-nuked-1';

const DUTY=[.125,.25,.5,.75],LEVEL=[0,1,.5,.25];
const integer=(v,min,max,name)=>{if(!Number.isInteger(v)||v<min||v>max)throw new RangeError(`${name} must be ${min}..${max}`);return v;};
const boolean=(v,name)=>{if(typeof v!=='boolean')throw new TypeError(`${name} must be boolean`);return v;};
function options(value,keys){if(!value||typeof value!=='object'||Array.isArray(value))throw new TypeError('Voice must be an object');for(const key of Object.keys(value))if(!keys.includes(key))throw new TypeError(`Unknown voice property: ${key}`);}
function identity(value){if(typeof value!=='string'||!value.length||value.length>128)throw new TypeError('Audition identity must contain 1..128 characters');return `voice-editor:${value}`;}

/**
 * @typedef {{method: string, args?: any[], channel?: number}} NativeVoiceCommand
 * @typedef {object} NativeVoiceInspectorOptions
 * @property {number | (() => number)} [clock]
 * @property {number} [sampleRate]
 * @property {(command: NativeVoiceCommand, owner?: string, metadata?: {preserveOwner?: boolean}) => void} [dispatch]
 * @property {(channel: number, owner: string) => void} [beginAudition]
 * @property {(channel: number, owner: string) => void} [endAudition]
 */

/**
 * @typedef {{channel:number,active:boolean,frequency:number,pan:{left:boolean,right:boolean},
 * lengthEnabled:boolean,lengthCount:number,length:number}} GameboyVoiceChannelBase
 * @typedef {{direction:'up'|'down',period:number}} GameboyVoiceEnvelope
 * @typedef {{direction:'up'|'down',period:number,shift:number}} GameboyVoiceSweep
 * @typedef {GameboyVoiceChannelBase & {channel:0|1,type:'pulse',period:number,
 * duty:0.125|0.25|0.5|0.75,volume:number,envelope:GameboyVoiceEnvelope,
 * sweep?:GameboyVoiceSweep}} GameboyPulseVoiceSnapshot
 * @typedef {GameboyVoiceChannelBase & {channel:2,type:'wave',period:number,
 * level:0|0.25|0.5|1,waveform:number[]}} GameboyWaveVoiceSnapshot
 * @typedef {GameboyVoiceChannelBase & {channel:3,type:'noise',volume:number,
 * envelope:GameboyVoiceEnvelope,divisor:number,shift:number,width:7|15}} GameboyNoiseVoiceSnapshot
 * @typedef {GameboyPulseVoiceSnapshot|GameboyWaveVoiceSnapshot|GameboyNoiseVoiceSnapshot} GameboyVoiceChannelSnapshot
 * @typedef {{kind:'gameboy',clock:number,sampleRate:number,powered:boolean,
 * activeSource:'applied-register-gates',masterVolume:{left:number,right:number},
 * channels:GameboyVoiceChannelSnapshot[],registers:number[]}} GameboyVoiceSnapshot
 */

/** Mirrors only applied writes. read() never renders audio, triggers a note, or sends a message. */
class VoiceInspector {
  /** @param {any} chip @param {NativeVoiceInspectorOptions} [options] */
  constructor(chip,{clock,sampleRate=44100,dispatch,beginAudition=()=>{},endAudition=()=>{}}={}) {
    this.chip=chip;this.clock=typeof clock==='function'?clock:()=>clock??chip.clock;
    this.sampleRate=sampleRate;this.dispatch=dispatch??(command=>chip[command.method](...(command.args??[])));
    this.beginAudition=beginAudition;this.endAudition=endAudition;this.auditions=new Map();
    const write=chip.writeRegister.bind(chip),reset=chip.reset.bind(chip);
    chip.writeRegister=(address,value)=>{const result=write(address,value);this.observeWrite(address,value);return result;};
    chip.reset=()=>{const result=reset();this.reset();return result;};
  }
  audition(method,args) {
    if(method==='auditionAllOff'){for(const [channel,id]of [...this.auditions])this.audition('auditionOff',[channel,id]);return true;}
    const [channel,noteOrId,id]=args;
    integer(channel,0,this.kind==='gameboy'?3:this.fdsEnabled?5:4,'Channel');
    if(method==='auditionOff') {
      identity(noteOrId);if(this.auditions.get(channel)!==noteOrId)return false;
      const owner=identity(noteOrId);
      try{this.stage(synth=>this.keyOff(synth,channel),owner);}finally{this.auditions.delete(channel);this.endAudition(channel,owner);}
      return true;
    }
    integer(noteOrId,0,127,'MIDI note');const owner=identity(id);
    // Validation occurs before acquiring a manual channel lease or touching the chip.
    const prepared=this.prepare(synth=>this.keyOn(synth,channel,noteOrId));
    this.auditions.set(channel,id);this.beginAudition(channel,owner);
    this.commit(prepared,owner);return true;
  }
  stage(callback,owner){const prepared=this.prepare(callback);this.commit(prepared,owner);return prepared.value;}
  commit({commands,state},owner){for(const command of commands){const channel=nativeVoiceChannel(this.kind,command),held=channel==='all'?this.auditions.values().next().value:this.auditions.get(channel);this.dispatch(command,owner??(held?identity(held):undefined));}this.adoptConfigured(state);}
  resetAuditions(){for(const [channel,id]of this.auditions)this.endAudition(channel,identity(id));this.auditions.clear();}
}

export class GameboyVoiceInspector extends VoiceInspector {
  /** @param {any} chip @param {NativeVoiceInspectorOptions} [options] */
  constructor(chip,options={}){super(chip,options);this.kind='gameboy';this.reset();}
  reset(){this.resetAuditions();this.registers=new Uint8Array(48);this.voice=new Uint8Array(48);this.gates=[false,false,false,false];}
  observeWrite(offset,value) {
    if(offset<0||offset>=48)return;
    const trigger=[4,9,14,19].indexOf(offset);
    this.registers[offset]=trigger>=0?value&127:value;
    if(offset===22&&!(value&128)){this.registers.fill(0,0,23);this.voice.fill(0,0,23);this.gates.fill(false);this.resetAuditions();return;}
    // keyOff intentionally clears DAC/envelope registers. Retain the last voice
    // so inspecting and auditioning a stopped channel does not erase its tone.
    if(!([2,7,17].includes(offset)&&value===0)&&!(offset===10&&!(value&128)))this.voice[offset]=trigger>=0?value&127:value;
    if(trigger>=0&&(value&128))this.gates[trigger]=true;
    if([2,7,17].includes(offset)&&!(value&248))this.gates[{2:0,7:1,17:3}[offset]]=false;
    if(offset===10&&!(value&128))this.gates[2]=false;
  }
  prepare(callback){
    const commands=[],synth=new GameboySynth({clock:this.clock(),transport:{writeRegister:(...args)=>commands.push({method:'writeRegister',args}),reset:()=>commands.push({method:'reset',args:[]})}});
    synth._adoptState({clock:this.clock(),initialized:!!(this.registers[22]&128),registers:Array.from(this.registers),voice:Array.from(this.voice)});
    const value=callback(synth);return {commands,state:synth._getState(),value};
  }
  adoptConfigured(state){this.voice.set(state.voice);}
  keyOn(synth,channel,midi){
    const lengthEnabled=!!(this.voice[channel*5+4]&64);
    if(channel===3)synth.noise.keyOn();else synth.noteOn(channel,midi);
    if(lengthEnabled){const offset=channel*5+4;synth.writeRegister(offset,synth._getState().voice[offset]|0xc0);}
  }
  keyOff(synth,channel){synth.keyOff(channel);}
  invoke(method,args=[]){
    if(['auditionOn','auditionOff','auditionAllOff'].includes(method))return this.audition(method,args);
    if(method==='setPower')return this.stage(s=>{const enabled=boolean(args[0],'APU power');s.writeRegister(22,enabled?128:0);if(enabled)s.adoptRegisterState();});
    if(method==='setMasterVolume')return this.stage(s=>s.setMasterVolume(...args));
    if(method==='setVoice'){
      const [channel,patch]=args;integer(channel,0,3,'Channel');
      const common=['pan','lengthEnabled','lengthCount'];
      options(patch,channel<2?[...common,'duty','volume','envelope','sweep','frequency']:channel===2?[...common,'level','waveform','frequency']:[...common,'volume','envelope','divisor','shift','width']);
      return this.stage(synth=>{
        if(channel<2){const value={};for(const key of ['duty','volume','envelope'])if(key in patch)value[key]=patch[key];if(Object.keys(value).length)synth.pulse.setVoice(channel,value);if('sweep'in patch){if(channel!==0)throw new RangeError('Sweep is available on Pulse 1');synth.pulse.setSweep(patch.sweep);}}
        else if(channel===2){if('waveform'in patch)synth.wave.setWaveform(patch.waveform);if('level'in patch)synth.wave.setLevel(patch.level);}
        else {const value={};for(const key of ['volume','envelope','divisor','shift','width'])if(key in patch)value[key]=patch[key];if(Object.keys(value).length)synth.noise.setVoice(value);}
        if('frequency'in patch)synth.setFrequency(channel,patch.frequency);
        if('pan'in patch){options(patch.pan,['left','right']);synth.setPan(channel,patch.pan.left,patch.pan.right);}
        const state=synth._getState(),base=channel*5;
        if('lengthCount'in patch){const max=channel===2?255:63,count=integer(patch.lengthCount,0,max,'Length count'),offset=channel===2?11:base+1;synth.writeRegister(offset,(state.voice[offset]&~max)|count);}
        if('lengthEnabled'in patch){const offset=base+4,enabled=boolean(patch.lengthEnabled,'Length enabled');synth.writeRegister(offset,(state.voice[offset]&~0xc0)|(enabled?64:0));}
      });
    }
    if(method==='setFrequency')return this.stage(s=>s.setFrequency(...args));
    throw new Error('Unsupported Game Boy inspector operation');
  }
  /** @returns {GameboyVoiceSnapshot} */
  read(){
    const r=this.registers,v=this.voice,powered=!!(r[22]&128),clock=this.clock();
    const channels=Array.from({length:4},(_,channel)=>{
      const base=channel*5,wave=channel===2,noise=channel===3,period=r[base+3]|((r[base+4]&7)<<8),envelope=v[base+2];
      const result={channel,type:wave?'wave':noise?'noise':'pulse',active:powered&&this.gates[channel],pan:{left:!!(r[21]&(16<<channel)),right:!!(r[21]&(1<<channel))},lengthEnabled:!!(r[base+4]&64),lengthCount:v[wave?11:base+1]&(wave?255:63),length:wave?256-(v[11]&255):64-(v[base+1]&63)};
      if(wave)Object.assign(result,{period,frequency:clock/(64*(2048-period)),level:LEVEL[v[12]>>5&3],waveform:Array.from({length:32},(_,i)=>v[32+(i>>1)]>>(i%2?0:4)&15)});
      else Object.assign(result,{volume:envelope>>4,envelope:{direction:envelope&8?'up':'down',period:envelope&7},...(noise?{divisor:v[18]&7,shift:v[18]>>4,width:v[18]&8?7:15,frequency:clock/((v[18]&7)?16*(v[18]&7):8)/2**(v[18]>>4)}:{period,frequency:clock/(32*(2048-period)),duty:DUTY[v[base+1]>>6]})});
      if(channel===0)result.sweep={direction:v[0]&8?'down':'up',period:v[0]>>4&7,shift:v[0]&7};
      return result;
    });
    return {kind:this.kind,clock,sampleRate:this.sampleRate,powered,activeSource:'applied-register-gates',masterVolume:{left:r[20]>>4&7,right:r[20]&7},channels,registers:Array.from(r)};
  }
}

export class NesVoiceInspector extends VoiceInspector {
  /** @param {any} chip @param {NativeVoiceInspectorOptions} [options] */
  constructor(chip,options={}){
    super(chip,options);this.kind='nes';this.fdsEnabled=!!chip.fdsEnabled;this.reset();
    const load=chip.loadMemory?.bind(chip);if(load)chip.loadMemory=(bytes,address=0xc000)=>{const result=load(bytes,address);this.memoryRanges.push({address,end:address+bytes.length});return result;};
  }
  reset(){this.resetAuditions();this.registers=new Uint8Array(0x90);this.enabled=0;this.fdsGain=32;this.fdsMaster=0;this.modTable=new Uint8Array(32);this.modCursor=0;this.memoryRanges=[];}
  observeWrite(address,value){
    if(address<0x4000||address>0x408a)return;this.registers[address-0x4000]=value;
    if(address===0x4015)this.enabled=value&31;
    if(address===0x4080&&(value&128)&&(value&63))this.fdsGain=Math.min(32,value&63);
    if(address===0x4089)this.fdsMaster=value&3;
    if(address===0x4087&&(value&128))this.modCursor=0;
    if(address===0x4088){this.modTable[this.modCursor]=value&7;this.modCursor=(this.modCursor+1)%32;}
  }
  sample(){const r=this.registers,address=0xc000+r[0x12]*64,length=r[0x13]*16+1;return this.memoryRanges.some(range=>range.address<=address&&range.end>=address+length)?{address,length}:null;}
  prepare(callback){
    // The core's construction clock stays in the NES region range; the
    // projected state below supplies the effective outer resampler clock.
    const commands=[],synth=new NesApuSynth({initialize:false,clock:this.chip.clock,fds:this.fdsEnabled,transport:{clock:this.chip.clock,fdsEnabled:this.fdsEnabled,writeRegister:(...args)=>commands.push({method:'writeRegister',args}),setChannelEnabled:(...args)=>commands.push({method:'setChannelEnabled',args})}});
    synth._adoptState({clock:this.clock(),registers:Array.from(this.registers),enabled:this.enabled,fdsActive:!(this.registers[0x83]&128),fdsGain:this.fdsGain,fdsMaster:this.fdsMaster,sample:this.sample()});
    const value=callback(synth);return {commands,state:synth._getState(),value};
  }
  adoptConfigured(state){this.fdsGain=state.fdsGain;this.fdsMaster=state.fdsMaster;}
  stopVoices(){
    this.resetAuditions();
    this.stage(s=>{for(let channel=0;channel<5;channel++)s.keyOff(channel);if(this.fdsEnabled)s.keyOff(5);});
  }
  keyOn(synth,channel,midi){
    if(channel===3)synth.noise.noteOn();else if(channel===4){const r=this.registers;synth.dmc.play({rate:r[0x10]&15,loop:!!(r[0x10]&64),level:r[0x11]&127});}else synth.noteOn(channel,midi);
    if(channel<4){const offset=channel*4+3;synth.writeRegister(0x4000+offset,(synth._getState().registers[offset]&7)|(this.registers[offset]&248));}
  }
  keyOff(synth,channel){synth.keyOff(channel);}
  invoke(method,args=[]){
    if(['auditionOn','auditionOff','auditionAllOff'].includes(method))return this.audition(method,args);
    if(method==='setPulseVoice'){
      const [channel,patch]=args;integer(channel,0,1,'Pulse channel');options(patch,['duty','volume','envelope','sweep','lengthHalt','lengthIndex','frequency']);
      return this.stage(s=>{
        const oldControl=s._getState().registers[channel*4],value={};for(const key of ['duty','volume','envelope','sweep'])if(key in patch)value[key]=patch[key];
        if('sweep'in value){options(value.sweep,['enabled','period','negate','shift']);value.sweep={...this.read().channels[channel].sweep,...value.sweep};}
        if(Object.keys(value).length)s.pulse.setVoice(channel,value);
        if('volume'in patch&&!('envelope'in patch))s.writeRegister(0x4000+channel*4,(s._getState().registers[channel*4]&223)|(oldControl&32));
        if('frequency'in patch)this.frequency(s,channel,patch.frequency);this.lengthPatch(s,channel,patch);
      });
    }
    if(method==='setTriangleVoice')return this.stage(s=>{const [p]=args;options(p,['linearReload','lengthHalt','lengthIndex','frequency']);let r=s._getState().registers[8];if('linearReload'in p)r=(r&128)|integer(p.linearReload,0,127,'Linear reload');if('lengthHalt'in p)r=(r&127)|(boolean(p.lengthHalt,'Length halt')?128:0);s.writeRegister(0x4008,r);if('frequency'in p)this.frequency(s,2,p.frequency);this.lengthPatch(s,2,{...p,lengthHalt:undefined});});
    if(method==='setNoiseVoice')return this.stage(s=>{
      const [p]=args;options(p,['volume','envelope','period','shortMode','lengthHalt','lengthIndex']);const state=s._getState().registers;let control=state[12],period=state[14];
      if('volume'in p)control=(control&224)|0x10|integer(p.volume,0,15,'Noise volume');
      if('envelope'in p){options(p.envelope,['period','loop']);control=(control&192)|(p.envelope.loop?32:0)|integer(p.envelope.period,0,15,'Noise envelope');if(p.envelope.loop!==undefined)boolean(p.envelope.loop,'Envelope loop');}
      if('period'in p)period=(period&128)|integer(p.period,0,15,'Noise period');if('shortMode'in p)period=(period&15)|(boolean(p.shortMode,'Short mode')?128:0);
      s.writeRegister(0x400c,control);s.writeRegister(0x400e,period);this.lengthPatch(s,3,p);
    });
    if(method==='setFdsWave')return this.stage(s=>s.fds.setWave(...args));
    if(method==='setFdsVolume')return this.stage(s=>{if(args[0]&&typeof args[0]==='object'){const [patch]=args;options(patch,['gain','master']);s.fds.setVolume(patch.gain??this.fdsGain,patch.master??this.fdsMaster);}else s.fds.setVolume(...args);});
    if(method==='setFdsModulation')return this.stage(s=>{
      if(!this.fdsEnabled)throw new Error('FDS is not enabled');
      const [patch]=args,current=this.read().fds.modulation;options(patch,['table','rate','depth','bias','enabled']);
      if('table'in patch){s.fds.setModulation({...current,...patch});return;}
      const r=s._getState().registers;let high=r[0x87];
      if('rate'in patch){const rate=integer(patch.rate,0,4095,'FDS modulation rate');s.writeRegister(0x4086,rate&255);high=(high&240)|(rate>>8);}
      if('depth'in patch)s.writeRegister(0x4084,128|integer(patch.depth,0,63,'FDS modulation depth'));
      if('bias'in patch)s.writeRegister(0x4085,integer(patch.bias,-64,63,'FDS modulation bias')&127);
      if('enabled'in patch)high=(high&127)|(boolean(patch.enabled,'FDS modulation enabled')?0:128);
      if('rate'in patch||'enabled'in patch)s.writeRegister(0x4087,high);
    });
    if(method==='setDmcVoice')return this.stage(s=>{const [p]=args;options(p,['rate','loop','level']);const r=s._getState().registers;let control=r[0x10];if('rate'in p)control=(control&240)|integer(p.rate,0,15,'DMC rate');if('loop'in p)control=(control&191)|(boolean(p.loop,'DMC loop')?64:0);if('level'in p)s.writeRegister(0x4011,integer(p.level,0,127,'DMC level'));s.writeRegister(0x4010,control);});
    if(method==='writeRegister')return this.stage(s=>s.writeRegister(...args));
    if(method==='setFrequency')return this.stage(s=>this.frequency(s,...args));
    throw new Error('Unsupported NES inspector operation');
  }
  lengthPatch(s,channel,p){const state=s._getState().registers,base=channel*4;if(p.lengthHalt!==undefined){const enabled=boolean(p.lengthHalt,'Length halt');s.writeRegister(0x4000+base,(state[base]&223)|(enabled?32:0));}if(p.lengthIndex!==undefined)s.writeRegister(0x4003+base,(state[base+3]&7)|(integer(p.lengthIndex,0,31,'Length index')<<3));}
  frequency(s,channel,hz){const index=s._getState().registers[channel*4+3]&248,result=s.setFrequency(channel,hz);if(channel<3)s.writeRegister(0x4003+channel*4,index|(s._getState().registers[channel*4+3]&7));return result;}
  read(){
    const r=this.registers,clock=this.clock(),channels=[];
    for(let channel=0;channel<4;channel++){
      const base=channel*4,control=r[base],period=r[base+2]|((r[base+3]&7)<<8),triangle=channel===2,noise=channel===3;
      const result={channel,type:triangle?'triangle':noise?'noise':'pulse',enabled:!!(this.enabled&(1<<channel)),active:!!(this.enabled&(1<<channel)),control,lengthIndex:r[base+3]>>3,lengthHalt:!!(control&(triangle?128:32)),period:noise?r[14]&15:period};
      if(triangle)Object.assign(result,{linearReload:control&127,frequency:clock/(32*(period+1))});
      else Object.assign(result,{volume:control&15,constantVolume:!!(control&16),envelope:{period:control&15,loop:!!(control&32)},...(noise?{shortMode:!!(r[14]&128)}:{duty:DUTY[control>>6],frequency:clock/(16*(period+1)),sweep:{enabled:!!(r[base+1]&128),period:r[base+1]>>4&7,negate:!!(r[base+1]&8),shift:r[base+1]&7}})});
      channels.push(result);
    }
    const dmc={channel:4,type:'dmc',rate:r[16]&15,loop:!!(r[16]&64),level:r[17]&127,address:0xc000+r[18]*64,length:r[19]*16+1,loaded:!!this.sample(),active:!!(this.enabled&16),enabled:!!(this.enabled&16)};channels.push(dmc);
    let fds=null;
    if(this.fdsEnabled){const period=r[0x82]|((r[0x83]&15)<<8);fds={channel:5,type:'fds',active:!!(r[0x23]&2)&&!(r[0x83]&128),enabled:!!(r[0x23]&2),wave:Array.from(r.slice(0x40,0x80),v=>v&63),gain:this.fdsGain,master:this.fdsMaster,period,frequency:period*clock/4194304,modulation:{table:Array.from(this.modTable),rate:r[0x86]|((r[0x87]&15)<<8),depth:r[0x84]&63,bias:(r[0x85]&64)?(r[0x85]&127)-128:r[0x85]&127,enabled:!(r[0x87]&128)}};channels.push(fds);}
    return {kind:this.kind,clock,sampleRate:this.sampleRate,fdsEnabled:this.fdsEnabled,activeSource:'applied-register-gates',registers:Array.from(r),channels,dmc,fds};
  }
}

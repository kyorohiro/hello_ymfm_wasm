/** Applied register snapshots for the Playground editors. No polling or audio allocation. */
import {createSegaPsgApi} from './segapsg_api.js';
import {CHIP_CLOCKS} from './playground_chip_clock.js';
import {RF5C164Synth} from './rf5c164synth.js';

export class PsgInspectorState {
  /** @param {any} chip @param {import('./playground_native_voice_inspector.js').NativeVoiceInspectorOptions} [options] */
  constructor(chip, {clock = () => CHIP_CLOCKS.segapsg, sampleRate = 44100,dispatch,beginAudition=()=>{},endAudition=()=>{}} = {}) {
    this.clock = typeof clock==='function'?clock:()=>clock; this.sampleRate = sampleRate;
    this.dispatch=dispatch??(command=>chip[command.method](...(command.args??[])));this.beginAudition=beginAudition;this.endAudition=endAudition;this.auditions=new Map();this.reset();
    const write = chip.write.bind(chip), reset = chip.reset.bind(chip);
    chip.write = value => { const result = write(value); this.write(value); return result; };
    chip.reset = () => { const result = reset(); this.reset(); return result; };
  }
  resetAuditions(){for(const [channel,id]of this.auditions)this.endAudition(channel,psgIdentity(id));this.auditions.clear();}
  reset() {this.resetAuditions();this.periods = [0, 0, 0]; this.attenuations = [15, 15, 15, 15]; this.lastVolumes = [0, 0, 0, 0]; this.latched = 0; this.mode = 0;}
  prepare(callback){
    const commands=[],clock=this.clock,api=createSegaPsgApi({get clock(){return clock();},write:value=>commands.push({method:'write',args:[value]}),reset:()=>commands.push({method:'reset'}),resetAll:()=>commands.push({method:'reset'})});
    api._adoptState({attenuations:this.lastVolumes,latched:this.latched});const value=callback(api);return {commands,value};
  }
  commit({commands,value},owner){let latch=this.latched;for(const command of commands){if(command.method==='write'){const byte=command.args[0];if(byte&128)latch=byte>>4&7;else command.psgRegister=latch;}const held=this.auditions.get(latch>>1);this.dispatch(command,owner??(held?psgIdentity(held):undefined),{preserveOwner:!owner});}return value;}
  write(value) {
    value &= 255;
    if (value & 128) this.latched = (value >> 4) & 7;
    const channel = this.latched >> 1;
    if (this.latched & 1) {
      this.attenuations[channel] = value & 15;
      if ((value & 15) !== 15) this.lastVolumes[channel] = value & 15;
    } else if (channel === 3) this.mode = value & 7;
    else if (value & 128) this.periods[channel] = (this.periods[channel] & 1008) | (value & 15);
    else this.periods[channel] = (this.periods[channel] & 15) | ((value & 63) << 4);
  }
  read() {
    const channel = index => ({channel:index, attenuation:this.attenuations[index], volume:(15-this.attenuations[index])/15, active:this.attenuations[index] < 15});
    return {kind:'segapsg', clock:this.clock(), sampleRate:this.sampleRate,
      channels:this.periods.map((period,index) => ({...channel(index),period,frequency:period>1?this.clock()/(32*period):null,constantOutput:period<=1})),
      noise:{...channel(3),type:this.mode & 4 ? 'white' : 'periodic',rate:['low','medium','high','tone3'][this.mode & 3]},auditions:[...this.auditions].map(([channel,id])=>({channel,id}))};
  }
  invoke(method, args = []) {
    if(method==='auditionAllOff'){for(const [channel,id]of [...this.auditions])this.invoke('auditionOff',[channel,id]);return true;}
    if(method==='auditionOff'){const [channel,id]=args;psgVoiceChannel(channel);const owner=psgIdentity(id);if(this.auditions.get(channel)!==id)return false;try{this.commit(this.prepare(api=>api.setAttenuation(channel,15)),owner);}finally{this.auditions.delete(channel);this.endAudition(channel,owner);}return true;}
    if(method==='auditionOn'){const [channel,midi,id]=args;psgVoiceChannel(channel);if(!Number.isInteger(midi)||midi<0||midi>127)throw new RangeError('MIDI note must be 0..127');const owner=psgIdentity(id),prepared=this.prepare(api=>{if(channel<3)api.setFrequency(channel,440*2**((midi-69)/12));api.setAttenuation(channel,this.lastVolumes[channel]??0);});this.auditions.set(channel,id);this.beginAudition(channel,owner);this.commit(prepared,owner);return true;}
    if (!['setFrequency','setNote','keyOn','keyOff','noteOn','setPeriod','setAttenuation','setNoise','write','reset','resetAll','tone','off','noise','noiseVolume','noiseOff'].includes(method)) throw new Error('Unsupported PSG inspector operation');
    return this.commit(this.prepare(api=>{if(method==='keyOn'){psgChannel(args[0]);return api.setAttenuation(args[0],this.lastVolumes[args[0]]??0);}if(method==='noteOn'){api.setNote(...args);return api.setAttenuation(args[0],this.lastVolumes[args[0]]??0);}return api[method](...args);}));
  }
}
function psgChannel(value){if(!Number.isInteger(value)||value<0||value>2)throw new RangeError('PSG tone channel must be 0..2');return value;}
function psgVoiceChannel(value){if(!Number.isInteger(value)||value<0||value>3)throw new RangeError('PSG channel must be 0..3');return value;}
function psgIdentity(value){if(typeof value!=='string'||!value.length||value.length>128)throw new TypeError('Audition identity must contain 1..128 characters');return `voice-editor:${value}`;}

/** A compact waveform is derived from encoded RAM data, so it also matches mono downmix/clamping. */
/** @param {Uint8Array} bytes @param {{name?:string,frames?:number,step?:number,endGuardBytes?:number}} [options] */
export function rfSampleMetadata(bytes, {name = 'Sample', frames, step, endGuardBytes = 0} = {}) {
  if (!Number.isInteger(endGuardBytes) || endGuardBytes < 0 || endGuardBytes > 65536 ||
      !Number.isInteger(frames) || frames < 1 || frames + Math.max(3,endGuardBytes) !== bytes.length || !Number.isInteger(step) || step < 1 || step > 65535) throw new RangeError('Invalid RF5C164 sample metadata');
  const waveform = [], stride = Math.max(1, Math.ceil(frames / 512));
  for (let start=0; start<frames; start+=stride) {
    let peak=0;
    for (let i=start; i<Math.min(frames,start+stride); i++) {const value=(bytes[i]&127)/126*(bytes[i]&128 ? 1 : -1); if(Math.abs(value)>Math.abs(peak))peak=value;}
    waveform.push(peak);
  }
  return {name:String(name).slice(0,256),frames,step,waveform,...(endGuardBytes?{endGuardBytes}:{})};
}

export class RfInspectorState {
  /** @param {any} chip @param {import('./playground_native_voice_inspector.js').NativeVoiceInspectorOptions} [options] */
  constructor(chip, {clock=()=>CHIP_CLOCKS.rf5c164,sampleRate=44100,dispatch,beginAudition=()=>{},endAudition=()=>{}} = {}) {
    this.clock=typeof clock==='function'?clock:()=>clock;this.sampleRate=sampleRate;this.samples=[];this.memoryRanges=[];this.memoryRevision=0;
    const control=dispatch?null:new RF5C164Synth({transport:{write:(...args)=>chip.writeRegister(...args),loadMemory:(...args)=>chip.loadMemory(...args),reset:()=>chip.reset()}});
    this.dispatch=dispatch??(command=>{control.channelMask=this.mask;return control[command.method](...(command.args??[]));});this.beginAudition=beginAudition;this.endAudition=endAudition;this.auditions=new Map();this.auditionWriting=0;this.reset();
    const write=chip.writeRegister.bind(chip), reset=chip.reset.bind(chip), load=chip.loadMemory.bind(chip);
    chip.writeRegister=(register,value)=>{const result=write(register,value);this.write(register,value);return result;};
    chip.reset=()=>{const result=reset();this.reset();return result;};
    chip.loadMemory=(bytes,address=0)=>{const result=load(bytes,address);this.memoryWrite(address,bytes.length);return result;};
  }
  resetAuditions(){for(const [channel,id]of this.auditions)this.endAudition(channel,psgIdentity(id));this.auditions.clear();}
  reset() {this.resetAuditions();this.selected=0;this.enabled=false;this.mask=255;this.configuredSteps=Array(8).fill(0);this.channels=Array.from({length:8},(_,channel)=>({channel,start:0,loopStart:0,step:0,volume:0,pan:{left:0,right:0}}));}
  write(register,value) {
    if(register===7){this.enabled=Boolean(value&128);if(value&64)this.selected=value&7;return;}
    if(register===8){this.mask=value;return;}
    const ch=this.channels[this.selected];
    if(register===0)ch.volume=value;
    if(register===1)ch.pan={left:value&15,right:value>>4&15};
    if(register===2)ch.step=(ch.step&65280)|value;
    if(register===3)ch.step=(ch.step&255)|(value<<8);
    if((register===2||register===3)&&!this.auditionWriting)this.configuredSteps[this.selected]=ch.step;
    if(register===4)ch.loopStart=(ch.loopStart&65280)|value;
    if(register===5)ch.loopStart=(ch.loopStart&255)|(value<<8);
    if(register===6)ch.start=value<<8;
  }
  memoryWrite(address,length) {
    if(!length)return;
    const end=address+length;this.memoryRevision++;
    this.samples=this.samples.filter(sample=>sample.end<=address||sample.address>=end);
    const ranges=[...this.memoryRanges,{address,end}].sort((a,b)=>a.address-b.address);this.memoryRanges=[];
    for(const range of ranges){const last=this.memoryRanges.at(-1);if(last&&range.address<=last.end)last.end=Math.max(last.end,range.end);else this.memoryRanges.push({...range});}
  }
  addSample(address, bytes, metadata) {
    const sample={...rfSampleMetadata(bytes,metadata),address,end:address+bytes.length,loopStart:metadata.loopStart??address+metadata.frames+1,valid:true};
    this.samples.push(sample);return sample;
  }
  allocate(length, requested) {
    let address=requested;
    if(address===undefined){address=0;for(const range of this.memoryRanges){if(address+length<=range.address)break;if(address<range.end)address=Math.ceil(range.end/256)*256;}}
    if(!Number.isInteger(address)||address<0||address%256||address+length>65536)throw new RangeError('Sample requires a free, 256-byte aligned range within 64 KiB RAM');
    if(this.memoryRanges.some(range=>address<range.end&&address+length>range.address))throw new RangeError('Sample would overwrite occupied RF5C164 RAM');
    return address;
  }
  invoke(method,args=[]){
    if(method==='auditionAllOff'){for(const [channel,id]of [...this.auditions])this.invoke('auditionOff',[channel,id]);return true;}
    const [channel,noteOrId,id]=args;
    if(!Number.isInteger(channel)||channel<0||channel>7)throw new RangeError('RF5C164 channel must be 0..7');
    if(method==='auditionOff'){
      const owner=psgIdentity(noteOrId);if(this.auditions.get(channel)!==noteOrId)return false;
      try{this.dispatch({method:'keyOff',args:[channel]},owner);}finally{this.auditions.delete(channel);this.endAudition(channel,owner);}return true;
    }
    if(method!=='auditionOn')throw new Error('Unsupported RF5C164 audition operation');
    if(!Number.isInteger(noteOrId)||noteOrId<0||noteOrId>127)throw new RangeError('MIDI note must be 0..127');
    const owner=psgIdentity(id),voice=this.channels[channel];
    if(!this.memoryRanges.some(range=>range.address<=voice.start&&range.end>voice.start))throw new Error('Load PCM RAM and assign a sample start to this RF5C164 channel before using Keyboard');
    const baseStep=this.configuredSteps[channel];
    if(baseStep<1)throw new Error('Set a playback step for this RF5C164 channel before using Keyboard');
    if(!voice.volume||!voice.pan.left&&!voice.pan.right)throw new Error('Set volume and pan for this RF5C164 channel before using Keyboard');
    const step=Math.round(baseStep*2**((noteOrId-60)/12));
    if(step<1||step>65535)throw new RangeError('Note is outside RF5C164 playback step range');
    this.auditions.set(channel,id);this.beginAudition(channel,owner);
    try{
      this.auditionWriting++;
      this.dispatch({method:'setPitch',args:[channel,step]},owner);this.dispatch({method:'keyOn',args:[channel]},owner);
    }finally{this.auditionWriting--;}
    return true;
  }
  read() {return {kind:'rf5c164',clock:this.clock(),sampleRate:this.sampleRate,enabled:this.enabled,memoryRevision:this.memoryRevision,
    channels:this.channels.map(ch=>({...ch,pan:{...ch.pan},active:this.enabled&&!(this.mask&(1<<ch.channel))})),
    samples:this.samples.map(sample=>({...sample,waveform:sample.waveform.slice()})),memoryRanges:this.memoryRanges.map(range=>({...range})),auditions:[...this.auditions].map(([channel,id])=>({channel,id}))};}
}

/** Separate admin messages from performance/client RPC: reads never consume or reschedule data. */
export function receiveChipInspector(data, port, handler) {
  if(data?.type!=='chip-inspector')return false;
  try {if(!handler)throw new Error('Chip is not ready');const value=handler(data.action,data.method,data.args??[]);port.postMessage({type:'chip-inspector-result',id:data.id,value});}
  catch(error){port.postMessage({type:'chip-inspector-result',id:data.id,error:error.message});}
  return true;
}

export function readPwmInspector(pwm) {
  const registers=Array.from({length:5},(_,register)=>pwm.read(register));
  const fifo=register=>({empty:Boolean(register&16384),full:Boolean(register&32768)});
  return {...pwm.getState(),kind:'pwm',control:registers[0],cycle:registers[1],routing:{left:registers[0]&3,right:(registers[0]>>2)&3},
    fifo:{left:fifo(registers[2]),right:fifo(registers[3])},registers};
}

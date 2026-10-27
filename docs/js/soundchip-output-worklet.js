import {PWM32XPlayback, PWM_METHODS} from './pwm32x_playback.js?v=pokey-mode-1';
import {Ym2612} from './ym2612.js?v=audio-numeric-bindings-1';
import {Ym2608} from './ym2608.js?v=audio-stability-2';
import {Ay8910} from './ay8910.js?v=audio-stability-2';
import ay8910Factory from '../generated/ay8910_wasm.js';
import {Ym2413} from './ym2413.js?v=audio-stability-2';
import ym2413Factory from '../generated/ym2413_wasm.js';
import {Ym3526} from './ym3526.js?v=audio-stability-2';
import {Ym3812} from './ym3812.js?v=audio-stability-2';
import {Y8950} from './y8950.js?v=audio-stability-2';
import {Ymf262} from './ymf262.js?v=audio-stability-2';
import ym3526Factory from '../generated/ym3526_wasm.js';
import ym3812Factory from '../generated/ym3812_wasm.js';
import y8950Factory from '../generated/y8950_wasm.js';
import ymf262Factory from '../generated/ymf262_wasm.js';
import {Ym2151} from './ym2151.js?v=audio-stability-2';
import {GameboyApu} from './gameboyapu.js?v=audio-stability-2';
import {SegaPSG} from './segapsg.js?v=audio-numeric-bindings-1';
import {NesApuWasm} from './nesapu_wasm.js?v=nes-wasm-1';
import {Pokey} from './pokey.js?v=pokey-mode-1';
import {PokeyAudioEngine} from './pokeyaudioengine.js?v=pokey-mode-1';
import pokeyFactory from '../generated/pokey_wasm.js';
import {WonderSwan} from './wonderswan.js?v=wonderswan-pcm-timeline-1';
import {WonderSwanAudioEngine} from './wonderswanaudioengine.js?v=wonderswan-pcm-timeline-1';
import wonderswanFactory from '../generated/wonderswan_wasm.js?v=wonderswan-pcm-timeline-1';
import ym2612Factory from '../generated/ym2612_wasm.js';
import ym2608Factory from '../generated/ym2608_wasm.js';
import ym2151Factory from '../generated/ym2151_wasm.js';
import gameboyFactory from '../generated/gameboy_apu_wasm.js';
import psgFactory from '../generated/segapsg_wasm.js?v=audio-numeric-bindings-1';
import nesFactory from '../generated/nesapu_wasm.js?v=nes-wasm-1';
import pwmFactory from '../generated/pwm32x_wasm.js?v=pwm-wasm-1';
import {createSoundChipFactory} from './soundchip_factory.js';
import {ChipPCMRenderer} from './chip_pcm_renderer.js?v=audio-stability-2';
import {YM2612DirectTransport} from './ym2612synth.js?v=audio-stability-2';
import {YM2612DacPlayer} from './ym2612_dac.js';
import {createProcessorPerformance,performanceNoteRelease} from './playground_performance_processor.js?v=pokey-mode-1';

const profiles = {ym2612: [Ym2612, ym2612Factory], ym2608: [Ym2608, ym2608Factory],
  ay8910:[Ay8910,ay8910Factory],ym2413:[Ym2413,ym2413Factory],ym3526:[Ym3526,ym3526Factory],ym3812:[Ym3812,ym3812Factory],y8950:[Y8950,y8950Factory],ymf262:[Ymf262,ymf262Factory],
  ym2151: [Ym2151, ym2151Factory], gameboy: [GameboyApu, gameboyFactory], segapsg: [SegaPSG, psgFactory], nes: [NesApuWasm, nesFactory], wonderswan:[WonderSwan,wonderswanFactory], pokey:[Pokey,pokeyFactory]};
const createSoundChip = createSoundChipFactory(Object.fromEntries([...Object.entries(profiles).map(([name, [Type, moduleFactory]]) =>
  [name, options => Type.create({...options, moduleFactory})]), ['pwm', options => PWM32XPlayback.create({...options,moduleFactory:pwmFactory})]]));

class SoundChipProcessor extends AudioWorkletProcessor {
  constructor({processorOptions: {name, chipOptions, wasmBinary}}) {
    super(); this.dead = false; this.running = false; this.name = name; this.queuedSpeaker=['wonderswan','pokey'].includes(name); this.remotePorts = new Set();
    this.ayRegisters=name==='ay8910'?new Uint8Array(16):null;
    this.opllRegisters=name==='ym2413'?new Uint8Array(64):null;
    this.scheduled = []; this.scheduledIndex=0; this.banks = new Map();this.oplRegisters=['ym3526','ym3812','y8950','ymf262'].includes(name)?new Uint8Array(name==='ymf262'?512:256):null;
    this.performance=createProcessorPerformance({chip:()=>this.name,getAyRegisters:()=>this.ayRegisters,getOpllRhythm:()=>this.opllRegisters?.[0x0e]??0,
      getWonderSwanRegisters:()=>this.speaker?.registers,getPokeyRegisters:()=>this.pokeySpeaker?.registers,
      releaseNote:key=>['ym2612','ym2608'].includes(this.name)?{type:'write',port:0,register:0x28,value:[0,1,2,4,5,6][key]}:
        performanceNoteRelease(this.name,key),apply:(data,port,frame,metadata)=>this.apply(data,port,frame,metadata),prepare:(data,port,metadata)=>{
      const method=data.method??data.type;
      if(['loadMemory','loadRhythmRom','loadAdpcmMemory','load-dac-bank','schedule-writes','play-dac-bank','read','readRegister','readMemory','getState'].includes(method)||(this.queuedSpeaker&&method==='setChannelMuted')){this.apply(data,port,undefined,metadata);return null;}
      if(method==='pcm-dac'&&(['load','remove'].includes(data.command?.action)||data.command?.when!==undefined)){this.apply(data,port);return null;}
      if(data.id===undefined||method==='barrier')return data;
      const {id,...command}=data;port.postMessage({type:method==='pcm-dac'?'pcm-dac-result':'response',id});return command;
    }});
    this.renderSegment=this.renderSegment.bind(this);
    this.port.onmessage = ({data}) => this.receive(data);
    createSoundChip(name, {...chipOptions, ...(name === 'gameboy' || name === 'segapsg' || name === 'pwm' || name === 'nes' || name==='ay8910' || name==='wonderswan' || name==='pokey' ? {sampleRate} : {}), moduleOptions: {wasmBinary}})
      .then(chip => {
        if (this.dead) {chip.dispose(); return;}
        this.chip = chip;
        this.speaker=name==='wonderswan'?new WonderSwanAudioEngine(chip,1):null;
        this.pokeySpeaker=name==='pokey'?new PokeyAudioEngine(chip,1):null;
        this.outputEngine=this.speaker??this.pokeySpeaker;
        if(this.ayRegisters)this.updateAyMute();
        this.direct = name === 'ym2612' ? new YM2612DirectTransport(chip) : null;
        if (this.direct) this.pcmDac = new YM2612DacPlayer(sampleRate, (port, register, value) => chip.writeRegister(register, value, port));
        this.renderer = new ChipPCMRenderer(chip, {sampleRate, gain: 1, removeIdleOffset: name === 'ym2612',
          generate: this.outputEngine?.generateStereoView.bind(this.outputEngine)??this.direct?.generateStereoView.bind(this.direct)});
        if (['ym3526','ym3812','y8950','ymf262','ym2413'].includes(name) && chipOptions.clock !== undefined) this.renderer.rate=chip.sampleRate(chipOptions.clock);
        chip.reserveStereoFrames?.(Math.ceil(128 * chip.sampleRate() / sampleRate));
        chip.reserveFrames?.(128);
        this.port.postMessage({type: 'ready', sampleRate: this.renderer.rate,...(['nes','pwm'].includes(name)?{backend:chip.backend}:{})});
      }).catch(error => {this.dead = true; this.chip?.dispose(); this.port.postMessage({error: error.message});});
  }
  receive(data, replyPort = this.port) {
    if(Array.isArray(data)){
      if(data.length<=4096)for(const command of data)this.receive(command,replyPort);
      return;
    }
    const control=this.queuedSpeaker&&['performance-start','performance-stop','performance-cancel-owner'].includes(data?.type);
    const prior=control?this.performance.getStats():null;
    if(this.performance.receive(data,replyPort)){
      if(control&&data.type==='performance-cancel-owner'&&data.session===prior.activeSession){
        this.scheduled=this.scheduled.slice(this.scheduledIndex).filter(entry=>entry.metadata?.owner!==data.owner);this.scheduledIndex=0;
      }else if(control&&Number.isSafeInteger(data.session)&&data.session>0&&
          ((data.type==='performance-start'&&data.session>prior.latestSession&&this.performance.getStats().activeSession===data.session)||
          (data.type==='performance-stop'&&data.session>=prior.latestSession))){this.scheduled=[];this.scheduledIndex=0;}
      return;
    }
    this.apply(data,replyPort);
  }
  updateAyMute(){let mask=0;for(let channel=0;channel<3;channel++)if(!(this.ayRegisters[8+channel]&31))mask|=1<<channel;this.chip?.setMuteMask(mask);}
  apply(data, replyPort = this.port, appliedFrame = currentFrame, metadata) {
    try {
      if (data.method === 'dispose') {this.performance.clear();this.dead = true; this.outputEngine?this.outputEngine.dispose():this.chip?.dispose(); this.chip = null;
        this.renderer = this.outputEngine = this.pokeySpeaker = this.speaker = this.direct = this.pcmDac = this.opllRegisters = this.oplRegisters = this.ayRegisters = null; this.scheduled = [];this.scheduledIndex=0; this.banks.clear();
        if(this.queuedSpeaker)replyPort.postMessage({type:'disposed',error:'Worklet chip is disposed'});
        for (const port of this.remotePorts) {if(this.queuedSpeaker&&port!==replyPort)port.postMessage({type:'disposed',error:'Worklet chip is disposed'});port.close();} this.remotePorts.clear(); return;}
      if (data.method === 'attachPort') {
        if (this.dead) {data.port.close(); return;}
        this.remotePorts.add(data.port);
        if (this.chip?.getIrq) data.port.postMessage({type: 'irq', asserted: this.chip.getIrq()});
        data.port.onmessage = ({data: command}) => this.receive(command, data.port); data.port.start(); return;
      }
      if (!this.chip) throw new Error('Chip not ready');
      const args = data.args ?? [];
      const method = data.method ?? data.type;
      let value;
      if (method === 'start') this.running = true;
      else if (method === 'stop') {this.running = false;if(this.queuedSpeaker){this.scheduled=[];this.scheduledIndex=0;}}
      else if (this.name === 'pwm' && PWM_METHODS.has(method)) value = this.chip[method](...args);
      else if (method === 'reset') {this.pcmDac?.reset(); this.outputEngine?this.outputEngine.reset():this.direct ? this.direct.reset() : this.chip.reset(); if(this.queuedSpeaker){this.scheduled=[];this.scheduledIndex=0;}this.renderer.resetHistory();this.oplRegisters?.fill(0);this.opllRegisters?.fill(0);this.ayRegisters?.fill(0);if(this.ayRegisters)this.updateAyMute();}
      else if(this.pokeySpeaker&&(method==='keyOff'||method==='forceKeyOff')){
        const channel=args[0];if(!Number.isInteger(channel)||channel<0||channel>3)throw new RangeError('Invalid POKEY channel');
        const register=channel*2+1;this.pokeySpeaker.writeRegister(register,this.pokeySpeaker.registers[register]&240);
      }
      else if(this.pokeySpeaker&&method==='allNotesOff'){for(let ch=0;ch<4;ch++){const reg=ch*2+1;this.pokeySpeaker.writeRegister(reg,this.pokeySpeaker.registers[reg]&240);}}
      else if(this.speaker&&method==='keyOff'){
        const channel=args[0];if(!Number.isInteger(channel)||channel<0||channel>3)throw new RangeError('Invalid WonderSwan channel');
        this.speaker.writeWonderSwan(16,this.speaker.registers[16]&~(1<<channel));
      }
      else if(this.speaker&&method==='allNotesOff')this.speaker.writeWonderSwan(16,this.speaker.registers[16]&0xf0);
      else if(method==='forceKeyOff'&&this.ayRegisters){this.ayRegisters[8+args[0]]=0;this.chip.writeRegister(8+args[0],0);this.updateAyMute();}
      else if(method==='forceKeyOff'&&this.opllRegisters){const register=0x20+args[0],value=this.opllRegisters[register]&239;this.opllRegisters[register]=value;this.chip.write(0,register);this.chip.write(1,value);}
      else if(method==='forceRhythmOff'&&this.opllRegisters){const value=this.opllRegisters[0x0e]&~(16>>args[0]);this.opllRegisters[0x0e]=value;this.chip.write(0,0x0e);this.chip.write(1,value);}
      else if (method === 'forceKeyOff' && this.oplRegisters) {
        const channel=args[0],bank=channel>=9?1:0,register=0xb0+channel%9,index=(bank<<8)+register;
        const byte=this.oplRegisters[index]&223;this.oplRegisters[index]=byte;this.chip.write(bank*2,register);this.chip.write(bank*2+1,byte);
      } else if(method==='forceRhythmOff'&&this.oplRegisters){
        const byte=this.oplRegisters[0xbd]&~(16>>args[0]);this.oplRegisters[0xbd]=byte;this.chip.write(0,0xbd);this.chip.write(1,byte);
      } else if (method === 'write') {
        if (data.type) {
          if(this.oplRegisters)this.oplRegisters[(data.port<<8)|data.register]=data.value;
          if(this.opllRegisters)this.opllRegisters[data.register]=data.value;
          if (this.direct) {this.pcmDac.observeWrite(data.port, data.register, data.value); this.direct.write(data.port, data.register, data.value);}
          else {this.chip.write(data.port * 2, data.register); this.chip.write(data.port * 2 + 1, data.value);}
        }
        else this.chip.write(...args);
      } else if (method === 'writeRegister') {
        if(this.oplRegisters)this.oplRegisters[args[0]|((args[2]??0)<<8)]=args[1];
        if(this.opllRegisters)this.opllRegisters[args[0]]=args[1];
        if(this.ayRegisters)this.ayRegisters[args[0]]=args[1];
        if(this.speaker){
          const [address,byte]=args;
          if(!Number.isInteger(address)||address<0x80||address>0x9f)throw new RangeError('Invalid WonderSwan register address');
          if(!Number.isInteger(byte)||byte<0||byte>255)throw new RangeError('Invalid WonderSwan register byte');
          let value=byte;
          if(address===0x90&&data.controlMask!==undefined){
            if(!Number.isInteger(data.controlMask)||data.controlMask<0||data.controlMask>255)throw new RangeError('Invalid WonderSwan control mask');
            value=(byte&data.controlMask)|(this.speaker.registers[16]&~data.controlMask);
          }
          this.speaker.writeWonderSwan(address-0x80,value);
        }
        else if(this.pokeySpeaker)this.pokeySpeaker.writeRegister(...args);
        else if (typeof this.chip.writeRegister === 'function') this.chip.writeRegister(...args);
        else {const [register, value, port = 0] = args; this.chip.write(port * 2, register); this.chip.write(port * 2 + 1, value);}
        if(this.ayRegisters&&args[0]>=8&&args[0]<=10)this.updateAyMute();
      }
      else if(this.pokeySpeaker&&method==='getState')value=this.pokeySpeaker.getState();
      else if(this.pokeySpeaker&&method==='readRegister')value=this.chip.readRegister(...args);
      else if(this.pokeySpeaker&&method==='setChannelMuted')this.pokeySpeaker.setChannelMuted(...args);
      else if(this.speaker&&method==='writeMemory')this.speaker.writeWonderSwanMemory(...args);
      else if(this.speaker&&method==='loadMemory')this.speaker.loadWonderSwanMemory(...args);
      else if(this.speaker&&method==='readRegister')value=this.chip.readRegister(...args);
      else if(this.speaker&&method==='readMemory')value=this.chip.readMemory(...args);
      else if(this.speaker&&method==='setChannelMuted'){
        if(typeof args[1]!=='boolean')throw new TypeError('Expected boolean WonderSwan mute');
        this.speaker.setChannelMuted(...args);
      }
      else if (this.name === 'nes' && method === 'loadMemory') value = this.chip.loadMemory(...args);
      else if (this.name === 'nes' && method === 'setChannelEnabled') value = this.chip.setChannelEnabled(...args);
      else if (this.name === 'nes' && method === 'setChannelMuted') value = this.chip.setChannelMuted(...args);
      else if (this.name === 'nes' && method === 'getState') value = this.chip.getState();
      else if (method === 'loadRhythmRom') this.chip.loadAdpcmARom(data.bytes);
      else if (method === 'loadAdpcmMemory') this.chip.loadAdpcmBMemory(data.bytes, data.address);
      else if (method === 'pcm-dac') this.pcmDac.command(data.command, appliedFrame);
      else if (method === 'clear-dac-playback') {this.pcmDac?.stop(); this.scheduled = this.scheduled.filter(entry => !entry.bank);}
      else if (method === 'schedule-writes') {
        const entries=data.entries??args[0]??[];
        if(this.queuedSpeaker){
          const minimum=this.name==='pokey'?0:0x80,maximum=this.name==='pokey'?15:0x9f;
          if(!Array.isArray(entries)||entries.length>65536||entries.length+this.scheduled.length-this.scheduledIndex>65536)throw new RangeError('Speaker scheduled write capacity exceeded');
          for(const entry of entries){
            if(!entry||!Number.isFinite(entry.time)||entry.time<0||!Number.isSafeInteger(Math.round(entry.time*sampleRate)))throw new RangeError('Invalid scheduled write time');
            if((entry.port??0)!==0||!Number.isInteger(entry.register)||entry.register<minimum||entry.register>maximum||!Number.isInteger(entry.value)||entry.value<0||entry.value>255)throw new RangeError('Invalid speaker scheduled register write');
          }
          this.scheduled=this.scheduled.slice(this.scheduledIndex);this.scheduledIndex=0;
          for(const entry of entries)this.scheduled.push({...entry,frame:Math.round(entry.time*sampleRate),command:{method:'writeRegister',args:[entry.register,entry.value]},metadata,replyPort});
          this.scheduled.sort((a,b)=>a.frame-b.frame);value=entries.length;
        }else for (const entry of entries) {
          if (!Number.isFinite(entry.time) || entry.time < 0) throw new Error('Invalid scheduled write time');
          this.scheduled.push({...entry, frame: Math.round(entry.time * sampleRate)});
        }
        this.scheduled.sort((a, b) => a.frame - b.frame);
      } else if (method === 'clear-scheduled-writes') {this.scheduled = this.scheduled.slice(this.scheduledIndex).filter(entry => entry.bank);this.scheduledIndex=0;}
      else if (method === 'load-dac-bank') this.banks.set(data.name, new Uint8Array(data.data));
      else if (method === 'play-dac-bank') {
        if (!Number.isFinite(data.time) || data.time < 0) throw new Error('Invalid DAC bank time');
        const bytes = this.banks.get(data.name);
        if (!bytes) throw new Error(`Unknown DAC bank: ${data.name}`);
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        for (let offset = 0; offset + 5 <= bytes.length; offset += 5) this.scheduled.push({bank: true,
          frame: Math.round((data.time + view.getUint32(offset, true) / 44100) * sampleRate), port: 0, register: 0x2a, value: bytes[offset + 4]});
        this.scheduled.sort((a, b) => a.frame - b.frame);
      }
      else if (method === 'barrier') {}
      else throw new Error(`Unsupported chip command: ${method}`);
      if (data.id !== undefined) {
        const type = method === 'loadAdpcmMemory' ? 'adpcm-memory-loaded' : method === 'pcm-dac' ? 'pcm-dac-result' : 'response';
        replyPort.postMessage({type, id: data.id, value});
      }
    } catch (error) {
      const type = data.type === 'loadAdpcmMemory' ? 'adpcm-memory-loaded' : data.type === 'pcm-dac' ? 'pcm-dac-result' : 'response';
      replyPort.postMessage({type, id: data.id, error: error.message});
    }
  }
  process(_inputs, outputs) {
    const [left, right] = outputs[0]; left.fill(0); right.fill(0);
    if (this.dead) return false;
    this.performance.render(left,right,this.renderSegment);
    if (this.chip?.getIrq && this.irq !== this.chip.getIrq()) {
      this.irq = this.chip.getIrq(); const message = {type: 'irq', asserted: this.irq};
      this.port.postMessage(message); for (const port of this.remotePorts) port.postMessage(message);
    }
    return true;
  }
  renderSegment(left,right,startFrame) {
    if (this.running && this.renderer) {
      let offset = 0;
      while (offset < left.length) {
        const frame = startFrame + offset;
        while (this.scheduled[this.queuedSpeaker?this.scheduledIndex:0]?.frame <= frame) {
          const entry = this.queuedSpeaker?this.scheduled[this.scheduledIndex++]:this.scheduled.shift();
          if(this.queuedSpeaker)this.performance.applyImmediate(entry.command,entry.replyPort,entry.metadata);
          else {this.pcmDac?.observeWrite(entry.port, entry.register, entry.value);this.chip.writeRegister(entry.register, entry.value, entry.port);}
        }
        this.pcmDac?.advance(frame);
        const next = Math.min(startFrame + left.length, this.scheduled[this.queuedSpeaker?this.scheduledIndex:0]?.frame ?? Infinity, this.pcmDac?.nextFrame() ?? Infinity);
        const count = Math.max(1, next - frame);
        this.renderer.renderInto(left, right, offset, count); offset += count;
      }
      if(this.queuedSpeaker&&this.scheduledIndex===this.scheduled.length){this.scheduled.length=0;this.scheduledIndex=0;}
    }
  }
}
registerProcessor('tetorica-soundchip', SoundChipProcessor);

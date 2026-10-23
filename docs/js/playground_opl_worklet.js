import {validateChipClock} from './playground_chip_clock.js?v=audio-numeric-bindings-1';
import {Ym3526} from './ym3526.js?v=audio-stability-2';
import {Ym3812} from './ym3812.js?v=audio-stability-2';
import {Y8950} from './y8950.js?v=audio-stability-2';
import {Ymf262} from './ymf262.js?v=audio-stability-2';
import ym3526Factory from '../generated/ym3526_wasm.js';
import ym3812Factory from '../generated/ym3812_wasm.js';
import y8950Factory from '../generated/y8950_wasm.js';
import ymf262Factory from '../generated/ymf262_wasm.js';
import {createProcessorPerformance} from './playground_performance_processor.js?v=audio-numeric-bindings-1';
import {OplVoiceInspector} from './playground_opl_inspector.js?v=native-extra-nes-1';
import {receiveChipInspector} from './playground_chip_inspector_state.js?v=audio-numeric-bindings-1';
const PROFILES={ym3526:[Ym3526,ym3526Factory],ym3812:[Ym3812,ym3812Factory],y8950:[Y8950,y8950Factory],ymf262:[Ymf262,ymf262Factory]};
const SLOTS=[0,1,2,8,9,10,16,17,18], PAIRS=[0,1,2,9,10,11];
class Processor extends AudioWorkletProcessor {
  constructor({processorOptions:{chip='ym3812',clock=chip==='ymf262'?14318180:3579545,wasmBinary}}) {
    super();this.kind=chip;this.clock=clock;this.chip=null;this.dead=false;this.remainder=0;this.left=this.right=0;this.counts=new Uint32Array(128);
    this.channels=chip==='ymf262'?18:9;this.registers=new Uint8Array(chip==='ymf262'?512:256);this.mutedChannels=new Set(Array.from({length:this.channels},(_,index)=>index));this.auditionStarts=new Map();this.silent=true;
    this.performance=createProcessorPerformance({chip,immediate:['stopVoices'],apply:(data,port,frame,metadata)=>this.apply(data,port,frame,metadata)});
    this.renderSegment=this.renderSegment.bind(this);
    this.port.onmessage=({data})=>{
      if(data.primaryWorker){this.workerRemote?.close();this.workerRemote=null;if(data.port){if(this.dead){data.port.close();return;}const remote=this.workerRemote=data.port;remote.onmessage=event=>{if(this.workerRemote===remote)this.receive(event.data,remote);};remote.start();}return;}
      if(data.type==='detach-chip-port'){this.remote?.close();this.remote=null;this.inspector?.invoke('auditionAllOff');this.performance.clear();this.stopVoices();return;}
      if(data.port){this.remote?.close();if(this.dead){data.port.close();return;}const remote=this.remote=data.port;remote.onmessage=event=>{if(this.remote===remote)this.receive(event.data,remote);};remote.start();}
      else this.receive(data,this.port);
    };
    const [Type,factory]=PROFILES[chip]??[];
    if(!Type){this.dead=true;this.port.postMessage({error:`Unsupported OPL chip: ${chip}`});return;}
    Type.create({moduleFactory:factory,moduleOptions:{wasmBinary}}).then(core=>{
      if(this.dead){core.dispose();return;}this.chip=core;this.rate=core.sampleRate(clock);this.updateMuteMask();
      this.inspector=new OplVoiceInspector({chip,clock:()=>this.clock,sampleRate,
        dispatch:(command,owner,metadata)=>this.performance.applyImmediate(command,this.port,{owner,...metadata}),
        beginAudition:(channel,owner)=>this.performance.beginAudition(channel,owner),endAudition:(channel,owner)=>this.performance.endAudition(channel,owner)});
      this.port.postMessage({ready:true});
    }).catch(error=>{this.dispose();this.port.postMessage({error:error.message});});
  }
  dispose(){this.inspector?.resetAuditions();this.performance.clear();this.auditionStarts.clear();this.dead=true;this.chip?.dispose();this.chip=null;this.remote?.close();this.workerRemote?.close();}
  publishState(){this.port.postMessage({type:'opl-state',state:{chip:this.kind,clock:this.clock,initialized:true,registers:Array.from(this.registers)}});}
  receive(data,port=this.port){
    if(Array.isArray(data)){for(const command of data)this.receive(command,port);return;}
    if(data?.type==='chip-inspector'){
      receiveChipInspector(data,port,this.inspector?(action,method,args)=>{const value=action==='read'?this.inspector.read():this.inspector.invoke(method,args);if(action!=='read')this.publishState();return value;}:null);return;
    }
    const stopping=data?.type==='performance-stop'&&Number.isSafeInteger(data.session)&&data.session>0&&data.session>=this.performance.getStats().latestSession;
    if(stopping||data?.method==='stopVoices')this.inspector?.invoke('auditionAllOff');
    if(this.performance.receive(data,port)){if(stopping){this.stopVoices();this.performance.clear();}return;}
    this.apply(data,port);
  }
  physicalPair(channel){const index=PAIRS.indexOf(channel);return index>=0&&(this.registers[0x104]&(1<<index))?[channel,channel+3]:[channel];}
  writeRaw(register,value,bank=0){this.chip.write(bank*2,register);this.chip.write(bank*2+1,value);}
  operatorChannel(register,bank){const offset=register&31;for(let ch=0;ch<9;ch++)if(offset===SLOTS[ch]||offset===SLOTS[ch]+3)return bank*9+ch;return -1;}
  updateMuteMask(){let mask=0;for(const channel of this.mutedChannels)mask|=1<<channel;this.chip?.setMuteMask(mask);}
  restore(channel){for(const ch of this.physicalPair(channel))if(this.mutedChannels.delete(ch)){const bank=ch>=9?1:0;for(const slot of [SLOTS[ch%9],SLOTS[ch%9]+3])this.writeRaw(0x40+slot,this.registers[(bank<<8)+0x40+slot],bank);}this.updateMuteMask();}
  forceKeyOff(channel){
    if(!Number.isInteger(channel)||channel<0||channel>=this.channels)throw new RangeError('Invalid OPL channel');
    this.auditionStarts.delete(channel);
    for(const ch of this.physicalPair(channel)){
      const bank=ch>=9?1:0,register=0xb0+ch%9,index=(bank<<8)+register,value=this.registers[index]&223;
      this.registers[index]=value;this.inspector?.observeWrite(register,value,bank);this.writeRaw(register,value,bank);
      this.mutedChannels.add(ch);for(const slot of [SLOTS[ch%9],SLOTS[ch%9]+3])this.writeRaw(0x40+slot,(this.registers[(bank<<8)+0x40+slot]&192)|63,bank);
    }this.updateMuteMask();
  }
  stopVoices(){if(!this.chip)return;for(let ch=0;ch<this.channels;ch++)this.forceKeyOff(ch);this.writeRegister(0xbd,this.registers[0xbd]&224,0);this.silent=true;}
  writeRegister(register,value,bank=0){
    if(register>255){bank=register>>8;register&=255;}
    const index=(bank<<8)+register;this.registers[index]=value;this.inspector?.observeWrite(register,value,bank);
    if(register>=0xb0&&register<=0xb8&&(value&32)){this.restore(bank*9+register-0xb0);this.silent=false;}
    if(register===0xbd&&(value&31)){
      for(let ch=6;ch<=8;ch++)this.restore(ch);this.silent=false;
    }
    const channel=register>=0x40&&register<=0x55?this.operatorChannel(register,bank):-1;
    this.writeRaw(register,channel>=0&&this.mutedChannels.has(channel)?(value&192)|63:value,bank);
  }
  apply(data,port,frame,metadata){
    try{
      if(data.method==='dispose'){this.dispose();return;}
      if(!this.chip)throw new Error('OPL not ready');
      if(data.method==='clock'||data.type==='chip-clock'){
        if(this.inspector?.auditions.size)throw new Error('OPL is held by a manual audition');
        this.clock=validateChipClock(data.clock??data.args[0]);this.rate=this.chip.sampleRate(this.clock);
      }else if(data.method==='stopVoices'){this.inspector?.invoke('auditionAllOff');this.performance.clear();this.stopVoices();}
      else if(data.method==='reset'){this.chip.reset();this.auditionStarts.clear();this.inspector?.reset();this.registers.fill(0);this.mutedChannels=new Set(Array.from({length:this.channels},(_,index)=>index));this.updateMuteMask();this.silent=true;this.remainder=0;this.left=this.right=0;}
      else if(data.method==='writeRegister')this.writeRegister(...data.args);
      else if(data.method==='forceRhythmOff')this.writeRegister(0xbd,this.registers[0xbd]&~(16>>data.args[0]),0);
      else if(data.method==='forceKeyOff')this.forceKeyOff(data.args[0]);
      else if(data.method==='auditionKeyOn')this.auditionStarts.set(data.args[0],metadata?.owner);
      else if(data.method==='allNotesOff')this.stopVoices();
      else if(data.type==='clear-scheduled-writes')this.performance.clear();
      else throw new Error(`Unsupported OPL command: ${data.method??data.type}`);
      if(data.id!==undefined)port.postMessage({type:data.type==='chip-clock'?'chip-clock-result':undefined,id:data.id,value:true});
    }catch(error){if(data.id!==undefined)port.postMessage({type:data.type==='chip-clock'?'chip-clock-result':undefined,id:data.id,error:error.message});}
  }
  process(inputs,outputs){if(this.dead)return false;const [left,right]=outputs[0];this.performance.render(left,right,this.renderSegment);return true;}
  renderSegment(left,right){
    if(this.chip&&this.auditionStarts.size){
      const count=Math.min(left.length,Math.max(1,Math.ceil((sampleRate-this.remainder)/this.rate)));
      if(this.renderFrames(left,right,0,count)){
        for(const [ch,owner]of this.auditionStarts)if(this.inspector.auditions.has(ch)){
          const bank=ch>=9?1:0,reg=0xb0+ch%9;this.performance.applyImmediate({method:'writeRegister',args:[reg,this.registers[(bank<<8)+reg]|32,bank]},this.port,{owner});
        }
        this.auditionStarts.clear();
      }
      if(count<left.length)this.renderFrames(left,right,count,left.length-count);return;
    }
    this.renderFrames(left,right,0,left.length);
  }
  renderFrames(left,right,start,length){
    if(!this.chip){left.fill(0,start,start+length);right.fill(0,start,start+length);return 0;}
    if(this.counts.length<length)this.counts=new Uint32Array(length);let frames=0;
    for(let i=0;i<length;i++){this.remainder+=this.rate;const count=Math.floor(this.remainder/sampleRate);this.remainder-=count*sampleRate;this.counts[i]=count;frames+=count;}
    const pcm=frames?this.chip.generateStereo(frames):null;let offset=0;
    for(let i=0;i<length;i++){const count=this.counts[i];if(count){let l=0,r=0;for(let j=0;j<count;j++,offset++){l+=pcm.left[offset];r+=pcm.right[offset];}this.left=l/count;this.right=r/count;}left[start+i]=this.silent?0:this.left;right[start+i]=this.silent?0:this.right;}
    return frames;
  }
}
registerProcessor('tetorica-opl',Processor);

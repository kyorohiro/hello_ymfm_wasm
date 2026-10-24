import {validateChipClock} from './playground_chip_clock.js?v=audio-numeric-bindings-1';
import {Ym2413} from './ym2413.js?v=audio-stability-2';
import factory from '../generated/ym2413_wasm.js';
import {createProcessorPerformance} from './playground_performance_processor.js?v=y8950-adpcm-ui-1';
import {Ym2413VoiceInspector} from './playground_ym2413_inspector.js?v=y8950-adpcm-ui-1';
import {receiveChipInspector} from './playground_chip_inspector_state.js?v=audio-numeric-bindings-1';
const PHYSICAL=[6,7,8,8,7],VOLUME=[[0x36,0],[0x37,0],[0x38,4],[0x38,0],[0x37,4]];
class Processor extends AudioWorkletProcessor{
  constructor({processorOptions:{clock=3579545,wasmBinary}}){
    super();this.clock=clock;this.chip=null;this.dead=false;this.remainder=0;this.left=this.right=0;this.counts=new Uint32Array(128);this.registers=new Uint8Array(64);this.mutedChannels=new Set(Array.from({length:9},(_,index)=>index));this.mutedDrums=new Set([0,1,2,3,4]);this.auditionStarts=new Map();this.silent=true;
    this.performance=createProcessorPerformance({chip:'ym2413',getOpllRhythm:()=>this.registers[0x0e],immediate:['stopVoices'],apply:(data,port,frame,metadata)=>this.apply(data,port,frame,metadata)});
    this.renderSegment=this.renderSegment.bind(this);
    this.port.onmessage=({data})=>{
      if(data.primaryWorker){this.workerRemote?.close();this.workerRemote=null;if(data.port){if(this.dead){data.port.close();return;}const remote=this.workerRemote=data.port;remote.onmessage=event=>{if(this.workerRemote===remote)this.receive(event.data,remote);};remote.start();}return;}
      if(data.type==='detach-chip-port'){this.remote?.close();this.remote=null;this.inspector?.invoke('auditionAllOff');this.performance.clear();this.stopVoices();return;}
      if(data.port){this.remote?.close();if(this.dead){data.port.close();return;}const remote=this.remote=data.port;remote.onmessage=event=>{if(this.remote===remote)this.receive(event.data,remote);};remote.start();}
      else this.receive(data,this.port);
    };
    Ym2413.create({moduleFactory:factory,moduleOptions:{wasmBinary}}).then(chip=>{
      if(this.dead){chip.dispose();return;}this.chip=chip;this.rate=chip.sampleRate(clock);this.updateMuteMask();
      this.inspector=new Ym2413VoiceInspector({clock:()=>this.clock,sampleRate,
        dispatch:(command,owner,metadata)=>this.performance.applyImmediate(command,this.port,{owner,...metadata}),
        beginAudition:(channel,owner)=>this.performance.beginAudition(channel,owner),endAudition:(channel,owner)=>this.performance.endAudition(channel,owner)});
      this.port.postMessage({ready:true});
    }).catch(error=>{this.dispose();this.port.postMessage({error:error.message});});
  }
  dispose(){this.inspector?.resetAuditions();this.performance.clear();this.auditionStarts.clear();this.dead=true;this.chip?.dispose();this.chip=null;this.remote?.close();this.workerRemote?.close();}
  publishLayout(){this.port.postMessage({type:'chip-layout',kind:'ym2413',rhythmEnabled:!!(this.registers[0x0e]&32)});}
  publishState(){this.port.postMessage({type:'opll-state',state:{clock:this.clock,initialized:true,registers:Array.from(this.registers)}});}
  receive(data,port=this.port){
    if(Array.isArray(data)){for(const command of data)this.receive(command,port);return;}
    if(data?.type==='chip-inspector'){receiveChipInspector(data,port,this.inspector?(action,method,args)=>{const value=action==='read'?this.inspector.read():this.inspector.invoke(method,args);if(action!=='read')this.publishState();return value;}:null);return;}
    if((data?.method==='clock'||data?.type==='chip-clock')&&this.inspector?.auditions.size){if(data.id!==undefined)port.postMessage({type:data.type==='chip-clock'?'chip-clock-result':undefined,id:data.id,error:'YM2413 is held by a manual audition'});return;}
    const stopping=data?.type==='performance-stop'&&Number.isSafeInteger(data.session)&&data.session>0&&data.session>=this.performance.getStats().latestSession;
    if(stopping||data?.method==='stopVoices')this.inspector?.invoke('auditionAllOff');
    if(this.performance.receive(data,port)){if(stopping){this.stopVoices();this.performance.clear();}return;}
    this.apply(data,port);
  }
  writeRaw(register,value){this.chip.write(0,register);this.chip.write(1,value);}
  updateMuteMask(){let mask=0;for(const channel of this.mutedChannels)mask|=1<<channel;this.chip?.setMuteMask(mask);}
  writeVolume(register){
    let value=this.registers[register];
    if(this.registers[0x0e]&32)for(const index of this.mutedDrums){const [target,shift]=VOLUME[index];if(target===register)value=(value&~(15<<shift))|(15<<shift);}
    this.writeRaw(register,value);
  }
  restoreChannel(channel){if(this.mutedChannels.delete(channel))this.updateMuteMask();this.writeVolume(0x30+channel);this.silent=false;}
  forceKeyOff(channel){
    if(!Number.isInteger(channel)||channel<0||channel>8)throw new RangeError('YM2413 channel must be 0..8');
    this.auditionStarts.delete(channel);const register=0x20+channel,value=this.registers[register]&239;
    this.registers[register]=value;this.inspector?.observeWrite(register,value);this.writeRaw(register,value);this.mutedChannels.add(channel);this.updateMuteMask();
  }
  forceRhythmOff(index){
    if(!Number.isInteger(index)||index<0||index>4)throw new RangeError('YM2413 drum must be 0..4');
    this.auditionStarts.delete(`rhythm:${index}`);const register=0x0e,value=this.registers[register]&~(16>>index);
    this.registers[register]=value;this.inspector?.observeWrite(register,value);this.writeRaw(register,value);this.mutedDrums.add(index);this.writeVolume(VOLUME[index][0]);
    const physical=PHYSICAL[index],other=PHYSICAL.some((ch,i)=>ch===physical&&!!(value&(16>>i)));
    if(!other){this.mutedChannels.add(physical);this.updateMuteMask();}
  }
  stopVoices(){
    if(!this.chip)return;this.auditionStarts.clear();for(let ch=0;ch<9;ch++)this.forceKeyOff(ch);
    this.registers[0x0e]&=224;this.inspector?.observeWrite(0x0e,this.registers[0x0e]);this.writeRaw(0x0e,this.registers[0x0e]);this.mutedDrums=new Set([0,1,2,3,4]);for(const reg of [0x36,0x37,0x38])this.writeVolume(reg);this.silent=true;
  }
  writeRegister(register,value){
    const old=this.registers[register];this.registers[register]=value;this.inspector?.observeWrite(register,value);
    if(register>=0x20&&register<=0x28&&(value&16)&&!((this.registers[0x0e]&32)&&register>=0x26))this.restoreChannel(register-0x20);
    if(register===0x0e){
      if((old^value)&32)for(const reg of [0x36,0x37,0x38])this.writeVolume(reg);
      if(value&32)for(let index=0;index<5;index++)if(value&(16>>index)){this.mutedDrums.delete(index);this.restoreChannel(PHYSICAL[index]);}
    }
    if(register>=0x30&&register<=0x38)this.writeVolume(register);else this.writeRaw(register,value);
    if(register===0x0e&&((old^value)&32))this.publishLayout();
  }
  apply(data,port,frame,metadata){
    try{
      if(data.method==='dispose'){this.dispose();return;}if(!this.chip)throw new Error('YM2413 not ready');
      if(data.method==='clock'||data.type==='chip-clock'){
        if(this.inspector?.auditions.size)throw new Error('YM2413 is held by a manual audition');this.clock=validateChipClock(data.clock??data.args[0]);this.rate=this.chip.sampleRate(this.clock);
      }else if(data.method==='stopVoices'){this.inspector?.invoke('auditionAllOff');this.performance.clear();this.stopVoices();}
      else if(data.method==='reset'){const wasRhythm=!!(this.registers[0x0e]&32);this.chip.reset();this.auditionStarts.clear();this.inspector?.reset();this.registers.fill(0);this.mutedChannels=new Set(Array.from({length:9},(_,index)=>index));this.mutedDrums=new Set([0,1,2,3,4]);this.updateMuteMask();this.silent=true;this.remainder=0;this.left=this.right=0;if(wasRhythm)this.publishLayout();}
      else if(data.method==='writeRegister')this.writeRegister(...data.args);
      else if(data.method==='forceKeyOff')this.forceKeyOff(data.args[0]);
      else if(data.method==='forceRhythmOff')this.forceRhythmOff(data.args[0]);
      else if(data.method==='auditionKeyOn')this.auditionStarts.set(data.args[0],metadata?.owner);
      else if(data.method==='auditionRhythmOn')this.auditionStarts.set(`rhythm:${data.args[0]}`,metadata?.owner);
      else if(data.method==='allNotesOff')this.stopVoices();
      else if(data.type==='clear-scheduled-writes')this.performance.clear();
      else throw new Error(`Unsupported YM2413 command: ${data.method??data.type}`);
      if(data.id!==undefined)port.postMessage({type:data.type==='chip-clock'?'chip-clock-result':undefined,id:data.id,value:true});
    }catch(error){if(data.id!==undefined)port.postMessage({type:data.type==='chip-clock'?'chip-clock-result':undefined,id:data.id,error:error.message});}
  }
  process(inputs,outputs){if(this.dead)return false;const [left,right]=outputs[0];this.performance.render(left,right,this.renderSegment);return true;}
  renderSegment(left,right){
    if(this.chip&&this.auditionStarts.size){
      const count=Math.min(left.length,Math.max(1,Math.ceil((sampleRate-this.remainder)/this.rate)));
      if(this.renderFrames(left,right,0,count)){
        for(const [key,owner]of this.auditionStarts){const id=this.inspector.auditions.get(key);if(id===undefined||owner!==`voice-editor:${id}`)continue;
          const drum=typeof key==='string'?Number(key.slice(7)):null,register=drum===null?0x20+key:0x0e,value=this.registers[register]|(drum===null?16:16>>drum);
          this.performance.applyImmediate({method:'writeRegister',args:[register,value]},this.port,{owner});
        }this.auditionStarts.clear();
      }
      if(count<left.length)this.renderFrames(left,right,count,left.length-count);return;
    }this.renderFrames(left,right,0,left.length);
  }
  renderFrames(left,right,start,length){
    if(!this.chip){left.fill(0,start,start+length);right.fill(0,start,start+length);return 0;}if(this.counts.length<length)this.counts=new Uint32Array(length);let frames=0;
    for(let i=0;i<length;i++){this.remainder+=this.rate;const count=Math.floor(this.remainder/sampleRate);this.remainder-=count*sampleRate;this.counts[i]=count;frames+=count;}
    const pcm=frames?this.chip.generateStereo(frames):null;let offset=0;
    for(let i=0;i<length;i++){const count=this.counts[i];if(count){let l=0,r=0;for(let j=0;j<count;j++,offset++){l+=pcm.left[offset];r+=pcm.right[offset];}this.left=l/count;this.right=r/count;}left[start+i]=this.silent?0:this.left;right[start+i]=this.silent?0:this.right;}return frames;
  }
}
registerProcessor('tetorica-ym2413',Processor);

import {validateChipClock,ChipClockResampler} from './playground_chip_clock.js?v=audio-numeric-bindings-1';
import {Ay8910} from './ay8910.js?v=audio-stability-2';
import factory from '../generated/ay8910_wasm.js';
import {createProcessorPerformance} from './playground_performance_processor.js?v=audio-numeric-bindings-1';
import {Ay8910VoiceInspector} from './playground_ay8910_inspector.js?v=native-extra-nes-1';
import {receiveChipInspector} from './playground_chip_inspector_state.js?v=audio-numeric-bindings-1';
class Processor extends AudioWorkletProcessor{
  constructor({processorOptions:{clock=1789773,wasmBinary}}){
    super();this.baseClock=this.clock=clock;this.chip=null;this.dead=false;this.registers=new Uint8Array(16);this.mutedChannels=new Set([0,1,2]);this.resampler=new ChipClockResampler();
    this.performance=createProcessorPerformance({chip:'ay8910',getAyRegisters:()=>this.registers,immediate:['stopVoices'],apply:(data,port,frame,metadata)=>this.apply(data,port,frame,metadata)});
    this.renderSegment=this.renderSegment.bind(this);
    this.port.onmessage=({data})=>{
      if(data.primaryWorker){this.workerRemote?.close();this.workerRemote=null;if(data.port){if(this.dead){data.port.close();return;}const remote=this.workerRemote=data.port;remote.onmessage=event=>{if(this.workerRemote===remote)this.receive(event.data,remote);};remote.start();}return;}
      if(data.type==='detach-chip-port'){this.remote?.close();this.remote=null;this.inspector?.invoke('auditionAllOff');this.performance.clear();this.stopVoices();return;}
      if(data.port){this.remote?.close();if(this.dead){data.port.close();return;}const remote=this.remote=data.port;remote.onmessage=event=>{if(this.remote===remote)this.receive(event.data,remote);};remote.start();}
      else this.receive(data,this.port);
    };
    Ay8910.create({moduleFactory:factory,moduleOptions:{wasmBinary},clock,sampleRate}).then(chip=>{
      if(this.dead){chip.dispose();return;}this.chip=chip;this.updateMuteMask();
      this.inspector=new Ay8910VoiceInspector({clock:()=>this.clock,sampleRate,dispatch:(command,owner,metadata)=>this.performance.applyImmediate(command,this.port,{owner,...metadata}),beginAudition:(channel,owner)=>this.performance.beginAudition(channel,owner),endAudition:(channel,owner)=>this.performance.endAudition(channel,owner)});
      this.port.postMessage({ready:true});
    }).catch(error=>{this.dispose();this.port.postMessage({error:error.message});});
  }
  dispose(){this.inspector?.resetAuditions();this.performance.clear();this.dead=true;this.chip?.dispose();this.chip=null;this.remote?.close();this.workerRemote?.close();}
  publishState(){this.port.postMessage({type:'ay-state',state:{clock:this.clock,initialized:true,...this.inspector.getState()}});}
  receive(data,port=this.port){
    if(Array.isArray(data)){for(const command of data)this.receive(command,port);return;}
    if(data?.type==='chip-inspector'){receiveChipInspector(data,port,this.inspector?(action,method,args)=>{const value=action==='read'?this.inspector.read():this.inspector.invoke(method,args);if(action!=='read')this.publishState();return value;}:null);return;}
    if((data?.method==='clock'||data?.type==='chip-clock')&&this.inspector?.auditions.size){if(data.id!==undefined)port.postMessage({type:data.type==='chip-clock'?'chip-clock-result':undefined,id:data.id,error:'AY8910 is held by a manual audition'});return;}
    const stopping=data?.type==='performance-stop'&&Number.isSafeInteger(data.session)&&data.session>0&&data.session>=this.performance.getStats().latestSession;
    if(stopping||data?.method==='stopVoices')this.inspector?.invoke('auditionAllOff');
    if(this.performance.receive(data,port)){if(stopping){this.stopVoices();this.performance.clear();}return;}
    this.apply(data,port);
  }
  updateMuteMask(){let mask=0;for(const ch of this.mutedChannels)mask|=1<<ch;this.chip?.setMuteMask(mask);}
  writeRegister(register,value){
    this.chip.writeRegister(register,value);this.registers[register]=value;this.inspector?.observeWrite(register,value);
    if(register>=8&&register<=10){if(value&31)this.mutedChannels.delete(register-8);else this.mutedChannels.add(register-8);this.updateMuteMask();}
  }
  forceKeyOff(channel){if(!Number.isInteger(channel)||channel<0||channel>2)throw new RangeError('AY8910 channel must be 0..2');this.writeRegister(8+channel,0);}
  stopVoices(){if(!this.chip)return;for(let ch=0;ch<3;ch++)this.forceKeyOff(ch);}
  apply(data,port){
    try{
      if(data.method==='dispose'){this.dispose();return;}if(!this.chip)throw new Error('AY8910 not ready');
      if(data.method==='clock'||data.type==='chip-clock'){
        if(this.inspector?.auditions.size)throw new Error('AY8910 is held by a manual audition');this.clock=validateChipClock(data.clock??data.args[0]);this.resampler.setClock(this.clock,this.baseClock);
      }else if(data.method==='stopVoices'){this.inspector?.invoke('auditionAllOff');this.performance.clear();this.stopVoices();}
      else if(data.method==='reset'){this.chip.reset();this.inspector?.reset();this.registers.fill(0);this.mutedChannels=new Set([0,1,2]);this.updateMuteMask();this.resampler.resetPhase();}
      else if(data.method==='writeRegister')this.writeRegister(...data.args);
      else if(data.method==='forceKeyOff')this.forceKeyOff(data.args[0]);
      else if(data.method==='setRetainedLevel'){
        const [channel,level]=data.args;if(!Number.isInteger(channel)||channel<0||channel>2||!Number.isInteger(level)||level<0||level>31)throw new RangeError('Invalid AY retained level');this.inspector.levels[channel]=level;
      }
      else if(data.method==='allNotesOff')this.stopVoices();
      else if(data.type==='clear-scheduled-writes')this.performance.clear();
      else throw new Error(`Unsupported AY8910 command: ${data.method??data.type}`);
      if(data.id!==undefined)port.postMessage({type:data.type==='chip-clock'?'chip-clock-result':undefined,id:data.id,value:true});
    }catch(error){if(data.id!==undefined)port.postMessage({type:data.type==='chip-clock'?'chip-clock-result':undefined,id:data.id,error:error.message});}
  }
  process(inputs,outputs){if(this.dead)return false;const [left,right]=outputs[0];this.performance.render(left,right,this.renderSegment);return true;}
  renderSegment(left,right){if(this.chip)this.resampler.render(this.chip,left,right);else{left.fill(0);right.fill(0);}}
}
registerProcessor('tetorica-ay8910',Processor);

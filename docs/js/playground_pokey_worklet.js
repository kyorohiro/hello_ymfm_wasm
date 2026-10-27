import {Pokey} from './pokey.js?v=pokey-mode-1';
import {PokeyAudioEngine} from './pokeyaudioengine.js?v=pokey-mode-1';
import factory from '../generated/pokey_wasm.js';
import {createProcessorPerformance,performanceNoteRelease} from './playground_performance_processor.js?v=pokey-mode-1';
import {PokeyVoiceInspector} from './playground_pokey_inspector.js?v=pokey-mode-1';
import {receiveChipInspector} from './playground_chip_inspector_state.js?v=pokey-mode-1';

class Processor extends AudioWorkletProcessor{
  constructor({processorOptions:{clock=1789790,wasmBinary}}){
    super();this.clock=clock;this.chip=null;this.speaker=null;this.dead=false;
    this.performance=createProcessorPerformance({validate:data=>{if((data.method==='clock'||data.type==='chip-clock')&&(data.clock??data.args?.[0])!==this.clock)throw new Error('Create a new POKEY instance to change its clock');},chip:'pokey',getPokeyRegisters:()=>this.speaker?.registers,immediate:['stopVoices','readRegister','setChannelMuted'],
      releaseNote:key=>performanceNoteRelease('pokey',key),apply:(data,port,frame,metadata)=>this.apply(data,port,frame,metadata)});
    this.renderSegment=this.renderSegment.bind(this);
    this.port.onmessage=({data})=>{
      if(data.primaryWorker){this.workerRemote?.close();this.workerRemote=null;if(data.port){if(this.dead){data.port.close();return;}const remote=this.workerRemote=data.port;remote.onmessage=event=>{if(this.workerRemote===remote)this.receive(event.data,remote);};remote.start();}return;}
      if(data.type==='detach-chip-port'){this.remote?.close();this.remote=null;this.inspector?.invoke('auditionAllOff');this.performance.clear();this.stopVoices();return;}
      if(data.port){this.remote?.close();if(this.dead){data.port.close();return;}const remote=this.remote=data.port;remote.onmessage=event=>{if(this.remote===remote)this.receive(event.data,remote);};remote.start();}
      else this.receive(data,this.port);
    };
    Pokey.create({moduleFactory:factory,moduleOptions:{wasmBinary},clock,sampleRate}).then(chip=>{
      if(this.dead){chip.dispose();return;}this.chip=chip;this.speaker=new PokeyAudioEngine(chip,1);
      this.inspector=new PokeyVoiceInspector({clock:()=>this.clock,sampleRate,dispatch:(command,owner,metadata)=>this.performance.applyImmediate(command,this.port,{owner,...metadata}),
        beginAudition:(channel,owner)=>this.performance.beginAudition(channel,owner),endAudition:(channel,owner)=>this.performance.endAudition(channel,owner)});
      this.port.postMessage({ready:true});
    }).catch(error=>{this.dispose();this.port.postMessage({error:error.message});});
  }
  dispose(){this.inspector?.resetAuditions();this.performance.clear();this.dead=true;this.speaker?.dispose();this.chip=null;this.speaker=null;this.remote?.close();this.workerRemote?.close();}
  publishState(){this.port.postMessage({type:'pokey-state',state:this.inspector.getState()});}
  receive(data,port=this.port){
    if(Array.isArray(data)){for(const command of data)this.receive(command,port);return;}
    if(data?.type==='chip-inspector'){receiveChipInspector(data,port,this.inspector?(action,method,args)=>{const value=action==='read'?this.inspector.read():this.inspector.invoke(method,args);if(action!=='read')this.publishState();return value;}:null);return;}
    const stopping=data?.type==='performance-stop'&&Number.isSafeInteger(data.session)&&data.session>0&&data.session>=this.performance.getStats().latestSession;
    if(stopping||data?.method==='stopVoices')this.inspector?.invoke('auditionAllOff');
    if(this.performance.receive(data,port)){if(stopping){this.stopVoices();this.performance.clear();}return;}
    this.apply(data,port);
  }
  writeRegister(register,value){this.speaker.writePokey(register,value);this.inspector?.observeWrite(register,value);}
  forceKeyOff(channel){if(!Number.isInteger(channel)||channel<0||channel>3)throw new RangeError('POKEY channel must be 0..3');this.writeRegister(channel*2+1,this.speaker.registers[channel*2+1]&240);}
  stopVoices(){if(!this.chip)return;for(let ch=0;ch<4;ch++)this.forceKeyOff(ch);}
  apply(data,port){
    try{
      if(data.method==='dispose'){this.dispose();return;}if(!this.chip)throw new Error('POKEY not ready');let value=true;
      if(data.method==='clock'||data.type==='chip-clock'){
        if((data.clock??data.args?.[0])!==this.clock)throw new Error('Create a new POKEY instance to change its clock');
      }else if(data.method==='stopVoices'){this.inspector?.invoke('auditionAllOff');this.performance.clear();this.stopVoices();}
      else if(data.method==='reset'){this.speaker.reset();this.inspector?.reset();}
      else if(data.method==='writeRegister')this.writeRegister(...data.args);
      else if(data.method==='forceKeyOff'||data.method==='keyOff')this.forceKeyOff(data.args[0]);
      else if(data.method==='setChannelMuted')value=this.speaker.setChannelMuted(...data.args);
      else if(data.method==='readRegister')value=this.chip.readRegister(...data.args);
      else if(data.method==='barrier'){}
      else if(data.method==='setRetainedLevel'){
        const [ch,level]=data.args;if(!Number.isInteger(ch)||ch<0||ch>3||!Number.isInteger(level)||level<0||level>15)throw new RangeError('Invalid POKEY retained level');this.inspector.levels[ch]=level;
      }else if(data.method==='allNotesOff')this.stopVoices();
      else if(data.type==='clear-scheduled-writes')this.performance.clear();
      else throw new Error(`Unsupported POKEY command: ${data.method??data.type}`);
      if(data.id!==undefined)port.postMessage({type:data.type==='chip-clock'?'chip-clock-result':undefined,id:data.id,value});
    }catch(error){if(data.id!==undefined)port.postMessage({type:data.type==='chip-clock'?'chip-clock-result':undefined,id:data.id,error:error.message});}
  }
  process(inputs,outputs){if(this.dead)return false;const [left,right]=outputs[0];this.performance.render(left,right,this.renderSegment);return true;}
  renderSegment(left,right){if(!this.speaker){left.fill(0);right.fill(0);return;}const pcm=this.speaker.generateStereoView(left.length);left.set(pcm.left);right.set(pcm.right);}
}
registerProcessor('tetorica-pokey',Processor);

import {RfInspectorState, receiveChipInspector, rfSampleMetadata} from './playground_chip_inspector_state.js?v=audio-numeric-bindings-1';
import {ChipClockResampler, CHIP_CLOCKS} from './playground_chip_clock.js?v=audio-numeric-bindings-1';
/** Browser AudioWorklet: RF5C164 PCM generation and direct control port. */
import {Rf5c164} from './rf5c164.js?v=audio-stability-2';
import factory from '../generated/rf5c164_wasm.js';
import {createRf5c164Control} from './playground_rf5c164.js?v=native-extra-lifetime-1';
import {createProcessorPerformance} from './playground_performance_processor.js?v=audio-numeric-bindings-1';
import {RF5C164Synth} from './rf5c164synth.js?v=audio-stability-2';
import {validateChipClock} from './playground_chip_clock.js?v=audio-numeric-bindings-1';
class Processor extends AudioWorkletProcessor {
 constructor(options){super();this.control=null;this.chip=null;this.dead=false;
 const validation=new RF5C164Synth({transport:{write(){},loadMemory(){},reset(){}}});
 this.performance=createProcessorPerformance({chip:'rf5c164',apply:(data,port)=>this.apply(data,port),getRfChannel:()=>this.inspector?.selected??0,getRfMask:()=>this.inspector?.mask??255,immediate:['loadMemory'],validate:data=>{
  if(data.method==='clock'){validateChipClock(data.args[0]);return;}
  if(data.method==='dispose')return;
  if(typeof validation[data.method]!=='function'||!['setChannel','setPitch','keyOn','keyOff','writeRegister','reset','loadMemory'].includes(data.method))throw new Error('Unknown RF5C164 method');
  validation[data.method](...(data.args??[]));
 }});
 this.renderSegment=this.renderSegment.bind(this);this.port.onmessage=({data})=>{
 if(data.method==='dispose'){this.dispose();return;}
 if(data.type==='detach-chip-port'&&data.primaryWorker){this.workerRemote?.close();this.workerRemote=null;return;}
 if(data.port){const name=data.primaryWorker?'workerRemote':'remote';this[name]?.close();const remote=this[name]=data.port;remote.onmessage=e=>{if(this[name]===remote)this.receive(e.data,remote);};remote.start();}else this.receive(data,this.port);
 };
 Rf5c164.create({moduleFactory:factory,moduleOptions:{wasmBinary:options.processorOptions.wasmBinary},sampleRate}).then(chip=>{if(this.dead){chip.dispose();return;}this.chip=chip;this.inspector=new RfInspectorState(chip,{clock:()=>CHIP_CLOCKS.rf5c164*(this.clockResampler?.ratio??1),sampleRate,
  dispatch:(command,owner,metadata)=>this.performance.applyImmediate(command,this.port,{owner,...metadata}),beginAudition:(channel,owner)=>this.performance.beginAudition(channel,owner),endAudition:(channel,owner)=>this.performance.endAudition(channel,owner)});this.control=createRf5c164Control(chip);this.control.reset();this.port.postMessage({ready:true});},error=>this.port.postMessage({error:error.message}));
 }
 stopVoices(){this.inspector?.resetAuditions();this.performance.clear();if(this.control)for(let channel=0;channel<8;channel++)this.control.keyOff(channel);}
 dispose(){this.inspector?.resetAuditions();this.performance.clear();this.dead=true;this.control?.dispose();this.control=null;this.chip=null;this.remote?.close();this.workerRemote?.close();}
 receive(data,port){
  if(data?.type==='chip-inspector'&&receiveChipInspector(data,port,this.control ? (action,method,args)=>this.inspect(action,method,args) : null))return;
  const stop=data.type==='performance-stop'&&Number.isSafeInteger(data.session)&&data.session>0&&data.session>=this.performance.getStats().latestSession;
  if(stop||data.method==='stopVoices'){this.stopVoices();if(stop)this.performance.receive(data,port);if(data.id!==undefined)port.postMessage({id:data.id,value:true});return;}
  if(this.performance.receive(data,port))return;this.apply(data,port);
 }
 inspect(action,method,args){
  if(action==='read')return this.inspector.read();
  if(['auditionOn','auditionOff','auditionAllOff'].includes(method))return this.inspector.invoke(method,args);
  if(action==='loadSample'){
   const [bytes,metadata,options={}]=args;
   rfSampleMetadata(bytes,metadata);
   const address=this.inspector.allocate(bytes.length,options.address);
   const loopStart=options.loopStart===undefined?address+metadata.frames+1:address+options.loopStart;
   if(!Number.isInteger(loopStart)||loopStart<address||loopStart>address+metadata.frames+1||options.loopStart!==undefined&&options.loopStart>=metadata.frames)throw new RangeError('Invalid sample loop position');
   this.control.loadMemory(bytes,address);
   const step=Math.max(1,Math.min(65535,Math.round(metadata.step/(this.clockResampler?.ratio??1))));
   const sample=this.inspector.addSample(address,bytes,{...metadata,step,loopStart});
   return {...sample,start:address};
  }
  if(!['setChannel','setPitch','keyOn','keyOff','writeRegister','reset'].includes(method))throw new Error('Unsupported RF5C164 inspector operation');
  return this.control[method](...args);
 }
 apply(data,port){try{if(data.method==='dispose'){this.dispose();return;}if(data.method==='clock'){if(!this.chip)throw new Error('RF5C164 not ready');(this.clockResampler??=new ChipClockResampler()).setClock(data.args[0],CHIP_CLOCKS.rf5c164);port.postMessage({id:data.id});return;}if(!this.control)throw new Error('RF5C164 not ready');if(!Object.prototype.hasOwnProperty.call(this.control,data.method))throw new Error('Unknown RF5C164 method');const value=this.control[data.method](...data.args);if(data.method==='loadMemory'&&data.args[2])this.inspector.addSample(data.args[1],data.args[0],data.args[2]);if(data.method==='reset')this.clockResampler?.resetPhase();if(data.id)port.postMessage({id:data.id,value});}catch(e){if(data.id)port.postMessage({id:data.id,error:e.message});}}
 process(inputs,outputs){if(this.dead)return false;const[left,right]=outputs[0];this.performance.render(left,right,this.renderSegment);return true;}
 renderSegment(left,right){if(!this.chip){left.fill(0);right.fill(0);return;}if(this.clockResampler){this.clockResampler.render(this.chip,left,right);return;}const pcm=this.chip.generateStereo(left.length);left.set(pcm.left);right.set(pcm.right);}
}
registerProcessor('tetorica-rf5c164',Processor);

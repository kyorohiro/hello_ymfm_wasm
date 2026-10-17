import {ChipClockResampler, CHIP_CLOCKS} from './playground_chip_clock.js';
/** Browser AudioWorklet: RF5C164 PCM generation and direct control port. */
import {Rf5c164} from './rf5c164.js';
import factory from '../generated/rf5c164_wasm.js';
import {createRf5c164Control} from './playground_rf5c164.js';
import {createProcessorPerformance} from './playground_performance_processor.js';
import {RF5C164Synth} from './rf5c164synth.js';
import {validateChipClock} from './playground_chip_clock.js';
class Processor extends AudioWorkletProcessor {
 constructor(options){super();this.control=null;this.chip=null;this.dead=false;
 const validation=new RF5C164Synth({transport:{write(){},loadMemory(){},reset(){}}});
 this.performance=createProcessorPerformance({chip:'rf5c164',apply:(data,port)=>this.apply(data,port),immediate:['loadMemory'],validate:data=>{
  if(data.method==='clock'){validateChipClock(data.args[0]);return;}
  if(data.method==='dispose')return;
  if(typeof validation[data.method]!=='function'||!['setChannel','setPitch','keyOn','keyOff','writeRegister','reset','loadMemory'].includes(data.method))throw new Error('Unknown RF5C164 method');
  validation[data.method](...(data.args??[]));
 }});
 this.renderSegment=this.renderSegment.bind(this);this.port.onmessage=({data})=>{
 if(data.method==='dispose'){this.dispose();return;}
 if(data.port){this.remote=data.port;this.remote.onmessage=e=>this.receive(e.data,this.remote);this.remote.start();}else this.receive(data,this.port);
 };
 Rf5c164.create({moduleFactory:factory,moduleOptions:{wasmBinary:options.processorOptions.wasmBinary},sampleRate}).then(chip=>{if(this.dead){chip.dispose();return;}this.chip=chip;this.control=createRf5c164Control(chip);this.control.reset();this.port.postMessage({ready:true});},error=>this.port.postMessage({error:error.message}));
 }
 dispose(){this.performance.clear();this.dead=true;this.control?.dispose();this.control=null;this.chip=null;this.remote?.close();}
 receive(data,port){if(this.performance.receive(data,port))return;this.apply(data,port);}
 apply(data,port){try{if(data.method==='dispose'){this.dispose();return;}if(data.method==='clock'){if(!this.chip)throw new Error('RF5C164 not ready');(this.clockResampler??=new ChipClockResampler()).setClock(data.args[0],CHIP_CLOCKS.rf5c164);port.postMessage({id:data.id});return;}if(!this.control)throw new Error('RF5C164 not ready');if(!Object.prototype.hasOwnProperty.call(this.control,data.method))throw new Error('Unknown RF5C164 method');const value=this.control[data.method](...data.args);if(data.method==='reset')this.clockResampler?.resetPhase();if(data.id)port.postMessage({id:data.id,value});}catch(e){if(data.id)port.postMessage({id:data.id,error:e.message});}}
 process(inputs,outputs){if(this.dead)return false;const[left,right]=outputs[0];this.performance.render(left,right,this.renderSegment);return true;}
 renderSegment(left,right){if(!this.chip){left.fill(0);right.fill(0);return;}if(this.clockResampler){this.clockResampler.render(this.chip,left,right);return;}const pcm=this.chip.generateStereo(left.length);left.set(pcm.left);right.set(pcm.right);}
}
registerProcessor('tetorica-rf5c164',Processor);

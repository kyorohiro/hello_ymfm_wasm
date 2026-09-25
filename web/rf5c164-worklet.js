/** Browser AudioWorklet: RF5C164 PCM generation and direct control port. */
import {Rf5c164} from './rf5c164.js';
import factory from './generated/rf5c164_wasm.js';
import {createRf5c164Control} from './playground_rf5c164.js';
class Processor extends AudioWorkletProcessor {
 constructor(options){super();this.control=null;this.chip=null;this.dead=false;this.port.onmessage=({data})=>{
 if(data.method==='dispose'){this.dead=true;this.control?.dispose();this.control=null;this.chip=null;this.remote?.close();return;}
 if(data.port){this.remote=data.port;this.remote.onmessage=e=>this.receive(e.data,this.remote);this.remote.start();}else this.receive(data,this.port);
 };
 Rf5c164.create({moduleFactory:factory,moduleOptions:{wasmBinary:options.processorOptions.wasmBinary},sampleRate}).then(chip=>{if(this.dead){chip.dispose();return;}this.chip=chip;this.control=createRf5c164Control(chip);this.control.reset();this.port.postMessage({ready:true});},error=>this.port.postMessage({error:error.message}));
 }
 receive(data,port){try{if(!this.control)throw new Error('RF5C164 not ready');if(!Object.prototype.hasOwnProperty.call(this.control,data.method))throw new Error('Unknown RF5C164 method');const value=this.control[data.method](...data.args);if(data.method==='dispose'){this.control=null;this.chip=null;this.dead=true;}if(data.id)port.postMessage({id:data.id,value});}catch(e){if(data.id)port.postMessage({id:data.id,error:e.message});}}
 process(inputs,outputs){if(this.dead)return false;if(this.chip){const out=outputs[0],pcm=this.chip.generateStereo(out[0].length);out[0].set(pcm.left);out[1].set(pcm.right);}return true;}
}
registerProcessor('tetorica-rf5c164',Processor);

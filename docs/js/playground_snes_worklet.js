import factory from '../generated/spc_wasm.js';
import {SnesDspCore} from './spc.js?v=chip-tabs-2';
import {SnesSynth} from './snessynth.js?v=chip-tabs-2';
import {SpcResampler} from './spc_resampler.js?v=chip-tabs-2';
import {createProcessorPerformance} from './playground_performance_processor.js?v=snes-spc-1';
const METHODS=new Set(['loadBRR','setPreset','setChannel','setPitch','setFrequency','setNote','keyOn','keyOff','noteOn','noteOff','allNotesOff','reset','writeDsp','readDsp','getState','getPreset','snapshot','dispose']);
export class SnesInstrumentProcessor extends AudioWorkletProcessor {
  constructor({processorOptions={}}={}) {
    super();this.synth=null;this.dead=false;this.remote=null;
    this.validation=new SnesSynth({core:{reset(){},loadRam(){},writeDsp(){},dispose(){}}});
    this.renderSegment=this.renderSegment.bind(this);
    this.performance=createProcessorPerformance({chip:'snes',apply:(data,port)=>this.apply(data,port,true),
      immediate:['loadBRR','readDsp','getState','getPreset','snapshot'],validate:({method,args=[]})=>{
        if(!METHODS.has(method))throw new Error('Unknown SNES method');
        if(method==='dispose'||['getState','snapshot','readDsp','getPreset'].includes(method))return;
        if(method!=='loadBRR')this.validation[method](...args);
      }});
    this.port.onmessage=({data})=>{
      if(data?.method==='dispose'){this.dispose();return;}
      if(data?.port){this.remote=data.port;this.remote.onmessage=event=>this.receive(event.data,this.remote);this.remote.start();}
      else this.receive(data,this.port);
    };
    this.ready=SnesDspCore.create({moduleFactory:factory,moduleOptions:{wasmBinary:processorOptions.wasmBinary}}).then(core=>{
      if(this.dead){core.dispose();return;}
      this.synth=new SnesSynth({core});this.resampler=new SpcResampler(this.synth,sampleRate,{sourceFrames:1});
      this.port.postMessage({ready:true,sampleRate,nativeSampleRate:32000});
    }).catch(error=>this.fail(error));
  }
  receive(data,port){if(this.performance.receive(data,port))return;this.apply(data,port);}
  apply({method,args=[],id},port,queued=false) {
    try {
      if(method==='dispose'){this.dispose();return;}
      if(this.dead||!this.synth)throw new Error('SNES instrument is not ready');
      if(!METHODS.has(method))throw new Error('Unknown SNES method');
      const value=this.synth[method](...args);
      if(method==='loadBRR')this.validation.loadBRR(...args);
      else if(!queued&&!['readDsp','getState','getPreset','snapshot'].includes(method))this.validation[method](...args);
      if(method==='reset')this.resampler.reset();
      if(id!==undefined)port.postMessage({id,value});
    }catch(error){port.postMessage({id,error:String(error.message??error)});}
  }
  fail(error){if(this.dead)return;this.port.postMessage({fatal:true,error:String(error.message??error)});this.remote?.postMessage({fatal:true,error:String(error.message??error)});this.dispose();}
  dispose(){if(this.dead)return;this.dead=true;this.performance.clear();this.synth?.dispose();this.synth=null;this.remote?.close();}
  renderSegment(left,right){if(!this.synth){left.fill(0);right.fill(0);return;}this.resampler.render(left,right);}
  process(_inputs,outputs){const[left,right]=outputs[0];if(this.dead){left.fill(0);right.fill(0);return false;}try{this.performance.render(left,right,this.renderSegment);return true;}catch(error){left.fill(0);right.fill(0);this.fail(error);return false;}}
}
registerProcessor('tetorica-playground-snes',SnesInstrumentProcessor);

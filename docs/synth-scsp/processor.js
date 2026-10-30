// SPDX-License-Identifier: BSD-3-Clause
import factory from '../generated/scsp_wasm.js';
import {Scsp} from '../js/scsp.js';
import {Pcm44100Resampler} from '../js/pcm_44100_resampler.js';
import {SynthInstrument} from './instrument.js';
class SynthProcessor extends AudioWorkletProcessor {
  constructor({processorOptions={}}={}){
    super();this.dead=false;
    this.ready=Scsp.create({moduleFactory:factory,moduleOptions:{wasmBinary:processorOptions.wasmBinary}}).then(core=>{
      if(this.dead){core.dispose();return;}
      this.instrument=new SynthInstrument(core);this.instrument.synth.prepare(128);this.resampler=new Pcm44100Resampler(this.instrument.synth,sampleRate);
      this.port.postMessage({ready:true,state:this.instrument.read()});
    }).catch(error=>this.port.postMessage({fatal:true,error:error.message}));
    this.port.onmessage=({data})=>{
      if(data.method==='dispose'){this.dead=true;this.instrument?.dispose();return;}
      void this.ready.then(()=>{
        if(this.dead)return;
        try{
          let value;
          if(data.type==='chip-inspector')value=data.action==='read'?this.instrument.read():this.instrument.invoke(data.method,data.args);
          else if(['noteOn','noteOff','setConfig','loadPatch','exportPatch','stopVoices'].includes(data.method)){
            const config=this.instrument.config;value=this.instrument[data.method](...(data.args??[]));if(['loadPatch','stopVoices'].includes(data.method)||config.mode!==this.instrument.config.mode||config.fm.algorithm!==this.instrument.config.fm.algorithm)this.resampler.reset();
          }else throw new Error('Unknown Synth command');
          if(data.id!==undefined)this.port.postMessage({id:data.id,value});
        }catch(error){this.port.postMessage({id:data.id,error:error.message});}
      });
    };
  }
  process(_inputs,outputs){if(this.dead)return false;const [left,right]=outputs[0]??[];if(left&&right){if(this.resampler)this.resampler.render(left,right);else{left.fill(0);right.fill(0);}}return true;}
}
registerProcessor('tetorica-scsp-synth',SynthProcessor);

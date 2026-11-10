// Synth-only software release. The shared RF5C164 core and SDK stay unchanged.
import {Rf5c164} from '../js/rf5c164.js?v=audio-stability-2';
import factory from '../generated/rf5c164_wasm.js';
import {RF5C164Synth,RF5C164DirectTransport} from '../js/rf5c164synth.js?v=audio-stability-2';
import {createSynthPcmRelease} from './synth_pcm_release.js?v=pcm-release-1';

const methods=new Set(['writeRegister','loadMemory','reset','keyOn','keyOff','releaseNote']);
class SynthPcmProcessor extends AudioWorkletProcessor {
  constructor({processorOptions={}}={}) {
    super();this.chip=null;this.output=null;this.dead=false;
    this.port.onmessage=({data})=>this.receive(data);
    Rf5c164.create({moduleFactory:factory,moduleOptions:{wasmBinary:processorOptions.wasmBinary},sampleRate}).then(chip=>{
      if(this.dead){chip.dispose();return;}
      this.chip=chip;
      const pcm=new RF5C164Synth({transport:new RF5C164DirectTransport(chip)});
      this.output=createSynthPcmRelease({pcm,sampleRate,renderAudio:(left,right)=>{
        const block=chip.generateStereo(left.length);left.set(block.left);right.set(block.right);
      }});
      this.output.pcm.reset();this.port.postMessage({ready:true});
    }).catch(error=>this.fail(error));
  }
  receive(data) {
    if(this.dead)return;
    if(data?.method==='dispose'){this.dispose();return;}
    try {
      if(!this.output)throw Error('PCM Synth is not ready');
      if(!methods.has(data?.method)||!Array.isArray(data.args??[]))throw Error('Unknown PCM Synth command');
      const value=this.output.pcm[data.method](...(data.args??[]));
      if(data.id!==undefined)this.port.postMessage({id:data.id,value});
    } catch(error) {
      if(data?.id!==undefined)this.port.postMessage({id:data.id,error:error.message});
      else this.fail(error);
    }
  }
  dispose() {
    if(this.dead)return;this.dead=true;
    this.output=null;this.chip?.dispose();this.chip=null;
  }
  fail(error) {this.dispose();this.port.postMessage({fatal:true,error:error.message??String(error)});}
  process(inputs,outputs) {
    if(this.dead)return false;
    const [left,right]=outputs[0];
    try {
      if(this.output)this.output.render(left,right);
      else {left.fill(0);right.fill(0);}
      return true;
    } catch(error) {left.fill(0);right.fill(0);this.fail(error);return false;}
  }
}
registerProcessor('tetorica-synth-pcm',SynthPcmProcessor);

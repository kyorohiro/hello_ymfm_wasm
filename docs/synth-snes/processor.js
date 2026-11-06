// SPDX-License-Identifier: BSD-3-Clause
import factory from '../generated/spc_wasm.js';
import {SnesDspCore} from '../js/spc.js';
import {SpcResampler} from '../js/spc_resampler.js';
import {SnesInstrument} from './instrument.js';

const COMMANDS=new Set(['read','setPreset','loadPreset','noteOn','noteOff','setPitch','stop']);
class SdspSynthProcessor extends AudioWorkletProcessor {
  constructor({processorOptions={}}={}) {
    super();this.dead=false;this.instrument=null;this.acceptedBrrData='';this.acceptedModBrrData='';
    this.port.onmessage=({data})=>this.receive(data);
    this.ready=SnesDspCore.create({moduleFactory:factory,moduleOptions:{wasmBinary:processorOptions.wasmBinary}}).then(core=>{
      if(this.dead){core.dispose();return;}
      try {
        this.instrument=new SnesInstrument(core);
        this.resampler=new SpcResampler(this.instrument,sampleRate,{sourceFrames:1});
      }catch(error){core.dispose();throw error;}
      this.port.postMessage({ready:true,nativeSampleRate:32000});
    }).catch(error=>this.fail(error));
  }
  dispose(){if(this.dead)return;this.dead=true;this.instrument?.dispose();this.instrument=null;this.resampler=null;this.acceptedBrrData='';this.acceptedModBrrData='';}
  fail(error){if(this.dead)return;this.dispose();this.port.postMessage({fatal:true,error:error?.message??String(error)});}
  receive(data){
    if(data?.method==='dispose'){this.dispose();return;}
    if(this.dead)return;
    void this.ready.then(()=>{
      if(this.dead)return;
      try {
        if(!COMMANDS.has(data?.method))throw new Error('Unknown S-DSP Synth command');
        if(data.args!==undefined&&!Array.isArray(data.args))throw new TypeError('S-DSP command arguments must be an array');
        let args=data.args??[];
        if(data.brrDataUnchanged!==undefined){
          if(data.brrDataUnchanged!==true||!['setPreset','loadPreset'].includes(data.method)||!args[0]?.brr||Object.hasOwn(args[0].brr,'data'))throw new TypeError('Invalid cached BRR reference');
          args=[{...args[0],brr:{...args[0].brr,data:this.acceptedBrrData}},...args.slice(1)];
        }
        if(data.modBrrDataUnchanged!==undefined){
          if(data.modBrrDataUnchanged!==true||!['setPreset','loadPreset'].includes(data.method)||!args[0]?.pmon?.brr||Object.hasOwn(args[0].pmon.brr,'data'))throw new TypeError('Invalid cached modulator BRR reference');
          args=[{...args[0],pmon:{...args[0].pmon,brr:{...args[0].pmon.brr,data:this.acceptedModBrrData}}},...args.slice(1)];
        }
        const before=this.instrument.generation;
        let value=this.instrument[data.method](...args);
        if(before!==this.instrument.generation)this.resampler.reset();
        const bytes=value?.preset?.brr?.data,modBytes=value?.preset?.pmon?.brr?.data;
        if(typeof bytes==='string')this.acceptedBrrData=bytes;
        if(typeof modBytes==='string')this.acceptedModBrrData=modBytes;
        const flags={};
        if(typeof bytes==='string'&&bytes.length){
          const {data:_data,...brr}=value.preset.brr;
          value={...value,preset:{...value.preset,brr}};
          flags.brrDataOmitted=true;
        }
        if(typeof modBytes==='string'&&modBytes.length){
          const {data:_data,...brr}=value.preset.pmon.brr;
          value={...value,preset:{...value.preset,pmon:{...value.preset.pmon,brr}}};
          flags.modBrrDataOmitted=true;
        }
        if(data.id!==undefined)this.port.postMessage({id:data.id,value,...flags});
      }catch(error){if(data?.id!==undefined)this.port.postMessage({id:data.id,error:error.message,name:error.name});}
    }).catch(error=>this.fail(error));
  }
  process(_inputs,outputs){
    const[left,right]=outputs[0]??[];if(!left)return !this.dead;
    if(this.dead){left.fill(0);right?.fill(0);return false;}
    if(!this.instrument){left.fill(0);right?.fill(0);return true;}
    try{this.resampler.render(left,right??new Float32Array(left.length));return true;}
    catch(error){left.fill(0);right?.fill(0);this.fail(error);return false;}
  }
}
registerProcessor('tetorica-sdsp-synth',SdspSynthProcessor);

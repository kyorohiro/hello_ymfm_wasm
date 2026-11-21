import {createPerformanceQueue} from '../js/playground_performance_queue.js';
import {createSnesTimedProcessor} from '../js/snes_timed_processor.js';
import {captureSnesOperationState} from '../js/snes_operation_state.js';
// SPDX-License-Identifier: BSD-3-Clause
import factory from '../generated/spc_wasm.js';
import {SnesDspCore} from '../js/spc.js';
import {SpcResampler} from '../js/spc_resampler.js';
import {SnesInstrument} from './instrument.js?v=channel-mixer-1';

const COMMANDS=new Set(['read','setPreset','loadPreset','noteOn','noteOff','setPitch','setMuteMask','stop']);
class SdspSynthProcessor extends AudioWorkletProcessor {
  constructor({processorOptions={}}={}) {
    super();this.dead=false;this.instrument=null;this.acceptedBrrData='';this.acceptedModBrrData='';
    this.renderFrame=0;this.timedOwners=Array(8).fill(null);this.instanceId='sdsp-synth:'+Math.random().toString(36).slice(2);
    this.performance=createPerformanceQueue({sampleRate,nowFrame:()=>this.renderFrame,patternCommandCost:c=>c.method==='applyTimedOperation'?c.writeCost:1,
      apply:(data,reply,frame,metadata)=>this.timed.apply(data.operation,{postMessage:reply??(m=>this.port.postMessage(m))},frame,metadata),
      onCancelOwner:owner=>{for(let ch=0;ch<8;ch++)if(this.timedOwners[ch]===owner){this.instrument.synth.keyOff(ch);this.timedOwners[ch]=null;}}});
    this.timed=createSnesTimedProcessor({performance:{...this.performance,receive:(data,port)=>this.performance.receive(data,m=>port.postMessage(m))},getState:()=>captureSnesOperationState(this.instrument.synth),getConfig:()=>({instanceId:this.instanceId,clock:32000,engine:'snes-wasm'}),dispatch:(command,port,frame,metadata)=>this.applyTimed(command,metadata.owner,metadata.snesState),nowFrame:()=>this.renderFrame,sampleRate});
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
  dispose(){if(this.dead)return;this.dead=true;this.performance.clear();this.timed.clear();this.instrument?.dispose();this.instrument=null;this.resampler=null;this.acceptedBrrData='';this.acceptedModBrrData='';}
  fail(error){if(this.dead)return;this.dispose();this.port.postMessage({fatal:true,error:error?.message??String(error)});}
  receive(data){
    if(data?.method==='dispose'){this.dispose();return;}
    if(this.dead)return;
    void this.ready.then(()=>{
      if(this.dead)return;
      try {
        if(this.timed.receive(data,this.port))return;
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
        if(before!==this.instrument.generation){this.resampler.reset();this.timedOwners.fill(null);}
        if(data.method==='noteOn'&&value?.channel!==undefined)for(const ch of this.instrument._voiceChannels?.(this.instrument.slots?.[value.channel]??value)??[value.channel])this.timedOwners[ch]=null;
        if(data.method==='stop'){this.performance.clear();this.timedOwners.fill(null);}
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
  applyTimed({method,args},owner,state){
    const synth=this.instrument.synth;
    if(state)synth.channels=state.channels.map(p=>({...p}));
    const on=['keyOn','noteOn'].includes(method)?[args[0]]:method==='writeDsp'&&args[0]===0x4c?Array.from({length:8},(_,i)=>i).filter(i=>args[1]&(1<<i)):[];
    if(['keyOff','noteOff'].includes(method)&&this.timedOwners[args[0]]!==owner)return;
    if(method==='writeDsp'&&args[0]===0x5c)args=[0x5c,args[1]&this.timedOwners.reduce((mask,value,ch)=>mask|(value===owner?1<<ch:0),0)];
    for(const ch of on){
      for(const voice of this.instrument.slots)if(voice&&this.instrument._voiceChannels(voice).includes(ch)){
        this.instrument.voices.delete(voice.id);this.instrument.slots[voice.channel]=null;
        for(const companion of this.instrument._voiceChannels(voice))if(companion!==ch)synth.keyOff(companion);
      }
      this.timedOwners[ch]=owner;
    }
    synth[method](...args);
    if(['keyOff','noteOff'].includes(method))this.timedOwners[args[0]]=null;
  }
  process(_inputs,outputs){
    const[left,right]=outputs[0]??[];if(!left)return !this.dead;
    if(this.dead){left.fill(0);right?.fill(0);return false;}
    if(!this.instrument){left.fill(0);right?.fill(0);return true;}
    try{const r=right??new Float32Array(left.length);let offset=0;while(offset<left.length){this.performance.advance(this.renderFrame);const count=Math.min(left.length-offset,Math.max(1,this.performance.nextFrame()-this.renderFrame));this.resampler.render(left.subarray(offset,offset+count),r.subarray(offset,offset+count));offset+=count;this.renderFrame+=count;}return true;}
    catch(error){left.fill(0);right?.fill(0);this.fail(error);return false;}
  }
}
registerProcessor('tetorica-sdsp-synth',SdspSynthProcessor);

// SPDX-License-Identifier: BSD-3-Clause
import {Sid8580MachineCore} from './core.js';
const INSPECT=new Set(['readRam','readTrace','readSidReads']);
const COMMANDS=new Set(['load','start','stop','read',...INSPECT]);
const now=()=>globalThis.performance?.now?.()??Date.now();
class Sid8580Processor extends AudioWorkletProcessor {
  constructor({processorOptions={}}={}){
    super();this.core=null;this.playing=false;this.dead=false;this.startEpoch=0;
    this.metrics={blocks:0,frames:0,totalRenderMs:0,maxRenderMs:0,overBudgetBlocks:0,lastLoadMs:0,maxLoadMs:0,
      timingSource:globalThis.performance?.now?'performance.now':'Date.now',perCycleJavaScriptCallbacks:0};
    this.port.onmessage=({data})=>this.receive(data);
    this.ready=Sid8580MachineCore.create({sampleRate,...processorOptions}).then(core=>{
      if(this.dead){core.dispose();return;}this.core=core;this.port.postMessage({ready:true});
    }).catch(error=>this.fail(error));this.commands=this.ready;
  }
  state(){return {...this.core.getState(),playing:this.playing,worklet:{...this.metrics,
    meanRenderMs:this.metrics.blocks?this.metrics.totalRenderMs/this.metrics.blocks:0,quantumBudgetMs:128/sampleRate*1000}};}
  dispose(){if(!this.dead){this.dead=true;this.playing=false;this.core?.dispose();this.core=null;}}
  fail(error){if(!this.dead){this.dispose();this.port.postMessage({fatal:true,error:error?.message??String(error)});}}
  receive(data){
    if(data?.method==='dispose'){this.dispose();return;}if(this.dead)return;
    // Stop queued during asynchronous WASM startup must prevent a later Start.
    if(data?.method==='stop'){this.playing=false;this.startEpoch++;}
    const startEpoch=this.startEpoch;
    this.commands=this.commands.then(()=>{
      if(this.dead)return;
      try{
        if(!COMMANDS.has(data?.method)||data.args!==undefined&&!Array.isArray(data.args))throw new Error('Invalid research player command');
        const args=data.args??[];
        if(data.method==='load'){
          const started=now();
          try{this.core.load(args[0],args[1]);this.playing=false;}
          finally{this.metrics.lastLoadMs=now()-started;this.metrics.maxLoadMs=Math.max(this.metrics.maxLoadMs,this.metrics.lastLoadMs);}
        }
        if(data.method==='start'){if(startEpoch!==this.startEpoch)throw new Error('Research start was cancelled');
          if(!this.core.getState().playing)throw new Error('Load a research SID before starting');this.playing=true;}
        if(data.method==='stop'){this.playing=false;this.core.stop();}
        if(data.id!==undefined)this.port.postMessage({id:data.id,value:INSPECT.has(data.method)?this.core[data.method](...args):this.state()});
      }catch(error){if(data?.id!==undefined)this.port.postMessage({id:data.id,error:error.message,name:error.name});}
    }).catch(error=>this.fail(error));
  }
  process(_inputs,outputs){
    const [left,right]=outputs[0]??[];
    if(this.dead){left?.fill(0);right?.fill(0);return false;}
    if(!left)return true;
    if(!this.core||!this.playing){left.fill(0);right?.fill(0);return true;}
    const started=now();
    try{this.core.renderInto(left);right?.set(left);return true;}
    catch(error){left.fill(0);right?.fill(0);this.fail(error);return false;}
    finally{const elapsed=now()-started;this.metrics.blocks++;this.metrics.frames+=left.length;
      this.metrics.totalRenderMs+=elapsed;this.metrics.maxRenderMs=Math.max(this.metrics.maxRenderMs,elapsed);
      if(elapsed>left.length/sampleRate*1000)this.metrics.overBudgetBlocks++;}
  }
}
registerProcessor('tetorica-sid8580-machine',Sid8580Processor);

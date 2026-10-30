// SPDX-License-Identifier: BSD-3-Clause
import factory from '../generated/scsp_wasm.js';
import {Scsp} from './scsp.js?v=scsp-native-1';
import {ScspSynth,createScspInitSample} from './scspsynth.js?v=scsp-native-1';
import {Pcm44100Resampler} from './pcm_44100_resampler.js?v=scsp-native-1';
import {SCSP_CONTROLS,createScspValidation,scspCommandArgs} from './playground_scsp.js?v=scsp-native-1';
import {createProcessorPerformance} from './playground_performance_processor.js?v=scsp-native-1';
import {ScspVoiceInspector} from './playground_scsp_inspector.js?v=scsp-native-1';
import {receiveChipInspector} from './playground_chip_inspector_state.js?v=pokey-prepare-1';
const METHODS=new Set([...SCSP_CONTROLS,'loadPCM','getState']);
export class ScspInstrumentProcessor extends AudioWorkletProcessor {
  constructor({processorOptions={}}={}) {
    super();this.dead=false;this.synth=null;this.remote=null;this.workerRemote=null;this.revision=0;this.bankEpoch=0;this.fences=new WeakMap();
    this.validation=createScspValidation();this.renderSegment=this.renderSegment.bind(this);
    this.performance=createProcessorPerformance({chip:'scsp',apply:(data,port)=>this.apply(data,port,true),
      validate:({method,args=[]})=>{
        if(!METHODS.has(method))throw new Error('Unknown SCSP method');
        if(method!=='loadPCM'&&method!=='getState')this.validation[method](...scspCommandArgs(this.validation,method,args));
      },prepare:(data,port)=>{
        if(['reset','loadPCM','getState'].includes(data.method)){this.apply(data,port);return null;}
        if(data.id===undefined)return data;const {id,...command}=data;port.postMessage({id,value:true});return command;
      }});
    this.port.onmessage=({data})=>{
      if(data?.primaryWorker){this.workerRemote?.close();this.workerRemote=null;if(data.port)this.attach(data.port,true);return;}
      if(data?.port){this.remote?.close();this.attach(data.port,false);return;}
      this.receive(data,this.port);
    };
    this.ready=Scsp.create({moduleFactory:factory,moduleOptions:{wasmBinary:processorOptions.wasmBinary,locateFile:()=>'scsp_wasm.wasm'}}).then(core=>{
      if(this.dead){core.dispose();return;}this.synth=new ScspSynth(core);core.prepare(128);
      const {pcm,options}=createScspInitSample(),sample=this.synth.loadPCM(pcm,options);
      for(let ch=0;ch<32;ch++)this.synth.setPreset(ch,{sample,totalLevel:12});
      this.validation._adoptState(this.synth.getState());
      this.inspector=new ScspVoiceInspector(this.synth,{sampleRate,
        readPCM:sample=>{
          const bytes=core.readRam(sample.address,sample.length*(sample.bits/8)),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
          return sample.bits===8?Int8Array.from(bytes,v=>v>127?v-256:v):Int16Array.from({length:sample.length},(_,i)=>view.getInt16(i*2,false));
        },
        editPCM:(ch,pcm,options)=>{
          if(this.performance.getStats().activeSession||this.performance.getStats().queuedCommands)throw new Error('Stop scheduled playback before applying PCM. The waveform draft is retained.');
          const sample=this.synth._editPCM(ch,pcm,options);
          this.resourcesChanged(undefined,ch);return sample;
        },validate:command=>{const check=createScspValidation();try{check._adoptState(this.synth.getState());check[command.method](...command.args);}finally{check.dispose();}},dispatch:(command,owner)=>this.performance.applyImmediate(command,this.port,{owner}),beginAudition:(ch,owner)=>this.performance.beginAudition(ch,owner),endAudition:(ch,owner)=>this.performance.endAudition(ch,owner)});
      this.resampler=new Pcm44100Resampler(this.synth,sampleRate);
      this.port.postMessage({ready:true,sampleRate,nativeSampleRate:44100,state:this.synth.getState()});
    }).catch(error=>this.fail(error));
  }
  attach(port,worker){if(this.dead){port.close();return;}if(worker)this.workerRemote=port;else this.remote=port;port.onmessage=({data})=>{if((worker?this.workerRemote:this.remote)===port)this.receive(data,port);};port.start();this.sendResources(port);}
  sendResources(port,resetPort,editedSlot){if(!port||!this.synth||this.dead)return;port.postMessage({type:'scsp-resources',editedSlot,revision:this.revision,bankEpoch:this.bankEpoch,resourceFence:this.fences.get(port)??0,state:this.synth.getState(),reset:!!resetPort,ownReset:port===resetPort});}
  resourcesChanged(resetPort,editedSlot){const state=this.synth.getState();this.validation._adoptResources(state);if(Number.isInteger(editedSlot))this.validation._adoptEditorState(editedSlot,state);this.revision++;for(const port of new Set([this.port,this.remote,this.workerRemote]))this.sendResources(port,resetPort,editedSlot);}
  receive(data,port) {
    if(data?.method==='dispose'){this.dispose();return;}
    if(data?.type==='chip-inspector'&&receiveChipInspector(data,port,this.inspector?(action,method,args)=>action==='read'?this.inspector.read():this.inspector.invoke(method,args):null))return;
    const stopping=data?.type==='performance-stop'&&Number.isSafeInteger(data.session)&&data.session>0&&data.session>=this.performance.getStats().latestSession;
    if(data?.method==='stopVoices'||stopping){this.stopVoices();if(stopping)this.performance.receive(data,port);if(data.id!==undefined)port.postMessage({id:data.id,value:true});return;}
    if(data?.method==='reset'&&!data.performance){this.apply(data,port);return;}
    if(this.performance.receive(data,port))return;this.apply(data,port);
  }
  stopVoices(){this.inspector?.resetAuditions();this.performance.clear();const session=this.performance.getStats().activeSession;if(session)this.performance.receive({type:'performance-stop',session},{postMessage(){}});this.synth?.stopVoices();this.validation.stopVoices();this.resampler?.reset();}
  apply({method,args=[],id,resourceFence},port,queued=false) {
    try {
      if(this.dead||!this.synth)throw new Error('SCSP is not ready');if(!METHODS.has(method))throw new Error('Unknown SCSP method');
      if(method==='reset'){
        // Validate before retiring the queue/manual leases.
        this.validation.reset(...args);this.inspector.resetAuditions();this.performance.clear();
      }
      const value=this.synth[method](...scspCommandArgs(this.synth,method,args));
      if(method==='loadPCM')this.resourcesChanged();
      else if(!queued&&method!=='getState'&&method!=='reset')this.validation[method](...scspCommandArgs(this.validation,method,args));
      if(method==='reset'){
        if(Number.isSafeInteger(resourceFence)&&resourceFence>=0)this.fences.set(port,resourceFence);
        if(args[0]?.clearRam)this.bankEpoch++;this.resourcesChanged(port);this.resampler.reset();
      }
      if(id!==undefined)port.postMessage({id,value});return value;
    }catch(error){port.postMessage({id,error:String(error.message??error),name:error.name});if(queued)throw error;}
  }
  fail(error){if(this.dead)return;for(const port of new Set([this.port,this.remote,this.workerRemote]))port?.postMessage({fatal:true,error:String(error.message??error)});this.dispose();}
  dispose(){if(this.dead)return;this.dead=true;this.inspector?.resetAuditions();this.performance.clear();this.synth?.dispose();this.validation.dispose();this.synth=null;this.remote?.close();this.workerRemote?.close();}
  renderSegment(left,right){if(!this.synth){left.fill(0);right.fill(0);}else this.resampler.render(left,right);}
  process(_inputs,outputs){const [left,right]=outputs[0];if(this.dead){left.fill(0);right.fill(0);return false;}try{this.performance.render(left,right,this.renderSegment);return true;}catch(error){left.fill(0);right.fill(0);this.fail(error);return false;}}
}
registerProcessor('tetorica-playground-scsp',ScspInstrumentProcessor);

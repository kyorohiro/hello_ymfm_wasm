// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 kyorohiro.
import factory from '../generated/huc6280_wasm.js';
import {Huc6280AudioEngine} from '../js/huc6280audioengine.js';
import {HUC6280_CLOCK} from '../js/huc6280synth.js';
import {Huc6280Instrument} from './instrument.js?v=huc-shared-channels-1';
import {createProcessorPerformance} from '../js/playground_performance_processor.js';
import {createHuc6280TimedProcessor,huc6280TimedCommandCost} from '../js/huc6280_timed_processor.js';
import {validateHuc6280SynthPlan} from './timed_operations.js';

const COMMANDS = new Set(['read','observeCode','observeEditor','setChannelMuteMask','applyEditorEdit','setPreset','loadPreset','noteOn','noteOff','setPitch','stop','releaseKeyboard','beginCode','timed','code','applyCodePreset','applyCodeEdit']);
const cancelled=()=>{const error=new Error('HuC6280 command cancelled by Stop or a newer Code session');error.name='AbortError';return error;};

class Huc6280SynthProcessor extends AudioWorkletProcessor {
  constructor({processorOptions = {}} = {}) {
    super(); this.dead = false; this.instrument = null; this.acceptedDdaData = '';
    this.commandEpoch=0;this.codeSerial=0;this.codeOwner=null;
    this.renderedFrames=0;this.instanceId=processorOptions.instanceId??`huc-synth-${Math.random().toString(36).slice(2)}`;
    this.renderSegment=this.renderSegment.bind(this);
    this.port.onmessage = ({data}) => this.receive(data);
    this.ready = Huc6280AudioEngine.create({moduleFactory:() => factory({wasmBinary:processorOptions.wasmBinary}),
      clock:HUC6280_CLOCK, outputSampleRate:sampleRate, masterVolume:1}).then(core => {
      if (this.dead) {core.dispose(); return;}
      try {this.instrument = new Huc6280Instrument(core);}
      catch (error) {core.dispose(); throw error;}
      this.performance=createProcessorPerformance({chip:'huc6280',releasePatternNotes:true,rate:sampleRate,nowFrame:()=>this.renderedFrames,
        getHucChannel:()=>this.instrument.synth._getState().selectedChannel,patternCommandCost:huc6280TimedCommandCost,
        releaseNote:channel=>({method:'releaseTimedGate',args:[channel]}),
        apply:(command,port,frame,metadata)=>{
          if(command.method==='applyHuc6280TimedOperation')return this.timed.apply(command.operation,port,frame,metadata);
          if(command.method==='releaseTimedGate'){
            const ch=command.args[0],owner=this.instrument.gateOwners[ch];
            if(owner?.owner==='timed'){this.instrument.synth.writeRegister(0,ch);return this.instrument.applyTimedRegister(4,this.instrument.synth._getState().registers[ch][4]&127,{owner:owner.timedOwner});}
            return false;
          }
          return this.instrument.applyTimedRegister(...command.args,metadata);
        }});
      this.timed=createHuc6280TimedProcessor({performance:this.performance,
        getState:()=>this.instrument.synth._getState(),getConfig:()=>({clock:HUC6280_CLOCK,instanceId:`${this.instanceId}:${this.codeOwner?.session}`}),
        nowFrame:()=>this.renderedFrames,sampleRate,validatePlan:validateHuc6280SynthPlan,
        dispatch:(command,port,_frame,metadata)=>this.performance.applyImmediate(command,port,metadata)});
      this.port.postMessage({ready:true});
    }).catch(error => this.fail(error));
    this.commands=this.ready;
  }
  dispose() {
    if (this.dead) return;
    this.clearTimed();this.dead = true; this.instrument?.dispose(); this.instrument = null; this.acceptedDdaData = '';
    this.commandEpoch++;this.codeOwner=null;
  }
  clearTimed(){this.timed?.clear();this.performance?.clear();}
  fail(error) {
    if (this.dead) return;
    this.dispose(); this.port.postMessage({fatal:true,error:error?.message ?? String(error)});
  }
  receive(data) {
    if (data?.method === 'dispose') {this.dispose(); return;}
    if (this.dead) return;
    const validStop=data?.method==='stop'&&(data.args===undefined||Array.isArray(data.args)&&data.args.length===0);
    let stopped=false;
    if(validStop){this.clearTimed();this.commandEpoch++;this.codeOwner=null;if(this.instrument){try{this.instrument.stop();stopped=true;}catch(error){this.fail(error);return;}}}
    const epoch=this.commandEpoch;
    this.commands=this.commands.then(() => {
      if (this.dead) return;
      try {
        if (!COMMANDS.has(data?.method)) throw new Error('Unknown HuC6280 Synth command');
        if (data.args !== undefined && !Array.isArray(data.args)) throw new TypeError('HuC6280 command arguments must be an array');
        if(data.method==='stop'&&!validStop)throw TypeError('HuC6280 Stop takes no arguments');
        if(!['read','observeCode','observeEditor','setChannelMuteMask','stop'].includes(data.method)&&epoch!==this.commandEpoch)throw cancelled();
        let args = data.args ?? [];
        if (data.ddaDataUnchanged !== undefined) {
          if (data.ddaDataUnchanged !== true || !['setPreset','loadPreset'].includes(data.method) ||
              !args[0]?.dda || Object.hasOwn(args[0].dda, 'data')) throw new TypeError('Invalid cached DDA data reference');
          args = [{...args[0], dda:{...args[0].dda, data:this.acceptedDdaData}}, ...args.slice(1)];
        }
        let value;
        if(data.method==='beginCode'){
          if(args.length)throw TypeError('HuC6280 Code begin takes no arguments');
          this.clearTimed();
          const metadata=this.instrument.beginCode(),owner=this.codeOwner={session:++this.codeSerial,token:metadata.session};
          value={...metadata,session:owner.session,instanceId:`${this.instanceId}:${owner.session}`};
        }else if(data.method==='timed'){
          if(args.length!==2||!this.codeOwner||this.codeOwner.session!==args[0])throw cancelled();
          this.timed.receive({id:data.id,method:'huc6280Timed',args:[args[1]]},this.port);return;
        }else if(['code','applyCodePreset','applyCodeEdit'].includes(data.method)){
          const owner=this.codeOwner;
          if(!owner||owner.session!==args[0])throw cancelled();
          if(data.method==='code')value=this.instrument.code(owner.token,args[1],args[2]);
          else value=this.instrument[data.method](owner.token,...args.slice(1));
          if(data.method==='code'&&['dispose','reset','initialize'].includes(args[1]))this.clearTimed();
          if(data.method==='code'&&args[1]==='dispose')this.codeOwner=null;
        }else{
          value=data.method==='stop'&&stopped?this.instrument.read():this.instrument[data.method](...args);
          if(['setPreset','loadPreset'].includes(data.method)){this.clearTimed();this.codeOwner=null;}
        }
        const pcm = value?.preset?.dda?.data;
        if (typeof pcm === 'string') this.acceptedDdaData = pcm;
        // Metering, notes and small parameter edits never clone PCM back to UI.
        if (typeof pcm === 'string' && pcm.length) {
          const {data:_data, ...dda} = value.preset.dda;
          value = {...value, preset:{...value.preset, dda}};
          if (data.id !== undefined) this.port.postMessage({id:data.id,value,ddaDataOmitted:true});
        } else if (data.id !== undefined) this.port.postMessage({id:data.id,value});
      } catch (error) {
        if (data?.id !== undefined) this.port.postMessage({id:data.id,error:error.message,name:error.name});
      }
    }).catch(error => this.fail(error));
  }
  process(_inputs, outputs) {
    if (this.dead) return false;
    const [left,right] = outputs[0] ?? [];
    if (!left) return true;
    if (!this.instrument) {left.fill(0); right?.fill(0);this.renderedFrames+=left.length;return true;}
    try {
      this.performance.render(left,right??new Float32Array(left.length),this.renderSegment);
      this.renderedFrames+=left.length;
    } catch (error) {
      left.fill(0); right?.fill(0); this.fail(error); return false;
    }
    return true;
  }
  renderSegment(left,right){const pcm=this.instrument.generateStereo(left.length);left.set(pcm.left);right.set(pcm.right);}
}
registerProcessor('tetorica-huc6280-synth', Huc6280SynthProcessor);

// SPDX-License-Identifier: BSD-3-Clause
import {SidCore} from '../js/sid.js';
import {Sid8580Core} from '../js/sid8580.js';
import {SidInstrument} from './instrument.js?sid-channels=3&sid-waves=1&sid-keys=1&sid-code-live=1&sid-live-preset=1&sid-code-keyboard=1&sid-timed=1';
import {readPreset} from './preset.js?sid-waves=1';
import {readChannelSettings,applyChannelPreset,editChannelPreset} from './channel_settings.js?sid-channels=3&sid-waves=1&sid-keys=1';
import {createProcessorPerformance} from '../js/playground_performance_processor.js?v=sid-timed-1';
import {createSidTimedProcessor,sidTimedCommandCost} from '../js/sid_timed_processor.js?v=sid-timed-1';

const COMMANDS = new Set(['read', 'observeCode', 'setPreset', 'loadPreset', 'setChannelSettings', 'loadChannelSettings', 'noteOn', 'noteOff', 'releaseKeyboard', 'editCodeVoice', 'setPitch', 'stop', 'beginCode', 'code', 'codeTimed']);
const cancelled=message=>{const error=new Error(message);error.name='AbortError';return error;};

class SidSynthProcessor extends AudioWorkletProcessor {
  constructor({processorOptions = {}} = {}) {
    super(); this.dead = false; this.instrument = null; this.modelEpoch = 0;this.codeSerial=0;this.codeOwner=null;
    this.timedFrame=0;this.timedIdentity=`sid-synth:${Math.random().toString(36).slice(2)}`;this.writeMetadata=null;
    this.performance=createProcessorPerformance({chip:'sid',rate:sampleRate,nowFrame:()=>this.timedFrame,
      trackImmediateNotes:false,patternCommandCost:sidTimedCommandCost,
      onDiscard:(command,metadata)=>this.timed?.discard(command,metadata),
      validate:command=>{if(command.method!=='applySidTimedOperation'&&!['writeRegister','keyOff'].includes(command.method))throw TypeError('Unsupported SID timed command');},
      apply:(command,port,frame,metadata)=>command.method==='applySidTimedOperation'
        ?this.timed.apply(command,port,frame,metadata):this.dispatchTimed(command,port,frame,metadata)});
    this.binaries = {'6581':processorOptions.wasmBinary,'8580':processorOptions.wasm8580Binary};
    this.port.onmessage = ({data}) => this.receive(data);
    this.ready = this.createInstrument(processorOptions.model ?? '6581').then(instrument => {
      if (this.dead) { instrument.dispose(); return; }
      this.instrument = instrument;
      this.timed=createSidTimedProcessor({performance:this.performance,
        getState:()=>this.instrument.synth._getState(),
        getConfig:()=>({clock:this.instrument.synth.clock,model:this.instrument.core.model,instanceId:`${this.timedIdentity}:${this.codeOwner?.session??0}`}),
        dispatch:(command,port,frame,metadata)=>this.dispatchTimed(command,port,frame,metadata),
        nowFrame:this.performance.nowFrame,sampleRate});
      this.observeInstrument(instrument);
      this.port.postMessage({ready: true});
    }).catch(error => this.fail(error));
    this.commands = this.ready;
  }
  observeInstrument(instrument){
    instrument.onRegisterWrite=(register,value,metadata)=>this.timed?.observeWrite(register,value,this.writeMetadata??metadata,this.port);
  }
  dispatchTimed(command,_port,_frame,metadata){
    const owner=this.codeOwner;
    if(!owner||!this.instrument?.codeActive||owner.instrument!==this.instrument)return false;
    const previous=this.writeMetadata;this.writeMetadata=metadata;
    try{return command.method==='writeRegister'?this.instrument.timedWrite(command,metadata):this.instrument.code(owner.token,command.method,command.args);}
    finally{this.writeMetadata=previous;}
  }
  clearTimed(){
    let failure;
    try{this.timed?.clear();}catch(error){failure=error;}
    finally{try{this.performance.clear();}catch(error){failure??=error;}}
    if(failure)throw failure;
  }
  async createInstrument(model,preset,channels=false) {
    if(!['6581','8580'].includes(model))throw new RangeError('SID model must be 6581 or 8580');
    const binary=this.binaries[model];if(!binary)throw new Error(`SID ${model} WASM is unavailable`);
    const Core=model==='8580'?Sid8580Core:SidCore;
    const core=await Core.create({sampleRate,clockHz:985248,wasmBinary:binary});
    let instrument;
    try{
      instrument=new SidInstrument(core);
      if(preset)instrument[channels?'loadChannelSettings':'loadPreset'](preset);
      return instrument;
    }catch(error){if(instrument)instrument.dispose();else core.dispose();throw error;}
  }
  async applyPreset(method,value,epoch) {
    const channels=method==='setChannelSettings'||method==='loadChannelSettings';
    const preset=channels?readChannelSettings(value):readPreset(value),previous=this.instrument;
    const model=channels?preset.channels[0].model:preset.model;
    if(model===previous.preset.model)return previous[method](preset);
    // A legacy single-voice edit still targets the selected channel. Retain
    // its other stored patches and allocation mode when changing the model.
    const replacement=channels?preset:previous.channelSettings
      ?(method==='setPreset'?editChannelPreset:applyChannelPreset)(previous.channelSettings,preset):preset;
    const channelReplacement=channels||Boolean(previous.channelSettings);
    // A requested model change is a hard note/Pitch reset. Keep the old patch
    // available if allocation fails, but do not leave its old Gate sounding.
    const owner=this.codeOwner,keepCode=Boolean(previous.codeActive&&owner?.instrument===previous);
    if(!keepCode)previous.stop();
    let candidate;
    try{
      candidate=await this.createInstrument(model,replacement,channelReplacement);
      if(this.dead||epoch!==this.modelEpoch)throw cancelled('SID model change cancelled');
      if(keepCode){
        if(this.codeOwner!==owner)throw cancelled('SID Code model change cancelled');
        // A successful model replacement retires old reservations. Candidate
        // allocation failure leaves the old model and its performance intact.
        this.clearTimed();
        const metadata=candidate.adoptCode(previous);owner.instrument=candidate;owner.token=metadata.session;
      }
      this.instrument=candidate;this.observeInstrument(candidate);candidate=null;previous.onRegisterWrite=null;previous.dispose();
      return this.instrument.read();
    }finally{candidate?.dispose();}
  }
  dispose() {
    if (this.dead) return;
    this.dead = true; this.modelEpoch++;
    const instrument=this.instrument;this.codeOwner=null;this.instrument=null;this.writeMetadata=null;
    try{this.clearTimed();}catch{}
    try{instrument?.dispose();}catch{try{instrument?.core.dispose();}catch{}}
  }
  fail(error) {
    if (this.dead) return;
    this.dispose();try{this.port.postMessage({fatal: true, error: error?.message ?? String(error)});}catch{}
  }
  receive(data) {
    if (data?.method === 'dispose') { this.dispose(); return; }
    if (this.dead) return;
    const validStop=data?.method==='stop'&&(data.args===undefined||Array.isArray(data.args)&&data.args.length===0);
    let stopped=false;
    if(validStop){this.modelEpoch++;try{this.clearTimed();this.codeOwner=null;if(this.instrument){this.instrument.stop();stopped=true;}}catch(error){this.codeOwner=null;this.fail(error);return;}}
    const epoch=this.modelEpoch;
    // A later mutation never overtakes an earlier load/edit or its ACK. The
    // same ordering also applies to commands received while WASM is loading.
    this.commands = this.commands.then(async () => {
      if (this.dead) return;
      try {
        if (!COMMANDS.has(data?.method)) throw new Error('Unknown SID Synth command');
        if (data.args !== undefined && !Array.isArray(data.args)) throw new TypeError('SID command arguments must be an array');
        if(data.method==='stop'&&!validStop)throw new TypeError('SID Stop takes no arguments');
        if(!['read','stop'].includes(data.method)&&epoch!==this.modelEpoch)throw cancelled('SID command cancelled by Stop');
        const args=data.args??[];
        let value;
        if(data.method==='beginCode'){
          if(args.length)throw new TypeError('SID Code begin takes no arguments');
          this.clearTimed();
          const metadata=this.instrument.beginCode();
          const owner=this.codeOwner={session:++this.codeSerial,instrument:this.instrument,token:metadata.session};
          value={...metadata,session:owner.session,sampleRate,instanceId:`${this.timedIdentity}:${owner.session}`};
        }else if(data.method==='codeTimed'){
          const owner=this.codeOwner;
          if(args.length!==2||!owner||owner.session!==args[0]||owner.instrument!==this.instrument||!this.instrument.codeActive)throw cancelled('SID Code session cancelled');
          value=this.timed.invoke(args[1],undefined,this.port);
        }else if(data.method==='code'||data.method==='editCodeVoice'){
          if(data.method==='editCodeVoice'&&args.length!==3)throw new TypeError('SID Code edit requires session, channel and fields');
          const [session,method,parameters]=args,owner=this.codeOwner;
          if(!owner||owner.session!==session||owner.instrument!==this.instrument)throw cancelled('SID Code session cancelled');
          if(data.method==='code'&&['initialize','reset'].includes(method)){
            if(!Array.isArray(parameters)||parameters.length)throw TypeError('SID Code reset takes no arguments');
            this.clearTimed();
          }
          value=await (data.method==='editCodeVoice'?this.instrument.editCodeVoice(owner.token,method,parameters):this.instrument.code(owner.token,method,parameters));
        }else value=data.method==='stop'&&stopped?this.instrument.read():await (['setPreset','loadPreset','setChannelSettings','loadChannelSettings'].includes(data.method)
          ?this.applyPreset(data.method,args[0],epoch):this.instrument[data.method](...args));
        if (!this.dead && data.id !== undefined) this.port.postMessage({id: data.id, value});
      } catch (error) {
        if (!this.dead && data?.id !== undefined) this.port.postMessage({id: data.id, error: error.message, name: error.name});
      }
    }).catch(error => this.fail(error));
  }
  process(_inputs, outputs) {
    const [left, right] = outputs[0] ?? [];
    if (this.dead) { left?.fill(0); right?.fill(0); return false; }
    if (!left) return true;
    if (!this.instrument) { left.fill(0); right?.fill(0); return true; }
    try {
      this.performance.render(left,right??new Float32Array(left.length),(l,r)=>{this.instrument.renderInto(l);r.set(l);});
      this.timedFrame+=left.length;return true;
    }
    catch (error) { left.fill(0); right?.fill(0); this.fail(error); return false; }
  }
}
registerProcessor('tetorica-sid-synth', SidSynthProcessor);

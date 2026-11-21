import {createPerformanceQueue} from '../js/playground_performance_queue.js';
import {createNesTimedProcessor} from '../js/nes_timed_processor.js';
// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 kyorohiro.
import factory from '../generated/nesapu_wasm.js';
import {NesApuWasm} from '../js/nesapu_wasm.js';
import {NesInstrument} from './instrument.js';
import {OutputClickGuard} from './click_guard.js';

const COMMANDS = new Set(['read', 'setPreset', 'loadPreset', 'noteOn', 'noteOff', 'setPitch', 'stop', 'releaseKeyboard', 'applyPhysicalPreset', 'beginCode', 'code', 'endCode', 'setClickGuard']);
const guardedSource = source => source === 'fds' || source === 'dmc';

class NesSynthProcessor extends AudioWorkletProcessor {
  constructor({processorOptions = {}} = {}) {
    super();
    this.dead = false;
    this.instrument = null;
    this.renderFrame=0;this.instanceId='nes-synth:'+Math.random().toString(36).slice(2);
    this.performanceQueue=createPerformanceQueue({nowFrame:()=>this.renderFrame,sampleRate,
      patternCommandCost:c=>c.method==='applyTimedOperation'?c.writeCost:1,
      apply:(data,reply,frame,metadata)=>this.timed.apply(data.operation,{postMessage:reply??(message=>this.port.postMessage(message))},frame,metadata),
      onCancelOwner:owner=>{if(!this.instrument)return;const before=this.instrument.owners.slice();this.instrument.cancelTimedOwner(owner);this.ownedTransition(before);}});
    this.timed=createNesTimedProcessor({performance:{...this.performanceQueue,receive:(data,port)=>this.performanceQueue.receive(data,message=>port.postMessage(message))},
      getState:()=>{const state=this.instrument.core.getState();return {...this.instrument.synth._getState(),registers:state.registers,enabled:(state.registers[0x15]&15)|(state.dmcRemaining>0?16:0),sample:this.instrument.synth._getState().sample??this.instrument.dmcTimedSelection};},getConfig:()=>({instanceId:this.instanceId,clock:this.instrument.synth.clock,engine:'nes-wasm',fds:true}),
      dispatch:(data,port,frame,metadata)=>{const before=this.instrument.owners.slice();this.instrument.applyTimedWrite(data.args[0],data.args[1],metadata.owner,metadata);this.ownedTransition(before);},nowFrame:()=>this.renderFrame,sampleRate});
    this.clickGuard = new OutputClickGuard({sampleRate});
    this.clickGuardEnabled = true;
    this.port.onmessage = ({data}) => this.receive(data);
    this.ready = NesApuWasm.create({moduleFactory:factory,
      moduleOptions:{wasmBinary:processorOptions.wasmBinary}, sampleRate, fds:true})
      .then(core => {
        if (this.dead) { core.dispose(); return; }
        try { this.instrument = new NesInstrument(core); }
        catch (error) { core.dispose(); throw error; }
        this.port.postMessage({ready:true});
      }).catch(error => this.fail(error));
    this.commands=this.ready;
  }

  dispose() {
    if (this.dead) return;
    this.performanceQueue?.clear();this.timed?.clear();
    this.dead = true;
    this.instrument?.dispose();
    this.instrument = null;
  }

  fail(error) {
    if (this.dead) return;
    this.dispose();
    this.port.postMessage({fatal:true, error:error?.message ?? String(error)});
  }

  setClickGuard(enabled) {
    if (typeof enabled !== 'boolean') throw new TypeError('Software click guard must be a boolean');
    if (enabled === this.clickGuardEnabled) return enabled;
    this.clickGuardEnabled = enabled;
    const owners=this.instrument.owners;
    if(owners?.some((owner,ch)=>owner&&ch!==4&&ch!==5))this.clickGuard.bypass();
    else if(owners?.some(Boolean))this.clickGuard.attack();
    else if (!guardedSource(this.instrument.preset?.source)) this.clickGuard.bypass();
    else if (!enabled) this.clickGuard.attack();
    else if (this.instrument.voices.size) this.clickGuard.attack();
    else this.clickGuard.release();
    return enabled;
  }

  outputTransition(method, result, previousSource) {
    if (!this.clickGuardEnabled) {
      if (method === 'noteOn') this.clickGuard.bypass();
      return;
    }
    const source = method==='noteOn'&&Number.isInteger(result?.channel)?result.channel===5?'fds':result.channel===4?'dmc':'pulse':this.instrument.preset?.source;
    if (method === 'noteOn') {
      if (guardedSource(source)) this.clickGuard.attack();
      else this.clickGuard.bypass();
    } else if (method === 'noteOff' && result && guardedSource(source)) this.clickGuard.release();
    else if (['stop', 'loadPreset', 'setPreset'].includes(method)
      && (guardedSource(source) || guardedSource(previousSource)) && !this.instrument.voices.size) this.clickGuard.release();
  }

  ownedTransition(previous) {
    const owners=this.instrument.owners,hasOther=owners.some((owner,ch)=>owner&&ch!==4&&ch!==5);
    if(!this.clickGuardEnabled||hasOther){this.clickGuard.bypass();return;}
    const guarded=owners[4]||owners[5];
    if(guarded&&owners.some((owner,ch)=>owner&&owner!==previous[ch]))this.clickGuard.attack();
    else if(!guarded&&(previous[4]||previous[5]))this.clickGuard.release();
  }

  receive(data) {
    if (data?.method === 'dispose') { this.dispose(); return; }
    if (this.dead) return;
    // AudioWorklet messages are handled serially. Each queued callback runs
    // after initialization, preserving command order without polling the chip.
    this.commands=this.commands.then(async () => {
      if (this.dead) return;
      try {
        if(data?.method==='nesTimed'){
          const [session,payload]=data.args??[];
          if(!this.instrument.codeActive||session!==this.instrument.codeSession)throw new Error('NES Code session expired');
          this.timed.receive({...data,args:[payload]},{postMessage:message=>this.port.postMessage(message)});return;
        }
        if (!COMMANDS.has(data?.method)) throw new Error('Unknown 2A03 Synth command');
        if (data.args !== undefined && !Array.isArray(data.args)) throw new TypeError('NES + FDS command arguments must be an array');
        const args = data.args ?? [];
        if (data.method === 'setClickGuard' && args.length !== 1) throw new TypeError('Expected one click guard setting');
        const previousSource = this.instrument.preset?.source;
        const previousOwners=this.instrument.owners?.slice();
        let value = data.method === 'setClickGuard' ? this.setClickGuard(args[0]) : this.instrument[data.method](...args);
        // Public DMC upload has an acknowledgement Promise. Complete it before
        // a following trigger/reset/session close may touch the same sample.
        if(value&&typeof value.then==='function')value=await value;
        if((['beginCode','stop','loadPreset'].includes(data.method)||data.method==='endCode'&&value!==false||data.method==='code'&&['reset','resetRegisters','allNotesOff'].includes(args[1]))){this.performanceQueue.clear();this.timed.clear();}
        // Only successful commands change the output bridge. In particular,
        // a stale noteOff(false) cannot fade a replacement voice.
        if(data.method!=='read'&&data.method!=='setClickGuard') {
          if(previousOwners)this.ownedTransition(previousOwners);
          else this.outputTransition(data.method,value,previousSource);
        }
        if (data.method === 'read') value = {...value, outputClickGuard:{enabled:this.clickGuardEnabled, ...this.clickGuard.read()}};
        if (data.id !== undefined) this.port.postMessage({id:data.id, value});
      } catch (error) {
        if (data?.id !== undefined) this.port.postMessage({id:data.id, error:error.message, name:error.name});
      }
    }).catch(error => this.fail(error));
  }

  process(_inputs, outputs) {
    if (this.dead) return false;
    const [left, right] = outputs[0] ?? [];
    if (!left) return true;
    if (!this.instrument) { left.fill(0); right?.fill(0); return true; }
    try {
      let offset=0;
      const start=this.renderFrame;
      while(offset<left.length){
        this.performanceQueue.advance(start+offset);
        const count=Math.min(left.length-offset,Math.max(1,this.performanceQueue.nextFrame()-start-offset));
        const pcm=this.instrument.generateStereo(count);this.clickGuard.process(pcm);
        left.set(pcm.left,offset);right?.set(pcm.right,offset);offset+=count;
      }
      this.renderFrame+=left.length;
    } catch (error) {
      left.fill(0); right?.fill(0); this.fail(error); return false;
    }
    return true;
  }
}

registerProcessor('tetorica-nes-fds-synth', NesSynthProcessor);

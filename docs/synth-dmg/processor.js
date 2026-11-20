// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 kyorohiro.
import factory from '../generated/gameboy_apu_wasm.js';
import {GameboyApu} from '../js/gameboyapu.js';
import {GameboyInstrument} from './instrument.js?v=dmg-timed-1';
import {createProcessorPerformance} from '../js/playground_performance_processor.js';
import {createGameboyTimedProcessor,gameboyTimedCommandCost} from '../js/gameboy_timed_processor.js';

const COMMANDS = new Set(['read', 'observeCode', 'observeEditor', 'setPreset', 'loadPreset', 'loadChannelBank', 'applyChannelEdit', 'applyCodePreset', 'applyCodeEdit', 'releaseKeyboard', 'noteOn', 'noteOff', 'setPitch', 'stop', 'beginCode', 'code', 'codeTimed']);
const cancelled = () => {const error = new Error('Game Boy command cancelled by Stop or a newer Code session');error.name='AbortError';return error;};

class GameboySynthProcessor extends AudioWorkletProcessor {
  constructor({processorOptions = {}} = {}) {
    super();
    this.dead = false;
    this.instrument = null;
    this.commandEpoch = 0; this.codeSerial = 0; this.codeOwner = null;
    this.timedFrame=0;this.timedIdentity=`dmg-synth:${Math.random().toString(36).slice(2)}`;
    this.writeMetadata=null;
    this.performance=createProcessorPerformance({chip:'gameboy',rate:sampleRate,nowFrame:()=>this.timedFrame,
      trackImmediateNotes:false,patternCommandCost:gameboyTimedCommandCost,
      onDiscard:(command,metadata)=>this.timed?.discard(command,metadata),
      validate:command=>{if(command.method!=='applyGameboyTimedOperation'&&!['writeRegister','keyOff'].includes(command.method))throw TypeError('Unsupported DMG timed command');},
      apply:(command,port,frame,metadata)=>command.method==='applyGameboyTimedOperation'
        ?this.timed.apply(command,port,frame,metadata):this.dispatchTimed(command,port,frame,metadata)});
    this.port.onmessage = ({data}) => this.receive(data);
    this.ready = GameboyApu.create({moduleFactory:factory,
      moduleOptions:{wasmBinary:processorOptions.wasmBinary}, sampleRate})
      .then(core => {
        if (this.dead) { core.dispose(); return; }
        try {
          this.instrument = new GameboyInstrument(core);
          this.timed=createGameboyTimedProcessor({performance:this.performance,
            getState:()=>this.instrument.synth._getState(),
            getConfig:()=>({clock:this.instrument.synth.clock,instanceId:`${this.timedIdentity}:${this.codeOwner?.session??0}`}),
            dispatch:(command,port,frame,metadata)=>this.dispatchTimed(command,port,frame,metadata),
            retainState:state=>this.instrument.synth._adoptState(state),nowFrame:this.performance.nowFrame,sampleRate});
          this.instrument.onRegisterWrite=(register,value)=>this.timed.observeWrite(register,value,this.writeMetadata,this.port);
        }
        catch (error) { core.dispose(); throw error; }
        this.port.postMessage({ready:true});
      }).catch(error => this.fail(error));
    this.commands = this.ready;
  }

  dispose() {
    if (this.dead) return;
    this.dead = true;
    this.commandEpoch++;
    // Retire dispatch first: a release callback during cleanup must not reach
    // an already failing native APU or retain the old borrowed Code lease.
    const instrument=this.instrument;
    this.codeOwner=null;this.instrument=null;this.writeMetadata=null;
    try {this.clearTimed();} catch {}
    try {instrument?.dispose();}
    catch {
      // Instrument disposal normally owns these resources. If a native stop
      // or checkpoint restore throws, still close the underlying WASM handle.
      try {instrument.stop();} catch {}
      try {instrument.synth.dispose();} catch {}
      try {instrument.core.dispose();} catch {}
      instrument.disposed=true;
    }
  }

  dispatchTimed(command,_port,_frame,metadata){
    const owner=this.codeOwner;
    if(!owner||!this.instrument?.codeActive||owner.instrument!==this.instrument)return false;
    const previous=this.writeMetadata;this.writeMetadata=metadata;
    try{return this.instrument.code(owner.token,command.method,command.args);}
    finally{this.writeMetadata=previous;}
  }
  clearTimed(){
    let failure;
    try {this.timed?.clear();}
    catch(error){failure=error;}
    finally {
      try {this.performance.clear();}
      catch(error){failure??=error;}
    }
    if(failure)throw failure;
  }

  fail(error) {
    if (this.dead) return;
    this.dispose();
    // A secondary teardown or closed-port error must not replace the original
    // render/Stop failure or escape the audio-thread error handler.
    try {this.port.postMessage({fatal:true, error:error?.message ?? String(error)});} catch {}
  }

  receive(data) {
    if (data?.method === 'dispose') { this.dispose(); return; }
    if (this.dead) return;
    const validStop = data?.method === 'stop' && (data.args === undefined || Array.isArray(data.args) && data.args.length === 0);
    let stopped = false;
    if (validStop) {
      this.commandEpoch++;
      try {
        this.clearTimed();this.codeOwner=null;
        if(this.instrument){this.instrument.stop();stopped=true;}
      }catch(error){this.codeOwner=null;this.fail(error);return;}
    }
    const epoch = this.commandEpoch;
    // AudioWorklet messages are handled serially. Each queued callback runs
    // after initialization, preserving command order without polling the chip.
    this.commands = this.commands.then(async () => {
      if (this.dead) return;
      try {
        if (!COMMANDS.has(data?.method)) throw new Error('Unknown DMG Synth command');
        if (data.args !== undefined && !Array.isArray(data.args)) throw new TypeError('Game Boy command arguments must be an array');
        if (data.method === 'stop' && !validStop) throw new TypeError('Game Boy Stop takes no arguments');
        if (!['read','observeCode','observeEditor','stop'].includes(data.method) && epoch !== this.commandEpoch) throw cancelled();
        const args = data.args ?? [];
        let value;
        if (data.method === 'beginCode') {
          if (args.length) throw new TypeError('Game Boy Code begin takes no arguments');
          this.clearTimed();
          const metadata = this.instrument.beginCode();
          const owner = this.codeOwner = {session:++this.codeSerial,token:metadata.session,instrument:this.instrument};
          value = {...metadata,session:owner.session,sampleRate,instanceId:`${this.timedIdentity}:${owner.session}`};
        } else if(data.method==='codeTimed'){
          const owner=this.codeOwner;
          if(args.length!==2||!owner||owner.session!==args[0]||owner.instrument!==this.instrument||!this.instrument.codeActive)throw cancelled();
          value=this.timed.invoke(args[1],undefined,this.port);
        } else if (data.method === 'code' || data.method === 'applyCodePreset' || data.method === 'applyCodeEdit') {
          const [session,method,parameters] = args, owner = this.codeOwner;
          if (!owner || owner.session !== session || owner.instrument !== this.instrument) throw cancelled();
          if (data.method === 'applyCodePreset' || data.method === 'applyCodeEdit') {
            if(data.method==='applyCodePreset'&&args.length===3){
              const options=args[2];
              if(!options||typeof options!=='object'||Array.isArray(options)||Reflect.ownKeys(options).length!==1||!Object.hasOwn(options,'replace')||typeof options.replace!=='boolean')throw new TypeError('Game Boy preset needs a boolean replacement option');
              value=await this.instrument.applyCodePreset(owner.token,method,null,options.replace);
            }else{
              if (args.length !== 2) throw new TypeError('Game Boy Code preset takes a session and preset');
              value = await this.instrument[data.method](owner.token,method);
            }
          } else {
            if(['initialize','reset','dispose'].includes(method)){
              if(!Array.isArray(parameters)||parameters.length)throw TypeError(`${method} takes no arguments`);
              this.clearTimed();
            }
            value = await this.instrument.code(owner.token,method,parameters);
          }
          if (epoch !== this.commandEpoch || this.codeOwner !== owner) throw cancelled();
          if (data.method === 'code' && method === 'dispose') this.codeOwner = null;
        } else {
          value = data.method === 'stop' && stopped ? this.instrument.read() : await this.instrument[data.method](...args);
          if (data.method === 'setPreset' || data.method === 'loadPreset') {this.clearTimed();this.codeOwner = null;}
        }
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
      this.performance.render(left,right??new Float32Array(left.length),(l,r)=>{
        const pcm=this.instrument.generateStereo(l.length);l.set(pcm.left);r.set(pcm.right);
      });
      this.timedFrame+=left.length;
    } catch (error) {
      left.fill(0); right?.fill(0); this.fail(error); return false;
    }
    return true;
  }
}

registerProcessor('tetorica-gameboy-synth', GameboySynthProcessor);

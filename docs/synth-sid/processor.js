// SPDX-License-Identifier: BSD-3-Clause
import {SidCore} from '../js/sid.js';
import {Sid8580Core} from '../js/sid8580.js';
import {SidInstrument} from './instrument.js';
import {readPreset} from './preset.js';

const COMMANDS = new Set(['read', 'setPreset', 'loadPreset', 'noteOn', 'noteOff', 'setPitch', 'stop']);
const cancelled=message=>{const error=new Error(message);error.name='AbortError';return error;};

class SidSynthProcessor extends AudioWorkletProcessor {
  constructor({processorOptions = {}} = {}) {
    super(); this.dead = false; this.instrument = null; this.modelEpoch = 0;
    this.binaries = {'6581':processorOptions.wasmBinary,'8580':processorOptions.wasm8580Binary};
    this.port.onmessage = ({data}) => this.receive(data);
    this.ready = this.createInstrument(processorOptions.model ?? '6581').then(instrument => {
      if (this.dead) { instrument.dispose(); return; }
      this.instrument = instrument;
      this.port.postMessage({ready: true});
    }).catch(error => this.fail(error));
    this.commands = this.ready;
  }
  async createInstrument(model,preset) {
    if(!['6581','8580'].includes(model))throw new RangeError('SID model must be 6581 or 8580');
    const binary=this.binaries[model];if(!binary)throw new Error(`SID ${model} WASM is unavailable`);
    const Core=model==='8580'?Sid8580Core:SidCore;
    const core=await Core.create({sampleRate,clockHz:985248,wasmBinary:binary});
    let instrument;
    try{
      instrument=new SidInstrument(core);
      if(preset)instrument.loadPreset(preset);
      return instrument;
    }catch(error){if(instrument)instrument.dispose();else core.dispose();throw error;}
  }
  async applyPreset(method,value,epoch) {
    const preset=readPreset(value),previous=this.instrument;
    if(preset.model===previous.preset.model)return previous[method](preset);
    // A requested model change is a hard note/Pitch reset. Keep the old patch
    // available if allocation fails, but do not leave its old Gate sounding.
    previous.stop();
    let candidate;
    try{
      candidate=await this.createInstrument(preset.model,preset);
      if(this.dead||epoch!==this.modelEpoch)throw cancelled('SID model change cancelled');
      this.instrument=candidate;candidate=null;previous.dispose();
      return this.instrument.read();
    }finally{candidate?.dispose();}
  }
  dispose() {
    if (this.dead) return;
    this.dead = true; this.modelEpoch++;this.instrument?.dispose(); this.instrument = null;
  }
  fail(error) {
    if (this.dead) return;
    this.dispose(); this.port.postMessage({fatal: true, error: error?.message ?? String(error)});
  }
  receive(data) {
    if (data?.method === 'dispose') { this.dispose(); return; }
    if (this.dead) return;
    const validStop=data?.method==='stop'&&(data.args===undefined||Array.isArray(data.args)&&data.args.length===0);
    if(validStop){this.modelEpoch++;this.instrument?.stop();}
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
        const value = await (['setPreset','loadPreset'].includes(data.method)
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
    try { this.instrument.renderInto(left); right?.set(left); return true; }
    catch (error) { left.fill(0); right?.fill(0); this.fail(error); return false; }
  }
}
registerProcessor('tetorica-sid-synth', SidSynthProcessor);

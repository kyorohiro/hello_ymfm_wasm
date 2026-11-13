// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 kyorohiro.
import factory from '../generated/huc6280_wasm.js';
import {Huc6280AudioEngine} from '../js/huc6280audioengine.js';
import {HUC6280_CLOCK} from '../js/huc6280synth.js';
import {Huc6280Instrument} from './instrument.js?v=huc-code-1';

const COMMANDS = new Set(['read','observeCode','setPreset','loadPreset','noteOn','noteOff','setPitch','stop','releaseKeyboard','beginCode','code','applyCodePreset','applyCodeEdit']);
const cancelled=()=>{const error=new Error('HuC6280 command cancelled by Stop or a newer Code session');error.name='AbortError';return error;};

class Huc6280SynthProcessor extends AudioWorkletProcessor {
  constructor({processorOptions = {}} = {}) {
    super(); this.dead = false; this.instrument = null; this.acceptedDdaData = '';
    this.commandEpoch=0;this.codeSerial=0;this.codeOwner=null;
    this.port.onmessage = ({data}) => this.receive(data);
    this.ready = Huc6280AudioEngine.create({moduleFactory:() => factory({wasmBinary:processorOptions.wasmBinary}),
      clock:HUC6280_CLOCK, outputSampleRate:sampleRate, masterVolume:1}).then(core => {
      if (this.dead) {core.dispose(); return;}
      try {this.instrument = new Huc6280Instrument(core);}
      catch (error) {core.dispose(); throw error;}
      this.port.postMessage({ready:true});
    }).catch(error => this.fail(error));
    this.commands=this.ready;
  }
  dispose() {
    if (this.dead) return;
    this.dead = true; this.instrument?.dispose(); this.instrument = null; this.acceptedDdaData = '';
    this.commandEpoch++;this.codeOwner=null;
  }
  fail(error) {
    if (this.dead) return;
    this.dispose(); this.port.postMessage({fatal:true,error:error?.message ?? String(error)});
  }
  receive(data) {
    if (data?.method === 'dispose') {this.dispose(); return;}
    if (this.dead) return;
    const validStop=data?.method==='stop'&&(data.args===undefined||Array.isArray(data.args)&&data.args.length===0);
    let stopped=false;
    if(validStop){this.commandEpoch++;this.codeOwner=null;if(this.instrument){try{this.instrument.stop();stopped=true;}catch(error){this.fail(error);return;}}}
    const epoch=this.commandEpoch;
    this.commands=this.commands.then(() => {
      if (this.dead) return;
      try {
        if (!COMMANDS.has(data?.method)) throw new Error('Unknown HuC6280 Synth command');
        if (data.args !== undefined && !Array.isArray(data.args)) throw new TypeError('HuC6280 command arguments must be an array');
        if(data.method==='stop'&&!validStop)throw TypeError('HuC6280 Stop takes no arguments');
        if(!['read','observeCode','stop'].includes(data.method)&&epoch!==this.commandEpoch)throw cancelled();
        let args = data.args ?? [];
        if (data.ddaDataUnchanged !== undefined) {
          if (data.ddaDataUnchanged !== true || !['setPreset','loadPreset'].includes(data.method) ||
              !args[0]?.dda || Object.hasOwn(args[0].dda, 'data')) throw new TypeError('Invalid cached DDA data reference');
          args = [{...args[0], dda:{...args[0].dda, data:this.acceptedDdaData}}, ...args.slice(1)];
        }
        let value;
        if(data.method==='beginCode'){
          if(args.length)throw TypeError('HuC6280 Code begin takes no arguments');
          const metadata=this.instrument.beginCode(),owner=this.codeOwner={session:++this.codeSerial,token:metadata.session};
          value={...metadata,session:owner.session};
        }else if(['code','applyCodePreset','applyCodeEdit'].includes(data.method)){
          const owner=this.codeOwner;
          if(!owner||owner.session!==args[0])throw cancelled();
          if(data.method==='code')value=this.instrument.code(owner.token,args[1],args[2]);
          else value=this.instrument[data.method](owner.token,...args.slice(1));
          if(data.method==='code'&&args[1]==='dispose')this.codeOwner=null;
        }else{
          value=data.method==='stop'&&stopped?this.instrument.read():this.instrument[data.method](...args);
          if(['setPreset','loadPreset'].includes(data.method))this.codeOwner=null;
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
    if (!this.instrument) {left.fill(0); right?.fill(0); return true;}
    try {
      const pcm = this.instrument.generateStereo(left.length); left.set(pcm.left); right?.set(pcm.right);
    } catch (error) {
      left.fill(0); right?.fill(0); this.fail(error); return false;
    }
    return true;
  }
}
registerProcessor('tetorica-huc6280-synth', Huc6280SynthProcessor);

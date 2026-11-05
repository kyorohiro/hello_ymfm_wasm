// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 kyorohiro.
import factory from '../generated/huc6280_wasm.js';
import {Huc6280AudioEngine} from '../js/huc6280audioengine.js';
import {HUC6280_CLOCK} from '../js/huc6280synth.js';
import {Huc6280Instrument} from './instrument.js';

const COMMANDS = new Set(['read','setPreset','loadPreset','noteOn','noteOff','setPitch','stop']);

class Huc6280SynthProcessor extends AudioWorkletProcessor {
  constructor({processorOptions = {}} = {}) {
    super(); this.dead = false; this.instrument = null; this.acceptedDdaData = '';
    this.port.onmessage = ({data}) => this.receive(data);
    this.ready = Huc6280AudioEngine.create({moduleFactory:() => factory({wasmBinary:processorOptions.wasmBinary}),
      clock:HUC6280_CLOCK, outputSampleRate:sampleRate, masterVolume:1}).then(core => {
      if (this.dead) {core.dispose(); return;}
      try {this.instrument = new Huc6280Instrument(core);}
      catch (error) {core.dispose(); throw error;}
      this.port.postMessage({ready:true});
    }).catch(error => this.fail(error));
  }
  dispose() {
    if (this.dead) return;
    this.dead = true; this.instrument?.dispose(); this.instrument = null; this.acceptedDdaData = '';
  }
  fail(error) {
    if (this.dead) return;
    this.dispose(); this.port.postMessage({fatal:true,error:error?.message ?? String(error)});
  }
  receive(data) {
    if (data?.method === 'dispose') {this.dispose(); return;}
    if (this.dead) return;
    void this.ready.then(() => {
      if (this.dead) return;
      try {
        if (!COMMANDS.has(data?.method)) throw new Error('Unknown HuC6280 Synth command');
        if (data.args !== undefined && !Array.isArray(data.args)) throw new TypeError('HuC6280 command arguments must be an array');
        let args = data.args ?? [];
        if (data.ddaDataUnchanged !== undefined) {
          if (data.ddaDataUnchanged !== true || !['setPreset','loadPreset'].includes(data.method) ||
              !args[0]?.dda || Object.hasOwn(args[0].dda, 'data')) throw new TypeError('Invalid cached DDA data reference');
          args = [{...args[0], dda:{...args[0].dda, data:this.acceptedDdaData}}, ...args.slice(1)];
        }
        let value = this.instrument[data.method](...args);
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

// SPDX-License-Identifier: BSD-3-Clause
import {SidCore} from '../js/sid.js';
import {SidInstrument} from './instrument.js';

const COMMANDS = new Set(['read', 'setPreset', 'loadPreset', 'noteOn', 'noteOff', 'setPitch', 'stop']);

class SidSynthProcessor extends AudioWorkletProcessor {
  constructor({processorOptions = {}} = {}) {
    super(); this.dead = false; this.instrument = null;
    this.port.onmessage = ({data}) => this.receive(data);
    this.ready = SidCore.create({sampleRate, clockHz: 985248, wasmBinary: processorOptions.wasmBinary}).then(core => {
      if (this.dead) { core.dispose(); return; }
      try { this.instrument = new SidInstrument(core); } catch (error) { core.dispose(); throw error; }
      this.port.postMessage({ready: true});
    }).catch(error => this.fail(error));
    this.commands = this.ready;
  }
  dispose() {
    if (this.dead) return;
    this.dead = true; this.instrument?.dispose(); this.instrument = null;
  }
  fail(error) {
    if (this.dead) return;
    this.dispose(); this.port.postMessage({fatal: true, error: error?.message ?? String(error)});
  }
  receive(data) {
    if (data?.method === 'dispose') { this.dispose(); return; }
    if (this.dead) return;
    // A later mutation never overtakes an earlier load/edit or its ACK. The
    // same ordering also applies to commands received while WASM is loading.
    this.commands = this.commands.then(async () => {
      if (this.dead) return;
      try {
        if (!COMMANDS.has(data?.method)) throw new Error('Unknown SID Synth command');
        if (data.args !== undefined && !Array.isArray(data.args)) throw new TypeError('SID command arguments must be an array');
        const value = await this.instrument[data.method](...(data.args ?? []));
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

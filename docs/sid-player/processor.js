// SPDX-License-Identifier: BSD-3-Clause
import {SidPlayerCore} from './core.js';
import {RsidPlayerCore} from './rsid_core.js';

const COMMANDS = new Set(['load', 'start', 'stop', 'read']);
class SidPlayerProcessor extends AudioWorkletProcessor {
  constructor({processorOptions = {}} = {}) {
    super(); this.dead = false; this.core = null; this.playing = false;
    this.port.onmessage = ({data}) => this.receive(data);
    const Core = processorOptions.backend === 'rsid' || processorOptions.backend === 'psid-cia' ? RsidPlayerCore : SidPlayerCore;
    this.ready = Core.create({sampleRate, wasmBinary: processorOptions.wasmBinary}).then(core => {
      if (this.dead) {core.dispose(); return;}
      this.core = core; this.port.postMessage({ready: true});
    }).catch(error => this.fail(error));
    this.commands = this.ready;
  }
  state() {return {...this.core.getState(), playing: this.playing};}
  dispose() {if (!this.dead) {this.dead = true; this.playing = false; this.core?.dispose(); this.core = null;}}
  fail(error) {
    if (this.dead) return;
    this.dispose(); this.port.postMessage({fatal: true, error: error?.message ?? String(error)});
  }
  receive(data) {
    if (data?.method === 'dispose') {this.dispose(); return;}
    if (this.dead) return;
    this.commands = this.commands.then(() => {
      if (this.dead) return;
      try {
        if (!COMMANDS.has(data?.method)) throw new Error('Unknown SID player command');
        if (data.args !== undefined && !Array.isArray(data.args)) throw new TypeError('SID player arguments must be an array');
        const args = data.args ?? [];
        if (data.method === 'load') {this.core.load(args[0], args[1]); this.playing = false;}
        if (data.method === 'start') {
          if (!this.core.getState().playing) throw new Error('Load a SID before playing');
          this.playing = true;
        }
        if (data.method === 'stop') {this.playing = false; this.core.stop();}
        if (data.id !== undefined) this.port.postMessage({id: data.id, value: this.state()});
      } catch (error) {
        if (data?.id !== undefined) this.port.postMessage({id: data.id, error: error.message, name: error.name});
      }
    }).catch(error => this.fail(error));
  }
  process(_inputs, outputs) {
    const [left, right] = outputs[0] ?? [];
    if (this.dead) {left?.fill(0); right?.fill(0); return false;}
    if (!left) return true;
    if (!this.core || !this.playing) {left.fill(0); right?.fill(0); return true;}
    try {this.core.renderInto(left); right?.set(left); return true;}
    catch (error) {left.fill(0); right?.fill(0); this.fail(error); return false;}
  }
}
registerProcessor('tetorica-sid-player', SidPlayerProcessor);

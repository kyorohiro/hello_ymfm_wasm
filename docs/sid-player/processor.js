// SPDX-License-Identifier: BSD-3-Clause
import {SidPlayerCore} from './core.js';
import {RsidPlayerCore} from './rsid_core.js';
import {Sid8580PlayerCore} from './core8580.js';

const COMMANDS = new Set(['load', 'start', 'pause', 'resume', 'stop', 'read']);
const TRANSPORT_PROTOCOL = 2;
class SidPlayerProcessor extends AudioWorkletProcessor {
  constructor({processorOptions = {}} = {}) {
    super(); this.dead = false; this.core = null; this.playing = false; this.paused = false; this.startEpoch = 0;
    // Transport-only de-click. The chip is frozen immediately on Pause; this
    // short bridge fades the last *output* value to silence without clocking it.
    // Resume bridges that current output into the continuing chip samples.
    // First Play and every ordinary rendering block remain bit-for-bit unchanged.
    this.bridgeFrames = Math.max(2, Math.round(sampleRate * .005));
    this.bridgeRemaining = 0; this.bridgeFrom = 0; this.lastOutput = 0;
    this.port.onmessage = ({data}) => this.receive(data);
    const Core = processorOptions.backend === '8580' ? Sid8580PlayerCore
      : ['rsid', 'psid-cia', 'psid-vbi'].includes(processorOptions.backend) ? RsidPlayerCore : SidPlayerCore;
    const options = processorOptions.backend === '8580'
      ? {sampleRate, endpointBinary: processorOptions.endpointBinary, machineBinary: processorOptions.machineBinary}
      : {sampleRate, wasmBinary: processorOptions.wasmBinary};
    this.ready = Core.create(options).then(core => {
      if (this.dead) {core.dispose(); return;}
      this.core = core;
      this.port.postMessage({ready: true, transportProtocol: TRANSPORT_PROTOCOL, supportedCommands: [...COMMANDS]});
    }).catch(error => this.fail(error));
    this.commands = this.ready;
  }
  state() {return {...this.core.getState(), playing: this.playing, paused: this.paused};}
  clearBridge() {this.bridgeRemaining = 0; this.bridgeFrom = 0; this.lastOutput = 0;}
  beginBridge() {this.bridgeFrom = this.lastOutput; this.bridgeRemaining = this.bridgeFrames;}
  dispose() {if (!this.dead) {this.dead = true; this.playing = false; this.paused = false; this.clearBridge(); this.core?.dispose(); this.core = null;}}
  fail(error) {
    if (this.dead) return;
    this.dispose(); this.port.postMessage({fatal: true, error: error?.message ?? String(error)});
  }
  receive(data) {
    if (data?.method === 'dispose') {this.dispose(); return;}
    if (this.dead) return;
    // Stop must fence a Start already queued behind asynchronous WASM startup.
    // Invalid arguments still fail transactionally without muting active audio.
    if (data?.method === 'stop' && (data.args === undefined || Array.isArray(data.args))) {
      this.playing = false; this.paused = false; this.clearBridge(); this.startEpoch++;
    }
    const startEpoch = this.startEpoch;
    this.commands = this.commands.then(() => {
      if (this.dead) return;
      try {
        if (!COMMANDS.has(data?.method)) throw new Error('Unknown SID player command');
        if (data.args !== undefined && !Array.isArray(data.args)) throw new TypeError('SID player arguments must be an array');
        const args = data.args ?? [];
        if (data.method === 'load') {this.core.load(args[0], args[1]); this.playing = false; this.paused = false; this.clearBridge();}
        if (['start', 'pause', 'resume'].includes(data.method) && startEpoch !== this.startEpoch)
          throw new Error(`SID ${data.method} was cancelled`);
        if (data.method === 'start' || data.method === 'resume') {
          if (!this.core.getState().playing) throw new Error('Load a SID before playing');
          if (data.method === 'resume' && !this.playing && !this.paused) throw new Error('Pause a playing SID before resuming');
          if (this.paused) this.beginBridge();
          this.playing = true; this.paused = false;
        }
        if (data.method === 'pause') {
          if (!this.playing && !this.paused) throw new Error('Start a SID before pausing');
          if (this.playing) this.beginBridge();
          this.playing = false; this.paused = true;
        }
        if (data.method === 'stop') {this.playing = false; this.paused = false; this.clearBridge(); this.core.stop();}
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
    if (!this.core || !this.playing && !this.paused) {left.fill(0); right?.fill(0); return true;}
    try {
      if (this.playing) this.core.renderInto(left);
      else left.fill(0);
      for (let i = 0; i < left.length && this.bridgeRemaining > 0; i++, this.bridgeRemaining--) {
        const progress = (this.bridgeFrames - this.bridgeRemaining) / (this.bridgeFrames - 1);
        left[i] = this.bridgeFrom * (1 - progress) + left[i] * progress;
      }
      this.lastOutput = left[left.length - 1] ?? this.lastOutput;
      right?.set(left); return true;
    }
    catch (error) {left.fill(0); right?.fill(0); this.fail(error); return false;}
  }
}
registerProcessor('tetorica-sid-player', SidPlayerProcessor);

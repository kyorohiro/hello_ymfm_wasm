// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 kyorohiro.
import factory from '../generated/gameboy_apu_wasm.js';
import {GameboyApu} from '../js/gameboyapu.js';
import {GameboyInstrument} from './instrument.js';

const COMMANDS = new Set(['read', 'observeCode', 'setPreset', 'loadPreset', 'noteOn', 'noteOff', 'setPitch', 'stop', 'beginCode', 'code']);
const cancelled = () => {const error = new Error('Game Boy command cancelled by Stop or a newer Code session');error.name='AbortError';return error;};

class GameboySynthProcessor extends AudioWorkletProcessor {
  constructor({processorOptions = {}} = {}) {
    super();
    this.dead = false;
    this.instrument = null;
    this.commandEpoch = 0; this.codeSerial = 0; this.codeOwner = null;
    this.port.onmessage = ({data}) => this.receive(data);
    this.ready = GameboyApu.create({moduleFactory:factory,
      moduleOptions:{wasmBinary:processorOptions.wasmBinary}, sampleRate})
      .then(core => {
        if (this.dead) { core.dispose(); return; }
        try { this.instrument = new GameboyInstrument(core); }
        catch (error) { core.dispose(); throw error; }
        this.port.postMessage({ready:true});
      }).catch(error => this.fail(error));
    this.commands = this.ready;
  }

  dispose() {
    if (this.dead) return;
    this.dead = true;
    this.commandEpoch++; this.codeOwner = null;
    this.instrument?.dispose();
    this.instrument = null;
  }

  fail(error) {
    if (this.dead) return;
    this.dispose();
    this.port.postMessage({fatal:true, error:error?.message ?? String(error)});
  }

  receive(data) {
    if (data?.method === 'dispose') { this.dispose(); return; }
    if (this.dead) return;
    const validStop = data?.method === 'stop' && (data.args === undefined || Array.isArray(data.args) && data.args.length === 0);
    let stopped = false;
    if (validStop) {
      this.commandEpoch++; this.codeOwner = null;
      if (this.instrument) {
        try {this.instrument.stop();stopped=true;}
        catch (error) {this.fail(error);return;}
      }
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
        if (!['read','observeCode','stop'].includes(data.method) && epoch !== this.commandEpoch) throw cancelled();
        const args = data.args ?? [];
        let value;
        if (data.method === 'beginCode') {
          if (args.length) throw new TypeError('Game Boy Code begin takes no arguments');
          const metadata = this.instrument.beginCode();
          const owner = this.codeOwner = {session:++this.codeSerial,token:metadata.session,instrument:this.instrument};
          value = {...metadata,session:owner.session};
        } else if (data.method === 'code') {
          const [session,method,parameters] = args, owner = this.codeOwner;
          if (!owner || owner.session !== session || owner.instrument !== this.instrument) throw cancelled();
          value = await this.instrument.code(owner.token,method,parameters);
          if (epoch !== this.commandEpoch || this.codeOwner !== owner) throw cancelled();
          if (method === 'dispose') this.codeOwner = null;
        } else {
          value = data.method === 'stop' && stopped ? this.instrument.read() : await this.instrument[data.method](...args);
          if (data.method === 'setPreset' || data.method === 'loadPreset') this.codeOwner = null;
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
      const pcm = this.instrument.generateStereo(left.length);
      left.set(pcm.left); right?.set(pcm.right);
    } catch (error) {
      left.fill(0); right?.fill(0); this.fail(error); return false;
    }
    return true;
  }
}

registerProcessor('tetorica-gameboy-synth', GameboySynthProcessor);

// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 kyorohiro.
import factory from '../generated/gameboy_apu_wasm.js';
import {GameboyApu} from '../js/gameboyapu.js';
import {GameboyInstrument} from './instrument.js';

const COMMANDS = new Set(['read', 'setPreset', 'loadPreset', 'noteOn', 'noteOff', 'setPitch', 'stop']);

class GameboySynthProcessor extends AudioWorkletProcessor {
  constructor({processorOptions = {}} = {}) {
    super();
    this.dead = false;
    this.instrument = null;
    this.port.onmessage = ({data}) => this.receive(data);
    this.ready = GameboyApu.create({moduleFactory:factory,
      moduleOptions:{wasmBinary:processorOptions.wasmBinary}, sampleRate})
      .then(core => {
        if (this.dead) { core.dispose(); return; }
        try { this.instrument = new GameboyInstrument(core); }
        catch (error) { core.dispose(); throw error; }
        this.port.postMessage({ready:true});
      }).catch(error => this.fail(error));
  }

  dispose() {
    if (this.dead) return;
    this.dead = true;
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
    // AudioWorklet messages are handled serially. Each queued callback runs
    // after initialization, preserving command order without polling the chip.
    void this.ready.then(() => {
      if (this.dead) return;
      try {
        if (!COMMANDS.has(data?.method)) throw new Error('Unknown Game Boy Synth command');
        if (data.args !== undefined && !Array.isArray(data.args)) throw new TypeError('Game Boy command arguments must be an array');
        const value = this.instrument[data.method](...(data.args ?? []));
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

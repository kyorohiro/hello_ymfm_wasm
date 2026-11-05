// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 kyorohiro.
import factory from '../generated/nesapu_wasm.js';
import {NesApuWasm} from '../js/nesapu_wasm.js';
import {NesInstrument} from './instrument.js';
import {OutputClickGuard} from './click_guard.js';

const COMMANDS = new Set(['read', 'setPreset', 'loadPreset', 'noteOn', 'noteOff', 'setPitch', 'stop', 'setClickGuard']);
const guardedSource = source => source === 'fds' || source === 'dmc';

class NesSynthProcessor extends AudioWorkletProcessor {
  constructor({processorOptions = {}} = {}) {
    super();
    this.dead = false;
    this.instrument = null;
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

  setClickGuard(enabled) {
    if (typeof enabled !== 'boolean') throw new TypeError('Software click guard must be a boolean');
    if (enabled === this.clickGuardEnabled) return enabled;
    this.clickGuardEnabled = enabled;
    if (!guardedSource(this.instrument.preset?.source)) this.clickGuard.bypass();
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
    const source = this.instrument.preset?.source;
    if (method === 'noteOn') {
      if (guardedSource(source)) this.clickGuard.attack();
      else this.clickGuard.bypass();
    } else if (method === 'noteOff' && result && guardedSource(source)) this.clickGuard.release();
    else if (['stop', 'loadPreset', 'setPreset'].includes(method)
      && (guardedSource(source) || guardedSource(previousSource)) && !this.instrument.voices.size) this.clickGuard.release();
  }

  receive(data) {
    if (data?.method === 'dispose') { this.dispose(); return; }
    if (this.dead) return;
    // AudioWorklet messages are handled serially. Each queued callback runs
    // after initialization, preserving command order without polling the chip.
    void this.ready.then(() => {
      if (this.dead) return;
      try {
        if (!COMMANDS.has(data?.method)) throw new Error('Unknown 2A03 Synth command');
        if (data.args !== undefined && !Array.isArray(data.args)) throw new TypeError('NES + FDS command arguments must be an array');
        const args = data.args ?? [];
        if (data.method === 'setClickGuard' && args.length !== 1) throw new TypeError('Expected one click guard setting');
        const previousSource = this.instrument.preset?.source;
        let value = data.method === 'setClickGuard' ? this.setClickGuard(args[0]) : this.instrument[data.method](...args);
        // Only successful commands change the output bridge. In particular,
        // a stale noteOff(false) cannot fade a replacement voice.
        if (data.method !== 'read' && data.method !== 'setClickGuard') this.outputTransition(data.method, value, previousSource);
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
      const pcm = this.instrument.generateStereo(left.length);
      this.clickGuard.process(pcm);
      left.set(pcm.left); right?.set(pcm.right);
    } catch (error) {
      left.fill(0); right?.fill(0); this.fail(error); return false;
    }
    return true;
  }
}

registerProcessor('tetorica-nes-fds-synth', NesSynthProcessor);

// license:BSD-3-Clause
// copyright-holders:David Haywood
// FIFO, routing and timer behavior adapted from MAME mega32x.cpp.
// See third_party/mame-32x-pwm/README.md for provenance and differences.
/** @typedef {{clock?: number, sampleRate?: number, gain?: number, outputMode?: 'dac'|'duty', implementation?: 'wasm'|'js', moduleFactory?: import('./soundchip.js?v=mixer-presets-3').WasmModuleFactory, moduleOptions?: import('./soundchip.js?v=mixer-presets-3').WasmModuleOptions, assetBaseUrl?: string|URL, signal?: AbortSignal}} PWM32XOptions */
export const PWM32X_CLOCK = 23011361;
const outputSample = (value, scale, gain) => value === null ? 0 : ((value & 4095) / scale - 1) * gain;
export class PWM32X {
  #states = new WeakMap();
  /** Shared C++ core by default. `new PWM32X()` remains the synchronous JS reference.
   * A WASM load failure is reported; JS must be selected explicitly.
   * @param {PWM32XOptions} [options] */
  static async create(options = {}) {
    options.signal?.throwIfAborted();
    if (options.implementation === 'js') return new PWM32X(options);
    if (options.implementation !== undefined && options.implementation !== 'wasm') throw new RangeError('Invalid PWM implementation');
    const {PWM32XWasm} = await import('./pwm32x_wasm.js?v=pwm-wasm-1');
    return PWM32XWasm.create(options);
  }
  /** @param {PWM32XOptions} [options] */
  constructor({clock = PWM32X_CLOCK, sampleRate = 48000, gain = .4, outputMode = 'dac'} = {}) {
    if (!['dac', 'duty'].includes(outputMode)) throw new RangeError('Invalid PWM output mode');
    if (!Number.isFinite(clock) || clock <= 0 || clock > 100000000) throw new RangeError('Invalid PWM clock');
    if (!Number.isInteger(sampleRate) || sampleRate <= 0 || sampleRate > 1000000) throw new RangeError('Invalid PWM sample rate');
    if (!Number.isFinite(gain) || gain < 0 || gain > 4) throw new RangeError('Invalid PWM gain');
    this.backend = 'javascript'; this.clock = clock; this.rate = sampleRate; this.gain = gain; this.outputMode = outputMode; this.muted = false; this.closed = false; this.reset();
  }
  sampleRate() {return this.rate;}
  assertOpen() {if (this.closed) throw new Error('PWM chip is disposed');}
  reset() {
    this.assertOpen(); this.control = 0; this.cycle = 0; this.cycleRegister = 0;
    this.leftFifo = []; this.rightFifo = []; this.left = null; this.right = null;
    this.timerTick = 0; this.interruptCount = 0; this.untilTick = 0;
  }
  active() {return this.cycle !== 1 && (this.control & 15) !== 0;}
  configureTimer() {
    if (!this.cycle) this.cycle = 4095;
    if (this.active()) {
      this.timerTick = 0; this.leftFifo = []; this.rightFifo = [];
      this.untilTick = this.cycle - 1;
    }
  }
  /** @param {number} register @param {number} value */
  write(register, value) {this.writeRegister(register, value);}
  /** @param {number} register @param {number} value */
  writeRegister(register, value) {
    this.assertOpen();
    if (!Number.isInteger(register) || register < 0 || register > 4 || !Number.isInteger(value)) throw new RangeError('Invalid PWM register write');
    const push = fifo => {if (fifo.length === 3) fifo.shift(); fifo.push(value & 0xffff);};
    if (register === 0) {this.control = value & 0xffff; this.configureTimer();}
    else if (register === 1) {this.cycleRegister = this.cycle = value & 4095; this.configureTimer();}
    else {if (register === 2 || register === 4) push(this.leftFifo); if (register === 3 || register === 4) push(this.rightFifo);}
  }
  /** @param {number} register */
  read(register) {
    this.assertOpen();
    const flag = fifo => fifo.length === 0 ? 0x4000 : fifo.length === 3 ? 0x8000 : 0;
    if (register === 0) return this.control;
    if (register === 1) return this.cycleRegister;
    if (register === 2) return flag(this.leftFifo);
    if (register === 3) return flag(this.rightFifo);
    if (register === 4) return flag(this.leftFifo) & flag(this.rightFifo);
    return 0xffff;
  }
  tick() {
    if (this.leftFifo.length) {
      const value = this.leftFifo.shift(), mode = this.control & 3;
      if (mode === 1) this.left = value; else if (mode === 2) this.right = value;
    }
    if (this.rightFifo.length) {
      const value = this.rightFifo.shift(), mode = (this.control >> 2) & 3;
      if (mode === 1) this.right = value; else if (mode === 2) this.left = value;
    }
    this.timerTick++;
    if (this.timerTick === (((this.control >> 8) & 15) || 16)) {this.timerTick = 0; this.interruptCount++;}
  }
  output() {
    const scale = this.outputMode === 'duty' ? (this.cycle || 4095) / 2 : 2048;
    return this.muted ? [0, 0] : [outputSample(this.left, scale, this.gain), outputSample(this.right, scale, this.gain)];
  }
  /** @param {number} frames */
  generateStereo(frames) {
    this.assertOpen();
    if (!Number.isInteger(frames) || frames < 0) throw new RangeError('Invalid PWM frame count');
    const left = new Float32Array(frames), right = new Float32Array(frames), cyclesPerFrame = this.clock / this.rate;
    for (let frame = 0; frame < frames; frame++) {
      let remaining = cyclesPerFrame, l = 0, r = 0;
      while (remaining > 0) {
        const duration = this.active() ? Math.min(remaining, this.untilTick) : remaining;
        // output() returns an owned pair for callers. Keep the audio render
        // path scalar: it runs for every output frame and native timer tick,
        // including the silent PWM endpoint in Genesis Full.
        const scale = this.outputMode === 'duty' ? (this.cycle || 4095) / 2 : 2048;
        const a = this.muted ? 0 : outputSample(this.left, scale, this.gain);
        const b = this.muted ? 0 : outputSample(this.right, scale, this.gain);
        l += a * duration; r += b * duration; remaining -= duration;
        if (this.active()) {
          this.untilTick -= duration;
          if (this.untilTick <= 0) {this.tick(); this.untilTick = this.cycle - 1;}
        }
      }
      left[frame] = l / cyclesPerFrame; right[frame] = r / cyclesPerFrame;
    }
    return {left, right};
  }
  supportsState() {return !this.closed;}
  saveState() {
    this.assertOpen(); const state = Object.freeze({byteLength: 128});
    this.#states.set(state, {control:this.control, cycle:this.cycle, cycleRegister:this.cycleRegister,
      leftFifo:this.leftFifo.slice(), rightFifo:this.rightFifo.slice(), left:this.left, right:this.right,
      timerTick:this.timerTick, interruptCount:this.interruptCount, untilTick:this.untilTick});
    return state;
  }
  validateState(state) {this.assertOpen(); if (!this.#states.has(state)) throw new Error('Incompatible PWM state');}
  loadState(state) {
    this.validateState(state); const data = this.#states.get(state);
    Object.assign(this, data, {leftFifo:data.leftFifo.slice(), rightFifo:data.rightFifo.slice()});
  }
  dispose() {this.closed = true; this.leftFifo = []; this.rightFifo = [];}
}

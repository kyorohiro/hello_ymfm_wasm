/**
 * @file genesisaudioengine.js
 * 実行環境: Browser / Node.js
 * 依存: 音源チップ／WASM バックエンド（ファクトリーまたはエンジンを注入）。
 * 同期 PCM 生成・ミックス用。DOM・AudioContext・スピーカー出力は不要。
 */
import { Ym2612, YM2612_CLOCK } from "./ym2612.js";
import { SegaPSG, SEGAPSG_CLOCK } from "./segapsg.js";

import { Rf5c164 } from "./rf5c164.js";
import {PWM32X} from './pwm32x.js';

/**
 * GenesisAudioEngine adapter for synchronous stereo rendering and VGM register dispatch.
 * Output timing uses sampleRate() frames per second. No browser audio device is opened.
 * Dispose the engine when done to release its underlying chips.
 */
export class GenesisAudioEngine {
  #states = new WeakMap();

  /** @param {Ym2612} ym2612
   * @param {SegaPSG} psg
   * @param {number} sampleRate
   * @param {number} [masterVolume]
   * @param {Rf5c164 | null} [pcm] */
  constructor(ym2612, psg, sampleRate, masterVolume = 1, pcm = null, pwmOptions = {}) {
    this.ym2612 = ym2612;
    this.psg = psg;
    this.pcm = pcm;
    if (!['legacy', 'mame'].includes(pwmOptions.model ?? 'legacy')) throw new Error('Unknown PWM model');
    const outputMode = pwmOptions.outputMode ?? 'duty';
    this.pwm = pwmOptions.model === 'mame' ? new PWM32X({...pwmOptions, sampleRate, outputMode,
      gain:outputMode === 'duty' ? 1 : .4}) : new SimplePwm();
    this._pcmMuted = false;
    this._psgMuted = false;
    this._sampleRate = sampleRate;
    this._masterVolume = clampMasterVolume(masterVolume);
  }

  /**
   * Create the chip instances required by this engine.
   * @param {{ym2612ModuleFactory: import('./soundchip.js').WasmModuleFactory, ym2612ModuleOptions?: import('./soundchip.js').WasmModuleOptions, segaPsgModuleFactory: import('./soundchip.js').WasmModuleFactory, segaPsgModuleOptions?: import('./soundchip.js').WasmModuleOptions, ym2612Clock?: number, psgClock?: number, masterVolume?: number, rf5c164ModuleFactory?: import('./soundchip.js').WasmModuleFactory, rf5c164ModuleOptions?: import('./soundchip.js').WasmModuleOptions, rf5c164Clock?: number, pwmModel?: "legacy"|"mame", pwmOutputMode?: "dac"|"duty", pwmClock?: number}} [options={}] Chip factories, clocks in Hz and loader settings.
   * Output rate is derived from the YM2612 clock; sampleRate() reports the actual rate.
   * @param {number} [options.ym2612Clock=YM2612_CLOCK] YM2612 input clock in Hz.
   * @param {number} [options.masterVolume=1] Linear output gain, not dB.
   * @returns {Promise<GenesisAudioEngine>} Initialized engine owned by the caller.
   */
  static async create(options = {}) {
    if (!['legacy', 'mame'].includes(options.pwmModel ?? 'legacy')) throw new Error('Unknown PWM model');
    if (!['dac', 'duty'].includes(options.pwmOutputMode ?? 'duty')) throw new Error('Unknown PWM output mode');
    if (options.pwmModel === 'mame' && options.pwmClock !== undefined && options.pwmClock !== 0 &&
      (!Number.isFinite(options.pwmClock) || options.pwmClock <= 0 || options.pwmClock > 100000000)) throw new RangeError('Invalid PWM clock');
    const {
      ym2612ModuleFactory,
      ym2612ModuleOptions,
      segaPsgModuleFactory,
      segaPsgModuleOptions,
      ym2612Clock = YM2612_CLOCK,
      psgClock = SEGAPSG_CLOCK,
      masterVolume = 1,
      rf5c164ModuleFactory,
      rf5c164ModuleOptions,
      rf5c164Clock = 0,
    } = options;

    if (!ym2612ModuleFactory) {
      throw new Error("ym2612ModuleFactory is required");
    }
    if (!segaPsgModuleFactory) {
      throw new Error("segaPsgModuleFactory is required");
    }

    const ym2612 = await Ym2612.create({
      moduleFactory: ym2612ModuleFactory,
      moduleOptions: ym2612ModuleOptions,
    });
    const sampleRate = ym2612.sampleRate(ym2612Clock);
    const psg = await SegaPSG.create({
      moduleFactory: segaPsgModuleFactory,
      moduleOptions: segaPsgModuleOptions,
      sampleRate,
      clock: psgClock,
    });

    let pcm = null;
    try {
      if (rf5c164Clock) pcm = await Rf5c164.create({
        moduleFactory: rf5c164ModuleFactory, moduleOptions: rf5c164ModuleOptions,
        sampleRate, clock: rf5c164Clock,
      });
    } catch (error) { ym2612.dispose(); psg.dispose(); throw error; }
    return new GenesisAudioEngine(
      ym2612,
      psg,
      sampleRate,
      masterVolume,
      pcm,
      {model:options.pwmModel, clock:options.pwmClock || undefined, outputMode:options.pwmOutputMode}
    );
  }

  /**
   * Release the underlying chips and their resources. Do not render after disposal.
   * @returns {void}
   */
  dispose() {
    this.ym2612.dispose();
    this.psg.dispose();
    this.pcm?.dispose();
    this.pwm.dispose?.();
  }

  supportsState() {
    // Attaching an extra renderer requires its own state support first.
    return !this.writeOki6258 && this.ym2612.supportsState?.() && this.psg.supportsState?.() && (!this.pcm || this.pcm.supportsState?.());
  }
  stateSettingsKey() {
    return JSON.stringify([this._sampleRate, this._masterVolume, this._psgMuted, this._pcmMuted, this.pwm.muted,
      this.pwm.constructor.name, this.pwm.clock, this.pwm.gain, this.pwm.outputMode]);
  }
  /** @returns {Readonly<{byteLength:number}>} Opaque snapshot owned by this instance. */
  saveState() {
    if (!this.supportsState()) throw new Error('Genesis state saving unavailable');
    const data = {ym: this.ym2612.saveState(), psg: this.psg.saveState(), pcm: this.pcm?.saveState(),
      pwm: this.pwm.saveState(), key: this.stateSettingsKey()};
    const state = Object.freeze({byteLength: data.ym.byteLength + data.psg.byteLength + (data.pcm?.byteLength || 0) + (data.pwm.byteLength || 64)});
    this.#states.set(state, data); return state;
  }
  /** @param {Readonly<{byteLength:number}>} state Snapshot returned by this instance. */
  validateState(state) {
    const data = this.#states.get(state);
    if (!this.supportsState() || !data || data.key !== this.stateSettingsKey()) throw new Error('Incompatible Genesis state');
    this.ym2612.validateState(data.ym); this.psg.validateState(data.psg); this.pcm?.validateState(data.pcm);
    this.pwm.validateState?.(data.pwm);
  }
  /** @param {Readonly<{byteLength:number}>} state Snapshot returned by this instance. */
  loadState(state) {
    this.validateState(state);
    const data = this.#states.get(state);
    this.ym2612.loadState(data.ym); this.psg.loadState(data.psg); this.pcm?.loadState(data.pcm); this.pwm.loadState(data.pwm);
  }

  /**
   * Reset chip/playback state for a new pass. This is not pause/resume; replay setup writes afterward.
   * @returns {void}
   */
  reset() {
    this.pwm.reset();
    this.ym2612.reset();
    this.psg.reset();
    this.pcm?.reset();
    this.clearRf5c164Memory();
  }

  /**
   * Return the rate used by process() and processFrames().
   * @returns {number} Output stereo frames per second (Hz).
   */
  sampleRate() {
    return this._sampleRate;
  }

  /**
   * Set the linear master gain; validation/clamping follows this engine.
   * @param {number} volume Gain multiplier, not dB.
   */
  setMasterVolume(volume) {
    this._masterVolume =
      clampMasterVolume(volume);
    return this._masterVolume;
  }

  /**
   * Read the current linear master gain.
   * @returns {number} Gain multiplier, not a dB value.
   */
  getMasterVolume() {
    return this._masterVolume;
  }

  /**
   * Dispatch a VGM register/command write to the corresponding sound chip.
   * @param {number} port Chip register bank/port (not a MIDI channel).
   * @param {number} register Register address within the selected chip bank.
   * @param {number} value Register/command data value.
   */
  writeYm2612(port, register, value) {
    this.ym2612.writeRegister(register, value, port);
  }

  /** @param {boolean} muted */
  setPsgMuted(muted) { this._psgMuted = Boolean(muted); }

  /** @param {boolean} muted */
  setPcmMuted(muted) { this._pcmMuted = Boolean(muted); }
  clearRf5c164Memory() { this.pcm?.clearMemory(); }
  /**
   * Dispatch a VGM register/command write to the corresponding sound chip.
   * @param {number} register Register address within the selected chip bank.
   * @param {number} value Register/command data value.
   */
  writeRf5c164(register, value) { this.#requirePcm().writeRegister(register, value); }
  /**
   * Dispatch a VGM register/command write to the corresponding sound chip.
   * @param {number} offset Chip address offset.
   * @param {number} value Register/command data value.
   */
  writeRf5c164Memory(offset, value) { this.#requirePcm().writeMemory(offset, value); }
  /** @param {Uint8Array} data
   * @param {number} offset */
  loadRf5c164Memory(data, offset) { this.#requirePcm().loadBankedMemory(data, offset); }
  #requirePcm() {
    if (!this.pcm) throw new Error("RF5C164 playback requires a PCM-enabled engine");
    return this.pcm;
  }

  /**
   * Dispatch a VGM register/command write to the corresponding sound chip.
   * @param {number} value Register/command data value.
   */
  writePsg(value) {
    this.psg.write(value);
  }

  /**
   * Dispatch a VGM register/command write to the corresponding sound chip.
   * @param {number} register Register address within the selected chip bank.
   * @param {number} value Register/command data value.
   */
  writePwm(register, value) { this.pwm.writeRegister(register, value); }
  /** @param {boolean} muted */
  setPwmMuted(muted) { this.pwm.muted = Boolean(muted); }

  /**
   * Advance synthesis and fill caller-owned stereo buffers.
   * @param {Float32Array} left Left output buffer with capacity for frames samples.
   * @param {Float32Array} right Right output buffer with capacity for frames samples.
   * @param {number} frames Nonnegative integer output frame count; not VGM wait samples.
   */
  process(left, right, frames) {
    if (!(left instanceof Float32Array) || !(right instanceof Float32Array)) {
      throw new Error("process expects Float32Array buffers");
    }
    if (left.length < frames || right.length < frames) {
      throw new Error("process buffers are smaller than the requested frame count");
    }

    const ym = this.ym2612.generateStereo(frames);
    const psg = this.psg.generateStereo(frames);
    const pcm = this.pcm?.generateStereo(frames);
    const pcmGain = this._pcmMuted ? 0 : 1;
    const psgGain = this._psgMuted ? 0 : 0.35;
    const pwm = this.pwm.generateStereo?.(frames);
    const [pwmLeft, pwmRight] = pwm ? [0, 0] : this.pwm.output();

    for (let index = 0; index < frames; index += 1) {
      left[index] =
        (ym.left[index] * 0.9 + psg.left[index] * psgGain + (pwm ? pwm.left[index] : pwmLeft) + (pcm ? pcm.left[index] * pcmGain : 0)) *
        this._masterVolume;
      right[index] =
        (ym.right[index] * 0.9 + psg.right[index] * psgGain + (pwm ? pwm.right[index] : pwmRight) + (pcm ? pcm.right[index] * pcmGain : 0)) *
        this._masterVolume;
    }
  }

  /**
   * Allocate stereo output and advance synthesis.
   * @param {number} frames Nonnegative integer frame count at sampleRate().
   * @returns {{left:Float32Array,right:Float32Array}} Rendered stereo output.
   */
  processFrames(frames) {
    const left = new Float32Array(frames);
    const right = new Float32Array(frames);
    this.process(left, right, frames);
    return { left, right };
  }
}

/** Original, approximate VGM PWM renderer; no FIFO or hardware timer emulation.
 * Writes are timed by VgmPlayer. Hold each value until the next write.
 */
export class SimplePwm {
  constructor() { this.muted = false; this.reset(); }
  /** @returns {Readonly<{byteLength:number}>} Opaque snapshot owned by this instance. */
  saveState() { return Object.freeze({cycle: this.cycle, control: this.control, left: this.left, right: this.right}); }
  /** @param {Readonly<{byteLength:number}>} state Snapshot returned by this instance. */
  loadState(state) {
    if (!state || !['cycle', 'control'].every(k => Number.isInteger(state[k]) && state[k] >= 0 && state[k] <= 4095) ||
        !['left', 'right'].every(k => state[k] === null || (Number.isInteger(state[k]) && state[k] >= 0 && state[k] <= 4095))) throw new Error('Invalid PWM state');
    for (const k of ['cycle', 'control', 'left', 'right']) this[k] = state[k];
  }
  reset() { this.cycle = 0; this.control = 0; this.left = null; this.right = null; }
  /**
   * Dispatch a VGM register/command write to the corresponding sound chip.
   * @param {number} register Register address within the selected chip bank.
   * @param {number} value Register/command data value.
   */
  writeRegister(register, value) {
    value &= 0xfff;
    switch (register) {
      case 0: this.control = value; break;
      case 1: this.cycle = value; break;
      case 2: this.left = value; break;
      case 3: this.right = value; break;
      case 4: this.left = this.right = value; break;
    }
  }
  output() {
    if (this.muted || this.cycle <= 1) return [0, 0];
    // Zero/unwritten pulse widths are treated as silence in this approximation.
    const sample = value => value == null || value === 0 ? 0
      : Math.max(-1, Math.min(1, value / this.cycle * 2 - 1));
    const out = [0, 0];
    // Legacy VGM logs can omit hardware speaker-enable bits (e.g. Celtic).
    // In this VGM approximation, absent routing means direct L/R output.
    const lmode = (this.control & 3) || 1, rmode = ((this.control >> 2) & 3) || 1;
    if (lmode === 1) out[0] += sample(this.left);
    if (lmode === 2) out[1] += sample(this.left);
    if (rmode === 1) out[1] += sample(this.right);
    if (rmode === 2) out[0] += sample(this.right);
    return out;
  }
}

/** @param {Parameters<typeof GenesisAudioEngine.create>[0]} [options] */
export async function createGenesisAudioEngine(options) {
  return GenesisAudioEngine.create(options);
}

const MAX_MASTER_VOLUME = 3.8;

function clampMasterVolume(value) {
  const numeric = Number(value);

  if (!Number.isFinite(numeric)) {
    throw new Error(
      `master volume must be a finite number, got ${value}`
    );
  }

  return Math.min(
    MAX_MASTER_VOLUME,
    Math.max(0, numeric)
  );
}

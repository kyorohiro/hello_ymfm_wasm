import { Ym2612, YM2612_CLOCK } from "./ym2612.js";
import { SegaPSG, SEGAPSG_CLOCK } from "./segapsg.js";

import { Rf5c164 } from "./rf5c164.js";

export class GenesisAudioEngine {
  constructor(ym2612, psg, sampleRate, masterVolume = 1, pcm = null) {
    this.ym2612 = ym2612;
    this.psg = psg;
    this.pcm = pcm;
    this.pwm = new SimplePwm();
    this._pcmMuted = false;
    this._psgMuted = false;
    this._sampleRate = sampleRate;
    this._masterVolume = clampMasterVolume(masterVolume);
  }

  static async create(options = {}) {
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
      pcm
    );
  }

  dispose() {
    this.ym2612.dispose();
    this.psg.dispose();
    this.pcm?.dispose();
  }

  reset() {
    this.pwm.reset();
    this.ym2612.reset();
    this.psg.reset();
    this.pcm?.reset();
    this.clearRf5c164Memory();
  }

  sampleRate() {
    return this._sampleRate;
  }

  setMasterVolume(volume) {
    this._masterVolume =
      clampMasterVolume(volume);
    return this._masterVolume;
  }

  getMasterVolume() {
    return this._masterVolume;
  }

  writeYm2612(port, register, value) {
    this.ym2612.writeRegister(register, value, port);
  }

  setPsgMuted(muted) { this._psgMuted = Boolean(muted); }

  setPcmMuted(muted) { this._pcmMuted = Boolean(muted); }
  clearRf5c164Memory() { this.pcm?.clearMemory(); }
  writeRf5c164(register, value) { this.#requirePcm().writeRegister(register, value); }
  writeRf5c164Memory(offset, value) { this.#requirePcm().writeMemory(offset, value); }
  loadRf5c164Memory(data, offset) { this.#requirePcm().loadBankedMemory(data, offset); }
  #requirePcm() {
    if (!this.pcm) throw new Error("RF5C164 playback requires a PCM-enabled engine");
    return this.pcm;
  }

  writePsg(value) {
    this.psg.write(value);
  }

  writePwm(register, value) { this.pwm.writeRegister(register, value); }
  setPwmMuted(muted) { this.pwm.muted = Boolean(muted); }

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
    const [pwmLeft, pwmRight] = this.pwm.output();

    for (let index = 0; index < frames; index += 1) {
      left[index] =
        (ym.left[index] * 0.9 + psg.left[index] * psgGain + pwmLeft + (pcm ? pcm.left[index] * pcmGain : 0)) *
        this._masterVolume;
      right[index] =
        (ym.right[index] * 0.9 + psg.right[index] * psgGain + pwmRight + (pcm ? pcm.right[index] * pcmGain : 0)) *
        this._masterVolume;
    }
  }

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
  reset() { this.cycle = 0; this.control = 0; this.left = null; this.right = null; }
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

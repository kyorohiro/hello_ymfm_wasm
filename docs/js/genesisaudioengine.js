import { Ym2612, YM2612_CLOCK } from "./ym2612.js";
import { SegaPSG, SEGAPSG_CLOCK } from "./segapsg.js";

export class GenesisAudioEngine {
  constructor(ym2612, psg, sampleRate) {
    this.ym2612 = ym2612;
    this.psg = psg;
    this._sampleRate = sampleRate;
    this.psgMuted = false;
  }

  static async create(options = {}) {
    const {
      ym2612ModuleFactory,
      ym2612ModuleOptions,
      segaPsgModuleFactory,
      segaPsgModuleOptions,
      ym2612Clock = YM2612_CLOCK,
      psgClock = SEGAPSG_CLOCK,
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

    return new GenesisAudioEngine(ym2612, psg, sampleRate);
  }

  dispose() {
    this.ym2612.dispose();
    this.psg.dispose();
  }

  reset() {
    this.ym2612.reset();
    this.psg.reset();
  }

  sampleRate() {
    return this._sampleRate;
  }

  writeYm2612(port, register, value) {
    this.ym2612.writeRegister(register, value, port);
  }

  writePsg(value) {
    this.psg.write(value);
  }

  setPsgMuted(muted) {
    this.psgMuted = Boolean(muted);
  }

  process(left, right, frames) {
    if (!(left instanceof Float32Array) || !(right instanceof Float32Array)) {
      throw new Error("process expects Float32Array buffers");
    }
    if (left.length < frames || right.length < frames) {
      throw new Error("process buffers are smaller than the requested frame count");
    }

    const ym = this.ym2612.generateStereo(frames);
    const psg = this.psg.generateStereo(frames);

    for (let index = 0; index < frames; index += 1) {
      const psgLeft = this.psgMuted ? 0 : psg.left[index] * 0.35;
      const psgRight = this.psgMuted ? 0 : psg.right[index] * 0.35;
      left[index] = ym.left[index] * 0.9 + psgLeft;
      right[index] = ym.right[index] * 0.9 + psgRight;
    }
  }

  processFrames(frames) {
    const left = new Float32Array(frames);
    const right = new Float32Array(frames);
    this.process(left, right, frames);
    return { left, right };
  }
}

export async function createGenesisAudioEngine(options) {
  return GenesisAudioEngine.create(options);
}

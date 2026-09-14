import { Ym2151, YM2151_CLOCK } from './ym2151.js';
import { SegaPSG } from './segapsg.js';

// YM2151 and optional Sega PSG share the output clock, but keep independent state.
export class Ym2151AudioEngine {
  static async create({ ym2151ModuleFactory, ym2151ModuleOptions, ym2151Clock = YM2151_CLOCK,
    segaPsgModuleFactory, psgClock = 0, outputSampleRate = 44100, masterVolume = 1 } = {}) {
    if (!Number.isFinite(outputSampleRate) || outputSampleRate <= 0 ||
        !Number.isFinite(ym2151Clock) || ym2151Clock <= 0) throw new RangeError('Invalid sample rate or chip clock');
    const chip = await Ym2151.create({ moduleFactory: ym2151ModuleFactory, moduleOptions: ym2151ModuleOptions });
    let psg;
    try {
      if (psgClock) psg = await SegaPSG.create({ moduleFactory: segaPsgModuleFactory, clock: psgClock, sampleRate: outputSampleRate });
      return new Ym2151AudioEngine(chip, psg, chip.sampleRate(ym2151Clock), outputSampleRate, masterVolume);
    } catch (error) { chip.dispose(); psg?.dispose(); throw error; }
  }

  constructor(chip, psg, chipRate, outputRate, volume) {
    this.ym2151 = chip;
    this.psg = psg;
    this.chipRate = chipRate;
    this.outputRate = outputRate;
    this.setMasterVolume(volume);
    this.psgMuted = false;
    this.remainder = 0;
    this.lastLeft = 0; this.lastRight = 0;
  }
  sampleRate() { return this.outputRate; }
  setMasterVolume(value) {
    if (!Number.isFinite(Number(value))) throw new RangeError('Invalid master volume');
    return this.volume = Math.max(0, Math.min(3.8, Number(value)));
  }
  getMasterVolume() { return this.volume; }
  setPsgMuted(value) { this.psgMuted = Boolean(value); }
  setChannelMuted(channel, muted) {
    if (!Number.isInteger(channel) || channel < 0 || channel >= 8) throw new RangeError('Invalid YM2151 channel');
    const bit = 1 << channel;
    this.ym2151.setMuteMask(muted ? this.ym2151.muteMask | bit : this.ym2151.muteMask & ~bit);
    this.lastLeft = 0; this.lastRight = 0;
  }
  writePsg(value) { this.psg?.write(value); }
  writeYm2151(register, value) { this.ym2151.write(0, register); this.ym2151.write(1, value); }
  reset() {
    this.ym2151.reset(); this.psg?.reset(); this.remainder = 0; this.lastLeft = 0; this.lastRight = 0;
  }
  dispose() { this.ym2151.dispose(); this.psg?.dispose(); }
  process(left, right, frames) {
    if (!Number.isInteger(frames) || frames < 0 || frames > 0x1000000) throw new RangeError('Invalid frame count');
    if (!(left instanceof Float32Array) || !(right instanceof Float32Array) || left.length < frames || right.length < frames)
      throw new RangeError('Invalid output buffers');
    const psg = this.psg?.generateStereo(frames);
    for (let i = 0; i < frames; i++) {
      this.remainder += this.chipRate;
      const count = Math.floor(this.remainder / this.outputRate);
      this.remainder -= count * this.outputRate;
      if (count) {
        const pcm = this.ym2151.generateStereo(count);
        let sumLeft = 0, sumRight = 0;
        for (let sample = 0; sample < count; sample++) { sumLeft += pcm.left[sample]; sumRight += pcm.right[sample]; }
        this.lastLeft = sumLeft / count;
        this.lastRight = sumRight / count;
      }
      left[i] = (this.lastLeft + (psg && !this.psgMuted ? psg.left[i] : 0)) * this.volume;
      right[i] = (this.lastRight + (psg && !this.psgMuted ? psg.right[i] : 0)) * this.volume;
    }
  }
  processFrames(frames) {
    if (!Number.isInteger(frames) || frames < 0 || frames > 0x1000000) throw new RangeError('Invalid frame count');
    const left = new Float32Array(frames), right = new Float32Array(frames);
    this.process(left, right, frames);
    return { left, right };
  }
}
export const createYm2151AudioEngine = options => Ym2151AudioEngine.create(options);

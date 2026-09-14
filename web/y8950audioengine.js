import { Y8950, Y8950_CLOCK } from './y8950.js';
import { SegaPSG } from './segapsg.js';

// Y8950 and optional Sega PSG share the output clock, but keep independent state.
export class Y8950AudioEngine {
  static async create({ y8950ModuleFactory, y8950ModuleOptions, y8950Clock = Y8950_CLOCK,
    segaPsgModuleFactory, psgClock = 0, outputSampleRate = 44100, masterVolume = 1 } = {}) {
    if (!Number.isFinite(outputSampleRate) || outputSampleRate <= 0 ||
        !Number.isFinite(y8950Clock) || y8950Clock <= 0) throw new RangeError('Invalid sample rate or chip clock');
    const chip = await Y8950.create({ moduleFactory: y8950ModuleFactory, moduleOptions: y8950ModuleOptions });
    let psg;
    try {
      if (psgClock) psg = await SegaPSG.create({ moduleFactory: segaPsgModuleFactory, clock: psgClock, sampleRate: outputSampleRate });
      return new Y8950AudioEngine(chip, psg, chip.sampleRate(y8950Clock), outputSampleRate, masterVolume);
    } catch (error) { chip.dispose(); psg?.dispose(); throw error; }
  }

  constructor(chip, psg, chipRate, outputRate, volume) {
    this.y8950 = chip;
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
  writePsg(value) { this.psg?.write(value); }
  writeY8950(register, value) { this.y8950.write(0, register); this.y8950.write(1, value); }
  loadSampleMemory(data, offset, memorySize) { this.y8950.loadSampleMemory(data, offset, memorySize); }
  clearSampleMemory() { this.y8950.clearSampleMemory(); }
  reset() {
    this.y8950.reset(); this.psg?.reset(); this.remainder = 0; this.lastLeft = 0; this.lastRight = 0;
  }
  dispose() { this.y8950.dispose(); this.psg?.dispose(); }
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
        const pcm = this.y8950.generateStereo(count);
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
export const createY8950AudioEngine = options => Y8950AudioEngine.create(options);

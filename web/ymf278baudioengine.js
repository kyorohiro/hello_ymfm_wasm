import { Ymf278b, YMF278B_CLOCK } from './ymf278b.js?v=opl4-rom-1';
import { SegaPSG } from './segapsg.js';

// YMF278B and optional Sega PSG share the output clock, but keep independent state.
export class Ymf278bAudioEngine {
  static async create({ ymf278bModuleFactory, ymf278bModuleOptions, ymf278bClock = YMF278B_CLOCK,
    segaPsgModuleFactory, psgClock = 0, outputSampleRate = 44100, masterVolume = 1 } = {}) {
    if (!Number.isFinite(outputSampleRate) || outputSampleRate <= 0 ||
        !Number.isFinite(ymf278bClock) || ymf278bClock <= 0) throw new RangeError('Invalid sample rate or chip clock');
    const chip = await Ymf278b.create({ moduleFactory: ymf278bModuleFactory, moduleOptions: ymf278bModuleOptions });
    let psg;
    try {
      if (psgClock) psg = await SegaPSG.create({ moduleFactory: segaPsgModuleFactory, clock: psgClock, sampleRate: outputSampleRate });
      return new Ymf278bAudioEngine(chip, psg, chip.sampleRate(ymf278bClock), outputSampleRate, masterVolume);
    } catch (error) { chip.dispose(); psg?.dispose(); throw error; }
  }

  constructor(chip, psg, chipRate, outputRate, volume) {
    this.ymf278b = chip;
    this.psg = psg;
    this.waveRom = null;
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
  writeYmf278b(port, register, value) { this.ymf278b.write(port * 2, register); this.ymf278b.write(port * 2 + 1, value); }
  loadSampleMemory(data, offset, memorySize) { this.ymf278b.loadSampleMemory(data, offset, memorySize); }
  loadWaveRom(data) {
    if (!(data instanceof Uint8Array) || data.length !== 0x200000)
      throw new RangeError('YMF278B wave ROM must be 2097152 bytes (yrw801.rom).');
    this.waveRom = data.slice();
    this.ymf278b.loadSampleMemory(this.waveRom, 0, Math.max(0x200000, this.ymf278b.sampleMemory.length));
  }
  clearSampleMemory() {
    this.ymf278b.clearSampleMemory();
    // VGM file changes clear embedded samples, but retain the user-supplied ROM.
    if (this.waveRom) this.ymf278b.loadSampleMemory(this.waveRom, 0, this.waveRom.length);
  }
  reset() {
    this.ymf278b.reset(); this.psg?.reset(); this.remainder = 0; this.lastLeft = 0; this.lastRight = 0;
  }
  dispose() { this.ymf278b.dispose(); this.psg?.dispose(); }
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
        const pcm = this.ymf278b.generateStereo(count);
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
export const createYmf278bAudioEngine = options => Ymf278bAudioEngine.create(options);

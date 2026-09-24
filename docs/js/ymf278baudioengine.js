/**
 * @file ymf278baudioengine.js
 * 実行環境: Browser / Node.js
 * 依存: 音源チップ／WASM バックエンド（ファクトリーまたはエンジンを注入）。
 * 同期 PCM 生成・ミックス用。DOM・AudioContext・スピーカー出力は不要。
 */
import { Ymf278b, YMF278B_CLOCK } from './ymf278b.js?v=opl4-rom-1';
import { SegaPSG } from './segapsg.js';

// YMF278B and optional Sega PSG share the output clock, but keep independent state.
/**
 * Ymf278bAudioEngine adapter for synchronous stereo rendering and VGM register dispatch.
 * Output timing uses sampleRate() frames per second. No browser audio device is opened.
 * Dispose the engine when done to release its underlying chips.
 */
export class Ymf278bAudioEngine {
  /**
   * Create the chip instances required by this engine.
   * @param {Object} [options={}] Chip factories, clocks in Hz and loader settings.
   * @param {number} [options.outputSampleRate=44100] Output stereo frames per second.
   * @param {number} [options.masterVolume=1] Linear output gain, not dB.
   * @returns {Promise<Ymf278bAudioEngine>} Initialized engine owned by the caller.
   */
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
  /**
   * Return the rate used by process() and processFrames().
   * @returns {number} Output stereo frames per second (Hz).
   */
  sampleRate() { return this.outputRate; }
  /**
   * Set the linear master gain; validation/clamping follows this engine.
   * @param {number} value Gain multiplier, not dB.
   */
  setMasterVolume(value) {
    if (!Number.isFinite(Number(value))) throw new RangeError('Invalid master volume');
    return this.volume = Math.max(0, Math.min(3.8, Number(value)));
  }
  /**
   * Read the current linear master gain.
   * @returns {number} Gain multiplier, not a dB value.
   */
  getMasterVolume() { return this.volume; }
  setPsgMuted(value) { this.psgMuted = Boolean(value); }
  /**
   * Change one physical channel mute flag.
   * @param {number} channel Zero-based physical channel index, not a MIDI part.
   * @param {boolean} muted True to suppress the channel.
   * @returns {void}
   */
  setChannelMuted(channel, muted) {
    if (!Number.isInteger(channel) || channel < 0 || channel >= 18) throw new RangeError('Invalid YMF278B FM channel');
    const bit = 1 << channel;
    this.ymf278b.setFmMuteMask(muted ? this.ymf278b.fmMuteMask | bit : this.ymf278b.fmMuteMask & ~bit);
  }
  setPcmChannelMuted(channel, muted) {
    if (!Number.isInteger(channel) || channel < 0 || channel >= 24) throw new RangeError('Invalid YMF278B PCM channel');
    const bit = 1 << channel;
    this.ymf278b.setPcmMuteMask(muted ? this.ymf278b.pcmMuteMask | bit : this.ymf278b.pcmMuteMask & ~bit);
  }
  /**
   * Dispatch a VGM register/command write to the corresponding sound chip.
   * @param {number} value Register/command data value.
   */
  writePsg(value) { this.psg?.write(value); }
  /**
   * Dispatch a VGM register/command write to the corresponding sound chip.
   * @param {number} port Chip register bank/port (not a MIDI channel).
   * @param {number} register Register address within the selected chip bank.
   * @param {number} value Register/command data value.
   */
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
  /**
   * Reset chip/playback state for a new pass. This is not pause/resume; replay setup writes afterward.
   * @returns {void}
   */
  reset() {
    this.ymf278b.reset(); this.psg?.reset(); this.remainder = 0; this.lastLeft = 0; this.lastRight = 0;
  }
  /**
   * Release the underlying chips and their resources. Do not render after disposal.
   * @returns {void}
   */
  dispose() { this.ymf278b.dispose(); this.psg?.dispose(); }
  /**
   * Advance synthesis and fill caller-owned stereo buffers.
   * @param {Float32Array} left Left output buffer with capacity for frames samples.
   * @param {Float32Array} right Right output buffer with capacity for frames samples.
   * @param {number} frames Nonnegative integer output frame count; not VGM wait samples.
   */
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
  /**
   * Allocate stereo output and advance synthesis.
   * @param {number} frames Nonnegative integer frame count at sampleRate().
   * @returns {{left:Float32Array,right:Float32Array}} Rendered stereo output.
   */
  processFrames(frames) {
    if (!Number.isInteger(frames) || frames < 0 || frames > 0x1000000) throw new RangeError('Invalid frame count');
    const left = new Float32Array(frames), right = new Float32Array(frames);
    this.process(left, right, frames);
    return { left, right };
  }
}
export const createYmf278bAudioEngine = options => Ymf278bAudioEngine.create(options);

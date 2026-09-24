/**
 * @file multichipaudioengine.js
 * 実行環境: Browser / Node.js
 * 依存: 音源チップ／WASM バックエンド（ファクトリーまたはエンジンを注入）。
 * 同期 PCM 生成・ミックス用。DOM・AudioContext・スピーカー出力は不要。
 */
// Each entry owns an engine and a parser-facing target. Routing never aliases
// instances of the same chip; rendering advances all engines by the same time.
/**
 * MultiChipAudioEngine adapter for synchronous stereo rendering and VGM register dispatch.
 * Output timing uses sampleRate() frames per second. No browser audio device is opened.
 * Dispose the engine when done to release its underlying chips.
 */
export class MultiChipAudioEngine {
  constructor(entries, outputSampleRate = 44100, masterVolume = 1) {
    if (!Number.isFinite(outputSampleRate) || outputSampleRate <= 0) throw new RangeError('Invalid output sample rate');
    this.entries = new Map();
    for (const {type, index = 0, engine, target} of entries) {
      const key = `${type}:${index}`;
      if (!Number.isInteger(index) || index < 0 || this.entries.has(key)) throw new Error(`Invalid or duplicate chip: ${key}`);
      if (engine.sampleRate() !== outputSampleRate) throw new Error(`Sample rate mismatch: ${key}`);
      this.entries.set(key, {engine, target, muted: false});
    }
    this.outputSampleRate = outputSampleRate;
    this.setMasterVolume(masterVolume);
  }
  getVgmTarget(type, index = 0) {
    const entry = this.entries.get(`${type}:${index}`);
    if (!entry) throw new Error(`No playback instance for ${type}:${index}`);
    return entry.target;
  }
  setChipMuted(type, index, muted) {
    const entry = this.entries.get(`${type}:${index}`);
    if (!entry) throw new Error(`No playback instance for ${type}:${index}`);
    entry.muted = Boolean(muted);
  }
  /**
   * Return the rate used by process() and processFrames().
   * @returns {number} Output stereo frames per second (Hz).
   */
  sampleRate() { return this.outputSampleRate; }
  /**
   * Set the linear master gain; validation/clamping follows this engine.
   * @param {number} value Gain multiplier, not dB.
   */
  setMasterVolume(value) {
    if (!Number.isFinite(Number(value))) throw new RangeError('Invalid volume');
    return this.volume = Math.max(0, Math.min(3.8, Number(value)));
  }
  /**
   * Read the current linear master gain.
   * @returns {number} Gain multiplier, not a dB value.
   */
  getMasterVolume() { return this.volume; }
  /**
   * Reset chip/playback state for a new pass. This is not pause/resume; replay setup writes afterward.
   * @returns {void}
   */
  reset() { for (const {engine} of this.entries.values()) engine.reset(); }
  clearSampleMemory() { for (const {engine} of this.entries.values()) engine.clearSampleMemory?.(); }
  /**
   * Release the underlying chips and their resources. Do not render after disposal.
   * @returns {void}
   */
  dispose() { for (const {engine} of this.entries.values()) engine.dispose(); this.entries.clear(); }
  /**
   * Allocate stereo output and advance synthesis.
   * @param {number} frames Nonnegative integer frame count at sampleRate().
   * @returns {{left:Float32Array,right:Float32Array}} Rendered stereo output.
   */
  processFrames(frames) {
    if (!Number.isInteger(frames) || frames < 0 || frames > 0x1000000) throw new RangeError('Invalid frame count');
    // Sum in double precision, rounding only the final mixed output.
    const left = new Float64Array(frames), right = new Float64Array(frames);
    for (const {engine, muted} of this.entries.values()) {
      const pcm = engine.processFrames(frames);
      if (muted) continue;
      for (let i = 0; i < frames; i++) { left[i] += pcm.left[i]; right[i] += pcm.right[i]; }
    }
    return {left: Float32Array.from(left, x => x * this.volume), right: Float32Array.from(right, x => x * this.volume)};
  }
  /**
   * Advance synthesis and fill caller-owned stereo buffers.
   * @param {Float32Array} left Left output buffer with capacity for frames samples.
   * @param {Float32Array} right Right output buffer with capacity for frames samples.
   * @param {number} frames Nonnegative integer output frame count; not VGM wait samples.
   */
  process(left, right, frames) {
    if (!(left instanceof Float32Array) || !(right instanceof Float32Array) || left.length < frames || right.length < frames) throw new RangeError('Invalid buffers');
    const pcm = this.processFrames(frames); left.set(pcm.left); right.set(pcm.right);
  }
}

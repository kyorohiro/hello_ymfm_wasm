// Each entry owns an engine and a parser-facing target. Routing never aliases
// instances of the same chip; rendering advances all engines by the same time.
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
  sampleRate() { return this.outputSampleRate; }
  setMasterVolume(value) {
    if (!Number.isFinite(Number(value))) throw new RangeError('Invalid volume');
    return this.volume = Math.max(0, Math.min(3.8, Number(value)));
  }
  getMasterVolume() { return this.volume; }
  reset() { for (const {engine} of this.entries.values()) engine.reset(); }
  clearSampleMemory() { for (const {engine} of this.entries.values()) engine.clearSampleMemory?.(); }
  dispose() { for (const {engine} of this.entries.values()) engine.dispose(); this.entries.clear(); }
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
  process(left, right, frames) {
    if (!(left instanceof Float32Array) || !(right instanceof Float32Array) || left.length < frames || right.length < frames) throw new RangeError('Invalid buffers');
    const pcm = this.processFrames(frames); left.set(pcm.left); right.set(pcm.right);
  }
}

/** Shared sample-rate conversion for chip output transports. No audio device. */
export class ChipPCMRenderer {
/** @param {{sampleRate(): number, generateStereo(frames: number): {left: Float32Array, right: Float32Array}}} chip @param {{sampleRate: number, gain?: number, generate?: (frames: number) => {left: Float32Array, right: Float32Array}, removeIdleOffset?: boolean}} options */
  constructor(chip, {sampleRate, gain = .25, generate, removeIdleOffset = false} = {}) {
    if (!Number.isInteger(sampleRate) || sampleRate <= 0) throw new RangeError('Invalid output sample rate');
    if (!Number.isFinite(gain) || gain < 0 || gain > 4) throw new RangeError('Invalid output gain');
    this.chip = chip; this.rate = chip.sampleRate(); this.sampleRate = sampleRate; this.gain = gain;
    if (!Number.isFinite(this.rate) || this.rate <= 0) throw new RangeError('Invalid chip sample rate');
    this.generate = generate ?? (chip.generateStereoView ?? chip.generateStereo).bind(chip);
    this.idleLeft = this.idleRight = 0;
    if (removeIdleOffset) {
      if (!chip.supportsState?.()) throw new Error('Idle calibration requires chip state support');
      const state = chip.saveState();
      try {chip.reset(); const idle = chip.generateStereo(1); this.idleLeft = idle.left[0]; this.idleRight = idle.right[0];}
      finally {chip.loadState(state);}
    }
    this.resetHistory();
  }
  resetHistory() {this.phase = 0; this.left = this.right = 0;}
  render(frames) {
    const left = new Float32Array(frames), right = new Float32Array(frames);
    const nativeFrames = Math.floor((this.phase + frames * this.rate) / this.sampleRate);
    const pcm = nativeFrames ? this.generate(nativeFrames) : null;
    let offset = 0;
    for (let i = 0; i < frames; i++) {
      this.phase += this.rate;
      const count = Math.floor(this.phase / this.sampleRate); this.phase -= count * this.sampleRate;
      if (count) {
        let l = 0, r = 0;
        for (let j = 0; j < count; j++, offset++) {l += pcm.left[offset] - this.idleLeft; r += pcm.right[offset] - this.idleRight;}
        this.left = l / count; this.right = r / count;
      }
      left[i] = this.left * this.gain; right[i] = this.right * this.gain;
    }
    return {left, right, sampleRate: this.sampleRate};
  }
}

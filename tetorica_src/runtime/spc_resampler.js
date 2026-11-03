const SPC_NATIVE_RATE = 32000;

/** Native SPC stereo frames are always 32,000 Hz. Linear interpolation keeps its
 * phase across output quanta and pause. File playback batches 128 native frames;
 * a directly controlled DSP can select sourceFrames:1 to limit render-ahead.
 * Linear interpolation still holds the next native sample for interpolation.
 */
export class SpcResampler {
  constructor(core, outputRate, {sourceFrames = 128} = {}) {
    if (!Number.isInteger(outputRate) || outputRate <= 0) throw new RangeError('Invalid SPC output sample rate');
    if (!Number.isInteger(sourceFrames) || sourceFrames < 1 || sourceFrames > 16384) throw new RangeError('Invalid SPC source block size');
    this.core = core;
    this.outputRate = outputRate;
    this.sourceFrames = sourceFrames;
    this.left = new Float32Array(sourceFrames);
    this.right = new Float32Array(sourceFrames);
    this.reset();
  }
  reset(nativeFrames = 0) {
    this.offset = this.sourceFrames;
    this.primed = false;
    this.phase = 0;
    this.outputFrames = 0;
    this.baseNativeFrames = nativeFrames;
    this.renderedNativeFrames = nativeFrames;
  }
  pull() {
    if (this.offset === this.sourceFrames) {
      this.core.renderInto(this.left, this.right, this.sourceFrames);
      this.renderedNativeFrames += this.sourceFrames;
      this.offset = 0;
    }
    this.pulledLeft = this.left[this.offset];
    this.pulledRight = this.right[this.offset++];
  }
  get playbackNativeFrames() { return this.baseNativeFrames + this.outputFrames * SPC_NATIVE_RATE / this.outputRate; }
  render(left, right) {
    if (!left.length) return;
    if (!this.primed) {
      this.pull(); this.previousLeft = this.pulledLeft; this.previousRight = this.pulledRight;
      this.pull(); this.nextLeft = this.pulledLeft; this.nextRight = this.pulledRight;
      this.primed = true;
    }
    for (let i = 0; i < left.length; i++) {
      const fraction = this.phase / this.outputRate;
      left[i] = this.previousLeft + (this.nextLeft - this.previousLeft) * fraction;
      right[i] = this.previousRight + (this.nextRight - this.previousRight) * fraction;
      this.phase += SPC_NATIVE_RATE;
      while (this.phase >= this.outputRate) {
        this.phase -= this.outputRate;
        this.previousLeft = this.nextLeft; this.previousRight = this.nextRight;
        this.pull(); this.nextLeft = this.pulledLeft; this.nextRight = this.pulledRight;
      }
    }
    this.outputFrames += left.length;
  }
}

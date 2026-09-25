/**
 * @file vgm-output-worklet.js
 * 実行環境: Browser（AudioWorkletGlobalScope）
 * 依存: AudioWorkletProcessor / registerProcessor と MessagePort。
 * AudioContext.audioWorklet.addModule() で読み込む専用エントリーポイント。
 */
class VgmOutputProcessor extends AudioWorkletProcessor {
  constructor(options = {}) {
    super();
    // Hold queued samples intact until the configured output buffer is ready.
    const requested = options.processorOptions?.startupFrames ?? 0;
    this.startupFrames = Number.isSafeInteger(requested) && requested > 0 ? requested : 0;
    this.buffering = this.startupFrames > 0;
    this.fadeFrames = Math.max(0, Math.floor(options.processorOptions?.fadeFrames || 0));
    this.fadePosition = 0;
    this.lastOutput = [0, 0];
    this.transitionFrames = 0;
    this.transitionRemaining = 0;
    this.transitionFrom = [0, 0];
    this.stopRemaining = null;
    this.queue = [];
    this.queuedFrames = 0;
    this.consumedFrames = 0;
    this.endRequested = false;
    this.paused = false;
    this.currentChunk = null;
    this.currentOffset = 0;

    this.port.onmessage = (event) => {
      const data = event.data;
      if (!data || typeof data !== "object") {
        return;
      }
      if (data.type === "fade") {
        this.fadeFrames = Math.max(0, Math.floor(data.frames || 0));
        return;
      }
      if (data.type === "stop") {
        this.paused = false;
        this.buffering = false;
        this.endRequested = true;
        this.stopRemaining = this.fadeFrames;
        return;
      }
      if (data.type === "pause" || data.type === "resume") {
        this.paused = data.type === "pause";
        return;
      }
      if (data.type === "enqueue") {
        const left = new Float32Array(data.left);
        const right = new Float32Array(data.right);
        this.queue.push({ left, right });
        this.queuedFrames += left.length;
        return;
      }
      if (data.type === "end") {
        this.endRequested = true;
        return;
      }
      if (data.type === "flush") {
        this.transitionFrames = Number.isSafeInteger(data.smoothFrames) ? Math.max(0, Math.min(4096, data.smoothFrames)) : 0;
        this.transitionRemaining = this.transitionFrames;
        this.transitionFrom = this.lastOutput.slice();
        if (Number.isSafeInteger(data.startupFrames) && data.startupFrames > 0) {
          this.startupFrames = data.startupFrames;
        }
        this.paused = false;
        this.queue = [];
        this.queuedFrames = 0;
        this.consumedFrames = 0;
        this.fadePosition = 0;
        this.stopRemaining = null;
        this.currentChunk = null;
        this.currentOffset = 0;
        this.endRequested = false;
        this.buffering = this.startupFrames > 0;
      }
    };
  }

  process(inputs, outputs) {
    this.render(inputs, outputs);
    const [left, right] = outputs[0];
    for (let i = 0; i < left.length; i++) {
      if (this.transitionRemaining > 0) {
        const mix = 1 - this.transitionRemaining / this.transitionFrames;
        left[i] = this.transitionFrom[0] * (1 - mix) + left[i] * mix;
        right[i] = this.transitionFrom[1] * (1 - mix) + right[i] * mix;
        this.transitionRemaining--;
      }
    }
    this.lastOutput[0] = left[left.length - 1] ?? 0;
    this.lastOutput[1] = right[right.length - 1] ?? 0;
    return true;
  }

  render(inputs, outputs) {
    const output = outputs[0];
    const left = output[0];
    const right = output[1];
    if (this.paused) {
      left.fill(0);
      right.fill(0);
      return true;
    }
    if (this.buffering) {
      // A short/empty track must drain even when it cannot fill the buffer.
      if (this.queuedFrames < this.startupFrames && !this.endRequested) {
        left.fill(0);
        right.fill(0);
        return true;
      }
      this.buffering = false;
      // Also bridge the return from the refill silence to the new mixed audio.
      if (this.transitionFrames > 0) {
        this.transitionRemaining = this.transitionFrames;
        this.transitionFrom = this.lastOutput.slice();
      }
    }
    let writeOffset = 0;

    while (writeOffset < left.length) {
      // Retain a short tail until the end marker arrives, even across chunks.
      if (this.stopRemaining === 0 || (!this.endRequested && this.queuedFrames <= this.fadeFrames)) {
        left.fill(0, writeOffset); right.fill(0, writeOffset);
        break;
      }
      if (!this.currentChunk) {
        if (this.queue.length === 0) {
          left.fill(0, writeOffset);
          right.fill(0, writeOffset);
          break;
        }
        this.currentChunk = this.queue.shift();
        this.currentOffset = 0;
      }

      const available =
        this.currentChunk.left.length -
        this.currentOffset;
      const frames = Math.min(
        left.length - writeOffset,
        available,
        this.endRequested ? this.queuedFrames : this.queuedFrames - this.fadeFrames,
        this.stopRemaining ?? Infinity
      );
      left.set(
        this.currentChunk.left.subarray(
          this.currentOffset,
          this.currentOffset + frames
        ),
        writeOffset
      );
      right.set(
        this.currentChunk.right.subarray(
          this.currentOffset,
          this.currentOffset + frames
        ),
        writeOffset
      );
      for (let i = 0; i < frames; i++) {
        let gain = 1;
        if (this.fadeFrames > 0) {
          gain = Math.min(1, this.fadePosition / this.fadeFrames);
          if (this.endRequested) gain = Math.min(gain, Math.max(0, (Math.min(this.stopRemaining ?? Infinity, this.queuedFrames) - i - 1) / this.fadeFrames));
        }
        left[writeOffset + i] *= gain;
        right[writeOffset + i] *= gain;
        this.fadePosition++;
      }
      if (this.stopRemaining !== null) this.stopRemaining -= frames;
      this.currentOffset += frames;
      writeOffset += frames;
      this.queuedFrames -= frames;
      this.consumedFrames += frames;

      if (
        this.currentOffset >=
        this.currentChunk.left.length
      ) {
        this.currentChunk = null;
        this.currentOffset = 0;
      }
    }

    if (
      this.stopRemaining === 0 ||
      this.queuedFrames <= 4096 ||
      (this.endRequested &&
        this.queuedFrames === 0)
    ) {
      this.port.postMessage({
        type: "state",
        queuedFrames: this.queuedFrames,
        consumedFrames: this.consumedFrames,
        ended:
          this.endRequested &&
          (this.queuedFrames === 0 || this.stopRemaining === 0),
      });
    }

    return true;
  }
}

registerProcessor(
  "vgm-output-processor",
  VgmOutputProcessor
);

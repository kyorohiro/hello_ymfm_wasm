class VgmOutputProcessor extends AudioWorkletProcessor {
  constructor(options = {}) {
    super();
    // Hold queued samples intact until the configured output buffer is ready.
    const requested = options.processorOptions?.startupFrames ?? 0;
    this.startupFrames = Number.isSafeInteger(requested) && requested > 0 ? requested : 0;
    this.buffering = this.startupFrames > 0;
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
        if (Number.isSafeInteger(data.startupFrames) && data.startupFrames > 0) {
          this.startupFrames = data.startupFrames;
        }
        this.paused = false;
        this.queue = [];
        this.queuedFrames = 0;
        this.consumedFrames = 0;
        this.currentChunk = null;
        this.currentOffset = 0;
        this.endRequested = false;
        this.buffering = this.startupFrames > 0;
      }
    };
  }

  process(inputs, outputs) {
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
    }
    let writeOffset = 0;

    while (writeOffset < left.length) {
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
        available
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
          this.queuedFrames === 0,
      });
    }

    return true;
  }
}

registerProcessor(
  "vgm-output-processor",
  VgmOutputProcessor
);

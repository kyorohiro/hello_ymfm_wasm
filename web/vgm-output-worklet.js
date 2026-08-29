class VgmOutputProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.queue = [];
    this.queuedFrames = 0;
    this.endRequested = false;
    this.currentChunk = null;
    this.currentOffset = 0;

    this.port.onmessage = (event) => {
      const data = event.data;
      if (!data || typeof data !== "object") {
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
        this.queue = [];
        this.queuedFrames = 0;
        this.currentChunk = null;
        this.currentOffset = 0;
        this.endRequested = false;
      }
    };
  }

  process(inputs, outputs) {
    const output = outputs[0];
    const left = output[0];
    const right = output[1];
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

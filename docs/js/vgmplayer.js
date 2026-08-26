import { Ym2612VGM } from "./ym2612vgm.js";

export class VgmPlayer {
  constructor(engine) {
    this.engine = engine;
    this.parser = null;
    this.loopEnabled = false;
    this.playing = false;
    this.paused = false;
    this.prefetchFactor = 2;
    this.maxFillStepsPerProcess = 512;
    this.waitAccumulator = 0;
    this.chunkQueue = [];
    this.queuedFrames = 0;
    this.processedEvents = 0;
    this.processedWaitSamples = 0;
  }

  load(buffer, options = {}) {
    this.parser = new Ym2612VGM(buffer, options);
    this.waitAccumulator = 0;
    this.chunkQueue = [];
    this.queuedFrames = 0;
    this.processedEvents = 0;
    this.processedWaitSamples = 0;
    this.playing = false;
    this.paused = false;
  }

  reset() {
    if (!this.parser) {
      return;
    }
    this.parser.reset();
    this.engine.reset();
    this.waitAccumulator = 0;
    this.chunkQueue = [];
    this.queuedFrames = 0;
    this.processedEvents = 0;
    this.processedWaitSamples = 0;
    this.playing = false;
    this.paused = false;
  }

  play() {
    if (!this.parser) {
      throw new Error("No VGM buffer is loaded");
    }
    this.playing = true;
    this.paused = false;
  }

  pause() {
    if (!this.parser) {
      return;
    }
    this.playing = false;
    this.paused = true;
  }

  resume() {
    if (!this.parser) {
      throw new Error("No VGM buffer is loaded");
    }
    this.playing = true;
    this.paused = false;
  }

  stop() {
    if (!this.parser) {
      return;
    }
    this.parser.reset();
    this.engine.reset();
    this.waitAccumulator = 0;
    this.playing = false;
    this.paused = false;
    this.chunkQueue = [];
    this.queuedFrames = 0;
    this.processedEvents = 0;
    this.processedWaitSamples = 0;
  }

  clearQueuedAudio() {
    this.chunkQueue = [];
    this.queuedFrames = 0;
  }

  setPrefetchFactor(factor) {
    const numeric = Number(factor);
    if (!Number.isFinite(numeric)) {
      return;
    }
    this.prefetchFactor = Math.min(8, Math.max(1, numeric));
  }

  setMaxFillStepsPerProcess(steps) {
    const numeric = Number(steps);
    if (!Number.isFinite(numeric)) {
      return;
    }
    this.maxFillStepsPerProcess = Math.max(32, Math.floor(numeric));
  }

  setLoopEnabled(enabled) {
    this.loopEnabled = enabled;
  }

  isPlaying() {
    return this.playing;
  }

  isPaused() {
    return this.paused;
  }

  sampleRate() {
    return this.engine.sampleRate();
  }

  stats() {
    const totalSamples = this.parser ? this.parser.header.totalSamples : 0;
    return {
      playing: this.playing,
      paused: this.paused,
      queuedFrames: this.queuedFrames,
      processedEvents: this.processedEvents,
      processedWaitSamples: this.processedWaitSamples,
      totalSamples,
      audioProgress: totalSamples > 0
        ? Math.min(100, (this.processedWaitSamples / totalSamples) * 100)
        : 0,
    };
  }

  process(left, right, frames) {
    if (!this.parser) {
      left.fill(0, 0, frames);
      right.fill(0, 0, frames);
      return;
    }

    if (this.playing) {
      this.#fillQueue(Math.ceil(frames * this.prefetchFactor));
    }

    if (!this.playing && !this.paused && this.queuedFrames === 0) {
      left.fill(0, 0, frames);
      right.fill(0, 0, frames);
      return;
    }

    this.#copyQueuedFrames(left, right, frames);
  }

  #fillQueue(targetFrames) {
    let steps = 0;
    while (
      this.playing &&
      this.queuedFrames < targetFrames &&
      steps < this.maxFillStepsPerProcess
    ) {
      steps += 1;
      const event = this.parser.playStep({
        ym2612: { writeRegister: (register, value, port = 0) => this.engine.writeYm2612(port, register, value) },
        psg: { write: (value) => this.engine.writePsg(value) },
      });
      this.processedEvents += 1;

      if (event.type === "wait") {
        this.parser.consumeWait(
          {
            ym2612: { writeRegister: (register, value, port = 0) => this.engine.writeYm2612(port, register, value) },
            psg: { write: (value) => this.engine.writePsg(value) },
          },
          event.samples,
          (vgmSamples) => this.#renderWaitSegment(vgmSamples),
        );
        continue;
      }

      if (event.type === "end") {
        if (this.loopEnabled) {
          if (this.parser.hasLoop()) {
            this.parser.position = this.parser.header.loopOffset;
            this.parser.ended = false;
          } else {
            this.parser.reset();
            this.engine.reset();
            this.waitAccumulator = 0;
            this.chunkQueue = [];
            this.queuedFrames = 0;
            this.processedEvents = 0;
            this.processedWaitSamples = 0;
          }
          continue;
        }
        this.playing = false;
        break;
      }
    }
  }

  #renderWaitSegment(vgmSamples) {
    this.processedWaitSamples += vgmSamples;
    this.waitAccumulator += vgmSamples * this.sampleRate();
    const frames = Math.floor(this.waitAccumulator / 44100);
    this.waitAccumulator -= frames * 44100;
    if (frames <= 0) {
      return;
    }
    const chunk = this.engine.processFrames(frames);
    this.chunkQueue.push({
      left: chunk.left,
      right: chunk.right,
      offset: 0,
    });
    this.queuedFrames += frames;
  }

  #copyQueuedFrames(left, right, frames) {
    let writeOffset = 0;
    while (writeOffset < frames) {
      if (this.chunkQueue.length === 0) {
        left.fill(0, writeOffset, frames);
        right.fill(0, writeOffset, frames);
        return;
      }

      const chunk = this.chunkQueue[0];
      const available = chunk.left.length - chunk.offset;
      const copyFrames = Math.min(frames - writeOffset, available);
      left.set(chunk.left.subarray(chunk.offset, chunk.offset + copyFrames), writeOffset);
      right.set(chunk.right.subarray(chunk.offset, chunk.offset + copyFrames), writeOffset);
      chunk.offset += copyFrames;
      writeOffset += copyFrames;
      this.queuedFrames -= copyFrames;

      if (chunk.offset >= chunk.left.length) {
        this.chunkQueue.shift();
      }
    }
  }
}

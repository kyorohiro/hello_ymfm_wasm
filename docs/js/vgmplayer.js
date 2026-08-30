import { Ym2612VGM } from "./ym2612vgm.js";

/**
 * One rendered stereo chunk waiting to be copied into the audio callback
 * buffers.
 *
 * @typedef {{
 *   left: Float32Array,
 *   right: Float32Array,
 *   offset: number,
 * }} VgmAudioChunk
 */

/**
 * Minimal audio engine shape used by `VgmPlayer`.
 *
 * @typedef {{
 *   reset(): void,
 *   sampleRate(): number,
 *   writeYm2612(port: number, register: number, value: number): void,
 *   writePsg(value: number): void,
 *   processFrames(frames: number): { left: Float32Array, right: Float32Array },
 * }} VgmPlaybackEngine
 */

/**
 * Streaming VGM player that steps a `Ym2612VGM` parser and renders audio
 * into queued stereo chunks.
 */
export class VgmPlayer {
  /**
   * @param {VgmPlaybackEngine} engine
   */
  constructor(engine) {
    /** @type {VgmPlaybackEngine} */
    this.engine = engine;
    /** @type {Ym2612VGM | null} */
    this.parser = null;
    /** @type {boolean} */
    this.loopEnabled = false;
    /** @type {boolean} */
    this.playing = false;
    /** @type {boolean} */
    this.paused = false;
    /** @type {number} */
    this.prefetchFactor = 2;
    /** @type {number} */
    this.maxFillStepsPerProcess = 512;
    /** @type {number} */
    this.waitAccumulator = 0;
    /** @type {VgmAudioChunk[]} */
    this.chunkQueue = [];
    /** @type {number} */
    this.queuedFrames = 0;
    /** @type {number} */
    this.processedEvents = 0;
    /** @type {number} */
    this.processedWaitSamples = 0;
  }

  /**
   * Load one VGM buffer and reset playback state.
   *
   * @param {ArrayBuffer | Uint8Array} buffer
   * @param {ConstructorParameters<typeof Ym2612VGM>[1]} [options]
   * @returns {void}
   */
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

  /**
   * Reset both parser and playback engine to the start of the loaded VGM.
   *
   * @returns {void}
   */
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

  /**
   * Start playback from the current parser position.
   *
   * @returns {void}
   */
  play() {
    if (!this.parser) {
      throw new Error("No VGM buffer is loaded");
    }
    this.playing = true;
    this.paused = false;
  }

  /**
   * Pause playback without clearing the queued audio chunks.
   *
   * @returns {void}
   */
  pause() {
    if (!this.parser) {
      return;
    }
    this.playing = false;
    this.paused = true;
  }

  /**
   * Resume playback after `pause()`.
   *
   * @returns {void}
   */
  resume() {
    if (!this.parser) {
      throw new Error("No VGM buffer is loaded");
    }
    this.playing = true;
    this.paused = false;
  }

  /**
   * Stop playback and reset parser/engine state to the beginning.
   *
   * @returns {void}
   */
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

  /**
   * @param {number} factor
   * @returns {void}
   */
  setPrefetchFactor(factor) {
    const numeric = Number(factor);
    if (!Number.isFinite(numeric)) {
      return;
    }
    this.prefetchFactor = Math.min(8, Math.max(1, numeric));
  }

  /**
   * @param {number} steps
   * @returns {void}
   */
  setMaxFillStepsPerProcess(steps) {
    const numeric = Number(steps);
    if (!Number.isFinite(numeric)) {
      return;
    }
    this.maxFillStepsPerProcess = Math.max(32, Math.floor(numeric));
  }

  /**
   * Enable or disable loop playback.
   *
   * @param {boolean} enabled
   * @returns {void}
   */
  setLoopEnabled(enabled) {
    this.loopEnabled = enabled;
  }

  /**
   * @returns {boolean}
   */
  isPlaying() {
    return this.playing;
  }

  /**
   * @returns {boolean}
   */
  isPaused() {
    return this.paused;
  }

  /**
   * Output sample rate of the underlying playback engine.
   *
   * @returns {number}
   */
  sampleRate() {
    return this.engine.sampleRate();
  }

  /**
   * @param {number} volume
   * @returns {number}
   */
  setMasterVolume(volume) {
    if (typeof this.engine.setMasterVolume === "function") {
      return this.engine.setMasterVolume(volume);
    }
    return 1;
  }

  /**
   * @returns {number}
   */
  getMasterVolume() {
    if (typeof this.engine.getMasterVolume === "function") {
      return this.engine.getMasterVolume();
    }
    return 1;
  }

  /**
   * Return a small playback status snapshot for UI/debug use.
   *
   * @returns {{
   *   playing: boolean,
   *   paused: boolean,
   *   queuedFrames: number,
   *   processedEvents: number,
   *   processedWaitSamples: number,
   *   totalSamples: number,
   *   audioProgress: number,
   * }}
   */
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

  /**
   * Fill one stereo output buffer from the queued rendered chunks.
   *
   * When playback is active, this also steps the parser forward and renders
   * more audio until a small queue target is reached.
   *
   * @param {Float32Array} left
   * @param {Float32Array} right
   * @param {number} frames
   * @returns {void}
   */
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

  /**
   * Pull parser events until enough audio is queued or playback ends.
   *
   * @param {number} targetFrames
   * @returns {void}
   */
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
        ym2203: typeof this.engine.writeYm2203 === "function"
          ? { writeRegister: (register, value) => this.engine.writeYm2203(register, value) }
          : undefined,
        psg: { write: (value) => this.engine.writePsg(value) },
      });
      this.processedEvents += 1;

      if (event.type === "wait") {
        this.parser.consumeWait(
          {
            ym2612: { writeRegister: (register, value, port = 0) => this.engine.writeYm2612(port, register, value) },
            ym2203: typeof this.engine.writeYm2203 === "function"
              ? { writeRegister: (register, value) => this.engine.writeYm2203(register, value) }
              : undefined,
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

  /**
   * Render one VGM wait segment into engine frames and enqueue the result.
   *
   * VGM wait lengths are expressed in 44.1kHz sample units, so this method
   * rescales them into the current engine sample rate.
   *
   * @param {number} vgmSamples
   * @returns {void}
   */
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

  /**
   * Copy queued chunks into the current output buffers.
   *
   * @param {Float32Array} left
   * @param {Float32Array} right
   * @param {number} frames
   * @returns {void}
   */
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

/**
 * @file vgmplayer.js
 * 実行環境: Browser / Node.js
 * 依存: VGM パーサーと注入された音声エンジン。PCM 生成にはエンジンが必要。AudioContext は不要。
 */
import { Ym2612VGM } from "./ym2612vgm.js?v=dac-warning-1";

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
 *   writeYm2608?(port: number, register: number, value: number): void,
 *   loadAdpcmBMemory?(data: Uint8Array, offset: number, memorySize: number): void,
 *   clearAdpcmBMemory?(): void,
 *   writeAy8910?(register: number, value: number): void,
 *   writeK051649?(port: number, register: number, value: number): void,
 *   writeSegaPcm?(offset: number, value: number): void,
 *   writeGameboyApu?(register: number, value: number): void,
 *   writeY8950?(register: number, value: number): void,
 *   writeYmf278b?(port: number, register: number, value: number): void,
 *   loadSampleMemory?(data: Uint8Array, offset: number, memorySize: number): void,
 *   clearSampleMemory?(): void,
 *   writeYm3526?(register: number, value: number): void,
 *   writeYm3812?(register: number, value: number): void,
 *   writeYmf262?(port: number, register: number, value: number): void,
 *   writeYm2151?(register: number, value: number): void,
 *   writeYm2413?(register: number, value: number): void,
 *   writeYm2203?(register: number, value: number): void,
 *   writeRf5c164?(register: number, value: number): void,
 *   writeRf5c164Memory?(offset: number, value: number): void,
 *   loadRf5c164Memory?(data: Uint8Array, offset: number): void,
 *   clearRf5c164Memory?(): void,
 *   writePsg(value: number): void,
 *   processFrames(frames: number): { left: Float32Array, right: Float32Array },
 * }} VgmPlaybackEngine
 */

/**
 * Streaming VGM player that steps a `Ym2612VGM` parser and renders audio
 * into queued stereo chunks.
 */
export class VgmPlayer {
  #states = new WeakMap();
  #checkpoints = [];
  #checkpointBytes = 0;
  #checkpointKey = '';
  #lastCheckpointAttemptFrame = -Infinity;
  #hasLooped = false;
  // Opt in for interactive playback; offline rendering should not retain checkpoints.
  checkpointIntervalSeconds = 0;
  checkpointMaxBytes = 32 * 1024 * 1024;
  checkpointMaxCount = 120;

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
    this.clearCheckpoints();
    this.parser = new Ym2612VGM(buffer, options);
    this.engine.clearOki6295Rom?.();
    this.engine.clearSampleMemory?.();
    this.engine.clearAdpcmBMemory?.();
    this.engine.clearAdpcmRoms?.();
    this.engine.clearRf5c164Memory?.();
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
    this.#hasLooped = false;
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
    this.#hasLooped = false;
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

  supportsState() { return Boolean(this.parser && this.engine.supportsState?.()); }
  renderedPositionFrames() {
    return Math.floor(this.processedWaitSamples * this.sampleRate() / 44100) - this.queuedFrames;
  }
  clearCheckpoints() { this.#checkpoints = []; this.#checkpointBytes = 0; this.#checkpointKey = ''; this.#lastCheckpointAttemptFrame = -Infinity; }
  checkpointStats() { return {count: this.#checkpoints.length, bytes: this.#checkpointBytes}; }
  saveState() {
    if (!this.supportsState()) throw new Error('Playback state saving unavailable');
    const data = {parser: this.parser.savePlaybackState(), engine: this.engine.saveState(),
      queue: structuredClone(this.chunkQueue), queuedFrames: this.queuedFrames,
      waitAccumulator: this.waitAccumulator, processedEvents: this.processedEvents,
      processedWaitSamples: this.processedWaitSamples, hasLooped: this.#hasLooped,
      playing: this.playing, paused: this.paused, ui: this.captureSeekState?.()};
    const byteLength = stateByteLength(data.parser) + stateByteLength(data.queue) + stateByteLength(data.ui) + data.engine.byteLength + 256;
    const state = Object.freeze({byteLength, frame: this.renderedPositionFrames()});
    this.#states.set(state, {source: this.parser, data}); return state;
  }
  loadState(state) {
    const saved = this.#states.get(state);
    if (!this.supportsState() || !saved || saved.source !== this.parser) throw new Error('Invalid or foreign playback state');
    const d = saved.data;
    this.engine.validateState(d.engine);
    // Allocate JS copies before modifying native chips.
    const queue = structuredClone(d.queue), parser = structuredClone(d.parser);
    this.engine.loadState(d.engine);
    this.parser.loadPlaybackState(parser);
    this.chunkQueue = queue;
    for (const key of ['queuedFrames', 'waitAccumulator', 'processedEvents', 'processedWaitSamples', 'playing', 'paused']) this[key] = d[key];
    this.#hasLooped = d.hasLooped;
    if (d.ui !== undefined) this.restoreSeekState?.(structuredClone(d.ui));
  }
  #checkSettings() {
    const key = this.engine.stateSettingsKey?.() + ':' + (this.seekSettingsKey?.() ?? '');
    if (key !== this.#checkpointKey) { this.clearCheckpoints(); this.#checkpointKey = key; }
  }
  captureCheckpoint() {
    if (!this.supportsState() || this.#hasLooped || !(this.checkpointIntervalSeconds > 0)) return;
    this.#checkSettings();
    const frame = this.renderedPositionFrames();
    // Oversized states must not be cloned again on every audio callback.
    if (!(this.checkpointMaxCount > 0) || !(this.checkpointMaxBytes > 0) || Math.abs(frame - this.#lastCheckpointAttemptFrame) < this.sampleRate() * this.checkpointIntervalSeconds) return;
    if (frame < this.sampleRate() * this.checkpointIntervalSeconds || this.#checkpoints.some(s => Math.abs(s.frame - frame) < this.sampleRate() * this.checkpointIntervalSeconds)) return;
    this.#lastCheckpointAttemptFrame = frame;
    const state = this.saveState();
    if (state.byteLength > this.checkpointMaxBytes) return;
    this.#checkpoints.push(state); this.#checkpointBytes += state.byteLength;
    while (this.#checkpointBytes > this.checkpointMaxBytes || this.#checkpoints.length > this.checkpointMaxCount) {
      this.#checkpointBytes -= this.#checkpoints.shift().byteLength;
    }
  }
  restoreCheckpoint(targetFrame) {
    if (!this.supportsState()) return 0;
    this.#checkSettings();
    const state = this.#checkpoints.filter(s => s.frame <= targetFrame).sort((a,b) => b.frame - a.frame)[0];
    if (!state) return 0;
    this.loadState(state); return state.frame;
  }

  /**
   * Adjust the render-ahead queue target relative to the render chunk size.
   * @param {number} factor Clamped to 1..8; nonfinite values are ignored.
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
   * Discard already-generated audio after a live mute/parameter change.
   * Keep the parser, chip state, fractional sample timing and play/pause state.
   */
  clearQueuedAudio() {
    this.clearCheckpoints();
    this.chunkQueue = [];
    this.queuedFrames = 0;
  }

  /**
   * Limit parser/render work per process call to bound synchronous work.
   * @param {number} steps Floored to an integer, minimum 32; nonfinite values are ignored.
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
   * queuedFrames uses the engine output rate. processedWaitSamples and totalSamples
   * use the 44100 Hz VGM timeline. audioProgress is a percentage of parsed waits,
   * which may run ahead of audible playback because of prefetched audio.
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
   * @returns {number} Audio frames copied, excluding end-of-track zero padding.
   */
  process(left, right, frames) {
    if (!this.parser || this.paused) {
      left.fill(0, 0, frames);
      right.fill(0, 0, frames);
      return 0;
    }

    if (this.playing) {
      this.#fillQueue(Math.ceil(frames * this.prefetchFactor), frames);
    }

    if (!this.playing && !this.paused && this.queuedFrames === 0) {
      left.fill(0, 0, frames);
      right.fill(0, 0, frames);
      return 0;
    }

    const copied = this.#copyQueuedFrames(left, right, frames);
    this.captureCheckpoint();
    return copied;
  }

  /**
   * Pull parser events until enough audio is queued or playback ends.
   *
   * @param {number} targetFrames
   * @returns {void}
   */
  #fillQueue(targetFrames, requiredFrames = targetFrames) {
    let steps = 0;
    // The normal budget limits speculative prefetch, not the audio requested
    // by the caller. Dense direct DAC/PWM writes can need thousands of events.
    // Retain a hard bound for malformed streams / loops with no time progress.
    const hardLimit = Math.max(this.maxFillStepsPerProcess, 65536, requiredFrames * 64);
    while (
      this.playing &&
      this.queuedFrames < targetFrames &&
      steps < hardLimit &&
      (steps < this.maxFillStepsPerProcess || this.queuedFrames < requiredFrames)
    ) {
      steps += 1;
      const targets = this.engine.vgmTargets ?? createVgmTargets(this.engine);
      const event = this.parser.playStep(targets);
      this.processedEvents += 1;

      if (event.type === "wait") {
        this.parser.consumeWait(
          targets,
          event.samples,
          (vgmSamples) => this.#renderWaitSegment(vgmSamples),
        );
        continue;
      }

      if (event.type === "end") {
        if (this.loopEnabled) {
          this.#hasLooped = true;
          if (this.parser.hasLoop()) {
            this.parser.position = this.parser.header.loopOffset;
            this.parser.ended = false;
          } else {
            this.parser.reset();
            this.engine.reset();
            // Preserve rendered audio and fractional output timing across cycles.
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
        return writeOffset;
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
    return writeOffset;
  }
}

// Conservative retained-memory estimate, counting shared buffers once per snapshot.
function stateByteLength(value, seen = new Set()) {
  if (value == null) return 0;
  if (typeof value !== 'object') return typeof value === 'string' ? value.length * 2 : 8;
  if (seen.has(value)) return 0;
  seen.add(value);
  if (ArrayBuffer.isView(value)) return stateByteLength(value.buffer, seen);
  if (value instanceof ArrayBuffer) return value.byteLength;
  const children = value instanceof Map ? [...value.entries()].flat() : value instanceof Set ? [...value] : Object.values(value);
  return 64 + children.reduce((n,v) => n + stateByteLength(v, seen), 0);
}

// Shared register/memory adapters for legacy engines and the generic mixer.
export function createVgmTargets(engine) {
  const ym2612Target = typeof engine.writeYm2612 === "function"
    ? { writeRegister: (register, value, port = 0) => engine.writeYm2612(port, register, value) }
    : undefined;
  const ay8910Target = typeof engine.writeAy8910 === "function"
    ? { writeRegister: (register, value) => engine.writeAy8910(register, value) }
    : undefined;
  const k051649Target = typeof engine.writeK051649 === "function"
    ? { writeRegister: (port, register, value) => engine.writeK051649(port, register, value) }
    : undefined;
  const segapcmTarget = typeof engine.writeSegaPcm === "function" ? {
    writeRegister: (offset, value) => engine.writeSegaPcm(offset, value),
    loadSampleMemory: (...args) => engine.loadSampleMemory(...args),
  } : undefined;
  const gameboyDmgTarget = typeof engine.writeGameboyApu === "function"
    ? { writeRegister: (register, value) => engine.writeGameboyApu(register, value) }
    : undefined;
  const y8950Target = typeof engine.writeY8950 === 'function' ? {
    writeRegister: (register, value) => engine.writeY8950(register, value),
    loadSampleMemory: (...args) => engine.loadSampleMemory(...args),
  } : undefined;
  const ymf278bTarget = typeof engine.writeYmf278b === 'function' ? {
    writeRegister: (register, value, port) => engine.writeYmf278b(port, register, value),
    loadSampleMemory: (...args) => engine.loadSampleMemory(...args),
  } : undefined;
  const ym3526Target = typeof engine.writeYm3526 === "function"
    ? { writeRegister: (register, value) => engine.writeYm3526(register, value) } : undefined;
  const ym3812Target = typeof engine.writeYm3812 === "function"
    ? { writeRegister: (register, value) => engine.writeYm3812(register, value) } : undefined;
  const ymf262Target = typeof engine.writeYmf262 === "function"
    ? { writeRegister: (register, value, port) => engine.writeYmf262(port, register, value) } : undefined;
  const ym2151Target = typeof engine.writeYm2151 === "function"
    ? { writeRegister: (register, value) => engine.writeYm2151(register, value) }
    : undefined;
  const ym2413Target = typeof engine.writeYm2413 === "function"
    ? { writeRegister: (register, value) => engine.writeYm2413(register, value) }
    : undefined;
  const ym2203Target = typeof engine.writeYm2203 === "function"
    ? { writeRegister: (register, value) => engine.writeYm2203(register, value) }
    : undefined;
  const ym2608Target = typeof engine.writeYm2608 === "function"
    ? {
      writeRegister: (register, value, port = 0) => engine.writeYm2608(port, register, value),
      loadAdpcmBMemory: typeof engine.loadAdpcmBMemory === "function"
        ? (data, offset, memorySize) => engine.loadAdpcmBMemory(data, offset, memorySize)
        : undefined,
    }
    : undefined;
  const ym2610Target = typeof engine.writeYm2610B === 'function' ? {
    writeRegister:(register,value,port=0)=>engine.writeYm2610B(port,register,value),
    loadAdpcmRom:(...args)=>engine.loadAdpcmRom(...args),
  } : undefined;
  const rf5c164Target = typeof engine.writeRf5c164 === "function" ? {
    writeRegister: (register, value) => engine.writeRf5c164(register, value),
    writeMemory: (offset, value) => engine.writeRf5c164Memory(offset, value),
    loadBankedMemory: (data, offset) => engine.loadRf5c164Memory(data, offset),
  } : undefined;
  return {
    resolveChip: engine.getVgmTarget?.bind(engine),
    pwm: { writeRegister: (register, value) => engine.writePwm?.(register, value) },
    rf5c164: rf5c164Target,
    ym2612: ym2612Target,
    ym2203: ym2203Target,
    ym2413: ym2413Target,
    ym2151: ym2151Target,
    huc6280: typeof engine.writeHuc6280 === "function" ? {
      writeRegister:(r,v)=>engine.writeHuc6280(r,v),
      writeStream:(p,r,v)=>engine.writeHuc6280Stream(p,r,v),
    } : undefined,
    okim6295: typeof engine.writeOki6295 === 'function' ? {
      writeRegister:(r,v)=>engine.writeOki6295(r,v),
      loadSampleMemory:(data,offset,size)=>engine.loadOki6295Rom(data,offset,size),
    } : undefined,
    okim6258: typeof engine.writeOki6258 === "function" ? {writeRegister:(r,v)=>engine.writeOki6258(r,v)} : undefined,
    ym3526: ym3526Target, ym3812: ym3812Target, ymf262: ymf262Target,
    y8950: y8950Target, ymf278b: ymf278bTarget,
    ay8910: ay8910Target,
    k051649: k051649Target,
    segapcm: segapcmTarget,
    nesApu: typeof engine.writeNesApu === 'function' ? {
      writeRegister:(r,v)=>engine.writeNesApu(r,v),
      loadSampleMemory:(data,offset)=>engine.loadNesMemory(data,offset),
    } : undefined,
    gameboyDmg: gameboyDmgTarget,
    ym2608: ym2608Target,
    ym2610: ym2610Target,
    psg: { write: (value) => engine.writePsg?.(value) },
  };
}

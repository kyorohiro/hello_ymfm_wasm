import {
  MegaSynthRecordingManager,
} from "./megasynth_recording.js";
import {
  YM2612Synth,
  YM2612WorkletTransport,
} from "./ym2612synth.js";
import { YM2612_CLOCK } from "./ym2612.js";
export {
  createFXBranch,
  createBitcrusherFX,
  createChorusFX,
  createFXParallel,
  createDelayFX,
  createEqFX,
  createFilterFX,
  createGainFX,
  createLofiFX,
  createRadioToneFX,
  createReverbFX,
  createSlicerFX,
  createStereoWidthFX,
  createTapeSaturationFX,
} from "./megasynth_fx.js";
export { MegaSynthLooper } from "./looper.js";
export {
  FM_PRESETS,
  FM_PRESET_ORDER,
} from "./megadrive-fm-presets.js";

const NATIVE_FETCH =
  typeof globalThis.fetch ===
  "function"
    ? globalThis.fetch.bind(globalThis)
    : null;

// YM2612 outputs one mixed sample every 144 master clocks.
// Keep its clock domain intact and let Web Audio resample for the device.
const YM2612_NATIVE_SAMPLE_RATE =
  Math.floor(YM2612_CLOCK / 144);

/**
 * @typedef {import("./megasynth_fx.js").AnyFXUnit} AnyFXUnit
 * @typedef {import("./ym2612synth.js").YM2612Synth} YM2612Synth
 * @typedef {import("./ym2612synth.js").YM2612Transport} YM2612Transport
 */

/**
 * @typedef {{
 *   gain?: number,
 *   playbackRate?: number,
 *   offset?: number,
 *   duration?: number,
 *   loop?: boolean,
 *   loopStart?: number,
 *   loopEnd?: number,
 *   fadeIn?: number,
 *   fadeOut?: number,
 *   pan?: number,
 * }} MegaSynthSamplePlayOptions
 */

/**
 * @typedef {{
 *   name: string,
 *   source: AudioBufferSourceNode,
 *   gainNode: GainNode,
 *   pannerNode: StereoPannerNode | GainNode,
 *   stop(): void,
 * }} MegaSynthSampleVoice
 */

/**
 * @typedef {{
 *   load(name: string, source: string | ArrayBuffer | AudioBuffer): Promise<AudioBuffer>,
 *   play(name: string, options?: MegaSynthSamplePlayOptions): MegaSynthSampleVoice,
 *   stop(name?: string): void,
 *   stopAll(): void,
 *   unload(name: string): boolean,
 *   isLoaded(name: string): boolean,
 *   get(name: string): AudioBuffer | null,
 *   list(): string[],
 * }} MegaSynthSampleAPI
 */

/**
 * @typedef {{
 *   gain?: number,
 *   playbackRate?: number,
 *   offset?: number,
 *   loop?: boolean,
 *   fadeIn?: number,
 *   fadeOut?: number,
 *   pan?: number,
 * }} MegaSynthStreamPlayOptions
 */

/**
 * @typedef {{
 *   name: string,
 *   element: HTMLAudioElement,
 *   sourceNode: MediaElementAudioSourceNode,
 *   gainNode: GainNode,
 *   pannerNode: StereoPannerNode | GainNode,
 *   play(options?: MegaSynthStreamPlayOptions): Promise<void>,
 *   pause(): void,
 *   stop(): void,
 * }} MegaSynthStreamEntry
 */

/**
 * @typedef {{
 *   load(name: string, url: string): Promise<MegaSynthStreamEntry>,
 *   play(name: string, options?: MegaSynthStreamPlayOptions): Promise<MegaSynthStreamEntry>,
 *   pause(name?: string): void,
 *   stop(name?: string): void,
 *   unload(name: string): boolean,
 *   isLoaded(name: string): boolean,
 *   get(name: string): MegaSynthStreamEntry | null,
 *   list(): string[],
 * }} MegaSynthStreamAPI
 */

/**
 * @typedef {{
 *   audioContext?: AudioContext | null,
 *   outputNode?: AudioNode | null,
 *   workletUrl?: string,
 *   stereoWidthWorkletUrl?: string,
 *   bitcrusherWorkletUrl?: string,
 *   ym2612WasmUrl?: string,
 *   chipSampleRate?: number,
 *   masterVolume?: number,
 *   sampleOutputNode?: AudioNode | null,
 * }} MegaSynthOptions
 */

/**
 * @param {string} workletUrl
 * @param {string} siblingName
 * @returns {string}
 */
function resolveSiblingWorkletUrl(
  workletUrl,
  siblingName
) {
  const lastSlash =
    String(workletUrl).lastIndexOf("/");

  if (lastSlash < 0) {
    return `./${siblingName}`;
  }

  return (
    String(workletUrl).slice(
      0,
      lastSlash + 1
    ) + siblingName
  );
}

/**
 * @typedef {{
 *   dispose?: boolean,
 * }} FXChainOptions
 */

/**
 * @typedef {{
 *   type: "reset",
 * } | {
 *   type: "setPreset",
 *   channel: number,
 *   preset: object,
 * } | {
 *   type: "setOperator",
 *   channel: number,
 *   operator: number,
 *   params: object,
 * } | {
 *   type: "setAlgo",
 *   channel: number,
 *   algorithm: number,
 *   feedback: number,
 * } | {
 *   type: "setPan",
 *   channel: number,
 *   left: boolean,
 *   right: boolean,
 * } | {
 *   type: "setChannel3SpecialMode",
 *   enabled: boolean,
 * } | {
 *   type: "setChannel3SpecialFrequency",
 *   operator: number,
 *   block: number,
 *   fnum: number,
 * } | {
 *   type: "setDacEnabled",
 *   enabled: boolean,
 * } | {
 *   type: "writeDac",
 *   value: number,
 * } | {
 *   type: "noteOn",
 *   channel: number,
 *   block: number,
 *   fnum: number,
 * } | {
 *   type: "noteOff",
 *   channel: number,
 * } | {
 *   type: "setMasterVolume",
 *   volume: number,
 * }} MegaSynthEvent
 */

/**
 * @callback MegaSynthListener
 * @param {MegaSynthEvent} event
 * @returns {void}
 */

/**
 * Browser-side Mega / Genesis-oriented synth runtime.
 *
 * This class hides:
 *
 * - AudioContext
 * - AudioWorkletNode
 * - YM2612 WASM loading
 * - AudioWorklet initialization
 *
 * The YM2612 control API itself is exposed through `fm`.
 *
 * Future:
 *
 * - Sega PSG
 * - DAC helpers
 * - sample-timed scheduling
 * - VGM playback
 */
export class MegaSynth {
  /**
   * @param {MegaSynthOptions} [options]
   */
  constructor(options = {}) {
    this.ownsAudioContext =
      !options.audioContext;

    this.workletUrl =
      options.workletUrl ?? "./ym2612-worklet.js";
    this.stereoWidthWorkletUrl =
      options.stereoWidthWorkletUrl ??
      resolveSiblingWorkletUrl(
        this.workletUrl,
        "stereo-width-worklet.js"
      );
    this.bitcrusherWorkletUrl =
      options.bitcrusherWorkletUrl ??
      resolveSiblingWorkletUrl(
        this.workletUrl,
        "bitcrusher-worklet.js"
      );

    this.ym2612WasmUrl =
      options.ym2612WasmUrl ?? "./generated/ym2612_wasm.wasm";
    this.chipSampleRate = clampChipSampleRate(
      options.chipSampleRate ??
        YM2612_NATIVE_SAMPLE_RATE
    );

    /**
     * Optional. When set, the worklet also loads a Sega PSG core and mixes
     * it with the YM2612 output, exposed on `this.psg`. Left unset by
     * default so callers that only want YM2612 (e.g. the Synth demo) are
     * unaffected.
     */
    this.segaPsgWasmUrl =
      options.segaPsgWasmUrl ?? null;

    this.audioContext =
      options.audioContext ?? null;

    this.outputNode =
      options.outputNode ?? null;
    this.masterVolume =
      clampMasterVolume(
        options.masterVolume ?? 1
      );
    this.sampleOutputNode =
      options.sampleOutputNode ?? null;

    this.node = null;
    this.masterInputNode = null;
    this.masterOutputNode = null;
    this.fxChain = [];
    this.recordingManager = null;
    this._recordingHooksInstalled =
      false;
    this.listeners = new Set();

    /** @type {YM2612Synth | null} */
    this.fm = null;

    /** @type {{ write(value: number): void, reset(): void } | null} */
    this.psg = null;

    this.sampleBuffers = new Map();
    this.sampleVoices = new Set();
    /** @type {MegaSynthSampleAPI} */
    this.sample = this.#createSampleApi();
    this.streamEntries = new Map();
    /** @type {MegaSynthStreamAPI} */
    this.stream = this.#createStreamApi();

    /** @type {Promise<void> | null} */
    this.readyPromise = null;
    /** @type {"idle" | "starting" | "ready" | "error" | "closed"} */
    this.state = "idle";
  }

  /**
   * Initialize and start the browser audio runtime.
   *
   * This should normally be called from a user gesture such as
   * a click, pointerdown, or keydown event.
   *
    * @returns {Promise<MegaSynth>}
   */
  async start() {
    if (this.readyPromise) {
      await this.readyPromise;
      await this.resume();
      return this;
    }

    this.state = "starting";
    this.readyPromise = this.#initialize();

    try {
      await this.readyPromise;
    } catch (error) {
      this.readyPromise = null;
      this.state = "error";
      throw error;
    }

    await this.resume();
    this.state = "ready";

    return this;
  }

  /**
   * @returns {Promise<void>}
   */
  async resume() {
    if (
      this.audioContext &&
      this.audioContext.state !== "running"
    ) {
      await this.audioContext.resume();
    }
  }

  /**
   * @returns {Promise<void>}
   */
  async suspend() {
    if (
      this.audioContext &&
      this.audioContext.state === "running"
    ) {
      await this.audioContext.suspend();
    }
  }

  /**
   * @returns {void}
   */
  reset() {
    this.fm?.reset();
  }

  /**
   * Subscribe to high-level FM actions coming from `fm`.
   *
   * This stays on `MegaSynth` so UI/demo sync logic does not have to live
   * inside the lower-level `YM2612Synth`.
   *
   * @param {MegaSynthListener} listener
   * @returns {() => void}
   */
  addListener(listener) {
    if (typeof listener !== "function") {
      throw new Error(
        "listener must be a function"
      );
    }

    this.listeners.add(listener);
    return () => {
      this.removeListener(listener);
    };
  }

  /**
   * @param {MegaSynthListener} listener
   * @returns {void}
   */
  removeListener(listener) {
    this.listeners.delete(listener);
  }

  /**
   * @param {AnyFXUnit[]} [effects]
   * @param {FXChainOptions} [options]
   * @returns {void}
   */
  setFXChain(
    effects = [],
    options = {}
  ) {
    if (!Array.isArray(effects)) {
      throw new Error(
        "FX chain must be an array"
      );
    }

    const previousChain =
      this.fxChain.slice();
    this.fxChain = effects.slice();

    if (this.masterInputNode) {
      this.#rebuildFXChain();
    }

    if (options.dispose) {
      for (const effect of previousChain) {
        effect?.dispose?.();
      }
    }
  }

  /**
   * @returns {AnyFXUnit[]}
   */
  getFXChain() {
    return this.fxChain.slice();
  }

  /**
   * @param {AnyFXUnit} effect
   * @returns {MegaSynth}
   */
  connect(effect) {
    this.fxChain.push(effect);

    if (this.masterInputNode) {
      this.#rebuildFXChain();
    }

    return this;
  }

  /**
   * @param {FXChainOptions} [options]
   * @returns {AnyFXUnit[]}
   */
  clearFXChain(options = {}) {
    const previousChain =
      this.fxChain.slice();
    this.fxChain = [];

    if (this.masterInputNode) {
      this.#rebuildFXChain();
    }

    if (options.dispose) {
      for (const effect of previousChain) {
        effect?.dispose?.();
      }
    }

    return previousChain;
  }

  /**
   * @param {AudioNode | null} [node]
   * @returns {MegaSynth}
   */
  connectOutput(node = null) {
    this.outputNode =
      node ??
      this.outputNode ??
      this.audioContext?.destination ??
      null;

    if (this.masterInputNode) {
      this.#rebuildFXChain();
    }

    return this;
  }

  /**
   * Set the final browser-side output gain after the current FX chain.
   *
   * This is not a YM2612 register write. It scales the mixed output at the
   * Web Audio level.
   *
   * @param {number} volume
   * @returns {number}
   */
  setMasterVolume(volume) {
    const nextVolume =
      clampMasterVolume(volume);
    this.masterVolume =
      nextVolume;

    if (this.masterOutputNode) {
      this.masterOutputNode.gain.value =
        nextVolume;
    }

    this.#emit({
      type: "setMasterVolume",
      volume: nextVolume,
    });

    return nextVolume;
  }

  /**
   * @returns {number}
   */
  getMasterVolume() {
    return this.masterVolume;
  }

  /**
   * @returns {*}
   */
  startRecord() {
    this.#ensureRecordingManager();
    return this.recordingManager.start();
  }

  /**
   * @returns {*}
   */
  stopRecord() {
    this.#ensureRecordingManager();
    return this.recordingManager.stop();
  }

  /**
   * @returns {*}
   */
  exportRecording() {
    this.#ensureRecordingManager();
    return this.recordingManager.exportRecording();
  }

  /**
   * @param {*} recording
   * @returns {*}
   */
  importRecording(recording) {
    this.#ensureRecordingManager();
    return this.recordingManager.importRecording(
      recording
    );
  }

  /**
   * @param {*} [recording=null]
   * @param {object} [options={}]
   * @returns {*}
   */
  playRecording(recording = null, options = {}) {
    this.#ensureRecordingManager();
    return this.recordingManager.play(
      recording,
      options
    );
  }

  /**
   * @returns {void}
   */
  stopRecordingPlayback() {
    this.#ensureRecordingManager();
    this.recordingManager.stopPlayback();
  }

  /**
   * @returns {boolean}
   */
  isRecording() {
    return (
      this.recordingManager?.isRecording() ??
      false
    );
  }

  /**
   * @returns {boolean}
   */
  isRecordingPlaybackActive() {
    return (
      this.recordingManager?.isPlaying() ??
      false
    );
  }

  /**
   * @returns {Promise<void>}
   */
  async close() {
    this.sample.stopAll();
    this.sampleBuffers.clear();
    this.stream.stop();
    for (const name of this.stream.list()) {
      this.stream.unload(name);
    }

    if (this.node) {
      this.node.disconnect();
      this.node = null;
    }

    this.masterInputNode?.disconnect();
    this.masterInputNode = null;
    this.masterOutputNode?.disconnect();
    this.masterOutputNode = null;

    this.fm = null;
    this._recordingHooksInstalled =
      false;
    this.readyPromise = null;
    this.state = "closed";

    if (
      this.audioContext &&
      this.ownsAudioContext
    ) {
      await this.audioContext.close();
      this.audioContext = null;
    }
  }

  /**
   * @returns {boolean}
   */
  isReady() {
    return this.state === "ready" && !!this.fm;
  }

  /**
   * @returns {boolean}
   */
  isStarting() {
    return this.state === "starting";
  }

  #createAudioContext() {
    return new AudioContext({
      sampleRate: this.chipSampleRate,
    });
  }

  async #initialize() {
    if (!this.audioContext) {
      this.audioContext = this.#createAudioContext();
    }

    if (this.audioContext.state !== "running") {
      await this.audioContext.resume();
    }

    await this.audioContext.audioWorklet.addModule(
      this.workletUrl
    );
    if (
      this.stereoWidthWorkletUrl &&
      this.audioContext.audioWorklet
    ) {
      try {
        await this.audioContext.audioWorklet.addModule(
          this.stereoWidthWorkletUrl
        );
      } catch (error) {
        console.warn(
          "Stereo width worklet load failed; falling back to built-in stereo width routing if needed.",
          error
        );
      }
    }
    if (
      this.bitcrusherWorkletUrl &&
      this.audioContext.audioWorklet
    ) {
      try {
        await this.audioContext.audioWorklet.addModule(
          this.bitcrusherWorkletUrl
        );
      } catch (error) {
        console.warn(
          "Bitcrusher worklet load failed; fx.bitcrusher() will be unavailable.",
          error
        );
      }
    }

    const response = await fetch(
      this.ym2612WasmUrl
    );

    if (!response.ok) {
      throw new Error(
        `Failed to load YM2612 WASM: ${response.status} ${response.statusText}`
      );
    }

    const wasmBinary =
      await response.arrayBuffer();

    let psgWasmBinary = null;
    if (this.segaPsgWasmUrl) {
      const psgResponse = await fetch(
        this.segaPsgWasmUrl
      );

      if (!psgResponse.ok) {
        throw new Error(
          `Failed to load Sega PSG WASM: ${psgResponse.status} ${psgResponse.statusText}`
        );
      }

      psgWasmBinary =
        await psgResponse.arrayBuffer();
    }

    this.node =
      new AudioWorkletNode(
        this.audioContext,
        "ym2612-processor",
        {
          numberOfInputs: 0,
          numberOfOutputs: 1,
          outputChannelCount: [2],
        }
      );

    this.masterInputNode =
      this.audioContext.createGain();
    this.masterOutputNode =
      this.audioContext.createGain();
    this.masterOutputNode.gain.value =
      this.masterVolume;
    this.node.connect(
      this.masterInputNode
    );
    this.#rebuildFXChain();

    const workletReady =
      this.#waitForWorkletReady();

    const transferList = [wasmBinary];
    if (psgWasmBinary) {
      transferList.push(psgWasmBinary);
    }

    this.node.port.postMessage(
      {
        type: "initialize",
        wasmBinary,
        psgWasmBinary,
      },
      transferList
    );

    await workletReady;

    const transport =
      new YM2612WorkletTransport(
        this.node
      );

    this.fm =
      new YM2612Synth({
        transport,
      });

    if (psgWasmBinary) {
      const node = this.node;
      this.psg = {
        write(value) {
          node.port.postMessage({
            type: "psg-write",
            value,
          });
        },
        reset() {
          node.port.postMessage({
            type: "psg-reset",
          });
        },
        resetAll() {
          node.port.postMessage({
            type: "reset",
          });
        },
      };
    }

    this.#ensureRecordingManager();
    this.#installRecordingHooks();
  }

  /**
   * @returns {MegaSynthSampleAPI}
   */
  #createSampleApi() {
    return {
      load: (name, source) =>
        this.#loadSample(name, source),
      play: (name, options = {}) =>
        this.#playSample(name, options),
      stop: (name) =>
        this.#stopSample(name),
      stopAll: () =>
        this.#stopSample(),
      unload: (name) =>
        this.#unloadSample(name),
      isLoaded: (name) =>
        this.sampleBuffers.has(String(name)),
      get: (name) =>
        this.sampleBuffers.get(
          String(name)
        ) ?? null,
      list: () =>
        Array.from(
          this.sampleBuffers.keys()
        ),
    };
  }

  /**
   * @returns {MegaSynthStreamAPI}
   */
  #createStreamApi() {
    return {
      load: (name, url) =>
        this.#loadStream(name, url),
      play: (name, options = {}) =>
        this.#playStream(name, options),
      pause: (name) =>
        this.#pauseStream(name),
      stop: (name) =>
        this.#stopStream(name),
      unload: (name) =>
        this.#unloadStream(name),
      isLoaded: (name) =>
        this.streamEntries.has(
          String(name)
        ),
      get: (name) =>
        this.streamEntries.get(
          String(name)
        ) ?? null,
      list: () =>
        Array.from(
          this.streamEntries.keys()
        ),
    };
  }

  /**
   * @param {string} name
   * @param {string | ArrayBuffer | AudioBuffer} source
   * @returns {Promise<AudioBuffer>}
   */
  async #loadSample(name, source) {
    if (
      source === undefined &&
      typeof name === "string"
    ) {
      source = name;
    }

    if (
      typeof source === "string" &&
      (
        typeof name !== "string" ||
        name.length === 0 ||
        name === source
      )
    ) {
      name = source;
    }

    if (
      typeof name !== "string" ||
      name.length === 0
    ) {
      throw new Error(
        "sample.load(source) or sample.load(name, source) requires a non-empty name"
      );
    }

    const audioContext =
      this.audioContext ??
      this.#createAudioContext();

    if (!this.audioContext) {
      this.audioContext =
        audioContext;
      this.ownsAudioContext = true;
    }

    let audioBuffer = null;

    if (
      typeof AudioBuffer !== "undefined" &&
      source instanceof AudioBuffer
    ) {
      audioBuffer = source;
    } else if (typeof source === "string") {
      const normalizedSourceUrl =
        normalizeLocalMediaUrl(
          source
        );
      if (!NATIVE_FETCH) {
        throw new Error(
          "sample.load() requires fetch support"
        );
      }
      const response =
        await NATIVE_FETCH(
          normalizedSourceUrl
        );

      if (!response.ok) {
        throw new Error(
          `Failed to load sample "${name}": ${response.status} ${response.statusText}`
        );
      }

      const arrayBuffer =
        await response.arrayBuffer();
      audioBuffer =
        await decodeAudioBuffer(
          audioContext,
          arrayBuffer
        );
    } else if (source instanceof ArrayBuffer) {
      audioBuffer =
        await decodeAudioBuffer(
          audioContext,
          source
        );
    } else {
      throw new Error(
        "sample.load(source) or sample.load(name, source) source must be a URL string, ArrayBuffer, or AudioBuffer"
      );
    }

    this.sampleBuffers.set(
      name,
      audioBuffer
    );
    return audioBuffer;
  }

  /**
   * @param {string} name
   * @param {MegaSynthSamplePlayOptions} [options]
   * @returns {MegaSynthSampleVoice}
   */
  #playSample(name, options = {}) {
    if (!this.audioContext) {
      throw new Error(
        "sample.play() requires MegaSynth to be initialized first"
      );
    }

    const buffer =
      this.sampleBuffers.get(
        String(name)
      );

    if (!buffer) {
      throw new Error(
        `Unknown sample: ${name}`
      );
    }

    const source =
      this.audioContext.createBufferSource();
    source.buffer = buffer;

    const gainNode =
      this.audioContext.createGain();
    const stereoPannerSupported =
      typeof this.audioContext
        .createStereoPanner ===
      "function";
    const pannerNode =
      stereoPannerSupported
        ? this.audioContext.createStereoPanner()
        : this.audioContext.createGain();

    const playbackRate =
      normalizeFiniteNumber(
        options.playbackRate,
        1
      );
    const gain =
      normalizeFiniteNumber(
        options.gain,
        1
      );
    const offset =
      Math.max(
        0,
        normalizeFiniteNumber(
          options.offset,
          0
        )
      );
    const duration =
      options.duration == null
        ? null
        : Math.max(
            0,
            normalizeFiniteNumber(
              options.duration,
              0
            )
          );
    const fadeIn =
      Math.max(
        0,
        normalizeFiniteNumber(
          options.fadeIn,
          0
        )
      );
    const fadeOut =
      Math.max(
        0,
        normalizeFiniteNumber(
          options.fadeOut,
          0
        )
      );

    source.playbackRate.value =
      playbackRate;
    source.loop = options.loop === true;
    source.loopStart = Math.max(
      0,
      normalizeFiniteNumber(
        options.loopStart,
        0
      )
    );
    source.loopEnd = Math.max(
      0,
      normalizeFiniteNumber(
        options.loopEnd,
        0
      )
    );

    if (
      stereoPannerSupported &&
      "pan" in options
    ) {
      pannerNode.pan.value =
        Math.max(
          -1,
          Math.min(
            1,
            normalizeFiniteNumber(
              options.pan,
              0
            )
          )
        );
    }

    const now =
      this.audioContext.currentTime;
    gainNode.gain.cancelScheduledValues(
      now
    );
    if (fadeIn > 0) {
      gainNode.gain.setValueAtTime(
        0,
        now
      );
      gainNode.gain.linearRampToValueAtTime(
        gain,
        now + fadeIn
      );
    } else {
      gainNode.gain.setValueAtTime(
        gain,
        now
      );
    }

    source.connect(gainNode);
    gainNode.connect(pannerNode);
    pannerNode.connect(
      this.sampleOutputNode ??
        this.masterInputNode ??
        this.outputNode ??
        this.audioContext.destination
    );

    let stopped = false;
    const voice = {
      name: String(name),
      source,
      gainNode,
      pannerNode,
      stop: () => {
        if (stopped) {
          return;
        }

        stopped = true;
        const stopTime =
          this.audioContext.currentTime;

        if (fadeOut > 0) {
          gainNode.gain.cancelScheduledValues(
            stopTime
          );
          gainNode.gain.setValueAtTime(
            gainNode.gain.value,
            stopTime
          );
          gainNode.gain.linearRampToValueAtTime(
            0,
            stopTime + fadeOut
          );
          source.stop(
            stopTime + fadeOut
          );
        } else {
          source.stop();
        }
      },
    };

    source.addEventListener(
      "ended",
      () => {
        this.sampleVoices.delete(
          voice
        );
        try {
          source.disconnect();
        } catch {}
        try {
          gainNode.disconnect();
        } catch {}
        try {
          pannerNode.disconnect();
        } catch {}
      },
      { once: true }
    );

    this.sampleVoices.add(voice);

    if (duration != null) {
      source.start(now, offset, duration);
    } else {
      source.start(now, offset);
    }

    return voice;
  }

  /**
   * @param {string | undefined} [name]
   * @returns {void}
   */
  #stopSample(name) {
    for (const voice of this.sampleVoices) {
      if (
        name == null ||
        voice.name === String(name)
      ) {
        voice.stop();
      }
    }
  }

  /**
   * @param {string} name
   * @returns {boolean}
   */
  #unloadSample(name) {
    const normalizedName =
      String(name);
    this.#stopSample(normalizedName);
    return this.sampleBuffers.delete(
      normalizedName
    );
  }

  /**
   * @param {string} name
   * @param {string} url
   * @returns {Promise<MegaSynthStreamEntry>}
   */
  async #loadStream(name, url) {
    if (
      url === undefined &&
      typeof name === "string"
    ) {
      url = name;
    }

    if (
      typeof url === "string" &&
      (
        typeof name !== "string" ||
        name.length === 0 ||
        name === url
      )
    ) {
      name = url;
    }

    if (
      typeof name !== "string" ||
      name.length === 0
    ) {
      throw new Error(
        "stream.load(url) or stream.load(name, url) requires a non-empty name"
      );
    }
    if (
      typeof url !== "string" ||
      url.length === 0
    ) {
      throw new Error(
        "stream.load(url) or stream.load(name, url) requires a non-empty url"
      );
    }
    const normalizedUrl =
      normalizeLocalMediaUrl(url);

    const existing =
      this.streamEntries.get(name);
    if (existing) {
      existing.stop();
      this.#unloadStream(name);
    }

    const audioContext =
      this.audioContext ??
      this.#createAudioContext();

    if (!this.audioContext) {
      this.audioContext =
        audioContext;
      this.ownsAudioContext = true;
    }

    const element = new Audio();
    element.src = normalizedUrl;
    element.preload = "auto";
    element.crossOrigin = "anonymous";

    const sourceNode =
      audioContext.createMediaElementSource(
        element
      );
    const gainNode =
      audioContext.createGain();
    const stereoPannerSupported =
      typeof audioContext
        .createStereoPanner ===
      "function";
    const pannerNode =
      stereoPannerSupported
        ? audioContext.createStereoPanner()
        : audioContext.createGain();

    sourceNode.connect(gainNode);
    gainNode.connect(pannerNode);
    pannerNode.connect(
      this.sampleOutputNode ??
        this.masterInputNode ??
        this.outputNode ??
        audioContext.destination
    );

    const entry = {
      name,
      element,
      sourceNode,
      gainNode,
      pannerNode,
      play: (options = {}) =>
        this.#playLoadedStream(
          entry,
          options
        ),
      pause: () => {
        element.pause();
      },
      stop: () => {
        element.pause();
        element.currentTime = 0;
      },
    };

    this.streamEntries.set(
      name,
      entry
    );

    return entry;
  }

  /**
   * @param {string} name
   * @param {MegaSynthStreamPlayOptions} [options]
   * @returns {Promise<MegaSynthStreamEntry>}
   */
  async #playStream(
    name,
    options = {}
  ) {
    const entry =
      this.streamEntries.get(
        String(name)
      );

    if (!entry) {
      throw new Error(
        `Unknown stream: ${name}`
      );
    }

    await this.#playLoadedStream(
      entry,
      options
    );
    return entry;
  }

  /**
   * @param {MegaSynthStreamEntry} entry
   * @param {MegaSynthStreamPlayOptions} [options]
   * @returns {Promise<void>}
   */
  async #playLoadedStream(
    entry,
    options = {}
  ) {
    if (!this.audioContext) {
      throw new Error(
        "stream.play() requires an AudioContext"
      );
    }

    const {
      element,
      gainNode,
      pannerNode,
    } = entry;
    const now =
      this.audioContext.currentTime;
    const gain =
      normalizeFiniteNumber(
        options.gain,
        1
      );
    const fadeIn =
      Math.max(
        0,
        normalizeFiniteNumber(
          options.fadeIn,
          0
        )
      );

    element.loop = options.loop === true;
    element.playbackRate =
      Math.max(
        0.01,
        normalizeFiniteNumber(
          options.playbackRate,
          1
        )
      );

    if (options.offset != null) {
      element.currentTime = Math.max(
        0,
        normalizeFiniteNumber(
          options.offset,
          0
        )
      );
    }

    if (
      "pan" in options &&
      "pan" in pannerNode
    ) {
      pannerNode.pan.value =
        Math.max(
          -1,
          Math.min(
            1,
            normalizeFiniteNumber(
              options.pan,
              0
            )
          )
        );
    }

    gainNode.gain.cancelScheduledValues(
      now
    );
    if (fadeIn > 0) {
      gainNode.gain.setValueAtTime(
        0,
        now
      );
      gainNode.gain.linearRampToValueAtTime(
        gain,
        now + fadeIn
      );
    } else {
      gainNode.gain.setValueAtTime(
        gain,
        now
      );
    }

    await this.resume();
    await element.play();
  }

  /**
   * @param {string | undefined} [name]
   * @returns {void}
   */
  #pauseStream(name) {
    for (const entry of this.streamEntries.values()) {
      if (
        name == null ||
        entry.name === String(name)
      ) {
        entry.pause();
      }
    }
  }

  /**
   * @param {string | undefined} [name]
   * @returns {void}
   */
  #stopStream(name) {
    for (const entry of this.streamEntries.values()) {
      if (
        name == null ||
        entry.name === String(name)
      ) {
        entry.stop();
      }
    }
  }

  /**
   * @param {string} name
   * @returns {boolean}
   */
  #unloadStream(name) {
    const entry =
      this.streamEntries.get(
        String(name)
      );
    if (!entry) {
      return false;
    }

    entry.stop();
    try {
      entry.sourceNode.disconnect();
    } catch {}
    try {
      entry.gainNode.disconnect();
    } catch {}
    try {
      entry.pannerNode.disconnect();
    } catch {}
    entry.element.removeAttribute("src");
    entry.element.load();

    return this.streamEntries.delete(
      String(name)
    );
  }

  #waitForWorkletReady() {
    return new Promise((resolve, reject) => {
      const handleMessage = (event) => {
        const message = event.data;

        if (message?.type === "ready") {
          this.node.port.removeEventListener(
            "message",
            handleMessage
          );

          resolve(message);
          return;
        }

        if (message?.type === "error") {
          this.node.port.removeEventListener(
            "message",
            handleMessage
          );

          reject(
            new Error(
              message.message ||
              "MegaSynth AudioWorklet initialization failed"
            )
          );
        }
      };

      this.node.port.addEventListener(
        "message",
        handleMessage
      );

      this.node.port.start();
    });
  }

  #disconnectFXRouting() {
    this.masterInputNode?.disconnect();
    this.masterOutputNode?.disconnect();

    for (const effect of this.fxChain) {
      effect?.disconnect?.();
    }
  }

  #rebuildFXChain() {
    if (!this.masterInputNode) {
      return;
    }

    this.#disconnectFXRouting();

    const finalTarget =
      this.outputNode ??
      this.audioContext?.destination;

    if (!finalTarget) {
      return;
    }

    let currentNode =
      this.masterInputNode;

    for (const effect of this.fxChain) {
      if (
        !effect?.input ||
        !effect?.output
      ) {
        throw new Error(
          "Each FX unit must expose input and output nodes"
        );
      }

      currentNode.connect(
        effect.input
      );
      currentNode =
        effect.output;
    }

    if (!this.masterOutputNode) {
      return;
    }

    currentNode.connect(
      this.masterOutputNode
    );
    this.masterOutputNode.connect(
      finalTarget
    );
  }

  #ensureRecordingManager() {
    if (!this.recordingManager) {
      this.recordingManager =
        new MegaSynthRecordingManager({
          synth: this.fm,
          now: () =>
            this.audioContext
              ? this.audioContext.currentTime
              : performance.now() /
                  1000,
        });
      return;
    }

    if (this.fm) {
      this.recordingManager.attachSynth(
        this.fm
      );
    }
  }

  #installRecordingHooks() {
    if (
      this._recordingHooksInstalled ||
      !this.fm
    ) {
      return;
    }

    this.#wrapFmMethod(
      "reset",
      () => ({
        type: "reset",
      })
    );
    this.#wrapFmMethod(
      "setPreset",
      (channel, preset) => ({
        type: "setPreset",
        channel,
        preset,
      }),
      {
        record: false,
      }
    );
    this.#wrapFmMethod(
      "setOperator",
      (channel, operator, params) => ({
        type: "setOperator",
        channel,
        operator,
        params,
      })
    );
    this.#wrapFmMethod(
      "setAlgo",
      (
        channel,
        algorithm,
        feedback = 0
      ) => ({
        type: "setAlgo",
        channel,
        algorithm,
        feedback,
      })
    );
    this.#wrapFmMethod(
      "setLfo",
      (enabled, frequency) => ({
        type: "setLfo",
        enabled,
        frequency,
      })
    );
    this.#wrapFmMethod(
      "setPan",
      (
        channel,
        left,
        right,
        ams = 0,
        pms = 0
      ) => ({
        type: "setPan",
        channel,
        left,
        right,
        ams,
        pms,
      })
    );
    this.#wrapFmMethod(
      "setChannel3SpecialMode",
      (enabled) => ({
        type: "setChannel3SpecialMode",
        enabled,
      })
    );
    this.#wrapFmMethod(
      "setChannel3SpecialFrequency",
      (operator, block, fnum) => ({
        type: "setChannel3SpecialFrequency",
        operator,
        block,
        fnum,
      })
    );
    this.#wrapFmMethod(
      "setDacEnabled",
      (enabled) => ({
        type: "setDacEnabled",
        enabled,
      })
    );
    this.#wrapFmMethod(
      "writeDac",
      (value) => ({
        type: "writeDac",
        value,
      })
    );
    this.#wrapFmMethod(
      "noteOn",
      (channel, block, fnum) => ({
        type: "noteOn",
        channel,
        block,
        fnum,
      })
    );
    this.#wrapFmMethod(
      "noteOff",
      (channel) => ({
        type: "noteOff",
        channel,
      })
    );

    this._recordingHooksInstalled =
      true;
  }

  #wrapFmMethod(
    methodName,
    toCommand,
    options = {}
  ) {
    const originalMethod =
      this.fm?.[methodName];

    if (typeof originalMethod !== "function") {
      return;
    }

    this.fm[methodName] = (
      ...args
    ) => {
      const event =
        toCommand(...args);
      const result =
        originalMethod.apply(
          this.fm,
          args
        );

      if (options.record !== false) {
        this.recordingManager?.recordCommand(
          event
        );
      }

      if (options.emit !== false) {
        this.#emit(event);
      }
      return result;
    };
  }

  /**
   * @param {MegaSynthEvent} event
   * @returns {void}
   */
  #emit(event) {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        console.error(
          "MegaSynth listener failed",
          error
        );
      }
    }
  }
}

// Backward-compatible alias.
// Keep this so older downloads and examples that still refer to
// `MegaDriveSynth` continue to work.
export const MegaDriveSynth = MegaSynth;

const MAX_MASTER_VOLUME = 3.8;

function clampMasterVolume(value) {
  const numeric = Number(value);

  if (!Number.isFinite(numeric)) {
    throw new Error(
      `master volume must be a finite number, got ${value}`
    );
  }

  return Math.min(
    MAX_MASTER_VOLUME,
    Math.max(0, numeric)
  );
}

function clampChipSampleRate(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    throw new Error(
      `chipSampleRate must be a finite number, got ${value}`
    );
  }
  return Math.max(8000, Math.round(numeric));
}

/**
 * @param {AudioContext} audioContext
 * @param {ArrayBuffer} arrayBuffer
 * @returns {Promise<AudioBuffer>}
 */
async function decodeAudioBuffer(
  audioContext,
  arrayBuffer
) {
  return new Promise(
    (resolve, reject) => {
      audioContext.decodeAudioData(
        arrayBuffer.slice(0),
        resolve,
        reject
      );
    }
  );
}

function normalizeFiniteNumber(
  value,
  fallback
) {
  if (value == null) {
    return fallback;
  }

  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    throw new Error(
      `expected a finite number, got ${value}`
    );
  }
  return numeric;
}

function normalizeLocalMediaUrl(url) {
  const value = resolveBuiltInMediaAlias(
    String(url)
  );

  if (
    value.startsWith("data:") ||
    value.startsWith("blob:")
  ) {
    return value;
  }

  if (
    typeof location === "undefined" ||
    !location?.href
  ) {
    return value;
  }

  const resolved = new URL(
    value,
    location.href
  );

  if (
    resolved.origin !==
    location.origin
  ) {
    throw new Error(
      "Only same-origin media URLs are allowed in MegaSynth.sample/stream"
    );
  }

  return resolved.href;
}

function resolveBuiltInMediaAlias(url) {
  if (
    typeof url !== "string" ||
    url.length === 0
  ) {
    return url;
  }

  if (
    url.startsWith("sonic-pi/") &&
    !url.includes("://")
  ) {
    const sampleName =
      url
        .slice("sonic-pi/".length)
        .replaceAll("-", "_");
    return `./samples/sonic-pi/${sampleName}.flac`;
  }

  return url;
}

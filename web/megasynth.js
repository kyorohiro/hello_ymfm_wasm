import {
  MegaSynthRecordingManager,
} from "./megasynth_recording.js";
import {
  YM2612Synth,
  YM2612WorkletTransport,
} from "./ym2612synth.js";
export {
  createDelayFX,
  createEqFX,
  createFilterFX,
  createGainFX,
  createReverbFX,
} from "./megasynth_fx.js";
export { MegaSynthLooper } from "./looper.js";
export {
  MEGADRIVE_FM_PRESETS,
  MEGADRIVE_FM_PRESET_ORDER,
} from "./megadrive-fm-presets.js";

/**
 * @typedef {import("./megasynth_fx.js").AnyFXUnit} AnyFXUnit
 * @typedef {import("./ym2612synth.js").YM2612Synth} YM2612Synth
 * @typedef {import("./ym2612synth.js").YM2612Transport} YM2612Transport
 */

/**
 * @typedef {{
 *   audioContext?: AudioContext | null,
 *   outputNode?: AudioNode | null,
 *   workletUrl?: string,
 *   ym2612WasmUrl?: string,
 * }} MegaSynthOptions
 */

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
 *   type: "noteOn",
 *   channel: number,
 *   block: number,
 *   fnum: number,
 * } | {
 *   type: "noteOff",
 *   channel: number,
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

    this.ym2612WasmUrl =
      options.ym2612WasmUrl ?? "./generated/ym2612_wasm.wasm";

    this.audioContext =
      options.audioContext ?? null;

    this.outputNode =
      options.outputNode ?? null;

    this.node = null;
    this.masterInputNode = null;
    this.fxChain = [];
    this.recordingManager = null;
    this._recordingHooksInstalled =
      false;
    this.listeners = new Set();

    /** @type {YM2612Synth | null} */
    this.fm = null;

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
    if (this.node) {
      this.node.disconnect();
      this.node = null;
    }

    this.masterInputNode?.disconnect();
    this.masterInputNode = null;

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

  async #initialize() {
    if (!this.audioContext) {
      this.audioContext = new AudioContext();
    }

    if (this.audioContext.state !== "running") {
      await this.audioContext.resume();
    }

    await this.audioContext.audioWorklet.addModule(
      this.workletUrl
    );

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
    this.node.connect(
      this.masterInputNode
    );
    this.#rebuildFXChain();

    const workletReady =
      this.#waitForWorkletReady();

    this.node.port.postMessage(
      {
        type: "initialize",
        wasmBinary,
      },
      [
        wasmBinary,
      ]
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
    this.#ensureRecordingManager();
    this.#installRecordingHooks();
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

    currentNode.connect(finalTarget);
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

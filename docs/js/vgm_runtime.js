import ym2612ModuleFactory from "../generated/ym2612_wasm.js";
import segaPsgModuleFactory from "../generated/segapsg_wasm.js";
import { createGenesisAudioEngine } from "./genesisaudioengine.js";
import { VgmPlayer } from "./vgmplayer.js";

/**
 * @typedef {{
 *   audio: "idle" | "preparing" | "ready" | "error",
 *   playback: "stopped" | "playing" | "paused",
 *   hasBuffer: boolean,
 *   loopEnabled: boolean,
 *   queuedFrames: number,
 *   processedEvents: number,
 *   processedWaitSamples: number,
 *   totalSamples: number,
 *   audioProgress: number,
 *   sampleRate: number | null,
 *   outputMode: "none" | "worklet" | "script",
 *   errorMessage: string | null,
 * }} VgmRuntimeState
 */

/**
 * @typedef {{
 *   ym2612ModuleFactory?: typeof ym2612ModuleFactory,
 *   segaPsgModuleFactory?: typeof segaPsgModuleFactory,
 *   ym2612ModuleOptions?: object,
 *   segaPsgModuleOptions?: object,
 *   audioContext?: AudioContext | null,
 *   audioWorkletUrl?: string,
 *   workletUrl?: string,
 *   masterVolume?: number,
 *   onStatus?: ((message: string) => void) | null,
 *   onStateChange?: ((state: VgmRuntimeState) => void) | null,
 * }} VgmRuntimeOptions
 */

/**
 * Create a small browser-facing runtime around `VgmPlayer`.
 *
 * The goal is to keep `VgmPlayer` readable and reusable while moving the
 * AudioContext / AudioWorklet orchestration into one place, similar to
 * `Playground(...)`.
 *
 * @param {VgmRuntimeOptions} [options]
 */
export function createVgmRuntime(options = {}) {
  const runtime = {
    ym2612ModuleFactory:
      options.ym2612ModuleFactory ??
      ym2612ModuleFactory,
    segaPsgModuleFactory:
      options.segaPsgModuleFactory ??
      segaPsgModuleFactory,
    ym2612ModuleOptions:
      options.ym2612ModuleOptions,
    segaPsgModuleOptions:
      options.segaPsgModuleOptions,
    audioContext:
      options.audioContext ?? null,
    ownsAudioContext:
      !options.audioContext,
    audioWorkletUrl:
      options.audioWorkletUrl ??
      options.workletUrl ??
      "./vgm-output-worklet.js",
    masterVolume:
      typeof options.masterVolume ===
      "number"
        ? options.masterVolume
        : 1,
    engine: null,
    player: null,
    currentBuffer: null,
    activeStream: null,
    workletModuleReady: false,
    preparingPromise: null,
    finalizingPromise: null,
    controller: new AbortController(),
    generation: 0,
    streamGeneration: 0,
    lastErrorMessage: null,
    currentStatus: "Idle.",
    outputMode: "none",
    audioState: "idle",
  };

  function emitStatus(message) {
    runtime.currentStatus = message;
    options.onStatus?.(message);
  }

  /**
   * @returns {VgmRuntimeState}
   */
  function getState() {
    const stats = runtime.player
      ? runtime.player.stats()
      : {
          queuedFrames: 0,
          processedEvents: 0,
          processedWaitSamples: 0,
          totalSamples: 0,
          audioProgress: 0,
        };
    const playback = runtime.player
      ? runtime.player.isPlaying()
        ? "playing"
        : runtime.player.isPaused()
          ? "paused"
          : "stopped"
      : "stopped";

    return {
      audio: runtime.audioState,
      playback,
      hasBuffer: Boolean(
        runtime.currentBuffer
      ),
      loopEnabled: runtime.player
        ? runtime.player.loopEnabled
        : false,
      queuedFrames: stats.queuedFrames,
      processedEvents:
        stats.processedEvents,
      processedWaitSamples:
        stats.processedWaitSamples,
      totalSamples: stats.totalSamples,
      audioProgress:
        stats.audioProgress,
      sampleRate: runtime.engine
        ? runtime.engine.sampleRate()
        : null,
      outputMode: runtime.outputMode,
      errorMessage:
        runtime.lastErrorMessage,
    };
  }

  function emitState() {
    options.onStateChange?.(
      getState()
    );
  }

  function setAudioState(state) {
    runtime.audioState = state;
    emitState();
  }

  function clearError() {
    runtime.lastErrorMessage = null;
  }

  function setError(error) {
    runtime.lastErrorMessage =
      error instanceof Error
        ? error.message
        : String(error);
    setAudioState("error");
    emitStatus(
      `Error: ${runtime.lastErrorMessage}`
    );
  }

  function stopActiveStream() {
    runtime.streamGeneration += 1;
    if (!runtime.activeStream) {
      return;
    }
    const stream = runtime.activeStream;
    if (stream.mode === "script") {
      stream.node.onaudioprocess = null;
    } else if (
      stream.mode === "worklet"
    ) {
      stream.node.port.onmessage =
        null;
      stream.node.port.postMessage({
        type: "flush",
      });
    }
    stream.node.disconnect();
    runtime.activeStream = null;
    runtime.outputMode = "none";
    emitState();
  }

  async function initialize() {
    if (runtime.finalizingPromise) await runtime.finalizingPromise;
    if (runtime.controller.signal.aborted) runtime.controller = new AbortController();
    const signal = runtime.controller.signal;
    if (runtime.preparingPromise) {
      return runtime.preparingPromise;
    }

    runtime.preparingPromise =
      (async () => {
        clearError();
        setAudioState("preparing");
        emitStatus(
          "Preparing YM2612 + PSG VGM runtime..."
        );

        if (!runtime.engine) {
          await waitForRuntime(createGenesisAudioEngine({
              ym2612ModuleFactory:
                runtime.ym2612ModuleFactory,
              ym2612ModuleOptions:
                runtime.ym2612ModuleOptions,
              segaPsgModuleFactory:
                runtime.segaPsgModuleFactory,
              segaPsgModuleOptions:
                runtime.segaPsgModuleOptions,
              masterVolume:
                runtime.masterVolume,
            }).then(engine => {
              if (signal.aborted) {
                engine.dispose();
                signal.throwIfAborted();
              }
              runtime.engine = engine;
            }), signal);
        }

        signal.throwIfAborted();
        if (!runtime.player) {
          runtime.player =
            new VgmPlayer(
              runtime.engine
            );
        }

        const sampleRate =
          runtime.engine.sampleRate();

        if (
          !runtime.audioContext ||
          runtime.audioContext.sampleRate !==
            sampleRate
        ) {
          if (
            runtime.audioContext &&
            runtime.ownsAudioContext
          ) {
            const oldContext = runtime.audioContext;
            runtime.audioContext = null;
            await waitForRuntime(oldContext.close(), signal);
          }
          signal.throwIfAborted();
          runtime.audioContext =
            new AudioContext({
              sampleRate,
            });
          runtime.ownsAudioContext = true;
        }

        if (
          runtime.audioContext.state !==
          "running"
        ) {
          await waitForRuntime(runtime.audioContext.resume(), signal);
        }

        signal.throwIfAborted();
        setAudioState("ready");
        emitStatus("Ready.");
      })();

    const preparing = runtime.preparingPromise;
    try {
      await preparing;
    } catch (error) {
      if (!signal.aborted) setError(error);
      throw error;
    } finally {
      if (runtime.preparingPromise === preparing) {
        runtime.preparingPromise = null;
        emitState();
      }
    }
  }

  /**
   * @param {ArrayBuffer | Uint8Array} buffer
   * @param {ConstructorParameters<typeof VgmPlayer.prototype.load>[1]} [parserOptions]
   */
  async function load(
    buffer,
    parserOptions = {}
  ) {
    const generation = runtime.generation;
    await initialize();
    assertGeneration(generation);
    clearError();
    runtime.currentBuffer = buffer;
    runtime.player.load(
      buffer,
      parserOptions
    );
    emitStatus("VGM loaded.");
    emitState();
  }

  function ensureLoaded() {
    if (
      !runtime.player ||
      !runtime.currentBuffer
    ) {
      throw new Error(
        "No VGM buffer is loaded"
      );
    }
  }

  function updateStreamingStatus(
    suffix = ""
  ) {
    const state = getState();
    const extra =
      suffix === "" ? "" : ` ${suffix}`;
    emitStatus(
      `Streaming VGM... commands=${state.processedEvents} queued=${state.queuedFrames} audio=${state.audioProgress.toFixed(1)}% loop=${state.loopEnabled ? "on" : "off"}${extra}`
    );
  }

  function pumpWorkletChunks(
    targetFrames = 4096
  ) {
    if (
      runtime.player?.isPaused() ||
      !runtime.activeStream ||
      runtime.activeStream.mode !==
        "worklet"
    ) {
      return;
    }

    while (
      runtime.activeStream
        .workletQueuedFrames <
      targetFrames
    ) {
      const state = getState();
      const noMorePlayback =
        state.playback === "stopped" &&
        state.queuedFrames === 0;

      if (noMorePlayback) {
        if (
          !runtime.activeStream.endSent
        ) {
          runtime.activeStream.node.port.postMessage(
            { type: "end" }
          );
          runtime.activeStream.endSent =
            true;
        }
        break;
      }

      const frames =
        runtime.activeStream.chunkFrames;
      const left =
        new Float32Array(frames);
      const right =
        new Float32Array(frames);
      runtime.player.process(
        left,
        right,
        frames
      );
      runtime.activeStream.workletQueuedFrames +=
        frames;
      runtime.activeStream.node.port.postMessage(
        {
          type: "enqueue",
          left: left.buffer,
          right: right.buffer,
        },
        [left.buffer, right.buffer]
      );
    }

    updateStreamingStatus(
      "(AudioWorklet)"
    );
    emitState();
  }

  async function startWorkletStream(signal, streamGeneration) {
    const check = () => {
      signal.throwIfAborted();
      if (runtime.streamGeneration !== streamGeneration)
        throw new DOMException("Playback was stopped", "AbortError");
    };
    if (
      !runtime.audioContext ||
      !runtime.audioContext.audioWorklet
    ) {
      return false;
    }

    if (!runtime.workletModuleReady) {
      try {
        await waitForRuntime(runtime.audioContext.audioWorklet.addModule(
          runtime.audioWorkletUrl
        ), signal);
        check();
        runtime.workletModuleReady = true;
      } catch (error) {
        check();
        console.warn(
          "AudioWorklet module load failed; falling back to ScriptProcessorNode.",
          error
        );
        return false;
      }
    }

    check();
    const chunkFrames = 2048;
    const node = new AudioWorkletNode(
      runtime.audioContext,
      "vgm-output-processor",
      {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [2],
      }
    );

    runtime.activeStream = {
      mode: "worklet",
      node,
      chunkFrames,
      workletQueuedFrames: 0,
      endSent: false,
    };
    runtime.outputMode = "worklet";

    node.port.onmessage = (
      event
    ) => {
      if (runtime.activeStream?.node !== node) return;
      const data = event.data || {};
      if (
        typeof data.queuedFrames ===
        "number"
      ) {
        runtime.activeStream.workletQueuedFrames =
          data.queuedFrames;
      }
      if (data.ended) {
        stopActiveStream();
        emitStatus("Ready.");
        emitState();
        return;
      }
      pumpWorkletChunks(
        chunkFrames * 2
      );
    };

    if (runtime.player.isPaused()) node.port.postMessage({ type: "pause" });
    node.connect(
      runtime.audioContext.destination
    );
    pumpWorkletChunks(
      chunkFrames * 2
    );
    emitState();
    return true;
  }

  function startScriptProcessorStream() {
    const bufferSize = 2048;
    const node =
      runtime.audioContext.createScriptProcessor(
        bufferSize,
        0,
        2
      );
    runtime.activeStream = {
      mode: "script",
      node,
    };
    runtime.outputMode = "script";
    node.onaudioprocess = (event) => {
      const left =
        event.outputBuffer.getChannelData(
          0
        );
      const right =
        event.outputBuffer.getChannelData(
          1
        );
      runtime.player.process(
        left,
        right,
        bufferSize
      );
      updateStreamingStatus(
        "(ScriptProcessor)"
      );
      emitState();

      const state = getState();
      if (
        state.playback === "stopped" &&
        state.queuedFrames === 0
      ) {
        stopActiveStream();
        emitStatus("Ready.");
        emitState();
      }
    };
    node.connect(
      runtime.audioContext.destination
    );
    emitState();
    return true;
  }

  async function play() {
    const generation = runtime.generation;
    await initialize();
    assertGeneration(generation);
    clearError();
    ensureLoaded();

    stopActiveStream();
    runtime.engine.reset();
    runtime.player.reset();
    runtime.player.play();
    const streamGeneration = runtime.streamGeneration;
    const workletStarted = await startWorkletStream(runtime.controller.signal, streamGeneration);
    assertGeneration(generation);
    if (runtime.streamGeneration !== streamGeneration)
      throw new DOMException("Playback was stopped", "AbortError");
    const started = workletStarted || startScriptProcessorStream();
    if (!started) {
      throw new Error(
        "Failed to create an audio output stream"
      );
    }
    updateStreamingStatus();
    emitState();
  }

  function pause() {
    ensureLoaded();
    runtime.player.pause();
    if (runtime.activeStream?.mode === "worklet")
      runtime.activeStream.node.port.postMessage({ type: "pause" });
    emitStatus("Paused.");
    emitState();
  }

  function resume() {
    ensureLoaded();
    runtime.player.resume();
    if (runtime.activeStream?.mode === "worklet") {
      runtime.activeStream.node.port.postMessage({ type: "resume" });
      pumpWorkletChunks();
    }
    updateStreamingStatus();
    emitState();
  }

  function stop() {
    stopActiveStream();
    if (runtime.player) {
      runtime.player.stop();
    }
    emitStatus("Stopped.");
    emitState();
  }

  function replay() {
    return play();
  }

  function setLoopEnabled(enabled) {
    if (runtime.player) {
      runtime.player.setLoopEnabled(
        Boolean(enabled)
      );
    }
    emitState();
  }

  function setPrefetchFactor(factor) {
    if (runtime.player) {
      runtime.player.setPrefetchFactor(
        factor
      );
      emitState();
    }
  }

  function setMaxFillStepsPerProcess(
    steps
  ) {
    if (runtime.player) {
      runtime.player.setMaxFillStepsPerProcess(
        steps
      );
      emitState();
    }
  }

  function setMasterVolume(volume) {
    runtime.masterVolume =
      runtime.engine
        ? runtime.engine.setMasterVolume(
            volume
          )
        : volume;
    emitState();
    return runtime.masterVolume;
  }

  function getMasterVolume() {
    return runtime.engine
      ? runtime.engine.getMasterVolume()
      : runtime.masterVolume;
  }

  function assertGeneration(generation) {
    if (runtime.generation !== generation)
      throw new DOMException("VGM runtime was finalized", "AbortError");
  }

  function finalize() {
    if (runtime.finalizingPromise) return runtime.finalizingPromise;
    runtime.generation += 1;
    runtime.controller.abort();
    runtime.preparingPromise = null;
    stopActiveStream();
    const context = runtime.audioContext;
    const ownsContext = runtime.ownsAudioContext;
    runtime.audioContext = null;
    runtime.player?.stop();
    runtime.engine?.dispose();
    runtime.engine = null;
    runtime.player = null;
    runtime.currentBuffer = null;
    runtime.workletModuleReady = false;
    runtime.outputMode = "none";
    setAudioState("idle");
    emitStatus("Finalized.");
    const closing = (async () => {
      if (context && ownsContext) await context.close();
    })();
    runtime.finalizingPromise = closing;
    closing.finally(() => {
      if (runtime.finalizingPromise === closing) runtime.finalizingPromise = null;
    }).catch(() => {});
    return closing;
  }

  return {
    initialize,
    load,
    play,
    pause,
    resume,
    stop,
    replay,
    finalize,
    getState,
    setLoopEnabled,
    setPrefetchFactor,
    setMaxFillStepsPerProcess,
    setMasterVolume,
    getMasterVolume,
    get status() {
      return runtime.currentStatus;
    },
    get player() {
      return runtime.player;
    },
    get engine() {
      return runtime.engine;
    },
  };
}

export const VgmRuntime =
  createVgmRuntime;

async function waitForRuntime(promise, signal) {
  let onAbort;
  try {
    const result = await Promise.race([
      promise,
      new Promise((_, reject) => {
        onAbort = () => reject(signal.reason);
        signal.addEventListener("abort", onAbort, { once: true });
        if (signal.aborted) onAbort();
      }),
    ]);
    signal.throwIfAborted();
    return result;
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

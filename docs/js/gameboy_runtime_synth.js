/**
 * @file gameboy_runtime_synth.js
 * 実行環境: Browser（メインスレッド）
 * 依存: 音声初期化・再生時に AudioContext / AudioWorkletNode と WASM アセットが必要。
 * import だけでは音声デバイスを開かない。アセット読み込みには fetch を使用する。
 */
import { TetoricaAudioRuntime } from "./tetorica_audio_runtime.js?v=native-extra-stability-1";
import { GameboySynth } from "./gameboysynth.js?v=audio-stability-2";
import { attachChipClock, CHIP_CLOCKS } from "./playground_chip_clock.js?v=audio-numeric-bindings-1";

/** @typedef {Pick<import('./megasynth.js?v=native-extra-stability-1').MegaSynthOptions,'audioContext'|'outputNode'|'sampleOutputNode'|'masterVolume'|'mixer'|'workletUrl'> & {wasmUrl?:string}} GameboyRuntimeSynthOptions */

const MAX_MASTER_VOLUME = 3.8;

/**
 * Browser lifecycle and shared mixer/media/FX services for the primary Game Boy APU.
 */
export class GameboyRuntimeSynth {
  /** @param {GameboyRuntimeSynthOptions|undefined} options */
  constructor(options = {}) {
    const config = {chip:'gameboy', fmChannels:0, workletUrl:new URL('./playground_gameboy_worklet.js?v=nes-wasm-1',import.meta.url),
      wasmUrl:new URL('../generated/gameboy_apu_wasm.wasm',import.meta.url), processorName:'tetorica-gameboy', chipName:'Game Boy'};
    this.chip = config.chip;
    this.capabilities = Object.freeze({
      chip: config.chip,
      fmChannels: config.fmChannels,
      psg: false,
      dac: false,
      recorder: false,
    });
    this.audio = new TetoricaAudioRuntime({
      audioContext: options.audioContext,
      outputNode: options.outputNode,
      sampleOutputNode: options.sampleOutputNode,
      masterVolume: clampMasterVolume(options.masterVolume ?? 1),
      mixer: options.mixer,
    });
    this.workletUrl = options.workletUrl ?? config.workletUrl;
    this.wasmUrl = options.wasmUrl ?? config.wasmUrl;
    this.processorName = config.processorName;
    this.chipName = config.chipName;
    this.mixerRelease = null;
    this.node = null;
    this.fm = null;
    this.gameboy = null;
    this.psg = null;
    this.listeners = new Set();
    this.readyPromise = null;
    this.closePromise = null;
    this.initializationController = null;
    this.state = "idle";

    this.audio.setMediaApis(
      this.audio.createSampleApi({
        createAudioContext: () => this.#createAudioContext(),
      }),
      this.audio.createStreamApi({
        createAudioContext: () => this.#createAudioContext(),
        resume: () => this.resume(),
      })
    );
    this.noise = this.audio.createNoiseApi();
  }

  /** @returns {import('./soundchip_mixer.js?v=native-extra-stability-1').SoundChipMixer} */
  get mixer() { return this.audio.mixer; }
  get audioContext() { return this.audio.audioContext; }
  set audioContext(value) { this.audio.audioContext = value; }
  get ownsAudioContext() { return this.audio.ownsAudioContext; }
  get sample() { return this.audio.sample; }
  get stream() { return this.audio.stream; }

  async start() {
    if (this.closePromise) await this.closePromise;
    if (!this.readyPromise) {
      const controller = new AbortController();
      this.initializationController = controller;
      this.state = "starting";
      this.readyPromise = (async () => {
        try {
          await this.#initialize(controller.signal);
          controller.signal.throwIfAborted();
          this.state = "ready";
        } catch (error) {
          if (this.initializationController === controller) {
            controller.abort();
            this.mixerRelease?.(); this.mixerRelease = null;
            this.node?.port.postMessage({method:'dispose',args:[]});
            this.node?.disconnect();
            this.node?.port.close();
            this.node = null;
            this.fm = null;
            this.gameboy = null;
            this.readyPromise = null;
            this.state = "error";
          }
          throw error;
        }
      })();
    }
    const signal = this.initializationController.signal;
    await this.readyPromise;
    signal.throwIfAborted();
    await waitForInitialization(this.resume(), signal);
    return this;
  }

  async resume() {
    if (this.audioContext?.state !== "running") await this.audioContext?.resume();
  }

  async suspend() {
    if (this.audioContext?.state === "running") await this.audioContext.suspend();
  }

  reset() { this.gameboy?.reset(); }
  isReady() { return this.state === "ready" && !!this.gameboy; }
  isStarting() { return this.state === "starting"; }
  addListener(listener) {
    if (typeof listener !== "function") throw new Error("listener must be a function");
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  removeListener(listener) { this.listeners.delete(listener); }
  /** @param {number} volume */
  setMasterVolume(volume) { return this.audio.setMasterVolume(clampMasterVolume(volume)); }
  getMasterVolume() { return this.audio.masterVolume; }
  setFXChain(effects = [], options = {}) { return this.audio.setFXChain(effects, options); }
  getFXChain() { return this.audio.getFXChain(); }
  clearFXChain(options = {}) { return this.audio.clearFXChain(options); }
  connect(effect) { this.audio.connect(effect); return this; }
  connectOutput(node = null) { this.audio.connectOutput(node); return this; }

  close() {
    if (this.closePromise) return this.closePromise;
    this.initializationController?.abort();
    this.initializationController = null;
    this.readyPromise = null;
    const closing = this.#close();
    this.closePromise = closing;
    closing.finally(() => {
      if (this.closePromise === closing) this.closePromise = null;
    }).catch(() => {});
    return closing;
  }

  async #close() {
    this.audio.closeMedia();
    this.audio.disposeFXChain();
    this.mixerRelease?.(); this.mixerRelease = null;
    this.gameboy?.dispose();
    if (!this.gameboy) this.node?.port.postMessage({method:'dispose',args:[]});
    this.node?.disconnect();
    this.node?.port.close();
    this.node = null;
    this.audio.disconnectRouting();
    this.audio.masterInputNode = null;
    this.audio.masterOutputNode = null;
    this.fm = null;
    this.gameboy = null;
    this.readyPromise = null;
    this.state = "closed";
    if (this.audioContext && this.ownsAudioContext) {
      await this.audioContext.close();
      this.audioContext = null;
    }
  }

  #createAudioContext() { return new AudioContext(); }

  async #initialize(signal) {
    if (!this.audioContext) this.audioContext = this.#createAudioContext();
    if (this.audioContext.state !== "running") await waitForInitialization(this.audioContext.resume(), signal);
    await waitForInitialization(this.audioContext.audioWorklet.addModule(this.workletUrl), signal);
    const response = await waitForInitialization(fetch(this.wasmUrl, { signal }), signal);
    if (!response.ok) throw new Error(`Failed to load ${this.chipName} WASM: ${response.status} ${response.statusText}`);
    const wasmBinary = await waitForInitialization(response.arrayBuffer(), signal);
    this.node = new AudioWorkletNode(this.audioContext, this.processorName, {
      numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2], processorOptions:{wasmBinary},
    });
    this.audio.ensureRouting(this.audioContext);
    this.mixerRelease = this.mixer.connect(this.chip, this.chip, this.node, this.audio.masterInputNode, this.audioContext);
    const ready = this.#waitForWorkletReady(this.node, signal);
    ready.catch(() => {});
    await ready;
    signal.throwIfAborted();
    const node = this.node;
    const gameboy = new GameboySynth({transport:{
      writeRegister(offset,value) { node.port.postMessage({method:'writeRegister',args:[offset,value]}); },
      reset() { node.port.postMessage({method:'reset',args:[]}); },
      dispose() { node.port.postMessage({method:'dispose',args:[]}); },
    }});
    attachChipClock(gameboy,node.port,CHIP_CLOCKS.gameboy,{primary:true});
    gameboy._observe = event => { for (const listener of this.listeners) listener(event); };
    this.gameboy = gameboy;
    gameboy.initialize();
  }

  #waitForWorkletReady(node, signal) {
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        node.port.removeEventListener("message", handleMessage);
        signal.removeEventListener("abort", onAbort);
      };
      const onAbort = () => { cleanup(); reject(signal.reason); };
      const handleMessage = (event) => {
        const message = event.data;
        if (!message?.ready && !message?.error) return;
        cleanup();
        if (message.ready) resolve(message);
        else reject(new Error(message.error || `${this.chipName} AudioWorklet initialization failed`));
      };
      node.port.addEventListener("message", handleMessage);
      signal.addEventListener("abort", onAbort, { once: true });
      node.port.start();
      if (signal.aborted) onAbort();
    });
  }
}

function clampMasterVolume(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) throw new Error(`master volume must be a finite number, got ${value}`);
  return Math.min(MAX_MASTER_VOLUME, Math.max(0, numeric));
}

// addModule() and arrayBuffer() do not accept AbortSignal themselves.
async function waitForInitialization(promise, signal) {
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

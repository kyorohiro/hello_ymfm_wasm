/** Primary non-OPN machines share media, mixer and FX without a hidden FM synth. */
import {TetoricaAudioRuntime} from './tetorica_audio_runtime.js?v=audio-stability-2';
import {createNesAudio} from './playground_nes_audio.js?v=sega-modes-1';
import {createNesClient} from './playground_nes.js?v=audio-stability-2';
import {createSnesAudio} from './playground_snes_audio.js?v=sega-modes-1';
import {createSnesClient} from './playground_snes.js?v=native-modes-3';
import {createYm2151Audio} from './playground_ym2151_audio.js?v=sega-modes-1';
import {createYm2151Client} from './playground_ym2151.js?v=audio-stability-2';
import {createOki6258Audio} from './playground_okim6258_audio.js?v=sega-modes-1';
import {createOki6258Client} from './playground_okim6258.js?v=audio-stability-2';
import {createHuc6280Audio} from './playground_huc6280_audio.js?v=sega-modes-1';
import {createHuc6280Client} from './playground_huc6280.js?v=audio-stability-2';
import {createSegaPsgAudio} from './playground_segapsg_audio.js?v=sample-editor-1';
import {createSegaPsgClient} from './playground_segapsg.js?v=sega-modes-1';

const PRIMARY_CHIPS = Object.freeze(['nes', 'snes', 'x68000', 'huc6280', 'segapsg']);

/** @typedef {Pick<import('./megasynth.js?v=sample-editor-1').MegaSynthOptions,'audioContext'|'outputNode'|'sampleOutputNode'|'masterVolume'|'mixer'> & {
 * chip?:'nes'|'snes'|'x68000'|'huc6280'|'segapsg', clock?:number, stereoEnabled?:boolean, fds?:boolean,
 * wasmUrl?:string|URL, workletUrl?:string|URL, fetch?:typeof globalThis.fetch,
 * extraOki?:{fetch?:typeof globalThis.fetch,wasmUrl?:string|URL,workletUrl?:string|URL}
 * }} NativeRuntimeSynthOptions */

/**
 * Constructing this runtime opens no audio device and loads no WASM.
 * Every endpoint owns its Main-thread client port. A Worker may connect a
 * separate port through endpoint.node, keeping resource requests independent.
 */
export class NativeRuntimeSynth {
  /** @param {NativeRuntimeSynthOptions} [options] */
  constructor(options = {}) {
    const chip = String(options.chip ?? 'nes').toLowerCase();
    if (!PRIMARY_CHIPS.includes(chip)) throw new Error(`Unsupported native primary chip: ${chip}`);
    this.chip = chip;
    this.options = options;
    this.capabilities = Object.freeze({chip, fmChannels:0, psg:chip === 'segapsg', dac:false, recorder:false});
    this.audio = new TetoricaAudioRuntime({
      audioContext:options.audioContext, outputNode:options.outputNode,
      sampleOutputNode:options.sampleOutputNode, masterVolume:clampMasterVolume(options.masterVolume ?? 1), mixer:options.mixer,
    });
    this.node = null;
    this.fm = null;
    this.psg = null;
    /** @type {{nes?:ReturnType<typeof createNesClient>,snes?:ReturnType<typeof createSnesClient>,opm?:ReturnType<typeof createYm2151Client>,adpcm?:ReturnType<typeof createOki6258Client>,pce?:ReturnType<typeof createHuc6280Client>,psg?:ReturnType<typeof createSegaPsgClient>}} */
    this.primaryApis = {};
    /** @type {ReturnType<typeof createNesClient>|null} */ this.nes = null;
    /** @type {ReturnType<typeof createSnesClient>|null} */ this.snes = null;
    /** @type {ReturnType<typeof createYm2151Client>|null} */ this.opm = null;
    /** @type {ReturnType<typeof createOki6258Client>|null} */ this.adpcm = null;
    /** @type {ReturnType<typeof createHuc6280Client>|null} */ this.pce = null;
    this.primaryEndpoints = [];
    this.listeners = new Set();
    this.readyPromise = null;
    this.closePromise = null;
    this.initializationController = null;
    this.state = 'idle';
    this.audio.setMediaApis(
      this.audio.createSampleApi({createAudioContext:() => this.#createAudioContext()}),
      this.audio.createStreamApi({createAudioContext:() => this.#createAudioContext(), resume:() => this.resume()}),
    );
    this.noise = this.audio.createNoiseApi();
  }

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
      this.state = 'starting';
      this.readyPromise = (async () => {
        try {
          await this.#initialize(controller.signal);
          controller.signal.throwIfAborted();
          this.state = 'ready';
        } catch (error) {
          if (this.initializationController === controller) {
            controller.abort();
            this.#releasePrimaries();
            this.readyPromise = null;
            this.state = 'error';
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

  async resume() { if (this.audioContext?.state !== 'running') await this.audioContext?.resume(); }
  async suspend() { if (this.audioContext?.state === 'running') await this.audioContext.suspend(); }
  isReady() { return this.state === 'ready' && this.primaryEndpoints.length > 0; }
  isStarting() { return this.state === 'starting'; }
  addListener(listener) {
    if (typeof listener !== 'function') throw new Error('listener must be a function');
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  removeListener(listener) { this.listeners.delete(listener); }
  setMasterVolume(volume) { return this.audio.setMasterVolume(clampMasterVolume(volume)); }
  getMasterVolume() { return this.audio.masterVolume; }
  setFXChain(effects = [], options = {}) { return this.audio.setFXChain(effects, options); }
  getFXChain() { return this.audio.getFXChain(); }
  clearFXChain(options = {}) { return this.audio.clearFXChain(options); }
  connect(effect) { this.audio.connect(effect); return this; }
  connectOutput(node = null) { this.audio.connectOutput(node); return this; }

  /** Stop voices while keeping uploaded samples, patches, waveforms and clocks. */
  stopAllNative() {
    const {nes, snes, opm, adpcm, pce, psg} = this.primaryApis;
    if (nes) for (let channel = 0; channel < 6; channel++) nes.keyOff(channel);
    if (snes) {
      try { snes.allNotesOff(); }
      catch (error) {
        if (!/timeline mode is exclusive/.test(String(error?.message))) throw error;
        // Timeline playback has a separate stop path and keeps its prepared data.
        snes.stopTimeline().catch(() => {});
      }
    }
    opm?.allNotesOff();
    adpcm?.stop();
    pce?.allNotesOff();
    psg?.allNotesOff();
  }
  reset() { this.stopAllNative(); }

  close() {
    if (this.closePromise) return this.closePromise;
    this.initializationController?.abort();
    this.initializationController = null;
    this.readyPromise = null;
    const closing = this.#close();
    this.closePromise = closing;
    closing.finally(() => { if (this.closePromise === closing) this.closePromise = null; }).catch(() => {});
    return closing;
  }

  async #close() {
    this.audio.closeMedia();
    this.audio.disposeFXChain();
    this.#releasePrimaries();
    this.audio.disconnectRouting();
    this.audio.masterInputNode = null;
    this.audio.masterOutputNode = null;
    this.state = 'closed';
    if (this.audioContext && this.ownsAudioContext) {
      await this.audioContext.close();
      this.audioContext = null;
    }
  }

  #releasePrimaries() {
    for (const endpoint of this.primaryEndpoints.splice(0)) {
      endpoint.release?.();
      endpoint.client?.dispose();
      endpoint.dispose();
    }
    for (const name of Object.keys(this.primaryApis)) this[name] = null;
    this.primaryApis = {};
    this.node = null;
  }

  #createAudioContext() { return new AudioContext(); }

  async #initialize(signal) {
    if (!this.audioContext) this.audioContext = this.#createAudioContext();
    if (this.audioContext.state !== 'running') await waitForInitialization(this.audioContext.resume(), signal);
    signal.throwIfAborted();
    this.audio.ensureRouting(this.audioContext);
    const options = {...this.options, signal};
    if (this.chip === 'nes') {
      await this.#addPrimary('nes', 'nes', createNesAudio, device => createNesClient(device.port, {clock:device.clock, fdsEnabled:true}), {...options, fds:true}, signal);
    } else if (this.chip === 'snes') {
      await this.#addPrimary('snes', 'snes', createSnesAudio, device => createSnesClient(device.port, device), options, signal);
    } else if (this.chip === 'segapsg') {
      await this.#addPrimary('segapsg', 'psg', createSegaPsgAudio, device => createSegaPsgClient(device.port, {clock:device.clock, stereoEnabled:device.stereoEnabled}), options, signal);
    } else if (this.chip === 'huc6280') {
      const endpoint = await this.#addPrimary('huc6280', 'pce', createHuc6280Audio, device => createHuc6280Client(device.port, {clock:device.clock}), options, signal);
      endpoint.client.initialize();
    } else {
      const opm = await this.#addPrimary('ym2151', 'opm', createYm2151Audio, device => createYm2151Client(device.port), options, signal);
      await waitForInitialization(opm.client.setClock(4000000), signal);
      await this.#addPrimary('okim6258', 'adpcm', createOki6258Audio, device => createOki6258Client(device.port, {clock:device.clock}), {fetch:this.options.fetch,...this.options.extraOki, signal, clock:8000000}, signal);
    }
  }

  async #addPrimary(name, globalName, createAudio, createClient, options, signal) {
    const device = await createAudio(this.audioContext, null, options);
    if (signal.aborted) { device.dispose(); signal.throwIfAborted(); }
    const endpoint = {...device, name, globalName, client:null, release:null};
    this.primaryEndpoints.push(endpoint);
    endpoint.client = createClient(device);
    Object.defineProperty(endpoint, 'clock', {enumerable:true, get:() => endpoint.client.clock});
    Object.defineProperty(endpoint, 'state', {enumerable:true, get:() => endpoint.client._getState?.()});
    endpoint.release = this.mixer.connect(name, name, device.node, this.audio.masterInputNode, this.audioContext);
    this.primaryApis[globalName] = endpoint.client;
    this[globalName] = endpoint.client;
    this.node ??= device.node;
    return endpoint;
  }
}

function clampMasterVolume(value) {
  const volume = Number(value);
  if (!Number.isFinite(volume)) throw new Error(`master volume must be a finite number, got ${value}`);
  return Math.min(3.8, Math.max(0, volume));
}

async function waitForInitialization(promise, signal) {
  signal.throwIfAborted();
  let abort;
  try {
    const result = await Promise.race([promise, new Promise((_, reject) => {
      abort = () => reject(signal.reason);
      signal.addEventListener('abort', abort, {once:true});
    })]);
    signal.throwIfAborted();
    return result;
  } finally { signal.removeEventListener('abort', abort); }
}

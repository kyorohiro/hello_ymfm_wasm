/** Primary non-OPN machines share media, mixer and FX without a hidden FM synth. */
import {createAy8910Audio} from './playground_ay8910_audio.js?v=native-extra-ym2203-1';
import {createAy8910Client} from './playground_ay8910.js?v=audio-numeric-bindings-1';
import {TetoricaAudioRuntime} from './tetorica_audio_runtime.js?v=native-extra-ym2203-1';
import {createNesAudio} from './playground_nes_audio.js?v=native-extra-ym2203-1';
import {createNesClient} from './playground_nes.js?v=nes-wasm-1';
import {createSnesAudio} from './playground_snes_audio.js?v=audio-numeric-bindings-1';
import {createSnesClient} from './playground_snes.js?v=audio-numeric-bindings-1';
import {createYm2151Audio} from './playground_ym2151_audio.js?v=native-extra-ym2203-1';
import {createYm2151Client} from './playground_ym2151.js?v=audio-numeric-bindings-1';
import {createOki6258Audio} from './playground_okim6258_audio.js?v=native-extra-ym2203-1';
import {createOki6258Client} from './playground_okim6258.js?v=audio-numeric-bindings-1';
import {createHuc6280Audio} from './playground_huc6280_audio.js?v=native-extra-ym2203-1';
import {createHuc6280Client} from './playground_huc6280.js?v=audio-numeric-bindings-1';
import {createSegaPsgAudio} from './playground_segapsg_audio.js?v=native-extra-ym2203-1';
import {createSegaPsgClient} from './playground_segapsg.js?v=audio-numeric-bindings-1';
import {createYm2413Audio} from './playground_ym2413_audio.js?v=native-extra-ym2203-1';
import {createYm2413Client} from './playground_ym2413.js?v=audio-numeric-bindings-1';
import {createOplAudio} from './playground_opl_audio.js?v=native-extra-ym2203-1';
import {createOplClient, OPL_CHIPS} from './playground_opl.js?v=audio-numeric-bindings-1';
import {createDx7Audio} from './playground_dx7_audio.js?v=audio-numeric-bindings-1';
import {createDx7Client} from './playground_dx7.js?v=audio-numeric-bindings-1';

const PRIMARY_CHIPS = Object.freeze(['nes', 'snes', 'x68000', 'huc6280', 'segapsg', 'dx7', 'ym3526', 'ym3812', 'y8950', 'ymf262', 'ym2413', 'ay8910', 'msx', 'msx-audio']);

/** @typedef {Pick<import('./megasynth.js?v=native-extra-ym2203-1').MegaSynthOptions,'audioContext'|'outputNode'|'sampleOutputNode'|'masterVolume'|'mixer'> & {
 * chip?:'nes'|'snes'|'x68000'|'huc6280'|'segapsg'|'dx7'|'ym3526'|'ym3812'|'y8950'|'ymf262'|'ym2413'|'ay8910'|'msx'|'msx-audio', ym2413?:boolean, clock?:number, stereoEnabled?:boolean, fds?:boolean,
 * wasmUrl?:string|URL, workletUrl?:string|URL, fetch?:typeof globalThis.fetch,
 * ayOptions?:{fetch?:typeof globalThis.fetch,wasmUrl?:string|URL,workletUrl?:string|URL},
 * oplOptions?:{fetch?:typeof globalThis.fetch,wasmUrl?:string|URL,workletUrl?:string|URL},
 * opllOptions?:{fetch?:typeof globalThis.fetch,wasmUrl?:string|URL,workletUrl?:string|URL},
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
    if(options.ym2413!==undefined&&typeof options.ym2413!=='boolean')throw new TypeError('ym2413 must be boolean');
    if(options.ym2413&&chip!=='segapsg')throw new TypeError('The ym2413 expansion is available only for a Sega PSG primary');
    this.options = options;
    this.capabilities = Object.freeze({chip, fmChannels:0, psg:chip === 'segapsg', dac:false, recorder:false});
    this.audio = new TetoricaAudioRuntime({
      audioContext:options.audioContext, outputNode:options.outputNode,
      sampleOutputNode:options.sampleOutputNode, masterVolume:clampMasterVolume(options.masterVolume ?? 1), mixer:options.mixer,
    });
    this.node = null;
    this.fm = null;
    this.psg = null;
    /** @type {{nes?:ReturnType<typeof createNesClient>,snes?:ReturnType<typeof createSnesClient>,opm?:ReturnType<typeof createYm2151Client>,adpcm?:ReturnType<typeof createOki6258Client>,pce?:ReturnType<typeof createHuc6280Client>,psg?:ReturnType<typeof createSegaPsgClient>,dx7?:ReturnType<typeof createDx7Client>,opl?:ReturnType<typeof createOplClient>,opll?:ReturnType<typeof createYm2413Client>,ay?:ReturnType<typeof createAy8910Client>}} */
    this.primaryApis = {};
    /** @type {ReturnType<typeof createNesClient>|null} */ this.nes = null;
    /** @type {ReturnType<typeof createSnesClient>|null} */ this.snes = null;
    /** @type {ReturnType<typeof createYm2151Client>|null} */ this.opm = null;
    /** @type {ReturnType<typeof createOki6258Client>|null} */ this.adpcm = null;
    /** @type {ReturnType<typeof createHuc6280Client>|null} */ this.pce = null;
    /** @type {ReturnType<typeof createDx7Client>|null} */ this.dx7 = null;
    /** @type {ReturnType<typeof createOplClient>|null} */ this.opl = null;
    /** @type {ReturnType<typeof createYm2413Client>|null} */ this.opll = null;
    /** @type {ReturnType<typeof createAy8910Client>|null} */ this.ay = null;
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
    const {nes, snes, opm, adpcm, pce, psg, dx7, opl, opll, ay} = this.primaryApis;
    const pending=[],track=result=>{if(result?.then)pending.push(Promise.resolve(result));};
    if (nes?._stopVoices) track(nes._stopVoices());
    else if (nes) for (let channel = 0; channel < 6; channel++) nes.keyOff(channel);
    if (snes?._stopVoices) track(snes._stopVoices());
    else if (snes) {
      try { snes.allNotesOff(); }
      catch (error) {
        if (!/timeline mode is exclusive/.test(String(error?.message))) throw error;
        // Timeline playback has a separate stop path and keeps its prepared data.
        track(snes.stopTimeline());
      }
    }
    if (opm?._stopVoices) track(opm._stopVoices());
    else opm?.allNotesOff();
    if (adpcm?._stopVoices) track(adpcm._stopVoices());
    else adpcm?.stop();
    if (pce?._stopVoices) track(pce._stopVoices());
    else pce?.allNotesOff();
    if (psg?._stopVoices) track(psg._stopVoices());
    else psg?.allNotesOff();
    if(dx7)track(dx7._stopVoices());
    if(opl)track(opl._stopVoices());
    if(opll)track(opll._stopVoices());
    if(ay)track(ay._stopVoices());
    if(!pending.length)return;
    // A failed endpoint must not let a later audition overtake another chip's
    // still-pending Stop. Preserve rejection after every endpoint has settled.
    const stopped=Promise.allSettled(pending).then(results=>{
      const failed=results.find(result=>result.status==='rejected');if(failed)throw failed.reason;
    });
    stopped.catch(()=>{});
    return stopped;
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
      endpoint.detachObserver?.();
      endpoint.release?.();
      endpoint.client?.dispose();
      endpoint.dispose();
    }
    for (const name of Object.keys(this.primaryApis)) this[name] = null;
    this.primaryApis = {};
    this.node = null;
  }

  #createAudioContext() { return this.chip === 'dx7' ? new AudioContext({sampleRate:44100}) : new AudioContext(); }

  async #initialize(signal) {
    if (!this.audioContext) this.audioContext = this.#createAudioContext();
    if (this.audioContext.state !== 'running') await waitForInitialization(this.audioContext.resume(), signal);
    signal.throwIfAborted();
    this.audio.ensureRouting(this.audioContext);
    const options = {...this.options, signal};
    if(this.chip==='msx'||this.chip==='msx-audio'){
      await this.#addAy({...options,...this.options.ayOptions,clock:options.clock??1789773,signal},signal);
      await this.#addOpll({fetch:this.options.fetch,...this.options.opllOptions,clock:3579545,signal},signal);
      if(this.chip==='msx-audio')await this.#addOpl('y8950',{fetch:this.options.fetch,...this.options.oplOptions,clock:3579545,signal},signal);
    }else if(this.chip==='ay8910'){
      await this.#addAy(options,signal);
    }else if (this.chip === 'nes') {
      await this.#addPrimary('nes', 'nes', createNesAudio, device => createNesClient(device.port, {clock:device.clock, fdsEnabled:true}), {...options, fds:true}, signal);
    } else if (this.chip === 'snes') {
      await this.#addPrimary('snes', 'snes', createSnesAudio, device => createSnesClient(device.port, device), options, signal);
    } else if (this.chip === 'segapsg') {
      await this.#addPrimary('segapsg', 'psg', createSegaPsgAudio, device => createSegaPsgClient(device.port, {clock:device.clock, stereoEnabled:device.stereoEnabled}), options, signal);
      if(this.options.ym2413)await this.#addOpll({fetch:this.options.fetch,...this.options.opllOptions,clock:3579545,signal},signal);
    } else if (this.chip === 'huc6280') {
      const endpoint = await this.#addPrimary('huc6280', 'pce', createHuc6280Audio, device => createHuc6280Client(device.port, {clock:device.clock}), options, signal);
      endpoint.client.initialize();
    } else if(this.chip==='ym2413'){
      await this.#addOpll(options,signal);
    } else if (OPL_CHIPS.includes(this.chip)) {
      await this.#addOpl(this.chip,options,signal);
    } else if (this.chip === 'dx7') {
      await this.#addPrimary('dx7', 'dx7', createDx7Audio, device => createDx7Client(device.port, device), {
        ...options,onError:() => {
          if (this.initializationController?.signal !== signal || signal.aborted) return;
          this.#releasePrimaries();this.readyPromise=null;this.state='error';
        },
      }, signal);
    } else {
      const opm = await this.#addPrimary('ym2151', 'opm', createYm2151Audio, device => createYm2151Client(device.port), options, signal);
      await waitForInitialization(opm.client.setClock(4000000), signal);
      await this.#addPrimary('okim6258', 'adpcm', createOki6258Audio, device => createOki6258Client(device.port, {clock:device.clock}), {fetch:this.options.fetch,...this.options.extraOki, signal, clock:8000000}, signal);
    }
  }

  async #addAy(options,signal){
    const endpoint=await this.#addPrimary('ay8910','ay',createAy8910Audio,device=>createAy8910Client(device.port,{clock:device.clock}),{...options,onError:()=>{if(this.initializationController?.signal!==signal||signal.aborted)return;this.#releasePrimaries();this.readyPromise=null;this.state='error';}},signal);
    endpoint.client.initialize();return endpoint;
  }

  async #addOpl(chip,options,signal){
    const endpoint=await this.#addPrimary(chip,'opl',createOplAudio,device=>createOplClient(device.port,{chip,clock:device.clock}),{...options,chip,onError:()=>{if(this.initializationController?.signal!==signal||signal.aborted)return;this.#releasePrimaries();this.readyPromise=null;this.state='error';}},signal);
    endpoint.client.initialize();return endpoint;
  }

  async #addOpll(options,signal){
    const endpoint=await this.#addPrimary('ym2413','opll',createYm2413Audio,device=>createYm2413Client(device.port,{clock:device.clock}),{...options,onError:()=>{if(this.initializationController?.signal!==signal||signal.aborted)return;this.#releasePrimaries();this.readyPromise=null;this.state='error';}},signal);
    endpoint.client.initialize();
    return endpoint;
  }

  async #addPrimary(name, globalName, createAudio, createClient, options, signal) {
    const device = await createAudio(this.audioContext, null, options);
    if (signal.aborted) { device.dispose(); signal.throwIfAborted(); }
    const endpoint = {...device, name, globalName, client:null, release:null};
    this.primaryEndpoints.push(endpoint);
    endpoint.client = createClient(device);
    if(OPL_CHIPS.includes(name)||name==='ym2413'||name==='ay8910'){
      const observer=({data})=>{if(!['opl-state','opll-state','ay-state'].includes(data?.type))return;endpoint.client._adoptState(data.state);for(const listener of this.listeners)listener({type:'native-state',name:globalName,state:data.state});};
      endpoint.node.port.addEventListener?.('message',observer);endpoint.node.port.start?.();
      endpoint.detachObserver=()=>endpoint.node.port.removeEventListener?.('message',observer);
    }
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

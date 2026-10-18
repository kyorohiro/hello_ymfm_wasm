import {TetoricaAudioRuntime} from './tetorica_audio_runtime.js?v=chip-tabs-2';

const nativeFetch = globalThis.fetch?.bind(globalThis);
const modules = new WeakMap();
const NATIVE_RATE = 32000;
/** @typedef {{ready:boolean,loaded:boolean,playing:boolean,paused:boolean,muteMask:number,
 * positionSeconds:number,playbackNativeFrames:number,renderedNativeFrames:number,
 * nativeSampleRate:number,sampleRate?:number,closed?:boolean}} SpcPlaybackState */
/** @typedef {{ram:Uint8Array,dsp:Uint8Array,nativeFrames:number,playbackNativeFrames:number,
 * positionSeconds:number,nativeSampleRate:number,muteMask:number}} SpcSnapshot */
/** Seek progress is 0..1, not a time unit. Resume defaults to the prior playing state.
 * @typedef {{signal?:AbortSignal,onProgress?:(progress:number)=>void,resume?:boolean}} SpcSeekOptions */
const abortError = () => new DOMException('SPC operation cancelled', 'AbortError');
function copyBytes(input) {
  if (input instanceof ArrayBuffer) return new Uint8Array(input.slice(0));
  if (input instanceof Uint8Array) return input.slice();
  throw new TypeError('SPC data must be a Uint8Array or ArrayBuffer');
}
function waitFor(promise, signal) {
  if (signal.aborted) return Promise.reject(signal.reason ?? abortError());
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason ?? abortError());
    signal.addEventListener('abort', abort, {once: true});
    Promise.resolve(promise).then(value => {
      signal.removeEventListener('abort', abort); resolve(value);
    }, error => {signal.removeEventListener('abort', abort); reject(error);});
  });
}
function addModule(context, url) {
  let entries = modules.get(context);
  if (!entries) modules.set(context, entries = new Map());
  let ready = entries.get(url);
  if (!ready) {
    ready = context.audioWorklet.addModule(url); entries.set(url, ready);
    ready.catch(() => entries.delete(url));
  }
  return ready;
}

/** Browser SPC file player. SPC700/S-DSP generation runs only in AudioWorklet.
 * Native time is fixed at 32,000 stereo frames/s; output follows AudioContext.
 * This is file playback, independent of Playground BPM/Worker lookahead.
 * close() disposes this player; construct a new instance to open another context.
 */
export class SpcRuntimeSynth {
  /** @param {{audioContext?:AudioContext,outputNode?:AudioNode,mixer?:import('./soundchip_mixer.js?v=chip-tabs-2').SoundChipMixer,
   * masterVolume?:number,workletUrl?:string|URL,wasmUrl?:string|URL,wasmBinary?:Uint8Array|ArrayBuffer,
   * fetch?:typeof globalThis.fetch,onError?:(error:Error)=>void}} [options] */
  constructor(options = {}) {
    this.options = options;
    this.audio = new TetoricaAudioRuntime({audioContext: options.audioContext, outputNode: options.outputNode,
      mixer: options.mixer, masterVolume: 1});
    this.node = null;
    this.closed = false;
    this.failure = null;
    this.readyPromise = null;
    this.controller = null;
    this.closePromise = null;
    this.pending = new Map();
    this.sequence = 0;
    this.loadToken = 0;
    this.seekToken = 0;
    this.muteMask = 0;
    /** @type {SpcPlaybackState} */
    this.lastState = {ready: false, loaded: false, playing: false, paused: false, muteMask: 0,
      positionSeconds: 0, playbackNativeFrames: 0, renderedNativeFrames: 0, nativeSampleRate: NATIVE_RATE};
    this.setMasterVolume(options.masterVolume ?? 1);
  }
  get audioContext() { return this.audio.audioContext; }
  get mixer() { return this.audio.mixer; }
  isReady() { return !this.closed && !this.failure && Boolean(this.node) && this.lastState.ready === true; }
  /** @param {number} volume Linear output gain, 0..3.8. @returns {number} */
  setMasterVolume(volume) {
    if (!Number.isFinite(volume) || volume < 0 || volume > 3.8) throw new RangeError('Master volume must be between 0 and 3.8');
    return this.audio.setMasterVolume(volume);
  }
  getMasterVolume() { return this.audio.masterVolume; }
  assertOpen() {
    if (this.closed) throw new Error('SPC player is closed');
    if (this.failure) throw this.failure;
  }
  /** @returns {Promise<SpcRuntimeSynth>} */
  start() {
    try { this.assertOpen(); } catch (error) { return Promise.reject(error); }
    if (!this.readyPromise) {
      this.controller = new AbortController();
      this.readyPromise = this.initialize(this.controller.signal).catch(error => {
        if (!this.closed) this.fail(error);
        throw error;
      });
    }
    return this.readyPromise;
  }
  async initialize(signal) {
    const context = this.audio.audioContext ?? new AudioContext();
    this.audio.audioContext = context;
    if (context.state === 'closed' || !context.audioWorklet) throw new Error('An open AudioContext with AudioWorklet is required');
    if (context.state !== 'running') await waitFor(context.resume(), signal);
    const workletUrl = String(this.options.workletUrl ?? new URL('./spc-worklet.js?v=spc-events-1', import.meta.url));
    const binary = this.options.wasmBinary !== undefined ? Promise.resolve(copyBytes(this.options.wasmBinary))
      : (this.options.fetch ?? nativeFetch)(this.options.wasmUrl ?? new URL('../generated/spc_wasm.wasm?v=spc-events-1', import.meta.url), {signal})
        .then(response => {if (!response.ok) throw new Error(`SPC WASM: HTTP ${response.status}`); return response.arrayBuffer();});
    const [wasmBinary] = await waitFor(Promise.all([binary, addModule(context, workletUrl)]), signal);
    signal.throwIfAborted();
    const node = new AudioWorkletNode(context, 'tetorica-spc', {
      numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2], processorOptions: {wasmBinary},
    });
    this.node = node;
    const ready = new Promise((resolve, reject) => {this.nodeReady = {resolve, reject};});
    this.onContextState = () => {if (context.state === 'closed' && !this.closed) this.fail(new Error('SPC AudioContext was closed'));};
    context.addEventListener('statechange', this.onContextState);
    node.port.onmessage = ({data}) => {
      if (this.closed || this.failure) return;
      if (data.type === 'ready') {this.nodeReady?.resolve(); return;}
      if (data.type === 'error') {this.fail(new Error(data.error)); return;}
      if (data.type !== 'result') return;
      const request = this.pending.get(data.id);
      if (!request) return;
      this.pending.delete(data.id);
      if (data.error) {const error = new Error(data.error); if (data.name) error.name = data.name; request.reject(error);}
      else {
        if (data.value?.ready !== undefined) this.lastState = data.value;
        request.resolve(data.value);
      }
    };
    node.onprocessorerror = () => this.fail(new Error('SPC AudioWorklet processor failed'));
    await waitFor(ready, signal); signal.throwIfAborted();
    this.audio.ensureRouting(context);
    const fxReady = this.audio.prepareNativeFX();
    // An aborted initialization may outlive a fetch/addModule promise. Clean any
    // late rack as well; closing must not wait indefinitely for that promise.
    const cleanLateRack = () => {if (signal.aborted) {this.audio.disposeFXChain(); this.audio.disconnectRouting();}};
    fxReady.then(cleanLateRack, cleanLateRack).catch(() => {});
    await waitFor(fxReady, signal); signal.throwIfAborted();
    this.audio.nativeFX.onError = message => this.fail(new Error(`SPC FX: ${message}`));
    this.mixerRelease = this.mixer.connect('snes_spc', 'snes_spc', node, this.audio.masterInputNode, context);
    await this.request('mute', {mask: this.muteMask});
    signal.throwIfAborted();
    return this;
  }
  request(type, data = {}, transfer = []) {
    this.assertOpen();
    if (!this.node) return Promise.reject(new Error('SPC audio is not ready'));
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      this.pending.set(id, {resolve, reject});
      try {this.node.port.postMessage({type, id, ...data}, transfer);}
      catch (error) {this.pending.delete(id); reject(error);}
    });
  }
  /** @param {Uint8Array|ArrayBuffer} input @returns {Promise<SpcPlaybackState>} */
  async loadSPC(input) {
    const bytes = copyBytes(input), token = ++this.loadToken;
    ++this.seekToken;
    await this.start();
    if (token !== this.loadToken) throw abortError();
    const state = await this.request('load', {bytes}, [bytes.buffer]);
    if (token !== this.loadToken) throw abortError();
    return state;
  }
  /** @returns {Promise<SpcPlaybackState>} */
  async play() {
    ++this.seekToken;
    await this.start();
    if (this.audioContext.state !== 'running') await this.audioContext.resume();
    return this.request('play');
  }
  /** @returns {Promise<SpcPlaybackState>} */
  async pause() {
    ++this.seekToken;
    if (!this.readyPromise) return {...this.lastState};
    await this.start();
    return this.request('pause');
  }
  /** @returns {Promise<SpcPlaybackState>} */
  async stop() {
    ++this.seekToken; ++this.loadToken;
    if (!this.readyPromise) return {...this.lastState};
    await this.start();
    return this.request('stop');
  }
  /** @returns {Promise<SpcPlaybackState>} */
  async restart() { await this.stop(); return this.play(); }
  /** Bits 0..7 mute SPC DSP voices. Their envelopes/pitch/BRR state still advance.
   * Already rendered samples (one 4 ms resampling block plus the core's short
   * native queue) and existing echo tails can remain.
   * @param {number} mask @returns {Promise<SpcPlaybackState>}
   */
  async setMuteMask(mask) {
    if (!Number.isInteger(mask) || mask < 0 || mask > 255) throw new RangeError('SPC mute mask must be 0..255');
    this.assertOpen(); this.muteMask = mask;
    if (!this.readyPromise) {this.lastState = {...this.lastState, muteMask: mask}; return {...this.lastState};}
    await this.start();
    return this.request('mute', {mask});
  }
  /** @param {number} channel @param {boolean} muted @returns {Promise<SpcPlaybackState>} */
  setVoiceMuted(channel, muted) {
    if (!Number.isInteger(channel) || channel < 0 || channel > 7 || typeof muted !== 'boolean') throw new TypeError('SPC voice must be 0..7 and muted must be boolean');
    return this.setMuteMask(muted ? this.muteMask | (1 << channel) : this.muteMask & ~(1 << channel));
  }
  /** Current processor clock/state, rather than an extrapolated UI clock.
   * @returns {Promise<SpcPlaybackState>} */
  async getState() {
    if (!this.readyPromise || this.closed) return {...this.lastState, ready: false, playing: false, closed: this.closed};
    await this.start(); return this.request('state');
  }
  /** Atomic emulator snapshot for BRR/DSP inspection. nativeFrames counts native
   * generation, while playbackNativeFrames/positionSeconds identify audio output.
   * @returns {Promise<SpcSnapshot>}
   */
  async snapshot() { await this.start(); return this.request('snapshot'); }
  /** Replay from the loaded snapshot in bounded 0.5-second native blocks. Every
   * block is rendered in the Worklet; messages yield between blocks for Cancel.
   * @param {number} seconds Native elapsed seconds, independent of BPM.
   * @param {SpcSeekOptions} [options]
   * @returns {Promise<SpcPlaybackState>}
   */
  async seek(seconds, {signal, onProgress = () => {}, resume} = {}) {
    const target = Math.floor(seconds * NATIVE_RATE);
    if (!Number.isFinite(seconds) || seconds < 0 || !Number.isSafeInteger(target)) throw new RangeError('Invalid SPC seek seconds');
    if (typeof onProgress !== 'function' || (resume !== undefined && typeof resume !== 'boolean')) throw new TypeError('Invalid SPC seek options');
    if (signal?.aborted) throw signal.reason ?? abortError();
    const token = ++this.seekToken;
    await this.start();
    const check = () => {if (token !== this.seekToken || this.closed || signal?.aborted) throw signal?.reason ?? abortError();};
    check();
    const previous = await this.request('state'); check();
    const seekId = `seek:${token}`;
    let complete = false;
    try {
      await this.request('seek-begin', {seekId}); check();
      let consumed = 0;
      while (consumed < target) {
        check();
        const frames = Math.min(16000, target - consumed);
        await this.request('seek-step', {seekId, frames}); consumed += frames; check();
        if (consumed < target) onProgress(consumed / target);
      }
      const state = await this.request('seek-end', {seekId, resume: resume ?? previous.playing});
      check(); complete = true; onProgress(1); return state;
    } finally {
      if (!complete && token === this.seekToken && !this.closed && !this.failure) {
        try {await this.request('pause');} catch {}
      }
    }
  }
  fail(error) {
    if (this.failure || this.closed) return;
    this.failure = error; this.controller?.abort(error); this.nodeReady?.reject(error);
    for (const request of this.pending.values()) request.reject(error);
    this.pending.clear(); this.releaseAudio();
    if (this.audio.ownsAudioContext && this.audioContext?.state !== 'closed') void this.audioContext?.close().catch(() => {});
    try {this.options.onError?.(error);} catch (observerError) {console.error('SPC error observer:', observerError);}
  }
  releaseAudio() {
    this.mixerRelease?.(); this.mixerRelease = null;
    if (this.node) {
      try {this.node.port.postMessage({type: 'dispose'});} catch {}
      this.node.port.onmessage = null; this.node.onprocessorerror = null;
      try {this.node.disconnect();} catch {}
      try {this.node.port.close();} catch {}
      this.node = null;
    }
    this.audioContext?.removeEventListener('statechange', this.onContextState);
    this.audio.closeMedia(); this.audio.disposeFXChain(); this.audio.disconnectRouting();
    this.audio.masterInputNode = null; this.audio.masterOutputNode = null;
  }
  /** @returns {Promise<void>} */
  close() {
    if (this.closePromise) return this.closePromise;
    this.closed = true; ++this.loadToken; ++this.seekToken;
    const error = abortError(); this.controller?.abort(error); this.nodeReady?.reject(error);
    for (const request of this.pending.values()) request.reject(error);
    this.pending.clear(); this.releaseAudio();
    const context = this.audioContext;
    this.closePromise = (async () => {
      if (context && this.audio.ownsAudioContext && context.state !== 'closed') await context.close();
    })();
    return this.closePromise;
  }
}

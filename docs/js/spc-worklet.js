import moduleFactory from '../generated/spc_wasm.js';
import {SpcCore} from './spc.js?v=chip-tabs-2';
import {SpcResampler} from './spc_resampler.js?v=chip-tabs-2';

const NATIVE_RATE = 32000;
function cancelledSeek() { const error = new Error('SPC seek cancelled'); error.name = 'AbortError'; return error; }

/** Whole-machine SPC playback. No main-thread synthesis or musical/BPM clock. */
export class SpcProcessor extends AudioWorkletProcessor {
  constructor({processorOptions = {}} = {}) {
    super();
    this.core = null;
    this.loaded = false;
    this.playing = false;
    this.disposed = false;
    this.failed = false;
    this.muteMask = 0;
    this.seekId = null;
    this.discardLeft = new Float32Array(1024);
    this.discardRight = new Float32Array(1024);
    this.ready = this.initialize(processorOptions.wasmBinary);
    this.commands = this.ready;
    this.port.onmessage = ({data}) => {
      if (data?.type === 'dispose') { this.dispose(); return; }
      this.commands = this.commands.then(() => this.command(data)).catch(error => {
        if (this.disposed || this.failed) return;
        this.port.postMessage({type: 'result', id: data?.id, error: String(error.message ?? error), name: error.name});
      });
    };
  }
  async initialize(wasmBinary) {
    try {
      const core = await SpcCore.create({moduleFactory, moduleOptions: {wasmBinary}});
      if (this.disposed) { core.dispose(); return; }
      this.core = core;
      this.resampler = new SpcResampler(core, sampleRate);
      this.port.postMessage({type: 'ready', sampleRate, nativeSampleRate: NATIVE_RATE});
    } catch (error) { this.fail(error); }
  }
  state() {
    const playbackNativeFrames = this.resampler?.playbackNativeFrames ?? 0;
    return {ready: Boolean(this.core) && !this.failed && !this.disposed, loaded: this.loaded,
      playing: this.playing, paused: this.loaded && !this.playing, muteMask: this.muteMask,
      sampleRate, nativeSampleRate: NATIVE_RATE, playbackNativeFrames,
      positionSeconds: playbackNativeFrames / NATIVE_RATE,
      renderedNativeFrames: this.resampler?.renderedNativeFrames ?? 0};
  }
  requireLoaded() { if (!this.loaded) throw new Error('Load an SPC file before playback'); }
  command(data) {
    if (this.disposed || this.failed) return;
    if (!this.core) throw new Error('SPC processor is not ready');
    switch (data.type) {
      case 'load':
        this.playing = false; this.seekId = null;
        this.core.load(data.bytes); this.core.setMuteMask(this.muteMask);
        this.loaded = true; this.resampler.reset();
        break;
      case 'play': this.requireLoaded(); this.seekId = null; this.playing = true; break;
      case 'pause': this.seekId = null; this.playing = false; break;
      case 'stop':
        this.seekId = null; this.playing = false;
        if (this.loaded) { this.core.restart(); this.core.setMuteMask(this.muteMask); }
        this.resampler.reset();
        break;
      case 'mute':
        if (!Number.isInteger(data.mask) || data.mask < 0 || data.mask > 255) throw new RangeError('SPC mute mask must be 0..255');
        this.muteMask = data.mask; this.core.setMuteMask(data.mask);
        break;
      case 'seek-begin':
        this.requireLoaded(); this.playing = false; this.seekId = data.seekId;
        this.core.restart(); this.core.setMuteMask(this.muteMask); this.resampler.reset();
        break;
      case 'seek-step': {
        if (data.seekId !== this.seekId) throw cancelledSeek();
        if (!Number.isInteger(data.frames) || data.frames < 0 || data.frames > 16000) throw new RangeError('Invalid SPC seek block');
        let remaining = data.frames;
        while (remaining > 0) {
          const frames = Math.min(remaining, this.discardLeft.length);
          this.core.renderInto(this.discardLeft, this.discardRight, frames); remaining -= frames;
        }
        this.resampler.reset(this.resampler.baseNativeFrames + data.frames);
        break;
      }
      case 'seek-end':
        if (data.seekId !== this.seekId) throw cancelledSeek();
        this.seekId = null; this.playing = data.resume === true;
        break;
      case 'snapshot': {
        this.requireLoaded();
        const snapshot = this.core.snapshot(), state = this.state();
        this.port.postMessage({type: 'result', id: data.id, value: {...snapshot,
          positionSeconds: state.positionSeconds, playbackNativeFrames: state.playbackNativeFrames,
          nativeSampleRate: NATIVE_RATE, muteMask: this.muteMask}}, [snapshot.ram.buffer, snapshot.dsp.buffer]);
        return;
      }
      case 'state': break;
      default: throw new Error(`Unknown SPC command: ${data.type}`);
    }
    this.port.postMessage({type: 'result', id: data.id, value: this.state()});
  }
  fail(error) {
    if (this.disposed || this.failed) return;
    this.failed = true; this.playing = false;
    this.core?.dispose(); this.core = null;
    this.port.postMessage({type: 'error', error: String(error.message ?? error)});
    this.port.onmessage = null; this.port.close();
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true; this.playing = false;
    this.core?.dispose(); this.core = null;
    this.port.onmessage = null; this.port.close();
  }
  process(_inputs, outputs) {
    const channels = outputs[0];
    if (this.disposed || this.failed) return false;
    if (!channels?.[0]) return true;
    if (!this.playing || !this.core || !this.loaded) {
      for (let c = 0; c < channels.length; c++) channels[c].fill(0);
      return true;
    }
    try {
      this.resampler.render(channels[0], channels[1] ?? channels[0]);
      for (let c = 2; c < channels.length; c++) channels[c].set(channels[0]);
    } catch (error) {
      for (let c = 0; c < channels.length; c++) channels[c].fill(0);
      this.fail(error); return false;
    }
    return true;
  }
}

registerProcessor('tetorica-spc', SpcProcessor);

import moduleFactory from '../generated/spc_wasm.js?v=spc-events-1';
import {SpcCore} from './spc.js?v=spc-events-1';
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
    this.remote = null;
    this.playbackOwner = null;
    this.cancelledOwners = new Set();
    this.stoppedSessions = new Set();
    this.discardLeft = new Float32Array(1024);
    this.discardRight = new Float32Array(1024);
    this.eventEnabled = false; this.eventEpoch = 0; this.eventSequence = 0;
    this.eventIntervalFrames = Math.ceil(sampleRate * .016); this.eventFrames = 0;
    this.eventCapacity = 2048; this.eventPool = []; this.eventInFlight = new Set();
    this.eventPending = null; this.eventCount = 0; this.eventLost = 0; this.eventNeedsFinal = false;
    this.eventInitialPending = false;
    this.ready = this.initialize(processorOptions.wasmBinary);
    this.commands = this.ready;
    this.port.onmessage = ({data}) => {
      if (['performance-start', 'performance-stop', 'performance-cancel-owner'].includes(data?.type)) {
        this.receiveRpc(data, this.port); return;
      }
      if (data?.type === 'attach-spc-port') {
        this.remote?.close(); this.remote = data.port;
        const remote = this.remote;
        remote.onmessage = event => {if (this.remote === remote) this.receiveRpc(event.data, remote);};
        remote.start?.(); return;
      }
      if (data?.type === 'dispose') { this.dispose(); return; }
      this.enqueue(data, this.port);
    };
  }
  enqueue(data, reply, owner = null) {
      this.commands = this.commands.then(() => {
        if (owner && (this.stoppedSessions.has(owner.session) || this.cancelledOwners.has(`${owner.session}:${owner.owner}`))) throw cancelledSeek();
        if (data.type === 'play') this.playbackOwner = owner;
        return this.command(data, reply);
      }).catch(error => {
        if (this.disposed || this.failed) return;
        if (data?.type === 'load' && this.loaded && this.eventEnabled) this.resetObservation(data.eventEpoch, 'load-error');
        reply.postMessage({type: 'result', id: data?.id, error: String(error.message ?? error), name: error.name});
      });
  }
  receiveRpc(data, reply) {
    if (data?.method === 'dispose') {this.dispose(); return;}
    if (data?.method === 'eventAck') {
      const [epoch, sequence, buffer] = data.args ?? [];
      if (epoch === this.eventEpoch && this.eventInFlight.delete(sequence) && buffer?.byteLength === this.eventCapacity * 3 * 8) {
        this.eventPool.push(new Float64Array(buffer));
        if (this.eventNeedsFinal) this.sendObservedEvents(true);
      }
      return;
    }
    if (data?.type === 'performance-start') {
      reply.postMessage({type:'performance-result', id:data.id}); return;
    }
    if (data?.type === 'performance-stop' || data?.type === 'performance-cancel-owner') {
      if (data.type === 'performance-stop') this.stoppedSessions.add(data.session);
      else this.cancelledOwners.add(`${data.session}:${data.owner}`);
      if (this.playbackOwner?.session === data.session &&
          (data.type === 'performance-stop' || this.playbackOwner.owner === data.owner)) {
        this.playing = false; this.seekId = null;
        this.eventSuspended = true; this.core?.stopDspObservation(); this.eventPool = []; this.eventInFlight.clear();
        this.remote?.postMessage({type:'spc-events-suspended', epoch:this.eventEpoch});
      }
      return;
    }
    const args = data?.args ?? [], commands = {
      loadSPC: () => ({type:'load', bytes:args[0]}), play: () => ({type:'play'}),
      pause: () => ({type:'pause'}), stop: () => ({type:'stop'}),
      getState: () => ({type:'state'}), snapshot: () => ({type:'snapshot'}),
      setMuteMask: () => ({type:'mute', mask:args[0]}),
      seekBegin: () => ({type:'seek-begin', seekId:args[0]}),
      seekStep: () => ({type:'seek-step', seekId:args[0], frames:args[1]}),
      seekEnd: () => ({type:'seek-end', seekId:args[0], resume:args[1]}),
      observe: () => ({type:'observe', enabled:args[0], epoch:args[1], intervalMs:args[2]}),
    };
    const convert = Object.hasOwn(commands, data?.method) ? commands[data.method] : null;
    if (!convert) {reply.postMessage({id:data?.id, error:'Unknown SPC player method'}); return;}
    this.enqueue({...convert(), id:data.id, eventEpoch:data.spcEventEpoch}, reply, data.spcPerformance ?? null);
  }
  async initialize(wasmBinary) {
    try {
      const core = await SpcCore.create({moduleFactory, moduleOptions: {wasmBinary}});
      if (this.disposed) { core.dispose(); return; }
      this.core = core;
      this.resampler = new SpcResampler({renderInto:(left,right,frames) => {
        core.renderInto(left,right,frames);
        if (this.eventEnabled) this.collectObservedEvents();
      }}, sampleRate);
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
  resetObservation(epoch, reason) {
    this.eventEpoch = epoch ?? this.eventEpoch + 1; this.eventFrames = 0;
    this.eventInFlight.clear(); this.eventPool = [];
    this.eventPending = null; this.eventCount = this.eventLost = 0; this.eventNeedsFinal = false;
    this.eventInitialPending = true;
    this.core?.stopDspObservation();
    if (!this.eventEnabled || !this.loaded || this.seekId || !this.remote) return;
    this.core.startDspObservation({capacity:this.eventCapacity});
    this.eventScratch = new Float64Array(this.eventCapacity * 3);
    this.eventPool = Array.from({length:4}, () => new Float64Array(this.eventCapacity * 3));
    const dsp = new Uint8Array(128); this.core.readDspRegistersInto(dsp);
    this.remote.postMessage({type:'spc-events-reset', epoch:this.eventEpoch, clock:this.core.nativeFrames * 32, dsp, reason}, [dsp.buffer]);
  }
  collectObservedEvents() {
    const count = this.core.drainDspEventsInto(this.eventScratch), lost = this.core.takeDspEventOverflow();
    if (lost || this.eventLost) {
      this.eventLost += lost + count + this.eventCount; this.eventCount = 0; return;
    }
    let index = 0;
    while (index < count) {
      this.eventPending ??= this.eventPool.pop();
      if (!this.eventPending) {this.eventLost += count - index; return;}
      const take = Math.min(count - index, this.eventCapacity - this.eventCount);
      for (let word = 0; word < take * 3; word++) this.eventPending[this.eventCount * 3 + word] = this.eventScratch[index * 3 + word];
      this.eventCount += take; index += take;
      if (this.eventCount === this.eventCapacity) this.sendObservedEvents(false,true);
    }
  }
  sendObservedEvents(force = false, early = false) {
    if (force && !this.playing && !this.eventCount && !this.eventLost) return;
    if (force) this.eventNeedsFinal = true;
    if (!this.eventEnabled || !this.remote || (!force && !early && this.eventFrames < this.eventIntervalFrames)) return;
    if (!this.eventCount && !this.eventLost && !force && !this.eventInitialPending) return;
    this.eventPending ??= this.eventPool.pop();
    if (!this.eventPending) return;
    this.eventFrames = 0;
    const writes = this.eventPending, count = this.eventCount, lost = this.eventLost;
    this.eventPending = null; this.eventCount = this.eventLost = 0; this.eventNeedsFinal = false;
    this.eventInitialPending = false;
    // A capacity-triggered batch can split one native fetch. Its remaining
    // writes have not been sent yet, so do not seal the whole fetch watermark.
    const sequence = ++this.eventSequence, clock = early && count ? writes[(count - 1) * 3] : this.core.nativeFrames * 32;
    let dsp;
    if (lost) {dsp = new Uint8Array(128); this.core.readDspRegistersInto(dsp);}
    this.eventInFlight.add(sequence);
    const message = {type:'spc-events', epoch:this.eventEpoch, sequence, clock, writes, count:lost ? 0 : count,
      droppedWrites:lost ? lost + count : 0, final:force, ...(dsp ? {dsp} : {})};
    this.remote.postMessage(message, dsp ? [writes.buffer,dsp.buffer] : [writes.buffer]);
  }
  command(data, reply = this.port) {
    if (this.disposed || this.failed) return;
    if (!this.core) throw new Error('SPC processor is not ready');
    switch (data.type) {
      case 'load':
        this.playing = false; this.seekId = null;
        this.core.load(data.bytes); this.core.setMuteMask(this.muteMask);
        this.loaded = true; this.resampler.reset();
        this.resetObservation(data.eventEpoch, 'load');
        break;
      case 'play': this.requireLoaded(); this.seekId = null; this.playing = true;
        if (this.eventSuspended) {this.eventSuspended = false; this.resetObservation(data.eventEpoch, 'play');}
        break;
      case 'pause': this.sendObservedEvents(true); this.seekId = null; this.playing = false; break;
      case 'stop':
        this.seekId = null; this.playing = false;
        if (this.loaded) { this.core.restart(); this.core.setMuteMask(this.muteMask); }
        this.resampler.reset();
        this.resetObservation(data.eventEpoch, 'stop');
        break;
      case 'mute':
        if (!Number.isInteger(data.mask) || data.mask < 0 || data.mask > 255) throw new RangeError('SPC mute mask must be 0..255');
        this.muteMask = data.mask; this.core.setMuteMask(data.mask);
        break;
      case 'seek-begin':
        this.requireLoaded(); this.playing = false; this.seekId = data.seekId;
        this.resetObservation(data.eventEpoch, 'seek');
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
        this.resetObservation(data.eventEpoch, 'seek');
        break;
      case 'observe':
        if (typeof data.enabled !== 'boolean' || !Number.isInteger(data.epoch) || data.epoch < 0 ||
          !Number.isFinite(data.intervalMs) || data.intervalMs < 16 || data.intervalMs > 1000) throw new RangeError('Invalid SPC observation options');
        this.eventIntervalFrames = Math.ceil(sampleRate * data.intervalMs / 1000);
        if (this.eventEnabled !== data.enabled || this.eventEpoch !== data.epoch) {
          this.eventEnabled = data.enabled; this.resetObservation(data.epoch, 'subscribe');
        }
        break;
      case 'snapshot': {
        this.requireLoaded();
        const snapshot = this.core.snapshot(), state = this.state();
        reply.postMessage({type: 'result', id: data.id, value: {...snapshot,
          positionSeconds: state.positionSeconds, playbackNativeFrames: state.playbackNativeFrames,
          nativeSampleRate: NATIVE_RATE, muteMask: this.muteMask}}, [snapshot.ram.buffer, snapshot.dsp.buffer]);
        return;
      }
      case 'state': break;
      default: throw new Error(`Unknown SPC command: ${data.type}`);
    }
    reply.postMessage({type: 'result', id: data.id, value: this.state()});
  }
  fail(error) {
    if (this.disposed || this.failed) return;
    this.failed = true; this.playing = false;
    this.core?.dispose(); this.core = null;
    this.port.postMessage({type: 'error', error: String(error.message ?? error)});
    this.remote?.postMessage({fatal:true, error:String(error.message ?? error)});
    this.remote?.close(); this.remote = null;
    this.port.onmessage = null; this.port.close();
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true; this.playing = false;
    this.core?.dispose(); this.core = null;
    this.remote?.close(); this.remote = null;
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
      if (this.eventEnabled) {this.eventFrames += channels[0].length; this.sendObservedEvents();}
      for (let c = 2; c < channels.length; c++) channels[c].set(channels[0]);
    } catch (error) {
      for (let c = 0; c < channels.length; c++) channels[c].fill(0);
      this.fail(error); return false;
    }
    return true;
  }
}

registerProcessor('tetorica-spc', SpcProcessor);

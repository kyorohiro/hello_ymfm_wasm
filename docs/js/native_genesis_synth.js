import {YM2612Synth} from './ym2612synth.js?v=audio-stability-2';
import {createSegaPsgApi} from './segapsg_api.js?v=audio-numeric-bindings-1';
import {SoundChipMixer, chipMixGains} from './soundchip_mixer.js?v=chip-tabs-2';
import {midiToOpnPitch} from './soundchip_pitch.js';
import {createNativeGenesisMedia} from './native_genesis_media.js';
import {createNativeGenesisFX} from './native_genesis_fx.js';

const MAX_BATCH = 4096;
const MAX_PENDING = 65536;
const unsupported = feature => {throw new Error(`${feature} is unavailable in the experimental Native Genesis backend. Select Web Audio to use it.`);};
const byte = (value, label) => {
  if (!Number.isInteger(value) || value < 0 || value > 255) throw new RangeError(`${label} must be an integer from 0 to 255`);
  return value;
};

/** Explicit timing interface, independent of an AudioContext or an AudioNode.
 * Between acknowledgements, time follows the monotonic host clock. A native
 * status acknowledgement reanchors it; no UI/audio polling is needed. */
class NativeAudioClock extends EventTarget {
  constructor(now) {
    super(); this.now = now; this.anchorMs = now(); this.anchorSeconds = 0;
    this.sampleRate = 0; this.state = 'suspended';
  }
  get currentTime() {
    return this.anchorSeconds + (this.state === 'running' ? Math.max(0, this.now() - this.anchorMs) / 1000 : 0);
  }
  update(status, anchorMs, reset = false) {
    if (!Number.isSafeInteger(status?.frame) || status.frame < 0 ||
        !Number.isInteger(status.sampleRate) || status.sampleRate < 8000 || status.sampleRate > 384000) {
      throw new Error('Native Genesis returned an invalid audio clock');
    }
    const previous = this.currentTime;
    this.anchorSeconds = status.frame / status.sampleRate; this.anchorMs = anchorMs;
    if (!reset && this.state === 'running' && this.currentTime < previous) {
      this.anchorSeconds += previous - this.currentTime;
    }
    this.sampleRate = status.sampleRate;
    const state = status.running === false ? 'suspended' : 'running';
    if (state !== this.state) {this.state = state; this.dispatchEvent(new Event('statechange'));}
  }
  setState(value) {
    if (this.state === value) return;
    const seconds = this.currentTime; this.state = value; this.anchorSeconds = seconds; this.anchorMs = this.now();
    this.dispatchEvent(new Event('statechange'));
  }
}

/** Genesis-only native audio owner for the existing Playground runtime.
 * `invoke` is a captured Tauri command transport, injected by the host. Import
 * and construction open no audio devices. Generated playback PCM stays native;
 * media uploads and explicit recording retrieval are one-off operations.
 * Web Audio remains the application's default and supports the full feature set.
 * @param {{invoke:(command:string,args?:object)=>Promise<unknown>,now?:()=>number,onError?:(error:Error)=>void,mixer?:SoundChipMixer,masterVolume?:number}} options
 */
export class NativeGenesisSynth {
  constructor({invoke, now = () => performance.now(), onError = () => {}, mixer = new SoundChipMixer(), masterVolume = 1} = {}) {
    if (typeof invoke !== 'function') throw new TypeError('Native Genesis requires the Tauri invoke transport');
    this.invoke = invoke; this.now = now; this.onError = onError;
    this.backend = 'native-genesis'; this.chip = 'ym2612';
    this.capabilities = Object.freeze({chip:'ym2612', fmChannels:6, psg:true, dac:true,
      pcm:false, recorder:true, worker:true, noise:false, dynamicSoundChips:false, backend:'native-genesis'});
    this.clock = new NativeAudioClock(now);
    this.audioContext = null; this.node = null; this.audio = null;
    this.state = 'idle'; this.session = null; this.generation = 0;
    this.pending = []; this.acceptedCommands = 0; this.acceptedRequests = 0; this.serial = Promise.resolve(); this.flushQueued = false;
    this.starting = null; this.stopping = null; this.closing = null; this.error = null;this.workerSampleOrigin=null;
    this.listeners = new Set(); this.mixer = mixer; this.mixerReleases = [];
    this.masterVolume = this.validateVolume(masterVolume); this.listeningVolume = 1;
    this.auditions = new Map(); this.psgAuditions = new Map(); this.psgLevels = new Uint8Array(4).fill(6); this.psgLatch = 0;
    this.mix = {fmLeft:1,fmRight:1,psgLeft:1,psgRight:1,master:this.masterVolume};
    this.media = createNativeGenesisMedia(this);
    this.fxBeatSeconds = () => .5; this.fx = null;
    const write = (port, register, value) => this.write(port, register, value);
    const transport = {
      reset: () => {
        this.auditions.clear(); this.psgAuditions.clear(); this.psgLevels.fill(6); this.psgLatch = 0;
        if (this.state === 'ready') this.enqueue({type:'reset',frame:0});
      },
      write,
      writeBatch: writes => this.enqueueMany(writes.map(entry => this.registerCommand(entry))),
      scheduleWrites: entries => this.scheduleWrites(entries),
      clearScheduledWrites: () => unsupported('Clearing an individual native schedule'),
      dacCommand: command => this.media.dacCommand(command),
      clearDacPlayback: () => {this.media.dacCommand({action:'stop'}).catch(error=>this.reportAsyncError(error));},
      loadDacBank: (name,bytes) => this.media.loadDacBank(name,bytes),
      playDacBank: (name,time) => {this.media.playDacBank(name,time).catch(error=>this.reportAsyncError(error));},
      read: () => unsupported('Synchronous chip reads'),
      readStatus: () => unsupported('Synchronous chip reads'),
    };
    this.fm = new YM2612Synth({transport,clock:7670454});
    Object.defineProperty(this.fm,'id',{value:'ym2612',enumerable:true});
    this.installFmEvents();
    this.psg = createSegaPsgApi({clock:3579545,
      write: value => this.writePsg(value),
      setStereo: value => this.enqueue({type:'psg-stereo',value:byte(value,'Stereo mask'),frame:0}),
      reset: () => this.resetPsg(), resetAll: () => this.fm.reset(),
    });
    Object.defineProperty(this.psg,'id',{value:'segapsg',enumerable:true});
    this.sample = this.media.sample;
    this.stream = this.unavailableMedia('Streaming playback');
    this.noise = {create:() => unsupported('Web Audio noise'),stopAll(){}};
    this.chipInspector = this.createInspector();
  }
  unavailableMedia(feature) {
    return {load:()=>unsupported(feature),play:()=>unsupported(feature),
      stop(){},stopAll(){},pause(){},unload:()=>false,isLoaded:()=>false,get:()=>null,list:()=>[]};
  }
  validateVolume(value) {
    const volume = Number(value);
    if (!Number.isFinite(volume)) throw new TypeError('Master volume must be finite');
    return Math.max(0,Math.min(3.8,volume));
  }
  isReady() {return this.state === 'ready' && this.session !== null;}
  addListener(listener) {this.listeners.add(listener); return () => this.listeners.delete(listener);}
  emit(event) {for (const listener of this.listeners) {try {listener(event);} catch (error) {console.error(error);}}}
  installFmEvents() {
    const events = {
      reset:()=>({type:'reset'}),setPreset:(channel,preset)=>({type:'setPreset',channel,preset}),
      setOperator:(channel,operator,params)=>({type:'setOperator',channel,operator,params}),
      setAlgo:(channel,algorithm,feedback)=>({type:'setAlgo',channel,algorithm,feedback}),
      setPan:(channel,left,right,ams,pms)=>({type:'setPan',channel,left,right,ams,pms}),
      setLfo:(enabled,frequency)=>({type:'setLfo',enabled,frequency}),
      noteOn:(channel,block,fnum)=>({type:'noteOn',channel,block,fnum}),noteOff:channel=>({type:'noteOff',channel}),
    };
    for (const [name,toEvent] of Object.entries(events)) {
      const original = this.fm[name];
      this.fm[name] = (...args) => {const result = original.apply(this.fm,args); this.emit(toEvent(...args)); return result;};
    }
  }
  async start() {
    if (this.closing) await this.closing;
    if (this.stopping) await this.stopping;
    if (this.isReady()) return this;
    if (this.starting) return this.starting;
    if (this.state === 'error' && this.session !== null) await this.close();
    const generation = ++this.generation; this.state = 'starting'; this.error = null;
    const pending = (async () => {
      let status;
      try {
        status = await this.invoke('native_genesis_start');
        if (generation !== this.generation) {
          if (status?.session != null) await this.invoke('native_genesis_shutdown',{session:status.session});
          throw new DOMException('Native audio initialization was cancelled','AbortError');
        }
        if (!Number.isSafeInteger(status?.session) || status.session < 1) throw new Error('Native Genesis returned an invalid session');
        this.session = status.session; this.clock.update(status,this.now(),true);
        this.fm.clock = status.ymClock ?? 7670454;
        this.state = 'ready';
        for (const id of ['ym2612','segapsg']) this.mixerReleases.push(this.mixer.register(id,id,settings => {
          const [left,right] = chipMixGains(settings); const prefix = id === 'ym2612' ? 'fm' : 'psg';
          this.mix[`${prefix}Left`] = left; this.mix[`${prefix}Right`] = right;
          if (this.isReady() && !this.stopping && !this.closing) this.enqueue({type:'mix',frame:0,...this.mix});
        }));
        this.fm.reset();
        await this.flush();
        this.chipInspector.notify();
        return this;
      } catch (error) {
        if (generation === this.generation) {
          this.state = 'error'; this.error = error; this.clock.setState('suspended');
          this.releaseMixer();
          if (this.session !== null) await this.invoke('native_genesis_shutdown',{session:this.session}).catch(()=>{});
          this.session = null;
        }
        throw error;
      }
    })();
    this.starting = pending;
    try {return await pending;} finally {if (this.starting === pending) this.starting = null;}
  }
  async resume() {
    await this.start();
    const session = this.session, generation = this.generation, before = this.now();
    const status = await this.invoke('native_genesis_status',{session});
    if (generation !== this.generation || session !== this.session) throw new DOMException('Native audio session was replaced','AbortError');
    if (status.error) throw new Error(status.error);
    this.clock.update(status,(before + this.now()) / 2);
  }
  registerCommand({port=0,register,value,time}) {
    if (port !== 0 && port !== 1) throw new RangeError('FM port must be 0 or 1');
    byte(register,'FM register'); byte(value,'FM value');
    return {type:'write',port,register,value,frame:time === undefined ? 0 : this.frameAt(time)};
  }
  frameAt(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) throw new RangeError('Schedule time must be nonnegative finite seconds');
    const frame = Math.round(seconds * this.clock.sampleRate);
    if (!Number.isSafeInteger(frame)) throw new RangeError('Schedule exceeds the native frame clock');
    return frame;
  }
  write(port,register,value) {this.enqueue(this.registerCommand({port,register,value}));}
  writePsg(value) {
    byte(value,'PSG value');
    this.enqueue({type:'psg-write',value,frame:0});
    if (value & 128) this.psgLatch = value >> 4 & 7;
    if ((this.psgLatch & 1) && (value & 15) !== 15) this.psgLevels[this.psgLatch >> 1] = value & 15;
  }
  scheduleWrites(entries) {
    if (!Array.isArray(entries)) throw new TypeError('Scheduled writes must be an array');
    // Validate the entire group before accepting any of it.
    this.enqueueMany(entries.map(entry => entry.type === 'psg-write'
      ? {type:'psg-write',frame:this.frameAt(entry.time),value:byte(entry.value,'PSG value')}
      : this.registerCommand(entry)));
  }
  enqueue(command) {this.enqueueMany([command]);}
  enqueueMany(commands) {
    if (!this.isReady()) throw new Error('Native Genesis audio is not ready');
    if (this.stopping || this.closing) throw new DOMException('Native audio is stopping','AbortError');
    if (this.acceptedCommands + commands.length > MAX_PENDING) throw new RangeError('Native audio command queue is full');
    this.acceptedCommands += commands.length;
    this.pending.push(...commands);
    if (!this.flushQueued) {
      this.flushQueued = true;
      queueMicrotask(() => {this.flushQueued = false; this.flush().catch(error => {
        if (error.name !== 'AbortError') this.fail(error);
      });});
    }
  }
  flush() {
    const commands = this.pending.splice(0), session = this.session, generation = this.generation;
    if (!commands.length) return this.serial;
    const pending = this.serial.then(async () => {
      for (let offset = 0; offset < commands.length; offset += MAX_BATCH) {
        if (generation !== this.generation || session !== this.session) throw new DOMException('Native audio commands were cancelled','AbortError');
        await this.invoke('native_genesis_commands',{session,commands:commands.slice(offset,offset + MAX_BATCH)});
      }
    }).finally(()=>{this.acceptedCommands -= commands.length;});
    // Keep the serialization chain usable after cancellation/failure. The
    // caller's promise retains the rejection; automatic sends report it once.
    this.serial = pending.catch(()=>{});
    pending.catch(error=>{if (error.name !== 'AbortError' && generation === this.generation) this.fail(error);});
    return pending;
  }
  /** One-off preparation shares the command ordering barrier. A late response
   * cannot install state or resume playback after Stop/session replacement. */
  nativeRequest(command,args={}) {
    if (!this.isReady()) return Promise.reject(new Error('Native Genesis audio is not ready'));
    if (this.stopping || this.closing) return Promise.reject(new DOMException('Native audio is stopping','AbortError'));
    if(this.acceptedRequests>=256)return Promise.reject(new RangeError('Native preparation request queue is full'));
    this.acceptedRequests++;
    this.flush().catch(()=>{});
    const session=this.session,generation=this.generation;
    const pending=this.serial.then(async()=>{
      if (session!==this.session || generation!==this.generation) throw new DOMException('Native audio commands were cancelled','AbortError');
      const result=await this.invoke(command,{...args,session});
      if (session!==this.session || generation!==this.generation) throw new DOMException('Native audio commands were cancelled','AbortError');
      return result;
    }).finally(()=>{this.acceptedRequests--;});
    this.serial=pending.catch(()=>{});
    return pending;
  }
  reportAsyncError(error) {if(error?.name!=='AbortError') this.fail(error);}
  setNativePerformance(request) {
    if(request.op==='start'||request.op==='stop')this.workerSampleOrigin=null;
    return this.nativeRequest('native_genesis_performance',request);
  }
  dispatchNativeFxCommand(message,timing={}) {
    if(message?.op==='sample')return this.media.dispatchSample(message,timing);
    if(message?.op?.startsWith('live-fx'))return Promise.reject(new Error('JavaScript LiveFX is unavailable in Native Genesis. Select Web Audio to use it.'));
    return this.nativeRequest('native_genesis_fx',{message,
      ...(timing.time===undefined?{}:{frame:this.frameAt(timing.time)}),
      ...(timing.performance===undefined?{}:{performance:timing.performance}),
      ...(timing.owner===undefined?{}:{owner:timing.owner})});
  }
  /** Explicit Worker transport receiver. A real MessagePort bridge supplies
   * timing and ownership; the native synth remains independent of AudioNodes. */
  async dispatchNativeCommand(message,timing={}) {
    const timed = command => ({...command,
      ...(timing.time===undefined?{}:{frame:this.frameAt(timing.time)}),
      ...(timing.performance===undefined?{}:{performance:timing.performance}),
      ...(timing.owner===undefined?{}:{owner:timing.owner})});
    if(Array.isArray(message)) {
      const commands=message.map(command=>{
        if(command?.type==='write')return timed(this.registerCommand(command));
        if(command?.type==='psg-write')return timed({type:'psg-write',frame:0,value:byte(command.value,'PSG value')});
        if(command?.type==='psg-stereo')return timed({type:'psg-stereo',frame:0,value:byte(command.value,'Stereo mask')});
        if(command?.type==='psg-reset')return timed({type:'psg-reset',frame:0});
        if(command?.type==='reset')return timed({type:'reset',frame:0});
        throw new Error('Unsupported native Worker command group');
      });this.enqueueMany(commands);await this.flush();return;
    }
    switch(message?.type) {
      case 'write':this.enqueue(timed(this.registerCommand(message)));break;
      case 'psg-write':this.enqueue(timed({type:'psg-write',frame:0,value:byte(message.value,'PSG value')}));break;
      case 'psg-stereo':this.enqueue(timed({type:'psg-stereo',frame:0,value:byte(message.value,'Stereo mask')}));break;
      case 'psg-reset':this.enqueue(timed({type:'psg-reset',frame:0}));break;
      case 'reset':this.enqueue(timed({type:'reset',frame:0}));break;
      case 'schedule-writes': {
        if(!Array.isArray(message.entries))throw new TypeError('Scheduled writes must be an array');
        this.enqueueMany(message.entries.map(entry=>{
          const command=entry.type==='psg-write'?{type:'psg-write',frame:this.frameAt(entry.time),value:byte(entry.value,'PSG value')}:this.registerCommand(entry);
          return {...command,...(timing.performance===undefined?{}:{performance:timing.performance}),...(timing.owner===undefined?{}:{owner:timing.owner})};
        }));break;
      }
      case 'pcm-dac':
        try {await this.media.dacCommand(message.command,timing);return {type:'pcm-dac-result',id:message.id};}
        catch(error) {return {type:'pcm-dac-result',id:message.id,error:String(error.message??error)};}
      case 'load-dac-bank':await this.media.loadDacBank(message.name,new Uint8Array(message.data));return;
      case 'play-dac-bank':await this.media.playDacBank(message.name,message.time,{...timing,time:undefined});return;
      case 'clear-dac-playback':await this.media.dacCommand({action:'stop'},timing);return;
      case 'reset-sample-schedule':this.workerSampleOrigin=null;return;
      case 'begin-sample-schedule':
        this.workerSampleOrigin??=(timing.time??this.clock.currentTime)+Math.max(0,Number(message.lookaheadSeconds)||0);return;
      case 'sample-writes': {
        if(!Array.isArray(message.entries))throw new TypeError('Sample writes must be an array');
        this.workerSampleOrigin??=timing.time??this.clock.currentTime;
        const entries=message.entries.map(({sample,...entry})=>{
          if(!Number.isFinite(sample)||sample<0)throw new RangeError('Invalid sample offset');
          return {...entry,time:this.workerSampleOrigin+sample/44100};
        });
        await this.dispatchNativeCommand({type:'schedule-writes',entries},{...timing,time:undefined});return;
      }
      case 'sample-dac-bank':
        if(!Number.isFinite(message.sample)||message.sample<0)throw new RangeError('Invalid sample offset');
        this.workerSampleOrigin??=timing.time??this.clock.currentTime;
        await this.media.playDacBank(message.name,this.workerSampleOrigin+message.sample/44100,{...timing,time:undefined});return;
      case 'clear-scheduled-writes':unsupported('Clearing an individual native schedule');break;
      default:throw new Error(`Unsupported native Worker command: ${message?.type}`);
    }
    await this.flush();
  }
  fail(error) {
    if (this.state === 'closed' || this.state === 'error') return;
    this.error = error instanceof Error ? error : new Error(String(error));
    ++this.generation; this.state = 'error'; this.discardPending(); this.clock.setState('suspended');
    this.chipInspector.notify();
    try {this.onError(this.error);} catch (callbackError) {console.error(callbackError);}
    this.emit({type:'backend-error',error:this.error});
    this.stopNativeAudio().catch(()=>{});
  }
  silencePsg() {
    if (!this.isReady() || this.stopping || this.closing) return;
    this.enqueueMany([0x9f,0xbf,0xdf,0xff].map(value => ({type:'psg-write',frame:0,value})));
  }
  resetPsg() {
    if (!this.isReady() || this.stopping || this.closing) return;
    this.psgAuditions.clear();this.psgLevels.fill(6);this.psgLatch=0;
    this.enqueue({type:'psg-reset',frame:0});
  }
  discardPending() {this.acceptedCommands -= this.pending.length; this.pending.length = 0;}
  /** Stop is a barrier: old sends settle before the native callback clears its
   * queue and fades/resets. The device clock continues in the same session. */
  stopNativeAudio() {
    if (this.stopping) return this.stopping;
    if (this.session === null) return Promise.resolve();
    // Native Stop resets the rendered rack. Retire its JS descriptors too, so
    // repeated Runs reuse slots and old parameter handles cannot edit a new rack.
    this.fx?.dispose();
    ++this.generation; this.discardPending();
    this.media.stopped();
    this.workerSampleOrigin=null;
    this.auditions.clear(); this.psgAuditions.clear();
    const session = this.session;
    const pending = this.serial.then(async () => {
      const status = await this.invoke('native_genesis_stop',{session});
      if (session === this.session) this.clock.update(status,this.now());
    }).catch(error=>{this.fail(error);throw error;}).finally(()=>{if (this.stopping === pending) this.stopping=null;});
    this.stopping = pending;
    return pending;
  }
  close() {
    if (this.closing) return this.closing;
    const stop = this.stopNativeAudio(); ++this.generation; this.discardPending();
    const pending = (async () => {
      await this.starting?.catch(()=>{});
      await stop.catch(()=>{}); await this.serial;
      const session = this.session; this.session = null;
      this.releaseMixer(); this.state = 'closed'; this.clock.setState('closed');
      this.media.reset(); this.fx = null;
      this.auditions.clear(); this.psgAuditions.clear(); this.chipInspector.notify();
      if (session !== null) await this.invoke('native_genesis_shutdown',{session});
    })();
    this.closing = pending;
    pending.finally(()=>{if (this.closing === pending) this.closing=null;}).catch(()=>{});
    return pending;
  }
  releaseMixer() {for (const release of this.mixerReleases.splice(0)) release();}
  setMasterVolume(value) {
    this.masterVolume = this.validateVolume(value); this.mix.master = this.masterVolume * this.listeningVolume;
    if (this.isReady() && !this.stopping && !this.closing) this.enqueue({type:'mix',frame:0,...this.mix});
    this.emit({type:'setMasterVolume',volume:this.masterVolume});
    return this.masterVolume;
  }
  getMasterVolume() {return this.masterVolume;}
  setListeningVolume(value) {
    const volume = Number(value);
    if (!Number.isFinite(volume) || volume < 0 || volume > 1) throw new RangeError('Listening volume must be from 0 to 1');
    this.listeningVolume = volume; this.mix.master = this.masterVolume * volume;
    if (this.isReady() && !this.stopping && !this.closing) this.enqueue({type:'mix',frame:0,...this.mix});
  }
  auditionNoteOn(channel,block,fnum,token) {
    this.auditions.set(channel,token); this.fm.noteOn(channel,block,fnum);
  }
  auditionNoteOff(channel,token) {
    if (this.auditions.get(channel) !== token) return;
    this.auditions.delete(channel); this.fm.noteOff(channel);
  }
  clearAuditions() {
    const channels = [...this.auditions.keys()]; this.auditions.clear();
    if (this.isReady() && !this.stopping && !this.closing) for (const channel of channels) this.fm.noteOff(channel);
    const psgChannels = [...this.psgAuditions.keys()]; this.psgAuditions.clear();
    if (this.isReady() && !this.stopping && !this.closing) for (const channel of psgChannels) this.psg.setAttenuation(channel,15);
  }
  /** Admin operations use the native command transport directly. No MessagePort,
   * AudioNode or PCM bridge is fabricated for the shared Keyboard UI. */
  createInspector() {
    const listeners = new Set(); let disposed = false;
    const list = () => disposed || !this.isReady() ? [] : [
      {id:'ym2612',kind:'ym2612',name:'ym2612',label:'YM2612 (Native)',connected:true},
      {id:'segapsg',kind:'segapsg',name:'segapsg',label:'Sega PSG (Native)',connected:true},
    ];
    const endpoint = id => {
      if (!list().some(entry=>entry.id === id)) throw new Error('Sound chip is not connected');
    };
    const identity = id => {
      if (typeof id !== 'string' || !id.length || id.length > 256) throw new TypeError('Audition identity must contain 1..256 characters');
      return id;
    };
    return {
      list,
      getConnectionToken: id => {endpoint(id);return this.session;},
      subscribe(listener) {
        if (typeof listener !== 'function') throw new TypeError('Inspector listener must be a function');
        if (disposed) return ()=>{};
        listeners.add(listener);return ()=>listeners.delete(listener);
      },
      notify: () => {for (const listener of listeners) {try {listener(list());} catch(error) {console.error(error);}}},
      read: async id => {
        endpoint(id);
        if (id === 'segapsg') unsupported('Applied PSG voice snapshots');
        return {kind:'ym2612',clock:this.fm.clock,sampleRate:this.clock.sampleRate,
          keyboardChannels:Array.from({length:6},(_,channel)=>({id:`fm:${channel}`,label:`FM ${channel+1}`})),
          held:[...this.auditions.keys()].map(channel=>`fm:${channel}`)};
      },
      invoke: async (id,method,args=[]) => {
        endpoint(id);
        if (method === 'auditionAllOff') {this.clearAuditions();await this.flush();return true;}
        if (!['auditionOn','auditionOff'].includes(method)) unsupported('Native voice inspector editing');
        if (!Array.isArray(args)) throw new TypeError('Audition arguments must be an array');
        const channel = id === 'ym2612' && typeof args[0] === 'string' && /^fm:[0-5]$/.test(args[0])
          ? Number(args[0].slice(3)) : args[0];
        const maxChannel = id === 'ym2612' ? 5 : 3;
        if (!Number.isInteger(channel) || channel < 0 || channel > maxChannel) throw new RangeError('Invalid native Keyboard channel');
        if (method === 'auditionOff') {
          const token = identity(args[1]);
          if (id === 'ym2612') this.auditionNoteOff(channel,token);
          else if (this.psgAuditions.get(channel) === token) {this.psgAuditions.delete(channel);this.psg.setAttenuation(channel,15);}
        } else {
          const midi = args[1], token = identity(args[2]);
          if (!Number.isInteger(midi) || midi < 0 || midi > 127) throw new RangeError('MIDI note must be 0..127');
          if (args[3] !== undefined && (!Number.isInteger(args[3]) || args[3] < 0 || args[3] > 127)) throw new RangeError('Velocity must be 0..127');
          if (id === 'ym2612') {
            const {block,fnum} = midiToOpnPitch(midi,this.fm.clock,144);
            this.auditionNoteOn(channel,block,fnum,token);
          } else {
            if (channel < 3) this.psg.setFrequency(channel,440*2**((midi-69)/12));
            this.psg.setAttenuation(channel,this.psgLevels[channel]);this.psgAuditions.set(channel,token);
          }
        }
        await this.flush();return true;
      },
      loadSample: async () => unsupported('Native sample loading'),
      dispose() {disposed = true;listeners.clear();},
    };
  }
  createFXApi({getBeatSeconds=()=>.5}={}) {
    this.fxBeatSeconds=getBeatSeconds;
    if(!this.fx) {
      let session=this.session;
      this.fx=createNativeGenesisFX({send:message=>{
        session??=this.session;
        if(session!==this.session)throw new DOMException('Native FX session was replaced','AbortError');
        this.nativeRequest('native_genesis_fx',{message}).catch(error=>this.reportAsyncError(error));
      },getBeatSeconds:()=>this.fxBeatSeconds()});
    }
    return this.fx;
  }
  clearFXChain(options) {return this.fx?.clear(options)??[];}
  getFXChain() {return this.fx?.getChain()??[];}
  setFXChain(effects) {return (this.fx??this.createFXApi()).setChain(effects);}
  syncFXTempo() {if(this.isReady()&&!this.stopping&&!this.closing)this.fx?.syncTempo();}
  startOutputRecording(options) {return this.media.startRecording(options);}
  stopOutputRecording() {return this.media.stopRecording();}
  getAudioContext() {return null;}
}

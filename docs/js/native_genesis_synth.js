import {YM2612Synth} from './ym2612synth.js?v=audio-stability-2';
import {createSegaPsgApi} from './segapsg_api.js?v=audio-numeric-bindings-1';
import {SoundChipMixer, chipMixGains} from './soundchip_mixer.js?v=chip-tabs-2';
import {midiToOpnPitch} from './soundchip_pitch.js';
import {createNativeGenesisMedia} from './native_genesis_media.js';
import {createNativeGenesisFX} from './native_genesis_fx.js';
import {createNativeGenesisMonitor} from './native_genesis_monitor.js';
import {createNativeGenesisNoise,nativeGenesisNoiseMessage} from './native_genesis_noise.js';
import {nativeGenesisLiveFxMessage,createNativeGenesisLiveFxStatus} from './native_genesis_livefx.js';
import {createNativeGenesisRf5c164} from './native_genesis_rf5c164.js?v=audio-numeric-bindings-1';
import {createNativeGenesisDx7} from './native_genesis_dx7.js?v=audio-numeric-bindings-1';
import {createNativeGenesisNes} from './native_genesis_nes.js?v=nes-wasm-1';
import {createNativeGenesisConsole} from './native_genesis_console.js?v=native-consoles-1';
import {createNativeGenesisSnes} from './native_genesis_snes.js?v=native-consoles-1';
import {createNativeGenesisPwm} from './native_genesis_pwm.js?v=pwm-wasm-1';
import {createNativeGenesisYm2608} from './native_genesis_ym2608.js?v=native-neogeo-1';
import {createNativeGenesisYm2610B} from './native_genesis_ym2610b.js?v=native-neogeo-1';
import {createNativeGenesisX68000} from './native_genesis_x68000.js?v=native-x68000-1';
import {createNativeGenesisMasterSystem} from './native_genesis_master_system.js?v=native-master-system-1';

const MAX_BATCH = 4096;
const MAX_PENDING = 65536;
const MAX_PCM_UPLOAD_PENDING = 4 * 1024 * 1024;
const pwmBytes=command=>command.type==='pwm'&&command.message?.method==='schedule-writes'?command.message.entries.length*24:0;
const pcmBytes=command=>pwmBytes(command)||(command.type==='rf5c164-load-memory'?command.data.length:['ym2608','ym2610b'].includes(command.type)&&['memory','rom'].includes(command.message?.method)?command.message.data.length:['nes','snes'].includes(command.type)&&command.message?.method==='load-memory'?command.message.data.length:command.type==='x68000'&&command.message?.method==='memory-chunk'?command.message.data.length:command.type==='snes'&&command.message?.method==='prepare-timeline'?command.message.ram.length+command.message.dsp.length+command.message.events.length*4:0);
const maxUpload=command=>command.type==='pwm'?32*1024*1024:command.type==='x68000'&&command.message?.method==='memory-chunk'?command.message.data.length:command.type==='snes'&&command.message?.method==='prepare-timeline'?16*1024*1024+65664:65536;
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

/** Genesis / Mega-CD native audio owner for the existing Playground runtime.
 * `invoke` is a captured Tauri command transport, injected by the host. Import
 * and construction open no audio devices. Continuous rendering/output stays
 * native; uploads, requested monitor snapshots and recording retrieval are
 * explicit data transfers rather than a playback PCM bridge.
 * Web Audio remains the application's default and supports the full feature set.
 */
export class NativeGenesisSynth {
  /** @param {{invoke:(command:string,args?:object)=>Promise<any>,now?:()=>number,
   * onError?:(error:Error)=>void,mixer?:SoundChipMixer,masterVolume?:number,
   * decodeAudio?:(bytes:ArrayBuffer)=>Promise<any>,fetcher?:typeof globalThis.fetch,megaCD?:boolean,dx7?:boolean,
   * mode?:'genesis'|'mega-cd'|'dx7'|'nes'|'gameboy'|'snes'|'pc-engine'|'pc98'|'ym2608'|'neogeo'|'neogeo-b'|'ym2610'|'ym2610b'|'x68000'|'master-system'|'genesis-full'|'32x'}} [options] */
  constructor({invoke, now = () => performance.now(), onError = () => {}, mixer = new SoundChipMixer(), masterVolume = 1, decodeAudio,fetcher,megaCD=false,dx7=false,mode} = {}) {
    if (typeof invoke !== 'function') throw new TypeError('Native Genesis requires the Tauri invoke transport');
    if(mode==='genesis-full')mode='32x';
    if(mode==='ym2608')mode='pc98';
    if(mode==='ym2610')mode='neogeo';
    if(mode==='ym2610b')mode='neogeo-b';
    this.invoke = invoke; this.now = now; this.onError = onError;
    this.backend = 'native-genesis';this.consoleKind=mode==='gameboy'?'gameboy':mode==='pc-engine'||mode==='huc6280'?'huc6280':null;this.snesMode=mode==='snes';
    this.masterSystemMode=mode==='master-system';this.x68000Mode=mode==='x68000';this.opnaMode=mode==='pc98';this.opnbMode=['neogeo','neogeo-b'].includes(mode);this.nesMode=mode==='nes';this.dx7Mode=!this.consoleKind&&!this.snesMode&&!this.nesMode&&!this.opnaMode&&!this.opnbMode&&!this.x68000Mode&&!this.masterSystemMode&&(dx7===true||mode==='dx7');this.primaryMode=!!this.consoleKind||this.snesMode||this.nesMode||this.dx7Mode||this.opnaMode||this.opnbMode||this.x68000Mode||this.masterSystemMode;
    this.chip = this.consoleKind??(this.masterSystemMode?'segapsg':this.x68000Mode?'x68000':this.opnaMode?'ym2608':this.opnbMode?(mode==='neogeo-b'?'ym2610b':'ym2610'):this.snesMode?'snes':this.nesMode?'nes':this.dx7Mode?'dx7':'ym2612');this.mode=this.masterSystemMode?'master-system':this.opnbMode?mode:this.opnaMode?'pc98':this.chip==='huc6280'?'pc-engine':this.chip==='ym2612'?mode??(megaCD?'mega-cd':'genesis'):this.chip;this.pwmMode=!this.primaryMode&&mode==='32x';this.megaCD=!this.primaryMode&&(megaCD===true||mode==='mega-cd'||this.pwmMode);
    this.capabilities = Object.freeze({chip:this.chip, fmChannels:this.opnbMode?(mode==='neogeo-b'?6:4):this.opnaMode?6:this.primaryMode?0:6, psg:!this.primaryMode||this.masterSystemMode, dac:!this.primaryMode,
      pcm:this.megaCD,pwm:this.pwmMode, recorder:true, worker:true, noise:true, dynamicSoundChips:false, backend:'native-genesis'});
    this.clock = new NativeAudioClock(now);
    this.outputMonitor = createNativeGenesisMonitor({invoke:(command,args)=>this.invoke(command,args),
      getSession:()=>this.session,getSampleRate:()=>this.clock.sampleRate,
      isReady:()=>this.isReady() && !this.stopping && !this.closing && this.clock.state === 'running'});
    this.audioContext = null; this.node = null; this.audio = null;
    this.state = 'idle'; this.session = null; this.generation = 0;
    this.pending = []; this.acceptedCommands = 0;this.acceptedPcmBytes=0; this.acceptedRequests = 0; this.serial = Promise.resolve(); this.flushQueued = false;
    this.starting = null; this.stopping = null; this.closing = null; this.error = null;this.workerSampleOrigin=null;
    this.listeners = new Set(); this.mixer = mixer; this.mixerReleases = [];
    this.liveFxDiagnostics=createNativeGenesisLiveFxStatus({invoke:(command,args)=>this.invoke(command,args),
      getSession:()=>this.session,getGeneration:()=>this.generation,isReady:()=>this.isReady()&&!this.stopping&&!this.closing,
      onChange:status=>this.emit({type:'live-fx-status',status,sampleRate:this.clock.sampleRate}),
      onError:message=>this.emit({type:'live-fx-error',message})});
    this.masterVolume = this.validateVolume(masterVolume); this.listeningVolume = 1;
    this.auditions = new Map(); this.psgAuditions = new Map(); this.psgLevels = new Uint8Array(4).fill(6); this.psgLatch = 0;
    this.mix = {fmLeft:1,fmRight:1,psgLeft:1,psgRight:1,master:this.masterVolume};
    this.media = createNativeGenesisMedia(this,{decodeAudio});
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
    this.nativeOpna=this.opnaMode?createNativeGenesisYm2608(this,{decodeAudio,fetcher}):null;
    this.nativeOpnb=this.opnbMode?createNativeGenesisYm2610B(this,{variant:mode==='neogeo-b',decodeAudio,fetcher}):null;
    this.nativeOpn=this.nativeOpna??this.nativeOpnb;
    this.fm = this.nativeOpn?.client??(this.primaryMode?null:new YM2612Synth({transport,clock:7670454}));
    if(this.fm&&!this.nativeOpn){
    Object.defineProperty(this.fm,'id',{value:'ym2612',enumerable:true});
    this.installFmEvents();
    this.psg = createSegaPsgApi({clock:3579545,
      write: value => this.writePsg(value),
      setStereo: value => this.enqueue({type:'psg-stereo',value:byte(value,'Stereo mask'),frame:0}),
      reset: () => this.resetPsg(), resetAll: () => this.fm.reset(),
    });
    Object.defineProperty(this.psg,'id',{value:'segapsg',enumerable:true});
    }else this.psg=null;
    if(this.nativeOpn)this.installFmEvents();
    this.sample = this.media.sample;
    this.nativePcm=this.megaCD?createNativeGenesisRf5c164(this,{decodeAudio}):null;
    this.pcm=this.nativePcm?.client??null;
    this.nativeDx7=this.dx7Mode?createNativeGenesisDx7(this):null;
    this.dx7=this.nativeDx7?.client??null;
    this.nativeNes=this.nesMode?createNativeGenesisNes(this):null;this.nes=this.nativeNes?.client??null;
    this.nativeConsole=this.consoleKind?createNativeGenesisConsole(this,this.consoleKind):null;
    this.gameboy=this.consoleKind==='gameboy'?this.nativeConsole.client:null;this.huc6280=this.consoleKind==='huc6280'?this.nativeConsole.client:null;this.pce=this.huc6280;
    this.nativeSnes=this.snesMode?createNativeGenesisSnes(this):null;this.snes=this.nativeSnes?.client??null;
    this.nativePwm=this.pwmMode?createNativeGenesisPwm(this):null;this.pwm=this.nativePwm?.client??null;
    this.nativeX68000=this.x68000Mode?createNativeGenesisX68000(this,{decodeAudio,fetcher}):null;
    this.opm=this.ym2151=this.nativeX68000?.ym2151.client??null;
    this.adpcm=this.okim6258=this.nativeX68000?.okim6258.client??null;
    this.nativeMasterSystem=this.masterSystemMode?createNativeGenesisMasterSystem(this):null;
    this.segapsg=this.nativeMasterSystem?.segapsg.client??null;
    if(this.segapsg)this.psg=this.segapsg;
    this.opll=this.ym2413=this.nativeMasterSystem?.ym2413.client??null;
    this.primaryEndpoints=this.nativeMasterSystem?[{name:'segapsg',globalName:'psg',client:this.psg},{name:'ym2413',globalName:'opll',client:this.opll}]:this.nativeX68000?[{name:'ym2151',globalName:'opm',client:this.opm},{name:'okim6258',globalName:'adpcm',client:this.adpcm}]:this.pwm?[{name:'pwm',globalName:'pwm',client:this.pwm}]:this.nativeConsole?[{name:this.consoleKind,globalName:this.gameboy?'gameboy':'pce',client:this.nativeConsole.client}]:this.snes?[{name:'snes',globalName:'snes',client:this.snes}]:this.nes?[{name:'nes',globalName:'nes',client:this.nes}]:this.dx7?[{name:'dx7',globalName:'dx7',client:this.dx7}]:[];
    this.stream = this.unavailableMedia('Streaming playback');
    this.nextNoiseNamespace=0;
    this.noise=createNativeGenesisNoise({send:message=>this.enqueue({type:'noise',frame:0,message}),getSampleRate:()=>this.clock.sampleRate});
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
  emit(event) {for (const listener of this.listeners) {try {listener(event);} catch (error) {console.error(error);}}if(this.nativeMasterSystem&&event.type==='native-state')this.chipInspector?.notify();}
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
        status = await this.invoke('native_genesis_start',...(this.consoleKind||this.snesMode||this.pwmMode||this.opnaMode||this.opnbMode||this.x68000Mode||this.masterSystemMode?[{mode:this.mode}]:this.nesMode?[{mode:'nes'}]:this.dx7Mode?[{mode:'dx7'}]:this.megaCD?[{mode:'mega-cd'}]:[]));
        if (generation !== this.generation) {
          if (status?.session != null) await this.invoke('native_genesis_shutdown',{session:status.session});
          throw new DOMException('Native audio initialization was cancelled','AbortError');
        }
        if (!Number.isSafeInteger(status?.session) || status.session < 1) throw new Error('Native Genesis returned an invalid session');
        this.session = status.session; this.clock.update(status,this.now(),true);
        this.liveFxDiagnostics.observe(status);
        if(this.fm&&!this.nativeOpn)this.fm.clock = status.ymClock ?? 7670454;
        if(this.pcm)this.pcm._adoptClock(status.rf5c164Clock??12500000);
        this.state = 'ready';
        for (const id of this.primaryMode?[]:['ym2612','segapsg']) this.mixerReleases.push(this.mixer.register(id,id,settings => {
          const [left,right] = chipMixGains(settings); const prefix = id === 'ym2612' ? 'fm' : 'psg';
          this.mix[`${prefix}Left`] = left; this.mix[`${prefix}Right`] = right;
          if (this.isReady() && !this.stopping && !this.closing) this.enqueue({type:'mix',frame:0,...this.mix});
        }));
        if(this.pcm)this.mixerReleases.push(this.mixer.register('rf5c164','rf5c164',settings=>{
          const [left,right]=chipMixGains(settings);
          if(this.isReady()&&!this.stopping&&!this.closing)this.enqueue({type:'rf5c164-mix',left,right,frame:0});
        }));
        if(this.dx7)this.mixerReleases.push(this.mixer.register('dx7','dx7',settings=>{
          if(this.isReady()&&!this.stopping&&!this.closing)this.nativeDx7.mix(settings.effectiveMuted?0:settings.volume,settings.pan).catch(error=>this.reportAsyncError(error));
        }));
        if(this.nes)this.mixerReleases.push(this.mixer.register('nes','nes',settings=>{
          if(this.isReady()&&!this.stopping&&!this.closing)this.nativeNes.mix(settings.effectiveMuted?0:settings.volume,settings.pan).catch(error=>this.reportAsyncError(error));
        }));
        for(const adapter of [this.nativeConsole,this.nativeSnes,this.nativePwm,this.nativeOpn])if(adapter){const id=adapter===this.nativePwm?'pwm':this.chip;this.mixerReleases.push(this.mixer.register(id,id,settings=>{
          if(this.isReady()&&!this.stopping&&!this.closing)adapter.mix(settings.effectiveMuted?0:settings.volume,settings.pan).catch(error=>this.reportAsyncError(error));
        }));if(adapter!==this.nativeOpn)adapter.initialize?.();}
        for(const pair of [this.nativeX68000,this.nativeMasterSystem])if(pair)for(const [id,endpoint]of Object.entries(pair)){
          this.mixerReleases.push(this.mixer.register(id,id,settings=>{
            if(this.isReady()&&!this.stopping&&!this.closing)endpoint.mix(settings.effectiveMuted?0:settings.volume,settings.pan).catch(error=>this.reportAsyncError(error));
          }));
          await endpoint.initialize();
        }
        this.nativeNes?.initialize();
        if(this.nativeOpn)await this.nativeOpn.initialize();
        else if(this.fm)this.fm.reset();
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
    this.liveFxDiagnostics.observe(status);
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
    const bytes=commands.reduce((sum,command)=>sum+pcmBytes(command),0);
    if(this.acceptedPcmBytes+bytes>(commands.some(command=>command.message?.method==='prepare-timeline'||command.type==='pwm')?32*1024*1024:MAX_PCM_UPLOAD_PENDING))throw new RangeError('Native PCM upload queue is full');
    this.acceptedCommands += commands.length;
    this.acceptedPcmBytes+=bytes;
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
    const bytes=commands.reduce((sum,command)=>sum+pcmBytes(command),0);
    const pending = this.serial.then(async () => {
      for (let offset = 0; offset < commands.length;) {
        if (generation !== this.generation || session !== this.session) throw new DOMException('Native audio commands were cancelled','AbortError');
        let end=offset,uploaded=0;
        while(end<commands.length&&end-offset<MAX_BATCH&&uploaded+pcmBytes(commands[end])<=maxUpload(commands[offset])){uploaded+=pcmBytes(commands[end]);end++;}
        if(end===offset)throw new RangeError('Native PCM upload exceeds its command limit');
        await this.invoke('native_genesis_commands',{session,commands:commands.slice(offset,end)});offset=end;
      }
    }).finally(()=>{this.acceptedCommands -= commands.length;this.acceptedPcmBytes-=bytes;});
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
    return this.nativeRequest('native_genesis_performance',request).then(async value=>{
      if(this.nativeDx7)await this.nativeDx7.performance(request);return value;
    });
  }
  dispatchNativeFxCommand(message,timing={}) {
    if(message?.op==='sample')return this.media.dispatchSample(message,timing);
    if(message?.op==='noise') {
      const namespace=timing.noiseNamespace;
      if(!Number.isSafeInteger(namespace)||namespace<1||namespace>this.nextNoiseNamespace)return Promise.reject(new RangeError('Invalid Native Worker noise namespace'));
      this.enqueue({type:'noise',frame:timing.time===undefined?0:this.frameAt(timing.time),
        ...(timing.performance===undefined?{}:{performance:timing.performance}),...(timing.owner===undefined?{}:{owner:timing.owner}),
        message:nativeGenesisNoiseMessage(message,{namespace,sampleRate:this.clock.sampleRate})});
      return this.flush();
    }
    if(message?.op==='live-fx') {
      const normalized=nativeGenesisLiveFxMessage(message),frame=timing.time===undefined?0:this.frameAt(timing.time);
      return this.nativeRequest('native_genesis_live_fx',{message:normalized,frame,
        ...(timing.performance===undefined?{}:{performance:timing.performance}),
        ...(timing.owner===undefined?{}:{owner:timing.owner})}).then(status=>{
          this.liveFxDiagnostics.track();this.liveFxDiagnostics.observe(status);return status;
        });
    }
    return this.nativeRequest('native_genesis_fx',{message,
      ...(timing.time===undefined?{}:{frame:this.frameAt(timing.time)}),
      ...(timing.performance===undefined?{}:{performance:timing.performance}),
      ...(timing.owner===undefined?{}:{owner:timing.owner})}).then(status=>{this.liveFxDiagnostics.observe(status);return status;});
  }
  /** Explicit Worker transport receiver. A real MessagePort bridge supplies
   * timing and ownership; the native synth remains independent of AudioNodes. */
  async dispatchNativeCommand(message,timing={}) {
    if(this.nativeOpn)return this.nativeOpn.dispatch(message,timing);
    if(this.primaryMode)throw new Error('OPN/PSG commands require Native Genesis or Mega-CD mode');
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
  async dispatchNativePcmCommand(message,timing={}) {
    if(!this.nativePcm)throw new Error('RF5C164 requires Native Mega-CD mode');
    await this.nativePcm.dispatch(message,timing);
    return message.id===undefined?undefined:{id:message.id};
  }
  async dispatchNativeDx7Command(message,timing={}) {
    if(!this.nativeDx7)throw new Error('DX7 requires Native DX7 mode');
    return this.nativeDx7.dispatch(message,timing);
  }
  async dispatchNativeNesCommand(message,timing={}) {
    if(!this.nativeNes)throw new Error('NES commands require Native NES + FDS mode');
    return this.nativeNes.dispatch(message,timing);
  }
  async dispatchNativePwmCommand(message,timing={}) {
    if(!this.nativePwm)throw new Error('PWM requires Native 32X mode');
    return this.nativePwm.dispatch(message,timing);
  }
  async dispatchNativeConsoleCommand(kind,message,timing={}) {
    if(this.nativeMasterSystem?.[kind])return this.nativeMasterSystem[kind].dispatch(message,timing);
    if(this.nativeX68000?.[kind])return this.nativeX68000[kind].dispatch(message,timing);
    if(!this.nativeConsole||kind!==this.consoleKind)throw new Error(`${kind} requires its Native mode`);
    return this.nativeConsole.dispatch(message,timing);
  }
  async dispatchNativeSnesCommand(message,timing={}) {
    if(!this.nativeSnes)throw new Error('SNES commands require Native SNES mode');
    return this.nativeSnes.dispatch(message,timing);
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
    if (!this.psg || !this.isReady() || this.stopping || this.closing) return;
    if(this.nativeMasterSystem){for(let ch=0;ch<4;ch++)this.psg.setAttenuation(ch,15);return;}
    this.enqueueMany([0x9f,0xbf,0xdf,0xff].map(value => ({type:'psg-write',frame:0,value})));
  }
  resetPsg() {
    if (!this.psg || !this.isReady() || this.stopping || this.closing) return;
    if(this.nativeMasterSystem){this.psg.reset();return;}
    this.psgAuditions.clear();this.psgLevels.fill(6);this.psgLatch=0;
    this.enqueue({type:'psg-reset',frame:0});
  }
  discardPending() {this.acceptedCommands -= this.pending.length;this.acceptedPcmBytes-=this.pending.reduce((sum,command)=>sum+pcmBytes(command),0); this.pending.length = 0;}
  /** Stop is a barrier: old sends settle before the native callback clears its
   * queue and fades/resets. The device clock continues in the same session. */
  stopNativeAudio() {
    if (this.stopping) return this.stopping;
    if (this.session === null) return Promise.resolve();
    void this.outputMonitor.pause().catch(()=>{});
    this.liveFxDiagnostics.reset();
    this.noise.reset();
    // Native Stop resets the rendered rack. Retire its JS descriptors too, so
    // repeated Runs reuse slots and old parameter handles cannot edit a new rack.
    this.fx?.dispose();
    ++this.generation; this.discardPending();
    this.media.stopped();
    this.nativePcm?.stopped();
    this.nativeDx7?.stopped();
    this.nativeNes?.stopped();
    this.nativeConsole?.stopped();this.nativeSnes?.stopped();this.nativePwm?.stopped();this.nativeOpn?.stopped();
    for(const pair of [this.nativeX68000,this.nativeMasterSystem])if(pair)for(const endpoint of Object.values(pair))endpoint.stopped();
    this.workerSampleOrigin=null;
    this.auditions.clear(); this.psgAuditions.clear();
    const session = this.session;
    const pending = this.serial.then(async () => {
      const status = await this.invoke('native_genesis_stop',{session});
      if (session === this.session) {
        this.clock.update(status,this.now());
        if(this.nativeDx7){const snapshot=await this.invoke('native_genesis_dx7_status',{session});if(session===this.session)this.nativeDx7.adoptStopped(snapshot);}
        if(this.nativeNes){const snapshot=await this.invoke('native_genesis_nes_status',{session});if(session===this.session)this.nativeNes.adoptStopped(snapshot);}
        for(const [pair,command]of [[this.nativeX68000,'native_genesis_x68000_status'],[this.nativeMasterSystem,'native_genesis_master_system_status']])if(pair){
          const snapshot=await this.invoke(command,{session});
          if(session===this.session)for(const [kind,endpoint]of Object.entries(pair))endpoint.adoptStopped(snapshot[kind]);
        }
        for(const [adapter,kind]of [[this.nativeConsole,this.consoleKind],[this.nativeSnes,'snes'],[this.nativePwm,'pwm'],[this.nativeOpn,this.opnbMode?'ym2610b':'ym2608']])if(adapter){const snapshot=await this.invoke(`native_genesis_${kind}_status`,{session});if(session===this.session)adapter.adoptStopped(snapshot);}
      }
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
      this.nativePcm?.reset();
      this.nativeDx7?.reset();
      this.nativeNes?.reset();
      this.nativeConsole?.reset();this.nativeSnes?.reset();this.nativePwm?.reset();this.nativeOpn?.reset();
      for(const pair of [this.nativeX68000,this.nativeMasterSystem])if(pair)for(const endpoint of Object.values(pair))endpoint.reset();
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
    if(this.nativeOpn){
      this.nativeOpn.auditionNoteOn(channel,block,fnum,token).catch(error=>this.reportAsyncError(error));
      this.auditions.set(channel,token);return;
    }
    this.auditions.set(channel,token); this.fm.noteOn(channel,block,fnum);
  }
  auditionNoteOff(channel,token) {
    if (this.auditions.get(channel) !== token) return;
    this.auditions.delete(channel);
    if(this.nativeOpn){this.nativeOpn.auditionNoteOff(channel,token).catch(error=>this.reportAsyncError(error));return;}
    this.fm.noteOff(channel);
  }
  clearAuditions() {
    if(this.nativeX68000||this.nativeMasterSystem){
      if(!this.isReady()||this.stopping||this.closing)return;
      for(const endpoint of Object.values(this.nativeX68000??this.nativeMasterSystem))endpoint.invoke('auditionAllOff').catch(error=>{if(error?.name!=='AbortError')this.reportAsyncError(error);});
      return;
    }
    if(this.nativeOpn){
      const held=[...this.auditions];this.auditions.clear();
      if(!this.isReady()||this.stopping||this.closing)return;
      for(const [channel,token]of held)this.nativeOpn.auditionNoteOff(channel,token).catch(error=>this.reportAsyncError(error));
      this.nativeOpn.invoke('auditionAllOff').catch(error=>this.reportAsyncError(error));return;
    }
    for(const adapter of [this.nativeConsole,this.nativeSnes])if(adapter){adapter.invoke('auditionAllOff').catch(error=>{if(error?.name!=='AbortError')this.reportAsyncError(error);});return;}
    if(this.nativeDx7){this.nativeDx7.invoke('auditionAllOff').catch(error=>{if(error?.name!=='AbortError')this.reportAsyncError(error);});return;}
    if(this.nativeNes){this.nativeNes.invoke('auditionAllOff').catch(error=>{if(error?.name!=='AbortError')this.reportAsyncError(error);});return;}
    const channels = [...this.auditions.keys()]; this.auditions.clear();
    if (this.isReady() && !this.stopping && !this.closing) for (const channel of channels) this.fm.noteOff(channel);
    const psgChannels = [...this.psgAuditions.keys()]; this.psgAuditions.clear();
    if (this.isReady() && !this.stopping && !this.closing) for (const channel of psgChannels) this.psg.setAttenuation(channel,15);
  }
  /** Admin operations use the native command transport directly. No MessagePort,
   * AudioNode or PCM bridge is fabricated for the shared Keyboard UI. */
  createInspector() {
    const listeners = new Set(); let disposed = false;
    const list = () => disposed || !this.isReady() ? [] : this.nativeMasterSystem?['segapsg','ym2413'].map(id=>({id,kind:id,name:id,label:`${id==='segapsg'?'Sega PSG':'YM2413'} (Native)`,connected:true,...(id==='ym2413'?{registers:this.opll._getState().registers}:{})})):this.nativeX68000?['ym2151','okim6258'].map(id=>({id,kind:id,name:id,label:`${id.toUpperCase()} (Native)`,connected:true})):this.nativeOpn?[{id:this.chip,kind:this.chip,name:this.chip,label:`${this.chip.toUpperCase()} (Native)`,connected:true}]:this.nativeConsole||this.nativeSnes?[{id:this.chip,kind:this.chip,name:this.chip,label:`${this.chip==='gameboy'?'Game Boy':this.chip==='huc6280'?'HuC6280':'S-DSP'} (Native)`,connected:true}]:this.nesMode?[
      {id:'nes',kind:'nes',name:'nes',label:'NES + FDS (Native)',connected:true},
    ]:this.dx7Mode?[
      {id:'dx7',kind:'dx7',name:'dx7',label:'DX7 (Native)',connected:true},
    ]:[
      {id:'ym2612',kind:'ym2612',name:'ym2612',label:'YM2612 (Native)',connected:true},
      {id:'segapsg',kind:'segapsg',name:'segapsg',label:'Sega PSG (Native)',connected:true},
      ...(this.pwm?[{id:'pwm',kind:'pwm',name:'pwm',label:'32X PWM (Native)',connected:true}]:[]),
      ...(this.pcm?[{id:'rf5c164',kind:'rf5c164',name:'rf5c164',label:'RF5C164 (Native)',connected:true}]:[]),
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
        if(this.nativeMasterSystem?.[id])return this.nativeMasterSystem[id].read();
        if(this.nativeX68000?.[id])return this.nativeX68000[id].read();
        if(this.nativeOpn&&id===this.chip)return this.nativeOpn.read();
        if(id===this.consoleKind)return this.nativeConsole.read();if(id==='snes')return this.nativeSnes.read();
        if(id==='dx7')return this.nativeDx7.read();
        if(id==='nes')return this.nativeNes.read();
        if(id==='pwm')return this.nativePwm.read();
        if(id==='rf5c164')return this.nativePcm.read();
        if (id === 'segapsg') unsupported('Applied PSG voice snapshots');
        return {kind:'ym2612',clock:this.fm.clock,sampleRate:this.clock.sampleRate,
          keyboardChannels:Array.from({length:6},(_,channel)=>({id:`fm:${channel}`,label:`FM ${channel+1}`})),
          held:[...this.auditions.keys()].map(channel=>`fm:${channel}`)};
      },
      invoke: async (id,method,args=[]) => {
        endpoint(id);
        if(this.nativeMasterSystem?.[id])return this.nativeMasterSystem[id].invoke(method,args);
        if(this.nativeX68000?.[id])return this.nativeX68000[id].invoke(method,args);
        if(this.nativeOpn&&id===this.chip)return this.nativeOpn.invoke(method,args);
        if(id===this.consoleKind)return this.nativeConsole.invoke(method,args);if(id==='snes')return this.nativeSnes.invoke(method,args);
        if(id==='dx7')return this.nativeDx7.invoke(method,args);
        if(id==='nes')return this.nativeNes.invoke(method,args);
        if(id==='pwm')return this.nativePwm.invoke(method,args);
        if(id==='rf5c164')return this.nativePcm.invoke(method,args);
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
      loadSample: async (id,source,options) => {endpoint(id);if(id==='okim6258'&&this.nativeX68000)return this.nativeX68000.okim6258.loadSample(source,options);if(id==='rf5c164')return this.nativePcm.loadSample(source,options);if(this.nativeOpn&&id===this.chip)return this.nativeOpn.loadSample(source,options);unsupported('Native sample loading');},
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
        this.dispatchNativeFxCommand(message).catch(error=>this.reportAsyncError(error));
      },getBeatSeconds:()=>this.fxBeatSeconds()});
    }
    return this.fx;
  }
  clearFXChain(options) {return this.fx?.clear(options)??[];}
  getFXChain() {return this.fx?.getChain()??[];}
  setFXChain(effects) {return (this.fx??this.createFXApi()).setChain(effects);}
  syncFXTempo() {if(this.isReady()&&!this.stopping&&!this.closing)this.fx?.syncTempo();}
  allocateNoiseNamespace() {
    if(this.nextNoiseNamespace>=Number.MAX_SAFE_INTEGER)throw new RangeError('Native noise namespace limit reached');
    return ++this.nextNoiseNamespace;
  }
  startOutputRecording(options) {return this.media.startRecording(options);}
  stopOutputRecording() {return this.media.stopRecording();}
  getAudioContext() {return null;}
}

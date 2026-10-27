import {createNativeGenesisExtraPokey,POKEY_TIMELINE_BUSY_ERROR,POKEY_TIMELINE_HELD_ERROR} from './native_genesis_extra_pokey.js?v=pokey-import-1';
import {createNativeGenesisPokeyPrimary} from './native_genesis_pokey.js?v=pokey-import-1';
import {createNativeGenesisExtraSpc,isExtraSpcRejection} from './native_genesis_extra_spc.js?v=pokey-mode-1';
import {createNativeGenesisExtraSnes,EXTRA_SNES_ADMISSION_ERRORS} from './native_genesis_extra_snes.js?v=pokey-mode-1';
import {createNativeGenesisExtraPwm,EXTRA_PWM_ADMISSION_ERRORS} from './native_genesis_extra_pwm.js?v=pokey-mode-1';
import {createNativeGenesisExtraDx7,EXTRA_DX7_VOICE_HELD_ERROR} from './native_genesis_extra_dx7.js?v=pokey-mode-1';
import {createNativeGenesisWonderSwan,WONDERSWAN_CLOCK_HELD_ERROR,WONDERSWAN_CLOCK_PENDING_ERROR,WONDERSWAN_TIMELINE_BUSY_ERROR,WONDERSWAN_TIMELINE_HELD_ERROR} from './native_genesis_wonderswan.js?v=pokey-mode-1';
import {createNativeGenesisExtraWonderSwan} from './native_genesis_extra_wonderswan.js?v=pokey-mode-1';
import {createNativeGenesisExtraHuc6280,EXTRA_HUC6280_CLOCK_HELD_ERROR} from './native_genesis_extra_huc6280.js?v=pokey-mode-1';
import {createNativeGenesisExtraNes,EXTRA_NES_CLOCK_HELD_ERROR,EXTRA_NES_MEMORY_HELD_ERROR,EXTRA_NES_ADMISSION_ERRORS} from './native_genesis_extra_nes.js?v=pokey-mode-1';
import {YM2612Synth} from './ym2612synth.js?v=audio-stability-2';
import {createSegaPsgApi} from './segapsg_api.js?v=audio-numeric-bindings-1';
import {SoundChipMixer, chipMixGains} from './soundchip_mixer.js?v=y8950-adpcm-ui-1';
import {validateChipClock} from './playground_chip_clock.js?v=pokey-mode-1';
import {midiToOpnPitch} from './soundchip_pitch.js';
import {createNativeGenesisMedia} from './native_genesis_media.js';
import {createNativeGenesisFX} from './native_genesis_fx.js';
import {createNativeGenesisMonitor} from './native_genesis_monitor.js';
import {createNativeGenesisNoise,nativeGenesisNoiseMessage} from './native_genesis_noise.js';
import {nativeGenesisLiveFxMessage,createNativeGenesisLiveFxStatus} from './native_genesis_livefx.js';
import {createNativeGenesisExtraGameboy,EXTRA_GAMEBOY_CLOCK_HELD_ERROR} from './native_genesis_extra_gameboy.js?v=pokey-mode-1';
import {createNativeGenesisExtraOkim6258,EXTRA_OKIM6258_CLOCK_HELD_ERROR,EXTRA_OKIM6258_MEMORY_HELD_ERROR} from './native_genesis_extra_okim6258.js?v=pokey-mode-1';
import {createNativeGenesisExtraRf5c164,EXTRA_RF5C164_CLOCK_HELD_ERROR} from './native_genesis_extra_rf5c164.js?v=pokey-mode-1';
import {createNativeGenesisRf5c164} from './native_genesis_rf5c164.js?v=pokey-mode-1';
import {createNativeGenesisDx7} from './native_genesis_dx7.js?v=pokey-mode-1';
import {createNativeGenesisNes} from './native_genesis_nes.js?v=pokey-mode-1';
import {createNativeGenesisConsole} from './native_genesis_console.js?v=pokey-mode-1';
import {createNativeGenesisSnes} from './native_genesis_snes.js?v=y8950-adpcm-ui-1';
import {createNativeGenesisPwm} from './native_genesis_pwm.js?v=pokey-mode-1';
import {createNativeGenesisYm2608} from './native_genesis_ym2608.js?v=pokey-mode-1';
import {createNativeGenesisYm2203} from './native_genesis_ym2203.js?v=pokey-mode-1';
import {createNativeGenesisYm2610B} from './native_genesis_ym2610b.js?v=pokey-mode-1';
import {createNativeGenesisX68000} from './native_genesis_x68000.js?v=pokey-mode-1';
import {createNativeGenesisMasterSystem} from './native_genesis_master_system.js?v=pokey-mode-1';
import {createNativeGenesisGameGear} from './native_genesis_game_gear.js?v=pokey-mode-1';
import {createNativeGenesisMsx} from './native_genesis_msx.js?v=pokey-mode-1';
import {createNativeGenesisMsxAudio} from './native_genesis_msx_audio.js?v=pokey-mode-1';
import {createNativeGenesisOpl} from './native_genesis_opl.js?v=pokey-mode-1';
import {createNativeGenesisExtraSegaPsg,EXTRA_PSG_CLOCK_HELD_ERROR} from './native_genesis_extra_segapsg.js?v=pokey-mode-1';
import {createNativeGenesisExtraYm2612,EXTRA_YM2612_CLOCK_HELD_ERROR} from './native_genesis_extra_ym2612.js?v=pokey-mode-1';
import {createNativeGenesisExtraYm2151,EXTRA_YM2151_CLOCK_HELD_ERROR} from './native_genesis_extra_ym2151.js?v=pokey-mode-1';
import {createNativeGenesisExtraYm2413,EXTRA_YM2413_CLOCK_HELD_ERROR} from './native_genesis_extra_ym2413.js?v=pokey-mode-1';
import {createNativeGenesisExtraAy8910,EXTRA_AY8910_CLOCK_HELD_ERROR} from './native_genesis_extra_ay8910.js?v=pokey-mode-1';
import {createNativeGenesisExtraOpl,EXTRA_OPL_CHIPS,extraOplClockHeldError} from './native_genesis_extra_opl.js?v=pokey-mode-1';
import {createNativeGenesisExtraYm2610,createNativeGenesisExtraYm2610B,EXTRA_YM2610_CLOCK_HELD_ERROR,EXTRA_YM2610B_CLOCK_HELD_ERROR} from './native_genesis_extra_ym2610.js?v=pokey-mode-1';
import {createNativeGenesisExtraYm2608,EXTRA_YM2608_CLOCK_HELD_ERROR,EXTRA_YM2608_TIMELINE_BUSY_ERROR} from './native_genesis_extra_ym2608.js?v=pokey-mode-1';
import {createNativeGenesisExtraYm2203,EXTRA_YM2203_CLOCK_HELD_ERROR,EXTRA_YM2203_SCHEDULE_BUSY_ERROR} from './native_genesis_extra_ym2203.js?v=pokey-mode-1';

const MAX_BATCH = 4096;
const MAX_PENDING = 65536;
const MAX_PCM_UPLOAD_PENDING = 4 * 1024 * 1024;
const NATIVE_MODES = new Set(['pokey','pokey-dual','genesis','mega-cd','32x','genesis-full-nuked','genesis-nuked','dx7','nes','gameboy','snes','wonderswan','pc-engine','huc6280','pc98-26','pc98','neogeo','neogeo-b','x68000','game-gear','master-system','msx','msx-audio','ym3526','ym3812','ymf262']);
const YM2203_HELD_CLOCK_ERROR = 'Release the manually held YM2203 voices before changing the clock';
const OPL_HELD_CLOCK_ERROR = 'Release the manually held OPL voices before changing the clock';
const GAME_GEAR_HELD_CLOCK_ERROR = 'Release the manually held Game Gear voices before changing the clock';
const isReportedFailure = error => error?.name !== 'AbortError' && !['POKEY_CONTROL_REJECTED','WONDERSWAN_CONTROL_REJECTED','OPL_CLOCK_HELD','GAME_GEAR_CLOCK_HELD','YM2203_CLOCK_HELD','EXTRA_PSG_CLOCK_HELD','EXTRA_YM2612_CLOCK_HELD','EXTRA_YM2203_CLOCK_HELD','EXTRA_YM2203_SCHEDULE_BUSY','EXTRA_YM2608_CONTROL_REJECTED','EXTRA_CHIP_MEMORY_LIMIT','EXTRA_YM2610_CONTROL_REJECTED','EXTRA_YM2151_CONTROL_REJECTED','EXTRA_YM2413_CONTROL_REJECTED','EXTRA_AY8910_CONTROL_REJECTED','EXTRA_OPL_CONTROL_REJECTED','EXTRA_RF5C164_CONTROL_REJECTED','EXTRA_OKIM6258_CONTROL_REJECTED','EXTRA_GAMEBOY_CONTROL_REJECTED','EXTRA_NES_CONTROL_REJECTED','EXTRA_HUC6280_CONTROL_REJECTED','EXTRA_DX7_CONTROL_REJECTED','EXTRA_PWM_CONTROL_REJECTED','EXTRA_SNES_CONTROL_REJECTED','EXTRA_SPC_CONTROL_REJECTED'].includes(error?.code);
const pwmBytes=command=>['pwm','extra-pwm'].includes(command.type)&&command.message?.method==='schedule-writes'?command.message.entries.length*24:0;
const snesBytes=command=>command.type==='extra-snes'?command.message?.method==='prepare-timeline'?command.message.ram.length+command.message.dsp.length+command.message.events.length*4:['load-memory-batch','reset-state'].includes(command.message?.method)?command.message.uploads.reduce((sum,upload)=>sum+upload.data.length,0)+(command.message.dsp?.length??0):command.message?.method==='load-memory'?command.message.data.length:0:0;
const wonderswanBytes=command=>['wonderswan','extra-wonderswan'].includes(command.type)&&command.message?.method==='prepare-timeline'?command.message.trace.pcmData.length+command.message.trace.events.length*32:0;
const pokeyBytes=command=>command.type==='extra-pokey'&&command.message?.method==='prepare-timeline'?command.message.trace.data.length:0;
const pcmBytes=command=>pokeyBytes(command)||wonderswanBytes(command)||pwmBytes(command)||snesBytes(command)||(command.type==='extra-spc'&&command.message?.method==='load-spc'?command.message.data.length:0)||(command.type==='extra-ym2608'&&command.message?.method==='prepare-timeline'?command.message.events.length*32+command.message.blocks.reduce((sum,b)=>sum+b.length,0):command.type==='extra-ym2203'&&command.message?.method==='schedule'?command.message.entries.length*24:command.type==='rf5c164-load-memory'?command.data.length:command.type==='extra-nes'&&command.message?.method==='memory'?command.message.data.length:['extra-rf5c164','extra-okim6258'].includes(command.type)&&command.message?.method==='load-memory'?command.message.data.length:['ym2608','ym2610b','extra-ym2608','extra-ym2610','extra-ym2610b'].includes(command.type)&&['memory','rom'].includes(command.message?.method)?command.message.data.length:['nes','snes'].includes(command.type)&&command.message?.method==='load-memory'?command.message.data.length:command.type==='x68000'&&command.message?.method==='memory-chunk'?command.message.data.length:command.type==='snes'&&command.message?.method==='prepare-timeline'?command.message.ram.length+command.message.dsp.length+command.message.events.length*4:0);
const maxUpload=command=>pokeyBytes(command)?8*1024*1024:wonderswanBytes(command)?8*1024*1024:command.type==='extra-okim6258'?16*1024*1024:['extra-ym2610','extra-ym2610b'].includes(command.type)?32*1024*1024:command.type==='extra-ym2608'?command.message?.method==='prepare-timeline'?8*1024*1024:2*1024*1024:['pwm','extra-pwm'].includes(command.type)?32*1024*1024:command.type==='extra-ym2203'&&command.message?.method==='schedule'?4*1024*1024:command.type==='x68000'&&command.message?.method==='memory-chunk'?command.message.data.length:['snes','extra-snes'].includes(command.type)&&command.message?.method==='prepare-timeline'?16*1024*1024+65664:command.type==='extra-snes'?65664:command.type==='extra-spc'?16*1024*1024:65536;
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
   * clock?:number,wonderswanClock?:number, mode?:'genesis'|'mega-cd'|'dx7'|'nes'|'gameboy'|'snes'|'wonderswan'|'pc-engine'|'pc98'|'pc98-26'|'ym2203'|'ym2608'|'neogeo'|'neogeo-b'|'ym2610'|'ym2610b'|'x68000'|'master-system'|'game-gear'|'msx'|'msx-audio'|'ym3526'|'ym3812'|'ymf262'|'genesis-full'|'32x'|'genesis-full-nuked'|'genesis-nuked'}} [options] */
  constructor({invoke, now = () => performance.now(), onError = () => {}, mixer = new SoundChipMixer(), masterVolume = 1, decodeAudio,fetcher,megaCD=false,dx7=false,mode,clock,wonderswanClock} = {}) {
    if (typeof invoke !== 'function') throw new TypeError('Native Genesis requires the Tauri invoke transport');
    if(mode==='genesis-full')mode='32x';
    if(mode==='ym2608')mode='pc98';
    if(mode==='ym2203')mode='pc98-26';
    if(mode==='ym2610')mode='neogeo';
    if(mode==='ym2610b')mode='neogeo-b';
    if(mode!=null&&!NATIVE_MODES.has(mode))throw new RangeError(`Unsupported Native mode: ${mode}`);
    this.invoke = invoke; this.now = now; this.onError = onError;
    this.pokeyMode=['pokey','pokey-dual'].includes(mode);this.dualPokey=mode==='pokey-dual';
    this.wonderswanMode=mode==='wonderswan';this.wonderswanClock=validateChipClock(clock??wonderswanClock??3072000);
    this.backend = 'native-genesis';this.consoleKind=mode==='gameboy'?'gameboy':mode==='pc-engine'||mode==='huc6280'?'huc6280':null;this.snesMode=mode==='snes';
    this.gameGearMode=mode==='game-gear';this.oplMode=['ym3526','ym3812','ymf262'].includes(mode);this.msxMode=mode==='msx';this.msxAudioMode=mode==='msx-audio';this.masterSystemMode=mode==='master-system';this.x68000Mode=mode==='x68000';this.ym2203Mode=mode==='pc98-26';this.opnaMode=mode==='pc98';this.opnbMode=['neogeo','neogeo-b'].includes(mode);this.nesMode=mode==='nes';this.dx7Mode=!this.pokeyMode&&!this.wonderswanMode&&!this.consoleKind&&!this.snesMode&&!this.nesMode&&!this.ym2203Mode&&!this.opnaMode&&!this.opnbMode&&!this.x68000Mode&&!this.masterSystemMode&&!this.gameGearMode&&!this.msxMode&&!this.msxAudioMode&&!this.oplMode&&(dx7===true||mode==='dx7');this.primaryMode=this.pokeyMode||this.wonderswanMode||!!this.consoleKind||this.snesMode||this.nesMode||this.dx7Mode||this.ym2203Mode||this.opnaMode||this.opnbMode||this.x68000Mode||this.masterSystemMode||this.gameGearMode||this.msxMode||this.msxAudioMode||this.oplMode;
    this.chip = this.pokeyMode?'pokey':this.wonderswanMode?'wonderswan':this.oplMode?mode:this.consoleKind??(this.msxAudioMode?'msx-audio':this.msxMode?'msx':this.masterSystemMode||this.gameGearMode?'segapsg':this.x68000Mode?'x68000':this.ym2203Mode?'ym2203':this.opnaMode?'ym2608':this.opnbMode?(mode==='neogeo-b'?'ym2610b':'ym2610'):this.snesMode?'snes':this.nesMode?'nes':this.dx7Mode?'dx7':'ym2612');this.mode=this.pokeyMode?mode:this.gameGearMode?'game-gear':this.masterSystemMode?'master-system':this.opnbMode?mode:this.ym2203Mode?'pc98-26':this.opnaMode?'pc98':this.chip==='huc6280'?'pc-engine':this.chip==='ym2612'?mode??(megaCD?'mega-cd':'genesis'):this.chip;this.nukedMode=!this.primaryMode&&['genesis-full-nuked','genesis-nuked'].includes(mode);this.engine=this.chip==='ym2612'?(this.nukedMode?'nuked':'ymfm'):undefined;this.pwmMode=!this.primaryMode&&['32x','genesis-full-nuked'].includes(mode);this.megaCD=!this.primaryMode&&(megaCD===true||mode==='mega-cd'||this.pwmMode);
    this.capabilities = Object.freeze({chip:this.chip, fmChannels:this.ym2203Mode?3:this.opnbMode?(mode==='neogeo-b'?6:4):this.opnaMode?6:this.primaryMode?0:6, psg:!this.primaryMode||this.masterSystemMode||this.gameGearMode, dac:!this.primaryMode,
      pcm:this.megaCD,pwm:this.pwmMode, recorder:true, worker:true, noise:true, dynamicSoundChips:false, dynamicSoundChipKinds:Object.freeze(['segapsg','ym2612','ym2203','ym2608','ym2610','ym2610b','ym2151','ym2413','ay8910','ym3526','ym3812','y8950','ymf262','rf5c164','okim6258','gameboy','nes','huc6280','wonderswan','pokey','dx7','pwm','snes','spc']), backend:'native-genesis',...(this.engine?{engine:this.engine}:{})});
    this.clock = new NativeAudioClock(now);
    this.outputMonitor = createNativeGenesisMonitor({invoke:(command,args)=>this.invoke(command,args),
      getSession:()=>this.session,getSampleRate:()=>this.clock.sampleRate,
      isReady:()=>this.isReady() && !this.stopping && !this.closing && this.clock.state === 'running'});
    this.audioContext = null; this.node = null; this.audio = null;
    this.state = 'idle'; this.session = null; this.generation = 0;
    this.pending = []; this.acceptedCommands = 0;this.acceptedPcmBytes=0; this.acceptedRequests = 0; this.serial = Promise.resolve(); this.flushQueued = false;
    this.starting = null; this.stopping = null; this.closing = null; this.error = null;this.workerSampleOrigin=null;
    this.listeners = new Set(); this.mixer = mixer; this.mixerReleases = [];
    this.extraDevices = new Map(); this.extraPokeyDevices=new Map(); this.extraWonderSwanDevices = new Map(); this.extraSpcDevices = new Map(); this.extraSnesDevices = new Map(); this.extraPwmDevices = new Map(); this.extraDx7Devices = new Map(); this.extraHuc6280Devices = new Map(); this.extraNesDevices = new Map(); this.extraGameboyDevices = new Map(); this.extraOkim6258Devices = new Map(); this.extraRf5c164Devices = new Map(); this.extraPsgDevices = new Map(); this.extraYm2612Devices = new Map(); this.extraYm2203Devices = new Map(); this.extraYm2608Devices = new Map(); this.extraYm2610Devices = new Map(); this.extraYm2610BDevices = new Map(); this.extraYm2151Devices = new Map(); this.extraYm2413Devices = new Map(); this.extraAy8910Devices = new Map(); this.extraOplDevices = new Map(); this.nextExtraChipInstance = 0;
    this.extraRf5c164Options={decodeAudio,fetcher:fetcher??globalThis.fetch?.bind(globalThis)};
    this.liveFxDiagnostics=createNativeGenesisLiveFxStatus({invoke:(command,args)=>this.invoke(command,args),
      getSession:()=>this.session,getGeneration:()=>this.generation,isReady:()=>this.isReady()&&!this.stopping&&!this.closing,
      onChange:status=>this.emit({type:'live-fx-status',status,sampleRate:this.clock.sampleRate}),
      onError:message=>this.emit({type:'live-fx-error',message})});
    this.masterVolume = this.validateVolume(masterVolume); this.listeningVolume = 1;
    this.auditions = new Map(); this.psgAuditions = new Map(); this.psgLevels = new Uint8Array(4).fill(6); this.psgLatch = 0;
    this.mix = {fmLeft:1,fmRight:1,psgLeft:1,psgRight:1,master:this.masterVolume,...(mixer.gainUnits === 'source' ? {gainUnits:'source'} : {})};
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
    this.nativeYm2203=this.ym2203Mode?createNativeGenesisYm2203(this):null;
    this.nativeOpn=this.nativeYm2203??this.nativeOpna??this.nativeOpnb;
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
    this.nativeWonderSwan=this.wonderswanMode?createNativeGenesisWonderSwan(this,{clock:this.wonderswanClock}):null;
    this.ws=this.wonderswan=this.nativeWonderSwan?.client??null;
    this.primaryPokey=this.pokeyMode?Array.from({length:this.dualPokey?2:1},(_,index)=>createNativeGenesisPokeyPrimary(this,{id:index?'pokey:2':'pokey',globalName:index?'pokey2':'pokey',clock:clock??(this.dualPokey?1789773:1789790)})):[];
    this.pokey=this.primaryPokey[0]?.client??null;this.pokey2=this.primaryPokey[1]?.client??null;
    this.nativeConsole=this.consoleKind?createNativeGenesisConsole(this,this.consoleKind):null;
    this.gameboy=this.consoleKind==='gameboy'?this.nativeConsole.client:null;this.huc6280=this.consoleKind==='huc6280'?this.nativeConsole.client:null;this.pce=this.huc6280;
    this.nativeSnes=this.snesMode?createNativeGenesisSnes(this):null;this.snes=this.nativeSnes?.client??null;
    this.nativePwm=this.pwmMode?createNativeGenesisPwm(this):null;this.pwm=this.nativePwm?.client??null;
    this.nativeX68000=this.x68000Mode?createNativeGenesisX68000(this,{decodeAudio,fetcher}):null;
    this.opm=this.ym2151=this.nativeX68000?.ym2151.client??null;
    this.adpcm=this.okim6258=this.nativeX68000?.okim6258.client??null;
    this.nativeMasterSystem=this.masterSystemMode?createNativeGenesisMasterSystem(this):null;
    this.nativeGameGear=this.gameGearMode?createNativeGenesisGameGear(this):null;
    this.segapsg=this.nativeMasterSystem?.segapsg.client??this.nativeGameGear?.segapsg.client??null;
    if(this.segapsg)this.psg=this.segapsg;
    this.nativeMsx=this.msxMode?createNativeGenesisMsx(this):null;
    this.nativeMsxAudio=this.msxAudioMode?createNativeGenesisMsxAudio(this):null;
    this.opll=this.ym2413=this.nativeMasterSystem?.ym2413.client??this.nativeMsx?.ym2413.client??this.nativeMsxAudio?.ym2413.client??null;
    this.ay=this.ay8910=this.nativeMsx?.ay8910.client??this.nativeMsxAudio?.ay8910.client??null;
    this.nativeOpl=this.oplMode?createNativeGenesisOpl(this,{chip:this.chip}):null;
    this.opl=this.nativeOpl?.client??this.nativeMsxAudio?.y8950.client??null;
    this.y8950=this.nativeMsxAudio?.y8950.client??null;
    for(const kind of ['ym3526','ym3812','ymf262'])this[kind]=this.chip===kind?this.opl:null;
    this.nativeVoiceChips=this.nativeMsxAudio??this.nativeGameGear??this.nativeMsx??this.nativeMasterSystem??this.nativeX68000??(this.nativeOpl?{[this.chip]:this.nativeOpl}:null);
    this.primaryEndpoints=this.pokeyMode?this.primaryPokey.map(endpoint=>({id:endpoint.id,name:'pokey',globalName:endpoint.globalName,client:endpoint.client})):this.nativeWonderSwan?[{name:'wonderswan',globalName:'ws',client:this.ws}]:this.nativeMsxAudio?[{name:'y8950',globalName:'opl',client:this.opl},{name:'ym2413',globalName:'opll',client:this.opll},{name:'ay8910',globalName:'ay',client:this.ay}]:this.nativeGameGear?[{name:'segapsg',globalName:'psg',client:this.psg}]:this.nativeOpl?[{name:this.chip,globalName:'opl',client:this.opl}]:this.nativeMsx?[{name:'ym2413',globalName:'opll',client:this.opll},{name:'ay8910',globalName:'ay',client:this.ay}]:this.nativeMasterSystem?[{name:'segapsg',globalName:'psg',client:this.psg},{name:'ym2413',globalName:'opll',client:this.opll}]:this.nativeX68000?[{name:'ym2151',globalName:'opm',client:this.opm},{name:'okim6258',globalName:'adpcm',client:this.adpcm}]:this.pwm?[{name:'pwm',globalName:'pwm',client:this.pwm}]:this.nativeConsole?[{name:this.consoleKind,globalName:this.gameboy?'gameboy':'pce',client:this.nativeConsole.client}]:this.snes?[{name:'snes',globalName:'snes',client:this.snes}]:this.nes?[{name:'nes',globalName:'nes',client:this.nes}]:this.dx7?[{name:'dx7',globalName:'dx7',client:this.dx7}]:[];
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
  createExtraSegaPsg(options) { return createNativeGenesisExtraSegaPsg(this,options); }
  createExtraSpc(options) { return createNativeGenesisExtraSpc(this,options); }
  createExtraSnes(options) { return createNativeGenesisExtraSnes(this,options); }
  createExtraPwm(options) { return createNativeGenesisExtraPwm(this,options); }
  createExtraDx7(options) { return createNativeGenesisExtraDx7(this,options); }
  createExtraPokey(options){return createNativeGenesisExtraPokey(this,options);}
  createExtraWonderSwan(options) { return createNativeGenesisExtraWonderSwan(this,options); }
  createExtraHuc6280(options) { return createNativeGenesisExtraHuc6280(this,options); }
  createExtraNes(options) { return createNativeGenesisExtraNes(this,options); }
  createExtraGameboy(options) { return createNativeGenesisExtraGameboy(this,options); }
  createExtraOkim6258(options) { return createNativeGenesisExtraOkim6258(this,{...this.extraRf5c164Options,...options}); }
  createExtraRf5c164(options) { return createNativeGenesisExtraRf5c164(this,{...this.extraRf5c164Options,...options}); }
  createExtraYm2612(options) { return createNativeGenesisExtraYm2612(this,options); }
  createExtraOpl(kind,options) { return createNativeGenesisExtraOpl(this,{...options,kind}); }
  createExtraYm2413(options) { return createNativeGenesisExtraYm2413(this,options); }
  createExtraAy8910(options) { return createNativeGenesisExtraAy8910(this,options); }
  createExtraYm2151(options) { return createNativeGenesisExtraYm2151(this,options); }
  createExtraYm2610(options) { return createNativeGenesisExtraYm2610(this,options); }
  createExtraYm2610B(options) { return createNativeGenesisExtraYm2610B(this,options); }
  createExtraYm2608(options) { return createNativeGenesisExtraYm2608(this,options); }
  createExtraYm2203(options) { return createNativeGenesisExtraYm2203(this,options); }
  validateGenesisStatus(status) {
    if(this.chip!=='ym2612')return;
    if(this.nukedMode&&(status.mode!==this.mode||status.engine!=='nuked')||status.engine!==undefined&&status.engine!==this.engine)throw new Error(`Native ${this.mode} returned an incompatible sound engine`);
  }
  addListener(listener) {this.listeners.add(listener); return () => this.listeners.delete(listener);}
  emit(event) {for (const listener of this.listeners) {try {listener(event);} catch (error) {console.error(error);}}if(this.nativeVoiceChips&&event.type==='native-state')this.chipInspector?.notify();}
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
        status = await this.invoke('native_genesis_start',...(this.wonderswanMode?[{mode:this.mode,clock:this.wonderswanClock}]:this.pokeyMode||this.consoleKind||this.snesMode||this.pwmMode||this.nukedMode||this.ym2203Mode||this.opnaMode||this.opnbMode||this.x68000Mode||this.masterSystemMode||this.gameGearMode||this.msxMode||this.msxAudioMode||this.oplMode?[{mode:this.mode}]:this.nesMode?[{mode:'nes'}]:this.dx7Mode?[{mode:'dx7'}]:this.megaCD?[{mode:'mega-cd'}]:[]));
        if (generation !== this.generation) {
          if (status?.session != null) await this.invoke('native_genesis_shutdown',{session:status.session});
          throw new DOMException('Native audio initialization was cancelled','AbortError');
        }
        if (!Number.isSafeInteger(status?.session) || status.session < 1) throw new Error('Native Genesis returned an invalid session');
        this.session = status.session;this.validateGenesisStatus(status);this.clock.update(status,this.now(),true);
        this.liveFxDiagnostics.observe(status);
        if(this.fm&&!this.nativeOpn)this.fm.clock = status.ymClock ?? 7670454;
        if(this.pcm)this.pcm._adoptClock(status.rf5c164Clock??12500000);
        this.state = 'ready';
        for(const endpoint of this.primaryPokey){await endpoint.initialize();this.mixerReleases.push(this.mixer.register(endpoint.id,'pokey',settings=>{if(this.isReady()&&!this.stopping&&!this.closing)endpoint.mix(settings.effectiveMuted?0:settings.volume,settings.pan).catch(error=>this.reportAsyncError(error));}));}
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
        for(const adapter of [this.nativeWonderSwan,this.nativeConsole,this.nativeSnes,this.nativePwm,this.nativeOpn])if(adapter){const id=adapter===this.nativePwm?'pwm':this.chip;this.mixerReleases.push(this.mixer.register(id,id,settings=>{
          if(this.isReady()&&!this.stopping&&!this.closing)adapter.mix(settings.effectiveMuted?0:settings.volume,settings.pan).catch(error=>this.reportAsyncError(error));
        }));if(adapter===this.nativeWonderSwan)await adapter.initialize();else if(adapter!==this.nativeOpn)adapter.initialize?.();}
        if(this.nativeVoiceChips)for(const [id,endpoint]of Object.entries(this.nativeVoiceChips)){
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
    this.validateGenesisStatus(status);
    this.liveFxDiagnostics.observe(status);
    this.clock.update(status,(before + this.now()) / 2);
  }
  /** Observe an existing session without reanchoring its clock or sending audio commands. */
  async readAudioDiagnostics() {
    if(!this.isReady()||this.stopping||this.closing)throw new Error('Native audio is not ready for diagnostics');
    const session=this.session,generation=this.generation;
    // A UI timeout cannot cancel invoke(). Share one outstanding read even
    // across Stop/Run in the same session, so a stalled IPC cannot accumulate.
    let reading=this.diagnosticsReading;
    if(!reading||reading.session!==session){
      reading={session,generation,promise:Promise.resolve().then(()=>this.invoke('native_genesis_status',{session}))};
      this.diagnosticsReading=reading;
      const clear=()=>{if(this.diagnosticsReading===reading)this.diagnosticsReading=null;};
      reading.promise.then(clear,clear);
    }
    const status=await reading.promise;
    if(session!==this.session||generation!==this.generation||reading.generation!==generation||this.stopping||this.closing)throw new DOMException('Native diagnostic session was replaced','AbortError');
    if(status?.session!==session||!Number.isSafeInteger(status.frame)||status.frame<0||status.sampleRate!==this.clock.sampleRate)throw new Error('Native audio returned an invalid diagnostic snapshot');
    this.validateGenesisStatus(status);
    const count=value=>Number.isSafeInteger(value)&&value>=0?value:null;
    return {backend:this.backend,session,mode:this.mode,...(this.engine?{engine:this.engine}:{}),
      sampleRate:status.sampleRate,frame:status.frame,running:status.running!==false,
      queued:count(status.queued),lateCommands:count(status.lateCommands),queueOverflows:count(status.queueOverflows),
      transport:{pendingCommands:this.pending.length,acceptedCommands:this.acceptedCommands,acceptedRequests:this.acceptedRequests},
      liveFx:status.liveFx?{active:count(status.liveFx.active),processCalls:count(status.liveFx.processCalls),
        underruns:count(status.liveFx.underruns),overruns:count(status.liveFx.overruns),latencyFrames:count(status.liveFx.latencyFrames)}:null};
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
    if(bytes&&this.acceptedPcmBytes+bytes>(commands.some(command=>command.message?.method==='prepare-timeline'||['pwm','extra-pwm'].includes(command.type)||['extra-ym2610','extra-ym2610b'].includes(command.type)||command.type==='extra-okim6258')?32*1024*1024:MAX_PCM_UPLOAD_PENDING))throw new RangeError('Native PCM upload queue is full');
    this.acceptedCommands += commands.length;
    this.acceptedPcmBytes+=bytes;
    this.pending.push(...commands);
    if (!this.flushQueued) {
      this.flushQueued = true;
      queueMicrotask(() => {this.flushQueued = false; this.flush().catch(error => {
        if (error?.code === 'EXTRA_CHIP_MEMORY_LIMIT') {
          // Void register writes have no awaiting caller: surface admission
          // failure once without turning a bounded rejection into a shutdown.
          try {this.onError(error);} catch (callbackError) {console.error(callbackError);}
        } else if (isReportedFailure(error)) this.fail(error);
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
        const batch=commands.slice(offset,end);
        try {await this.invoke('native_genesis_commands',{session,commands:batch});}
        catch(error) {
          // Aggregate admission is atomic across chip kinds and primary writes.
          // A rejected additional-chip reservation must leave the engine usable.
          const message=error?.message??String(error);
          if(batch.some(command=>['extra-psg','extra-ym2612','extra-ym2203','extra-ym2608','extra-ym2610','extra-ym2610b','extra-ym2151','extra-ym2413','extra-ay8910','extra-ym3526','extra-ym3812','extra-y8950','extra-ymf262','extra-rf5c164','extra-okim6258','extra-gameboy','extra-nes','extra-huc6280','extra-pokey','extra-wonderswan','extra-dx7','extra-pwm','extra-snes','extra-spc'].includes(command.type)) &&
              ['Additional Native sound-chip memory budget (64 MiB) exceeded','Additional Native sound-chip memory budget exceeded (67108864 bytes)'].includes(message)) {
            const rejected=new Error(message);rejected.code='EXTRA_CHIP_MEMORY_LIMIT';throw rejected;
          }
          // A held manual voice rejects an isolated clock edit atomically. The
          // caller keeps that rejection, while the running audio remains usable.
          if((this.oplMode||this.msxAudioMode) && batch.every(command=>command.type==='opl'&&command.message?.method==='clock'&&(!this.msxAudioMode||command.message.chip==='y8950')) &&
              (error?.message??String(error))===OPL_HELD_CLOCK_ERROR) {
            const rejected=new Error(OPL_HELD_CLOCK_ERROR);rejected.code='OPL_CLOCK_HELD';throw rejected;
          }
          if(this.ym2203Mode && batch.every(command=>command.type==='ym2203'&&command.message?.method==='clock') &&
              (error?.message??String(error))===YM2203_HELD_CLOCK_ERROR) {
            const rejected=new Error(YM2203_HELD_CLOCK_ERROR);rejected.code='YM2203_CLOCK_HELD';throw rejected;
          }
          if(this.gameGearMode && batch.every(command=>command.type==='master-system'&&command.message?.chip==='segapsg'&&command.message?.method==='clock') &&
              (error?.message??String(error))===GAME_GEAR_HELD_CLOCK_ERROR) {
            const rejected=new Error(GAME_GEAR_HELD_CLOCK_ERROR);rejected.code='GAME_GEAR_CLOCK_HELD';throw rejected;
          }
          if(batch.every(command=>command.type==='extra-psg'&&command.message?.method==='clock') &&
              (error?.message??String(error))===EXTRA_PSG_CLOCK_HELD_ERROR) {
            const rejected=new Error(EXTRA_PSG_CLOCK_HELD_ERROR);rejected.code='EXTRA_PSG_CLOCK_HELD';throw rejected;
          }
          if(batch.every(command=>command.type==='extra-ym2612'&&command.message?.method==='clock') &&
              (error?.message??String(error))===EXTRA_YM2612_CLOCK_HELD_ERROR) {
            const rejected=new Error(EXTRA_YM2612_CLOCK_HELD_ERROR);rejected.code='EXTRA_YM2612_CLOCK_HELD';throw rejected;
          }
          if(batch.some(command=>command.type==='extra-spc')&&isExtraSpcRejection(message)){const rejected=new Error(message);rejected.code='EXTRA_SPC_CONTROL_REJECTED';throw rejected;}
          if(batch.some(command=>command.type==='extra-snes')&&EXTRA_SNES_ADMISSION_ERRORS.includes(message)){const rejected=new Error(message);rejected.code='EXTRA_SNES_CONTROL_REJECTED';throw rejected;}
          if(batch.some(command=>command.type==='extra-pwm')&&EXTRA_PWM_ADMISSION_ERRORS.includes(message)){const rejected=new Error(message);rejected.code='EXTRA_PWM_CONTROL_REJECTED';throw rejected;}
          if(batch.some(command=>command.type==='extra-dx7')&&message===EXTRA_DX7_VOICE_HELD_ERROR){const rejected=new Error(message);rejected.code='EXTRA_DX7_CONTROL_REJECTED';throw rejected;}
          if(batch.some(command=>['wonderswan','extra-wonderswan'].includes(command.type)&&command.message?.method==='clock')&&message===WONDERSWAN_CLOCK_HELD_ERROR){const rejected=new Error(message);rejected.code='WONDERSWAN_CONTROL_REJECTED';throw rejected;}
          if(batch.some(command=>['wonderswan','extra-wonderswan'].includes(command.type)&&command.message?.method==='batch')&&message===WONDERSWAN_CLOCK_PENDING_ERROR){const rejected=new Error(message);rejected.code='WONDERSWAN_CONTROL_REJECTED';throw rejected;}
          if(batch.some(command=>command.type==='extra-pokey')&&[POKEY_TIMELINE_BUSY_ERROR,POKEY_TIMELINE_HELD_ERROR,'Native POKEY timeline preparation queue is full','Native POKEY pending command limit reached (8 MiB)','Native POKEY timeline exceeds 512 writes in 128 output frames','Native POKEY timeline startFrame is in the past','Native POKEY timeline start frame is invalid or late'].includes(message)){const rejected=new Error(message);rejected.code='POKEY_CONTROL_REJECTED';throw rejected;}
          if(batch.some(command=>['wonderswan','extra-wonderswan'].includes(command.type))&&[WONDERSWAN_TIMELINE_BUSY_ERROR,WONDERSWAN_TIMELINE_HELD_ERROR,'Native WonderSwan timeline preparation queue is full (256)','Native WonderSwan pending command limit reached (8 MiB)','Native WonderSwan timeline exceeds 512 writes in 128 output frames'].includes(message)){const rejected=new Error(message);rejected.code='WONDERSWAN_CONTROL_REJECTED';throw rejected;}
          if(batch.some(command=>command.type==='extra-huc6280'&&command.message?.method==='clock')&&message===EXTRA_HUC6280_CLOCK_HELD_ERROR){const rejected=new Error(message);rejected.code='EXTRA_HUC6280_CONTROL_REJECTED';throw rejected;}
          if(batch.some(command=>command.type==='extra-nes')&&(EXTRA_NES_ADMISSION_ERRORS.includes(message)||[EXTRA_NES_CLOCK_HELD_ERROR,EXTRA_NES_MEMORY_HELD_ERROR].includes(message))){const rejected=new Error(message);rejected.code='EXTRA_NES_CONTROL_REJECTED';throw rejected;}
          if(batch.every(command=>command.type==='extra-gameboy'&&command.message?.method==='clock')&&message===EXTRA_GAMEBOY_CLOCK_HELD_ERROR){const rejected=new Error(message);rejected.code='EXTRA_GAMEBOY_CONTROL_REJECTED';throw rejected;}
          if(batch.every(command=>command.type==='extra-okim6258')&&[EXTRA_OKIM6258_MEMORY_HELD_ERROR,EXTRA_OKIM6258_CLOCK_HELD_ERROR].includes(message)){const rejected=new Error(message);rejected.code='EXTRA_OKIM6258_CONTROL_REJECTED';throw rejected;}
          if(batch.every(command=>command.type==='extra-rf5c164'&&command.message?.method==='clock')&&message===EXTRA_RF5C164_CLOCK_HELD_ERROR){const rejected=new Error(message);rejected.code='EXTRA_RF5C164_CONTROL_REJECTED';throw rejected;}
          for(const kind of EXTRA_OPL_CHIPS)if(batch.every(command=>command.type===`extra-${kind}`&&command.message?.method==='clock')&&message===extraOplClockHeldError(kind)){const rejected=new Error(message);rejected.code='EXTRA_OPL_CONTROL_REJECTED';throw rejected;}
          for(const [kind,heldError]of [['ym2413',EXTRA_YM2413_CLOCK_HELD_ERROR],['ay8910',EXTRA_AY8910_CLOCK_HELD_ERROR]])if(batch.every(command=>command.type===`extra-${kind}`&&command.message?.method==='clock')&&message===heldError){const rejected=new Error(message);rejected.code=`EXTRA_${kind.toUpperCase()}_CONTROL_REJECTED`;throw rejected;}
          if(batch.every(command=>command.type==='extra-ym2151'&&command.message?.method==='clock') && message===EXTRA_YM2151_CLOCK_HELD_ERROR) {
            const rejected=new Error(message);rejected.code='EXTRA_YM2151_CONTROL_REJECTED';throw rejected;
          }
          if(batch.every(command=>['extra-ym2610','extra-ym2610b'].includes(command.type)&&command.message?.method==='clock') && [EXTRA_YM2610_CLOCK_HELD_ERROR,EXTRA_YM2610B_CLOCK_HELD_ERROR].includes(message)) {
            const rejected=new Error(message);rejected.code='EXTRA_YM2610_CONTROL_REJECTED';throw rejected;
          }
          if(batch.every(command=>command.type==='extra-ym2608') && [EXTRA_YM2608_CLOCK_HELD_ERROR,EXTRA_YM2608_TIMELINE_BUSY_ERROR,'Native YM2608 timeline preparation already pending'].includes(error?.message??String(error))) {
            const rejected=new Error(error.message);rejected.code='EXTRA_YM2608_CONTROL_REJECTED';throw rejected;
          }
          if(batch.every(command=>command.type==='extra-ym2203'&&command.message?.method==='clock') &&
              (error?.message??String(error))===EXTRA_YM2203_CLOCK_HELD_ERROR) {
            const rejected=new Error(EXTRA_YM2203_CLOCK_HELD_ERROR);rejected.code='EXTRA_YM2203_CLOCK_HELD';throw rejected;
          }
          if(batch.every(command=>command.type==='extra-ym2203'&&command.message?.method==='schedule') &&
              (error?.message??String(error))===EXTRA_YM2203_SCHEDULE_BUSY_ERROR) {
            const rejected=new Error(EXTRA_YM2203_SCHEDULE_BUSY_ERROR);rejected.code='EXTRA_YM2203_SCHEDULE_BUSY';throw rejected;
          }
          throw error;
        }
        offset=end;
      }
    }).finally(()=>{this.acceptedCommands -= commands.length;this.acceptedPcmBytes-=bytes;});
    // Keep the serialization chain usable after cancellation/failure. The
    // caller's promise retains the rejection; automatic sends report it once.
    this.serial = pending.catch(()=>{});
    pending.catch(error=>{if (isReportedFailure(error) && generation === this.generation) this.fail(error);});
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
  // Completion observers follow an already admitted command. Keep their
  // read-only wait outside the control FIFO so Stop can cancel that command.
  observeNativeSnapshot(command,args={}) {
    const primary=command==='native_genesis_wonderswan_status',pcm=['native_genesis_wonderswan_status','native_genesis_extra_wonderswan_status','native_genesis_extra_rf5c164_status','native_genesis_extra_okim6258_status','native_genesis_extra_gameboy_status','native_genesis_extra_nes_status','native_genesis_extra_huc6280_status','native_genesis_extra_pokey_status','native_genesis_extra_dx7_status','native_genesis_extra_pwm_status','native_genesis_extra_snes_status','native_genesis_extra_spc_status'].includes(command),after=pcm?'after':'afterLayoutRevision';
    if(!pcm&&!/^native_genesis_extra_(ym2413|ym3526|ym3812|y8950|ymf262)_status$/.test(command))return Promise.reject(new Error('Unsupported Native completion observer'));
    if(!args||typeof args!=='object'||Array.isArray(args)||Object.keys(args).some(key=>!['instance',after,...(command==='native_genesis_extra_snes_status'?['ram']:[])].includes(key))||!primary&&(!Number.isSafeInteger(args.instance)||args.instance<1)||!Number.isSafeInteger(args[after])||args[after]<(pcm?1:0))return Promise.reject(new TypeError(`Invalid Native ${pcm?'PCM':'layout'} completion observer`));
    if(!this.isReady()||this.stopping||this.closing)return Promise.reject(new DOMException('Native audio is stopping','AbortError'));
    if(this.acceptedRequests>=256)return Promise.reject(new RangeError('Native preparation request queue is full'));
    this.acceptedRequests++;const session=this.session,generation=this.generation;
    return Promise.resolve().then(()=>this.invoke(command,{...args,session})).then(result=>{if(session!==this.session||generation!==this.generation||!this.isReady()||this.stopping||this.closing)throw new DOMException('Native audio commands were cancelled','AbortError');return result;}).finally(()=>{this.acceptedRequests--;});
  }
  nativeSpcRequest(command,args={}) {
    if(!['native_genesis_extra_spc_events','native_genesis_extra_spc_seek_step'].includes(command))return Promise.reject(new Error('Unsupported Native SPC request'));
    if(!args||typeof args!=='object'||Array.isArray(args)||!Number.isSafeInteger(args.instance)||args.instance<1)return Promise.reject(new TypeError('Invalid Native SPC request'));
    if(!this.isReady()||this.stopping||this.closing)return Promise.reject(new DOMException('Native audio is stopping','AbortError'));
    if(this.acceptedRequests>=256)return Promise.reject(new RangeError('Native preparation request queue is full'));
    this.acceptedRequests++;const session=this.session,generation=this.generation;
    // Observations and private seek preparation never occupy the command FIFO.
    // Its Stop/dispose commands can retire the instance while these await IPC.
    return Promise.resolve().then(()=>this.invoke(command,{...args,session})).then(result=>{if(session!==this.session||generation!==this.generation||!this.isReady()||this.stopping||this.closing)throw new DOMException('Native SPC operation was cancelled','AbortError');return result;}).finally(()=>{this.acceptedRequests--;});
  }
  reportAsyncError(error) {if(isReportedFailure(error)) this.fail(error);}
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
    if(kind==='wonderswan'&&this.nativeWonderSwan)return this.nativeWonderSwan.dispatch(message,timing);
    if(this.nativeVoiceChips?.[kind])return this.nativeVoiceChips[kind].dispatch(message,timing);
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
    for (const device of [...this.extraDevices.values()]) device.dispose();
    ++this.generation; this.discardPending();
    this.media.stopped();
    this.nativePcm?.stopped();
    this.nativeDx7?.stopped();
    this.nativeNes?.stopped();
    for(const endpoint of this.primaryPokey)endpoint.stopped();
    this.nativeWonderSwan?.stopped();this.nativeConsole?.stopped();this.nativeSnes?.stopped();this.nativePwm?.stopped();this.nativeOpn?.stopped();
    if(this.nativeVoiceChips)for(const endpoint of Object.values(this.nativeVoiceChips))endpoint.stopped();
    this.workerSampleOrigin=null;
    this.auditions.clear(); this.psgAuditions.clear();
    const session = this.session;
    const pending = this.serial.then(async () => {
      const status = await this.invoke('native_genesis_stop',{session});
      if (session === this.session) {
        this.clock.update(status,this.now());
        for(const endpoint of this.primaryPokey)await endpoint.restoreAfterStop(session);
        if(this.nativeDx7){const snapshot=await this.invoke('native_genesis_dx7_status',{session});if(session===this.session)this.nativeDx7.adoptStopped(snapshot);}
        if(this.nativeNes){const snapshot=await this.invoke('native_genesis_nes_status',{session});if(session===this.session)this.nativeNes.adoptStopped(snapshot);}
        if(this.nativeVoiceChips){
          const command=this.nativeMsxAudio?'native_genesis_msx_audio_status':this.nativeGameGear?'native_genesis_game_gear_status':this.nativeOpl?'native_genesis_opl_status':this.nativeMsx?'native_genesis_msx_status':this.nativeMasterSystem?'native_genesis_master_system_status':'native_genesis_x68000_status';
          const snapshot=await this.invoke(command,{session});
          if(session===this.session)for(const [kind,endpoint]of Object.entries(this.nativeVoiceChips))endpoint.adoptStopped(snapshot[kind]);
        }
        for(const [adapter,kind]of [[this.nativeWonderSwan,'wonderswan'],[this.nativeConsole,this.consoleKind],[this.nativeSnes,'snes'],[this.nativePwm,'pwm'],[this.nativeOpn,this.ym2203Mode?'ym2203':this.opnbMode?'ym2610b':'ym2608']])if(adapter){const snapshot=await this.invoke(`native_genesis_${kind}_status`,{session});if(session===this.session)adapter.adoptStopped(snapshot);}
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
      for(const endpoint of this.primaryPokey)endpoint.reset();
      this.nativeWonderSwan?.reset();this.nativeConsole?.reset();this.nativeSnes?.reset();this.nativePwm?.reset();this.nativeOpn?.reset();
      if(this.nativeVoiceChips)for(const endpoint of Object.values(this.nativeVoiceChips))endpoint.reset();
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
    if(this.nativeVoiceChips){
      if(!this.isReady()||this.stopping||this.closing)return;
      for(const endpoint of Object.values(this.nativeVoiceChips))endpoint.invoke('auditionAllOff').catch(error=>{if(error?.name!=='AbortError')this.reportAsyncError(error);});
      return;
    }
    if(this.nativeOpn){
      const held=[...this.auditions];this.auditions.clear();
      if(!this.isReady()||this.stopping||this.closing)return;
      for(const [channel,token]of held)this.nativeOpn.auditionNoteOff(channel,token).catch(error=>this.reportAsyncError(error));
      this.nativeOpn.invoke('auditionAllOff').catch(error=>this.reportAsyncError(error));return;
    }
    if(this.primaryPokey.length){if(!this.isReady()||this.stopping||this.closing)return;for(const endpoint of this.primaryPokey)endpoint.invoke('auditionAllOff').catch(error=>{if(error?.name!=='AbortError')this.reportAsyncError(error);});return;}
    for(const adapter of [this.nativeWonderSwan,this.nativeConsole,this.nativeSnes])if(adapter){adapter.invoke('auditionAllOff').catch(error=>{if(error?.name!=='AbortError')this.reportAsyncError(error);});return;}
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
    const primaryList = () => this.pokeyMode?this.primaryPokey.map(endpoint=>({id:endpoint.id,kind:'pokey',name:'pokey',label:`POKEY · ${endpoint.id} (Native)`,connected:true})):this.nativeVoiceChips?Object.keys(this.nativeVoiceChips).map(id=>({id,kind:id,name:id,label:`${({segapsg:'Sega PSG',ay8910:'AY-3-8910'})[id]??id.toUpperCase()} (Native)`,connected:true,...(['ym2413','ym3526','ym3812','ymf262','y8950'].includes(id)?{registers:this.nativeVoiceChips[id].client._getState().registers}:{})})):this.nativeOpn?[{id:this.chip,kind:this.chip,name:this.chip,label:`${this.chip.toUpperCase()} (Native)`,connected:true}]:this.nativeWonderSwan||this.nativeConsole||this.nativeSnes?[{id:this.chip,kind:this.chip,name:this.chip,label:`${this.chip==='wonderswan'?'WonderSwan':this.chip==='gameboy'?'Game Boy':this.chip==='huc6280'?'HuC6280':'S-DSP'} (Native)`,connected:true}]:this.nesMode?[
      {id:'nes',kind:'nes',name:'nes',label:'NES + FDS (Native)',connected:true},
    ]:this.dx7Mode?[
      {id:'dx7',kind:'dx7',name:'dx7',label:'DX7 (Native)',connected:true},
    ]:[
      {id:'ym2612',kind:'ym2612',name:'ym2612',label:this.nukedMode?'YM2612 (Native · Nuked)':'YM2612 (Native)',engine:this.engine,connected:true},
      {id:'segapsg',kind:'segapsg',name:'segapsg',label:'Sega PSG (Native)',connected:true},
      ...(this.pwm?[{id:'pwm',kind:'pwm',name:'pwm',label:'32X PWM (Native)',connected:true}]:[]),
      ...(this.pcm?[{id:'rf5c164',kind:'rf5c164',name:'rf5c164',label:'RF5C164 (Native)',connected:true}]:[]),
    ];
    const extra = id => [...this.extraDevices.values()].find(device=>device.client.id===id);
    const list = () => disposed || !this.isReady() ? [] : [...primaryList(),...[...this.extraDevices.values()].filter(device=>device.ready&&device.kind!=='spc').map(device=>({id:device.client.id,kind:device.kind,name:device.kind,label:`${device.label} · ${device.client.id} (Native)`,connected:true,additional:true,...(device.engine?{engine:device.engine}:{}),...device.layout}))];
    const endpoint = id => {
      if (!list().some(entry=>entry.id === id)) throw new Error('Sound chip is not connected');
    };
    const identity = id => {
      if (typeof id !== 'string' || !id.length || id.length > 256) throw new TypeError('Audition identity must contain 1..256 characters');
      return id;
    };
    return {
      list,
      getConnectionToken: id => {endpoint(id);return extra(id)?.nativeInstance??this.session;},
      subscribe(listener) {
        if (typeof listener !== 'function') throw new TypeError('Inspector listener must be a function');
        if (disposed) return ()=>{};
        listeners.add(listener);return ()=>listeners.delete(listener);
      },
      notify: () => {for (const listener of listeners) {try {listener(list());} catch(error) {console.error(error);}}},
      read: async id => {
        endpoint(id);
        if(this.primaryPokey.some(endpoint=>endpoint.id===id))return this.primaryPokey.find(endpoint=>endpoint.id===id).read();
        if(extra(id))return extra(id).endpoint.read();
        if(this.nativeVoiceChips?.[id])return this.nativeVoiceChips[id].read();
        if(this.nativeOpn&&id===this.chip)return this.nativeOpn.read();
        if(id==='wonderswan')return this.nativeWonderSwan.read();
        if(id===this.consoleKind)return this.nativeConsole.read();if(id==='snes')return this.nativeSnes.read();
        if(id==='dx7')return this.nativeDx7.read();
        if(id==='nes')return this.nativeNes.read();
        if(id==='pwm')return this.nativePwm.read();
        if(id==='rf5c164')return this.nativePcm.read();
        if (id === 'segapsg') unsupported('Applied PSG voice snapshots');
        return {kind:'ym2612',engine:this.engine,clock:this.fm.clock,sampleRate:this.clock.sampleRate,
          keyboardChannels:Array.from({length:6},(_,channel)=>({id:`fm:${channel}`,label:`FM ${channel+1}`})),
          held:[...this.auditions.keys()].map(channel=>`fm:${channel}`)};
      },
      invoke: async (id,method,args=[]) => {
        endpoint(id);
        if(this.primaryPokey.some(endpoint=>endpoint.id===id))return this.primaryPokey.find(endpoint=>endpoint.id===id).invoke(method,args);
        if(extra(id))return extra(id).endpoint.invoke(method,args);
        if(this.nativeVoiceChips?.[id])return this.nativeVoiceChips[id].invoke(method,args);
        if(this.nativeOpn&&id===this.chip)return this.nativeOpn.invoke(method,args);
        if(id==='wonderswan')return this.nativeWonderSwan.invoke(method,args);
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
      loadSample: async (id,source,options) => {endpoint(id);if(extra(id)?.endpoint.loadSample)return extra(id).endpoint.loadSample(source,options);if(this.nativeVoiceChips?.[id]?.loadSample)return this.nativeVoiceChips[id].loadSample(source,options);if(id==='okim6258'&&this.nativeX68000)return this.nativeX68000.okim6258.loadSample(source,options);if(id==='rf5c164')return this.nativePcm.loadSample(source,options);if(this.nativeOpn&&id===this.chip&&typeof this.nativeOpn.loadSample==='function')return this.nativeOpn.loadSample(source,options);unsupported('Native sample loading');},
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

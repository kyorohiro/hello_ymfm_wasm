import {createQSoundPreview} from './qsound_preview.js';
import {SegaPSG} from '../js/segapsg.js';
import {installOpnChannelMutes} from './opn_channel_mutes.js';
import {installPlaybackMixer} from './playback_mixer.js?v=console-songs-1';
import {Msm5205AudioEngine,attachMsm5205} from '../js/msm5205audioengine.js';
import {Oki6295AudioEngine, attachOki6295} from '../js/okim6295audioengine.js';
import {Huc6280AudioEngine} from '../js/huc6280audioengine.js';
import {createWonderSwanAudioEngine} from '../js/wonderswanaudioengine.js';
import {PokeyPlaybackEngine,pokeyPlaybackConfiguration} from './pokey_playback.js?v=pokey-vgm-1';
import {createNesApuAudioEngine,validateNesApuClock} from '../js/nesapuaudioengine.js?v=seek-state-1';
import {Oki6258AudioEngine,attachOki6258,validateOki6258Header} from '../js/okim6258audioengine.js';
import {createYm3526AudioEngine} from '../js/ym3526audioengine.js';
import {createSegaPcmAudioEngine} from '../js/segapcmaudioengine.js';
import {createGameboyApuAudioEngine} from '../js/gameboyapuaudioengine.js?v=seek-state-1';
import {createY8950AudioEngine} from '../js/y8950audioengine.js';
import {createYmf278bAudioEngine} from '../js/ymf278baudioengine.js';
import {createYm3812AudioEngine} from '../js/ym3812audioengine.js';
import {createYmf262AudioEngine} from '../js/ymf262audioengine.js';
import {createYm2151AudioEngine} from '../js/ym2151audioengine.js';
import {createAy8910AudioEngine, validateAyPlaybackHeader} from '../js/ay8910audioengine.js';
import {createMsxAudioEngine} from '../js/msxaudioengine.js?v=scc-plus-1';
import { createYm2413AudioEngine } from '../js/ym2413audioengine.js';
import { createYm2610BAudioEngine } from '../js/ym2610baudioengine.js';
import { createGenesisAudioEngine } from "../js/genesisaudioengine.js";
import { createYm2203AudioEngine } from "../js/ym2203audioengine.js";
import { createYm2608AudioEngine } from "../js/ym2608audioengine.js?v=ym2608-source-gains-1";
import {MultiChipAudioEngine} from "../js/multichipaudioengine.js";
import { VgmPlayer, createVgmTargets } from "../js/vgmplayer.js?v=pokey-vgm-1";
export function detectPlaybackChipKind(header) {
  if ((header.ym2151Clock & 0x3fffffff) && ['ay8910','ym2413','y8950','k051649'].some(kind => header[`${kind}Clock`] & 0x3fffffff)) return 'msx';
  if (header.k051649Clock & 0x3fffffff) return "msx";
  if ((header.y8950Clock & 0x3fffffff) && (header.ay8910Clock || header.ym2413Clock)) return "msx";
  if (header.ymf278bClock & 0x3fffffff) return "ymf278b";
  if (header.y8950Clock & 0x3fffffff) return "y8950";
  if (header.ymf262Clock & 0x3fffffff) return "ymf262";
  if (header.ym3526Clock & 0x3fffffff) return "ym3526";
  if (header.ym3812Clock & 0x3fffffff) return "ym3812";
  if (header.ym2151Clock & 0x3fffffff) return "ym2151";
  if (header.ay8910Clock & 0x3fffffff) return "ay8910";
  if (header.ym2413Clock & 0x3fffffff) return "ym2413";
  if ((header.ym2610Clock & 0x3fffffff) && !header.ym2612Clock && !header.ym2203Clock && !header.ym2608Clock) return "ym2610";
  if (header.rf5c164Clock > 0) return "ym2612";
  if (header.ym2203Clock > 0 && !header.ym2612Clock) {
    return "ym2203";
  }
  if (
    header.ym2608Clock > 0 &&
    !header.ym2612Clock &&
    !header.ym2203Clock
  ) {
    return "ym2608";
  }
  if (header.huc6280Clock & 0x3fffffff) return "huc6280";
  if (header.msm5205Clock & 0x3fffffff) return 'msm5205';
  if (header.qsoundClock) return "qsound";
  if (header.okim6295Clock & 0x3fffffff) return "okim6295";
  if (header.okim6258Clock && !header.ym2612Clock && !header.psgClock && !header.pwmClock) return "okim6258";
  if (header.ym2612Clock & 0x3fffffff) return "ym2612";
  // Sega PCM and Game Boy DMG clocks were only added to the VGM header in
  // v1.51/v1.61; many real-world files claim that version without actually
  // zeroing these reserved-until-then bytes, so a nonzero value here is
  // less trustworthy than any of the long-established chip fields checked
  // above. Only trust them once nothing more established has already
  // matched, so stray header noise cannot hijack an otherwise-normal file
  // (e.g. an MSX PSG/OPLL track misdetected as "gameboy").
  if (header.segaPcmClock & 0x3fffffff) return "segapcm";
  if (header.nesApuClock & 0x3fffffff) return "nes";
  if (header.gameBoyDmgClock & 0x3fffffff) return "gameboy";
  if (header.wonderswanClock & 0x3fffffff) return "wonderswan";
  if (header.pokeyClock & 0x3fffffff) return "pokey";
  return "ym2612";
}

// Sega PCM and Game Boy DMG are only ever selected by detectPlaybackChipKind
// when no long-established chip field is present (see above), but a stray
// non-zero reserved byte can still exist alone. A real track for either chip
// always contains its own write command (0xC0 / 0xB3) somewhere in the data;
// reserved-byte noise never does. Re-detect with the field cleared if that
// command never actually appears, so noise falls through to a real chip (or
// the silent default) instead of being played as a phantom chip.
export function detectPlaybackChipKindFromVgm(vgm) {
  const chipKind = detectPlaybackChipKind(vgm.header);
  const requiredCommand = chipKind === "gameboy" ? "0xb3" : chipKind === "segapcm" ? "0xc0" : null;
  if (requiredCommand && !vgm.analyzeCommandUsage().has(requiredCommand)) {
    const header = { ...vgm.header, gameBoyDmgClock: 0, segaPcmClock: 0 };
    return detectPlaybackChipKind(header);
  }
  return chipKind;
}

// Used by the OPL-family playback branch (y8950/ymf278b/ym3526/ym3812/
// ymf262/segapcm/gameboy), which supports exactly one chip at a time. Sega
// PCM / Game Boy DMG clock fields are excluded from both checks below: they
// are new enough (v1.51/v1.61) that real-world files claiming that version
// without populating them can leave non-zero reserved bytes there,
// including the top "variant/dual-chip" bits, and detectPlaybackChipKindFromVgm
// already cross-checks their presence against the command stream before
// `chip` can even be "segapcm"/"gameboy" here.
export function isUnsupportedOplFamilyCombination(chip, header) {
  const unreliableClockKeys = ["segaPcmClock", "gameBoyDmgClock"];
  const otherClocks = ["ymf278bClock", "ym3526Clock", "ym3812Clock", "ymf262Clock", "ym2151Clock", "ym2612Clock", "ym2413Clock", "ay8910Clock", "ym2203Clock", "ym2608Clock", "ym2610Clock", "rf5c164Clock", "pwmClock", "y8950Clock", "k051649Clock"];
  const hasUnreliableVariantBits = !unreliableClockKeys.includes(`${chip}Clock`) && (header[`${chip}Clock`] & 0xc0000000);
  return Boolean(hasUnreliableVariantBits) || otherClocks.some((key) => key !== `${chip}Clock` && header[key]);
}

export function validateOpmPlayback(header) {
  if ((header.ym2151Clock & 0x40000000) || (header.segaPcmClock & 0xc0000000) ||
      ['ym2612Clock','ym2413Clock','ay8910Clock','ym2203Clock','ym2608Clock','ym2610Clock','rf5c164Clock','pwmClock','y8950Clock','k051649Clock'].some(key => header[key]))
    throw new Error('This YM2151 variant or chip combination: Support coming soon.');
}


export class PlaybackError extends Error {
  constructor(code, message, details = {}) { super(message); this.name = 'PlaybackError'; this.code = code; this.details = details; }
}
const composition = {
  qsound: ['qsound'],
  ym2612: ['ym2612','psg','rf5c164','pwm'],
  ym2203: ['ym2203'], ym2608: ['ym2608'], ym2610: ['ym2610'],
  ym2151: ['ym2151','psg','segaPcm','okim6295'], ay8910: ['ay8910','ym2413'],
  msx: ['ay8910','ym2413','y8950','k051649','ym2151'],
  ym2413: ['ym2413','psg'], y8950: ['y8950','psg'],
  ymf278b: ['ymf278b','psg'], ym3526: ['ym3526','psg'],
  ym3812: ['ym3812','psg','okim6295'], ymf262: ['ymf262','psg'],
  huc6280: ['huc6280','msm5205'], msm5205:['msm5205'], segapcm: ['segaPcm','psg'], nes: ['nesApu'], gameboy: ['gameBoyDmg'], wonderswan: ['wonderswan'], pokey:['pokey'], okim6258: ['okim6258'], okim6295: ['okim6295'],
};
const dualKinds = new Set(['ym2612','ym2608','ym2610','gameBoyDmg','psg']);
export function selectPlaybackConfiguration(vgm) {
  const header = {...vgm.header};
  const usage=vgm.analyzeCommandUsage();
  // Preserve the Browser's legacy reserved-header-noise workaround.
  const ignoredClocks=[];
  for (const [key,command] of [['gameBoyDmgClock','0xb3'],['segaPcmClock','0xc0']]) {
    if (header[key] && !usage.has(command)) { ignoredClocks.push(key); header[key]=0; }
  }
  let kind = detectPlaybackChipKind(header);
  const chips=Object.entries(header).filter(([k,v])=>k.endsWith('Clock') && v).map(([k,v])=>({id:k.slice(0,-5),rawClock:v>>>0}));
  try {
    const supported = new Set(Object.values(composition).flat());
    const unsupported=chips.filter(c=>!supported.has(c.id));
    if (unsupported.length) throw new Error(`Unsupported sound chip: ${unsupported.map(c=>c.id).join(', ')}`);
    for (const {id,rawClock} of chips) {
      const allowDual = id === 'pokey' || dualKinds.has(id);
      const allowVariant = ['ym2610','ym2151','k051649','nesApu','okim6295'].includes(id);
      if ((!allowDual && (rawClock & 0x40000000)) || (!allowVariant && (rawClock & 0x80000000))) {
        throw new Error('Dual/variant configuration is not supported');
      }
    }
    if (header.qsoundClock && (chips.length !== 1 || header.qsoundClock > 8_000_000))
      throw new Error('QSound PCM preview supports one QSound chip and input clocks up to 8 MHz');
    if (header.pokeyClock) pokeyPlaybackConfiguration(header.pokeyClock);
    if (header.nesApuClock) validateNesApuClock(header.nesApuClock & 0x3fffffff);
    if (header.okim6258Clock) validateOki6258Header(header);
    if (header.ay8910Clock) validateAyPlaybackHeader({ay8910Clock:header.ay8910Clock,ay8910Type:header.ay8910Type,ay8910Flags:header.ay8910Flags});
    // These are compatibility paths (monitors and snapshots), not an allowlist.
    // Any other combination of supported chips is assembled by the mixer.
    if (chips.some(c=>dualKinds.has(c.id) && (c.rawClock & 0x40000000)) || kind==='msm5205' || !chips.every(c=>composition[kind].includes(c.id) || c.id==='okim6258')) kind='mixed';
  } catch (error) { throw new PlaybackError('UNSUPPORTED_CONFIGURATION', error.message, {kind,header}); }
  const sources = chips.flatMap(chip => {
    if (chip.id === 'pokey') return Array.from({length:pokeyPlaybackConfiguration(chip.rawClock).count},
      (_,chipIndex)=>({...chip,id:chipIndex?'pokey:2':'pokey',kind:'pokey',chipIndex}));
    if (dualKinds.has(chip.id) && (chip.rawClock & 0x40000000)) return [chip,{...chip,id:chip.id+':2',chipIndex:1}];
    return [chip];
  });
  return {kind, header, chips:sources, ignoredClocks, ...(kind==='mixed' ? {parts:planPlaybackParts(header)} : {}), requiredRoms: [
    ...(header.ym2608Clock && vgm.requiresYm2608RhythmRom?.() ? ['ym2608AdpcmA'] : []),
    ...(header.ymf278bClock && vgm.requiresYmf278bWaveRom?.() ? ['ymf278bWave'] : []),
  ]};
}
// A descriptor identifies the header clocks consumed by one existing engine.
// Genesis timing and DAC streams stay together; the other entries are independent.
const independentKinds = {segaPcm:'segapcm',nesApu:'nes',gameBoyDmg:'gameboy',k051649:'msx'};
function planPlaybackParts(header) {
  const groups=[];
  const genesis=['ym2612','psg','rf5c164','pwm'].filter(id=>header[id+'Clock'] && !(id === 'psg' && (header.psgClock & 0x40000000)));
  if(genesis.length)groups.push({id:'genesis',kind:'ym2612',chips:genesis});
  for(const [key,value] of Object.entries(header)) {
    if(!key.endsWith('Clock') || !value)continue;
    const id=key.slice(0,-5);
    if(genesis.includes(id))continue;
    groups.push({id,kind:independentKinds[id]??id,chips:[id]});
  }
  for (const id of dualKinds) {
    if (header[id+'Clock'] & 0x40000000) groups.push({id:id+'-2',kind:independentKinds[id]??id,chips:[id],chipIndex:1});
  }
  return groups.map(part => {
    const clocks = {...header};
    for (const key of Object.keys(clocks)) {
      if (!key.endsWith('Clock')) continue;
      const id = key.slice(0,-5);
      if (!part.chips.includes(id)) clocks[key] = 0;
      else if (dualKinds.has(id)) clocks[key] = (clocks[key] & ~0x40000000) >>> 0;
    }
    return {...part,header:clocks};
  });
}
// Genesis renders at its native rate. Adapt without generating samples past
// the current VGM wait, so writes between waits keep their original timing.
function atOutputRate(engine,rate){
  const inputRate=engine.sampleRate();
  if(inputRate===rate)return engine;
  let phase=0,lastLeft=0,lastRight=0;
  const adapter={
    mixerEngine: engine,
    sampleRate:()=>rate,
    reset(){engine.reset();phase=lastLeft=lastRight=0;},
    dispose:()=>engine.dispose(),
    processFrames(frames){
      const count=Math.floor((phase+frames*inputRate)/rate),pcm=engine.processFrames(count);
      const left=new Float32Array(frames),right=new Float32Array(frames);
      let cursor=0;
      for(let i=0;i<frames;i++){
        phase+=inputRate;
        const consumed=Math.floor(phase/rate);phase-=consumed*rate;cursor+=consumed;
        if(consumed){lastLeft=pcm.left[cursor-1];lastRight=pcm.right[cursor-1];}
        left[i]=lastLeft;right[i]=lastRight;
      }
      return {left,right};
    },
  };
  for(const method of ['clearSampleMemory','clearAdpcmBMemory','clearAdpcmRoms','clearRf5c164Memory','clearWonderSwanMemory','clearOki6295Rom','loadAdpcmARom','loadWaveRom','setRhythmMuted']){
    if(typeof engine[method]==='function')adapter[method]=engine[method].bind(engine);
  }
  return adapter;
}
export function dualOpnParts(parts) {
  return parts.filter(part => ['ym2612','ym2608','ym2610'].includes(part.kind) &&
    parts.some(other => other.kind === part.kind && other.chipIndex === 1));
}
class HeaderMixedAudioEngine extends MultiChipAudioEngine {
  constructor(parts,volume){
    super(parts.map(p=>({type:p.id,engine:atOutputRate(p.engine,44100),target:{}})),44100,volume);
    this.vgmTargets={};
    this.targetResolvers=new Map();
    const names={segaPcm:'segapcm',gameBoyDmg:'gameboyDmg'};
    this.fmInstances = [];
    const monitored = dualOpnParts(parts);
    for(const part of parts){
      const index = monitored.indexOf(part);
      if (index >= 0) {
        const method = {ym2612:'writeYm2612',ym2608:'writeYm2608',ym2610:'writeYm2610B'}[part.kind];
        installOpnChannelMutes(part.engine,part.kind);
        const pan = new Uint8Array(6).fill(0xc0);
        const muted = new Uint8Array(6);
        const write = part.engine[method].bind(part.engine);
        this.fmInstances[index] = {pan, muted, write, engine:part.engine};
        part.engine[method] = (port, reg, value) => {
          this.onFmWrite?.(index, port, reg, value);
          if (reg >= 0xb4 && reg <= 0xb6) {
            const ch = 3 * port + reg - 0xb4;
            pan[ch] = value;
            if (muted[ch]) value &= 0x3f;
          }
          write(port, reg, value);
        };
      }
      const targets=createVgmTargets(part.engine);
      for(const id of part.chips){
        const name=names[id]??id;
        if(!targets[name])throw new Error(`Missing VGM adapter: ${id}`);
        if (part.chipIndex) {
          this.targetResolvers.set(name+':'+part.chipIndex,()=>targets[name]);
          continue;
        }
        this.vgmTargets[name]=targets[name];
        this.targetResolvers.set(name,index=>targets.resolveChip?targets.resolveChip(name,index):index===0?targets[name]:undefined);
      }
    }
    this.vgmTargets.resolveChip=this.getVgmTarget.bind(this);
  }
  reset() {
    super.reset();
    for (const [index, fm] of this.fmInstances.entries()) {
      fm.pan.fill(0xc0);
      fm.muted.forEach((muted,ch) => {if (muted) this.setFmChannelMuted(index,ch,true);});
    }
    this.onFmReset?.();
  }
  setFmChannelMuted(index,ch,muted) {
    const fm = this.fmInstances[index];
    fm.muted[ch] = Boolean(muted);
    fm.write(Math.floor(ch/3), 0xb4 + ch%3, muted ? fm.pan[ch] & 0x3f : fm.pan[ch]);
  }
  setInstanceSsgChannelMuted(index,ch,muted) {
    this.fmInstances[index].engine.setSsgChannelMuted(ch,muted);
  }
  getVgmTarget(type,index=0) {
    const resolve = this.targetResolvers.get(type+':'+index) ?? this.targetResolvers.get(type);
    const target = resolve?.(index);
    if (!target) throw new Error(`No playback instance for ${type}:${index}`);
    return target;
  }
  supportsState(){return false;}
  clearAdpcmBMemory(){for(const {engine} of this.entries.values())engine.clearAdpcmBMemory?.();}
  clearAdpcmRoms(){for(const {engine} of this.entries.values())engine.clearAdpcmRoms?.();}
  clearRf5c164Memory(){for(const {engine} of this.entries.values())engine.clearRf5c164Memory?.();}
  clearWonderSwanMemory(){for(const {engine} of this.entries.values())engine.clearWonderSwanMemory?.();}
  clearOki6295Rom(){for(const {engine} of this.entries.values())engine.clearOki6295Rom?.();}
  loadAdpcmARom(data){for(const id of ['ym2608:0','ym2608-2:0'])this.entries.get(id)?.engine.loadAdpcmARom(data);}
  loadWaveRom(data){this.entries.get('ymf278b:0')?.engine.loadWaveRom(data);}
  setRhythmMuted(value){for(const id of ['ym2608:0','ym2608-2:0'])this.entries.get(id)?.engine.setRhythmMuted(value);}
}
async function createHeaderMixedEngine(configuration,resource,volume,options){
  const parts=[];
  try{
    for(const part of configuration.parts){
      const engine=await recipes[part.kind]({header:part.header},resource,1,options);
      parts.push({...part,engine});
    }
    return new HeaderMixedAudioEngine(parts,volume);
  }catch(error){for(const part of parts)part.engine.dispose();throw error;}
}

const recipes = {
  qsound: async (vgm,resource,volume) => createQSoundPreview(vgm.header.qsoundClock,volume),
  psg: async (vgm,resource) => {
    const psg = await SegaPSG.create({moduleFactory:await resource('segapsg'),clock:vgm.header.psgClock});
    return {
      psg, sampleRate:() => psg.sampleRate(), processFrames:frames => psg.generateStereo(frames),
      writePsg:value => psg.write(value), setPsgChannelMuted:(ch,muted) => psg.setChannelMuted(ch,muted),
      reset:() => psg.reset(), dispose:() => psg.dispose(),
    };
  },
  msm5205: async (vgm,resource,masterVolume) => new Msm5205AudioEngine({clock:vgm.header.msm5205Clock,flags:vgm.header.msm5205Flags,masterVolume}),
  okim6295: async (vgm, resource, masterVolume) => new Oki6295AudioEngine({clock:vgm.header.okim6295Clock,masterVolume}),
  huc6280: async (vgm, resource, masterVolume) => Huc6280AudioEngine.create({moduleFactory:await resource("huc6280"),clock:vgm.header.huc6280Clock,masterVolume}),
  wonderswan: async (vgm, resource, masterVolume) => createWonderSwanAudioEngine({moduleFactory:await resource('wonderswan'),clock:vgm.header.wonderswanClock & 0x3fffffff,masterVolume}),
  pokey: async (vgm,resource,masterVolume) => PokeyPlaybackEngine.create({moduleFactory:await resource('pokey'),rawClock:vgm.header.pokeyClock,masterVolume}),
  nes: async (vgm, resource, masterVolume) => createNesApuAudioEngine({clock:vgm.header.nesApuClock & 0x3fffffff,fds:!!(vgm.header.nesApuClock & 0x80000000),masterVolume}),
  okim6258: async (vgm, resource, masterVolume) => Oki6258AudioEngine.create({moduleFactory:await resource('okim6258'),clock:vgm.header.okim6258Clock,flags:vgm.header.okim6258Flags,masterVolume}),
  msx: async (vgm, resource, masterVolume) => createMsxAudioEngine({
        ym2151ModuleFactory: vgm.header.ym2151Clock ? await resource('ym2151') : undefined,
        ym2151Clock: vgm.header.ym2151Clock & 0x3fffffff,
        ym2151Variant: (vgm.header.ym2151Clock & 0x80000000) ? 'ym2164' : 'ym2151',
        ayModuleFactory: vgm.header.ay8910Clock ? await resource('ay8910') : undefined,
        ayClock: vgm.header.ay8910Clock & 0x3fffffff, ayType:vgm.header.ay8910Type, ayFlags:vgm.header.ay8910Flags,
        ym2413ModuleFactory: vgm.header.ym2413Clock ? await resource('ym2413') : undefined,
        ym2413Clock:vgm.header.ym2413Clock & 0x3fffffff,
        y8950ModuleFactory: vgm.header.y8950Clock ? await resource('y8950') : undefined,
        y8950Clock:vgm.header.y8950Clock & 0x3fffffff,
        k051649ModuleFactory: vgm.header.k051649Clock ? await resource('k051649') : undefined,
        k051649Clock: vgm.header.k051649Clock & 0x3fffffff, masterVolume,
      }),
  y8950: async (vgm, resource, masterVolume) => createY8950AudioEngine({
        y8950ModuleFactory: await resource('y8950'),
        y8950Clock: vgm.header.y8950Clock & 0x3fffffff,
        segaPsgModuleFactory: await resource('segapsg'), psgClock: vgm.header.psgClock & 0x3fffffff, masterVolume,
      }),
  ymf278b: async (vgm, resource, masterVolume) => createYmf278bAudioEngine({
        ymf278bModuleFactory: await resource('ymf278b'),
        ymf278bClock: vgm.header.ymf278bClock & 0x3fffffff,
        segaPsgModuleFactory: await resource('segapsg'), psgClock: vgm.header.psgClock & 0x3fffffff, masterVolume,
      }),
  ym3526: async (vgm, resource, masterVolume) => createYm3526AudioEngine({
        ym3526ModuleFactory: await resource('ym3526'),
        ym3526Clock: vgm.header.ym3526Clock & 0x3fffffff,
        segaPsgModuleFactory: await resource('segapsg'), psgClock: vgm.header.psgClock & 0x3fffffff, masterVolume,
      }),
  ym3812: async (vgm, resource, masterVolume) => createYm3812AudioEngine({
        ym3812ModuleFactory: await resource('ym3812'),
        ym3812Clock: vgm.header.ym3812Clock & 0x3fffffff,
        segaPsgModuleFactory: await resource('segapsg'), psgClock: vgm.header.psgClock & 0x3fffffff, masterVolume,
      }),
  ymf262: async (vgm, resource, masterVolume) => createYmf262AudioEngine({
        ymf262ModuleFactory: await resource('ymf262'),
        ymf262Clock: vgm.header.ymf262Clock & 0x3fffffff,
        segaPsgModuleFactory: await resource('segapsg'), psgClock: vgm.header.psgClock & 0x3fffffff, masterVolume,
      }),
  segapcm: async (vgm, resource, masterVolume) => createSegaPcmAudioEngine({
        moduleFactory: await resource('segapcm'),
        clock: vgm.header.segaPcmClock & 0x3fffffff,
        bankShift: vgm.header.segaPcmBankShift, bankMask: vgm.header.segaPcmBankMask,
        segaPsgModuleFactory: await resource('segapsg'), psgClock: vgm.header.psgClock & 0x3fffffff, masterVolume,
      }),
  gameboy: async (vgm, resource, masterVolume) => createGameboyApuAudioEngine({
          moduleFactory: await resource('gameboy_apu'),
          clock: vgm.header.gameBoyDmgClock & 0x3fffffff, masterVolume,
        }),
  ym2151: async (vgm, resource, masterVolume) => createYm2151AudioEngine({
        ym2151ModuleFactory: await resource('ym2151'),
        ym2151Clock: vgm.header.ym2151Clock & 0x3fffffff,
        ym2151Variant: (vgm.header.ym2151Clock & 0x80000000) ? 'ym2164' : 'ym2151',
        segaPsgModuleFactory: await resource('segapsg'), psgClock: vgm.header.psgClock & 0x3fffffff,
        segaPcmModuleFactory: vgm.header.segaPcmClock ? await resource('segapcm') : undefined,
        segaPcmClock: vgm.header.segaPcmClock & 0x3fffffff,
        segaPcmBankShift: vgm.header.segaPcmBankShift, segaPcmBankMask: vgm.header.segaPcmBankMask, masterVolume,
      }),
  ay8910: async (vgm, resource, masterVolume) => vgm.header.ym2413Clock ? await createMsxAudioEngine({
        ayModuleFactory: await resource('ay8910'), ayClock: vgm.header.ay8910Clock & 0x3fffffff,
        ayType: vgm.header.ay8910Type, ayFlags: vgm.header.ay8910Flags,
        ym2413ModuleFactory: await resource('ym2413'),
        ym2413Clock: vgm.header.ym2413Clock & 0x3fffffff, masterVolume,
      }) : await createAy8910AudioEngine({moduleFactory: await resource('ay8910'), clock: vgm.header.ay8910Clock & 0x3fffffff,
        type: vgm.header.ay8910Type, flags: vgm.header.ay8910Flags, masterVolume}),
  ym2413: async (vgm, resource, masterVolume) => createYm2413AudioEngine({
        ym2413ModuleFactory: await resource('ym2413'),
        ym2413Clock: vgm.header.ym2413Clock & 0x3fffffff,
        segaPsgModuleFactory: await resource('segapsg'), psgClock: vgm.header.psgClock & 0x3fffffff, masterVolume,
      }),
  ym2610: async (vgm, resource, masterVolume) => createYm2610BAudioEngine({
        moduleFactory: await resource('ym2610b'),
        clock: vgm.header.ym2610Clock & 0x3fffffff,
        variant: Boolean(vgm.header.ym2610Clock & 0x80000000), masterVolume,
      }),
  ym2203: async (vgm, resource, masterVolume) => createYm2203AudioEngine({
        ym2203ModuleFactory: await resource('ym2203'),
        ym2203Clock: vgm.header.ym2203Clock,
        masterVolume,
      }),
  ym2608: async (vgm, resource, masterVolume) => createYm2608AudioEngine({
        ym2608ModuleFactory: await resource('ym2608'),
        ym2608Clock: vgm.header.ym2608Clock,
        masterVolume,
      }),
  ym2612: async (vgm, resource, masterVolume, options = {}) => createGenesisAudioEngine({
        ym2612ModuleFactory: await resource('ym2612'),
        segaPsgModuleFactory: await resource('segapsg'),
        ym2612Clock: (vgm.header.ym2612Clock & 0x3fffffff) || undefined,
        psgClock: (vgm.header.psgClock & 0x3fffffff) || undefined,
        rf5c164Clock: vgm.header.rf5c164Clock & 0x3fffffff,
        rf5c164ModuleFactory: Boolean(vgm.header.rf5c164Clock)
          ? await resource('rf5c164') : undefined,
        masterVolume,
        pwmModel: vgm.header.pwmClock ? options.pwmModel : 'legacy',
        pwmClock: vgm.header.pwmClock & 0x3fffffff,
        pwmOutputMode: options.pwmOutputMode,
      }),
};
/** Factories are supplied by the host. No URL, filesystem or output device here. */
export async function createPlaybackEngine(vgm, {getFactory, masterVolume=1, roms={}, allowMissingYm2608RhythmRom=false, pwmModel='mame', pwmOutputMode='duty'} = {}) {
  if (!['legacy', 'mame'].includes(pwmModel)) throw new Error('Unknown PWM model');
  if (!['dac', 'duty'].includes(pwmOutputMode)) throw new Error('Unknown PWM output mode');
  const configuration = selectPlaybackConfiguration(vgm);
  // Browser audition can omit the rhythm source; full CLI rendering stays strict.
  for (const name of configuration.requiredRoms) {
    if (name === 'ym2608AdpcmA' && allowMissingYm2608RhythmRom) continue;
    if (!roms[name]) throw new PlaybackError('MISSING_RESOURCE', `Missing ROM: ${name}`, {resource:name,kind:configuration.kind});
  }
  const resource = async name => {
    const factory = await getFactory?.(name);
    if (!factory) throw new PlaybackError('MISSING_RESOURCE', `Missing WASM factory: ${name}`, {resource:name,kind:configuration.kind});
    return factory;
  };
  let engine;
  try {
    engine = configuration.kind==='mixed' ? await createHeaderMixedEngine(configuration,resource,masterVolume,{pwmModel,pwmOutputMode}) : await recipes[configuration.kind]({header:configuration.header},resource,masterVolume,{pwmModel,pwmOutputMode});
    const attachMsm=configuration.kind==='huc6280' && configuration.header.msm5205Clock;
    const mixer = installPlaybackMixer(engine, attachMsm ? {...configuration,chips:configuration.chips.filter(c=>c.id!=='msm5205')} : configuration);
    if (attachMsm) {
      const msm=new Msm5205AudioEngine({clock:configuration.header.msm5205Clock,flags:configuration.header.msm5205Flags,outputSampleRate:engine.sampleRate()});
      mixer.addSource('msm5205',msm,'processFrames',engine.sampleRate(),1);
      attachMsm5205(engine,msm);
    }
    if (configuration.kind!=='mixed' && configuration.header.okim6295Clock && !engine.writeOki6295) {
      const oki = new Oki6295AudioEngine({clock:configuration.header.okim6295Clock,outputSampleRate:engine.sampleRate()});
      mixer.addSource('okim6295', oki, 'processFrames', engine.sampleRate(),1);
      attachOki6295(engine, oki);
    }
    if (configuration.kind!=='mixed' && vgm.header.okim6258Clock && typeof engine.writeOki6258 !== 'function') {
      const oki = await Oki6258AudioEngine.create({moduleFactory:await resource('okim6258'),clock:vgm.header.okim6258Clock,flags:vgm.header.okim6258Flags,outputSampleRate:engine.sampleRate()});
      mixer.addSource('okim6258', oki, 'processFrames', engine.sampleRate(),1);
      attachOki6258(engine,oki);
    }
    if (configuration.header.ym2608Clock && allowMissingYm2608RhythmRom && !roms.ym2608AdpcmA) engine.setRhythmMuted(true);
    if (roms.ym2608AdpcmA && engine.loadAdpcmARom) engine.loadAdpcmARom(roms.ym2608AdpcmA);
    if (roms.ymf278bWave && engine.loadWaveRom) engine.loadWaveRom(roms.ymf278bWave);
    return engine;
  } catch(error) { engine?.dispose(); throw error; }
}
export function createPlaybackPlayer(engine, source, {onWarning=()=>{}, loop=false}={}) {
  const player=new VgmPlayer(engine);
  player.setLoopEnabled(loop);
  player.load(source,{logger:{warn:onWarning}});
  return player;
}

// Existing Browser mute controls, described once for headless callers.
export function playbackMuteControls(configuration) {
  if(configuration.kind==='mixed') return configuration.parts.map(p=>({id:p.id,method:'setChipMuted',args:[p.id,0]}));
  const {kind,header:h}=configuration, controls=[];
  const add=(id,method,...args)=>controls.push({id,method,args});
  const channels=(prefix,count,method)=>{for(let i=0;i<count;i++)add(prefix+'-'+(i+1),method,i);};
  if(kind==='pokey')channels('pokey-ch',pokeyPlaybackConfiguration(h.pokeyClock).count*4,'setChannelMuted');
  const counts={qsound:19,huc6280:6,wonderswan:4,ym2203:3,ym2151:8,ym2413:9,ym3526:9,ym3812:9,ymf262:18,ymf278b:18,y8950:9,gameboy:4,nes:(h.nesApuClock & 0x80000000)?6:5};
  if(counts[kind])channels(kind+'-ch',counts[kind],'setChannelMuted');
  if(kind==='ymf278b')channels('ymf278b-pcm',24,'setPcmChannelMuted');
  if(h.psgClock){add('psg','setPsgMuted');channels('psg-ch',4,'setPsgChannelMuted');}
  if(kind==='ym2612'){
    if(h.rf5c164Clock)add('rf5c164','setPcmMuted');
    if(h.pwmClock)add('pwm','setPwmMuted');
  }
  if(['ym2203','ym2608','ym2610'].includes(kind))add('ssg','setSsgMuted');
  if(['ym2608','ym2610'].includes(kind)){add(kind==='ym2608'?'rhythm':'adpcm-a','setRhythmMuted');add('adpcm-b','setAdpcmBMuted');}
  if(kind==='y8950')add('y8950-adpcm','setAdpcmMuted');
  if(h.okim6295Clock)add('okim6295','setOki6295Muted');
  if(h.okim6258Clock)add('okim6258','setOkiMuted');
  if(h.msm5205Clock)add('msm5205','setMsm5205Muted');
  if(h.segaPcmClock && ['segapcm','ym2151'].includes(kind)){add('segapcm','setSegaPcmMuted');channels('segapcm-ch',16,'setSegaPcmChannelMuted');}
  if(['ay8910','msx'].includes(kind)&&h.ay8910Clock){add('ay8910','setAyMuted');channels('ay8910-ch',3,'setAyChannelMuted');}
  if(kind==='msx'){
    if(h.ym2151Clock){add('ym2151','setOpmMuted');channels('ym2151-ch',8,'setOpmChannelMuted');}
    if(h.ym2413Clock)add('ym2413','setOpllMuted');
    if(h.y8950Clock)add('y8950','setY8950Muted');
    if(h.k051649Clock){add('k051649','setSccMuted');channels('k051649-ch',5,'setSccChannelMuted');}
  }
  return controls;
}
export function applyPlaybackMutes(engine,configuration,ids=[]) {
  if(!Array.isArray(ids)||ids.some(id=>typeof id!=='string')||new Set(ids).size!==ids.length)throw new Error('mute must be an array of unique IDs');
  const controls=playbackMuteControls(configuration);
  const selected=ids.map(id=>{
    const c=controls.find(c=>c.id===id);
    if(!c)throw new Error('Unsupported mute ID: '+id+'; available: '+controls.map(c=>c.id).join(', '));
    if(typeof engine[c.method]!=='function')throw new Error('Engine does not implement mute: '+id);
    return c;
  });
  for(const c of selected)engine[c.method](...c.args,true);
}

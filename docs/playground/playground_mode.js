import {CHIP_CLOCKS} from '../js/playground_chip_clock.js?v=pokey-prepare-1';

// Modes describe an authoring environment. Chip IDs remain the runtime/API IDs.
const definitions = [
  {id:'genesis', label:'Genesis', chip:'ym2612'},
  {id:'mega-cd', label:'Mega CD', chip:'ym2612', declarationChip:'mega-cd',
    megaCD:true, mega32X:false, legacyDraftKey:'mega-cd', chipTabs:['operator', 'segapsg', 'rf5c164', 'cdda'],
    details:'YM2612 + Sega PSG + RF5C164 · 8 PCM voices · 64 KiB RAM + CD-DA'},
  {id:'genesis-full', label:'32X', chip:'ym2612', declarationChip:'mega-cd', full:true},
  {id:'genesis-full-nuked', label:'32X Nuked', chip:'ym2612', declarationChip:'mega-cd', full:true, engine:'nuked'},
  {id:'pc98-26', label:'PC-98 (YM2203 / OPN)', chip:'ym2203'},
  {id:'pc98', label:'PC-98 (YM2608 / OPNA)', chip:'ym2608'},
  {id:'neogeo', label:'Neo Geo', chip:'ym2610'},
  {id:'neogeo-b', label:'Neo Geo (YM2610B)', chip:'ym2610b'},
  {id:'wonderswan', label:'WonderSwan', chip:'wonderswan', engine:'wavetable', fmChannels:0, clock:3072000, chipTabs:['wonderswan'], details:'4 channels · 32 × 4-bit waveforms · Stereo · Noise / Sweep / PCM'},
  {id:'gameboy', label:'Game Boy', chip:'gameboy', engine:'apu', fmChannels:0, chipTabs:['gameboy']},
  {id:'nes', label:'NES + FDS', chip:'nes', engine:'apu', fmChannels:0, chipTabs:['nes']},
  {id:'ps1', label:'PlayStation (PS1)', chip:'ps1', engine:'spu', fmChannels:0, chipTabs:['ps1'], details:'SPU · 44,100 Hz · 24 ADPCM voices · 512 KiB RAM · Experimental'},
  {id:'snes', label:'SNES', chip:'snes', engine:'dsp', fmChannels:0, chipTabs:['snes'], details:'S-DSP · 32,000 Hz · 8 voices'},
  {id:'x68000', label:'X68000', chip:'x68000', engine:'opm-adpcm', fmChannels:0, chipTabs:['ym2151','okim6258'], details:'YM2151 · 4 MHz + OKIM6258 · 8 MHz'},
  {id:'pc-engine', label:'PC Engine', chip:'huc6280', engine:'psg', fmChannels:0, chipTabs:['huc6280'], details:'HuC6280 PSG · 6 channels · 32 × 5-bit waveforms'},
  {id:'pc-engine-cd', label:'PC Engine CD-ROM²', chip:'huc6280', declarationChip:'pc-engine-cd', pcEngineCd:true, engine:'psg', fmChannels:0, chipTabs:['huc6280','msm5205','cdda'], legacyDraftKey:'pc-engine-cd', details:'HuC6280 PSG + MSM5205 ADPCM · 64 KiB sample RAM + CD-DA'},
  {id:'game-gear', label:'Game Gear', chip:'segapsg', declarationChip:'game-gear', engine:'psg', fmChannels:0,
    stereoEnabled:true, chipTabs:['segapsg'], details:'Sega PSG · 3,579,545 Hz · 3 tones + noise · Stereo'},
  {id:'master-system', label:'Master System', chip:'segapsg', declarationChip:'master-system', engine:'psg', fmChannels:0,
    stereoEnabled:false, ym2413:true, chipTabs:['segapsg','ym2413'], details:'Sega PSG + YM2413 OPLL · 3,579,545 Hz · Mono'},
  {id:'atari-st', label:'Atari ST', chip:'ay8910', declarationChip:'atari-st', engine:'psg', fmChannels:0,
    clock:2000000, legacyDraftKey:'atari-st', chipTabs:['ay8910'], details:'YM2149 · 2,000,000 Hz · 3 tones + shared noise and envelope · Mono'},
  {id:'pokey', label:'Atari 8-bit', chip:'pokey', declarationChip:'pokey', engine:'psg', fmChannels:0,
    clock:1789790, legacyDraftKey:'pokey', chipTabs:['pokey'], details:'POKEY · 1,789,790 Hz · 4 voices · Mono'},
  {id:'pokey-dual', label:'Atari Arcade (Dual POKEY)', chip:'pokey', declarationChip:'pokey-dual', engine:'psg', fmChannels:0,
    clock:1789773, dualPokey:true, legacyDraftKey:'pokey-dual', chipTabs:['pokey'], details:'2 × POKEY · 1,789,773 Hz · 4 + 4 voices · Independent chips'},
  {id:'msx', label:'MSX', chip:'msx', declarationChip:'msx', engine:'msx', fmChannels:0, chipTabs:['ym2413','ay8910'],
    details:'PSG + MSX-MUSIC'},
  {id:'msx-audio', label:'MSX Audio', chip:'msx-audio', declarationChip:'msx-audio', engine:'msx', fmChannels:0, chipTabs:['y8950','ym2413','ay8910'],
    details:'PSG + MSX-MUSIC + MSX-AUDIO FM'},
  {id:'dx7', label:'DX7', chip:'dx7', engine:'msfa', fmChannels:0, chipTabs:['dx7'],
    details:'MSFA DX7 · 6 operators · 32 algorithms · 16 voices · 44,100 Hz internal'},
  {id:'ym3526', label:'DOS PC (YM3526/OPL)', chip:'ym3526', engine:'opl', fmChannels:0, chipTabs:['ym3526'],
    details:'YM3526 · 9 FM voices · 2 operators · Sine waveform · Mono'},
  {id:'ym3812', label:'DOS PC (YM3812/OPL2)', chip:'ym3812', engine:'opl', fmChannels:0, chipTabs:['ym3812'],
    details:'YM3812 · 9 FM voices · 2 operators · 4 waveforms · Mono'},
  {id:'ymf262', label:'DOS PC (YMF262/OPL3)', chip:'ymf262', engine:'opl', fmChannels:0, chipTabs:['ymf262'],
    details:'YMF262 · 18 FM channels · 6 optional four-operator pairs · Stereo'},
  // Preserve old engine/chip links without adding another standard environment.
  {id:'genesis-nuked', label:'Genesis (Nuked)', chip:'ym2612', engine:'nuked', legacy:true},
];
const modes = new Map(definitions.map(definition => {
  const mode = Object.freeze({engine:'ymfm', full:false, ...definition,
    clock:definition.clock ?? CHIP_CLOCKS[definition.chip],
    declarationChip:definition.declarationChip ?? definition.chip,
    legacyDraftKey:definition.legacyDraftKey ?? (definition.chip === 'segapsg' ? definition.id : definition.chip + (definition.engine === 'nuked' ? ':nuked' : '')),
    chipTabs:Object.freeze(definition.chipTabs ?? (definition.chip === 'ym2612'
      ? ['operator', 'segapsg', ...(definition.full ? ['rf5c164', 'pwm'] : [])]
      : definition.fmChannels === 0 ? [] : ['operator'])),
  });
  return [mode.id, mode];
}));
export const PLAYGROUND_MODES = Object.freeze([...modes.values()].filter(mode => !mode.legacy));

export function getPlaygroundMode(id) {
  const key = String(id).toLowerCase();
  const mode = modes.get(key === 'y8950' ? 'msx-audio' : key);
  if (!mode) throw new Error(`Unsupported Playground mode: ${id}`);
  return mode;
}

/** Explicit mode wins; chip/engine and layout-only modes are old URL inputs. */
export function resolvePlaygroundMode(search = '') {
  const params = new URLSearchParams(search);
  const id = params.get('mode')?.toLowerCase();
  if (id && !['simple', 'full'].includes(id)) return getPlaygroundMode(id);
  const chip = (params.get('chip') || 'ym2612').toLowerCase();
  const legacy = {ym2612:params.get('engine') === 'nuked' ? 'genesis-nuked' : 'genesis',
    ym2203:'pc98-26', ym2608:'pc98', ym2610:'neogeo', ym2610b:'neogeo-b', gameboy:'gameboy',
    ps1:'ps1',wonderswan:'wonderswan',pokey:'pokey',nes:'nes',snes:'snes',x68000:'x68000',huc6280:'pc-engine',dx7:'dx7',
    ym3812:'ym3812',ym3526:'ym3526',y8950:'msx-audio',ymf262:'ymf262',msx:'msx','msx-audio':'msx-audio'};
  if (!legacy[chip]) throw new Error(`Unsupported Playground chip: ${chip}`);
  return getPlaygroundMode(legacy[chip]);
}

export function isSimplePlaygroundLayout(search = '') {
  const params = new URLSearchParams(search);
  return params.get('layout') === 'simple' || params.get('mode') === 'simple';
}

/** Generate new links using mode only, keeping source/import and layout inputs. */
export function createPlaygroundModeUrl(href, id) {
  const mode = getPlaygroundMode(id);
  const url = new URL(href);
  if (url.searchParams.get('mode') === 'simple') url.searchParams.set('layout', 'simple');
  url.searchParams.set('mode', mode.id);
  url.searchParams.delete('chip');
  url.searchParams.delete('engine');
  return url;
}

export function createModeSynthOptions(mode, base = new URL('../js/', import.meta.url)) {
  const generated = new URL('generated/', new URL('../', base));
  if (mode.chip === 'ps1') return {chip:'ps1',
    workletUrl:new URL('./playground_ps1_worklet.js?v=ps1-pcm-waveform-1',base).href,
    wasmUrl:new URL('ps1_spu_wasm.wasm',generated).href,
    segaPsgWasmUrl:null,megaCD:false,mega32X:false};
  if (mode.chip === 'pokey') return {
    chip:'pokey', clock:mode.clock, dualPokey:mode.dualPokey === true,
    workletUrl:new URL('./playground_pokey_worklet.js?v=ps1-mode-1',base).href,
    wasmUrl:new URL('pokey_wasm.wasm',generated).href,
    segaPsgWasmUrl:null, megaCD:false, mega32X:false,
  };
  if (mode.engine === 'msx') return {
    chip:mode.chip,clock:mode.clock,segaPsgWasmUrl:null,megaCD:false,mega32X:false,
    ayOptions:{workletUrl:new URL('./playground_ay8910_worklet.js?v=ps1-mode-1',base).href,wasmUrl:new URL('ay8910_wasm.wasm',generated).href},
    opllOptions:{workletUrl:new URL('./playground_ym2413_worklet.js?v=ps1-mode-1',base).href,wasmUrl:new URL('ym2413_wasm.wasm',generated).href},
    ...(mode.chip === 'msx-audio' ? {oplOptions:{workletUrl:new URL('./playground_opl_worklet.js?v=ps1-mode-1',base).href,wasmUrl:new URL('y8950_wasm.wasm',generated).href}} : {}),
  };
  if (mode.engine === 'opl') return {
    chip:mode.chip, clock:mode.clock,
    workletUrl:new URL('./playground_opl_worklet.js?v=ps1-mode-1', base).href,
    wasmUrl:new URL(`${mode.chip}_wasm.wasm`, generated).href,
    segaPsgWasmUrl:null, megaCD:false, mega32X:false,
  };
  if (mode.chip === 'dx7') return {
    chip:'dx7', segaPsgWasmUrl:null, megaCD:false, mega32X:false,
  };
  if (mode.chip === 'ay8910') return {
    chip:mode.chip, clock:mode.clock, type:0x10, flags:1,
    workletUrl:new URL('./playground_ay8910_worklet.js?v=ps1-mode-1',base).href,
    wasmUrl:new URL('ay8910_wasm.wasm',generated).href,
    segaPsgWasmUrl:null, megaCD:false, mega32X:false,
  };
  if (mode.chip === 'segapsg') return {
    chip:mode.chip, clock:mode.clock, stereoEnabled:mode.stereoEnabled,
    ym2413:mode.ym2413 === true,
    ...(mode.ym2413 ? {opllOptions:{
      workletUrl:new URL('./playground_ym2413_worklet.js?v=ps1-mode-1',base).href,
      wasmUrl:new URL('ym2413_wasm.wasm',generated).href,
    }} : {}),
    workletUrl:new URL('./playground_segapsg_worklet.js?v=ps1-mode-1', base).href,
    wasmUrl:new URL('segapsg_wasm.wasm?v=audio-numeric-bindings-1', generated).href,
    segaPsgWasmUrl:null, megaCD:false, mega32X:false,
  };
  if (['nes','snes','x68000','huc6280','wonderswan'].includes(mode.chip)) {
    // Keep complete relative filenames so the website versioner can invalidate
    // each processor together with the modules it imports.
    const worklet = {wonderswan:'./playground_wonderswan_worklet.js?v=ps1-mode-1',nes:'./playground_nes_worklet.js?v=ps1-mode-1',snes:'./playground_snes_worklet.js?v=ps1-mode-1',x68000:'./playground_ym2151_worklet.js?v=ps1-mode-1',huc6280:'./playground_huc6280_worklet.js?v=ps1-mode-1'}[mode.chip];
    const wasm = {wonderswan:'wonderswan',snes:'spc',x68000:'ym2151',huc6280:'huc6280'}[mode.chip];
    return {chip:mode.chip,clock:mode.clock,fds:mode.chip === 'nes',
      workletUrl:new URL(worklet,base).href,
      ...(wasm?{wasmUrl:new URL(`${wasm}_wasm.wasm`,generated).href}:{}),
      ...(mode.chip === 'x68000'?{extraOki:{workletUrl:new URL('./playground_okim6258_worklet.js?v=ps1-mode-1',base).href,wasmUrl:new URL('okim6258_wasm.wasm',generated).href}}:{}),
      segaPsgWasmUrl:null,megaCD:false,mega32X:false};
  }
  if (mode.chip === 'gameboy') return {
    chip:mode.chip,
    workletUrl:new URL('./playground_gameboy_worklet.js?v=ps1-mode-1', base).href,
    wasmUrl:new URL('gameboy_apu_wasm.wasm', generated).href,
    segaPsgWasmUrl:null,
    megaCD:false,
    mega32X:false,
  };
  const nuked = mode.engine === 'nuked';
  const chip = mode.chip === 'ym2610' ? 'ym2610b' : mode.chip;
  const wasm = nuked ? 'nuked_opn2' : chip;
  const worklets = {ym2612:'./ym2612-worklet.js?v=ps1-mode-1',ym2203:'./ym2203-worklet.js?v=ps1-mode-1',ym2608:'./ym2608-worklet.js?v=ps1-mode-1',ym2610b:'./ym2610b-worklet.js?v=ps1-mode-1'};
  return {
    chip:mode.chip,
    workletUrl:new URL(nuked ? './ym2612-worklet-nuked.js?v=ps1-mode-1' : worklets[chip], base).href,
    ym2612WasmUrl:new URL(`${wasm}_wasm.wasm`, generated).href,
    wasmUrl:mode.chip === 'ym2612' ? undefined : new URL(`${chip}_wasm.wasm`, generated).href,
    segaPsgWasmUrl:mode.chip === 'ym2612' ? new URL('segapsg_wasm.wasm?v=audio-numeric-bindings-1', generated).href : null,
    megaCD:mode.megaCD ?? mode.full,
    mega32X:mode.mega32X ?? mode.full,
  };
}

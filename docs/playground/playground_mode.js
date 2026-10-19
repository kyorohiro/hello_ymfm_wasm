import {CHIP_CLOCKS} from '../js/playground_chip_clock.js?v=native-modes-1';

// Modes describe an authoring environment. Chip IDs remain the runtime/API IDs.
const definitions = [
  {id:'genesis', label:'Genesis', chip:'ym2612'},
  {id:'genesis-full', label:'Genesis Full', chip:'ym2612', full:true},
  {id:'genesis-full-nuked', label:'Genesis Full (Nuked)', chip:'ym2612', full:true, engine:'nuked'},
  {id:'pc98-26', label:'PC-98 (YM2203 / OPN)', chip:'ym2203'},
  {id:'pc98', label:'PC-98 (YM2608 / OPNA)', chip:'ym2608'},
  {id:'neogeo', label:'Neo Geo', chip:'ym2610'},
  {id:'neogeo-b', label:'Neo Geo (YM2610B)', chip:'ym2610b'},
  {id:'gameboy', label:'Game Boy', chip:'gameboy', engine:'apu', fmChannels:0},
  {id:'nes', label:'NES + FDS', chip:'nes', engine:'apu', fmChannels:0},
  {id:'snes', label:'SNES', chip:'snes', engine:'dsp', fmChannels:0, details:'S-DSP · 32,000 Hz · 8 voices'},
  {id:'x68000', label:'X68000', chip:'x68000', engine:'opm-adpcm', fmChannels:0, details:'YM2151 · 4 MHz + OKIM6258 · 8 MHz'},
  {id:'pc-engine', label:'PC Engine', chip:'huc6280', engine:'psg', fmChannels:0},
  // Preserve old engine/chip links without adding another standard environment.
  {id:'genesis-nuked', label:'Genesis (Nuked)', chip:'ym2612', engine:'nuked', legacy:true},
];
const modes = new Map(definitions.map(definition => {
  const mode = Object.freeze({engine:'ymfm', full:false, ...definition,
    clock:CHIP_CLOCKS[definition.chip],
    declarationChip:definition.chip,
    legacyDraftKey:definition.chip + (definition.engine === 'nuked' ? ':nuked' : ''),
    chipTabs:Object.freeze(definition.chip === 'ym2612'
      ? ['operator', 'segapsg', ...(definition.full ? ['rf5c164', 'pwm'] : [])]
      : definition.fmChannels === 0 ? [] : ['operator']),
  });
  return [mode.id, mode];
}));
export const PLAYGROUND_MODES = Object.freeze([...modes.values()].filter(mode => !mode.legacy));

export function getPlaygroundMode(id) {
  const mode = modes.get(String(id).toLowerCase());
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
    nes:'nes',snes:'snes',x68000:'x68000',huc6280:'pc-engine'};
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
  if (['nes','snes','x68000','huc6280'].includes(mode.chip)) {
    const worklet = {nes:'playground_nes_worklet',snes:'playground_snes_worklet',x68000:'playground_ym2151_worklet',huc6280:'playground_huc6280_worklet'}[mode.chip];
    const wasm = {snes:'spc',x68000:'ym2151',huc6280:'huc6280'}[mode.chip];
    return {chip:mode.chip,clock:mode.clock,fds:mode.chip === 'nes',
      workletUrl:new URL(`${worklet}.js?v=native-modes-1`,base).href,
      ...(wasm?{wasmUrl:new URL(`${wasm}_wasm.wasm`,generated).href}:{}),
      ...(mode.chip === 'x68000'?{extraOki:{workletUrl:new URL('playground_okim6258_worklet.js?v=native-modes-1',base).href,wasmUrl:new URL('okim6258_wasm.wasm',generated).href}}:{}),
      segaPsgWasmUrl:null,megaCD:false,mega32X:false};
  }
  if (mode.chip === 'gameboy') return {
    chip:mode.chip,
    workletUrl:new URL('playground_gameboy_worklet.js?v=gameboy-mode-1', base).href,
    wasmUrl:new URL('gameboy_apu_wasm.wasm', generated).href,
    segaPsgWasmUrl:null,
    megaCD:false,
    mega32X:false,
  };
  const nuked = mode.engine === 'nuked';
  const chip = mode.chip === 'ym2610' ? 'ym2610b' : mode.chip;
  const wasm = nuked ? 'nuked_opn2' : chip;
  const workletVersion = mode.chip === 'ym2203' ? 'opn-ssg-1'
    : ['ym2610','ym2610b'].includes(mode.chip) ? 'opnb-primary-1'
    : mode.chip === 'ym2608' ? 'opna-primary-1' : 'chip-tabs-2';
  return {
    chip:mode.chip,
    workletUrl:new URL(nuked ? 'ym2612-worklet-nuked.js?v=chip-tabs-2' : `${chip}-worklet.js?v=${workletVersion}`, base).href,
    ym2612WasmUrl:new URL(`${wasm}_wasm.wasm`, generated).href,
    wasmUrl:mode.chip === 'ym2612' ? undefined : new URL(`${chip}_wasm.wasm`, generated).href,
    segaPsgWasmUrl:mode.chip === 'ym2612' ? new URL('segapsg_wasm.wasm', generated).href : null,
    megaCD:mode.full,
    mega32X:mode.full,
  };
}

import { readFile } from 'node:fs/promises';
import { analyzeSource, renderVgmToWav } from '../docs/vgm_analyzer/analyzer_core.js';
import { VgmPlayer } from '../docs/js/vgmplayer.js';
import { GenesisAudioEngine } from '../docs/js/genesisaudioengine.js';
import { Ym2413AudioEngine } from '../docs/js/ym2413audioengine.js';
import { Ym2151AudioEngine } from '../docs/js/ym2151audioengine.js';
import { Ymf262AudioEngine } from '../docs/js/ymf262audioengine.js';
import { Ym3526AudioEngine } from '../docs/js/ym3526audioengine.js';
import { Ym3812AudioEngine } from '../docs/js/ym3812audioengine.js';
import { Ay8910AudioEngine } from '../docs/js/ay8910audioengine.js';
import { GameboyApuAudioEngine } from '../docs/js/gameboyapuaudioengine.js';
import rf5c164 from '../docs/generated/rf5c164_wasm.js';
import ym2612 from '../docs/generated/ym2612_wasm.js';
import segapsg from '../docs/generated/segapsg_wasm.js';
import ym2413 from '../docs/generated/ym2413_wasm.js';
import ym2151 from '../docs/generated/ym2151_wasm.js';
import ymf262 from '../docs/generated/ymf262_wasm.js';
import ym3526 from '../docs/generated/ym3526_wasm.js';
import ym3812 from '../docs/generated/ym3812_wasm.js';
import ay8910 from '../docs/generated/ay8910_wasm.js';
import gameboy from '../docs/generated/gameboy_apu_wasm.js';

const engines = {
  ym2612: GenesisAudioEngine, ym2413: Ym2413AudioEngine, ym2151: Ym2151AudioEngine,
  ymf262: Ymf262AudioEngine, ym3526: Ym3526AudioEngine, ym3812: Ym3812AudioEngine,
  ay8910: Ay8910AudioEngine, gameBoyDmg: GameboyApuAudioEngine,
};
const factories = { rf5c164, ym2612, segapsg, ym2413, ym2151, ymf262, ym3526, ym3812, ay8910, gameboy_apu: gameboy };
async function factory(name) {
  const wasmBinary = await readFile(new URL(`../docs/generated/${name}_wasm.wasm`, import.meta.url));
  return options => factories[name]({ ...options, wasmBinary });
}

/** Node adapter: explicit engines only; never silently omit an unhandled chip. */
export async function renderSource(source, { maxSeconds = 120 } = {}) {
  if (!Number.isFinite(maxSeconds) || maxSeconds <= 0 || maxSeconds > 600) throw new RangeError('maxSeconds must be > 0 and <= 600');
  const { chips, header } = analyzeSource(source);
  const genesisPcm = chips.some(c => c.id === 'ym2612') && chips.some(c => c.id === 'rf5c164');
  const primary = chips.filter(c => c.id !== 'psg' && !(genesisPcm && c.id === 'rf5c164'));
  const kind = primary[0]?.id ?? (chips.length ? 'ym2612' : null);
  if (primary.length > 1 || !engines[kind] || chips.some(c => c.rawClock & 0xc0000000) ||
      (['ay8910','gameBoyDmg'].includes(kind) && chips.length !== 1))
    throw new Error('This chip combination is not supported by CLI render; use analyze/export or the browser player.');
  const options = { psgClock: header.psgClock & 0x3fffffff };
  if (kind === 'ay8910' || kind === 'gameBoyDmg') {
    options.moduleFactory = await factory(kind === 'ay8910' ? kind : 'gameboy_apu');
    options.clock = primary[0].clockHz;
    if (kind === 'ay8910') { options.type = header.ay8910Type; options.flags = header.ay8910Flags; }
  } else {
    options[`${kind}ModuleFactory`] = await factory(kind);
    if (primary.length) options[`${kind}Clock`] = primary[0].clockHz;
    if (options.psgClock || kind === 'ym2612') options.segaPsgModuleFactory = await factory('segapsg');
    if (genesisPcm) {
      options.rf5c164ModuleFactory = await factory('rf5c164');
      options.rf5c164Clock = header.rf5c164Clock & 0x3fffffff;
    }
  }
  const engine = await engines[kind].create(options);
  try {
    const player = new VgmPlayer(engine);
    const warnings = [];
    player.load(source, { logger: { warn: message => warnings.push(String(message)) } }); player.play();
    const result = await renderVgmToWav(player, { maxSeconds });
    return { ...result, warnings };
  } finally { engine.dispose(); }
}

import { readFile } from 'node:fs/promises';
import { renderVgmToWav } from '../docs/vgm_analyzer/analyzer_core.js';
import { Ym2612VGM } from '../docs/js/ym2612vgm.js';
import { createPlaybackEngine, createPlaybackPlayer } from '../docs/vgm_analyzer/playback_core.js';
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

const factories = { rf5c164, ym2612, segapsg, ym2413, ym2151, ymf262, ym3526, ym3812, ay8910, gameboy_apu: gameboy };
export async function getNodePlaybackFactory(name) {
  if (!factories[name]) return undefined;
  const wasmBinary = await readFile(new URL(`../docs/generated/${name}_wasm.wasm`, import.meta.url));
  return options => factories[name]({ ...options, wasmBinary });
}

/** Node adapter: explicit engines only; never silently omit an unhandled chip. */
export async function renderSource(source, { maxSeconds = 120 } = {}) {
  if (!Number.isFinite(maxSeconds) || maxSeconds <= 0 || maxSeconds > 600) throw new RangeError('maxSeconds must be > 0 and <= 600');
  const engine = await createPlaybackEngine(new Ym2612VGM(source), {getFactory:getNodePlaybackFactory});
  try {
    const warnings = [];
    const player = createPlaybackPlayer(engine, source, {onWarning:message=>warnings.push(String(message))});
    player.play();
    const result = await renderVgmToWav(player, { maxSeconds });
    return { ...result, warnings };
  } finally { engine.dispose(); }
}

/**
 * @file tetorica_synth.js
 * 実行環境: Browser（音声初期化・再生時）
 * 依存: 各チップのブラウザー向け RuntimeSynth。名前の正規化・import と音声初期化は別。
 * start() による実再生には Web Audio と WASM アセットが必要。
 */
import { GameboyRuntimeSynth } from "./gameboy_runtime_synth.js?v=native-extra-okim6258-1";
import { NativeRuntimeSynth } from "./native_runtime_synth.js?v=native-extra-okim6258-1";
import { MegaSynth } from "./megasynth.js?v=native-extra-okim6258-1";
import { YM2203RuntimeSynth } from "./ym2203synth.js?v=native-extra-okim6258-1";
import { YM2608RuntimeSynth } from "./ym2608synth.js?v=native-extra-okim6258-1";
import { NeoGeoSynth, YM2610BRuntimeSynth } from "./ym2610bsynth.js?v=native-extra-okim6258-1";

export const TETORICA_CHIPS = Object.freeze(["ym2612", "ym2203", "ym2608", "ym2610", "ym2610b", "gameboy", "nes", "snes", "x68000", "huc6280", "segapsg", "dx7", "ym3526", "ym3812", "y8950", "ymf262", "ym2413", "ay8910", "msx", "msx-audio"]);

/**
 * Normalize a supported chip name to lowercase.
 * @param {string} [chip="ym2612"] Chip identifier.
 * @returns {string} Supported lowercase identifier.
 * @throws {Error} For unsupported identifiers.
 */
export function normalizeTetoricaChip(chip) {
  const normalized = String(chip ?? "ym2612").toLowerCase();
  if (!TETORICA_CHIPS.includes(normalized)) {
    throw new Error(`Unsupported Tetorica chip: ${chip}`);
  }
  return normalized;
}

/**
 * Construct the runtime synth for the selected chip. Call start() to initialize audio.
 * @param {import("./megasynth.js?v=native-extra-okim6258-1").MegaSynthOptions & import("./opn_runtime_synth.js?v=native-extra-okim6258-1").OPNRuntimeSynthOptions & Omit<import("./native_runtime_synth.js?v=native-extra-okim6258-1").NativeRuntimeSynthOptions, 'chip'> & {chip?:string}} [options={}] Forwarded to the selected synth constructor.
 * @param {string} [options.chip="ym2612"] One of TETORICA_CHIPS.
 * @returns {MegaSynth|YM2203RuntimeSynth|YM2608RuntimeSynth|NeoGeoSynth|YM2610BRuntimeSynth|GameboyRuntimeSynth|NativeRuntimeSynth}
 *   Unstarted runtime; construction alone does not load WASM or open an audio device.
 */
export function createTetoricaSynth(options = {}) {
  const chip = normalizeTetoricaChip(options.chip);
  if (chip === "ym2612") {
    const synth = new MegaSynth(options);
    synth.chip = chip;
    synth.capabilities = Object.freeze({
      chip,
      fmChannels: 6,
      psg: Boolean(synth.segaPsgWasmUrl),
      dac: true,
      pcm: synth.megaCD,
      pcmChannels: synth.megaCD ? 8 : 0,
      recorder: true,
    });
    return synth;
  }
  if (chip === "gameboy") return new GameboyRuntimeSynth(options);
  if (["nes", "snes", "x68000", "huc6280", "segapsg", "dx7", "ym3526", "ym3812", "y8950", "ymf262", "ym2413", "ay8910", "msx", "msx-audio"].includes(chip)) return new NativeRuntimeSynth({...options, chip});
  if (chip === "ym2203") return new YM2203RuntimeSynth(options);
  if (chip === "ym2608") return new YM2608RuntimeSynth(options);
  if (chip === "ym2610") return new NeoGeoSynth(options);
  return new YM2610BRuntimeSynth(options);
}

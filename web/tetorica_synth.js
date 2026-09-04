import { MegaSynth } from "./megasynth.js";
import { YM2203RuntimeSynth } from "./ym2203synth.js";
import { YM2608RuntimeSynth } from "./ym2608synth.js";
import { NeoGeoSynth, YM2610BRuntimeSynth } from "./ym2610bsynth.js";

export const TETORICA_CHIPS = Object.freeze(["ym2612", "ym2203", "ym2608", "ym2610", "ym2610b"]);

export function normalizeTetoricaChip(chip) {
  const normalized = String(chip ?? "ym2612").toLowerCase();
  if (!TETORICA_CHIPS.includes(normalized)) {
    throw new Error(`Unsupported Tetorica chip: ${chip}`);
  }
  return normalized;
}

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
      recorder: true,
    });
    return synth;
  }
  if (chip === "ym2203") return new YM2203RuntimeSynth(options);
  if (chip === "ym2608") return new YM2608RuntimeSynth(options);
  if (chip === "ym2610") return new NeoGeoSynth(options);
  return new YM2610BRuntimeSynth(options);
}

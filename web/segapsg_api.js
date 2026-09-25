/** @file Browser / Worker / Node.js: compatibility facade for the PSG Synth API. */
import { SegaPSGSynth } from './segapsgsynth.js';
export { psgPeriodFromFrequency, psgPeriodFromNote } from './segapsgsynth.js';
/** Existing Playground callers keep bound methods and their injected transport. */
export function createSegaPsgApi(transport) {
  const synth = new SegaPSGSynth({ transport });
  return Object.fromEntries(['write', 'reset', 'resetAll', 'tone', 'off', 'noise', 'noiseVolume', 'noiseOff']
    .map(name => [name, synth[name].bind(synth)]));
}

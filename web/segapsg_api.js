/** @file Browser / Worker / Node.js: compatibility facade for the PSG Synth API. */
import { SegaPSGSynth } from './segapsgsynth.js';
export { psgPeriodFromFrequency, psgPeriodFromNote } from './segapsgsynth.js';
/** Existing Playground callers keep bound methods and their injected transport. */
/** @param {{write: (value: number) => void, reset?: () => void, resetAll?: () => void}} transport Ordered register sender.
 * @returns Bound SegaPSGSynth tone/noise, attenuation and reset methods. */
export function createSegaPsgApi(transport) {
  const synth = new SegaPSGSynth({ transport });
  return Object.fromEntries(['setPeriod', 'setAttenuation', 'setNoise', 'write', 'reset', 'resetAll', 'tone', 'off', 'noise', 'noiseVolume', 'noiseOff']
    .map(name => [name, synth[name].bind(synth)]));
}

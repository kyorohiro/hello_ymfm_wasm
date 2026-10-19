/** @file Browser / Worker / Node.js: compatibility facade for the PSG Synth API. */
import { SegaPSGSynth } from './segapsgsynth.js?v=sega-modes-1';
export { psgPeriodFromFrequency, psgPeriodFromNote } from './segapsgsynth.js?v=sega-modes-1';
/** Existing Playground callers keep bound methods and their injected transport. */
/** @param {{clock?:number, write: (value: number) => void, setStereo?:(mask:number)=>void, reset?: () => void, resetAll?: () => void}} transport Ordered register sender.
 * @returns Bound SegaPSGSynth tone/noise, attenuation and reset methods. */
export function createSegaPsgApi(transport) {
  const synth = new SegaPSGSynth({ transport });
  return Object.fromEntries(['setFrequency', 'setNote', 'keyOn', 'keyOff', 'noteOn', 'setPeriod', 'setAttenuation', 'setNoise', 'write', 'reset', 'resetAll', 'tone', 'off', 'noise', 'noiseVolume', 'noiseOff', 'allNotesOff', '_forceKeyOff', '_getState', '_adoptState', ...(typeof transport.setStereo === 'function' ? ['setStereo'] : [])]
    .map(name => [name, synth[name].bind(synth)]));
}

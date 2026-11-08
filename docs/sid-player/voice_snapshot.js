// SPDX-License-Identifier: BSD-3-Clause
// Passive conversion only. Read a current AudioWorklet state before calling;
// this module never reads a device, clocks a chip or modifies the playing tune.
import {createDefaultPreset, filterModeFromBits, readPreset} from '../synth-sid/preset.js';

export const SNAPSHOT_NOTICE = 'Instantaneous register settings only. Playing a Synth key restarts Gate and the hardware envelope at keyboard pitch. The tune\'s original notes, elapsed Envelope, oscillator phase, filter history and song automation are not copied.';

const PAL_CLOCK = 985248;
const waves = new Map([[0x10, 'triangle'], [0x20, 'saw'], [0x40, 'pulse'], [0x80, 'noise']]);
const integer = (value, min, max, label) => {
  if (!Number.isInteger(value) || value < min || value > max) throw new RangeError(`${label} must be an integer ${min}..${max}`);
  return value;
};
function presetName(name, subtune, voice) {
  const clean = name.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim() || 'SID snapshot';
  const suffix = ` · Song ${subtune} · Voice ${voice + 1}`;
  let prefix = '';
  // The preset limit counts UTF-16 code units; do not cut a surrogate pair.
  for (const character of clean) {
    if (prefix.length + character.length + suffix.length > 80) break;
    prefix += character;
  }
  return prefix.trimEnd() + suffix;
}

/** Convert one applied, coherent SID Player observation into three candidates.
 * Original carrier pitch, Gate state, current envelope level and internal
 * phase are not added to the portable preset. A supported independent
 * Sync/Ring pair retains only its source/carrier frequency-register ratio.
 * The keyboard Synth starts a fresh note with its fixed silent source pair.
 * Unsupported controls have an explicit unavailable row, never a substitute.
 *
 * @param {object} state Applied state from the accepted player's read command.
 * @param {{name?:string,subtune?:number}} [options] Descriptive metadata only.
 * @returns {{model:'6581'|'8580',positionFrames:number,sampleRate:number,voices:Array<{
 * voice:number,available:boolean,reason:string|null,warnings:string[],preset:import('../synth-sid/preset.js').SidPreset|null,
 * frequencyHz:number,gate:boolean,envelope:number|null,pair:null|{
 * sourceVoice:number,carrierVoice:number,sourceFrequencyRegister:number,
 * carrierFrequencyRegister:number,sourceFrequencyHz:number,ratio:number,sync:boolean,ring:boolean}}>}}
 */
export function captureSidVoices(state, {name = '', subtune = 1} = {}) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) throw new TypeError('SID snapshot requires an applied player state');
  if (!['6581', '8580'].includes(state.model)) throw new RangeError('SID snapshot model must be 6581 or 8580');
  if (state.clockHz !== PAL_CLOCK) throw new RangeError('SID snapshot requires PAL 985248 Hz');
  const positionFrames = integer(state.positionFrames, 0, Number.MAX_SAFE_INTEGER, 'SID snapshot position');
  const sampleRate = integer(state.sampleRate, 8000, 96000, 'SID snapshot sample rate');
  if (typeof name !== 'string') throw new TypeError('SID snapshot name must be a string');
  integer(subtune, 1, 65535, 'SID snapshot subtune');
  const input = state.registers;
  if (!(Array.isArray(input) || ArrayBuffer.isView(input) && input.BYTES_PER_ELEMENT === 1) || input.length !== 32)
    throw new TypeError('SID snapshot requires exactly 32 register bytes');
  const registers = Array.from(input, value => integer(value, 0, 255, 'SID snapshot register'));
  const model = state.model, modeMask = (registers[24] >> 4) & 7;
  const filter = {mode: filterModeFromBits(modeMask), cutoff: (registers[22] << 3) | (registers[21] & 7),
    resonance: registers[23] >> 4, volume: registers[24] & 15};
  const voices = Array.from({length: 3}, (_, voice) => {
    const base = voice * 7, control = registers[base + 4], wave = control & 0xf0;
    const gate = Boolean(control & 1), routed = Boolean(registers[23] & (1 << voice));
    const observedEnvelope = state.voices?.[voice]?.envelope;
    const envelope = Number.isInteger(observedEnvelope) && observedEnvelope >= 0 && observedEnvelope <= 255 ? observedEnvelope : null;
    const frequency = registers[base] | registers[base + 1] << 8;
    const sync = Boolean(control & 2), ring = Boolean(control & 4), paired = sync || ring;
    const sourceVoice = (voice + 2) % 3, thirdVoice = (voice + 1) % 3;
    const sourceBase = sourceVoice * 7, sourceControl = registers[sourceBase + 4];
    const sourceFrequency = registers[sourceBase] | registers[sourceBase + 1] << 8;
    const row = {voice, available: false, reason: null, warnings: [], preset: null, pair: null,
      frequencyHz: frequency * PAL_CLOCK / 16777216, gate, envelope};
    if (paired && frequency > 0 && sourceFrequency > 0) {
      row.pair = {sourceVoice, carrierVoice: voice, sourceFrequencyRegister: sourceFrequency,
        carrierFrequencyRegister: frequency, sourceFrequencyHz: sourceFrequency * PAL_CLOCK / 16777216,
        ratio: sourceFrequency / frequency, sync, ring};
    }

    if (!waves.has(wave)) row.reason = wave ? 'Combined waveforms are not supported by this Synth snapshot import.' : 'No oscillator waveform is selected.';
    else if (control & 8) row.reason = 'Oscillator TEST is held; its stopped oscillator cannot be auditioned as a normal voice.';
    else if (routed && modeMask === 0) row.reason = 'This voice is routed into a filter with no enabled outputs. The Synth bypass would change that silent routing.';
    else if (voice === 2 && !routed && registers[24] & 0x80) row.reason = 'Voice 3 dry output is disabled by the hardware Voice 3 off control.';
    if (!row.reason && paired) {
      // Both cores wire source (carrier+2)%3 into Sync and Triangle Ring.
      // Source waveform/Gate/ADSR do not control its oscillator accumulator.
      // Be conservative about any additional modulation flags: an interacting
      // three-voice dependency is outside the Synth's independent fixed pair.
      if (sourceControl & 6 || registers[thirdVoice * 7 + 4] & 6) row.reason = 'Sync / Ring has an additional three-voice dependency. Only an independent carrier/source pair can be imported.';
      else if (sourceControl & 8) row.reason = 'The Sync / Ring source holds TEST, so its stopped oscillator cannot supply a running Synth modulator.';
      else if (frequency === 0 || sourceFrequency === 0) row.reason = 'Sync / Ring pair capture requires nonzero carrier and source frequency registers.';
      else if (row.pair.ratio < .125 || row.pair.ratio > 8) row.reason = 'Sync / Ring source/carrier ratio is outside the Synth range 0.125 to 8.';
    }
    if (row.reason) return row;

    const preset = createDefaultPreset({model});
    preset.name = presetName(name, subtune, voice);
    preset.voice = {waveform: waves.get(wave), pulseWidth: registers[base + 2] | (registers[base + 3] & 15) << 8,
      attack: registers[base + 5] >> 4, decay: registers[base + 5] & 15,
      sustain: registers[base + 6] >> 4, release: registers[base + 6] & 15, test: false};
    if (paired) preset.modulation = {sync, ring, ratio: row.pair.ratio};
    // The selected voice's routing decides whether this instrument is filtered.
    // Other song voices and external input are not part of a keyboard preset.
    preset.filter = {enabled: routed, ...filter};
    row.preset = readPreset(preset);
    row.available = true;
    if (!gate) row.warnings.push('Gate is off in this snapshot. Playing a key starts a new hardware envelope.');
    if (envelope === null) row.warnings.push('Live Envelope is unavailable; the ADSR register codes are captured.');
    if (frequency === 0) row.warnings.push('The captured frequency is zero. Synth tuning follows the keyboard.');
    if (filter.volume === 0) row.warnings.push('Chip volume is zero; raise Chip volume in the Synth to hear this preset.');
    if (paired) {
      row.warnings.push(`Captured connection: Voice ${sourceVoice + 1} → Voice ${voice + 1}. The Synth remaps it to Voice 3 → Voice 1 and uses one keyboard note.`);
      row.warnings.push('The Synth uses a silent Triangle source. Its original waveform, Gate/ADSR and any audible source contribution are not copied.');
      if (ring && wave !== 0x10) row.warnings.push('Ring affects Triangle only. The captured Ring flag is retained for this other carrier waveform.');
    }
    return row;
  });
  return {model, positionFrames, sampleRate, voices};
}

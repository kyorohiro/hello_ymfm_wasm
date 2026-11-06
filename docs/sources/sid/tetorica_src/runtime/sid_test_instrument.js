/** Self-authored test instrument for SID validation, not a SID song driver.
 * Voice allocation, test notes and output gain are software controls.
 */
import {sidFrequency, SID_PAL_CLOCK} from './sid.js';

export const defaultSidSettings = Object.freeze({waveform: 'saw', pulseWidth: 2048,
  attack: 2, decay: 6, sustain: 12, release: 5, filterMode: 'off', cutoff: 1200,
  resonance: 4, sync: false, ring: false, modulatorHz: 110, master: 0.6, clockHz: SID_PAL_CLOCK});
const waves = {triangle: 0x10, saw: 0x20, pulse: 0x40, noise: 0x80};
const filters = {off: 0, lowpass: 0x10, bandpass: 0x20, highpass: 0x40, notch: 0x50};
export function validateSidSettings(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('SID settings must be an object');
  const settings = {...defaultSidSettings, ...input};
  for (const key of Object.keys(input)) if (!Object.hasOwn(defaultSidSettings, key)) throw new TypeError(`Unknown SID setting: ${key}`);
  if (!Object.hasOwn(waves, settings.waveform)) throw new RangeError('Unsupported SID waveform');
  if (!Object.hasOwn(filters, settings.filterMode)) throw new RangeError('Unsupported SID filter mode');
  for (const [key, max] of [['pulseWidth', 4095], ['attack', 15], ['decay', 15], ['sustain', 15], ['release', 15], ['cutoff', 2047], ['resonance', 15]]) {
    if (!Number.isInteger(settings[key]) || settings[key] < 0 || settings[key] > max) throw new RangeError(`${key} must be an integer 0..${max}`);
  }
  for (const key of ['sync', 'ring']) if (typeof settings[key] !== 'boolean') throw new TypeError(`${key} must be boolean`);
  if (!Number.isFinite(settings.master) || settings.master < 0 || settings.master > 1) throw new RangeError('master must be 0..1');
  if (!Number.isFinite(settings.modulatorHz) || settings.modulatorHz < 1 || settings.modulatorHz > 2000) throw new RangeError('modulatorHz must be 1..2000');
  if (![985248, 1022727].includes(settings.clockHz)) throw new RangeError('Choose PAL or NTSC SID clock');
  return settings;
}

export class SidTestInstrument {
  constructor(core, settings = defaultSidSettings) {
    this.core = core; this.settings = validateSidSettings(settings); this.notes = []; this.held = false;
    if (this.settings.clockHz !== core.clockHz) throw new Error('SID settings and core clocks differ');
    this.apply();
  }
  setSettings(settings) {
    const next = validateSidSettings({...this.settings, ...settings});
    if (next.clockHz !== this.core.clockHz) throw new Error('Create a new SID core to change its clock');
    const changedTopology = next.sync !== this.settings.sync || next.ring !== this.settings.ring;
    if (changedTopology) {
      this.core.reset();
      // A lone carrier retriggers with the new topology. A triad must stop
      // before reserving its third oscillator as a silent source.
      if (this.notes.length > 1) { this.notes = []; this.held = false; }
    }
    this.settings = next; this.apply();
  }
  apply() {
    const s = this.settings, paired = s.sync || s.ring;
    for (let voice = 0; voice < 3; voice++) {
      const base = voice * 7;
      const hz = paired && voice === 2 ? s.modulatorHz : this.notes[voice] ?? 0;
      const frequency = sidFrequency(hz, this.core.clockHz);
      this.core.writeRegister(base, frequency & 255); this.core.writeRegister(base + 1, frequency >> 8);
      this.core.writeRegister(base + 2, s.pulseWidth & 255); this.core.writeRegister(base + 3, s.pulseWidth >> 8);
      this.core.writeRegister(base + 5, s.attack << 4 | s.decay);
      this.core.writeRegister(base + 6, s.sustain << 4 | s.release);
      const gate = this.held && (this.notes[voice] !== undefined || paired && voice === 2);
      // Oscillator 3 runs as a silent triangle source; voice 1 is the carrier.
      const waveform = paired && voice === 2 ? waves.triangle : waves[s.waveform];
      this.core.writeRegister(base + 4, waveform | (gate ? 1 : 0)
        | (voice === 0 && s.sync ? 2 : 0) | (voice === 0 && s.ring ? 4 : 0));
    }
    this.core.writeRegister(21, s.cutoff & 7); this.core.writeRegister(22, s.cutoff >> 3);
    this.core.writeRegister(23, s.resonance << 4 | (s.filterMode === 'off' ? 0 : paired ? 1 : 7));
    this.core.writeRegister(24, 15 | filters[s.filterMode] | (paired ? 0x80 : 0));
  }
  playTone(hz = 220) {
    const frequency = sidFrequency(hz, this.core.clockHz);
    if (!frequency) throw new RangeError('Test tone frequency must be greater than zero');
    this.core.reset(); this.notes = [hz]; this.held = true; this.apply();
  }
  playChord() {
    if (this.settings.sync || this.settings.ring) throw new Error('Sync / Ring use voice 3 as a modulator; turn them off before the triad');
    this.core.reset(); this.notes = [60, 64, 67].map(note => 440 * 2 ** ((note - 69) / 12));
    this.held = true; this.apply();
  }
  release() { this.held = false; this.apply(); }
  stop() { this.core.reset(); this.notes = []; this.held = false; }
  renderInto(output) {
    this.core.renderInto(output);
    const gain = this.settings.master;
    for (let i = 0; i < output.length; i++) output[i] *= gain;
    return output;
  }
}

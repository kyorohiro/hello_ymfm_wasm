// SPDX-License-Identifier: BSD-3-Clause
import {EVENT, Fm21290} from './fm21290.js';
import {createInstrument} from './fm21290_instrument.js';
import {ModulatedChip} from './fm21290_modulation.js';
import {presetToVoice, voiceToPreset} from './msfa_dx7/src/preset.js';
import {parseSysex} from './msfa_dx7/src/sysex.js';

// The DX7 bank and MIDI allocator drive the same registers exposed to scripts.
export class Fm21290Synth {
  constructor(sampleRate) {
    this.sampleRate = this.internalSampleRate = sampleRate;
    this.reset();
  }
  reset() {
    this.chip = new Fm21290(this.sampleRate);
    this.controller = new ModulatedChip(this.chip);
    this.instrument = createInstrument(
      (address, value) => this.chip.writeRegister(address, value),
      (ch, pitch) => this.controller.keyOn(ch, pitch),
      ch => this.controller.pitchEnvelope.keyOff(ch),
    );
  }
  loadSysex(bytes) {
    this.bank = parseSysex(bytes).voices.map(voice => voice.data.slice());
    this.selectVoice(0);
  }
  get voices() { return this.bank.map((bytes, index) => ({index, name:voiceToPreset(bytes).name})); }
  selectVoice(index) {
    this.selectedVoice = index;
    const preset = this.getPreset();
    this.instrument.setPatch(preset);
    this.controller.configure(preset.lfo);
    this.controller.pitchEnvelope.configure(preset.pitchEnvelope);
  }
  getPreset() { return voiceToPreset(this.bank[this.selectedVoice]); }
  update(patch, base) {
    this.bank[this.selectedVoice] = presetToVoice(patch, base);
    this.selectVoice(this.selectedVoice);
  }
  setPreset(preset) { this.update(preset); }
  setOperators(entries) { this.update({operators:Object.fromEntries(entries)}, this.bank[this.selectedVoice]); }
  setOperator(op, params) { this.setOperators([[op, params]]); }
  setFeedback(feedback) { this.update({feedback}, this.bank[this.selectedVoice]); }
  noteOn(note, velocity) { if (velocity === 0) this.noteOff(note);
    else this.instrument.noteOn(note, velocity); }
  noteOff(note) { this.instrument.releasePitch(note); }
  allNotesOff() { this.instrument.allNotesOff(); }
  panic() { this.reset(); this.selectVoice(this.selectedVoice); }
  dispose() { this.instrument.allNotesOff(); }
  writeRegister(address, value) {
    if (address === EVENT) {
      const slot = (value >> 2) & 15;
      if ((value & 3) === 1) this.controller.pitchEnvelope.voices[slot] = null;
      if ((value & 3) === 2) this.controller.pitchEnvelope.keyOff(slot);
      this.instrument.rawEvent(value);
    }
    else this.chip.writeRegister(address, value);
  }
  renderInto(buffer) { this.controller.renderInto(buffer); }
}

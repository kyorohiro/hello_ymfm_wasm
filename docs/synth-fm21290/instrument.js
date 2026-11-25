// SPDX-License-Identifier: BSD-3-Clause
import {MODE, ALGORITHM, PITCH, RATIO, DETUNE, SENS, RATE, LEVEL, OUTPUT, EVENT, integer} from './chip.js';

// PATCH_ACTIVATE_OPERATOR_EG_LEVEL shifts the ROM attenuation right one bit.
// From edit level 20 onward the original table follows 99 - level.
const lowEnvelopeAttenuations = [
  127, 122, 118, 114, 110, 107, 104, 102, 100, 98,
  96, 94, 92, 90, 88, 86, 85, 84, 82, 81,
];
function envelopeLevelByte(level) {
  return (lowEnvelopeAttenuations[level] ?? (99 - level)) >> 1;
}

// Public CH values follow Tetorica's zero-based Code constants. OP labels are 1..6.
export function createInstrument(write) {
  let preset, cursor = 0;
  const notes = Array(16).fill(null), velocities = Array(16).fill(100);
  function word(address, value) {
    const n = Math.max(0, Math.min(65535, Math.round(value)));
    write(address, n >> 8);
    write(address+1, n & 255);
  }
  function output(ch, op, note, velocity) {
    const p = preset.operators[op], scale = p.keyboardScaling;
    const distance = note - (scale.breakpoint + 21);
    const depth = distance < 0 ? scale.leftDepth : scale.rightDepth;
    const curve = distance < 0 ? scale.leftCurve : scale.rightCurve;
    const x = Math.min(1, Math.abs(distance) / 48);
    const change = depth * (curve === 1 || curve === 2 ? x*x : x) * (curve < 2 ? -1 : 1);
    const level = p.outputLevel + change - (127-velocity) * p.velocitySensitivity / 24;
    write(OUTPUT + (6-op)*16 + ch, level <= 0 ? 255 : Math.max(4, Math.round(4 + (99-Math.min(level,99))*2)));
  }
  function setPatch(value) {
    preset = value;
    write(MODE, preset.oscillatorSync ? 0x30 : 0x50);
    write(ALGORITHM, preset.algorithm*8 + preset.feedback);
    for (let op=1; op<=6; op++) {
      const p = preset.operators[op], slot = 6-op;
      const ratio = (p.coarse || 0.5) * (1+p.fine/100);
      const fixed = 10 ** ((p.coarse & 3)+p.fine/100);
      const pitch = p.mode === 'fixed' ? 0x16ac + 4096*Math.log2(fixed) : 0x232c + 4096*Math.log2(ratio);
      word(RATIO+slot*2, Math.round(pitch/4)*4 + Number(p.mode === 'fixed'));
      const detune=p.detune-7;
      write(DETUNE+slot, detune<0 ? 8-detune : detune);
      write(SENS+slot, p.ampModSensitivity*8+p.rateScaling);
      for (let stage=0; stage<4; stage++) {
        write(RATE+slot*4+stage, p.envelope.rates[stage]*164 >> 8);
        write(LEVEL+slot*4+stage, envelopeLevelByte(p.envelope.levels[stage]));
      }
      notes.forEach((note,ch) => { if (note !== null) output(ch, op, note, velocities[ch]); });
    }
  }
  function keyOff(ch) {
    integer(ch,0,15,'CH');
    write(EVENT,ch*4+2);
    notes[ch] = null;
  }
  function keyOn(ch,note,velocity=100) {
    integer(ch,0,15,'CH'); integer(note,0,127,'note'); integer(velocity,0,127,'velocity');
    if (!velocity) { keyOff(ch); return; }
    if (!preset) throw new Error('Select a patch first');
    keyOff(ch);
    notes[ch]=note; velocities[ch]=velocity;
    word(PITCH+ch*2, 0x5aa8 + (note-69+preset.transpose-24)*4096/12);
    for (let op=1; op<=6; op++) output(ch,op,note,velocity);
    write(EVENT,ch*4+1);
  }
  function noteOn(note,velocity=100) {
    integer(note,0,127,'note'); integer(velocity,0,127,'velocity');
    if (!velocity) { noteOff(note); return; }
    for (let i=0; i<16; i++) {
      const ch=(cursor+i)%16;
      if (notes[ch] !== null) continue;
      keyOn(ch,note,velocity); cursor=(ch+1)%16; return ch;
    }
  }
  function noteOff(note) {
    integer(note,0,127,'note');
    notes.forEach((n,ch) => { if (n===note) keyOff(ch); });
  }
  return {setPatch,keyOn,keyOff,noteOn,noteOff,allNotesOff(){notes.forEach((_,ch)=>keyOff(ch));}};
}

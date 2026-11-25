// SPDX-License-Identifier: BSD-3-Clause
import {MODE, ALGORITHM, PITCH, RATIO, DETUNE, SENS, RATE, LEVEL, OUTPUT, EVENT, integer} from './chip.js';

// PATCH_ACTIVATE_OPERATOR_EG_LEVEL shifts the ROM attenuation right one bit.
// From edit level 20 onward the original table follows 99 - level.
const lowLevelAttenuations = [
  127, 122, 118, 114, 110, 107, 104, 102, 100, 98,
  96, 94, 92, 90, 88, 86, 85, 84, 82, 81,
];
function logAttenuation(level) {
  return lowLevelAttenuations[level] ?? (99 - level);
}
// MIDI Note On maps velocity to a key travel time. The EGS loader uses
// the high five bits of that time to look up an operator attenuation.
const keyTravel = [
  110,100,90,85,80,75,70,65,58,54,50,46,42,38,34,30,
  28,26,24,22,20,18,16,14,12,10,8,6,4,2,1,0,
];
const velocityScale = [
  0,4,12,21,30,40,46,52,58,64,70,76,82,88,94,100,
  103,106,109,112,114,116,118,120,122,124,126,128,130,131,132,133,
];
function velocityAttenuation(velocity, sensitivity) {
  const scale = velocityScale[keyTravel[velocity >> 2] >> 2];
  return 15 - 2*sensitivity + ((scale*sensitivity) >> 3);
}

// v1.8 addresses the exponential, linear, and log attenuation tables
// consecutively. At the extremes the unchecked curve index crosses a table
// boundary (maximum distance 38). Retain the adjacent lookup values.
const linearStart = 36;
const keyCurveBytes = [
  0,1,2,3,4,5,6,7,8,9,11,14,16,19,23,28,33,39,
  47,57,67,80,95,113,134,160,190,224,255,255,255,255,255,255,255,255,
  0,8,16,24,32,40,48,56,64,72,80,88,96,104,112,120,128,136,
  144,152,160,168,178,184,192,200,208,216,224,232,240,248,255,255,255,255,
  ...lowLevelAttenuations,
];
function keyCode(note) {
  // High byte of TABLE_MIDI_KEY_TO_LOG_F for all 128 MIDI keys.
  return Math.max(0,Math.floor((note-1)*4/3));
}
function transposedKeyCode(note, transpose) {
  // VOICE_ADD performs the subtraction in an unsigned byte before clamping.
  return keyCode(Math.min(127,(note+transpose-24) & 255));
}
function scaledAttenuation(operator, code) {
  const scale = operator.keyboardScaling;
  // Curve slot zero stores the result for loop index one.
  const distance = (code >> 2) + 1 - (keyCode(scale.breakpoint+20) >> 2);
  const depth = distance > 0 ? scale.rightDepth : scale.leftDepth;
  const curve = distance > 0 ? scale.rightCurve : scale.leftCurve;
  const start = curve === 0 || curve === 3 ? linearStart : 0;
  const weight = keyCurveBytes[start + Math.abs(distance)];
  const scaledDepth = depth*660 >> 8;
  const adjustment = Math.min(127,(scaledDepth*weight) >> 8);
  const base = logAttenuation(operator.outputLevel);
  return Math.max(0,Math.min(127,curve < 2 ? base+adjustment : base-adjustment));
}

// Public CH values follow Tetorica's zero-based Code constants. OP labels are 1..6.
export function createInstrument(write, onKeyOn = () => {}, onKeyOff = () => {}) {
  let preset, cursor = 0, sustain = false;
  const pedalHeld = Array(16).fill(false);
  const notes = Array(16).fill(null), velocities = Array(16).fill(100);
  function word(address, value) {
    const n = Math.max(0, Math.min(65535, Math.round(value)));
    write(address, n >> 8);
    write(address+1, n & 255);
  }
  function output(ch, op, note, velocity) {
    const p = preset.operators[op];
    const attenuation = scaledAttenuation(p,transposedKeyCode(note,preset.transpose));
    const byte = attenuation*2 + velocityAttenuation(velocity,p.velocitySensitivity);
    write(OUTPUT + (6-op)*16 + ch, Math.max(4,Math.min(255,byte)));
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
        write(LEVEL+slot*4+stage, logAttenuation(p.envelope.levels[stage]) >> 1);
      }
      notes.forEach((note,ch) => { if (note !== null) output(ch, op, note, velocities[ch]); });
    }
  }
  function keyOff(ch) {
    integer(ch,0,15,'CH');
    write(EVENT,ch*4+2);
    onKeyOff(ch);
    notes[ch] = null;
    pedalHeld[ch] = false;
  }
  function keyOn(ch,note,velocity=100) {
    integer(ch,0,15,'CH'); integer(note,0,127,'note'); integer(velocity,0,127,'velocity');
    if (!velocity) { keyOff(ch); return; }
    if (!preset) throw new Error('Select a patch first');
    keyOff(ch);
    notes[ch]=note; velocities[ch]=velocity;
    const code = transposedKeyCode(note,preset.transpose);
    const basePitch = (code << 8) | ((code & 3) * 84);
    word(PITCH+ch*2, basePitch);
    for (let op=1; op<=6; op++) output(ch,op,note,velocity);
    onKeyOn(ch,basePitch);
    write(EVENT,ch*4+1);
  }
  function noteOn(note,velocity=100) {
    integer(note,0,127,'note'); integer(velocity,0,127,'velocity');
    if (!velocity) { noteOff(note); return; }
    for (let i=0; i<16; i++) {
      const ch=(cursor+i)%16;
      if (notes[ch] !== null && !pedalHeld[ch]) continue;
      keyOn(ch,note,velocity); cursor=(ch+1)%16; return ch;
    }
  }
  function noteOff(note) {
    integer(note,0,127,'note');
    const ch = notes.findIndex((n,i) => n===note && !pedalHeld[i]);
    if (ch < 0) return;
    if (sustain) pedalHeld[ch] = true;
    else keyOff(ch);
  }
  function setSustain(down) {
    sustain = down;
    if (!down) pedalHeld.forEach((held,ch) => { if (held) keyOff(ch); });
  }
  function allNotesOff() {
    sustain = false;
    notes.forEach((_,ch)=>keyOff(ch));
  }
  return {setPatch,keyOn,keyOff,noteOn,noteOff,setSustain,allNotesOff};
}

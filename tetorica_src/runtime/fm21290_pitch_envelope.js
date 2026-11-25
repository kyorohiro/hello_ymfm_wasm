// SPDX-License-Identifier: BSD-3-Clause
import {PITCH} from './fm21290.js';

const rateTable = [
  1, 2, 3, 3, 4, 4, 5, 5, 6, 6,
  7, 7, 8, 8, 9, 9, 10, 10, 11, 11,
  12, 12, 13, 13, 14, 14, 15, 16, 16, 17,
  18, 18, 19, 20, 21, 22, 23, 24, 25, 26,
  27, 28, 30, 31, 33, 34, 36, 37, 38, 39,
  41, 42, 44, 46, 47, 49, 51, 53, 54, 56,
  58, 60, 62, 64, 66, 68, 70, 72, 74, 76,
  79, 82, 85, 88, 91, 94, 98, 102, 106, 110,
  115, 120, 125, 130, 135, 141, 147, 153, 159, 165,
  171, 178, 185, 193, 202, 211, 232, 243, 254, 255,
];
const levelTable = [
  0, 12, 24, 33, 43, 52, 60, 67, 72, 76,
  79, 82, 85, 87, 89, 91, 93, 95, 96, 97,
  98, 99, 100, 101, 102, 103, 104, 105, 106, 107,
  108, 109, 110, 111, 112, 113, 114, 115, 116, 117,
  118, 119, 120, 121, 122, 123, 124, 125, 126, 127,
  128, 129, 130, 131, 132, 133, 134, 135, 136, 137,
  138, 139, 140, 141, 142, 143, 144, 145, 146, 147,
  148, 149, 150, 151, 152, 153, 154, 155, 156, 157,
  158, 159, 160, 161, 162, 163, 166, 168, 171, 174,
  177, 181, 186, 193, 201, 210, 220, 231, 243, 255,
];

// CPU-side PITCH_EG_PROCESS and the alternating pitch-register update.
export class PitchEnvelope {
  constructor(chip) {
    this.chip = chip;
    this.voices = Array(16).fill(null);
    this.group = 0;
    this.configure({rates:[99,99,99,99], levels:[50,50,50,50]});
  }
  configure({rates, levels}) {
    this.rates = rates.map(value => rateTable[value]);
    this.targets = levels.map(value => levelTable[value] << 7);
  }
  keyOn(ch, base) {
    this.voices[ch] = {base, last:base, level:this.targets[3], stage:0};
    this.publish(ch);
  }
  keyOff(ch) {
    const voice = this.voices[ch];
    if (voice && voice.stage < 4) voice.stage = 4;
  }
  publish(ch) {
    const voice = this.voices[ch];
    if (!voice) return;
    const pitch = Math.max(0, Math.min(65535, voice.base + voice.level - 16384));
    if (pitch === voice.last) return;
    this.chip.writeRegister(PITCH + ch*2, pitch >> 8);
    this.chip.writeRegister(PITCH + ch*2 + 1, pitch & 255);
    voice.last = pitch;
  }
  tick() {
    for (let ch=this.group; ch<this.group+8; ch++) this.publish(ch);
    this.group ^= 8;
    if (this.group === 0) return;
    for (const voice of this.voices) {
      if (!voice || voice.stage === 3 || voice.stage === 5) continue;
      const index = Math.min(voice.stage, 3);
      const target = this.targets[index];
      const rising = voice.level < target;
      const next = voice.level + (rising ? this.rates[index] : -this.rates[index]);
      // The firmware tests the high byte before snapping to the full target.
      if (rising ? (next >> 8) < (target >> 8) : (next >> 8) > (target >> 8)) {
        voice.level = next;
      } else {
        voice.level = target;
        voice.stage++;
      }
    }
  }
}

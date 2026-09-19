// Live note-ish tracking for Game Boy DMG channels 1-3 (square, square, wave).
// Channel 4 (noise) has no pitch and is intentionally not tracked here,
// matching how other chips' noise sources are excluded from note-ish.
//
// This mirrors tone_notes.js's write-driven approximation rather than
// simulating the chip: keyOn/off is inferred from trigger and DAC-enable
// writes only. Length-counter timeout and channel-1 sweep are time-based
// (see third_party/mame-gameboy/README.md) and are not reproduced here, the
// same class of approximation already accepted for SSG envelope phase.

const FREQ_LO = [0x03, 0x08, 0x0d]; // NR13, NR23, NR33
const FREQ_HI = [0x04, 0x09, 0x0e]; // NR14, NR24, NR34: trigger, length-enable, freq bits 8-10
const ENVELOPE_REG = [0x02, 0x07]; // NR12, NR22 (channel 3 uses NR30 below instead)
const NR30 = 0x0a;
const NR52 = 0x16;

export function createGameboyMonitor() {
  return { channels: [0, 1, 2].map(() => ({ freq: 0, keyOn: false, dacEnabled: false })) };
}

export function applyGameboyWrite(state, register, value) {
  let changed = false;
  for (let ch = 0; ch < 3; ch++) {
    if (register === FREQ_LO[ch]) {
      state.channels[ch].freq = (state.channels[ch].freq & 0x700) | value;
      changed = true;
    } else if (register === FREQ_HI[ch]) {
      state.channels[ch].freq = (state.channels[ch].freq & 0xff) | ((value & 7) << 8);
      if (value & 0x80) state.channels[ch].keyOn = state.channels[ch].dacEnabled;
      changed = true;
    } else if (ch < 2 && register === ENVELOPE_REG[ch]) {
      state.channels[ch].dacEnabled = (value & 0xf8) !== 0;
      if (!state.channels[ch].dacEnabled) state.channels[ch].keyOn = false;
      changed = true;
    }
  }
  if (register === NR30) {
    state.channels[2].dacEnabled = (value & 0x80) !== 0;
    if (!state.channels[2].dacEnabled) state.channels[2].keyOn = false;
    changed = true;
  }
  if (register === NR52 && !(value & 0x80)) {
    for (const channel of state.channels) channel.keyOn = false;
    changed = true;
  }
  return changed;
}

const LABELS = ["GB CH1", "GB CH2", "GB CH3"];
const TYPES = ["Square", "Square", "Wave"];

export function describeGameboyNotes(state) {
  return state.channels.map((channel, index) => {
    const hz = index === 2 ? 65536 / Math.max(1, 2048 - channel.freq) : 131072 / Math.max(1, 2048 - channel.freq);
    const midi = channel.keyOn ? 69 + 12 * Math.log2(hz / 440) : null;
    return { name: LABELS[index], type: TYPES[index], midi, keyOn: channel.keyOn, freq: channel.freq };
  });
}

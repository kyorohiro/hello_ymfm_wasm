// Register state, not an emulation of timer phase or the audible envelope.
// Divider/borrow offsets match PokeySynth and the pinned libvgm POKEY core:
// base clock: AUDF + 1; high clock: AUDF + 4; joined high clock: AUDF16 + 7.
// A joined lower channel can still produce sound when its AUDC is nonzero,
// but it is a timer helper rather than an independent 8-bit pitched voice.
export function createPokeyMonitor(header = {}) {
  const count = header.pokeyClock & 0x40000000 ? 2 : 1;
  return {
    clock: (header.pokeyClock ?? 0) & 0x3fffffff,
    chips: Array.from({length: count}, () => {
      const registers = new Uint8Array(16);
      for (let ch = 0; ch < 4; ch++) registers[ch * 2 + 1] = 0xb0;
      registers[15] = 3; // The pinned VGM core starts with SKCTL=3.
      return {registers, stimerCount: 0};
    }),
  };
}

export function applyPokeyWrite(state, register, value, chipIndex = 0) {
  if (!Number.isInteger(chipIndex) || !state.chips[chipIndex] ||
      !Number.isInteger(register) || register < 0 || register > 15 ||
      !Number.isInteger(value) || value < 0 || value > 255) return false;
  const chip = state.chips[chipIndex];
  chip.registers[register] = value;
  if (register === 9) chip.stimerCount++;
  return register < 10 || register === 15;
}

function distortionMode(distortion, poly9) {
  if (distortion === 5 || distortion === 7) return 'Tone';
  if (distortion & 1) return 'Poly5-gated tone';
  const polynomial = distortion & 2 ? 'Poly4' : poly9 ? 'Poly9' : 'Poly17';
  return `Noise (${distortion & 4 ? '' : 'Poly5 → '}${polynomial})`;
}

// Only a plain square timer has an unambiguous base note here. Filtered,
// polynomial-gated, two-tone, serial-clock and DAC modes are labelled rather
// than incorrectly converted to a MIDI note. No score/export extractor exists.
export function describePokeyNotes(state) {
  return state.chips.flatMap((chip, chipIndex) => {
    const regs = chip.registers, audctl = regs[8], skctl = regs[15];
    return Array.from({length: 4}, (_, channel) => {
      const lower = channel & 2, audf = regs[channel * 2], audc = regs[channel * 2 + 1];
      const joined = Boolean(audctl & (lower === 0 ? 16 : 8));
      const helper = joined && channel === lower;
      const highClock = Boolean(audctl & (lower === 0 ? 64 : 32)) && (joined || channel === lower);
      const divisor = highClock ? 1 : audctl & 1 ? 114 : 28;
      const offset = highClock ? joined ? 7 : 4 : 1;
      const period = joined && !helper ? regs[lower * 2] | (audf << 8) : audf;
      const volume = audc & 15, distortion = audc >>> 5, volumeOnly = Boolean(audc & 16);
      const highPass = channel === 0 ? Boolean(audctl & 4) : channel === 1 ? Boolean(audctl & 2) : false;
      const filterClockFor = channel === 2 && (audctl & 4) ? 0 : channel === 3 && (audctl & 2) ? 1 : null;
      const running = Boolean(skctl & 3), twoTone = channel < 2 && Boolean(skctl & 8);
      const serialClock = Boolean(skctl & 0x70);
      const type = volumeOnly ? 'Volume-only DAC' : helper ? 'Joined timer helper'
        : twoTone ? 'Two-tone' : serialClock ? 'Serial clock mode'
        : highPass ? 'High-pass filtered' : distortionMode(distortion, Boolean(audctl & 128));
      const timerHz = state.clock > 0 ? state.clock / (2 * divisor * (period + offset)) : null;
      const frequency = type === 'Tone' && running && volume > 0 ? timerHz : null;
      const reason = volume === 0 ? 'Volume 0' : !volumeOnly && !running ? 'Timers stopped'
        : type !== 'Tone' ? type : !state.clock ? 'No clock' : null;
      return {
        chipIndex, channel, flatChannel: chipIndex * 4 + channel,
        name: `POKEY${state.chips.length > 1 ? ` ${chipIndex + 1}` : ''} CH${channel + 1}`,
        clock: state.clock, audf, audc, audctl, skctl, period, divisor, offset, timerHz,
        frequency, midi: frequency ? 69 + 12 * Math.log2(frequency / 440) : null,
        type, reason, volume, distortion, volumeOnly, joined, helper, highClock,
        highPass, filterClockFor, running,
      };
    });
  });
}

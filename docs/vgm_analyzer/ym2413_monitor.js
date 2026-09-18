// This monitor reports register state, not an inferred envelope phase.
// Frequency formula verified against the compiled ymfm YM2413 core:
// hz = fnum * clock * 2^block / (2^19 * 72).
const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const RHYTHM_BITS = { bd: 4, sd: 3, tom: 2, tc: 1, hh: 0 };

export function describeYm2413(registers, clock) {
  const rhythmEnabled = Boolean(registers[0x0e] & 0x20);
  const rhythm = Object.fromEntries(Object.entries(RHYTHM_BITS).map(([name, bit]) => [name, Boolean(registers[0x0e] & (1 << bit))]));
  const channels = Array.from({ length: 9 }, (_, ch) => {
    const isRhythmChannel = rhythmEnabled && ch >= 6;
    const fnumLow = registers[0x10 + ch];
    const hiReg = registers[0x20 + ch];
    const fnum = fnumLow | ((hiReg & 1) << 8);
    const block = (hiReg >> 1) & 7;
    const sustain = Boolean(hiReg & 0x20);
    // In rhythm mode, key-on comes from register 0x0E's per-instrument bits, not the channel's own key bit.
    // CH6 (index 6) is Bass Drum and keeps its own FNUM/BLOCK pitch; CH7/CH8 have no single meaningful pitch.
    const keyOn = isRhythmChannel ? (ch === 6 ? rhythm.bd : false) : Boolean(hiReg & 0x10);
    const volReg = registers[0x30 + ch];
    const instrument = (volReg >> 4) & 15;
    const volume = volReg & 15;
    const frequency = clock * fnum * 2 ** block / (2 ** 19 * 72);
    const midi = keyOn && fnum > 0 ? 69 + 12 * Math.log2(frequency / 440) : null;
    return { channel: ch, fnum, block, instrument, volume, sustain, keyOn, frequency, midi, isRhythmChannel };
  });
  return { rhythmEnabled, rhythm, channels };
}

function noteName(midi) {
  const rounded = Math.round(midi);
  return `${NOTE_NAMES[((rounded % 12) + 12) % 12]}${Math.floor(rounded / 12) - 1}`;
}

export function mountYm2413Monitor(root) {
  const regs = new Uint8Array(0x40);
  let header = {};
  const title = document.createElement('h3'); root.append(title);
  const summary = document.createElement('p'); root.append(summary);
  const rows = Array.from({ length: 9 }, (_, ch) => {
    const row = document.createElement('p'), text = document.createElement('span');
    row.append(`CH${ch + 1} · `, text); root.append(row);
    return { text };
  });
  function render() {
    title.textContent = 'YM2413 (OPLL)';
    const clock = header.ym2413Clock & 0x3fffffff;
    const state = describeYm2413(regs, clock);
    summary.textContent = `Clock: ${clock} Hz · Rhythm mode: ${state.rhythmEnabled ? 'On' : 'Off'}` +
      (state.rhythmEnabled ? ` · BD ${state.rhythm.bd ? 'On' : 'Off'} · SD ${state.rhythm.sd ? 'On' : 'Off'} · TOM ${state.rhythm.tom ? 'On' : 'Off'} · TC ${state.rhythm.tc ? 'On' : 'Off'} · HH ${state.rhythm.hh ? 'On' : 'Off'}` : '');
    state.channels.forEach((ch, i) => {
      if (ch.isRhythmChannel && ch.channel !== 6) {
        rows[i].text.textContent = 'Repurposed for rhythm (see summary); base pitch not shown.';
        return;
      }
      const note = ch.midi === null ? '—' : `${noteName(ch.midi)} (${ch.frequency.toFixed(1)} Hz)`;
      rows[i].text.textContent = `Key: ${ch.keyOn ? 'On' : 'Off'} · Instrument: ${ch.instrument === 0 ? 'Custom' : ch.instrument} · Volume: ${ch.volume} · Sustain: ${ch.sustain ? 'On' : 'Off'} · Pitch: ${note}`;
    });
  }
  return {
    render,
    describe() { return describeYm2413(regs, header.ym2413Clock & 0x3fffffff); },
    load(next) { header = next; regs.fill(0); render(); },
    reset() { regs.fill(0); render(); },
    write(r, v) { if (r < regs.length) regs[r] = v; },
  };
}

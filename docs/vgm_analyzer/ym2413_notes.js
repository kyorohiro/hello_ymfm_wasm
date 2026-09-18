import { Ym2612VGM } from '../js/ym2612vgm.js?v=ym2610-vgm-2';
import { describeYm2413 } from './ym2413_monitor.js';

/** Extract base-pitch note intervals from FNUM/BLOCK for MIDI/LilyPond export.
 * Rhythm mode: Bass Drum keeps its own FNUM/BLOCK pitch; Snare/Hi-hat/Tom/Top
 * Cymbal have no single meaningful pitch and are omitted. */
export function extractOpllNotes(source) {
  let time = 0;
  const warnings = new Map();
  const warn = message => {
    const entry = warnings.get(message) ?? { count: 0, first: time, last: time };
    entry.count++; entry.last = time; warnings.set(message, entry);
  };
  const parser = new Ym2612VGM(source, { logger: { warn } });
  const clock = parser.header.ym2413Clock & 0x3fffffff;
  const regs = new Uint8Array(0x40);
  const channels = Array.from({ length: 9 }, () => ({ active: null, notes: [], serial: 0 }));
  let rhythmWarned = false;
  function update() {
    const state = describeYm2413(regs, clock);
    if (state.rhythmEnabled && !rhythmWarned) {
      warn('Rhythm mode: Snare/Hi-hat/Tom/Top Cymbal are omitted; only Bass Drum keeps a base pitch.');
      rhythmWarned = true;
    }
    state.channels.forEach((ch, i) => {
      if (ch.isRhythmChannel && ch.channel !== 6) return;
      const c = channels[i];
      const midi = ch.midi;
      if (c.active && ch.keyOn && c.active.midi === midi) return;
      const wasOn = Boolean(c.active);
      if (c.active) { c.notes.push({ ...c.active, end: time }); c.active = null; }
      if (ch.keyOn && midi !== null) {
        if (!wasOn) c.serial++;
        c.active = { start: time, midi, key: c.serial };
      }
    });
  }
  const targets = { ym2413: { writeRegister: (register, value) => {
    if (register < regs.length) regs[register] = value;
    update();
  } } };
  while (true) {
    const event = parser.playStep(targets);
    if (event.type === 'wait') parser.consumeWait(targets, event.samples, n => { time += n; });
    else if (event.type === 'end') break;
  }
  for (const c of channels) if (c.active) c.notes.push({ ...c.active, end: time });
  return {
    channels: channels.map((c, i) => ({ name: `OPLL CH${i + 1}`, notes: c.notes })),
    time, warnings, parserHeader: parser.header,
  };
}

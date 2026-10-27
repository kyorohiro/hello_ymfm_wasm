import {createPokeyMonitor, applyPokeyWrite, describePokeyNotes} from './pokey_notes.js?v=pokey-vgm-1';

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const hex = value => `$${value.toString(16).padStart(2, '0').toUpperCase()}`;
function noteName(midi) {
  const rounded = Math.round(midi);
  return `${NOTE_NAMES[((rounded % 12) + 12) % 12]}${Math.floor(rounded / 12) - 1}`;
}

// Writes update only the shadow; the analyzer's existing UI poll renders it.
// The monitor never reads hardware's unrelated read-only register bank, writes
// audio parameters, or creates its own animation/polling loop.
export function mountPokeyMonitor(root, {isMuted = () => false} = {}) {
  let header = {}, state = createPokeyMonitor(), sections = [];
  function rebuild() {
    root.replaceChildren();
    sections = state.chips.map((_, chipIndex) => {
      const section = document.createElement('section'); root.append(section);
      const title = document.createElement('h3'); section.append(title);
      const summary = document.createElement('p'); section.append(summary);
      const rows = Array.from({length: 4}, () => {
        const row = document.createElement('p'); section.append(row); return row;
      });
      title.textContent = state.chips.length > 1 ? `POKEY ${chipIndex + 1}` : 'POKEY';
      return {summary, rows};
    });
    const notice = document.createElement('p');
    notice.textContent = 'Written registers and nominal square-tone pitch only. Noise, high-pass filtering, joined helpers, two-tone and volume-only DAC have no inferred note. Static DAC levels are DC; timed sample writes are not transcribed. Song, score, MIDI and instrument exports are unavailable.';
    root.append(notice);
  }
  function render() {
    state.chips.forEach((chip, index) => {
      const control = chip.registers[8], skctl = chip.registers[15];
      sections[index].summary.textContent = `Clock: ${state.clock} Hz · AUDCTL ${hex(control)} · SKCTL ${hex(skctl)} · Base divider ${control & 1 ? 114 : 28} · Noise poly${control & 128 ? 9 : 17} · STIMER writes ${chip.stimerCount}`;
    });
    for (const ch of describePokeyNotes(state)) {
      const pitch = ch.midi === null ? '—' : `${noteName(ch.midi)} (${ch.frequency.toFixed(1)} Hz)`;
      const mode = ch.reason === 'Volume 0' || ch.reason === 'Timers stopped' ? `${ch.type} · ${ch.reason}` : ch.type;
      const helper = ch.helper ? ` · Joined CH${ch.channel + 2} timer helper` : ch.joined ? ' · 16-bit joined' : '';
      const filter = ch.filterClockFor === null ? '' : ` · Filter clock for CH${ch.filterClockFor + 1}`;
      sections[ch.chipIndex].rows[ch.channel].textContent = `CH${ch.channel + 1}${isMuted(ch.flatChannel) ? ' · Muted' : ''} · ${mode}${helper}${filter} · AUDF ${hex(ch.audf)} · AUDC ${hex(ch.audc)} · Volume ${ch.volume}/15 · Distortion ${ch.distortion} · Divisor ${ch.period} + ${ch.offset} × ${ch.divisor} · Pitch: ${pitch}`;
    }
  }
  rebuild(); render();
  return {
    load(next) {header = next; state = createPokeyMonitor(header); rebuild(); render();},
    reset() {state = createPokeyMonitor(header); render();},
    write(register, value, chipIndex = 0) {return applyPokeyWrite(state, register, value, chipIndex);},
    render,
    describe() {return describePokeyNotes(state);},
    get state() {return state;},
  };
}

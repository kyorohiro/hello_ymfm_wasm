/** The mode's primary instrument is playable before a script binds Keyboard.
 * Resolve its admin endpoint after audio preparation; never create a second chip.
 */
const TARGETS = {
  gameboy: ['gameboy', 'Game Boy · Pulse 1'],
  nes: ['nes', 'NES + FDS · Pulse 1'],
  snes: ['snes', 'SNES · Voice 1'],
  x68000: ['ym2151', 'YM2151 · CH1'],
  huc6280: ['huc6280', 'HuC6280 · CH1'],
  segapsg: ['segapsg', 'Sega PSG · Tone 1'],
  dx7: ['dx7', 'DX7'],
};
let sequence = 0;

export function createPlaygroundModeKeyboard({chip, getInspector}) {
  const definition = TARGETS[chip];
  if (!definition) return null;
  const [primaryId, name] = definition, prefix = `mode-keyboard-${++sequence}-`;
  const held = new Map();
  let noteSequence = 0;
  function release(id) {
    const entry = held.get(id);
    if (!entry) return;
    held.delete(id);
    // A new runtime must not receive releases belonging to an old runtime.
    if (getInspector() !== entry.source) return;
    return entry.source.invoke(primaryId, 'auditionOff', [0, entry.noteId]);
  }
  return {
    name,
    async noteOn(event) {
      const source = getInspector();
      if (!source?.list().some(entry => entry.id === primaryId && entry.connected !== false)) {
        throw new Error(`${name} is not ready. Prepare audio or Run the mode's code first.`);
      }
      const previous = release(event.id);
      const entry = {source, noteId: `${prefix}${++noteSequence}`};
      held.set(event.id, entry);
      try {
        if (previous?.then) await previous;
        if (held.get(event.id) !== entry || getInspector() !== source) return;
        await source.invoke(primaryId, 'auditionOn', [0, event.midi, entry.noteId, event.velocity ?? 100]);
      } catch (error) {
        if (held.get(event.id) === entry) held.delete(event.id);
        throw error;
      }
    },
    noteOff(event) {return release(event.id);},
    allNotesOff() {return Promise.allSettled([...held.keys()].map(release));},
  };
}

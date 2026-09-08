// Open pitches ordered from lowest string to highest. Indices follow this order.
const TUNINGS = {
  6: [40, 45, 50, 55, 59, 64],
  7: [35, 40, 45, 50, 55, 59, 64],
  8: [30, 35, 40, 45, 50, 55, 59, 64],
};
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const name = n => `${NAMES[n % 12]}${Math.floor(n / 12) - 1}`;
function tuning(strings) {
  if (!TUNINGS[strings]) throw new RangeError('Use 6, 7 or 8 strings');
  return TUNINGS[strings];
}
export function getFretCandidates(note, strings = 8) {
  const opens = tuning(strings);
  if (!Number.isInteger(note) || note < 0 || note > 127) return [];
  return opens.flatMap((open, stringIndex) => {
    const fret = note - open;
    return fret >= 0 && fret <= 24 ? [{ stringIndex, fret }] : [];
  });
}
export function noteToFretPosition(note, strings = 8) {
  tuning(strings);
  // Fixed contiguous bands with at most a four-fret jump between
  // adjacent pitches. Do not return to a lower string in the next octave:
  // that creates large sideways jumps despite a small pitch change.
  const bands = [
    [34, 8], [39, 7], [47, 6], [53, 5], [59, 4],
    [65, 3], [71, 2], [88, 1],
  ];
  const stringNumber = bands.find(([upper]) => note <= upper)?.[1];
  const band = strings - stringNumber;
  return getFretCandidates(note, strings).sort((a, b) =>
    Math.abs(a.stringIndex - band) - Math.abs(b.stringIndex - band) || a.fret - b.fret
  )[0] ?? null;
}
// Keep a five-fret window (four-fret span) until no candidate fits.
export function selectFretPosition(note, previous = null, strings = 8) {
  const available = getFretCandidates(note, strings)
    .filter(p => p.fret < 12 || strings - p.stringIndex <= 4);
  const standard = available.filter(p => strings - p.stringIndex <= 6 && p.fret <= 21);
  const candidates = standard.length ? standard : available;
  if (!candidates.length) return null;
  if (!previous) {
    const preferred = noteToFretPosition(note, strings);
    const position = candidates.find(p => p.stringIndex === preferred?.stringIndex) ?? candidates[0];
    return { ...position, handStart: Math.max(0, Math.min(20, position.fret - 2)) };
  }
  const shift = p => p.fret < previous.handStart ? previous.handStart - p.fret
    : Math.max(0, p.fret - previous.handStart - 4);
  candidates.sort((a, b) => shift(a) - shift(b)
    || Math.abs(a.fret - previous.fret) - Math.abs(b.fret - previous.fret)
    || Math.abs(a.stringIndex - previous.stringIndex) - Math.abs(b.stringIndex - previous.stringIndex)
    || a.fret - b.fret);
  const position = candidates[0];
  const handStart = Math.max(0, Math.min(previous.handStart, position.fret));
  return { ...position, handStart: Math.max(handStart, position.fret - 4) };
}

// Channel-owned state: retain actual chosen positions for the history ghosts.
export function createFretboardTracker(strings = 8) {
  let hand = null;
  let lastNote = null;
  let currentPosition = null;
  const positions = new Map();
  function choose(note) {
    const pitch = Number.isFinite(note) ? Math.round(note) : null;
    if (pitch === lastNote) return currentPosition;
    lastNote = pitch;
    currentPosition = pitch === null ? null : selectFretPosition(pitch, hand, strings);
    if (currentPosition) hand = currentPosition;
    return currentPosition;
  }
  return {
    update(points, note, keyOn, now) {
      for (const point of points) {
        if (!positions.has(point)) positions.set(point, choose(point.midiFloat));
      }
      const current = choose(keyOn ? note : null);
      const history = points.map((point, index) => ({
        note: point.midiFloat,
        position: positions.get(point),
        ageMs: now - (points[index + 1]?.time ?? point.time),
      }));
      const retained = new Set(points);
      for (const point of positions.keys()) if (!retained.has(point)) positions.delete(point);
      return { strings, keyOn, history,
        activePositions: new Map(current ? [[Math.round(note), current]] : []) };
    },
  };
}

export const FRET_TRAIL_MS = 2500;

export function renderFretboard(notes, { strings = 8, keyOn = true, history = [], activePositions = null } = {}) {
  const opens = tuning(strings);
  const height = 62 + strings * 27;
  const x = fret => 60 + fret * 29;
  const y = index => 43 + (strings - 1 - index) * 27;
  const pitches = [...new Set(keyOn ? notes.filter(Number.isFinite).map(Math.round) : [])];
  let svg = `<svg viewBox="0 0 784 ${height}" role="img" aria-label="${strings}-string pitch fretboard">`;
  const nutX = 74;
  const boardBottom = 28 + strings * 27;
  svg += `<rect x="45" y="28" width="29" height="${strings * 27}" fill="#c5c0b9" />
    <rect x="${nutX}" y="28" width="697" height="${strings * 27}" fill="#f2e0c7" />`;
  for (let fret = 0; fret <= 24; fret++) {
    const fretX = nutX + fret * 29;
    svg += `<text x="${fretX - 5}" y="17" text-anchor="end" font-size="10" fill="#5b4a33">${fret}</text>`;
    if (fret > 0) svg += `<line x1="${fretX}" x2="${fretX}" y1="28" y2="${boardBottom}" stroke="#a18f7d" stroke-width="2" />`;
  }
  // Inlays sit between strings; the octave has a pair of dots.
  const middleY = (y(0) + y(strings - 1)) / 2 - 27;
  for (const fret of [3, 5, 7, 9, 12, 15, 17, 19]) {
    for (const offset of fret === 12 ? [-27, 27] : [0]) {
      svg += `<circle cx="${x(fret)}" cy="${middleY + offset}" r="5" fill="#8e745b" />`;
    }
  }
  svg += `<rect x="${nutX - 3}" y="28" width="6" height="${strings * 27}" fill="#fff9e9" stroke="#897e70" />`;
  opens.forEach((open, index) => {
    svg += `<text x="37" y="${y(index) + 4}" text-anchor="end" font-size="11" fill="#5b4a33">${strings - index} ${name(open)}</text>
      <line x1="45" x2="771" y1="${y(index)}" y2="${y(index)}" stroke="#927b63" stroke-width="${1 + (strings - index) * 0.12}" />`;
  });
  // One ghost per pitch; repeated notes refresh it rather than darkening it.
  const ghosts = new Map();
  for (const { note, ageMs, position: recordedPosition } of history) {
    if (!Number.isFinite(note) || !Number.isFinite(ageMs) || ageMs < 0 || ageMs >= FRET_TRAIL_MS) continue;
    const pitch = Math.round(note);
    const position = recordedPosition === undefined ? noteToFretPosition(pitch, strings) : recordedPosition;
    if (!position) continue;
    const active = activePositions?.get(pitch) ?? noteToFretPosition(pitch, strings);
    if (pitches.includes(pitch) && active?.stringIndex === position.stringIndex && active?.fret === position.fret) continue;
    const key = `${pitch}:${position.stringIndex}:${position.fret}`;
    if (!ghosts.has(key) || ageMs < ghosts.get(key).ageMs) ghosts.set(key, { note: pitch, ageMs, position });
  }
  for (const { note, ageMs, position } of ghosts.values()) {
    if (!position) continue;
    const opacity = (0.55 * (1 - ageMs / FRET_TRAIL_MS)).toFixed(3);
    svg += `<g data-fret-ghost="${note}" opacity="${opacity}"><circle cx="${x(position.fret)}" cy="${y(position.stringIndex)}" r="12" fill="#007c91" />
      <text x="${x(position.fret)}" y="${y(position.stringIndex) + 4}" text-anchor="middle" font-size="9" fill="white">${name(note)}</text></g>`;
  }
  const outside = [];
  for (const note of pitches) {
    const position = activePositions ? activePositions.get(note) : noteToFretPosition(note, strings);
    if (!position) { outside.push(`${note < opens[0] ? '↓' : '↑'} ${note >= 0 && note <= 127 ? name(note) : `MIDI ${note}`}`); continue; }
    svg += `<g data-fret-note="${note}"><circle cx="${x(position.fret)}" cy="${y(position.stringIndex)}" r="12" fill="#007c91" />
      <text x="${x(position.fret)}" y="${y(position.stringIndex) + 4}" text-anchor="middle" font-size="9" fill="white">${name(note)}</text></g>`;
  }
  svg += '</svg>';
  return svg + `<div class="fretboard-caption">${name(opens[0])}–E6 · 0–24 frets${outside.length ? ` · Outside range: ${outside.join(', ')}` : ''}</div>`;
}

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
// Fallback strings beyond any real fretted instrument, tried only when no
// normal string reaches the note. "9" continues the 6->7->8 perfect-fourth
// pattern below the lowest string (C#1); "10" goes one more below it (C1) to
// reach the bottom of the piano range. "0" is a fabricated extra above the
// highest string (A4); further tiers ("-1", "-2", ...) can be added the same
// way if a track needs to reach further toward the top of the MIDI range.
// stringIndex -1,-2,... = "9","10",... (below string index 0, low to high).
// stringIndex strings,strings+1,... = "0","-1",... (above the top, low to high).
const EXTRA_LOW_OPENS = [25, 24];
const EXTRA_HIGH_OPENS = [69];
export function getFretCandidates(note, strings = 8) {
  const opens = tuning(strings);
  if (!Number.isInteger(note) || note < 0 || note > 127) return [];
  return opens.flatMap((open, stringIndex) => {
    const fret = note - open;
    return fret >= 0 && fret <= 24 ? [{ stringIndex, fret }] : [];
  });
}
// Last-resort-only fallback (see the comment above EXTRA_LOW_OPENS/EXTRA_HIGH_OPENS):
// never compared against normal candidates, only used when none exist at all.
function getExtraCandidate(note, strings) {
  if (!Number.isInteger(note) || note < 0 || note > 127) return null;
  for (let tier = 0; tier < EXTRA_LOW_OPENS.length; tier++) {
    const fret = note - EXTRA_LOW_OPENS[tier];
    if (fret >= 0 && fret <= 24) return { stringIndex: -1 - tier, fret };
  }
  for (let tier = 0; tier < EXTRA_HIGH_OPENS.length; tier++) {
    const fret = note - EXTRA_HIGH_OPENS[tier];
    if (fret >= 0 && fret <= 24) return { stringIndex: strings + tier, fret };
  }
  return null;
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
  const normal = getFretCandidates(note, strings);
  if (!normal.length) return getExtraCandidate(note, strings);
  const stringNumber = bands.find(([upper]) => note <= upper)?.[1];
  const band = strings - stringNumber;
  return normal.sort((a, b) =>
    Math.abs(a.stringIndex - band) - Math.abs(b.stringIndex - band) || a.fret - b.fret
  )[0] ?? null;
}
// Keep a five-fret window (four-fret span) until no candidate fits.
export function selectFretPosition(note, previous = null, strings = 8) {
  const available = getFretCandidates(note, strings)
    .filter(p => p.fret < 12 || strings - p.stringIndex <= 4);
  const standard = available.filter(p => strings - p.stringIndex <= 6 && p.fret <= 21);
  const candidates = standard.length ? standard : available;
  if (!candidates.length) {
    const extra = getExtraCandidate(note, strings);
    return extra ? { ...extra, handStart: Math.max(0, Math.min(20, extra.fret - 2)) } : null;
  }
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
  // Sticky, never decreases: a fallback row that appeared should not blink
  // on/off as the note that needed it comes and goes. Counts how many tiers
  // ("9"=1,"10"=2,... / "0"=1,"-1"=2,...) have ever been needed.
  let lowTiers = 0;
  let highTiers = 0;
  function choose(note) {
    const pitch = Number.isFinite(note) ? Math.round(note) : null;
    if (pitch === lastNote) return currentPosition;
    lastNote = pitch;
    currentPosition = pitch === null ? null : selectFretPosition(pitch, hand, strings);
    if (currentPosition) {
      hand = currentPosition;
      if (currentPosition.stringIndex < 0) lowTiers = Math.max(lowTiers, -currentPosition.stringIndex);
      else if (currentPosition.stringIndex >= strings) highTiers = Math.max(highTiers, currentPosition.stringIndex - strings + 1);
    }
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
      return { strings, keyOn, history, extraRows: { lowTiers, highTiers },
        activePositions: new Map(current ? [[Math.round(note), current]] : []) };
    },
  };
}

export const FRET_TRAIL_MS = 2500;

// Shared geometry for renderFretboard and renderAllFretboard (fretboard_all.js),
// so both draw the "9"/"10"/"0"/"-1"... fallback rows at identical positions.
// Adding a low tier ("9"->"10") never moves any existing row: it only extends
// the board further down. Adding a high tier ("0"->"-1") must push every row
// below it down by one (there is no way to add a row above the top without
// doing that), so it is a one-time shift once a channel ever needs it.
export function boardLayout(strings, { lowTiers = 0, highTiers = 0 } = {}) {
  const opens = tuning(strings);
  lowTiers = Math.min(Math.max(0, lowTiers), EXTRA_LOW_OPENS.length);
  highTiers = Math.min(Math.max(0, highTiers), EXTRA_HIGH_OPENS.length);
  const maxIndex = strings - 1 + highTiers;
  const totalRows = strings + lowTiers + highTiers;
  const y = index => 43 + (maxIndex - index) * 27;
  const height = 62 + totalRows * 27;
  const rowIndices = Array.from({ length: totalRows }, (_, i) => maxIndex - i);
  // One formula covers every case: 1..strings for real strings, continuing
  // up (strings+1, +2, ...) below the lowest and down (0, -1, -2, ...) above the highest.
  const displayLabel = index => String(strings - index);
  const isExtended = index => index < 0 || index >= strings || (strings - index) > 6;
  const openOf = index => index < 0 ? EXTRA_LOW_OPENS[-1 - index] : index >= strings ? EXTRA_HIGH_OPENS[index - strings] : opens[index];
  return { opens, y, totalRows, height, rowIndices, displayLabel, isExtended, openOf };
}

export function renderFretboard(notes, { strings = 8, keyOn = true, history = [], activePositions = null, extraRows = null } = {}) {
  const opens = tuning(strings);
  const x = fret => 60 + fret * 29;
  const pitches = [...new Set(keyOn ? notes.filter(Number.isFinite).map(Math.round) : [])];

  // First pass (no drawing yet): resolve every position so we know whether the
  // fallback "9"/"0" rows are actually needed before sizing the board.
  const ghostEntries = [];
  for (const { note, ageMs, position: recordedPosition } of history) {
    if (!Number.isFinite(note) || !Number.isFinite(ageMs) || ageMs < 0 || ageMs >= FRET_TRAIL_MS) continue;
    const pitch = Math.round(note);
    const position = recordedPosition === undefined ? noteToFretPosition(pitch, strings) : recordedPosition;
    if (!position) continue;
    const active = activePositions?.get(pitch) ?? noteToFretPosition(pitch, strings);
    if (pitches.includes(pitch) && active?.stringIndex === position.stringIndex && active?.fret === position.fret) continue;
    const key = `${pitch}:${position.stringIndex}:${position.fret}`;
    ghostEntries.push({ key, note: pitch, ageMs, position });
  }
  const ghosts = new Map();
  for (const g of ghostEntries) if (!ghosts.has(g.key) || g.ageMs < ghosts.get(g.key).ageMs) ghosts.set(g.key, g);
  const outside = [];
  const activeEntries = [];
  for (const note of pitches) {
    const position = activePositions ? activePositions.get(note) : noteToFretPosition(note, strings);
    if (!position) { outside.push(`${note < opens[0] ? '↓' : '↑'} ${note >= 0 && note <= 127 ? name(note) : `MIDI ${note}`}`); continue; }
    activeEntries.push({ note, position });
  }
  // extraRows lets a caller (e.g. the combined all-channel board, or a sticky
  // tracker) force these rows on even when this call's own notes don't need them.
  const tierOf = i => i.position.stringIndex < 0 ? -i.position.stringIndex : i.position.stringIndex >= strings ? i.position.stringIndex - strings + 1 : 0;
  const allEntries = [...ghosts.values(), ...activeEntries];
  const lowTiers = Math.max(extraRows?.lowTiers ?? 0, ...allEntries.filter(e => e.position.stringIndex < 0).map(tierOf), 0);
  const highTiers = Math.max(extraRows?.highTiers ?? 0, ...allEntries.filter(e => e.position.stringIndex >= strings).map(tierOf), 0);

  // Fallback rows below "8" ("9","10",...) and above "1" ("0","-1",...) have
  // no real fretted instrument equivalent; they all get a dashed, muted style.
  const { y, totalRows, height, rowIndices, displayLabel, isExtended, openOf } = boardLayout(strings, { lowTiers, highTiers });

  let svg = `<svg viewBox="0 0 784 ${height}" role="img" aria-label="${strings}-string pitch fretboard">`;
  const nutX = 74;
  const boardBottom = 28 + totalRows * 27;
  svg += `<rect x="45" y="28" width="29" height="${totalRows * 27}" fill="#c5c0b9" />
    <rect x="${nutX}" y="28" width="697" height="${totalRows * 27}" fill="#f2e0c7" />`;
  for (let fret = 0; fret <= 24; fret++) {
    const fretX = nutX + fret * 29;
    svg += `<text x="${fretX - 5}" y="17" text-anchor="end" font-size="10" fill="#5b4a33">${fret}</text>`;
    if (fret > 0) svg += `<line x1="${fretX}" x2="${fretX}" y1="28" y2="${boardBottom}" stroke="#a18f7d" stroke-width="2" />`;
  }
  // Inlays sit between strings; the octave has a pair of dots.
  const middleY = (y(rowIndices[0]) + y(rowIndices[rowIndices.length - 1])) / 2 - 27;
  for (const fret of [3, 5, 7, 9, 12, 15, 17, 19]) {
    for (const offset of fret === 12 ? [-27, 27] : [0]) {
      svg += `<circle cx="${x(fret)}" cy="${middleY + offset}" r="5" fill="#8e745b" />`;
    }
  }
  svg += `<rect x="${nutX - 3}" y="28" width="6" height="${totalRows * 27}" fill="#fff9e9" stroke="#897e70" />`;
  for (const index of rowIndices) {
    const open = openOf(index);
    const extended = isExtended(index);
    svg += `<text x="37" y="${y(index) + 4}" text-anchor="end" font-size="11" fill="${extended ? '#a08b6f' : '#5b4a33'}">${displayLabel(index)} ${name(open)}${extended ? '*' : ''}</text>
      <line x1="45" x2="771" y1="${y(index)}" y2="${y(index)}" stroke="${extended ? '#c2a98a' : '#927b63'}" stroke-width="${1 + Math.max(0, strings - index) * 0.12}"${extended ? ' stroke-dasharray="4 3"' : ''} />`;
  }
  for (const { note, ageMs, position } of ghosts.values()) {
    const opacity = (0.55 * (1 - ageMs / FRET_TRAIL_MS)).toFixed(3);
    svg += `<g data-fret-ghost="${note}" opacity="${opacity}"><circle cx="${x(position.fret)}" cy="${y(position.stringIndex)}" r="12" fill="#007c91" />
      <text x="${x(position.fret)}" y="${y(position.stringIndex) + 4}" text-anchor="middle" font-size="9" fill="white">${name(note)}</text></g>`;
  }
  for (const { note, position } of activeEntries) {
    svg += `<g data-fret-note="${note}"><circle cx="${x(position.fret)}" cy="${y(position.stringIndex)}" r="12" fill="#007c91" />
      <text x="${x(position.fret)}" y="${y(position.stringIndex) + 4}" text-anchor="middle" font-size="9" fill="white">${name(note)}</text></g>`;
  }
  svg += '</svg>';
  const extendedNote = (lowTiers || highTiers || strings > 6) ? ' · * = not a real fretted instrument, display range only' : '';
  return svg + `<div class="fretboard-caption">${name(opens[0])}–E6 · 0–24 frets${extendedNote}${outside.length ? ` · Outside range: ${outside.join(', ')}` : ''}</div>`;
}

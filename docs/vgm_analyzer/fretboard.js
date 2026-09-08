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
export function renderFretboard(notes, { strings = 8, keyOn = true } = {}) {
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
  const outside = [];
  for (const note of pitches) {
    const position = noteToFretPosition(note, strings);
    if (!position) { outside.push(`${note < opens[0] ? '↓' : '↑'} ${note >= 0 && note <= 127 ? name(note) : `MIDI ${note}`}`); continue; }
    svg += `<g data-fret-note="${note}"><circle cx="${x(position.fret)}" cy="${y(position.stringIndex)}" r="12" fill="#007c91" />
      <text x="${x(position.fret)}" y="${y(position.stringIndex) + 4}" text-anchor="middle" font-size="9" fill="white">${name(note)}</text></g>`;
  }
  svg += '</svg>';
  return svg + `<div class="fretboard-caption">${name(opens[0])}–E6 · 0–24 frets${outside.length ? ` · Outside range: ${outside.join(', ')}` : ''}</div>`;
}

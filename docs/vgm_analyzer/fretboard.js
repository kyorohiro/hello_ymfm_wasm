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
  const opens = tuning(strings);
  // Fixed pitch bands: each string owns [its open pitch, next open pitch).
  // The highest string owns the remaining range. Adding bass strings never
  // changes the string number or fret used by an already representable pitch.
  const band = opens.findLastIndex(open => note >= open);
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
  svg += `<rect x="45" y="28" width="726" height="${strings * 27}" rx="5" fill="#f2e0c7" />`;
  for (let fret = 0; fret <= 24; fret++) {
    svg += `<text x="${x(fret)}" y="17" text-anchor="middle" font-size="10" fill="#5b4a33">${fret}</text>`;
    if (fret > 0) svg += `<line x1="${x(fret) - 14}" x2="${x(fret) - 14}" y1="28" y2="${height - 7}" stroke="#b9a38e" />`;
  }
  opens.forEach((open, index) => {
    svg += `<text x="37" y="${y(index) + 4}" text-anchor="end" font-size="11" fill="#5b4a33">${strings - index} ${name(open)}</text>
      <line x1="45" x2="771" y1="${y(index)}" y2="${y(index)}" stroke="#927b63" stroke-width="${1 + (strings - index) * 0.12}" />`;
    for (const fret of [3, 5, 7, 9, 12, 15, 17, 19, 21, 24]) {
      svg += `<circle cx="${x(fret)}" cy="${y(index)}" r="2" fill="#b9a38e" />`;
    }
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

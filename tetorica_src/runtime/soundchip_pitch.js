/** Shared musical pitch validation; numbers are integer MIDI notes, never Hz. */
/** @param {string|number} note @returns {number} Hz, with A4 = MIDI 69 = 440 Hz. */
export function noteToHz(note) {
  let midi = note;
  if (typeof note === 'string') {
    const match = /^([A-Ga-g])([#b]?)(-?\d+)$/.exec(note);
    if (!match) throw new RangeError('Expected a note name such as C4 or C#4');
    midi = (Number(match[3]) + 1) * 12 + {C:0,D:2,E:4,F:5,G:7,A:9,B:11}[match[1].toUpperCase()] + (match[2] === '#' ? 1 : match[2] === 'b' ? -1 : 0);
  }
  if (!Number.isInteger(midi) || midi < 0 || midi > 127) throw new RangeError('Note must be a name or integer MIDI 0..127');
  return 440 * 2 ** ((midi - 69) / 12);
}
/** Hz at standard FM prescaling. Raw prescaler changes require explicit BLOCK/F-NUM.
 * @param {number} hz @param {number} clock @param {number} [divider=144] @param {{clamp?:boolean}} [options] */
export function opnPitchFromHz(hz, clock, divider = 144, {clamp = false} = {}) {
  if (!Number.isFinite(hz) || hz <= 0 || !Number.isFinite(clock) || clock <= 0) throw new RangeError('Frequency and clock must be positive finite Hz');
  let best, error = Infinity;
  for (let block = 0; block < 8; block++) {
    const unit = clock * 2 ** (block - 1) / (divider * 2 ** 20);
    const rounded = Math.round(hz / unit);
    const fnum = clamp ? Math.max(1, Math.min(2047, rounded)) : rounded;
    if (fnum < 1 || fnum > 2047) continue;
    const difference = Math.abs(unit * fnum - hz);
    if (difference < error) { best = {block, fnum}; error = difference; }
  }
  if (!best) throw new RangeError('Frequency is outside the FM BLOCK/F-NUM range');
  return best;
}
/** OPM pitch at the supplied master Hz, quantized to 1/64 semitone.
 * @param {number} hz @param {number} [clock=3579545] */
export function opmPitchFromHz(hz, clock = 3579545) {
  if (!Number.isFinite(hz) || hz <= 0 || !Number.isFinite(clock) || clock <= 0) throw new RangeError('Frequency and clock must be positive finite Hz');
  const pitch = Math.round((69 + 12 * Math.log2(hz / 440) - 13 + 12 * Math.log2(3579545 / clock)) * 64);
  if (pitch < 0 || pitch > 95 * 64 + 63) throw new RangeError('Frequency is outside the OPM KC/KF range');
  const index = Math.floor(pitch / 64);
  return {keyCode:(Math.floor(index / 12) << 4) | [0,1,2,4,5,6,8,9,10,12,13,14][index % 12],keyFraction:pitch % 64};
}

/** Continuous MIDI pitch (including bends/interpolation), A4=69=440 Hz.
 * Clamp unrepresentable pitches like the MIDI Playground native renderer.
 * @param {number} midi @param {number} [clock=7670454] @param {number} [divider=144] */
export function midiToOpnPitch(midi, clock = 7670454, divider = 144) {
  if (!Number.isFinite(midi)) throw new RangeError('MIDI pitch must be finite');
  return opnPitchFromHz(440 * 2 ** ((midi - 69) / 12), clock, divider, {clamp:true});
}

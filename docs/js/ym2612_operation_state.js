/** @typedef {{registers:number[][],frequencyLatches:number[],pitches:number[],specialPitches:number[],keyMasks:number[]}} YM2612OperationState */

/** Register/control shadow used only for operation resolution, not an audio
 * engine save-state. Frequency writes have two chip-global high-byte latches;
 * a high write alone does not change a channel's committed pitch.
 * @returns {YM2612OperationState} */
export function createYm2612OperationResetState() {
  return {registers: [Array(256).fill(0), Array(256).fill(0)],
    frequencyLatches: [0, 0], pitches: Array(6).fill(0),
    specialPitches: Array(6).fill(0), keyMasks: Array(6).fill(0)};
}

/** Validate and detach every register/control array.
 * @param {unknown} state @returns {YM2612OperationState} */
export function validateYm2612OperationState(state) {
  if (!state || typeof state !== 'object') throw new TypeError('YM2612 operation state is required');
  const values = (source, length, max, label) => {
    if (!(Array.isArray(source) || source instanceof Uint8Array || source instanceof Uint16Array) || source.length !== length) {
      throw new TypeError(`YM2612 operation state requires ${length} ${label}`);
    }
    return Array.from(source, value => {
      if (!Number.isInteger(value) || value < 0 || value > max) throw new RangeError(`Invalid YM2612 ${label}`);
      return value;
    });
  };
  if (!Array.isArray(state.registers) || state.registers.length !== 2) throw new TypeError('YM2612 operation state requires two register banks');
  return {registers: state.registers.map(row => values(row, 256, 255, 'register bytes')),
    frequencyLatches: values(state.frequencyLatches, 2, 63, 'frequency latches'),
    pitches: values(state.pitches, 6, 16383, 'committed pitches'),
    specialPitches: values(state.specialPitches, 6, 16383, 'committed special pitches'),
    keyMasks: values(state.keyMasks, 6, 15, 'key masks')};
}

/** Mutates an independently owned shadow after an actually applied write.
 * The write itself is never removed, including repeated key/timer writes.
 * @param {YM2612OperationState} state @param {number} port
 * @param {number} register @param {number} value @returns {void} */
export function observeYm2612OperationWrite(state, port, register, value) {
  if (!Number.isInteger(port) || port < 0 || port > 1 ||
      !Number.isInteger(register) || register < 0 || register > 255 ||
      !Number.isInteger(value) || value < 0 || value > 255) throw new RangeError('Invalid YM2612 register write');
  state.registers[port][register] = value;
  if ((register & 0xf0) === 0xa0 && (register & 3) !== 3) {
    const group = (register >> 3) & 1;
    if (register & 4) state.frequencyLatches[group] = value & 63;
    else (group ? state.specialPitches : state.pitches)[port * 3 + (register & 3)] =
      (state.frequencyLatches[group] << 8) | value;
  }
  if (port === 0 && register === 0x28 && (value & 3) < 3) {
    state.keyMasks[(value & 3) + ((value & 4) ? 3 : 0)] = value >> 4;
  }
}

/** Decode the shadow into the existing high-level resolver. Register conversion
 * remains in YM2612Synth; this function performs no writes or live adoption.
 * @param {import('./ym2612synth.js?v=audio-stability-2').YM2612Synth} synth
 * @param {YM2612OperationState} state @returns {void} */
export function adoptYm2612OperationState(synth, state) {
  const r0 = state.registers[0], slots = [0, 8, 4, 12];
  synth._modeRegister = r0[0x27];
  synth.lfo = {enabled: !!(r0[0x22] & 8), frequency: r0[0x22] & 7};
  if(synth.dac){synth.dac.enabled = !!(r0[0x2b] & 128); synth.dac.value = r0[0x2a];}
  for (let ch = 0; ch < 6; ch++) {
    const r = state.registers[ch < 3 ? 0 : 1], n = ch % 3;
    const c = synth.channels[ch], pitch = state.pitches[ch], pan = r[0xb4 + n];
    Object.assign(c, {algorithm: r[0xb0 + n] & 7, feedback: (r[0xb0 + n] >> 3) & 7,
      block: pitch >> 11, fnum: pitch & 2047,
      left: !!(pan & 128), right: !!(pan & 64), ams: (pan >> 4) & 3, pms: pan & 7});
    for (let op = 0; op < 4; op++) {
      const s = slots[op] + n;
      Object.assign(c.operators[op], {dt: (r[0x30 + s] >> 4) & 7, multi: r[0x30 + s] & 15,
        tl: r[0x40 + s] & 127, rs: (r[0x50 + s] >> 6) & 3, ar: r[0x50 + s] & 31,
        am: !!(r[0x60 + s] & 128), d1r: r[0x60 + s] & 31, d2r: r[0x70 + s] & 31,
        sl: r[0x80 + s] >> 4, rr: r[0x80 + s] & 15, ssg: r[0x90 + s] & 15});
    }
    if (ch === 2) c.specialFrequencies = [state.specialPitches[1], state.specialPitches[2],
      state.specialPitches[0], state.pitches[2]].map(value => ({block: value >> 11, fnum: value & 2047}));
  }
}

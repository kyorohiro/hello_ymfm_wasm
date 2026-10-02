/** Independent OPM client. Operator indices follow register order M1, C1, M2, C2. */
export function createYm2151Client(port) {
  let disposed = false;
  const registers = new Uint8Array(256);
  const integer = (value, max, label) => {
    if (!Number.isInteger(value) || value < 0 || value > max) throw new RangeError(`${label} must be 0..${max}`);
    return value;
  };
  const channel = ch => integer(ch, 7, 'YM2151 channel');
  const send = (method, args = []) => {
    if (disposed) throw new Error('YM2151 disposed');
    port.postMessage({method, args});
  };
  const writeRegister = (register, value) => {
    integer(register, 255, 'Register'); integer(value, 255, 'Value');
    send('writeRegister', [register, value]); registers[register] = value;
  };
  const fields = {
    dt1: [0x40, 4, 7], mul: [0x40, 0, 15], tl: [0x60, 0, 127],
    ks: [0x80, 6, 3], ar: [0x80, 0, 31], am: [0xa0, 7, 1], d1r: [0xa0, 0, 31],
    dt2: [0xc0, 6, 3], d2r: [0xc0, 0, 31], d1l: [0xe0, 4, 15], rr: [0xe0, 0, 15],
  };
  return {
    writeRegister,
    reset() { send('reset'); registers.fill(0); },
    setOperator(ch, operator, options) {
      channel(ch); integer(operator, 3, 'Operator');
      const updates = Object.entries(options).map(([key, value]) => {
        if (!fields[key]) throw new Error(`Unknown YM2151 operator field: ${key}`);
        const [base, shift, max] = fields[key];
        integer(value, max, key); return [base + operator * 8 + ch, shift, max, value];
      });
      for (const [r, shift, max, value] of updates) writeRegister(r, (registers[r] & ~(max << shift)) | (value << shift));
    },
    setAlgo(ch, algorithm, feedback = 0) {
      channel(ch); integer(algorithm, 7, 'Algorithm'); integer(feedback, 7, 'Feedback');
      writeRegister(0x20 + ch, (registers[0x20 + ch] & 0xc0) | (feedback << 3) | algorithm);
    },
    setPan(ch, left, right) {
      channel(ch); writeRegister(0x20 + ch, (registers[0x20 + ch] & 0x3f) | (left ? 0x40 : 0) | (right ? 0x80 : 0));
    },
    /** MIDI integer 13..108 (C#0..C8), at the default 3579545 Hz clock. */
    setNote(ch, note) {
      channel(ch);
      let midi = note;
      if (typeof note === 'string') {
        const match = /^([A-Ga-g])([#b]?)(-?\d+)$/.exec(note);
        if (!match) throw new RangeError('Invalid YM2151 note');
        midi = (Number(match[3]) + 1) * 12 + ({C:0,D:2,E:4,F:5,G:7,A:9,B:11}[match[1].toUpperCase()]) + (match[2] === '#' ? 1 : match[2] === 'b' ? -1 : 0);
      }
      if (!Number.isInteger(midi) || midi < 13 || midi > 108) throw new RangeError('YM2151 note must be C#0..C8 (MIDI 13..108)');
      const index = midi - 13;
      const keyCode = (Math.floor(index / 12) << 4) | [0,1,2,4,5,6,8,9,10,12,13,14][index % 12];
      writeRegister(0x28 + ch, keyCode); writeRegister(0x30 + ch, 0);
      return keyCode;
    },
    /** Raw key code and 6-bit key fraction; useful for bends and VGM values. */
    setPitch(ch, keyCode, keyFraction = 0) {
      channel(ch); integer(keyCode, 127, 'Key code'); integer(keyFraction, 63, 'Key fraction');
      writeRegister(0x28 + ch, keyCode); writeRegister(0x30 + ch, keyFraction << 2);
    },
    keyOn(ch, mask = 15) { channel(ch); integer(mask, 15, 'Operator mask'); writeRegister(8, ch | (mask << 3)); },
    keyOff(ch) { channel(ch); writeRegister(8, ch); },
    setNoise(enabled, frequency = 0) { integer(frequency, 31, 'Noise frequency'); writeRegister(15, (enabled ? 128 : 0) | frequency); },
    dispose() { if (disposed) return; send('dispose'); disposed = true; port.close(); },
  };
}

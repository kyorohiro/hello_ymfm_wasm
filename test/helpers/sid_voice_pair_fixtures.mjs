// SPDX-License-Identifier: BSD-3-Clause
// Newly authored straight-line PSID diagnostics. No game music, ROM, trace
// replay or injected chip observations. A real CPU writes every register.
const LOAD = 0x1000;
const waveformCodes = Object.freeze({triangle: 0x10, saw: 0x20, pulse: 0x40, noise: 0x80});
const integer = (value, min, max, label) => {
  if (!Number.isInteger(value) || value < min || value > max) throw new RangeError(`Pair fixture ${label} must be ${min}..${max}`);
  return value;
};
const boolean = (value, label) => {if (typeof value !== 'boolean') throw new TypeError(`Pair fixture ${label} must be boolean`);return value;};

/** Make one physical source → carrier pair at any of the three SID positions.
 * Raw source/third control bytes and final overrides permit explicit negative
 * cases without rewriting the generated PSID or a recorded playback state.
 * The source's ADSR deliberately differs from the carrier's. Gate/ADSR and
 * output waveform do not supply the phase/MSB used by Sync/Triangle Ring.
 */
export function createSidPairFixture({model = '6581', carrier = 0, sync = true, ring = false,
  waveform = 'triangle', carrierFrequency = 0x1800, sourceFrequency = 0x2400,
  carrierGate = true, carrierTest = false, sourceControl = 0x10, thirdControl = 0,
  attack = 0, decay = 0, sustain = 12, release = 7,
  filterModeMask = 3, filterRouting, cutoff = 700, resonance = 6, volume = 8,
  voice3off = false, overrides = []} = {}) {
  if (!['6581', '8580'].includes(model)) throw new RangeError('Pair fixture model must be 6581 or 8580');
  integer(carrier, 0, 2, 'carrier');
  for (const [label, value] of Object.entries({sync, ring, carrierGate, carrierTest, voice3off})) boolean(value, label);
  if (!Object.hasOwn(waveformCodes, waveform)) throw new RangeError('Unknown pair fixture waveform');
  for (const [label, value] of Object.entries({carrierFrequency, sourceFrequency})) integer(value, 0, 65535, label);
  for (const [label, value] of Object.entries({sourceControl, thirdControl})) integer(value, 0, 255, label);
  for (const [label, value] of Object.entries({attack, decay, sustain, release, resonance, volume})) integer(value, 0, 15, label);
  integer(filterModeMask, 0, 7, 'filter mask'); integer(cutoff, 0, 2047, 'cutoff');
  filterRouting ??= 1 << carrier; integer(filterRouting, 0, 7, 'filter routing');
  if (!Array.isArray(overrides)) throw new TypeError('Pair fixture overrides must be register/value pairs');
  const source = (carrier + 2) % 3, third = (carrier + 1) % 3;
  const registers = Array(32).fill(0), setFrequency = (voice, frequency) => {
    registers[voice * 7] = frequency & 255; registers[voice * 7 + 1] = frequency >>> 8;
  };
  setFrequency(carrier, carrierFrequency); setFrequency(source, sourceFrequency);
  registers[carrier * 7 + 2] = 0x34; registers[carrier * 7 + 3] = 0x07;
  registers[carrier * 7 + 4] = waveformCodes[waveform] | Number(carrierGate) | (Number(sync) << 1) | (Number(ring) << 2) | (Number(carrierTest) << 3);
  registers[carrier * 7 + 5] = attack << 4 | decay; registers[carrier * 7 + 6] = sustain << 4 | release;
  registers[source * 7 + 2] = 0xc5; registers[source * 7 + 3] = 0x02;
  registers[source * 7 + 4] = sourceControl; registers[source * 7 + 5] = 0x98; registers[source * 7 + 6] = 0x76;
  registers[third * 7 + 4] = thirdControl;
  registers[21] = cutoff & 7; registers[22] = cutoff >>> 3;
  registers[23] = resonance << 4 | filterRouting; registers[24] = Number(voice3off) << 7 | filterModeMask << 4 | volume;
  for (const pair of overrides) {
    if (!Array.isArray(pair) || pair.length !== 2) throw new TypeError('Pair fixture override requires [register, value]');
    const [register, value] = pair; integer(register, 0, 24, 'override register'); integer(value, 0, 255, 'override value');registers[register] = value;
  }
  const program = [], expectedInitWrites = [];
  const store = (address, value) => program.push(0xa9, value, 0x8d, address & 255, address >>> 8);
  // SID-only I/O permits both the bounded Direct VBI backend and the C64
  // machine backend. The program never needs a ROM, VIC or CIA access.
  for (let register = 0; register <= 24; register++) {store(0xd400 + register, 0);expectedInitWrites.push({register, value: 0});}
  // Finish all oscillator settings before raising carrier/source Gates.
  for (let register = 0; register <= 24; register++) {
    if (register === 4 || register === 11 || register === 18) continue;
    store(0xd400 + register, registers[register]);expectedInitWrites.push({register, value: registers[register]});
  }
  for (const voice of [source, third, carrier]) {
    const register = voice * 7 + 4;store(0xd400 + register, registers[register]);expectedInitWrites.push({register, value: registers[register]});
  }
  program.push(0x60); const playAddress = LOAD + program.length; program.push(0x60);
  const bytes = new Uint8Array(124 + program.length), view = new DataView(bytes.buffer);
  bytes.set([80, 83, 73, 68]);view.setUint16(4, 2);view.setUint16(6, 124);view.setUint16(8, LOAD);
  view.setUint16(10, LOAD);view.setUint16(12, playAddress);view.setUint16(14, 1);view.setUint16(16, 1);view.setUint16(118, model === '8580' ? 0x24 : 0x14);
  const name = `Tetorica ${model} pair ${source + 1}-${carrier + 1}`;
  for (const [offset, text] of [[22, name], [54, 'Tetorica contributors'], [86, '2026 BSD-3-Clause']]) bytes.set(new TextEncoder().encode(text).subarray(0, 32), offset);
  bytes.set(program, 124);
  return {bytes, registers, model, carrier, source, third, carrierFrequency, sourceFrequency,
    loadAddress: LOAD, initAddress: LOAD, playAddress, program: Uint8Array.from(program), expectedInitWrites};
}

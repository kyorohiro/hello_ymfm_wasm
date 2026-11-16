// SPDX-License-Identifier: BSD-3-Clause
// Original generated tones and 68000 instructions, with no external music data.
const encoder = new TextEncoder();
const ascii = value => [...encoder.encode(value)];
const word = value => [(value >>> 8) & 255, value & 255];
const long = value => [...word(value >>> 16), ...word(value)];

export function makeYm3Fixture(ticks = 8) {
  const registers = [0xc4, 1, 0, 0, 0, 0, 1, 0x3e, 15, 0, 0, 64, 0, 0xff];
  const bytes = new Uint8Array(4 + ticks * 14);
  bytes.set(ascii('YM3!'));
  for (let reg = 0; reg < 14; ++reg) bytes.fill(registers[reg], 4 + reg * ticks, 4 + (reg + 1) * ticks);
  return bytes;
}

export function makeYm5Fixture({ ticks = 8, interleaved = true, emptySample = false } = {}) {
  const registers = [0xc4, 1, 0, 0, 0, 0, 1, 0x3e, 15, 0, 0, 64, 0, 0xff, 0, 0];
  const header = [
    ...ascii('YM5!LeOnArD!'), ...long(ticks), ...long(interleaved ? 1 : 0),
    ...word(emptySample ? 1 : 0), ...long(2000000), ...word(50), ...long(0), ...word(0),
    ...(emptySample ? long(0) : []),
    ...ascii('Generated YM5 tone\0Codex test\0Original fixture\0'),
  ];
  const bytes = new Uint8Array(header.length + ticks * 16 + 4);
  bytes.set(header);
  for (let tick = 0; tick < ticks; ++tick) {
    for (let reg = 0; reg < 16; ++reg) bytes[header.length + (interleaved ? reg * ticks + tick : tick * 16 + reg)] = registers[reg];
  }
  bytes.set(ascii('End!'), bytes.length - 4);
  return bytes;
}

// MOVE.B #immediate,absolute.l writes the real emulated YM address/data ports.
const moveImmediateByte = (value, address) => [0x13, 0xfc, 0, value, ...long(address)];
const writeYm = (reg, value) => [...moveImmediateByte(reg, 0xff8800), ...moveImmediateByte(value, 0xff8802)];

export function makeSndhFixture({ endlessInit = false } = {}) {
  const bytes = new Uint8Array(288);
  bytes.set([0x60, 0, 0, 126, 0x4e, 0x75, 0x4e, 0x71, 0x60, 0, 0, 246]);
  bytes.set([
    ...ascii('SNDHTITLGenerated SNDH tone\0COMMCodex test\0YEAR2026\0##02#!02\0!V50\0FRMS'),
    ...long(3), ...long(4), ...ascii('HDNS'),
  ], 12);
  bytes.set(endlessInit ? [0x60, 0xfe] : [
    ...writeYm(0, 0xc4), ...writeYm(1, 1), ...writeYm(7, 0x3e), ...writeYm(8, 15), 0x4e, 0x75,
  ], 128);
  bytes.set([...writeYm(0, 0x90), 0x4e, 0x75], 256);
  return bytes;
}

// A valid level-0 LHA stream made of fixed-symbol LH5 blocks.
// It favors readability over compression and exercises the upstream depacker.
export function packLhaFixture(bytes) {
  const bits = [];
  const put = (value, count) => {
    for (let shift = count - 1; shift >= 0; --shift) bits.push((value >>> shift) & 1);
  };
  for (const value of bytes) {
    put(1, 16); // one symbol in this block
    put(0, 5); put(0, 5); // single-symbol PT alphabet
    put(0, 9); put(value, 9); // literal in the single-symbol C alphabet
    put(0, 4); put(0, 4); // single-symbol position alphabet
  }
  const payload = new Uint8Array(Math.ceil(bits.length / 8));
  bits.forEach((bit, index) => { payload[index >>> 3] |= bit << (7 - (index & 7)); });
  const name = ascii('fixture.ym');
  const header = new Uint8Array(24 + name.length);
  header[0] = 22 + name.length;
  header.set(ascii('-lh5-'), 2);
  new DataView(header.buffer).setUint32(7, payload.length, true);
  new DataView(header.buffer).setUint32(11, bytes.length, true);
  header[19] = 0x20;
  header[20] = 0;
  header[21] = name.length;
  header.set(name, 22);
  header[1] = header.subarray(2).reduce((sum, byte) => (sum + byte) & 255, 0);
  const result = new Uint8Array(header.length + payload.length + 1);
  result.set(header);
  result.set(payload, header.length);
  return result;
}

// Literal-only ICE 2.4 stream, generated from our original SNDH fixture.
export function packIceFixture(bytes) {
  if (!bytes.length || bytes.length > 33037) throw new Error('ICE test fixture length is outside the literal range');
  const widths = [1, 2, 2, 3, 8, 15];
  const maxima = [1, 3, 3, 7, 255, 32768];
  const offsets = [1, 2, 5, 8, 15, 270];
  const bits = [1];
  const put = (value, count) => {
    for (let shift = count - 1; shift >= 0; --shift) bits.push((value >>> shift) & 1);
  };
  for (let tier = 0; tier < widths.length; ++tier) {
    const count = bytes.length - offsets[tier];
    if (count < maxima[tier]) {
      put(count, widths[tier]);
      break;
    }
    put(maxima[tier], widths[tier]);
  }
  const commands = [];
  for (let pos = 0; pos < bits.length;) {
    const first = pos === 0;
    const count = first ? 7 : 8;
    let command = first ? 1 : 0; // initial reload sentinel
    for (let bit = 0; bit < count && pos < bits.length; ++bit) command |= bits[pos++] << (7 - bit);
    commands.push(command);
  }
  const packedSize = 12 + bytes.length + commands.length;
  const result = new Uint8Array(packedSize);
  result.set([...ascii('ICE!'), ...long(packedSize), ...long(bytes.length)]);
  result.set(bytes, 12);
  result.set(commands.reverse(), 12 + bytes.length);
  return result;
}

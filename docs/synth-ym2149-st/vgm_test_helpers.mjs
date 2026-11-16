// Original synthetic register sequence; contains no third-party music.
export const ayWrite = (register, value) => [0xa0, register, value];
export const ayWait = samples => [0x61, samples & 255, samples >> 8];
export function createYmVgmFixture(commands = [
  ...ayWrite(0, 64), ...ayWrite(1, 0), ...ayWrite(2, 100), ...ayWrite(3, 0),
  ...ayWrite(4, 180), ...ayWrite(5, 0), ...ayWrite(6, 7), ...ayWrite(7, 0x18),
  ...ayWrite(8, 16), ...ayWrite(9, 7), ...ayWrite(10, 5),
  ...ayWrite(11, 1), ...ayWrite(12, 0), ...ayWrite(13, 10),
  0x70, 0x7f, 0x62, ...ayWrite(13, 10), ...ayWait(251),
  ...ayWrite(8, 0), ...ayWrite(9, 0), ...ayWrite(10, 0), 0x63,
  ...ayWrite(7, 0x3e), ...ayWrite(8, 12), ...ayWait(3000),
  ...ayWrite(8, 0), ...ayWait(200), 0x66,
], {clock = 2000000, type = 0x10, flags = 1, metadata = null, loop = false, headerSize = 0x100} = {}) {
  const gd3 = metadata ? new Uint8Array(12 + metadata.reduce((sum, value) => sum + (value.length + 1) * 2, 0)) : new Uint8Array();
  if (metadata) {
    const view = new DataView(gd3.buffer);
    gd3.set([71, 100, 51, 32]); view.setUint32(4, 0x100, true); view.setUint32(8, gd3.length - 12, true);
    let offset = 12;
    for (const value of metadata) {
      for (let index = 0; index < value.length; index++) { view.setUint16(offset, value.charCodeAt(index), true); offset += 2; }
      offset += 2;
    }
  }
  const bytes = new Uint8Array(headerSize + commands.length + gd3.length), view = new DataView(bytes.buffer);
  bytes.set([86, 103, 109, 32]); view.setUint32(4, bytes.length - 4, true); view.setUint32(8, 0x171, true);
  view.setUint32(0x34, headerSize - 0x34, true); view.setUint32(0x74, clock, true); bytes[0x78] = type; bytes[0x79] = flags;
  view.setUint32(0x18, 123, true); // Deliberately stale: actual waits own playback duration.
  if (metadata) view.setUint32(0x14, headerSize + commands.length - 0x14, true);
  if (loop) { view.setUint32(0x1c, headerSize - 0x1c, true); view.setUint32(0x20, 123, true); }
  bytes.set(commands, headerSize); bytes.set(gd3, headerSize + commands.length);
  return bytes;
}

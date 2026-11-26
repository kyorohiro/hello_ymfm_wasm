// SPDX-License-Identifier: BSD-3-Clause
export function consoleVgmChip(buffer) {
  if (buffer.byteLength < 0xbc) return null;
  const view = new DataView(buffer);
  if (view.getUint32(0,true) !== 0x206d6756 || view.getUint32(8,true) < 0x171) return null;
  const end = Math.min(buffer.byteLength, 0x34 + view.getUint32(0x34,true));
  if (end >= 0xbc && view.getUint32(0xb8,true)) return 'SCSP';
  if (end >= 0xc8 && view.getUint32(0xc4,true)) return 'VSU';
  return null;
}

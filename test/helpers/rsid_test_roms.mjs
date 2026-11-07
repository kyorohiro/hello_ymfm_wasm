// SPDX-License-Identifier: BSD-3-Clause
// Entirely original synthetic ROM fixtures. Tests only, never player assets.
// These bytes test ROM/RAM execution and song-selection plumbing; they do not
// implement a BASIC interpreter and contain no Commodore ROM data.
export function createRsidTestRoms() {
  const chars = new Uint8Array(4096), basic = new Uint8Array(8192).fill(0xea), kernal = new Uint8Array(8192).fill(0xea);
  // Own reset code: wait for both the loaded image and a real RUN command in
  // the standard keyboard buffer. This checks the loader's command plumbing.
  const boot = [0x78, 0xd8, 0xa2, 0xff, 0x9a, 0xa9, 0x37, 0x85, 1, 0xa9, 0x2f, 0x85, 0,
    0xa9, 0, 0x8d, 1, 8], wait = boot.length;
  for (const [address, value] of [[0x0801, 0x0b], [0x00c6, 4], [0x0277, 82], [0x0278, 85], [0x0279, 78], [0x027a, 13]]) {
    boot.push(0xad, address & 255, address >>> 8, 0xc9, value, 0xd0, 0);
    boot[boot.length - 1] = (wait - boot.length) & 255;
  }
  boot.push(0x4c, 0, 0xa0);
  kernal.set(boot); kernal[0x40] = 0x40;
  for (const at of [0x1ffa, 0x1ffe]) {kernal[at] = 0x40; kernal[at + 1] = 0xe0;}
  kernal[0x1ffc] = 0; kernal[0x1ffd] = 0xe0;
  basic.set([0x20, 0x0d, 8, 0xa9, 0xa5, 0x8d, 0, 4, 0x4c, 8, 0xa0]);
  return {chars, basic, kernal, description: 'Synthetic BSD test ROMs; no Commodore bytes; not a BASIC interpreter'};
}

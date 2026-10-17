/** Original synthetic SPC/BRR fixture: no game data, ROM or third-party music. */
export function createSyntheticSpc({ voices = 1, echo = false, pmon = false, noise = false } = {}) {
  const bytes = new Uint8Array(0x10200);
  bytes.set(new TextEncoder().encode('SNES-SPC700 Sound File Data v0.30'));
  bytes.set([0x1a, 0x1a, 0x1b, 30], 0x21);
  bytes.set([0x00, 0x02, 0, 0, 0, 0, 0xef], 0x25); // PC=$0200, SP=$ef
  const ram = bytes.subarray(0x100, 0x10100);
  // INC $30; BRA $0200. Proves the SMP keeps running, without an IPL ROM.
  ram.set([0xab, 0x30, 0x2f, 0xfc], 0x200);
  ram[0xf1] = 0;
  ram.set([0x00, 0x20, 0x00, 0x20], 0x1000); // source directory: start/loop $2000
  ram.set([0xc3, 0x13, 0x57, 0x75, 0x31, 0xfd, 0xb9, 0x9b, 0xdf], 0x2000);
  const dsp = bytes.subarray(0x10100, 0x10180);
  for (let ch = 0; ch < voices; ch++) {
    dsp[ch * 16] = 64;
    dsp[ch * 16 + 1] = 48;
    dsp[ch * 16 + 2] = ch * 13;
    dsp[ch * 16 + 3] = 0x10;
    dsp[ch * 16 + 7] = 0x7f; // direct gain, no ADSR
  }
  dsp[0x0c] = dsp[0x1c] = 0x7f;
  dsp[0x4c] = (1 << voices) - 1;
  dsp[0x5d] = 0x10;
  dsp[0x6c] = echo ? 0 : 0x20;
  dsp[0x6d] = 0x60;
  dsp[0x7d] = 1;
  if (echo) {
    dsp[0x2c] = dsp[0x3c] = 40;
    dsp[0x0d] = 40;
    dsp[0x0f] = 0x7f;
    dsp[0x4d] = (1 << voices) - 1;
  }
  if (pmon) dsp[0x2d] = ((1 << voices) - 1) & 0xfe;
  if (noise) { dsp[0x3d] = (1 << voices) - 1; dsp[0x6c] |= 0x1f; }
  return bytes;
}

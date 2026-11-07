// SPDX-License-Identifier: BSD-3-Clause
// Newly authored PSID programs for timer/driver tests. No game or ROM data.
const LOAD = 0x1000, COUNTER = 0x0330, IS_CIA = 0x0331, BANK = 0x0332, ICR = 0x0333;
export const PSID_CIA_FREQUENCIES = Object.freeze([0x1d45, 0x3a8a]);
class Program {
  bytes = []; labels = new Map(); references = [];
  label(name) {if (this.labels.has(name)) throw new Error('Duplicate PSID fixture label'); this.labels.set(name, this.bytes.length);}
  emit(...bytes) {this.bytes.push(...bytes);}
  address(name) {return LOAD + this.labels.get(name);}
  absolute(opcode, target) {
    this.emit(opcode);
    if (typeof target === 'string') {this.references.push({at: this.bytes.length, target}); this.emit(0, 0);}
    else this.emit(target & 255, target >>> 8);
  }
  branch(opcode, target) {this.emit(opcode); this.references.push({at: this.bytes.length, target, relative: true}); this.emit(0);}
  store(address, value) {this.emit(0xa9, value); this.absolute(0x8d, address);}
  finish() {
    for (const reference of this.references) {
      if (!this.labels.has(reference.target)) throw new Error('Unknown PSID fixture label');
      const address = this.address(reference.target);
      if (reference.relative) {
        const delta = address - (LOAD + reference.at + 1);
        if (delta < -128 || delta > 127) throw new Error('PSID fixture branch exceeds signed byte');
        this.bytes[reference.at] = delta & 255;
      } else {this.bytes[reference.at] = address & 255; this.bytes[reference.at + 1] = address >>> 8;}
    }
    return Uint8Array.from(this.bytes);
  }
}

/** Song 1 is VBI; song 2 is CIA. With bit31=true, songs1..31 are VBI and
 * songs32..34 are CIA. Timer setup is skipped by VBI songs so the original
 * VBI host can execute them without gaining C64 I/O support.
 * CIA init deliberately leaves its timer configuration for the host to keep.
 */
export function createPsidCiaFixture({period = 997, secondPeriod = 2053, variable = false,
  bit31 = false, bankAfterInit = 0x37, bankAfterPlay = 0x37,
  irqEnabled = true, timerRunning = true, observeIcr = false, observeDefaults = false, fault = null} = {}) {
  for (const value of [period, secondPeriod]) if (value !== null && (!Number.isInteger(value) || value < 256 || value > 65536)) throw new RangeError('PSID fixture period must be 256..65536 or null');
  for (const value of [bankAfterInit, bankAfterPlay]) if (![0x35, 0x36, 0x37].includes(value)) throw new RangeError('Unknown PSID fixture bank');
  if ([irqEnabled, timerRunning, observeIcr, observeDefaults].some(value => typeof value !== 'boolean')) throw new TypeError('PSID fixture IRQ/timer flags must be booleans');
  if (![null, 'init-rom', 'init-loop', 'play-rom', 'play-loop'].includes(fault)) throw new RangeError('Unknown PSID fixture fault');
  const p = new Program(), firstCia = bit31 ? 31 : 1;
  p.label('init'); p.absolute(0x8d, IS_CIA); // Preserve incoming zero-based song.
  p.emit(0x29, 1, 0xaa); // Distinct note for alternating songs.
  for (const [register, value] of [[4, 0], [2, 0], [3, 8], [5, 0], [6, 0xf0], [24, 8]]) p.store(0xd400 + register, value);
  p.absolute(0xbd, 'frequency-low'); p.absolute(0x8d, 0xd400);
  p.absolute(0xbd, 'frequency-high'); p.absolute(0x8d, 0xd401); p.store(0xd404, 0x41);
  p.store(COUNTER, 0); p.absolute(0xad, IS_CIA); p.emit(0xc9, firstCia); p.branch(0x90, 'vbi-init');
  p.store(IS_CIA, 1);
  if (observeDefaults) for (const [index, address] of [0xdc06, 0xdc07, 0xdd04, 0xdd05, 0xdd06, 0xdd07].entries()) {
    p.absolute(0xad, address); p.absolute(0x8d, 0x0340 + index);
  }
  if (period !== null) {
    p.store(0xdc0e, 0); p.store(0xdc04, (period - 1) & 255); p.store(0xdc05, (period - 1) >>> 8);
    p.store(0xdc0d, irqEnabled ? 0x81 : 0x7f); p.store(0xdc0e, timerRunning ? 0x11 : 0x10);
  }
  if (fault === 'init-rom') p.absolute(0xad, 0xe456);
  if (fault === 'init-loop') {p.label('init-hang'); p.absolute(0x4c, 'init-hang');}
  if (bankAfterInit !== 0x37) p.store(1, bankAfterInit);
  p.emit(0x60);
  p.label('vbi-init'); p.store(IS_CIA, 0); p.emit(0x60);
  p.label('play');
  if (observeIcr) {p.absolute(0xad, 0xdc0d); p.absolute(0x8d, ICR);}
  p.emit(0xa5, 1); p.absolute(0x8d, BANK); // LDA $01 records the driver's entry bank.
  p.absolute(0xee, COUNTER); p.absolute(0xad, COUNTER); p.absolute(0x8d, 0xd402);
  if (fault === 'play-rom') p.absolute(0xad, 0xe456);
  if (fault === 'play-loop') {p.label('hang'); p.absolute(0x4c, 'hang');}
  if (variable) {
    p.emit(0xc9, 8); p.branch(0xd0, 'return');
    p.absolute(0xad, IS_CIA); p.branch(0xf0, 'return');
    p.store(0xdc0e, 0); p.store(0xdc04, (secondPeriod - 1) & 255); p.store(0xdc05, (secondPeriod - 1) >>> 8); p.store(0xdc0e, 0x11);
  }
  p.label('return'); if (bankAfterPlay !== 0x37) p.store(1, bankAfterPlay); p.emit(0x60);
  p.label('frequency-low'); p.emit(...PSID_CIA_FREQUENCIES.map(value => value & 255));
  p.label('frequency-high'); p.emit(...PSID_CIA_FREQUENCIES.map(value => value >>> 8));
  const program = p.finish(), bytes = new Uint8Array(124 + program.length), view = new DataView(bytes.buffer);
  bytes.set([80, 83, 73, 68]); view.setUint16(4, 2); view.setUint16(6, 124);
  view.setUint16(8, LOAD); view.setUint16(10, p.address('init')); view.setUint16(12, p.address('play'));
  view.setUint16(14, bit31 ? 34 : 2); view.setUint16(16, 1); view.setUint32(18, bit31 ? 0x80000000 : 2); view.setUint16(118, 0x14);
  for (const [at, text] of [[22, 'Tetorica mixed VBI CIA test'], [54, 'Tetorica contributors'], [86, '2026 BSD-3-Clause']]) bytes.set(new TextEncoder().encode(text).subarray(0, 32), at);
  bytes.set(program, 124);
  return {bytes, program, loadAddress: LOAD, initAddress: p.address('init'), playAddress: p.address('play'),
    counterAddress: COUNTER, bankAddress: BANK, icrAddress: ICR, timerDefaultsAddress: 0x0340,
    periodCycles: period ?? 0x4026, secondPeriodCycles: secondPeriod,
    ciaSubtune: firstCia + 1, frequencies: PSID_CIA_FREQUENCIES};
}

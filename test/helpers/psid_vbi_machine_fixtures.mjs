// SPDX-License-Identifier: BSD-3-Clause
// Independently authored machine-VBI diagnostics. No game or ROM data.
const LOAD = 0x1000;
class Program {
  bytes = []; labels = new Map(); references = [];
  label(name) {if (this.labels.has(name)) throw new Error('Duplicate machine VBI fixture label'); this.labels.set(name, this.bytes.length);}
  emit(...bytes) {this.bytes.push(...bytes);}
  address(name) {return LOAD + this.labels.get(name);}
  absolute(opcode, address) {
    this.emit(opcode);
    if (typeof address === 'string') {this.references.push({at: this.bytes.length, name: address}); this.emit(0, 0);}
    else this.emit(address & 255, address >>> 8);
  }
  branch(opcode, name) {this.emit(opcode); this.references.push({at: this.bytes.length, name, relative: true}); this.emit(0);}
  store(address, value) {this.emit(0xa9, value); this.absolute(0x8d, address);}
  finish() {
    for (const {at, name, relative} of this.references) {
      if (!this.labels.has(name)) throw new Error('Unknown machine VBI fixture label');
      const address = this.address(name);
      if (relative) {const delta = address - (LOAD + at + 1); if (delta < -128 || delta > 127) throw new Error('Machine VBI fixture branch exceeds signed byte'); this.bytes[at] = delta & 255;}
      else {this.bytes[at] = address & 255; this.bytes[at + 1] = address >>> 8;}
    }
    return Uint8Array.from(this.bytes);
  }
}

export function createPsidVbiMachineFixture({delayBlocks = 1, delayOuter = 110, timerPeriod = null,
  driverRange = [0, 0], protectLegacy = false, fault = null} = {}) {
  if (!Number.isInteger(delayBlocks) || delayBlocks < 0 || delayBlocks > 255 || !Number.isInteger(delayOuter) || delayOuter < 1 || delayOuter > 255) throw new RangeError('Invalid machine VBI delay');
  if (timerPeriod !== null && (!Number.isInteger(timerPeriod) || timerPeriod < 256 || timerPeriod > 65536)) throw new RangeError('Invalid machine VBI CIA period');
  if (!Array.isArray(driverRange) || driverRange.length !== 2 || driverRange.some(value => !Number.isInteger(value) || value < 0 || value > 255)) throw new RangeError('Machine VBI driver range requires two bytes');
  if (![null, 'late-rom', 'late-jam', 'expansion-io', 'init-loop', 'play-loop'].includes(fault)) throw new RangeError('Unknown machine VBI fixture fault');
  const p = new Program(), frequencies = [0x1d45, 0x3a8a], sentinels = [[0x0400, 0x94], [0x04ff, 0xa4], [0x0600, 0x96], [0x06ff, 0xa6], [0x0700, 0x97], [0x07ff, 0xa7]];
  p.label('init'); p.emit(0x78); p.absolute(0x8d, 0x0333); p.emit(0x29, 1, 0xaa);
  p.store(0x0330, 0); p.store(0x0331, 0); p.store(0xd011, 0); // DEN off makes IRQ cadence measurements independent of bad lines.
  for (const [register, value] of [[4, 0], [2, 0], [3, 8], [5, 0], [6, 0xf0], [24, 8]]) p.store(0xd400 + register, value);
  p.absolute(0xbd, 'frequency-low'); p.absolute(0x8d, 0xd400); p.absolute(0xbd, 'frequency-high'); p.absolute(0x8d, 0xd401); p.store(0xd404, 0x41);
  if (protectLegacy) for (const [address, value] of sentinels) p.store(address, value);
  p.absolute(0xad, 0xdc04); p.absolute(0x8d, 0x0334); p.absolute(0xad, 0xdc05); p.absolute(0x8d, 0x0335);
  if (timerPeriod !== null) {
    p.store(0xdc0e, 0); p.store(0xdc04, (timerPeriod - 1) & 255); p.store(0xdc05, (timerPeriod - 1) >>> 8); p.store(0xdc0e, 0x11);
    // The host's interrupt mask is deliberately retained: off for VBI, on for CIA.
  }
  if (delayBlocks) {
    p.store(0x034f, delayBlocks); p.label('block'); p.emit(0xa0, delayOuter); p.label('outer'); p.emit(0xa2, 0);
    p.label('inner'); p.emit(0xca); p.branch(0xd0, 'inner'); p.emit(0x88); p.branch(0xd0, 'outer');
    p.absolute(0xce, 0x034f); p.branch(0xd0, 'block');
  }
  if (fault === 'late-rom') p.absolute(0xad, 0xe456);
  if (fault === 'expansion-io') p.absolute(0xad, 0xde00);
  if (fault === 'late-jam') {p.label('jam'); p.emit(0x02);}
  if (fault === 'init-loop') {p.label('hang'); p.absolute(0x4c, 'hang');}
  p.absolute(0xad, 0xdc0d); p.absolute(0x8d, 0x0336);
  p.absolute(0xad, 0x0330); p.absolute(0x8d, 0x0332); p.store(0x0331, 0xa5); p.emit(0x60);
  p.label('play'); p.absolute(0xee, 0x0330); p.absolute(0xad, 0x0330); p.absolute(0x8d, 0xd402);
  p.absolute(0xad, 0xdc0d); p.absolute(0x8d, 0x0337); p.absolute(0xad, 0xd019); p.absolute(0x8d, 0x0338);
  p.absolute(0xad, 0xdc04); p.absolute(0x8d, 0x0339); p.absolute(0xad, 0xdc05); p.absolute(0x8d, 0x033a);
  if (fault === 'play-loop') {p.label('play-hang'); p.absolute(0x4c, 'play-hang');} else p.emit(0x60);
  p.label('frequency-low'); p.emit(...frequencies.map(value => value & 255)); p.label('frequency-high'); p.emit(...frequencies.map(value => value >>> 8));
  const program = p.finish(), bytes = new Uint8Array(124 + program.length), view = new DataView(bytes.buffer);
  bytes.set([80, 83, 73, 68]); view.setUint16(4, 2); view.setUint16(6, 124); view.setUint16(8, LOAD); view.setUint16(10, p.address('init')); view.setUint16(12, p.address('play'));
  view.setUint16(14, 2); view.setUint16(16, 1); view.setUint16(118, 0x14); bytes[120] = driverRange[0]; bytes[121] = driverRange[1];
  for (const [at, text] of [[22, 'Tetorica machine VBI test'], [54, 'Tetorica contributors'], [86, '2026 BSD-3-Clause']]) bytes.set(new TextEncoder().encode(text).subarray(0, 32), at);
  bytes.set(program, 124);
  return {bytes, program, loadAddress: LOAD, initAddress: p.address('init'), playAddress: p.address('play'), frequencies,
    counterAddress: 0x0330, initMarkerAddress: 0x0331, initCounterAddress: 0x0332, initialTimerAddress: 0x0334,
    initIcrAddress: 0x0336, playIcrAddress: 0x0337, playVicAddress: 0x0338, playTimerAddress: 0x0339,
    jamAddress: fault === 'late-jam' ? p.address('jam') : null, sentinels: protectLegacy ? sentinels : []};
}

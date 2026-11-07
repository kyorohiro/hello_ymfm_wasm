// SPDX-License-Identifier: BSD-3-Clause
// Newly authored C64 programs. No game music or ROM dump.
const SID = 0xd400, COUNTER = 0x0330;
class Program {
  constructor(origin) {this.origin = origin; this.bytes = []; this.labels = new Map(); this.references = [];}
  label(name) {if (this.labels.has(name)) throw new Error('Duplicate RSID fixture label'); this.labels.set(name, this.bytes.length);}
  emit(...bytes) {this.bytes.push(...bytes);}
  address(name) {return this.origin + this.labels.get(name);}
  absolute(opcode, address) {
    this.emit(opcode);
    if (typeof address === 'string') {this.references.push({at: this.bytes.length, name: address}); this.emit(0, 0);}
    else this.emit(address & 255, address >>> 8);
  }
  immediateLabel(opcode, name, high = false) {this.emit(opcode); this.references.push({at: this.bytes.length, name, byte: high ? 1 : 0}); this.emit(0);}
  branch(opcode, name) {this.emit(opcode); this.references.push({at: this.bytes.length, name, relative: true}); this.emit(0);}
  store(address, value) {this.emit(0xa9, value); this.absolute(0x8d, address);}
  finish() {
    for (const ref of this.references) {
      if (!this.labels.has(ref.name)) throw new Error(`Unknown RSID fixture label ${ref.name}`);
      const address = this.address(ref.name);
      if (ref.relative) {
        const delta = address - (this.origin + ref.at + 1);
        if (delta < -128 || delta > 127) throw new Error('Fixture branch exceeds signed byte');
        this.bytes[ref.at] = delta & 255;
      } else if (ref.byte !== undefined) this.bytes[ref.at] = ref.byte ? address >>> 8 : address & 255;
      else {this.bytes[ref.at] = address & 255; this.bytes[ref.at + 1] = address >>> 8;}
    }
    return Uint8Array.from(this.bytes);
  }
}
function rsid(program, {load, init, name, songs = 1, basic = false}) {
  const bytes = new Uint8Array(126 + program.length), view = new DataView(bytes.buffer);
  bytes.set(new TextEncoder().encode('RSID')); view.setUint16(4, 2); view.setUint16(6, 124);
  // RSID reserves header loadAddress, playAddress and speed as zero.
  view.setUint16(10, basic ? 0 : init); view.setUint16(14, songs); view.setUint16(16, 1);
  view.setUint16(118, basic ? 0x16 : 0x14); view.setUint16(124, load, true);
  for (const [at, text] of [[22, name], [54, 'Tetorica contributors'], [86, '2026 BSD-3-Clause']]) bytes.set(new TextEncoder().encode(text).subarray(0, 32), at);
  bytes.set(program, 126); return bytes;
}
export const RSID_FIXTURE_PROFILES = Object.freeze(['cia-irq', 'raster-irq', 'cia-nmi', 'multispeed', 'busy-loop', 'masked-irq', 'no-ack-nmi', 'one-shot-irq', 'rom-required']);

/** Each handler is entered by the emulated CPU interrupt pins/vectors and ends
 * in RTI. There is no PSID play entry and no host-clocked play subroutine.
 * @param {string} [profile]
 * @param {{period?:number,secondPeriod?:number,rasterLine?:number}} [options]
 */
export function createRsidFixture(profile = 'cia-irq', {period = 997, secondPeriod = 2053, rasterLine = 50} = {}) {
  if (!RSID_FIXTURE_PROFILES.includes(profile)) throw new RangeError('Unknown RSID fixture profile');
  for (const value of [period, secondPeriod]) if (!Number.isInteger(value) || value < 128 || value > 65536) throw new RangeError('Fixture timer period must be 128..65536');
  if (!Number.isInteger(rasterLine) || rasterLine < 1 || rasterLine > 255) throw new RangeError('Fixture raster line must be 1..255');
  const load = 0x1000, p = new Program(load), nmi = ['cia-nmi', 'no-ack-nmi'].includes(profile);
  const busy = ['busy-loop', 'masked-irq', 'cia-nmi', 'no-ack-nmi'].includes(profile), cia = nmi ? 0xdd00 : 0xdc00;
  p.label('init'); p.emit(0x78); // SEI while changing masks, vectors and banking.
  if (profile === 'rom-required') {
    p.absolute(0x20, 0xffd2); p.emit(0x60);
    return {profile, bytes: rsid(p.finish(), {load, init: load, name: 'Tetorica RSID ROM dependency'}), loadAddress: load, initAddress: load, requiresRom: true};
  }
  p.store(0xdc0d, 0x7f); p.store(0xdd0d, 0x7f);
  p.absolute(0xad, 0xdc0d); p.absolute(0xad, 0xdd0d); // Clear pending CIA sources.
  p.store(0xdc0e, 0); p.store(0xdd0e, 0); p.store(0xd01a, 0); p.store(0xd019, 15);
  p.store(1, 0x35); // I/O visible; own RAM IRQ/NMI vectors, no KERNAL calls.
  p.store(COUNTER, 0);
  for (const [reg, value] of [[0, 0x45], [1, 0x1d], [2, 0], [3, 8], [5, 0], [6, 0xf0], [24, 8], [4, 0x41]]) p.store(SID + reg, value);
  const vector = nmi ? 0xfffa : 0xfffe;
  p.immediateLabel(0xa9, 'handler'); p.absolute(0x8d, vector);
  p.immediateLabel(0xa9, 'handler', true); p.absolute(0x8d, vector + 1);
  if (profile === 'raster-irq') {
    p.store(0xd011, 0); // DEN off avoids bad-line CPU stalls in the timing probe.
    p.store(0xd012, rasterLine); p.store(0xd019, 1); p.store(0xd01a, 1);
  } else {
    p.store(cia + 4, (period - 1) & 255); p.store(cia + 5, (period - 1) >>> 8);
    p.store(cia + 13, 0x81); p.store(cia + 14, profile === 'one-shot-irq' ? 0x19 : 0x11);
  }
  if (!nmi && profile !== 'masked-irq') p.emit(0x58); // CLI; NMI proves SEI does not mask it.
  if (busy) {p.label('idle'); p.absolute(0x4c, 'idle');}
  else p.emit(0x60);
  p.label('handler'); p.emit(0x48); // PHA; the handler does not alter X/Y.
  p.absolute(0xee, COUNTER); p.absolute(0xad, COUNTER); p.absolute(0x8d, SID + 2);
  if (profile === 'multispeed') {
    p.emit(0xc9, 8); p.branch(0xd0, 'ack');
    p.store(cia + 14, 0); p.store(cia + 4, (secondPeriod - 1) & 255); p.store(cia + 5, (secondPeriod - 1) >>> 8); p.store(cia + 14, 0x11);
  }
  p.label('ack');
  if (profile === 'raster-irq') p.store(0xd019, 1);
  else if (profile !== 'no-ack-nmi') p.absolute(0xad, cia + 13);
  p.emit(0x68, 0x40); // PLA; RTI returns to the actual interrupted CPU program.
  const program = p.finish();
  return {profile, bytes: rsid(program, {load, init: load, name: `Tetorica RSID ${profile}`}), program,
    loadAddress: load, initAddress: load, handlerAddress: p.address('handler'), counterAddress: COUNTER,
    periodCycles: profile === 'raster-irq' ? 19656 : period, secondPeriodCycles: secondPeriod,
    rasterLine, nmi, initBusyLoop: busy, cpuInterruptMasked: nmi || profile === 'masked-irq'};
}

/** A real tokenized original BASIC line, 10 SYS 2061, followed by a RAM tone
 * routine. Real ROMs can interpret it; separate synthetic test ROMs exercise the
 * ROM/RAM execution and $030C song selection plumbing, not a BASIC interpreter.
 */
export function createRsidBasicFixture() {
  const load = 0x0801, p = new Program(0x080d);
  p.absolute(0xad, 0x030c); p.emit(0x29, 1, 0xaa);
  p.absolute(0xbd, 'frequency-low'); p.absolute(0x8d, SID);
  p.absolute(0xbd, 'frequency-high'); p.absolute(0x8d, SID + 1);
  for (const [reg, value] of [[5, 0], [6, 0xf0], [24, 8], [4, 0x11]]) p.store(SID + reg, value);
  p.emit(0x60); p.label('frequency-low'); p.emit(0x45, 0x8a); p.label('frequency-high'); p.emit(0x1d, 0x3a);
  const code = p.finish(), program = new Uint8Array(12 + code.length);
  program.set([0x0b, 0x08, 10, 0, 0x9e, 0x32, 0x30, 0x36, 0x31, 0, 0, 0]); program.set(code, 12);
  return {profile: 'basic', bytes: rsid(program, {load, init: 0, name: 'Tetorica RSID BASIC test', songs: 2, basic: true}),
    loadAddress: load, initAddress: 0, entryAddress: 0x080d, markerAddress: 0x0400, frequencies: [0x1d45, 0x3a8a]};
}


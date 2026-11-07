// Newly authored diagnostic C64 programs, BSD-3-Clause. No game/ROM data.
import {createSidReferenceFixture} from '../fixtures/sid-reference/fixture.mjs';

const LOAD = 0x1000;
class Program {
  bytes = []; labels = new Map(); references = [];
  label(name) { this.labels.set(name, this.bytes.length); }
  emit(...bytes) { this.bytes.push(...bytes); }
  absolute(opcode, address) {
    this.emit(opcode);
    if (typeof address === 'string') { this.references.push({at: this.bytes.length, name: address}); this.emit(0, 0); }
    else this.emit(address & 255, address >>> 8);
  }
  address(name) { return LOAD + this.labels.get(name); }
  finish() {
    for (const {at, name} of this.references) {
      if (!this.labels.has(name)) throw new Error(`Missing fixture label ${name}`);
      const address = this.address(name); this.bytes[at] = address & 255; this.bytes[at + 1] = address >>> 8;
    }
    return Uint8Array.from(this.bytes);
  }
}
const frequency = midi => Math.round(440 * 2 ** ((midi - 69) / 12) * 16777216 / 985248);
export const SID_PLAYER_TEST_FREQUENCIES = Object.freeze([frequency(69), frequency(81)]);

/** Test-only bounded PSIDs. The two subtunes differ through init's A register.
 * long-init deliberately produces more than 4096 queued samples at 96kHz.
 * @param {'two-subtunes'|'long-init'|'dense-trace'|'sid-reads'|'init-loop'|'play-loop'|'late-play-loop'|'rom-read'|'io-write'} [kind]
 */
export function createSidPlayerTestFixture(kind = 'two-subtunes') {
  if (!['two-subtunes', 'long-init', 'dense-trace', 'sid-reads', 'init-loop', 'play-loop', 'late-play-loop', 'rom-read', 'io-write'].includes(kind)) throw new RangeError('Unknown SID player test fixture');
  const p = new Program();
  const set = (register, value) => { p.emit(0xa9, value); p.absolute(0x8d, 0xd400 + register); };
  p.label('init');
  if (kind === 'init-loop') p.absolute(0x4c, 'init');
  else if (kind === 'rom-read') p.absolute(0xad, 0xe000);
  else if (kind === 'io-write') { p.emit(0xa9, 0); p.absolute(0x8d, 0xd020); }
  else {
    p.emit(0x29, 1, 0xaa); // AND #1; TAX: preserve zero-based song through setup.
    set(4, 0); set(5, 0); set(6, 0xf0); set(24, 8);
    p.absolute(0xbd, 'frequency-low'); p.absolute(0x8d, 0xd400);
    p.absolute(0xbd, 'frequency-high'); p.absolute(0x8d, 0xd401);
    set(4, 0x11);
    if (kind === 'sid-reads') {
      // Near one OSC3 byte step per cycle makes an off-by-one bus read visible.
      set(14, 255); set(15, 255); set(19, 0); set(20, 0xf0); set(18, 0x21);
    }
    if (kind === 'dense-trace') for (let i = 0; i < 5000; ++i) set(24, i & 15);
    if (kind === 'late-play-loop') {p.emit(0xa9, 0); p.absolute(0x8d, 'counter');}
    if (kind === 'long-init') for (let i = 0; i < 30000; ++i) p.emit(0xea);
  }
  p.emit(0x60);
  p.label('play');
  if (kind === 'sid-reads') {
    p.absolute(0xad, 0xd41b); p.absolute(0x8d, 0xd400);
    p.absolute(0xad, 0xd41c); p.absolute(0x8d, 0xd401); p.emit(0x60);
  } else if (kind === 'play-loop') p.absolute(0x4c, 'play');
  else if (kind === 'late-play-loop') {
    p.absolute(0xee, 'counter'); p.absolute(0xad, 'counter');
    p.emit(0xc9, 20, 0xb0, 1, 0x60); // CMP #20; BCS hang; RTS.
    p.label('hang'); p.absolute(0x4c, 'hang');
  }
  else p.emit(0x60);
  p.label('frequency-low'); p.emit(...SID_PLAYER_TEST_FREQUENCIES.map(value => value & 255));
  p.label('frequency-high'); p.emit(...SID_PLAYER_TEST_FREQUENCIES.map(value => value >>> 8));
  p.label('counter'); p.emit(0);
  const program = p.finish(), source = createSidReferenceFixture('tone', {embeddedLoadAddress: false}).bytes;
  const bytes = new Uint8Array(124 + program.length); bytes.set(source.subarray(0, 124)); bytes.set(program, 124);
  const view = new DataView(bytes.buffer);
  view.setUint16(8, LOAD); view.setUint16(10, p.address('init')); view.setUint16(12, p.address('play'));
  view.setUint16(14, kind === 'two-subtunes' ? 2 : 1); view.setUint16(16, 1);
  bytes.fill(0, 0x16, 0x36); bytes.set(new TextEncoder().encode(`Tetorica test ${kind}`).subarray(0, 32), 0x16);
  return bytes;
}

/** High-RAM entry fixtures jump to a RAM tail before restoring $01=$37.
 * Thus every subsequent A000/BFFF call must select RAM again, and the BFFF
 * opcode crosses into C000 without making an ordinary BASIC ROM call.
 */
export function createSidPlayerBankFixture({initAddress = 0x1000, playAddress = 0x1100} = {}) {
  for (const address of [initAddress, playAddress]) if (![0x1000, 0x1100, 0xa000, 0xbfff].includes(address)) throw new RangeError('Unknown bank fixture entry');
  if (initAddress === playAddress) throw new RangeError('Bank fixture entries must differ');
  const load = 0x1000, tail = 0xc100, program = new Uint8Array(tail + 6 - load);
  const set = (register, value) => [0xa9, value, 0x8d, (0xd400 + register) & 255, (0xd400 + register) >>> 8];
  const jump = [0x4c, tail & 255, tail >>> 8];
  const frequency = SID_PLAYER_TEST_FREQUENCIES[0];
  const init = [...set(5, 0), ...set(6, 0xf0), ...set(0, frequency & 255), ...set(1, frequency >>> 8), ...set(24, 8), ...set(4, 0x11), ...jump];
  const play = [...set(4, 0x21), ...jump];
  program.set(init, initAddress - load); program.set(play, playAddress - load);
  program.set([0xa9, 0x37, 0x85, 1, 0x60], tail - load);
  const header = createSidReferenceFixture('tone', {embeddedLoadAddress: false}).bytes.subarray(0, 124);
  const bytes = new Uint8Array(124 + program.length); bytes.set(header); bytes.set(program, 124);
  const view = new DataView(bytes.buffer); view.setUint16(8, load); view.setUint16(10, initAddress); view.setUint16(12, playAddress);
  return bytes;
}

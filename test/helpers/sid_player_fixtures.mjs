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
  branch(opcode, name) {this.emit(opcode); this.references.push({at: this.bytes.length, name, relative: true}); this.emit(0);}
  address(name) { return LOAD + this.labels.get(name); }
  finish() {
    for (const {at, name, relative} of this.references) {
      if (!this.labels.has(name)) throw new Error(`Missing fixture label ${name}`);
      const address = this.address(name);
      if (relative) {
        const delta = address - (LOAD + at + 1); if (delta < -128 || delta > 127) throw new Error('Fixture branch exceeds signed byte');
        this.bytes[at] = delta & 255;
      } else {this.bytes[at] = address & 255; this.bytes[at + 1] = address >>> 8;}
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

function programFile(program, init, play, name) {
  const header = createSidReferenceFixture('tone', {embeddedLoadAddress: false}).bytes.subarray(0, 124);
  const bytes = new Uint8Array(124 + program.length); bytes.set(header); bytes.set(program, 124);
  const view = new DataView(bytes.buffer); view.setUint16(8, LOAD); view.setUint16(10, init); view.setUint16(12, play);
  bytes.fill(0, 22, 54); bytes.set(new TextEncoder().encode(name).subarray(0, 32), 22); return bytes;
}

/** The real PAL environment byte controls a branch and thus the audible note.
 * This does not merely read a host-provided metadata field back to the test.
 */
export function createSidPlayerPalFixture() {
  const p = new Program(), frequencies = [0x0ea2, 0x1d45];
  p.label('init'); p.emit(0xa0, 0); p.absolute(0xad, 0x02a6); p.emit(0xc9, 1); p.branch(0xd0, 'selected'); p.emit(0xc8);
  p.label('selected'); p.absolute(0xb9, 'frequency-low'); p.absolute(0x8d, 0xd400);
  p.absolute(0xb9, 'frequency-high'); p.absolute(0x8d, 0xd401);
  for (const [reg, value] of [[5, 0], [6, 0xf0], [24, 8], [4, 0x11]]) {p.emit(0xa9, value); p.absolute(0x8d, 0xd400 + reg);}
  p.emit(0x60); p.label('play'); p.emit(0x60);
  p.label('frequency-low'); p.emit(...frequencies.map(value => value & 255)); p.label('frequency-high'); p.emit(...frequencies.map(value => value >>> 8));
  return {bytes: programFile(p.finish(), p.address('init'), p.address('play'), 'Tetorica PAL environment'), palFrequency: frequencies[1], nonPalFrequency: frequencies[0]};
}

/** Both routines record their actual $01 entry map, then change it before RTS.
 * The next host call must establish its own specified map every time.
 */
export function createSidPlayerBankEnvironmentFixture({initAddress = 0x1000, playAddress = 0x1100, returnBank = 0x35} = {}) {
  for (const address of [initAddress, playAddress]) if (![0x1000, 0x1100, 0xa000, 0xc000].includes(address)) throw new RangeError('Unknown bank environment entry');
  if (initAddress === playAddress || ![0x35, 0x36, 0x37].includes(returnBank)) throw new RangeError('Invalid bank environment fixture');
  const program = new Uint8Array(Math.max(initAddress, playAddress) - LOAD + 128);
  const set = (reg, value) => [0xa9, value, 0x8d, reg & 255, reg >>> 8];
  const record = register => [0xa5, 1, 0x29, 7, 0x8d, register, 0xd4];
  const init = [...set(0xd400, 0x45), ...set(0xd401, 0x1d), ...set(0xd405, 0), ...set(0xd406, 0xf0), ...set(0xd418, 8), ...set(0xd404, 0x11), ...record(2), ...set(1, returnBank), 0x60];
  const play = [...record(3), 0xee, 0x30, 3, ...set(1, returnBank), 0x60];
  program.set(init, initAddress - LOAD); program.set(play, playAddress - LOAD);
  return {bytes: programFile(program, initAddress, playAddress, 'Tetorica bank environment'), initBank: initAddress < 0xa000 ? 7 : 6, playBank: playAddress < 0xa000 ? 7 : 6};
}

export const SID_PLAYER_JAM_OPCODES = Object.freeze([0x02, 0x12, 0x22, 0x32, 0x42, 0x52, 0x62, 0x72, 0x92, 0xb2, 0xd2, 0xf2]);
export function createSidPlayerJamFixture({opcode = 2, phase = 'init', bank = 0x37} = {}) {
  if (!SID_PLAYER_JAM_OPCODES.includes(opcode) || !['init', 'play'].includes(phase) || ![0x35, 0x37].includes(bank)) throw new RangeError('Invalid JAM fixture');
  const bytes = createSidPlayerTestFixture(), view = new DataView(bytes.buffer), entry = view.getUint16(phase === 'init' ? 10 : 12);
  bytes.set([0xa9, bank, 0x85, 1, opcode], 124 + entry - LOAD);
  return {bytes, address: entry + 4, opcode, phase};
}

/** Original register-block writer mirroring the indexed addressing pattern,
 * never any game's bytes. Each dummy read is in $D300..$D3FF, while its final
 * store is one of the actual SID registers $D400..$D418.
 */
export function createSidPlayerIndexedStoreFixture({mode = 'absolute-x', realIoRead = false, singleIndex = null} = {}) {
  if (!['absolute-x', 'absolute-y', 'indirect-y'].includes(mode)) throw new RangeError('Unknown indexed store fixture mode');
  if (singleIndex !== null && (!Number.isInteger(singleIndex) || singleIndex < 1 || singleIndex > 255)) throw new RangeError('Invalid single indexed store index');
  const p = new Program(), registers = Array(25).fill(0);
  Object.assign(registers, {0: 0x45, 1: 0x1d, 2: 0, 3: 8, 4: 0x41, 5: 0, 6: 0xf0, 14: 255, 15: 255, 18: 0x21, 19: 0, 20: 0xf0, 24: 8});
  const set = (reg, value) => {p.emit(0xa9, value); p.absolute(0x8d, 0xd400 + reg);};
  p.label('init'); if (realIoRead) p.absolute(0xad, 0xd318);
  for (const reg of [0, 1, 2, 3, 5, 6, 14, 15, 19, 20, 24, 4, 18]) set(reg, registers[reg]);
  if (mode === 'indirect-y') p.emit(0xa9, 255, 0x85, 0xf0, 0xa9, 0xd3, 0x85, 0xf1);
  p.emit(0x60); p.label('play');
  p.emit(mode === 'absolute-x' ? 0xa2 : 0xa0, singleIndex ?? 25); p.label('loop');
  if (singleIndex === null) p.absolute(mode === 'absolute-x' ? 0xbd : 0xb9, 'table'); else p.emit(0xa9, 8);
  if (mode === 'indirect-y') p.emit(0x91, 0xf0); else p.emit(mode === 'absolute-x' ? 0x9d : 0x99, 0xff, 0xd3);
  if (singleIndex === null) {p.emit(mode === 'absolute-x' ? 0xca : 0x88); p.branch(0xd0, 'loop');}
  // These real SID reads must keep their CPU values and bus clocks after the
  // narrow dummy-read compatibility rule is added.
  p.absolute(0xad, 0xd41b); p.absolute(0x8d, 0xd400); p.absolute(0xad, 0xd41c); p.absolute(0x8d, 0xd401); p.emit(0x60);
  p.label('table'); p.emit(0, ...registers);
  return {bytes: programFile(p.finish(), p.address('init'), p.address('play'), `Tetorica indexed ${mode}`), mode, registers,
    dummyAddress: singleIndex === null ? null : 0xd300 | ((singleIndex - 1) & 255)};
}

// SPDX-License-Identifier: BSD-3-Clause
import { ssfFromProgram } from './scsp_ssf_fixture.mjs';

/** Original 68000 driver that uses timer IRQs to switch a constant PCM voice
 * between full output and silence. Each transition can be located in PCM. */
export function createScspSsfTimerFixture(timer, { enabled = true } = {}) {
	const timers = {
		A: { register: 0x418, pending: 0x040, levelBit: 0x40, level: 2, prescale: 5, counter: 0xf7 },
		B: { register: 0x41a, pending: 0x080, levelBit: 0x80, level: 4, prescale: 4, counter: 0xf3 },
		C: { register: 0x41c, pending: 0x100, levelBit: 0x80, level: 5, prescale: 6, counter: 0xfb },
	};
	const config = timers[timer];
	if (!Object.hasOwn(timers, timer)) throw new RangeError('Expected timer A, B or C');
	const { register, pending, levelBit, level, prescale, counter } = config;
	const scspBase = 0x100000;
	const enable = 0x41e, status = 0x420, acknowledge = 0x422;
	const entry = 0x100, handler = 0x400, fault = 0x800, sampleStart = 0x1000;
	const image = new Uint8Array(0x1080);
	const view = new DataView(image.buffer);
	view.setUint32(0, 0x7fff0, false);
	view.setUint32(4, entry, false);
	for (let vector = 25; vector <= 31; vector++)
		view.setUint32(vector * 4, vector === 24 + level ? handler : fault, false);

	let address = entry;
	const word = (value) => {
		view.setUint16(address, value, false);
		address += 2;
	};
	const long = (value) => {
		view.setUint32(address, value, false);
		address += 4;
	};
	const immediate = (opcode, target, value) => {
		word(opcode);
		word(value);
		long(scspBase + target);
	};
	const writeWord = (target, value) => immediate(0x33fc, target, value); // MOVE.W #value,abs.L
	const writeByte = (target, value) => immediate(0x13fc, target, value); // MOVE.B #value,abs.L
	const writeTimerBit = (target) =>
		pending < 0x100 ? writeByte(target + 1, pending) : writeByte(target, pending >> 8);
	const readWord = (target) => {
		word(0x3039); // MOVE.W abs.L,D0
		long(scspBase + target);
	};
	const readMasked = (target, mask) => {
		readWord(target);
		word(0x0240); // ANDI.W #mask,D0
		word(mask);
	};
	const branch = (opcode, target) => {
		word(opcode);
		word(target - address); // 16-bit displacement from the extension word.
	};

	word(0x46fc); // MOVE.W #$2000,SR
	word(0x2000);
	readWord(0x404); // Empty MIDI input/output FIFOs with no external MIDI.
	word(0x0c40); // CMPI.W #$0900,D0
	word(0x0900);
	branch(0x6600, fault);
	writeWord(0x7c0, 0); // Drivers may clear the full DSP area, including its gap.
	writeWord(0x7fe, 0);
	writeWord(0xc00, 0); // Clearing reset-zero TEMP and MEMS has no effect.
	writeWord(0xe02, 0);
	for (const [target, value] of [
		[0x400, 0x0200], [2, sampleStart], [4, 0], [6, 64], [8, 31],
		[10, 0x3c1f], [22, 0xe000], [0, 0x1820],
	])
		writeWord(target, value);
	for (let bit = 0; bit < 3; bit++)
		writeWord(0x424 + 2 * bit, level & (1 << bit) ? levelBit : 0);
	writeWord(enable, 0);

	writeWord(status, pending); // Timer status bits are read-only.
	readMasked(status, pending);
	branch(0x6600, fault); // BNE.W
	writeWord(register, (prescale << 8) | counter);
	const poll = address;
	readMasked(status, pending);
	branch(0x6700, poll); // BEQ.W: expiry must latch even with delivery disabled.
	writeWord(status, 0);
	readMasked(status, pending);
	branch(0x6700, fault); // A write to SCIPD cannot acknowledge the timer.
	if (enabled) writeTimerBit(enable);

	const stop = address;
	word(0x4e72); // STOP #$2000
	word(0x2000);
	branch(0x6000, stop); // BRA.W: RTE resumes the stopped foreground.

	address = handler;
	readMasked(enable, pending);
	branch(0x6700, fault); // Do not accept a premature/masked IRQ.
	readMasked(status, pending);
	branch(0x6700, fault); // The autovector must not clear the pending bit.
	if (timer === 'A') {
		word(0x4a41); // TST.W D1
		branch(0x6600, address + 8); // BNE.W past MOVEQ and RTE.
		word(0x7201); // MOVEQ #1,D1
		word(0x4e73); // First RTE leaves the request pending. It must reenter.
	}
	immediate(0x0a79, 0x400, 0x000f); // EORI.W #$000f, $100400
	writeByte(register + 1, counter); // Preserve the high-byte prescaler.
	writeTimerBit(acknowledge);
	readMasked(status, pending);
	branch(0x6600, fault); // SCIRE must clear exactly the requested source.
	word(0x4e73); // RTE

	address = fault;
	writeWord(0x100000, 1); // A test assertion failed. Deliberately access unmapped $200000.
	for (let index = 0; index < 64; index++) view.setInt16(sampleStart + 2 * index, 8192, false);
	const path = `/ssf/timer-${timer.toLowerCase()}.ssf`;
	return {
		files: [{ path, data: ssfFromProgram(image, 0, `title=Original SCSP timer ${timer}\n`) }],
		path,
		expectedPeriod: (0xff - counter) * (1 << prescale),
		level,
	};
}

// SPDX-License-Identifier: BSD-3-Clause
// Original synthetic SSF containers. No recorded program or game data.
import { psfFromExe } from './spu_psf_fixture.mjs';

export function ssfFromProgram(data, address = 0, tags = '', options = {}) {
	const program = new Uint8Array(4 + data.length);
	new DataView(program.buffer).setUint32(0, address, true);
	program.set(data, 4);
	return psfFromExe(program, tags, { ...options, version: 0x11 });
}

export function createScspSsfContainerFixture() {
	const image = new Uint8Array(256);
	const view = new DataView(image.buffer);
	view.setUint32(0, 0x7fff0, false);
	view.setUint32(4, 0x20, false);
	image.set([0x60, 0xfe], 0x20); // Original 68000 BRA to itself.
	const standalone = ssfFromProgram(
		image,
		0,
		'title=Original SSF container\nlength=0:02\nfade=0:00,5\n',
	);
	const library = ssfFromProgram(image, 0, 'title=Original library\n');
	const mini = ssfFromProgram(
		Uint8Array.of(1, 2),
		0x30,
		'_lib=lib\\Driver.ssflib\n_lib2=patch.ssflib\ntitle=Original MiniSSF\nlength=2\nfade=0.25\n',
	);
	const patch = ssfFromProgram(Uint8Array.of(3), 0x31);
	return {
		image,
		standalone,
		library,
		mini,
		patch,
		files: [
			{ path: 'Demo/track.ssf', data: mini },
			{ path: 'Demo/lib/Driver.ssflib', data: library },
			{ path: 'Demo/patch.ssflib', data: patch },
		],
	};
}

/** Original 68000 program configures one SCSP PCM16 sine loop, then idles.
 * Every instruction and sample is authored here. MiniSSF replaces the pitch
 * immediate inside the shared library's MOVE.W instruction before CPU reset.
 */
export function createScspSsfPlaybackFixture({ pitch = 0, miniPitch = 0x7800 } = {}) {
	for (const value of [pitch, miniPitch]) {
		if (!Number.isInteger(value) || value < 0 || value > 0xffff)
			throw new RangeError('Fixture pitch must be a 16-bit register word');
	}
	const image = new Uint8Array(0x1080);
	const view = new DataView(image.buffer);
	view.setUint32(0, 0x7fff0, false);
	view.setUint32(4, 0x100, false);
	let address = 0x100;
	const word = (value) => {
		view.setUint16(address, value, false);
		address += 2;
	};
	const write = (register, value) => {
		word(0x33fc); // MOVE.W #immediate, absolute-long address.
		const immediateAddress = address;
		word(value);
		view.setUint32(address, 0x100000 + register, false);
		address += 4;
		return immediateAddress;
	};
	word(0x46fc);
	word(0x2000); // MOVE.W #$2000, SR, supervisor with interrupts enabled.
	const registerWrites = [
		[0x400, 0x020f],
		[2, 0x1000],
		[4, 0],
		[6, 64],
		[8, 31],
		[10, 0x3c1f],
		[12, 0],
		[14, 0],
		[18, 0],
		[20, 0],
		[22, 0xe000],
	];
	for (const [register, value] of registerWrites) write(register, value);
	const pitchImmediateAddress = write(16, pitch);
	write(0, 0x1820); // KEYONEX / KEYONB, forward loop, PCM16.
	word(0x60fe); // BRA.S to itself.
	const pcm = new Uint8Array(128);
	const pcmView = new DataView(pcm.buffer);
	for (let index = 0; index < 64; index++)
		pcmView.setInt16(index * 2, Math.round(8192 * Math.sin((index * Math.PI) / 32)), false);
	image.set(pcm, 0x1000);
	const tags = 'title=Tetorica original SSF sine\nartist=Tetorica\nlength=0:02\nfade=0:00.25\n';
	const standalone = ssfFromProgram(image, 0, tags);
	const library = ssfFromProgram(image, 0);
	const patch = new Uint8Array(2);
	new DataView(patch.buffer).setUint16(0, miniPitch, false);
	const mini = ssfFromProgram(patch, pitchImmediateAddress, '_lib=lib/driver.ssflib\n' + tags);
	return {
		image,
		pcm,
		standalone,
		library,
		mini,
		pitchImmediateAddress,
		registerWrites,
		standaloneFiles: [{ path: '/ssf/standalone.ssf', data: standalone }],
		files: [
			{ path: '/ssf/Demo/track.minissf', data: mini },
			{ path: '/ssf/Demo/lib/driver.ssflib', data: library },
		],
	};
}

/** Original 68000 driver for observing two physical SCSP slots.
 * Slot 1 plays PCM16 sine and Slot 2 plays PCM8 triangle. The CPU alternates
 * Slot 1's pitch/TL/first PCM word and Slot 2's pan after a counted delay. The samples,
 * register values and machine instructions are authored here.
 */
export function createScspSsfLiveFixture() {
	const image = new Uint8Array(0x1140);
	const view = new DataView(image.buffer);
	view.setUint32(0, 0x7fff0, false);
	view.setUint32(4, 0x100, false);
	let address = 0x100;
	const word = (value) => {
		view.setUint16(address, value, false);
		address += 2;
	};
	const long = (value) => {
		view.setUint32(address, value, false);
		address += 4;
	};
	const write = (register, value) => {
		word(0x33fc); // MOVE.W #immediate, absolute-long address.
		word(value);
		long(0x100000 + register);
	};
	const delay = () => {
		word(0x203c); // MOVE.L #150000,D0.
		long(150000);
		word(0x5380); // SUBQ.L #1,D0.
		word(0x66fc); // BNE.S to SUBQ, until the countdown reaches zero.
	};
	word(0x46fc);
	word(0x2000); // Supervisor, interrupts enabled.
	write(0x400, 0x020f);
	for (const [register, value] of [
		[2, 0x1000],
		[4, 0],
		[6, 64],
		[8, 31],
		[10, 0x3c1f],
		[12, 12],
		[14, 0],
		[16, 0],
		[18, 0x2953],
		[20, 0],
		[22, 0xe000],
	])
		write(register, value);
	for (const [register, value] of [
		[2, 0x1100],
		[4, 0],
		[6, 64],
		[8, (3 << 6) | 27],
		[10, (15 << 10) | (4 << 5) | 23],
		[12, 0x200 | 32],
		[14, (63 << 6) | 31],
		[16, 0x7800],
		[18, 0x578a],
		[20, 0],
		[22, 0xa600],
	])
		write(0x20 + register, value);
	write(0x20, 0x0830); // Slot 2 KEYONB, forward loop, PCM8.
	write(0, 0x1820); // Execute both KEYONB requests, Slot 1 PCM16.
	const loopAddress = address;
	delay();
	word(0x33fc);
	word(0x2000);
	long(0x1000); // Positive first PCM16 sample, shared CPU / SCSP RAM.
	write(12, 36);
	write(16, 0x7800);
	write(0x20 + 22, 0xb600);
	delay();
	word(0x33fc);
	word(0xe000);
	long(0x1000); // Negative first PCM16 sample.
	write(12, 12);
	write(16, 0);
	write(0x20 + 22, 0xa600);
	word(0x4ef9); // JMP absolute-long, repeating the two settings.
	long(loopAddress);
	for (let index = 0; index < 64; index++) {
		view.setInt16(
			0x1000 + index * 2,
			Math.round(8192 * Math.sin((index * Math.PI) / 32)),
			false,
		);
		view.setInt8(0x1100 + index, Math.round(64 * (1 - 4 * Math.abs(index / 64 - 0.5))));
	}
	const tags =
		'title=Tetorica original SSF Live driver\nartist=Tetorica\nlength=0:08\nfade=0:00.25\n';
	const bytes = ssfFromProgram(image, 0, tags);
	return {
		image,
		bytes,
		files: [{ path: '/ssf/live-driver.ssf', data: bytes }],
		loopAddress,
		slots: [
			{
				index: 0,
				bits: 16,
				start: 0x1000,
				length: 64,
				attackRate: 31,
				totalLevels: [12, 36],
			},
			{ index: 1, bits: 8, start: 0x1100, length: 64, attackRate: 27, totalLevels: [32] },
		],
	};
}

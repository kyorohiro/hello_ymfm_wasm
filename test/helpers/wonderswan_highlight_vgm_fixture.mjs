// SPDX-License-Identifier: BSD-3-Clause
// Original hardware register automation for Live display tests. No game assets.
import { createWonderSwanManualVgm } from './wonderswan_manual_vgm_fixture.mjs';

export const ASWAN_HIGHLIGHT_WRITES = [
	[1.2, 'register', 0x88, 0xef],
	[1.8, 'memory', 0x1200, 0x4a],
	[2.4, 'register', 0x88, 0xed],
	[3, 'register', 0x8c, 3],
	[3.5, 'register', 0x8d, 6],
	[4, 'register', 0x8e, 0x13],
	[4.5, 'register', 0x8e, 0x15],
	[5, 'register', 0x88, 0xcd],
	[5.5, 'register', 0x88, 0xad],
	[6, 'register', 0x88, 0x8d],
	[6.5, 'memory', 0x1200, 0x39],
];

export function createWonderSwanHighlightVgm() {
	const original = createWonderSwanManualVgm();
	let end = 0x100;
	while (original[end] !== 0x61) {
		if (original[end] === 0xbc) end += 3;
		else if (original[end] === 0xc6) end += 4;
		else throw new Error('Unexpected highlight fixture prefix');
	}
	const data = [...original.subarray(0x100, end), 0xbc, 0x10, 0xcf];
	let frame = 0;
	const wait = (count) => {
		while (count) {
			const n = Math.min(count, 65535);
			data.push(0x61, n & 255, n >>> 8);
			count -= n;
		}
	};
	for (const [seconds, kind, address, value] of ASWAN_HIGHLIGHT_WRITES) {
		const at = Math.round(seconds * 44100);
		wait(at - frame);
		frame = at;
		if (kind === 'memory') data.push(0xc6, address >>> 8, address & 255, value);
		else data.push(0xbc, address - 0x80, value);
	}
	wait(8 * 44100 - frame);
	data.push(0x66);
	const bytes = new Uint8Array(0x100 + data.length),
		view = new DataView(bytes.buffer);
	bytes.set(original.subarray(0, 0x100));
	view.setUint32(4, bytes.length - 4, true);
	view.setUint32(0x18, 8 * 44100, true);
	bytes.set(data, 0x100);
	return bytes;
}

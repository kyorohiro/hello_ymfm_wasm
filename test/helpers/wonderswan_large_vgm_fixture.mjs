// SPDX-License-Identifier: BSD-3-Clause
// Original dense driver-refresh score. No game music, ROM or captured assets.
import { createWonderSwanVgm } from './wonderswan_vgm_fixture.mjs';

export const WONDERSWAN_LARGE_VGM_WRITES = 270000;

export function createWonderSwanLargeVgm({ writes = WONDERSWAN_LARGE_VGM_WRITES } = {}) {
	if (!Number.isSafeInteger(writes) || writes < 1 || writes > 500000)
		throw new RangeError('Invalid dense fixture write count');
	const original = createWonderSwanVgm({ mode: 'noise', seconds: 0.1, loop: false });
	let end = 0x100;
	while (original[end] === 0xbc || original[end] === 0xc6) end += original[end] === 0xbc ? 3 : 4;
	const prefix = original.subarray(0x100, end),
		bytes = new Uint8Array(0x100 + prefix.length + 3 + writes * 4 + 1),
		view = new DataView(bytes.buffer);
	bytes.set(original.subarray(0, 0x100));
	bytes.set(prefix, 0x100);
	let position = 0x100 + prefix.length;
	// CH1 square and CH4 Noise both sound. Reasserting this full control byte
	// also matters to Live/manual gate ownership even when its value is unchanged.
	bytes.set([0xbc, 0x10, 0x89], position);
	position += 3;
	for (let index = 0; index < writes; index++) {
		const phase = index % 4,
			register = [0x10, 0x0e, 0, 8][phase],
			value =
				phase === 0
					? 0x89
					: phase === 1
						? 0x18
						: phase === 2
							? 0x4c
							: (index >>> 12) & 1
								? 0xef
								: 0xff;
		// Identical Noise-reset writes have real effects; value deduplication
		// must not become a workaround for a prepared-timeline storage limit.
		bytes.set([0xbc, register, value, 0x70], position);
		position += 4;
	}
	bytes[position] = 0x66;
	view.setUint32(4, bytes.length - 4, true);
	view.setUint32(0x18, writes, true);
	return bytes;
}

// SPDX-License-Identifier: BSD-3-Clause
// Original short register demonstrations, no game assets.
export function createDemoVgm({ psg = true, fm = true, stereo = true } = {}) {
	const events = [];
	if (psg) {
		if (stereo) events.push(0x4f, 0x10);
		events.push(0x50, 0x8e, 0x50, 0x0f, 0x50, 0x94);
	}
	if (fm) events.push(0x51, 0x30, 0x14, 0x51, 0x10, 0x20, 0x51, 0x20, 0x18);
	events.push(0x61, 0x22, 0x56);
	if (psg && stereo) events.push(0x4f, 0x01);
	events.push(0x61, 0x22, 0x56);
	if (psg) events.push(0x50, 0x9f);
	if (fm) events.push(0x51, 0x20, 0x08);
	events.push(0x61, 0x44, 0xac, 0x66);
	const bytes = new Uint8Array(0x100 + events.length),
		v = new DataView(bytes.buffer);
	bytes.set([0x56, 0x67, 0x6d, 0x20]);
	v.setUint32(4, bytes.length - 4, true);
	v.setUint32(8, 0x171, true);
	v.setUint32(0x0c, psg ? 3579545 : 0, true);
	v.setUint32(0x10, fm ? 3579545 : 0, true);
	v.setUint32(0x18, 88200, true);
	v.setUint32(0x34, 0xcc, true);
	bytes.set(events, 0x100);
	return bytes;
}

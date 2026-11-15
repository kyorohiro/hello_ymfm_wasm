// SPDX-License-Identifier: BSD-3-Clause
// Self-authored waves and register automation, no game music or ROM data.
import { createWonderSwanVgm } from './wonderswan_vgm_fixture.mjs';
export function createAswanPausedSongFixture({
	frames = 22050,
	changes = [
		[512, 0x88, 0xf3],
		[5000, 0x88, 0xa5],
	],
	channel = 0,
} = {}) {
	const original = createWonderSwanVgm({ seconds: frames / 44100, channel, loop: false });
	let position = 256;
	while ([0xbc, 0xc6].includes(original[position]))
		position += original[position] === 0xbc ? 3 : 4;
	const commands = [...original.subarray(256, position)];
	let frame = 0;
	const wait = (count) => {
		while (count) {
			const n = Math.min(count, 65535);
			commands.push(0x61, n & 255, n >>> 8);
			count -= n;
		}
	};
	for (const [at, register, value] of changes) {
		if (at < frame || at > frames) throw new RangeError('Invalid fixture event');
		wait(at - frame);
		frame = at;
		commands.push(0xbc, register - 0x80, value);
	}
	wait(frames - frame);
	commands.push(0x66);
	const bytes = new Uint8Array(256 + commands.length);
	bytes.set(original.subarray(0, 256));
	bytes.set(commands, 256);
	const view = new DataView(bytes.buffer);
	view.setUint32(4, bytes.length - 4, true);
	view.setUint32(0x18, frames, true);
	return bytes;
}

/** Original register-score fixture for concurrent ASWAN playback/manual controls.
 * No game music, ROM, metadata or external assets are included. The first
 * driver period write takes pitch at2.5s; control at3.5s reasserts its gate.
 */
export function createWonderSwanManualVgm({ mode = 'wave' } = {}) {
	if (!['wave', 'sweep', 'noise'].includes(mode))
		throw new TypeError('Unknown manual fixture source');
	const clock = 3072000,
		rate = 44100,
		duration = 8,
		channel = mode === 'noise' ? 3 : mode === 'sweep' ? 2 : 0;
	const data = [],
		write = (address, value) => data.push(0xbc, address - 0x80, value & 255);
	const wait = (seconds) => {
		let count = Math.round(seconds * rate);
		while (count) {
			const n = Math.min(count, 65535);
			data.push(0x61, n & 255, n >>> 8);
			count -= n;
		}
	};
	const pitch = (ch, hz) => {
		const period = 2048 - Math.round(clock / (32 * hz));
		write(0x80 + ch * 2, period);
		write(0x81 + ch * 2, period >>> 8);
	};
	const wave = (ch, shape) => {
		for (let index = 0; index < 16; index++) {
			const address = 0x1200 + ch * 16 + index,
				value = shape === 'square' ? (index < 8 ? 255 : 0) : index * 17;
			data.push(0xc6, address >>> 8, address & 255, value);
		}
	};
	for (let ch = 0; ch < 4; ch++) {
		wave(ch, 'square');
		pitch(ch, [220, 330, 440, 550][ch]);
		write(0x88 + ch, 255);
	}
	write(0x8f, 0x48);
	write(0x91, 8);
	write(0x8e, 0x18);
	write(0x8c, 1);
	write(0x8d, 4);
	const control = (1 << channel) | (mode === 'sweep' ? 64 : mode === 'noise' ? 128 : 0);
	write(0x90, control);
	wait(2.5);
	pitch(channel, 440);
	wait(1);
	wave(channel, 'square');
	write(0x88 + channel, 255);
	pitch(channel, 440);
	write(0x90, control);
	wait(3);
	write(0x90, control & ~(1 << channel));
	wait(1.5);
	data.push(0x66);
	const bytes = new Uint8Array(0x100 + data.length),
		view = new DataView(bytes.buffer);
	bytes.set([0x56, 0x67, 0x6d, 0x20]);
	view.setUint32(4, bytes.length - 4, true);
	view.setUint32(8, 0x171, true);
	view.setUint32(0x18, duration * rate, true);
	view.setUint32(0x34, 0x100 - 0x34, true);
	view.setUint32(0xc0, clock, true);
	bytes.set(data, 0x100);
	return bytes;
}

/** Selected CH2 starts as complete Wave RAM, then the driver changes it into
 * a transient DAC at0.35s. CH1 keeps sounding so playback remains observable. */
export function createWonderSwanPcmTransitionVgm({transitionSeconds=0.35}={}) {
	if(!Number.isFinite(transitionSeconds)||transitionSeconds<=0||transitionSeconds>=4)throw RangeError('Expected a PCM transition inside the four-second fixture');
	const original = createWonderSwanManualVgm();
	let end = 0x100;
	while (original[end] !== 0x61)
		end +=
			original[end] === 0xbc
				? 3
				: original[end] === 0xc6
					? 4
					: (() => {
							throw Error('Unexpected fixture prefix');
						})();
	const data = Array.from(original.subarray(0x100, end));
	const wait = (frames) => {
		while (frames) {
			const count = Math.min(frames, 65535);
			data.push(0x61, count & 255, count >>> 8);
			frames -= count;
		}
	};
	wait(Math.round(transitionSeconds * 44100));
	data.push(0xbc, 0x14, 15, 0xbc, 0x10, 0x23, 0xbc, 9, 128);
	wait(4 * 44100 - Math.round(transitionSeconds * 44100));
	data.push(0x66);
	const bytes = new Uint8Array(0x100 + data.length),
		view = new DataView(bytes.buffer);
	bytes.set(original.subarray(0, 0x100));
	view.setUint32(4, bytes.length - 4, true);
	view.setUint32(0x18, 4 * 44100, true);
	bytes.set(data, 0x100);
	return bytes;
}

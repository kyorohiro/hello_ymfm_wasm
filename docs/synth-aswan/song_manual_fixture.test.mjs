import test from 'node:test';
import assert from 'node:assert/strict';
import {
	createWonderSwanManualVgm,
	createWonderSwanPcmTransitionVgm,
} from '../../test/helpers/wonderswan_manual_vgm_fixture.mjs';
import { readAswanVgm } from './vgm_import.js';

test('original manual-play fixture separates later driver pitch writes from its gate reassertion', async () => {
	const { trace } = await readAswanVgm(createWonderSwanManualVgm());
	assert.equal(trace.time, 8 * 44100);
	const registers = trace.events.filter((event) => event.type === 'register');
	assert(registers.some((event) => event.time === 2.5 * 44100 && event.address === 0x80));
	assert(!registers.some((event) => event.time === 2.5 * 44100 && event.address === 0x90));
	assert(
		registers.some(
			(event) => event.time === 3.5 * 44100 && event.address === 0x90 && event.value === 1,
		),
	);
	assert(
		registers.some(
			(event) => event.time === 6.5 * 44100 && event.address === 0x90 && event.value === 0,
		),
	);
});
test('manual fixtures initialize complete Wave RAM and keep Noise/Sweep on the actual hardware channels', async () => {
	for (const [mode, ch, flag] of [
		['wave', 0, 0],
		['sweep', 2, 64],
		['noise', 3, 128],
	]) {
		const { trace } = await readAswanVgm(createWonderSwanManualVgm({ mode }));
		const writes = trace.events.filter((event) => event.time === 0 && event.type === 'memory');
		assert.equal(writes.length, 64);
		assert(writes.some((event) => event.address === 0x1200 + ch * 16));
		assert(
			trace.events.some(
				(event) =>
					event.time === 0 &&
					event.type === 'register' &&
					event.address === 0x90 &&
					event.value === ((1 << ch) | flag),
			),
		);
	}
});

test('queued-key fixture changes complete CH2 Wave into transient Voice PCM at a known boundary', async () => {
	const { trace } = await readAswanVgm(createWonderSwanPcmTransitionVgm());
	assert.equal(trace.time, 4 * 44100);
	assert(
		trace.events.some(
			(event) =>
				event.time === Math.round(0.35 * 44100) &&
				event.type === 'register' &&
				event.address === 0x90 &&
				event.value === 0x23,
		),
	);
});

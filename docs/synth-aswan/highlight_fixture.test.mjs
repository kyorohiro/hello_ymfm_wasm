// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {
	createWonderSwanHighlightVgm,
	ASWAN_HIGHLIGHT_WRITES,
} from '../../test/helpers/wonderswan_highlight_vgm_fixture.mjs';
import { readAswanVgm } from './vgm_import.js';

test('Live highlight fixture separates complete Wave/stereo, Sweep and Noise changes in heard time', async () => {
	const { trace } = await readAswanVgm(createWonderSwanHighlightVgm());
	assert.equal(trace.time, 8 * 44100);
	const initial = trace.events.filter((event) => event.time === 0);
	assert.equal(initial.filter((event) => event.type === 'memory').length, 64);
	assert(initial.some((event) => event.address === 0x90 && event.value === 0xcf));
	for (const [seconds, type, address, value] of ASWAN_HIGHLIGHT_WRITES)
		assert(
			trace.events.some(
				(event) =>
					event.time === Math.round(seconds * 44100) &&
					event.type === type &&
					event.address === address &&
					event.value === value,
			),
		);
});

// SPDX-License-Identifier: BSD-3-Clause
import assert from 'node:assert/strict';
import test from 'node:test';
import { VSU_AUTO_SOURCES, vsuAutoChannel, vsuAutoSourceForChannel, vsuAutoVoiceChannels } from './auto-source.js';
import { createDefaultVsuPatch, validateVsuPatch } from './patch.js';

test('AUTO routes each source to its compatible voices and keeps the selected Wave instrument', () => {
	assert.deepEqual(VSU_AUTO_SOURCES, ['wave', 'effect', 'noise']);
	assert.deepEqual(vsuAutoVoiceChannels('wave'), [0, 1, 2, 3, 4]);
	assert.deepEqual(vsuAutoVoiceChannels('effect'), [4]);
	assert.deepEqual(vsuAutoVoiceChannels('noise'), [5]);
	assert.equal(vsuAutoChannel('wave'), 0);
	assert.equal(vsuAutoChannel('wave', 3), 3);
	assert.equal(vsuAutoChannel('wave', 4), 4);
	assert.equal(vsuAutoChannel('effect', 3), 4);
	assert.equal(vsuAutoChannel('noise', 3), 5);
	assert.throws(() => vsuAutoChannel('wave', 5), /Wave channel/);
	assert.throws(() => vsuAutoVoiceChannels('pcm'), /Choose Wave/);
});

test('legacy patches infer AUTO source from the preferred channel and CH5 mode', () => {
	const patch = createDefaultVsuPatch();
	assert.deepEqual(validateVsuPatch(patch), patch);
	assert.equal(vsuAutoSourceForChannel(0, patch.ch5), 'wave');
	assert.equal(vsuAutoSourceForChannel(4, patch.ch5), 'wave');
	assert.equal(vsuAutoSourceForChannel(5, patch.ch5), 'noise');

	const legacy = { ...patch, preferredChannel: 4, ch5: { ...patch.ch5, mode: 'sweep' } };
	const restored = validateVsuPatch(JSON.parse(JSON.stringify(legacy)));
	assert.deepEqual(restored, legacy);
	assert.equal(vsuAutoSourceForChannel(restored.preferredChannel, restored.ch5), 'effect');
	assert.equal(vsuAutoSourceForChannel(4, { ...patch.ch5, mode: 'modulation', rate: 0 }), 'effect');
});

test('v1 patches preserve whether CH5 was used as a plain Wave or with its effect', () => {
	const patch = createDefaultVsuPatch();
	const stored = { ...patch, preferredChannel: 4, ch5: { ...patch.ch5, mode: 'modulation' } };
	for (const preferredSource of ['effect', 'wave']) {
		const preset = { ...stored, preferredSource };
		assert.deepEqual(validateVsuPatch(JSON.parse(JSON.stringify(preset))), preset);
	}
	const noise = { ...stored, preferredChannel: 5, preferredSource: 'noise' };
	assert.deepEqual(validateVsuPatch(noise), noise);
	assert.throws(() => validateVsuPatch({ ...stored, preferredSource: 'noise' }), /preferred channel/);
	assert.throws(() => validateVsuPatch({ ...noise, preferredSource: 'wave' }), /preferred channel/);
	assert.throws(() => validateVsuPatch({ ...patch, preferredSource: 'wave' }), /preferred channel/);
});

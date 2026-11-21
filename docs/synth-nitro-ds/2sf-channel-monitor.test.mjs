// SPDX-License-Identifier: BSD-3-Clause
import assert from 'node:assert/strict';
import test from 'node:test';
import { NDS_AUDIO_CLOCK } from './nds-core.js';
import { decodeTwoSfSampleSettings, decodeTwoSfSnapshot, TWO_SF_SNAPSHOT_WORDS } from './2sf-channel-monitor.js';

test('2SF snapshot exposes the PCM settings used for paused audition', () => {
	const row = new Uint32Array(TWO_SF_SNAPSHOT_WORDS);
	row.set([800, 0x80000000 | (1 << 29) | (1 << 27) | (70 << 16) | (2 << 8) | 90,
		0x02000000, (4 << 16) | 64000, 28, 0]);
	const { frame, channels: [voice] } = decodeTwoSfSnapshot(row);
	const settings = {
		mode: 'pcm16', volume: 90, pan: 70, divider: 2, duty: 0, loop: true,
		sampleRate: NDS_AUDIO_CLOCK / 1536, loopStartWords: 4, lengthWords: 28,
	};
	assert.equal(frame, 800);
	assert.deepEqual(voice, {
		...settings, active: true, format: 'pcm16', timer: 64000, repeatMode: 1, byteLength: 128,
	});
	assert.deepEqual(decodeTwoSfSampleSettings(row, 0), settings);
});

test('2SF snapshots distinguish pulse and noise and leave unsupported sample lengths unknown', () => {
	const row = new Uint32Array(TWO_SF_SNAPSHOT_WORDS);
	const constantVolume = 0x80000000 | (3 << 29) | 100;
	row[1 + 8 * 5] = constantVolume | (6 << 24);
	row[1 + 14 * 5] = constantVolume;
	row[1] = 0x80000000 | (2 << 29) | (1 << 27);
	row[4] = 31;
	const { channels } = decodeTwoSfSnapshot(row);
	assert.equal(channels[8].mode, 'pulse');
	assert.equal(channels[8].duty, 6);
	assert.equal(channels[14].mode, 'noise');
	assert.equal(channels[14].lengthWords, null);
	assert.equal(channels[14].byteLength, null);
	assert.equal(channels[0].lengthWords, 31);
	assert.equal(channels[0].byteLength, null); // An IMA-ADPCM loop must skip its header.
	assert.throws(() => decodeTwoSfSampleSettings(row, 8), /cannot be auditioned/);
});

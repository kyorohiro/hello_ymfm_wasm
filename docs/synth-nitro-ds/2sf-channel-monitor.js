// SPDX-License-Identifier: BSD-3-Clause
import { NDS_AUDIO_CLOCK, NDS_CHANNEL_COUNT } from './nds-core.js';

// The headless SkyEmu bridge writes a PCM frame followed by CNT, SAD,
// TMR/PNT, LEN and decoder position for each physical channel.
const CHANNEL_WORDS = 5;
export const TWO_SF_SNAPSHOT_WORDS = 1 + NDS_CHANNEL_COUNT * CHANNEL_WORDS;
const MAX_RENDER_SNAPSHOTS = 9;
const SAMPLE_FORMATS = ['pcm8', 'pcm16', 'adpcm'];

export function readTwoSfSnapshots(core) {
	const count = core.nds_2sf_snapshot_count();
	if (count > MAX_RENDER_SNAPSHOTS) throw new Error('Unexpected 2SF snapshot count.');
	if (!count) return null;
	const pointer = core.nds_2sf_snapshots();
	if (!pointer) throw new Error('The 2SF renderer returned no snapshot buffer.');
	return new Uint32Array(core.memory.buffer, pointer, count * TWO_SF_SNAPSHOT_WORDS).slice();
}

export function decodeTwoSfSnapshot(row) {
	const channels = Array.from({ length: NDS_CHANNEL_COUNT }, (_, channel) => {
		const base = 1 + channel * CHANNEL_WORDS;
		const control = row[base];
		const formatCode = control >>> 29 & 3;
		const timer = row[base + 2] & 65535;
		const format = SAMPLE_FORMATS[formatCode] ?? (channel >= 14 ? 'noise' : channel >= 8 ? 'pulse' : 'reserved');
		return {
			active: Boolean(control >>> 31),
			format,
			volume: control & 127,
			pan: control >>> 16 & 127,
			divider: control >>> 8 & 3,
			timer,
			sampleRate: NDS_AUDIO_CLOCK / (65536 - timer),
		};
	});
	return { frame: row[0], channels };
}

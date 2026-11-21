// SPDX-License-Identifier: BSD-3-Clause
import { NDS_AUDIO_CLOCK, NDS_CHANNEL_COUNT } from './nds-core.js';
import { getNdsSampleLayout, readNdsSampleRange } from './nds-sample.js?v=nds-2sf-audition-1';

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

function decodeChannel(row, channel) {
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
}

export function decodeTwoSfSnapshot(row) {
	const channels = Array.from({ length: NDS_CHANNEL_COUNT }, (_, channel) => decodeChannel(row, channel));
	return { frame: row[0], channels };
}

export function decodeTwoSfSampleSettings(row, channel) {
	const voice = decodeChannel(row, channel);
	if (!voice.active) throw new Error('This channel was idle at Pause.');
	const base = 1 + channel * CHANNEL_WORDS;
	const repeatMode = row[base] >>> 27 & 3;
	if (!SAMPLE_FORMATS.includes(voice.format) || (repeatMode !== 1 && repeatMode !== 2))
		throw new Error('This channel uses a source or repeat mode that cannot be auditioned.');
	return {
		mode: voice.format, volume: voice.volume, pan: voice.pan, divider: voice.divider,
		duty: row[base] >>> 24 & 7, loop: repeatMode === 1,
		sampleRate: voice.sampleRate, loopStartWords: row[base + 2] >>> 16,
		lengthWords: row[base + 3] & 0x3fffff,
	};
}

export function validateTwoSfChannelSample(settings, bytes) {
	const layout = getNdsSampleLayout(bytes, settings.mode);
	const { loopStartWords, lengthWords } = settings;
	if ((loopStartWords + lengthWords) * 4 !== bytes.length)
		throw new Error('The 2SF sample length does not match the paused channel.');
	readNdsSampleRange(layout, settings);
}

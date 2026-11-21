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
	const timerAndLoop = row[base + 2];
	const timer = timerAndLoop & 65535;
	const pcm = formatCode < SAMPLE_FORMATS.length;
	const format = SAMPLE_FORMATS[formatCode] ?? (channel >= 14 ? 'noise' : channel >= 8 ? 'pulse' : 'reserved');
	const repeatMode = control >>> 27 & 3;
	const loop = pcm && repeatMode === 1;
	const loopStartWords = pcm ? timerAndLoop >>> 16 : null;
	const lengthWords = pcm ? row[base + 3] & 0x3fffff : null;
	const configuredLength = (loopStartWords + lengthWords) * 4;
	// This size is derived from registers. Sample reads still validate the source in RAM.
	const byteLength = pcm && (loop || repeatMode === 2) && lengthWords > 0
		&& configuredLength >= 16 && !(format === 'adpcm' && loop && loopStartWords === 0)
		? configuredLength : null;
	return {
		active: Boolean(control >>> 31),
		mode: format,
		format,
		volume: control & 127,
		pan: control >>> 16 & 127,
		divider: control >>> 8 & 3,
		duty: control >>> 24 & 7,
		repeatMode,
		loop,
		loopStartWords,
		lengthWords,
		byteLength,
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
	const { repeatMode } = voice;
	if (!SAMPLE_FORMATS.includes(voice.format) || (repeatMode !== 1 && repeatMode !== 2))
		throw new Error('This channel uses a source or repeat mode that cannot be auditioned.');
	return {
		mode: voice.mode, volume: voice.volume, pan: voice.pan, divider: voice.divider,
		duty: voice.duty, loop: voice.loop, sampleRate: voice.sampleRate,
		loopStartWords: voice.loopStartWords, lengthWords: voice.lengthWords,
	};
}

export function validateTwoSfChannelSample(settings, bytes) {
	const layout = getNdsSampleLayout(bytes, settings.mode);
	const { loopStartWords, lengthWords } = settings;
	if ((loopStartWords + lengthWords) * 4 !== bytes.length)
		throw new Error('The 2SF sample length does not match the paused channel.');
	readNdsSampleRange(layout, settings);
}

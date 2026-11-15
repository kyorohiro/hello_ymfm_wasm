// SPDX-License-Identifier: BSD-3-Clause
// Passive SSF observer schema. Frequency is hardware sample playback rate.
export const SCSP_SSF_SNAPSHOT_WORDS = 1040;
export const SCSP_SSF_RAM_BYTES = 512 * 1024;
const RATE = 44100;

export function decodeScspSsfSnapshot(words, ram) {
	if (
		!(words instanceof Uint32Array) ||
		words.length !== SCSP_SSF_SNAPSHOT_WORDS ||
		words[0] !== 0x53534632
	)
		throw new TypeError('Invalid SSF observation words');
	if (!(ram instanceof Uint8Array) || ram.length !== SCSP_SSF_RAM_BYTES)
		throw new TypeError('Invalid SSF observation RAM');
	const frame = words[1] + words[2] * 4294967296;
	const slots = Array.from({ length: 32 }, (_, index) => {
		const at = 16 + index * 32;
		const registers = Uint16Array.from(words.subarray(at, at + 16));
		const r = registers;
		const sourceMode = (r[0] >> 7) & 3;
		const bits = r[0] & 16 ? 8 : 16;
		const rawOctave = (r[8] >> 11) & 15;
		const octave = rawOctave >= 8 ? rawOctave - 16 : rawOctave;
		const frequencyHz = RATE * ((1024 ^ (r[8] & 2047)) / 1024) * 2 ** octave;
		const attenuation = words[at + 17];
		const effectiveAttenuation = words[at + 28];
		const waveAccess = Boolean(words[at + 21]);
		const active =
			sourceMode === 0 ? waveAccess : sourceMode === 1 && effectiveAttenuation < 960;
		const voice = {
			frequencyHz,
			totalLevel: r[6] & 255,
			directLevel: (r[11] >> 13) & 7,
			pan: (r[11] >> 8) & 31,
			envelope: {
				attackRate: r[4] & 31,
				decay1Rate: (r[4] >> 6) & 31,
				decay2Rate: (r[4] >> 11) & 31,
				decayLevel: (r[5] >> 5) & 31,
				releaseRate: r[5] & 31,
				keyRateScaling: (r[5] >> 10) & 15,
			},
			lfo: {
				frequencyCode: (r[9] >> 10) & 31,
				pitchWave: (r[9] >> 8) & 3,
				pitchDepth: (r[9] >> 5) & 7,
				amplitudeWave: (r[9] >> 3) & 3,
				amplitudeDepth: r[9] & 7,
				reset: Boolean(r[9] & 0x8000),
			},
			modulation: {
				depth: (r[7] >> 12) & 15,
				xOffset: (r[7] >> 6) & 63,
				yOffset: r[7] & 63,
				writeInhibit: Boolean(r[6] & 0x200),
			},
		};
		return {
			index,
			active,
			gate: Boolean(words[at + 16]),
			envelopeLevel: (1023 - Math.min(1023, attenuation)) / 1023,
			effectiveEnvelopeLevel: (1023 - Math.min(1023, effectiveAttenuation)) / 1023,
			envelopeAttenuation: attenuation,
			envelopePhase: words[at + 18],
			currentAddress: words[at + 19],
			fractionalPhase: words[at + 20],
			waveAccess,
			inLoop: Boolean(words[at + 22]),
			reverse: Boolean(words[at + 23]),
			lfoCounter: words[at + 26],
			lfoTimeCounter: words[at + 27],
			voice,
			sample: {
				bits,
				startAddress: (r[0] & 15) * 65536 + r[1],
				loopStart: r[2],
				loopEnd: r[3],
				loopMode: (r[0] >> 5) & 3,
				sourceMode,
				sourceBitControl: (r[0] >> 9) & 3,
			},
			flags: {
				attackHold: Boolean(r[4] & 32),
				loopLink: Boolean(r[5] & 0x4000),
				envelopeBypass: Boolean(r[5] & 0x8000),
				soundDirect: Boolean(r[6] & 0x100),
			},
			dsp: {
				input: (r[10] >> 3) & 15,
				send: r[10] & 7,
				returnLevel: (r[11] >> 5) & 7,
				pan: r[11] & 31,
			},
			registers,
		};
	});
	return {
		frame,
		nativeFrame: frame,
		slots,
		ram,
		globals: {
			masterVolume: words[3],
			memory512KiB: Boolean(words[4]),
			dac18Bit: Boolean(words[5]),
			ringBase: words[6],
			ringLength: words[7],
			counter: words[8],
			monitorSlot: words[9],
			monitorData: words[10],
			keyExecute: Boolean(words[11]),
		},
	};
}

/** Bounded prefix of the raw programmed RAM waveform at the snapshot time.
 * SCSP interpolation, FM addressing, source-bit operations and EG are later.
 */
export function readScspSsfPcmPreview(snapshot, slot, { maxSamples = 256 } = {}) {
	if (!Number.isInteger(slot) || slot < 0 || slot >= 32 || !snapshot?.slots?.[slot])
		throw new RangeError('Choose an SSF slot from 0 to 31');
	if (!Number.isInteger(maxSamples) || maxSamples < 1 || maxSamples > 4096)
		throw new RangeError('SSF preview length must be 1 to 4096 samples');
	const sample = snapshot.slots[slot].sample;
	const empty = (reason) => ({
		pcm: sample.bits === 8 ? new Int8Array() : new Int16Array(),
		sample,
		reason,
	});
	if (sample.sourceMode !== 0)
		return empty(
			['RAM PCM', 'Noise generator', 'Zero source', 'Undefined source'][sample.sourceMode],
		);
	if (!(snapshot.ram instanceof Uint8Array) || snapshot.ram.length !== SCSP_SSF_RAM_BYTES)
		return empty('RAM snapshot unavailable');
	const start = sample.bits === 16 ? sample.startAddress & ~1 : sample.startAddress;
	const bytesPerSample = sample.bits / 8;
	const count = Math.min(maxSamples, Math.max(1, sample.loopEnd));
	// The pinned Mednafen core masks oscillator addresses to 20 bits and uses
	// a zero-filled dummy half above its physical 512 KiB RAM. Its stored MEM4B
	// flag does not change these reads. Match that native behavior, including
	// wrap at 1 MiB and PCM16's ignored low address bit.
	const byteAt = (address) => {
		const physical = address & 0xfffff;
		return physical < snapshot.ram.length ? snapshot.ram[physical] : 0;
	};
	let pcm;
	if (sample.bits === 8)
		pcm = Int8Array.from({ length: count }, (_, index) => byteAt(start + index));
	else {
		pcm = Int16Array.from({ length: count }, (_, index) => {
			const address = start + index * bytesPerSample;
			return (byteAt(address) << 8) | byteAt(address + 1);
		});
	}
	return { pcm, sample, reason: '' };
}

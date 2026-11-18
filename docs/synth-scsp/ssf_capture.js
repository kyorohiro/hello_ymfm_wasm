// SPDX-License-Identifier: BSD-3-Clause
// Software instrument capture from an immutable, passive SSF observation.
import { readPreset } from './preset.js';
import { readPatch } from './patch.js?v=scsp-cycle2-presets-1';
import { scspPitch, SCSP_LFO_PITCH_CENTS } from '../js/scspsynth.js';
import { SCSP_SSF_RAM_BYTES } from './ssf_snapshot.js';

const RATE = 44100;
const fail = (reason) => {
	throw new Error(`SSF Capture: ${reason}`);
};
const integer = (value, minimum, maximum, name) => {
	if (!Number.isInteger(value) || value < minimum || value > maximum)
		fail(`${name} must be ${minimum}..${maximum}.`);
	return value;
};
const flag = (value, name) => {
	if (typeof value !== 'boolean') fail(`${name} is missing from this snapshot.`);
	return value;
};
const hz = (midi) => 440 * 2 ** ((midi - 69) / 12);

function describe(snapshot, slotIndex, referenceMidi) {
	integer(slotIndex, 0, 31, 'Slot');
	integer(referenceMidi, 0, 127, 'Reference MIDI key');
	if (
		!snapshot ||
		!Number.isSafeInteger(snapshot.frame) ||
		snapshot.frame < 0 ||
		!(snapshot.ram instanceof Uint8Array) ||
		snapshot.ram.length !== SCSP_SSF_RAM_BYTES ||
		snapshot.slots?.length !== 32
	)
		fail('A same-time 32-slot / 512 KiB RAM snapshot is required.');
	const slot = snapshot.slots[slotIndex];
	if (!slot || !(slot.registers instanceof Uint16Array) || slot.registers.length !== 16)
		fail('The selected slot has no complete register snapshot.');
	const { sample, voice, flags, dsp } = slot;
	if (!sample || !voice || !flags || !dsp) fail('The selected slot snapshot is incomplete.');
	integer(sample.sourceMode, 0, 3, 'Source mode');
	if (sample.sourceMode !== 0)
		fail(
			`${['RAM PCM', 'Noise generator', 'Zero source', 'Undefined source'][sample.sourceMode]} cannot be captured as an independent PCM instrument.`,
		);
	if (sample.bits !== 8 && sample.bits !== 16) fail('PCM must be 8 or 16 bit.');
	integer(sample.startAddress, 0, 0xfffff, 'Sample start');
	integer(sample.loopStart, 0, 65535, 'Loop start');
	integer(sample.loopEnd, 0, 65535, 'Loop end');
	integer(sample.loopMode, 0, 3, 'Loop mode');
	integer(sample.sourceBitControl, 0, 3, 'Source-bit control');
	if (sample.sourceBitControl)
		fail('Source-bit transformations are not supported by single-slot capture.');
	if (sample.loopMode > 1)
		fail('Reverse and alternating loops are not supported by this Synth preset.');
	if (sample.loopEnd < 2)
		fail(
			'The programmed end needs at least 2 PCM samples; zero / one-sample ends cannot be copied safely.',
		);
	if (sample.loopMode === 1 && sample.loopStart >= sample.loopEnd)
		fail('A forward loop must start before its programmed end.');
	if (sample.loopMode === 0 && sample.loopStart >= sample.loopEnd)
		fail('A one-shot loop-start threshold at or beyond its end cannot be copied safely.');
	if (slot.registers[8] & 0x8000)
		fail('Short-wave address masking is not supported by this Synth preset.');
	if (slot.registers[8] & 0x400)
		fail(
			'Extended FNS pitch coding cannot preserve the envelope key scaling in this Synth preset.',
		);
	for (const [key, label] of Object.entries({
		attackHold: 'Attack hold',
		envelopeBypass: 'Envelope bypass',
		soundDirect: 'Sound-direct bypass',
	}))
		if (flag(flags[key], label)) fail(`${label} is not supported by this Synth preset.`);
	const loopLink = flag(flags.loopLink, 'Attack / loop link');
	// One-shot samples in the existing PCM adapter program LSA=0. Do not
	// silently move a linked one-shot's separate Attack transition threshold.
	if (loopLink && sample.loopMode === 0 && sample.loopStart !== 0)
		fail(
			'Attack / loop link with a nonzero one-shot threshold cannot be preserved by this Synth preset.',
		);
	const modulation = voice.modulation;
	if (!modulation) fail('The modulation state is missing.');
	integer(modulation.depth, 0, 15, 'Modulation depth');
	integer(modulation.xOffset, 0, 63, 'Modulation X');
	integer(modulation.yOffset, 0, 63, 'Modulation Y');
	const stackWriteInhibit = flag(modulation.writeInhibit, 'Sound-stack write inhibit');
	if (modulation.depth)
		fail('Sound-stack modulation needs linked slots and cannot be captured independently.');
	integer(voice.totalLevel, 0, 255, 'Total level');
	integer(voice.directLevel, 0, 7, 'Direct level');
	integer(voice.pan, 0, 31, 'Direct pan');
	if (!voice.directLevel)
		fail(
			'This slot has no direct output. A DSP-only / muted slot cannot be auditioned independently.',
		);
	if (voice.totalLevel === 255)
		fail('This slot is at maximum total-level attenuation. Choose an audible slot.');
	if (!Number.isFinite(voice.frequencyHz) || voice.frequencyHz <= 0)
		fail('The selected slot has a zero or invalid playback rate.');
	if (!voice.envelope || !voice.lfo) fail('Envelope / LFO settings are missing.');
	for (const key of [
		'attackRate',
		'decay1Rate',
		'decay2Rate',
		'decayLevel',
		'releaseRate',
		'keyRateScaling',
	])
		integer(voice.envelope[key], 0, key === 'keyRateScaling' ? 15 : 31, key);
	for (const key of [
		'frequencyCode',
		'pitchWave',
		'pitchDepth',
		'amplitudeWave',
		'amplitudeDepth',
	])
		integer(
			voice.lfo[key],
			0,
			key === 'frequencyCode' ? 31 : key.endsWith('Wave') ? 3 : 7,
			key,
		);
	flag(voice.lfo.reset, 'LFO reset');
	for (const key of ['input', 'send', 'returnLevel', 'pan'])
		integer(dsp[key], 0, key === 'input' ? 15 : key === 'pan' ? 31 : 7, `DSP ${key}`);
	const referenceFrequencyHz = hz(referenceMidi);
	try {
		// The portable patch validator also checks its next A4 note. Reject this
		// existing adapter limit before showing Capture as available in the UI.
		for (const frequency of [referenceFrequencyHz, 440]) {
			const pitch = scspPitch(
				((frequency / referenceFrequencyHz) * voice.frequencyHz) / RATE,
			);
			if (
				sample.loopMode === 1 &&
				pitch.ratio * 2 ** (SCSP_LFO_PITCH_CENTS[voice.lfo.pitchDepth] / 1200) >
					sample.loopEnd - sample.loopStart
			)
				fail('The playback step including LFO exceeds this short forward loop.');
		}
	} catch (error) {
		if (error.message.startsWith('SSF Capture:')) throw error;
		fail(
			`This playback rate cannot be represented by the Synth at the reference key / A4: ${error.message}`,
		);
	}
	const warnings = [
		'A new note restarts its sample, envelope and LFO; the paused playback phase is not continued.',
		'The independently played Synth uses its own SCSP approximation and Master; interpolation boundaries and output gain can differ from the song.',
	];
	if (stackWriteInhibit)
		warnings.push(
			'Independent capture omits sound-stack write inhibit; outgoing writes to other song slots are not reproduced.',
		);
	if (dsp.send || dsp.returnLevel)
		warnings.push(
			'Dry capture only: the shared DSP program, input send and effect return are not copied.',
		);
	if (snapshot.globals?.masterVolume !== undefined && snapshot.globals.masterVolume !== 15)
		warnings.push(
			`The song master volume (MVOL ${snapshot.globals.masterVolume}/15) is not copied.`,
		);
	return { slot, sample, voice, referenceFrequencyHz, warnings };
}

/** Cheap eligibility for the Live view. It neither copies PCM nor runs a core. */
export function getScspSsfCaptureAvailability(snapshot, slotIndex, { referenceMidi = 60 } = {}) {
	try {
		const { warnings } = describe(snapshot, slotIndex, referenceMidi);
		return { available: true, reason: '', warnings };
	} catch (error) {
		return { available: false, reason: error.message, warnings: [] };
	}
}

/** Return a portable single-slot preset plus provenance without modifying the
 * snapshot, song CPU or authored Synth. The reference key reproduces the raw
 * captured playback rate; this does not infer the sample's original root note.
 */
export function createScspSsfCapture(snapshot, slotIndex, { referenceMidi = 60 } = {}) {
	const { slot, sample, voice, referenceFrequencyHz, warnings } = describe(
		snapshot,
		slotIndex,
		referenceMidi,
	);
	const start = sample.bits === 16 ? sample.startAddress & ~1 : sample.startAddress;
	const byteAt = (address) => {
		const physical = address & 0xfffff;
		return physical < snapshot.ram.length ? snapshot.ram[physical] : 0;
	};
	// Native LEA is an exclusive end for ordinary forward playback. Match its
	// 20-bit address wrap / zero dummy half and PCM16's ignored low SA bit.
	const pcm = Array.from({ length: sample.loopEnd }, (_, index) => {
		const address = start + index * (sample.bits / 8);
		const raw =
			sample.bits === 8 ? byteAt(address) : (byteAt(address) << 8) | byteAt(address + 1);
		return raw >= 2 ** (sample.bits - 1) ? raw - 2 ** sample.bits : raw;
	});
	const preset = {
		format: 'tetorica-scsp-voice',
		version: 1,
		bits: sample.bits,
		pcm,
		options: {
			baseFrequencyHz: referenceFrequencyHz,
			sourceSampleRate: voice.frequencyHz,
			...(sample.loopMode === 1 ? { loopStartSamples: sample.loopStart } : {}),
		},
		voice: {
			frequencyHz: referenceFrequencyHz,
			totalLevel: voice.totalLevel,
			directLevel: voice.directLevel,
			pan: voice.pan,
			envelope: { ...voice.envelope, loopLink: slot.flags.loopLink },
			lfo: { ...voice.lfo },
		},
	};
	try {
		readPreset(preset);
		readPatch(preset);
	} catch (error) {
		fail(`The captured instrument cannot be loaded safely: ${error.message}`);
	}
	const origin = {
		kind: 'ssf-slot',
		frame: snapshot.frame,
		slotIndex,
		referenceMidi,
		referenceFrequencyHz,
		playbackRateHz: voice.frequencyHz,
		sample: { ...sample },
		registers: Array.from(slot.registers),
		gate: slot.gate,
		envelopePhase: slot.envelopePhase,
		currentAddress: slot.currentAddress,
		masterVolume: snapshot.globals?.masterVolume ?? null,
		modulation: { ...voice.modulation },
		dsp: { ...slot.dsp },
	};
	return { preset, origin, warnings };
}

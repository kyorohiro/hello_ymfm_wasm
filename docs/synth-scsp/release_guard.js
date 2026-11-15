// SPDX-License-Identifier: BSD-3-Clause
// Synth-only software control of the existing hardware Release register.
import { scspPitch } from '../js/scspsynth.js';

export const SCSP_GUARDED_RELEASE_CODE = 25;
export const SCSP_GUARDED_RELEASE_INDEX = SCSP_GUARDED_RELEASE_CODE * 2;

/** The pinned core latches this Get_DR index at keyOn. Live pitch edits do
 * not recompute it, so reading the current pitch at noteOff is insufficient.
 */
export function scspEffectiveReleaseIndex(envelopeWord, pitchWord) {
	const rr = envelopeWord & 31,
		krs = (envelopeWord >>> 10) & 15;
	const rawOctave = (pitchWord >>> 11) & 15;
	const octave = rawOctave >= 8 ? rawOctave - 16 : rawOctave;
	const scaling = krs === 15 ? 0 : octave + 2 * krs + ((pitchWord >>> 9) & 1);
	return Math.max(0, Math.min(63, rr * 2 + scaling));
}

export class ScspReleaseGuard {
	constructor(core) {
		this.core = core;
		this.enabled = true;
		this.latched = new Map();
	}
	setEnabled(value) {
		if (typeof value !== 'boolean') throw new TypeError('SCSP Click guard must be boolean');
		this.enabled = value;
		return value;
	}
	keyOn(slot, voice) {
		let envelopeWord, pitchWord;
		if (typeof this.core.read === 'function') {
			envelopeWord = this.core.read(slot * 32 + 10);
			pitchWord = this.core.read(slot * 32 + 16);
		} else {
			// The passive authoring core has no registers. Its successfully applied
			// requested preset describes precisely the words ScspSynth just wrote.
			const envelope = voice.envelope,
				sample = voice.sample;
			envelopeWord = (envelope.keyRateScaling << 10) | envelope.releaseRate;
			pitchWord = scspPitch(
				((voice.frequencyHz / sample.rootFrequencyHz) * sample.sourceSampleRate) / 44100,
			).word;
		}
		this.latched.set(slot, scspEffectiveReleaseIndex(envelopeWord, pitchWord));
	}
	release(slot, { raw = false } = {}) {
		const index = this.latched.get(slot);
		this.latched.delete(slot);
		if (raw || !this.enabled || index === undefined || index <= SCSP_GUARDED_RELEASE_INDEX)
			return false;
		// Updating only RR recomputes native Get_DR(0,25); KRS, DL, LPSLNK and
		// every other register bit remain intact. PCM position / EG volume are
		// untouched. Normal keyOff performs the native Release transition.
		this.core.write(slot * 32 + 10, SCSP_GUARDED_RELEASE_CODE, 0x001f);
		return true;
	}
	retire(slot) {
		this.latched.delete(slot);
	}
	clear() {
		this.latched.clear();
	}
}

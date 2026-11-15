// SPDX-License-Identifier: BSD-3-Clause
// The live SSF machine owns these registers. Host edits are masked writes,
// not Synth presets; the emulated music driver can overwrite them later.
const fields = {
	setEnvelope: {
		attackRate: [8, 0, 31],
		decay1Rate: [8, 6, 31],
		decay2Rate: [8, 11, 31],
		releaseRate: [10, 0, 31],
		decayLevel: [10, 5, 31],
		keyRateScaling: [10, 10, 15],
		loopLink: [10, 14, 1, true],
	},
	setLfo: {
		amplitudeDepth: [18, 0, 7],
		amplitudeWave: [18, 3, 3],
		pitchDepth: [18, 5, 7],
		pitchWave: [18, 8, 3],
		frequencyCode: [18, 10, 31],
		reset: [18, 15, 1, true],
	},
	setMix: { totalLevel: [12, 0, 255], pan: [22, 8, 31], directLevel: [22, 13, 7] },
};

/** Validate the entire edit and return bounded (offset, mask, value) triples.
 * The native ABI independently checks the same register and bit whitelist.
 * An empty patch is a no-op. No snapshot or caller-owned object is modified.
 */
export function encodeScspSsfVoiceEdit(method, patch) {
	if (!Object.hasOwn(fields, method))
		throw new TypeError('SSF edits support only Envelope, LFO and Mix');
	const allowed = fields[method];
	if (
		!patch ||
		typeof patch !== 'object' ||
		Array.isArray(patch) ||
		Reflect.ownKeys(patch).some((key) => !Object.hasOwn(allowed, key))
	)
		throw new TypeError('Invalid SSF voice parameter patch');
	const updates = new Map();
	for (const key of Object.keys(patch)) {
		const [offset, shift, limit, boolean] = allowed[key],
			value = patch[key];
		if (
			boolean
				? typeof value !== 'boolean'
				: !Number.isInteger(value) || value < 0 || value > limit
		)
			throw new TypeError(
				`${key} must be ${boolean ? 'boolean' : `an integer from 0 to ${limit}`}`,
			);
		const entry = updates.get(offset) ?? [offset, 0, 0];
		entry[1] |= limit << shift;
		entry[2] |= Number(value) << shift;
		updates.set(offset, entry);
	}
	return Uint32Array.from([...updates.values()].flat());
}

/** Merge a validated live edit into a portable decoded voice for UI journals. */
export function mergeScspSsfVoiceEdit(voice, method, patch) {
	encodeScspSsfVoiceEdit(method, patch);
	const result = structuredClone(voice);
	if (method === 'setMix') Object.assign(result, patch);
	else Object.assign(result[method === 'setEnvelope' ? 'envelope' : 'lfo'], patch);
	return result;
}

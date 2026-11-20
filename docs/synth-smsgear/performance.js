// SPDX-License-Identifier: BSD-3-Clause
// Software keyboard policy; the physical Rhythm mode itself is chip-wide.
import { noteToHz } from "../js/soundchip_pitch.js";
export function keyboardFrequency(note, bend = 0) {
	if (!Number.isFinite(bend)) throw RangeError("Pitch bend must be finite");
	const hz = noteToHz(note) * 2 ** (bend / 12);
	if (!Number.isFinite(hz) || hz <= 0)
		throw RangeError("Invalid bent frequency");
	return hz;
}
export const RHYTHM_KEYS = [
	{ name: "bassDrum", label: "Bass drum", short: "BD", key: "1", channel: 6 },
	{ name: "snare", label: "Snare", short: "SD", key: "2", channel: 7 },
	{ name: "tom", label: "Tom", short: "TOM", key: "3", channel: 8 },
	{ name: "cymbal", label: "Cymbal", short: "CYM", key: "4", channel: 8 },
	{ name: "hiHat", label: "Hi-hat", short: "HH", key: "5", channel: 7 },
];
export function assignedDrums(channel) {
	return RHYTHM_KEYS.filter(
		(d) => channel === "auto" || d.channel === Number(channel),
	);
}
export function keyboardAction(key, { section, channel, rhythm, entries }) {
	const entry = entries.find((value) => value.key === key);
	if (!entry) return null;
	const reserved =
		section === "opll" &&
		rhythm &&
		channel !== "auto" &&
		Number(channel) >= 6;
	if (section === "opll" && rhythm && (channel === "auto" || reserved)) {
		const drum = assignedDrums(channel).find((value) => value.key === key);
		if (drum)
			return {
				kind: "drum",
				drum: drum.name,
				index: RHYTHM_KEYS.indexOf(drum),
			};
		if (reserved) return null;
	}
	return { kind: "note", midi: entry.midi };
}

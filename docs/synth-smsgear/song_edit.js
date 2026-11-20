// SPDX-License-Identifier: BSD-3-Clause
import { YM2413Synth } from "../js/ym2413synth.js";
// Only touched fields cross the port. Never reapply a stale full Live preset.
export function buildSongEdit(section, channel, before, after) {
	const changes = [];
	const add = (path, a, b) => {
		if (a !== b) changes.push({ path, value: b });
	};
	if (section === "psg") {
		for (const key of ["attenuation", "noiseType", "noiseRate"])
			add([key], before.psg[key], after.psg[key]);
		for (let bit = 0; bit < 8; bit++)
			add(
				["stereo", bit],
				Boolean(before.psg.stereo & (1 << bit)),
				Boolean(after.psg.stereo & (1 << bit)),
			);
	} else {
		for (const key of ["instrument", "attenuation", "sustain"])
			add([key], before.opll[key], after.opll[key]);
		add(
			["feedback"],
			before.opll.userPatch.feedback,
			after.opll.userPatch.feedback,
		);
		for (let op = 0; op < 2; op++)
			for (const key of Object.keys(after.opll.userPatch.operators[op]))
				add(
					["operator", op, key],
					before.opll.userPatch.operators[op][key],
					after.opll.userPatch.operators[op][key],
				);
		for (const key of Object.keys(after.opll.rhythm))
			add(
				["rhythm", key],
				before.opll.rhythm[key],
				after.opll.rhythm[key],
			);
	}
	return { section, channel, changes };
}
// Resolve atomically on a private register shadow; no live writes until validation succeeds.
export function resolveSongEdit(command, state) {
	const { section, channel, changes } = command ?? {};
	if (
		!["psg", "opll"].includes(section) ||
		!Number.isInteger(channel) ||
		channel < 0 ||
		channel >= (section === "psg" ? 4 : 9) ||
		!Array.isArray(changes) ||
		changes.length > 64
	)
		throw TypeError("Invalid song channel edit");
	const writes = [];
	const synth = new YM2413Synth({
		transport: {
			writeRegister: (address, value) => writes.push([1, address, value]),
		},
	});
	synth.adoptRegisterSnapshot(state.opll);
	let noise = state.psg.noiseMode,
		stereo = state.stereo;
	const integer = (v, max) => {
		if (!Number.isInteger(v) || v < 0 || v > max)
			throw RangeError("Invalid song control value");
		return v;
	};
	for (const change of changes) {
		const { path, value } = change ?? {};
		if (!Array.isArray(path)) throw TypeError("Invalid song control path");
		const [key, index, field] = path;
		if (section === "psg") {
			if (key === "attenuation" && path.length === 1)
				writes.push([0, 0, 0x90 | (channel << 5) | integer(value, 15)]);
			else if (
				key === "stereo" &&
				path.length === 2 &&
				typeof value === "boolean"
			) {
				integer(index, 7);
				stereo = value ? stereo | (1 << index) : stereo & ~(1 << index);
				writes.push([2, 0, stereo]);
			} else if (
				channel === 3 &&
				path.length === 1 &&
				(key === "noiseType" || key === "noiseRate")
			) {
				if (key === "noiseType") {
					if (!["white", "periodic"].includes(value))
						throw TypeError("Invalid Noise type");
					noise = (noise & 3) | (value === "white" ? 4 : 0);
				} else {
					const rate = ["low", "medium", "high", "tone3"].indexOf(
						value,
					);
					if (rate < 0) throw TypeError("Invalid Noise rate");
					noise = (noise & 4) | rate;
				}
				writes.push([0, 0, 0xe0 | noise]);
			} else
				throw TypeError(
					"Control does not belong to the selected PSG channel",
				);
		} else if (
			path.length === 1 &&
			["instrument", "attenuation", "sustain"].includes(key)
		) {
			if (channel >= 6 && state.opll[14] & 32 && key !== "sustain")
				throw Error(
					"Select a melodic channel or edit the assigned Rhythm level",
				);
			synth.setVoice(channel, { [key]: value });
		} else if (key === "feedback" && path.length === 1) {
			if (state.opll[0x30 + channel] >> 4)
				throw Error("Select User to edit its patch");
			synth.setUserPatch({ feedback: value });
		} else if (key === "operator" && path.length === 3) {
			if (state.opll[0x30 + channel] >> 4)
				throw Error("Select User to edit its patch");
			synth.setUserOperator(index, { [field]: value });
		} else if (key === "rhythm" && path.length === 2) {
			if (index === "enabled") synth.setRhythm({ enabled: value });
			else synth.setRhythmLevel(index, value);
		} else throw TypeError("Unknown song control");
	}
	return writes;
}

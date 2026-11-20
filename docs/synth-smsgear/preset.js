import { Ym2413VoiceInspector } from "../js/playground_ym2413_inspector.js";
// SPDX-License-Identifier: BSD-3-Clause
import { YM2413Synth, YM2413_USER_PRESETS } from "../js/ym2413synth.js";
export const FORMAT = "tetorica-smsgear-voice";
const integer = (n, min, max, name) => {
	if (!Number.isInteger(n) || n < min || n > max)
		throw RangeError(`${name}: expected ${min}–${max}`);
	return n;
};
const boolean = (value, name) => {
	if (typeof value !== "boolean")
		throw TypeError(`${name}: expected boolean`);
	return value;
};
export function createDefaultPreset() {
	return {
		format: FORMAT,
		version: 1,
		name: "SMS square",
		section: "psg",
		psg: {
			source: "tone",
			attenuation: 4,
			noiseType: "white",
			noiseRate: "medium",
			stereo: 255,
		},
		opll: {
			instrument: 0,
			attenuation: 4,
			sustain: false,
			userPatch: structuredClone(YM2413_USER_PRESETS.bell),
			rhythm: {
				enabled: true,
				bassDrum: 4,
				snare: 5,
				tom: 4,
				cymbal: 7,
				hiHat: 7,
			},
		},
	};
}
export function readPreset(input) {
	const v = typeof input === "string" ? JSON.parse(input) : input;
	if (!v || v.format !== FORMAT || v.version !== 1)
		throw Error("Not a SMSGEAR preset");
	if (typeof v.name !== "string" || !v.name.trim() || v.name.length > 120)
		throw Error("Sound name must contain 1–120 characters");
	if (!["psg", "opll"].includes(v.section))
		throw Error("Unknown sound section");
	const p = v.psg,
		o = v.opll;
	if (
		!p ||
		!["tone", "noise"].includes(p.source) ||
		!["white", "periodic"].includes(p.noiseType) ||
		!["low", "medium", "high", "tone3"].includes(p.noiseRate)
	)
		throw Error("Invalid PSG source/Noise settings");
	integer(p.attenuation, 0, 15, "PSG attenuation");
	integer(p.stereo, 0, 255, "Stereo mask");
	if (!o || !o.rhythm) throw Error("Missing YM2413 settings");
	integer(o.instrument, 0, 15, "Instrument");
	integer(o.attenuation, 0, 15, "FM attenuation");
	boolean(o.sustain, "Sustain");
	boolean(o.rhythm.enabled, "Rhythm");
	for (const name of ["bassDrum", "snare", "tom", "cymbal", "hiHat"])
		integer(o.rhythm[name], 0, 15, name);
	// Validate/normalize with the existing chip implementation; never open audio.
	const chip = new YM2413Synth({ transport: { writeRegister() {} } });
	chip.setUserPatch(o.userPatch);
	return {
		format: FORMAT,
		version: 1,
		name: v.name.trim(),
		section: v.section,
		psg: {
			source: p.source,
			attenuation: p.attenuation,
			noiseType: p.noiseType,
			noiseRate: p.noiseRate,
			stereo: p.stereo,
		},
		opll: {
			instrument: o.instrument,
			attenuation: o.attenuation,
			sustain: o.sustain,
			userPatch: decodeOpll(chip.getRegisterSnapshot()).userPatch,
			rhythm: structuredClone(o.rhythm),
		},
	};
}
export function presetFromRegisters(kind, channel, state) {
	const preset = createDefaultPreset();
	preset.section = kind;
	preset.name = `${kind === "psg" ? "PSG" : "FM"} CH${channel + 1}`;
	if (kind === "psg") {
		const voice = state.psg.channels[channel];
		preset.psg.attenuation =
			state.psg.configuredAttenuations?.[channel] ?? voice.attenuation;
		preset.psg.source = channel === 3 ? "noise" : "tone";
		preset.psg.noiseType = state.psg.channels[3].noiseType;
		preset.psg.noiseRate = state.psg.channels[3].noiseRate;
		preset.psg.stereo = state.stereo ?? 255;
	} else {
		const chip = new YM2413Synth({ transport: { writeRegister() {} } });
		chip.adoptRegisterSnapshot(state.opll);
		const decoded = decodeOpll(state.opll),
			voice = decoded.channels[channel];
		Object.assign(preset.opll, {
			instrument: voice.instrument,
			attenuation: voice.attenuation,
			sustain: voice.sustain,
		});
		preset.opll.userPatch = decoded.userPatch;
		Object.assign(preset.opll.rhythm, decoded.rhythm.levels, {
			enabled: decoded.rhythm.enabled,
		});
	}
	return readPreset(preset);
}

export function decodeOpll(registers, clock = 3579545) {
	const inspector = new Ym2413VoiceInspector({ clock, dispatch() {} });
	inspector.registers.set(registers);
	const result = inspector.read();
	result.userPatch = {
		feedback: result.userPatch.feedback,
		operators: result.userPatch.operators.map(
			({ sustain, mul, ...operator }) => operator,
		),
	};
	return result;
}

/** Copy one voice into Auto keyboard allocation without dropping its pan on
 * the other allocated tone channels. Live views keep the original raw mask. */
export function capturePreset(kind, channel, state) {
	const preset = presetFromRegisters(kind, channel, state);
	if (kind === "psg" && channel < 3) {
		const mask = state.stereo ?? 255;
		preset.psg.stereo =
			(mask & 0x88) |
			(mask & (1 << (channel + 4)) ? 0x70 : 0) |
			(mask & (1 << channel) ? 7 : 0);
	}
	return preset;
}

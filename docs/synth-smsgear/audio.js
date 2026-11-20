// SPDX-License-Identifier: BSD-3-Clause
// PSG + OPLL share one output and one Code/keyboard instrument route.
import { attachPsgTimedClient } from "./psg_timed_client.js";
import { NativeRuntimeSynth } from "../js/native_runtime_synth.js";
import { SoundChipMixer } from "../js/soundchip_mixer.js";
import { SOUNDCHIP_MIXER_PRESETS } from "../js/soundchip_mixer_presets.js";
import { createChipInspector } from "../js/playground_chip_inspector.js";
import { readPreset } from "./preset.js";
import { keyboardFrequency } from "./performance.js";
export const DRUMS = ["bassDrum", "snare", "tom", "cymbal", "hiHat"];
export const SOURCE_GAINS = Object.freeze(
	Object.fromEntries(
		["segapsg", "ym2413"].map((name) => [
			name,
			SOUNDCHIP_MIXER_PRESETS.calibrated.factoryDefaults.kinds.find(
				(item) => item.name === name,
			)?.volume ?? 1,
		]),
	),
);
export async function createSmsGearAudio({
	master = 0.7,
	onError = () => {},
} = {}) {
	const context = new AudioContext(),
		codeInputNode = context.createGain(),
		codeOutputNode = context.createGain(),
		codeFadeNode = context.createGain(),
		masterNode = context.createGain();
	codeInputNode.connect(codeOutputNode);
	codeOutputNode.connect(codeFadeNode);
	codeFadeNode.connect(masterNode);
	masterNode.gain.value = master;
	masterNode.connect(context.destination);
	const synth = new NativeRuntimeSynth({
		chip: "segapsg",
		workletUrl: new URL("./psg_worklet.js", import.meta.url),
		ym2413: true,
		stereoEnabled: true,
		audioContext: context,
		outputNode: codeInputNode,
		masterVolume: 1,
		mixer: new SoundChipMixer(SOUNDCHIP_MIXER_PRESETS.calibrated),
	});
	try {
		await synth.start();
	} catch (error) {
		await synth.close().catch(() => {});
		await context.close();
		throw error;
	}
	const psg = synth.psg,
		opll = synth.opll;
	attachPsgTimedClient(
		psg,
		{},
		synth.primaryEndpoints.find((e) => e.name === "segapsg").port,
	);
	psg.allNotesOff();
	opll.initialize();
	// Useful Synth tuning for the physical drum oscillators; source captures
	// and Code can replace these frequencies. These are not ROM parameters.
	for (const [ch, note] of [
		[6, "C2"],
		[7, "C3"],
		[8, "G3"],
	])
		opll.setNote(ch, note);
	const inspector = createChipInspector({
		endpoints: () =>
			synth.primaryEndpoints.map((item) => ({
				id: item.name,
				kind: item.name,
				port: item.node.port,
			})),
		decode: () => {
			throw Error("Sample decoding is not used by SMSGEAR");
		},
	});
	const leases = new Map();
	let sequence = 0,
		disposed = false,
		settings;
	const raw = { segapsg: psg, ym2413: opll },
		mix = {
			segapsg: { volume: SOURCE_GAINS.segapsg, enabled: true },
			ym2413: { volume: SOURCE_GAINS.ym2413, enabled: true },
		};
	const forceOff = (name, channel) =>
		name === "segapsg"
			? channel === 3
				? psg._forceKeyOff(3)
				: psg.keyOff(channel)
			: typeof channel === "string"
				? opll.setRhythm({ [channel]: false })
				: opll.noteOff(channel);
	const own = (name, channel) => {
		const token = ++sequence;
		leases.set(name + ":" + channel, token);
		return token;
	};
	function applySettings(value, { section, channel = "auto" } = {}) {
		const previous = settings;
		settings = readPreset(value);
		if (!section || section === "psg") {
			const { psg: p } = settings;
			psg.setStereo(p.stereo);
			if (
				!previous ||
				p.noiseType !== previous.psg.noiseType ||
				p.noiseRate !== previous.psg.noiseRate
			)
				psg.setNoise({ type: p.noiseType, rate: p.noiseRate });
			const targets = channel === "auto" ? [0, 1, 2, 3] : [channel];
			for (const ch of targets) {
				const active = leases.has("segapsg:" + ch);
				psg.setAttenuation(ch, p.attenuation);
				if (!active) psg._forceKeyOff(ch);
			}
		}
		if (!section || section === "opll") {
			const { opll: o } = settings;
			opll.setUserPatch(o.userPatch);
			opll.setRhythm({ enabled: o.rhythm.enabled });
			const targets =
				channel === "auto"
					? Array.from(
							{ length: o.rhythm.enabled ? 6 : 9 },
							(_, i) => i,
						)
					: typeof channel === "number"
						? [channel]
						: [];
			for (const ch of targets)
				if (!o.rhythm.enabled || ch < 6)
					opll.setVoice(ch, {
						instrument: o.instrument,
						attenuation: o.attenuation,
						sustain: o.sustain,
					});
			const { enabled, ...levels } = o.rhythm;
			// These nibbles are melodic instrument numbers when Rhythm is Off.
			if (enabled) opll.setRhythmLevels(levels);
		}
	}
	function retune(voice, note, bend = 0) {
		if (
			disposed ||
			!voice ||
			leases.get(voice.name + ":" + voice.channel) !== voice.token ||
			typeof voice.channel !== "number"
		)
			return;
		if (voice.name === "segapsg" && voice.channel === 3) {
			if (settings.psg.noiseRate === "tone3")
				psg.setFrequency(2, keyboardFrequency(note, bend));
		} else
			raw[voice.name].setFrequency(
				voice.channel,
				keyboardFrequency(note, bend),
			);
	}
	function noteOn(name, channel, note, bend = 0) {
		if (disposed) throw Error("Audio closed");
		const token = own(name, channel);
		if (name === "segapsg") {
			if (channel === 3) {
				if (settings.psg.noiseRate === "tone3")
					psg.setFrequency(2, keyboardFrequency(note, bend));
				psg.noise({
					type: settings.psg.noiseType,
					rate: settings.psg.noiseRate,
					attenuation: settings.psg.attenuation,
				});
			} else {
				psg.setFrequency(channel, keyboardFrequency(note, bend));
				psg.keyOn(channel);
			}
		} else if (typeof channel === "string") {
			opll.setRhythm({ enabled: true, [channel]: false });
			opll.setRhythm({ [channel]: true });
		} else {
			opll.keyOff(channel);
			opll.setFrequency(channel, keyboardFrequency(note, bend));
			opll.keyOn(channel);
		}
		return { name, channel, token };
	}
	function noteOff(voice) {
		if (
			!voice ||
			leases.get(voice.name + ":" + voice.channel) !== voice.token
		)
			return;
		leases.delete(voice.name + ":" + voice.channel);
		forceOff(voice.name, voice.channel);
	}
	const borrowed = (name, isCurrent) => {
		const target = raw[name],
			owned = new Map(),
			methods = new Map();
		const release = () => {
			for (const [channel, token] of owned)
				noteOff({ name, channel, token });
			owned.clear();
		};
		const client = new Proxy(target, {
			get(object, key) {
				if (key === "then") return undefined;
				if (key === "id" || key === "chip") return name;
				if (key === "dispose" || key === "allNotesOff") return release;
				const value = Reflect.get(object, key, object);
				if (typeof value !== "function") return value;
				if (!methods.has(key))
					methods.set(key, (...args) => {
						if (!isCurrent())
							throw new DOMException(
								"Code session ended",
								"AbortError",
							);
						const channel =
							key === "noise" || key === "noiseOff" ? 3 : args[0];
						if (
							["keyOff", "noteOff", "off", "noiseOff"].includes(
								key,
							) &&
							owned.has(channel)
						) {
							const token = owned.get(channel);
							owned.delete(channel);
							return noteOff({ name, channel, token });
						}
						const result = value.apply(object, args);
						if (name === "ym2413" && key === "setRhythm") {
							for (const drum of DRUMS)
								if (args[0]?.[drum] === true)
									owned.set(drum, own(name, drum));
								else if (args[0]?.[drum] === false)
									owned.delete(drum);
						}
						if (["noteOn", "keyOn", "tone", "noise"].includes(key))
							owned.set(channel, own(name, channel));
						return result;
					});
				return methods.get(key);
			},
		});
		return { client, release };
	};
	return {
		context,
		synth,
		codeInputNode,
		codeOutputNode,
		codeFadeNode,
		masterNode,
		psg,
		opll,
		leases,
		getChip: (name) => raw[name],
		borrowed,
		applySettings,
		noteOn,
		retune,
		noteOff,
		async readState() {
			const [p, f] = await Promise.all([
				inspector.read("segapsg"),
				inspector.read("ym2413"),
			]);
			return {
				psg: {
					...p,
					// Key release writes 15 to hardware but preserves the next-note level.
					configuredAttenuations:
						p.configuredAttenuations ??
						psg._getState().attenuations,
					channels: [
						...p.channels,
						{
							...p.noise,
							noiseType: p.noise.type,
							noiseRate: p.noise.rate,
						},
					],
				},
				opll: f.registers,
				stereo: psg._getState().stereo,
				fm: f,
			};
		},
		setMaster(value) {
			masterNode.gain.setTargetAtTime(value, context.currentTime, 0.005);
		},
		setMix(name, value) {
			Object.assign(mix[name], value);
			synth.mixer.set(name, {
				volume: mix[name].volume,
				muted: !mix[name].enabled,
			});
		},
		getMix: () => structuredClone(mix),
		stopAll() {
			leases.clear();
			psg.allNotesOff();
			opll.allNotesOff();
		},
		async dispose() {
			if (disposed) return;
			disposed = true;
			inspector.dispose();
			codeInputNode.disconnect();
			codeOutputNode.disconnect();
			codeFadeNode.disconnect();
			masterNode.disconnect();
			await synth.close();
			if (context.state !== "closed") await context.close();
		},
	};
}

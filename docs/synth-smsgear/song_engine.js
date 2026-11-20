// SPDX-License-Identifier: BSD-3-Clause
// Reference renderer reuses the existing OPLL+PSG engine and register decoders.
import { Ym2413AudioEngine } from "../js/ym2413audioengine.js";
import { createPsgRegisterState } from "../synth/synth_song_psg_state.js";
import { decodeOpll } from "./preset.js";
export async function createSmsGearSongEngine({
	plan,
	sampleRate = 44100,
	opllFactory,
	psgFactory,
	opllBinary,
	psgBinary,
}) {
	const engine = await Ym2413AudioEngine.create({
		ym2413ModuleFactory: opllFactory,
		ym2413ModuleOptions: opllBinary ? { wasmBinary: opllBinary } : {},
		ym2413Clock: plan.opllClock,
		segaPsgModuleFactory: (options) =>
			psgFactory({
				...options,
				...(psgBinary ? { wasmBinary: psgBinary } : {}),
			}),
		psgClock: plan.psgClock,
		outputSampleRate: sampleRate,
	});
	const shadow = createPsgRegisterState(plan.psgClock),
		registers = new Uint8Array(64);
	let stereo = 255,
		cursor = 0,
		frame = 0,
		playing = false;
	let mix = {
		segapsg: { volume: 0.35, enabled: true },
		ym2413: { volume: 1, enabled: true },
	};
	const rawPsg = engine.psg.generateStereo.bind(engine.psg),
		rawFm = engine.ym2413.generateStereo.bind(engine.ym2413);
	engine.psg.generateStereo = (count) => {
		const pcm = rawPsg(count),
			gain = mix.segapsg.enabled ? mix.segapsg.volume : 0;
		for (let i = 0; i < count; i++) {
			pcm.left[i] *= gain;
			pcm.right[i] *= gain;
		}
		return pcm;
	};
	engine.ym2413.generateStereo = (count) => {
		const pcm = rawFm(count),
			gain = mix.ym2413.enabled ? mix.ym2413.volume : 0;
		for (let i = 0; i < count; i++) {
			pcm.left[i] *= gain;
			pcm.right[i] *= gain;
		}
		return pcm;
	};
	function reset() {
		engine.reset();
		shadow.reset();
		registers.fill(0);
		stereo = 255;
		engine.psg.setStereo(255);
		cursor = 0;
		frame = 0;
	}
	function apply(type, address, value) {
		if (type === 0) {
			engine.writePsg(value);
			shadow.write(value);
		} else if (type === 1) {
			engine.writeYm2413(address, value);
			registers[address] = value;
		} else if (type === 2) {
			stereo = value;
			engine.psg.setStereo(value);
		} else throw Error("Invalid SMSGEAR event");
	}
	const eventFrame = (offset) =>
			Math.round((plan.events[offset] * sampleRate) / 44100),
		endFrame = Math.round((plan.totalSamples * sampleRate) / 44100);
	function process(left, right) {
		left.fill(0);
		right.fill(0);
		if (!playing) return;
		let offset = 0;
		while (offset < left.length && playing) {
			while (cursor < plan.events.length && eventFrame(cursor) <= frame) {
				apply(
					plan.events[cursor + 1],
					plan.events[cursor + 2],
					plan.events[cursor + 3],
				);
				cursor += 4;
			}
			if (frame >= endFrame) {
				playing = false;
				break;
			}
			const next =
					cursor < plan.events.length ? eventFrame(cursor) : endFrame,
				size = Math.min(
					left.length - offset,
					Math.max(0, next - frame),
					endFrame - frame,
				);
			if (!size) {
				if (next < frame) throw Error("Timeline moves backwards");
				continue;
			}
			engine.process(
				left.subarray(offset, offset + size),
				right.subarray(offset, offset + size),
				size,
			);
			offset += size;
			frame += size;
		}
	}
	reset();
	return {
		engine,
		process,
		reset,
		play() {
			playing = true;
		},
		pause() {
			playing = false;
		},
		get playing() {
			return playing;
		},
		setMix(value) {
			mix = structuredClone(value);
		},
		snapshot() {
			return {
				frame,
				timeSamples: Math.round((frame * 44100) / sampleRate),
				totalSamples: plan.totalSamples,
				playing,
				stereo,
				psg: shadow.snapshot(frame),
				opll: Array.from(registers),
				fm: decodeOpll(registers, plan.opllClock),
			};
		},
		dispose() {
			playing = false;
			engine.dispose();
		},
	};
}

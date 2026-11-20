// SPDX-License-Identifier: BSD-3-Clause
// Reference renderer reuses the existing OPLL+PSG engine and register decoders.
import { Ym2413AudioEngine } from "../js/ym2413audioengine.js";
import { createPsgRegisterState } from "../synth/synth_song_psg_state.js";
import { resolveSongEdit } from "./song_edit.js";
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
	let seeking = null,
		sourceLatch = 0,
		actualLatch = 0;
	const seekLeft = new Float32Array(1024),
		seekRight = new Float32Array(1024);
	let channelMutes = {
		segapsg: [false, false, false, false],
		ym2413: Array(9).fill(false),
	};
	function setChannelMutes(value) {
		for (const [name, count] of [
			["segapsg", 4],
			["ym2413", 9],
		]) {
			if (
				!Array.isArray(value?.[name]) ||
				value[name].length !== count ||
				value[name].some((v) => typeof v !== "boolean")
			)
				throw TypeError("Invalid reference channel mutes");
		}
		channelMutes = {
			segapsg: value.segapsg.slice(),
			ym2413: value.ym2413.slice(),
		};
		channelMutes.segapsg.forEach((muted, ch) =>
			engine.setPsgChannelMuted(ch, muted),
		);
		channelMutes.ym2413.forEach((muted, ch) =>
			engine.setChannelMuted(ch, muted),
		);
	}
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
		playing = false;
		seeking = null;
		engine.reset();
		setChannelMutes(channelMutes);
		shadow.reset();
		sourceLatch = actualLatch = 0;
		registers.fill(0);
		stereo = 255;
		engine.psg.setStereo(255);
		cursor = 0;
		frame = 0;
	}
	function apply(type, address, value, original = true) {
		if (type === 0) {
			if (original) {
				if (value & 128) sourceLatch = (value >> 4) & 7;
				else if (actualLatch !== sourceLatch) {
					const state = shadow.snapshot(),
						ch = sourceLatch >> 1;
					// Volume/Noise data can be expressed as one latch byte.
					// Tone high bits require restoring the current low nibble first.
					if (sourceLatch & 1 || ch === 3)
						value =
							0x80 |
							(sourceLatch << 4) |
							(value & (ch === 3 && !(sourceLatch & 1) ? 7 : 15));
					else {
						const latch =
							0x80 |
							(sourceLatch << 4) |
							(state.periods[ch] & 15);
						engine.writePsg(latch);
						shadow.write(latch);
						actualLatch = sourceLatch;
					}
				}
			}
			engine.writePsg(value);
			if (value & 128) actualLatch = (value >> 4) & 7;
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
	function applyDue() {
		while (cursor < plan.events.length && eventFrame(cursor) <= frame) {
			apply(
				plan.events[cursor + 1],
				plan.events[cursor + 2],
				plan.events[cursor + 3],
			);
			cursor += 4;
		}
	}
	function render(left, right) {
		left.fill(0);
		right.fill(0);
		if (!playing) return;
		let offset = 0;
		while (offset < left.length && playing) {
			applyDue();
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
	function beginSeek(seconds) {
		if (
			!Number.isFinite(seconds) ||
			seconds < 0 ||
			seconds > plan.totalSamples / 44100
		)
			throw RangeError("Invalid seek position");
		if (seeking) throw Error("A seek is already running");
		const resume = playing,
			target = Math.round(seconds * sampleRate);
		reset();
		seeking = { target, resume };
		playing = true;
	}
	function process(left, right) {
		if (!seeking) return render(left, right);
		// Bounded work per audio callback: never replay a whole song in one task.
		const count = Math.min(seekLeft.length, seeking.target - frame);
		if (count)
			render(seekLeft.subarray(0, count), seekRight.subarray(0, count));
		left.fill(0);
		right.fill(0);
		if (frame >= seeking.target) {
			applyDue();
			playing = seeking.resume && frame < endFrame;
			seeking = null;
		}
	}
	reset();
	return {
		engine,
		process,
		reset,
		beginSeek,
		editSound(command) {
			if (seeking) throw Error("Wait for seek to finish before editing");
			const state = { opll: registers, psg: shadow.snapshot(), stereo };
			const writes = resolveSongEdit(command, state);
			for (const [type, address, value] of writes)
				apply(type, address, value, false);
		},
		setChannelMutes,
		get seeking() {
			return Boolean(seeking);
		},
		play() {
			if (seeking) throw Error("Seek is still preparing");
			playing = true;
		},
		pause() {
			if (seeking) seeking.resume = false;
			else playing = false;
		},
		get playing() {
			return playing;
		},
		setMix(value) {
			const next = {};
			for (const name of ["segapsg", "ym2413"]) {
				if (
					!Number.isFinite(value?.[name]?.volume) ||
					value[name].volume < 0 ||
					value[name].volume > 2 ||
					typeof value[name].enabled !== "boolean"
				)
					throw TypeError("Invalid source output mix");
				next[name] = {
					volume: value[name].volume,
					enabled: value[name].enabled,
				};
			}
			mix = next;
		},
		snapshot() {
			return {
				frame,
				timeSamples: Math.round((frame * 44100) / sampleRate),
				totalSamples: plan.totalSamples,
				playing: playing && !seeking,
				seeking: Boolean(seeking),
				seekTargetSamples: seeking
					? Math.round((seeking.target * 44100) / sampleRate)
					: null,
				channelMutes: {
					segapsg: channelMutes.segapsg.slice(),
					ym2413: channelMutes.ym2413.slice(),
				},
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

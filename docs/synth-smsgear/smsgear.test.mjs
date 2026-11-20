import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import {
	createDefaultPreset,
	readPreset,
	presetFromRegisters,
	capturePreset,
} from "./preset.js";
import { createSmsGearCodeProject } from "./code_project.js";
import { readSmsGearVgm } from "./vgm_import.js";
import { createDemoVgm } from "./fixtures.js";
import { createSmsGearSongEngine } from "./song_engine.js";
import opllFactory from "../generated/ym2413_wasm.js";
import psgFactory from "../generated/segapsg_wasm.js";
import { selectSmsGearCodeDeclarations } from "./code_declarations.js";
const binary = async (name) =>
	new Uint8Array(
		await readFile(
			new URL(`../generated/${name}_wasm.wasm`, import.meta.url),
		),
	);
test("PSG-first presets roundtrip the shared user patch without duplicate aliases", () => {
	const p = readPreset(createDefaultPreset());
	assert.equal(p.section, "psg");
	assert.deepEqual(readPreset(JSON.stringify(p)), p);
	assert.throws(() =>
		readPreset({ ...p, psg: { ...p.psg, attenuation: 16 } }),
	);
	assert.throws(() =>
		readPreset({ ...p, opll: { ...p.opll, instrument: 16 } }),
	);
});
test("working/saved Cassette retains accepted source and unsaved edits", async () => {
	const p = createSmsGearCodeProject({ starterCode: "const first=1;" });
	p.setAutoApply(false);
	p.writeEditorText("/index.js", "const second=2;");
	assert.equal(await p.readSavedFile("/index.js"), "const first=1;");
	const q = createSmsGearCodeProject();
	q.restore(await q.prepareImport(await p.exportProject()));
	assert.equal(q.autoApply, false);
	assert.equal(q.fs.get("/index.js").data, "const second=2;");
	assert.equal(await q.readSavedFile("/index.js"), "const first=1;");
	q.saveAll();
	assert.equal(await q.readSavedFile("/index.js"), "const second=2;");
});
test("YM2413-only reference produces finite audio and its output mute keeps chip time running", async () => {
	const plan = await readSmsGearVgm(createDemoVgm({ psg: false }));
	const engine = await createSmsGearSongEngine({
		plan,
		opllFactory,
		psgFactory,
		opllBinary: await binary("ym2413"),
		psgBinary: await binary("segapsg"),
	});
	try {
		engine.play();
		const left = new Float32Array(4096),
			right = new Float32Array(4096);
		engine.process(left, right);
		assert(left.every(Number.isFinite));
		assert(left.some((value) => Math.abs(value) > 0.001));
		assert.deepEqual(left, right, "YM2413 is mono");
		const frame = engine.snapshot().frame;
		engine.setMix({
			segapsg: { volume: 0, enabled: false },
			ym2413: { volume: 1, enabled: false },
		});
		engine.process(left, right);
		assert(left.every((value) => value === 0));
		assert(engine.snapshot().frame > frame);
	} finally {
		engine.dispose();
	}
});
test("capture keeps the selected tone pan across Auto voices without changing Live registers", async () => {
	const plan = await readSmsGearVgm(createDemoVgm({ fm: false }));
	const engine = await createSmsGearSongEngine({
		plan,
		opllFactory,
		psgFactory,
		opllBinary: await binary("ym2413"),
		psgBinary: await binary("segapsg"),
	});
	try {
		engine.play();
		engine.process(new Float32Array(128), new Float32Array(128));
		const state = engine.snapshot(),
			before = structuredClone(state);
		assert.equal(presetFromRegisters("psg", 0, state).psg.stereo, 0x10);
		assert.equal(capturePreset("psg", 0, state).psg.stereo, 0x70);
		assert.deepEqual(state, before);
	} finally {
		engine.dispose();
	}
});
for (const [label, opts] of [
	["PSG", { psg: true, fm: false }],
	["FM", { psg: false, fm: true }],
	["both", { psg: true, fm: true }],
])
	test(
		label +
			" VGM/VGZ import preserves source, chip writes, stereo and complete patches",
		async () => {
			const bytes = createDemoVgm(opts),
				saved = bytes.slice(),
				a = await readSmsGearVgm(bytes),
				b = await readSmsGearVgm(gzipSync(bytes));
			assert.deepEqual(bytes, saved);
			assert.deepEqual(a.events, b.events);
			assert.equal(a.totalSamples, 88200);
			assert(a.voices.length > 0);
			if (opts.psg)
				assert(
					a.events.some(
						(value, index) => index % 4 === 1 && value === 2,
					),
				);
			for (const voice of a.voices)
				assert.deepEqual(readPreset(voice.preset), voice.preset);
		},
	);
test("invalid/truncated/dual/non-SMS logs reject before replacing state", async () => {
	const bytes = createDemoVgm();
	new DataView(bytes.buffer).setUint32(0x0c, 0x40000000 | 3579545, true);
	await assert.rejects(readSmsGearVgm(bytes), /Dual/);
	await assert.rejects(
		readSmsGearVgm(createDemoVgm().subarray(0, 0x102)),
		/Truncated|end/i,
	);
	const empty = createDemoVgm({ psg: false, fm: false });
	await assert.rejects(readSmsGearVgm(empty), /neither/);
});
for (const sampleRate of [44100, 48000])
	test(`real two-chip ${sampleRate}: stereo, output mutes and exact Pause freeze`, async (t) => {
		const plan = await readSmsGearVgm(createDemoVgm({ fm: false })),
			engine = await createSmsGearSongEngine({
				plan,
				sampleRate,
				opllFactory,
				psgFactory,
				opllBinary: await binary("ym2413"),
				psgBinary: await binary("segapsg"),
			});
		t.after(() => engine.dispose());
		engine.setMix({
			segapsg: { volume: 0.35, enabled: true },
			ym2413: { volume: 1, enabled: true },
		});
		engine.play();
		const left = new Float32Array(1024),
			right = new Float32Array(1024);
		engine.process(left, right);
		assert(left.some((x) => Math.abs(x) > 0.001));
		assert(right.every((x) => x === 0));
		const frame = engine.snapshot().frame;
		engine.pause();
		engine.process(left, right);
		assert(left.every((x) => x === 0));
		assert.equal(engine.snapshot().frame, frame);
		engine.play();
		engine.setMix({
			segapsg: { volume: 0.35, enabled: false },
			ym2413: { volume: 1, enabled: false },
		});
		engine.process(left, right);
		assert(left.every((x) => x === 0));
		assert(engine.snapshot().frame > frame);
		engine.reset();
		engine.setMix({
			segapsg: { volume: 0.35, enabled: true },
			ym2413: { volume: 1, enabled: true },
		});
		engine.play();
		for (let i = 0; i < Math.ceil((sampleRate * 0.55) / 1024); i++)
			engine.process(left, right);
		assert(right.some((x) => Math.abs(x) > 0.001));
		assert(left.every((x) => x === 0));
		const preset = presetFromRegisters("psg", 0, engine.snapshot());
		assert.equal(preset.psg.stereo, 1);
	});
test("Code declarations expose only the shared PSG/OPLL API and use typed client methods", async () => {
	const source = await readFile(
		new URL(
			"../playground/tetorica-playground-globals.d.ts",
			import.meta.url,
		),
		"utf8",
	);
	const result = selectSmsGearCodeDeclarations(source);
	assert.match(result, /PlaygroundYm2413/);
	assert.match(result, /PSGApi/);
	assert.match(result, /Name extends 'segapsg'\|'ym2413'/);
	assert.doesNotMatch(
		result,
		/declare function useSoundChip<Name extends keyof PlaygroundSoundChipMap>/,
	);
});

for (const sampleRate of [44100, 48000])
	test(`seek ${sampleRate}: exact history, boundary writes, Pause and output mutes`, async (t) => {
		const plan = await readSmsGearVgm(createDemoVgm());
		const events = Array.from(plan.events);
		for (let i = 0; i < events.length; i += 4)
			if (events[i + 1] === 2) events[i + 3] |= 0x88;
		plan.events = new Uint32Array([
			0,
			0,
			0,
			0xe4,
			0,
			0,
			0,
			0xf4,
			...events,
		]);
		const make = () =>
			createSmsGearSongEngine({
				plan,
				sampleRate,
				opllFactory,
				psgFactory,
			});
		const engine = await make();
		t.after(() => engine.dispose());
		const left = new Float32Array(128),
			right = new Float32Array(128);
		const masks = {
			segapsg: Array(4).fill(false),
			ym2413: Array(9).fill(false),
		};
		engine.setChannelMutes(masks);
		for (const seconds of [0.7, 0.5, 0.13, 0, 2]) {
			engine.pause();
			engine.beginSeek(seconds);
			let count = 0;
			while (engine.seeking) {
				engine.process(left, right);
				assert(left.every((x) => x === 0));
				assert(++count < 1000);
			}
			const state = engine.snapshot();
			assert.equal(state.frame, Math.round(seconds * sampleRate));
			assert.equal(state.playing, false);
			if (seconds === 0.5)
				assert.equal(
					state.stereo,
					0x89,
					"boundary write is visible while paused",
				);
			const oracle = await make();
			try {
				oracle.play();
				let remaining = Math.round(seconds * sampleRate);
				while (remaining) {
					const size = Math.min(remaining, 128);
					oracle.process(
						left.subarray(0, size),
						right.subarray(0, size),
					);
					remaining -= size;
				}
				const expectedL = new Float32Array(128),
					expectedR = new Float32Array(128);
				oracle.process(expectedL, expectedR);
				engine.play();
				engine.process(left, right);
				assert.deepEqual(left, expectedL);
				assert.deepEqual(right, expectedR);
				if (seconds === 0.13)
					assert(
						right.some((value) => Math.abs(value) > 0.0001),
						"Noise contributes to the history comparison",
					);
			} finally {
				oracle.dispose();
			}
		}
		engine.play();
		engine.beginSeek(0.25);
		assert.throws(() => engine.beginSeek(0.5), /already/);
		while (engine.seeking) engine.process(left, right);
		assert.equal(engine.snapshot().playing, true, "seek preserves Playing");
		const before = engine.snapshot();
		assert.throws(() => engine.beginSeek(NaN), /Invalid/);
		assert.deepEqual(engine.snapshot(), before);
		engine.pause();
		masks.segapsg[0] = true;
		masks.segapsg[3] = true;
		masks.ym2413[0] = true;
		engine.setChannelMutes(masks);
		engine.beginSeek(0.25);
		while (engine.seeking) engine.process(left, right);
		assert.deepEqual(engine.snapshot().channelMutes, masks);
		engine.play();
		engine.process(left, right);
		assert(left.every((x) => x === 0));
		const registers = engine.snapshot().opll;
		engine.setChannelMutes({
			segapsg: Array(4).fill(false),
			ym2413: Array(9).fill(false),
		});
		assert.deepEqual(engine.snapshot().opll, registers);
		const oracle = await make();
		try {
			oracle.play();
			let remaining = Math.round(0.25 * sampleRate) + 128;
			while (remaining) {
				const n = Math.min(remaining, 128);
				oracle.process(left.subarray(0, n), right.subarray(0, n));
				remaining -= n;
			}
			const expectedL = new Float32Array(128),
				expectedR = new Float32Array(128);
			oracle.process(expectedL, expectedR);
			engine.process(left, right);
			assert.deepEqual(left, expectedL);
			assert.deepEqual(right, expectedR);
		} finally {
			oracle.dispose();
		}
	});

const { RHYTHM_KEYS, assignedDrums, keyboardAction, keyboardFrequency } =
	await import("./performance.js");
const { opllEnvelopeGeometry, opllEnvelopePatch } = await import(
	"./opll_envelope.js"
);
test("new instruments enable shared Rhythm while saved Off remains Off", () => {
	const p = createDefaultPreset();
	assert.equal(p.opll.rhythm.enabled, true);
	p.opll.rhythm.enabled = false;
	assert.equal(readPreset(p).opll.rhythm.enabled, false);
});
test("Rhythm keyboard maps Auto 1–5 and restricts CH7–9 without taking keys from melodic CHs or PSG", () => {
	const entries = Array.from(
		"1234567890qwertyuiopasdfghjklzxcvbnm",
		(key, i) => ({ key, midi: 40 + i }),
	);
	const action = (key, channel = "auto", section = "opll", rhythm = true) =>
		keyboardAction(key, { entries, channel, section, rhythm });
	for (const drum of RHYTHM_KEYS)
		assert.equal(action(drum.key).drum, drum.name);
	assert.equal(action("a").kind, "note");
	assert.equal(action("1", "0").kind, "note");
	assert.equal(action("1", "auto", "psg").kind, "note");
	assert.equal(action("1", "auto", "opll", false).kind, "note");
	for (const ch of ["6", "7", "8"])
		for (const entry of entries) {
			const drum = assignedDrums(ch).find((d) => d.key === entry.key);
			assert.equal(
				action(entry.key, ch)?.drum ?? null,
				drum?.name ?? null,
			);
		}
	assert.deepEqual(
		assignedDrums("7").map((d) => d.name),
		["snare", "hiHat"],
	);
});
test("OPLL Envelope handles roundtrip actual 4-bit rates and clamp edits; EGT and zero rates are represented", () => {
	for (const egt of [false, true])
		for (const rate of [0, 7, 15]) {
			const op = { ar: rate, dr: rate, sl: rate, rr: rate, egt };
			const g = opllEnvelopeGeometry(op);
			assert.deepEqual(
				opllEnvelopePatch(op, "attack", g.handles.attack),
				{ ar: rate },
			);
			assert.deepEqual(
				opllEnvelopePatch(op, "decay", {
					x: g.decay,
					y: g.top + (g.h * op.sl) / 15,
				}),
				{
					dr: rate,
					sl: rate,
				},
			);
			assert.deepEqual(
				opllEnvelopePatch(op, "sustain", {
					x: g.handles.sustain.x,
					y: g.top + (g.h * op.sl) / 15,
				}),
				{ sl: rate },
			);
			assert.deepEqual(opllEnvelopePatch(op, "rate", g.handles.rate), {
				rr: rate,
			});
			assert(
				g.points.every(
					([x, y]) => Number.isFinite(x) && Number.isFinite(y),
				),
			);
			for (let i = 1; i < g.points.length; i++)
				assert(g.points[i][0] >= g.points[i - 1][0]);
			if (rate === 0) assert(g.points.every((p) => p[1] === g.bottom));
			for (const handle of ["attack", "decay", "sustain", "rate"])
				for (const pos of [
					{ x: -100, y: -100 },
					{ x: 10000, y: 10000 },
				])
					for (const value of Object.values(
						opllEnvelopePatch(op, handle, pos),
					))
						assert(
							value >= 0 &&
								value <= 15 &&
								Number.isInteger(value),
						);
		}
	const op = { ar: 15, dr: 10, sl: 7, rr: 9, egt: true };
	const g = opllEnvelopeGeometry(op);
	assert.equal(
		g.points.at(-3)[1],
		g.points[2][1],
		"EGT holds SL until key-off",
	);
});

test("keyboard bend converts the base note to frequency without fractional MIDI API calls", () => {
	assert.equal(keyboardFrequency("A4"), 440);
	assert(
		Math.abs(keyboardFrequency(69, 0.5) / 440 - 2 ** (0.5 / 12)) < 1e-12,
	);
	assert(
		Math.abs(keyboardFrequency(69, -0.37) / 440 - 2 ** (-0.37 / 12)) <
			1e-12,
	);
	assert(keyboardFrequency(0, -2) > 0);
	assert(keyboardFrequency(127, 2) > 0);
	assert.throws(() => keyboardFrequency(69, NaN));
	assert.throws(() => keyboardFrequency(69.5));
});

test("new FM voices start editable; existing fixed-ROM choices remain fixed", () => {
	const p = createDefaultPreset();
	assert.equal(p.opll.instrument, 0);
	p.opll.instrument = 1;
	assert.equal(readPreset(p).opll.instrument, 1);
});

test("all OPLL handles lie on the rendered polyline including inactive rates and Sustain overrides", () => {
	for (const width of [280, 900])
		for (const ar of [0, 15])
			for (const dr of [0, 1, 15])
				for (const sl of [0, 7, 15])
					for (const rr of [0, 6, 15])
						for (const egt of [false, true])
							for (const sustain of [false, true]) {
								const g = opllEnvelopeGeometry(
									{ ar, dr, sl, rr, egt },
									{ width, height: 220, sustain },
								);
								for (const [name, p] of Object.entries(
									g.handles,
								)) {
									let distance = Infinity;
									for (let i = 1; i < g.points.length; i++) {
										const a = g.points[i - 1],
											b = g.points[i],
											dx = b[0] - a[0],
											dy = b[1] - a[1],
											length = dx * dx + dy * dy,
											t = length
												? Math.max(
														0,
														Math.min(
															1,
															((p.x - a[0]) * dx +
																(p.y - a[1]) *
																	dy) /
																length,
														),
													)
												: 0;
										distance = Math.min(
											distance,
											Math.hypot(
												p.x - a[0] - t * dx,
												p.y - a[1] - t * dy,
											),
										);
									}
									assert(
										distance < 1e-7,
										JSON.stringify({
											width,
											ar,
											dr,
											sl,
											rr,
											egt,
											sustain,
											name,
											distance,
										}),
									);
								}
							}
});

test("OPLL combined handle level guide reflects modulator TL and carrier attenuation", () => {
	for (const tlMax of [15, 63]) {
		const op = { ar: 15, dr: 5, sl: 7, rr: 7, egt: true, tl: 0, tlMax };
		const loud = opllEnvelopeGeometry(op);
		const quiet = opllEnvelopeGeometry({ ...op, tl: tlMax });
		assert(quiet.handles.attack.y > loud.handles.attack.y);
		assert.equal(quiet.handles.attack.x, loud.handles.attack.x);
		assert.equal(op.tl, 0);
	}
});

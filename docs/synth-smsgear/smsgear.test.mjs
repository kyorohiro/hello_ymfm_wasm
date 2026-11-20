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
		plan, opllFactory, psgFactory,
		opllBinary: await binary("ym2413"), psgBinary: await binary("segapsg"),
	});
	try {
		engine.play();
		const left = new Float32Array(4096), right = new Float32Array(4096);
		engine.process(left, right);
		assert(left.every(Number.isFinite));
		assert(left.some(value => Math.abs(value) > 0.001));
		assert.deepEqual(left, right, "YM2413 is mono");
		const frame = engine.snapshot().frame;
		engine.setMix({ segapsg: { volume: 0, enabled: false }, ym2413: { volume: 1, enabled: false } });
		engine.process(left, right);
		assert(left.every(value => value === 0));
		assert(engine.snapshot().frame > frame);
	} finally { engine.dispose(); }
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

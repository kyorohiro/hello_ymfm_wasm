// SPDX-License-Identifier: BSD-3-Clause
import test from "node:test";
import assert from "node:assert/strict";
import { buildSongEdit, resolveSongEdit } from "./song_edit.js";
import { createDefaultPreset } from "./preset.js";
import { createSmsGearSongEngine } from "./song_engine.js";
import { readSmsGearVgm } from "./vgm_import.js";
import { createDemoVgm } from "./fixtures.js";
import opllFactory from "../generated/ym2413_wasm.js";
import psgFactory from "../generated/segapsg_wasm.js";
const edit = (section, channel, ...changes) => ({
	section,
	channel,
	changes: changes.map(([path, value]) => ({ path, value })),
});
const make = async (events, sampleRate = 44100) => {
	const plan = await readSmsGearVgm(createDemoVgm());
	plan.events = new Uint32Array(events);
	plan.totalSamples = 44100;
	return createSmsGearSongEngine({
		plan,
		sampleRate,
		opllFactory,
		psgFactory,
	});
};
test("UI edit includes only touched fields, not stale Live values", () => {
	const a = createDefaultPreset(),
		b = structuredClone(a);
	b.opll.userPatch.operators[0].ar = 12;
	const command = buildSongEdit("opll", 2, a, b);
	assert.deepEqual(command, edit("opll", 2, [["operator", 0, "ar"], 12]));
});
for (const rate of [44100, 48000])
	test(`direct edits ${rate}: preserve adjacent bits and timeline; original writes win`, async (t) => {
		const e = await make(
			[
				0, 1, 0x30, 0x04, 0, 1, 4, 0x12, 0, 1, 0x20, 0x1b, 2205, 1, 4,
				0x56,
			],
			rate,
		);
		t.after(() => e.dispose());
		e.play();
		const l = new Float32Array(128),
			r = new Float32Array(128);
		e.process(l, r);
		const before = e.snapshot();
		e.editSound(edit("opll", 0, [["operator", 0, "ar"], 9]));
		assert.equal(e.snapshot().opll[4], 0x92);
		assert.equal(e.snapshot().opll[0x20], 0x1b);
		assert.equal(e.snapshot().frame, before.frame);
		assert.equal(e.playing, true);
		while (e.snapshot().timeSamples < 2500) e.process(l, r);
		assert.equal(e.snapshot().opll[4], 0x56);
		e.pause();
		e.editSound(edit("opll", 0, [["attenuation"], 11]));
		assert.equal(e.snapshot().opll[0x30], 11);
		assert.equal(e.playing, false);
		const stable = e.snapshot();
		assert.throws(() =>
			e.editSound(
				edit(
					"opll",
					0,
					[["attenuation"], 3],
					[["operator", 1, "tl"], 20],
				),
			),
		);
		assert.deepEqual(e.snapshot(), stable, "invalid edit is atomic");
		e.beginSeek(0.1);
		assert.throws(
			() => e.editSound(edit("opll", 0, [["attenuation"], 2])),
			/seek/,
		);
	});
for (const latched of [0, 1, 6, 7])
	test(`PSG original data retains source latch ${latched} after manual edit`, async (t) => {
		const source = 0x80 | (latched << 4) | 2;
		const e = await make([0, 0, 0, source, 2205, 0, 0, 5]);
		t.after(() => e.dispose());
		e.play();
		const l = new Float32Array(128),
			r = new Float32Array(128);
		e.process(l, r);
		e.editSound(edit("psg", 1, [["attenuation"], 3]));
		assert.equal(e.snapshot().psg.attenuations[1], 3);
		while (e.snapshot().timeSamples < 2500) e.process(l, r);
		const p = e.snapshot().psg;
		if (latched === 0) assert.equal(p.periods[0], 82);
		if (latched === 1) assert.equal(p.attenuations[0], 5);
		if (latched === 6) assert.equal(p.noiseMode, 5);
		if (latched === 7) assert.equal(p.attenuations[3], 5);
		assert.equal(
			p.attenuations[1],
			3,
			"manual level not routed into source data",
		);
	});
test("Noise and stereo partial edits use latest bits; Rhythm levels preserve triggers and neighbors", async (t) => {
	const e = await make([
		0, 0, 0, 0xe7, 0, 2, 0, 0xa5, 0, 1, 14, 0x3f, 0, 1, 0x37, 0x49,
	]);
	t.after(() => e.dispose());
	e.play();
	e.process(new Float32Array(128), new Float32Array(128));
	e.pause();
	e.editSound(
		edit("psg", 3, [["noiseType"], "periodic"], [["stereo", 0], false]),
	);
	assert.equal(e.snapshot().psg.noiseMode, 3);
	assert.equal(e.snapshot().stereo, 0xa4);
	assert.throws(() => e.editSound(edit("psg", 0, [["noiseRate"], "high"])));
	e.editSound(edit("opll", 7, [["rhythm", "snare"], 2]));
	assert.equal(e.snapshot().opll[0x37], 0x42);
	assert.equal(e.snapshot().opll[14], 0x3f);
});
test("old PSG logs: ignore only time-zero zero User-register initialization without FM clock", async () => {
	const b = createDemoVgm({ fm: false });
	const p = await readSmsGearVgm(b);
	// Insert a YM2413 command at the actual data offset.
	const offset =
		new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(
			0x34,
			true,
		) + 0x34;
	const add = (reg, value) =>
		new Uint8Array([
			...b.slice(0, offset),
			0x51,
			reg,
			value,
			...b.slice(offset),
		]);
	const accepted = await readSmsGearVgm(add(0, 0));
	assert(accepted.warnings.some((w) => w.includes("undeclared YM2413")));
	assert.deepEqual(accepted.events, p.events);
	await assert.rejects(() => readSmsGearVgm(add(0, 1)), /clock/);
	await assert.rejects(() => readSmsGearVgm(add(0x20, 0)), /clock/);
});

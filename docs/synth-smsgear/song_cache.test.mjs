// SPDX-License-Identifier: BSD-3-Clause
import test from "node:test";
import assert from "node:assert/strict";
import { createSmsGearSongEngine } from "./song_engine.js";
import { readSmsGearVgm } from "./vgm_import.js";
import { createDemoVgm } from "./fixtures.js";
import opllFactory from "../generated/ym2413_wasm.js";
import psgFactory from "../generated/segapsg_wasm.js";
const make = async (
	sampleRate,
	{ fm = false, seekCache = true, fmState = true } = {},
) => {
	const plan = await readSmsGearVgm(createDemoVgm({ fm }));
	if (!fm) {
		plan.totalSamples = 44100 * 400;
		plan.events = new Uint32Array([
			0,
			0,
			0,
			0x84,
			0,
			0,
			0,
			0x0f,
			0,
			0,
			0,
			0x92,
			0,
			0,
			0,
			0xc7,
			0,
			0,
			0,
			0x05,
			0,
			0,
			0,
			0xd5,
			0,
			0,
			0,
			0xe7,
			0,
			0,
			0,
			0xf3,
			0,
			2,
			0,
			0x95,
			44100 * 4,
			0,
			0,
			0xe3,
			44100 * 5,
			2,
			0,
			0xa9,
			44100 * 7,
			0,
			0,
			0xe4,
			44100 * 9,
			0,
			0,
			0xe7,
			44100 * 10,
			0,
			0,
			0x83,
			44100 * 10 + 4410,
			0,
			0,
			0x12,
			44100 * 11,
			0,
			0,
			0x96,
		]);
	}
	return createSmsGearSongEngine({
		plan,
		sampleRate,
		opllFactory: fmState
			? opllFactory
			: async (options) => {
					const module = await opllFactory(options);
					delete module._ym2413_save_state;
					delete module._ym2413_load_state;
					return module;
				},
		psgFactory,
		seekCache,
	});
};
const left = new Float32Array(128),
	right = new Float32Array(128);
function seek(engine, seconds) {
	engine.beginSeek(seconds);
	let callbacks = 0;
	while (engine.seeking) {
		engine.process(left, right);
		assert(left.every((x) => x === 0) && right.every((x) => x === 0));
		assert(++callbacks < 30000);
	}
	return callbacks;
}
function renderTo(engine, frame) {
	engine.play();
	let remaining = frame - engine.snapshot().frame;
	while (remaining > 0) {
		const n = Math.min(128, remaining);
		engine.process(left.subarray(0, n), right.subarray(0, n));
		remaining -= n;
	}
	engine.pause();
}
async function compare(engine, sampleRate, seconds, configure = () => {}) {
	const oracle = await make(sampleRate, { seekCache: false });
	try {
		configure(oracle);
		renderTo(oracle, Math.round(seconds * sampleRate));

		engine.play();
		oracle.play();
		const a = new Float32Array(128),
			b = new Float32Array(128);
		for (let i = 0; i < 24; i++) {
			oracle.process(left, right);
			engine.process(a, b);
			assert.deepEqual(a, left);
			assert.deepEqual(b, right);
		}
		const current = engine.snapshot(),
			expected = oracle.snapshot();
		assert.deepEqual(current.opll, expected.opll);
		assert.equal(current.stereo, expected.stereo);
		for (const key of ["periods", "attenuations", "noiseMode", "latched"])
			assert.deepEqual(current.psg[key], expected.psg[key]);
		engine.pause();
	} finally {
		oracle.dispose();
	}
}
for (const sampleRate of [44100, 48000]) {
	test(`PSG cache ${sampleRate}: exact Noise/Tone-3/stereo PCM, backward/forward/boundary seeks`, async (t) => {
		const e = await make(sampleRate);
		t.after(() => e.dispose());
		assert.equal(e.snapshot().seekCache.supported, true);
		const cold = seek(e, 12);
		assert.equal(e.snapshot().seekCache.entries, 2);
		for (const seconds of [10.2, 5, 5.1, 0, 9.3, 12]) {
			const count = seek(e, seconds),
				s = e.snapshot();
			assert.equal(s.frame, Math.round(seconds * sampleRate));
			assert.equal(s.playing, false);
			if (seconds === 10.2) {
				assert.equal(s.seekCache.seekStartFrame, 10 * sampleRate);
				assert(count < cold / 10);
			}
			await compare(e, sampleRate, seconds);
		}
		renderTo(e, 13 * sampleRate);
		e.play();
		e.beginSeek(10.3);
		while (e.seeking) e.process(left, right);
		assert.equal(e.playing, true);
		e.pause();
	});
	test(`PSG cache ${sampleRate}: edited history never cached; current mix and mutes survive restore`, async (t) => {
		const e = await make(sampleRate);
		t.after(() => e.dispose());
		seek(e, 12);
		e.editSound({
			section: "psg",
			channel: 0,
			changes: [{ path: ["attenuation"], value: 1 }],
		});
		renderTo(e, 16 * sampleRate);
		assert.equal(e.snapshot().seekCache.cleanHistory, false);
		assert.equal(e.snapshot().seekCache.entries, 2);
		const mix = {
			segapsg: { volume: 0.2, enabled: true },
			ym2413: { volume: 1, enabled: true },
		};
		e.setMix(mix);
		seek(e, 15.2);
		assert.equal(e.snapshot().seekCache.seekStartFrame, 10 * sampleRate);
		assert.equal(e.snapshot().seekCache.cleanHistory, true);
		assert.equal(
			e.snapshot().psg.attenuations[0],
			6,
			"original stream level restored",
		);
		await compare(e, sampleRate, 15.2, (o) => o.setMix(mix));
		const mutes = {
			segapsg: Array(4).fill(true),
			ym2413: Array(9).fill(false),
		};
		e.setChannelMutes(mutes);
		seek(e, 10.2);
		e.play();
		e.process(left, right);
		assert(left.every((v) => v === 0) && right.every((v) => v === 0));
		assert.deepEqual(e.snapshot().channelMutes, mutes);
		e.pause();
		e.setSeekCache(false);
		assert.equal(e.snapshot().seekCache.entries, 0);
		seek(e, 10.2);
		assert.equal(e.snapshot().seekCache.seekStartFrame, 0);
		e.setSeekCache(true);
		seek(e, 12);
		e.beginSeek(4);
		e.process(left, right);
		e.reset();
		assert.equal(e.seeking, false);
		assert.equal(e.playing, false);
		assert.equal(e.snapshot().frame, 0);
	});
}
test("checkpoint eviction stays bounded; disabling and disposal release entries", async (t) => {
	const e = await make(44100);
	t.after(() => e.dispose());
	seek(e, 330);
	const cache = e.snapshot().seekCache;
	assert.equal(cache.entries, 64);
	assert(cache.bytes <= cache.maxBytes);
	seek(e, 5.2);
	assert.equal(
		e.snapshot().seekCache.seekStartFrame,
		0,
		"evicted early checkpoint falls back to original history",
	);
	e.setSeekCache(false);
	assert.equal(e.snapshot().seekCache.bytes, 0);
	assert.equal(e.snapshot().seekCache.entries, 0);
});
test("older FM WASM explicitly uses uncached history reconstruction", async (t) => {
	const e = await make(44100, { fm: true, fmState: false });
	t.after(() => e.dispose());
	assert.equal(e.snapshot().seekCache.supported, false);
	assert.match(e.snapshot().seekCache.reason, /YM2413/);
	seek(e, 0.7);
	assert.equal(e.snapshot().seekCache.entries, 0);
	assert.equal(e.snapshot().seekCache.seekStartFrame, 0);
});

test("older PSG WASM without state exports falls back to exact uncached seeking", async (t) => {
	const plan = await readSmsGearVgm(createDemoVgm({ fm: false }));
	const oldPsgFactory = async (options) => {
		const module = await psgFactory(options);
		delete module._segapsg_save_state;
		delete module._segapsg_load_state;
		return module;
	};
	const e = await createSmsGearSongEngine({
		plan,
		opllFactory,
		psgFactory: oldPsgFactory,
	});
	t.after(() => e.dispose());
	assert.equal(e.snapshot().seekCache.supported, false);
	assert.match(e.snapshot().seekCache.reason, /unavailable/);
	seek(e, 0.5);
	assert.equal(e.snapshot().timeSamples, 22050);
	assert.equal(e.snapshot().seekCache.entries, 0);
});

async function makeFm(sampleRate, seekCache = true, clock = 3579545) {
	const plan = await readSmsGearVgm(createDemoVgm());
	plan.opllClock = clock;
	plan.totalSamples = 44100 * 30;
	const events = [];
	const fm = (time, reg, value) => events.push(time, 1, reg, value);
	for (const [r, v] of [
		[0, 0xe1],
		[1, 0xe1],
		[2, 0x10],
		[3, 0x05],
		[4, 0xf4],
		[5, 0xf3],
		[6, 0x35],
		[7, 0x48],
	])
		fm(0, r, v);
	for (let ch = 0; ch < 9; ch++) {
		fm(0, 0x30 + ch, ch < 6 ? (ch % 3 << 4) | 3 : 0x34);
		fm(0, 0x10 + ch, 0x80 + ch);
		fm(0, 0x20 + ch, ch < 6 ? 0x17 : 7);
	}
	fm(0, 14, 63);
	fm(44100 * 5, 3, 0x04);
	fm(44100 * 6, 0x20, 7);
	fm(44100 * 7, 0x20, 0x17);
	fm(44100 * 9, 14, 32);
	fm(44100 * 10, 14, 63);
	fm(44100 * 12, 4, 0xb8);
	events.push(
		0,
		0,
		0,
		0x84,
		0,
		0,
		0,
		0x0f,
		0,
		0,
		0,
		0x94,
		0,
		0,
		0,
		0xe7,
		0,
		0,
		0,
		0xf3,
		0,
		2,
		0,
		0x99,
	);
	const rows = [];
	for (let i = 0; i < events.length; i += 4)
		rows.push(events.slice(i, i + 4));
	rows.sort((a, b) => a[0] - b[0]);
	plan.events = new Uint32Array(rows.flat());
	return createSmsGearSongEngine({
		plan,
		sampleRate,
		seekCache,
		opllFactory,
		psgFactory,
	});
}
async function compareFm(
	e,
	rate,
	seconds,
	{ mix, mutes, clock = 3579545 } = {},
) {
	const oracle = await makeFm(rate, false, clock);
	try {
		if (mix) oracle.setMix(mix);
		if (mutes) oracle.setChannelMutes(mutes);
		renderTo(oracle, Math.round(rate * seconds));
		e.play();
		oracle.play();
		const a = new Float32Array(128),
			b = new Float32Array(128);
		for (let i = 0; i < 24; i++) {
			e.process(a, b);
			oracle.process(left, right);
			assert.deepEqual(a, left);
			assert.deepEqual(b, right);
		}
		assert.deepEqual(e.snapshot().opll, oracle.snapshot().opll);
		assert.deepEqual(
			e.snapshot().psg.periods,
			oracle.snapshot().psg.periods,
		);
		assert.equal(e.snapshot().stereo, oracle.snapshot().stereo);
		e.pause();
	} finally {
		oracle.dispose();
	}
}
for (const [rate, clock] of [
	[44100, 3579545],
	[48000, 3579545],
	[96000, 3000000],
]) {
	test(`FM+PSG checkpoints ${rate}/${clock}: exact User/Envelope/LFO/Noise/Rhythm state and clean original history`, async (t) => {
		const e = await makeFm(rate, true, clock);
		t.after(() => e.dispose());
		assert.equal(e.snapshot().seekCache.supported, true);
		seek(e, 11.25);
		for (const seconds of [10.2, 5, 5.1, 8.2, 11]) {
			seek(e, seconds);
			assert(e.snapshot().seekCache.seekStartFrame > 0);
			await compareFm(e, rate, seconds, { clock });
		}
		e.editSound({
			section: "opll",
			channel: 0,
			changes: [{ path: ["operator", 0, "ar"], value: 3 }],
		});
		renderTo(e, 16 * rate);
		assert.equal(e.snapshot().seekCache.cleanHistory, false);
		seek(e, 15.1);
		assert.equal(e.snapshot().seekCache.seekStartFrame, 10 * rate);
		await compareFm(e, rate, 15.1, { clock });
	});
	test(`FM+PSG checkpoints ${rate}/${clock}: output changes invalidate held resampler samples`, async (t) => {
		const e = await makeFm(rate, true, clock);
		t.after(() => e.dispose());
		seek(e, 11.25);
		const mix = {
			segapsg: { volume: 0.2, enabled: true },
			ym2413: { volume: 0.4, enabled: true },
		};
		e.setMix(mix);
		assert.equal(e.snapshot().seekCache.entries, 0);
		seek(e, 10.2);
		assert.equal(e.snapshot().seekCache.seekStartFrame, 0);
		await compareFm(e, rate, 10.2, { clock, mix });
		seek(e, 10.3);
		assert.equal(e.snapshot().seekCache.seekStartFrame, 10 * rate);
		const mutes = {
			segapsg: [true, false, false, true],
			ym2413: [
				true,
				false,
				true,
				false,
				false,
				false,
				false,
				true,
				false,
			],
		};
		e.setChannelMutes(mutes);
		assert.equal(e.snapshot().seekCache.entries, 0);
		seek(e, 10.4);
		await compareFm(e, rate, 10.4, { clock, mix, mutes });
		seek(e, 10.5);
		assert.equal(e.snapshot().seekCache.seekStartFrame, 10 * rate);
		await compareFm(e, rate, 10.5, { clock, mix, mutes });
	});
}

test("Mixer changes exactly on a checkpoint boundary do not cache a stale held FM sample", async (t) => {
	const rate = 96000,
		clock = 3000000,
		e = await makeFm(rate, true, clock);
	t.after(() => e.dispose());
	seek(e, 5);
	const mix = {
		segapsg: { volume: 0.2, enabled: true },
		ym2413: { volume: 0.4, enabled: true },
	};
	e.setMix(mix);
	e.play();
	e.process(left, right);
	e.pause();
	assert.equal(
		e.snapshot().seekCache.entries,
		0,
		"skip the boundary until a native FM frame reflects the new gain",
	);
	seek(e, 5);
	assert.equal(e.snapshot().seekCache.seekStartFrame, 0);
	await compareFm(e, rate, 5, { clock, mix });
});

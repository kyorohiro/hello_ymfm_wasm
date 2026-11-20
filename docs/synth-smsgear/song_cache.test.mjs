// SPDX-License-Identifier: BSD-3-Clause
import test from "node:test";
import assert from "node:assert/strict";
import { createSmsGearSongEngine } from "./song_engine.js";
import { readSmsGearVgm } from "./vgm_import.js";
import { createDemoVgm } from "./fixtures.js";
import opllFactory from "../generated/ym2413_wasm.js";
import psgFactory from "../generated/segapsg_wasm.js";
const make = async (sampleRate, { fm = false, seekCache = true } = {}) => {
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
		opllFactory,
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
test("FM-inclusive songs explicitly use uncached history reconstruction", async (t) => {
	const e = await make(44100, { fm: true });
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

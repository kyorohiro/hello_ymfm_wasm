// SPDX-License-Identifier: BSD-3-Clause
// Real app AudioWorklet + WASM with a Node-only audio host. No physical output.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createYm2413Client } from "../js/playground_ym2413.js";

const wasmBinary = await readFile(
	new URL("../generated/ym2413_wasm.wasm", import.meta.url),
);
let Processor, constructingPort;
class TestAudioWorkletProcessor {
	constructor() {
		this.port = constructingPort;
	}
}
async function setup(t, rate = 48000) {
	let frame = 0,
		readyResolve;
	const names = [
		"AudioWorkletProcessor",
		"registerProcessor",
		"sampleRate",
		"currentFrame",
	];
	const previous = new Map(
		names.map((name) => [
			name,
			Object.getOwnPropertyDescriptor(globalThis, name),
		]),
	);
	const messages = [];
	const ready = new Promise((resolve) => {
		readyResolve = resolve;
	});
	constructingPort = {
		postMessage(message) {
			messages.push(message);
			if (message.ready || message.error) readyResolve(message);
		},
	};
	Object.defineProperties(globalThis, {
		AudioWorkletProcessor: {
			configurable: true,
			value: TestAudioWorkletProcessor,
		},
		registerProcessor: {
			configurable: true,
			value: (name, Type) => {
				assert.equal(name, "tetorica-ym2413");
				Processor = Type;
			},
		},
		sampleRate: { configurable: true, value: rate },
		currentFrame: { configurable: true, get: () => frame },
	});
	let processor, api;
	t.after(() => {
		try {
			api?.dispose();
			if (processor && !processor.dead) processor.dispose();
		} finally {
			for (const [name, descriptor] of previous)
				if (descriptor)
					Object.defineProperty(globalThis, name, descriptor);
				else delete globalThis[name];
		}
	});
	await import("./opll_worklet.js");
	processor = new Processor({
		processorOptions: { wasmBinary, clock: 3579545 },
	});
	assert.equal((await ready).ready, true, JSON.stringify(messages));
	const port = {
		start() {},
		close() {},
		postMessage(data) {
			processor.receive(data, {
				postMessage: (reply) => port.onmessage?.({ data: reply }),
			});
		},
	};
	api = createYm2413Client(port);
	api.initialize();
	return {
		api,
		processor,
		messages,
		rate,
		frame: () => frame,
		adopt() {
			api.adoptRegisterSnapshot(processor.registers);
		},
		render(count) {
			const left = new Float32Array(count),
				right = new Float32Array(count);
			for (let offset = 0; offset < count; ) {
				const size = Math.min(128, count - offset);
				processor.process(
					[],
					[
						[
							left.subarray(offset, offset + size),
							right.subarray(offset, offset + size),
						],
					],
				);
				frame += size;
				offset += size;
			}
			assert(left.every(Number.isFinite));
			assert(right.every(Number.isFinite));
			return { left, right };
		},
	};
}
const peak = (pcm) =>
	Math.max(...pcm.left.map(Math.abs), ...pcm.right.map(Math.abs));

test("actual OPLL Worklet: releasing held reservations keeps newer manual notes and future timed gates", async (t) => {
	const f = await setup(t), { api, processor: p } = f;
	for (const channel of [0, 1, 2])
		api.setVoice(channel, { instrument: 1, attenuation: 3 });
	const pattern = api.build((b) => {
		b.noteOn(0, "C4").noteOn(1, "E4");
		b.atSeconds(0.04).noteOn(2, "G4");
	});
	const receipt = await api.schedule(pattern, { name: "held-and-later" });
	f.render(receipt.startFrame + 512);
	assert(p.registers[0x20] & 16);
	assert(p.registers[0x21] & 16);
	f.adopt();
	api.noteOn(1, "F4");
	p.receive({ method: "releaseTimedNotes" });
	assert.equal(p.registers[0x20] & 16, 0);
	assert(p.registers[0x21] & 16, "manual replacement gate stays on");
	assert.equal(p.performance.getStats().patternCount, 1);
	f.render(2000);
	assert(p.registers[0x22] & 16, "future scheduled gate still executes");
});

test("actual OPLL Worklet: retiring old CH8 melody after Rhythm enable cannot mute the new Hi-hat physical channel", async (t) => {
	const f = await setup(t),
		{ api, processor: p } = f;
	api.setVoice(7, { instrument: 1, attenuation: 3 });
	const receipt = await api._timedOperations.schedule(
		api.build((b) => b.noteOn(7, "C4")),
		{ name: "old-melody" },
		{ owner: "old-melody-owner" },
	);
	f.render(receipt.startFrame + 1024);
	assert.equal(
		p.performance.getStats().patternCount,
		0,
		"one-shot completed but retains its held-note owner",
	);
	f.adopt();
	api.setNote(8, "G4");
	api.setRhythmLevel("hiHat", 3);
	api.setRhythm({ enabled: true, hiHat: true });
	assert.equal(p.registers[14], 0x21);
	assert(!p.mutedChannels.has(7));
	assert(!p.mutedDrums.has(4));
	assert(
		peak(f.render(512)) > 0,
		"new hardware Hi-hat produces PCM before old-owner cleanup",
	);
	await api._timedOperations.releaseOwner("old-melody-owner");
	assert.equal(p.registers[14], 0x21, "Hi-hat trigger is unchanged");
	assert(
		!p.mutedChannels.has(7),
		"stale melodic release must not mute the shared CH8 output",
	);
	assert(!p.mutedDrums.has(4));
	assert(
		peak(f.render(512)) > 0,
		"new Hi-hat still produces PCM after cleanup",
	);
});

test("actual OPLL Worklet: retiring old Hi-hat after Rhythm disable cannot mute a new CH8 melody", async (t) => {
	const f = await setup(t),
		{ api, processor: p } = f;
	api.setNote(7, "C4");
	api.setNote(8, "G4");
	api.setRhythmLevel("hiHat", 3);
	api.setRhythm({ enabled: true });
	const receipt = await api._timedOperations.schedule(
		api.build((b) => b.setRhythm({ hiHat: true })),
		{ name: "old-hat" },
		{ owner: "old-hat-owner" },
	);
	f.render(receipt.startFrame + 512);
	f.adopt();
	api.setRhythm({ enabled: false });
	api.setVoice(7, { instrument: 0, attenuation: 3 });
	api.noteOn(7, "E4");
	assert(!(p.registers[14] & 32));
	assert(p.registers[0x27] & 16);
	assert(!p.mutedChannels.has(7));
	assert(peak(f.render(1024)) > 0, "new melody produces PCM before cleanup");
	await api._timedOperations.releaseOwner("old-hat-owner");
	assert.equal(p.registers[0x27] & 16, 16, "new melodic Gate remains on");
	assert(
		!p.mutedChannels.has(7),
		"stale Rhythm cleanup must not mute a melodic channel",
	);
	assert(
		peak(f.render(1024)) > 0,
		"new melody still produces PCM after cleanup",
	);
});

test("actual OPLL Worklet: atomic parameter edit keeps a held Gate, neighboring channel and reservation state", async (t) => {
	const f = await setup(t),
		{ api, processor: p } = f;
	api.setVoice(0, { instrument: 0, attenuation: 3 });
	api.setVoice(1, { instrument: 2, attenuation: 7 });
	const receipt = await api._timedOperations.schedule(
		api.build((b) => b.noteOn(0, "C4")),
		{ name: "held" },
		{ owner: "held-owner" },
	);
	f.render(receipt.startFrame + 512);
	const oldGate = p.registers[0x20],
		neighbor = p.registers[0x31],
		beforeFrame = f.frame(),
		patterns = p.performance.getStats().patternCount;
	assert.equal(
		api.getRegisterSnapshot()[0x20] & 16,
		0,
		"Main authoring shadow is deliberately stale and still has Gate Off",
	);
	assert.equal(
		p.registers[0x20] & 16,
		16,
		"the renderer has already applied the scheduled Gate On",
	);
	const oldDr = p.registers[4] & 15;
	const edit = api.build((b) => {
		b.setVoice(0, { attenuation: 6, sustain: true });
		b.setUserOperator(0, { tl: 12, ar: 8 });
	});
	await api._requestControl("opllTimed", [
		{ action: "edit", operations: edit },
	]);
	assert.equal(
		f.frame(),
		beforeFrame,
		"parameter edit does not render or advance time",
	);
	assert.equal(
		p.registers[0x20],
		oldGate | 32,
		"same Gate and pitch remain applied while Sustain changes",
	);
	assert.equal(
		p.registers[0x31],
		neighbor,
		"other channel voice bits stay untouched",
	);
	assert.equal(p.registers[0x30] & 15, 6);
	assert.equal(p.registers[2] & 63, 12);
	assert.equal(
		p.registers[4],
		0x80 | oldDr,
		"shared Operator AR preserves adjacent DR bits",
	);
	assert.equal(
		p.performance.getStats().patternCount,
		patterns,
		"edit creates no reservation",
	);
	assert(
		peak(f.render(512)) > 0,
		"held voice remains audible after parameter editing",
	);
	const beforeInvalid = Array.from(p.registers),
		invalidFrame = f.frame();
	await assert.rejects(
		api._requestControl("opllTimed", [
			{
				action: "edit",
				operations: api.build((b) => {
					b.setVoice(0, { attenuation: 5 });
					b.keyOn(0);
				}),
			},
		]),
		/cannot trigger or release/,
	);
	assert.deepEqual(
		Array.from(p.registers),
		beforeInvalid,
		"invalid edit rejects the complete parameter batch",
	);
	assert.equal(f.frame(), invalidFrame);
	assert.equal(p.performance.getStats().patternCount, patterns);
	await api._timedOperations.releaseOwner("held-owner");
	assert.equal(
		p.registers[0x20] & 16,
		0,
		"edit retained the original note owner for normal cleanup",
	);
	assert(p.mutedChannels.has(0));
});

test("actual OPLL Worklet: parameter-only edit starts no performance session or reservation and cannot trigger drums", async (t) => {
	const f = await setup(t),
		{ api, processor: p } = f;
	assert.equal(p.performance.getStats().activeSession, 0);
	await api._requestControl("opllTimed", [
		{
			action: "edit",
			operations: api.build((b) => b.setVoice(0, { attenuation: 8 })),
		},
	]);
	assert.equal(p.registers[0x30] & 15, 8);
	assert.equal(
		p.performance.getStats().activeSession,
		0,
		"UI edit does not start a Code performance session",
	);
	assert.equal(p.performance.getStats().patternCount, 0);
	assert.equal(
		peak(f.render(128)),
		0,
		"parameter editing never invents a key-on",
	);
	const before = Array.from(p.registers);
	await assert.rejects(
		api._requestControl("opllTimed", [
			{
				action: "edit",
				operations: api.build((b) => b.setRhythm({ snare: true })),
			},
		]),
		/cannot trigger or release/,
	);
	assert.deepEqual(Array.from(p.registers), before);
	assert.equal(p.performance.getStats().activeSession, 0);
});

test("actual OPLL Worklet: same-On immediate Hi-hat intent replaces old generic ownership before releaseOwner", async (t) => {
	const f = await setup(t),
		{ api, processor: p } = f;
	api.setNote(7, "C4");
	api.setNote(8, "G4");
	api.setRhythmLevel("hiHat", 3);
	api.setRhythm({ enabled: true });
	const receipt = await api._timedOperations.schedule(
		api.build((b) => b.setRhythm({ hiHat: true })),
		{ name: "old-hat" },
		{ owner: "old-same-hat" },
	);
	f.render(receipt.startFrame + 512);
	assert.equal(p.registers[14], 0x21);
	assert(peak(f.render(256)) > 0);
	f.adopt();
	api.setRhythm({ hiHat: true });
	assert.equal(
		p.registers[14],
		0x21,
		"taking manual ownership makes no hardware byte change",
	);
	await api._timedOperations.releaseOwner("old-same-hat");
	assert.equal(
		p.registers[14],
		0x21,
		"old generic owner cleanup must not clear a newly claimed same-On bit",
	);
	assert(!p.mutedDrums.has(4));
	assert(!p.mutedChannels.has(7));
	assert(
		peak(f.render(512)) > 0,
		"same-On manual Hi-hat remains audible after old-owner cleanup",
	);
});

test("actual OPLL Worklet: same-On Hi-hat reservation transfers generic ownership to its new owner", async (t) => {
	const f = await setup(t),
		{ api, processor: p } = f;
	api.setNote(7, "C4");
	api.setNote(8, "G4");
	api.setRhythmLevel("hiHat", 3);
	api.setRhythm({ enabled: true });
	const plan = api.build((b) => b.setRhythm({ hiHat: true }));
	const old = await api._timedOperations.schedule(
		plan,
		{ name: "old-hat" },
		{ owner: "old-same-hat" },
	);
	f.render(old.startFrame + 512);
	const next = await api._timedOperations.schedule(
		plan,
		{ name: "new-hat" },
		{ owner: "new-same-hat" },
	);
	f.render(next.startFrame + 512 - f.frame());
	assert.equal(p.registers[14], 0x21);
	await api._timedOperations.releaseOwner("old-same-hat");
	assert.equal(
		p.registers[14],
		0x21,
		"retiring the old reservation cannot clear the new same-On trigger",
	);
	assert(!p.mutedDrums.has(4));
	assert(!p.mutedChannels.has(7));
	assert(
		peak(f.render(512)) > 0,
		"new-owner Hi-hat still produces actual PCM",
	);
	await api._timedOperations.releaseOwner("new-same-hat");
	assert.equal(
		p.registers[14],
		0x20,
		"retiring the new owner releases its own trigger",
	);
	assert(p.mutedDrums.has(4));
	assert(p.mutedChannels.has(7));
	assert.equal(
		peak(f.render(512)),
		0,
		"no stale owner retains the drum after its current owner releases it",
	);
});

test("actual OPLL Worklet: same-On raw R14 reservation transfers generic ownership to its new owner", async (t) => {
	const f = await setup(t),
		{ api, processor: p } = f;
	api.setNote(7, "C4");
	api.setNote(8, "G4");
	api.setRhythmLevel("hiHat", 3);
	api.setRhythm({ enabled: true });
	const plan = api.build((b) => b.setRhythm({ hiHat: true }));
	const old = await api._timedOperations.schedule(
		plan,
		{ name: "old-hat" },
		{ owner: "old-same-hat" },
	);
	f.render(old.startFrame + 512);
	const raw = api.build((b) => b.writeRegister(14, 0x21));
	assert.equal(
		(await api.compile(raw, { initialState: "reset" }))[0].intentMask,
		undefined,
		"compiler rows remain raw register writes without ownership metadata",
	);
	const next = await api._timedOperations.schedule(
		raw,
		{ name: "new-hat" },
		{ owner: "new-same-hat" },
	);
	f.render(next.startFrame + 512 - f.frame());
	assert.equal(p.registers[14], 0x21);
	await api._timedOperations.releaseOwner("old-same-hat");
	assert.equal(
		p.registers[14],
		0x21,
		"retiring the old reservation cannot clear the new same-On trigger",
	);
	assert(!p.mutedDrums.has(4));
	assert(!p.mutedChannels.has(7));
	assert(
		peak(f.render(512)) > 0,
		"new-owner Hi-hat still produces actual PCM",
	);
	await api._timedOperations.releaseOwner("new-same-hat");
	assert.equal(
		p.registers[14],
		0x20,
		"retiring the new owner releases its own trigger",
	);
	assert(p.mutedDrums.has(4));
	assert(p.mutedChannels.has(7));
	assert.equal(
		peak(f.render(512)),
		0,
		"no stale owner retains the drum after its current owner releases it",
	);
});

test("actual OPLL Worklet: immediate Rhythm Off releases its trigger without a reservation or adjacent-drum release", async (t) => {
	const f = await setup(t),
		{ api, processor: p } = f;
	api.setNote(6, "C3");
	api.setNote(7, "C4");
	api.setNote(8, "G4");
	api.setRhythmLevels({ bassDrum: 3, hiHat: 3 });
	api.setRhythm({ enabled: true, bassDrum: true, hiHat: true });
	assert.equal(
		p.registers[14],
		0x31,
		"manual Bass drum and Hi-hat are triggered",
	);
	assert(peak(f.render(1024)) > 0);
	api.setRhythm({ bassDrum: false });
	assert.equal(
		p.registers[14],
		0x21,
		"manual Bass drum Off clears its bit and keeps the adjacent Hi-hat",
	);
	assert(!p.mutedDrums.has(4));
	assert(!p.mutedChannels.has(7));
	api.setRhythm({ hiHat: false });
	assert.equal(
		p.registers[14],
		0x20,
		"manual Hi-hat can also release after its On",
	);
	assert.equal(
		p.performance.getStats().patternCount,
		0,
		"manual drum controls create no timed reservation",
	);
	assert.equal(
		p.performance.getStats().activeSession,
		0,
		"manual controls need no Code session",
	);

	// Isolate Bass drum to check the actual chip output after its natural release.
	api.setRhythm({ bassDrum: true });
	assert(peak(f.render(1024)) > 0, "isolated manual Bass drum produces PCM");
	api.setRhythm({ bassDrum: false });
	assert.equal(p.registers[14], 0x20);
	f.render(f.rate * 2);
	assert.equal(
		peak(f.render(1024)),
		0,
		"isolated Bass drum eventually becomes silent after manual Off",
	);
});

// SPDX-License-Identifier: BSD-3-Clause
// Deterministic renderer scheduling and client state: no AudioContext / device.
import test from "node:test";
import assert from "node:assert/strict";
import { createProcessorPerformance } from "../js/playground_performance_processor.js";
import { createPlaygroundCodeRuntime } from "../js/playground_code_runtime.js";
import {
	createOpllTimedProcessor,
	opllTimedCommandCost,
} from "./opll_timed_processor.js";
import { attachOpllTimedClient } from "./opll_timed_client.js";
import { YM2413Synth } from "../js/ym2413synth.js";
import {
	SMSGEAR_FM_TIMED_EXAMPLE,
	SMSGEAR_FM_EXAMPLE,
} from "./code_examples.js";

function setup(rate = 48000) {
	let frame = 0,
		eventFrame,
		timed;
	const registers = Array(64).fill(0),
		clock = 3579545,
		writes = [],
		requests = [],
		replies = [];
	const port = {
		postMessage(message) {
			replies.push(message);
		},
		start() {},
		close() {},
	};
	const apply = (command, reply, at = frame, metadata) => {
		if (command.method === "applyOpllTimedOperation") {
			eventFrame = at;
			try {
				return timed.apply(command, reply, at, metadata);
			} finally {
				eventFrame = undefined;
			}
		}
		if (command.keyIntent !== undefined)
			metadata = { ...metadata, keyIntent: command.keyIntent };
		if (command.method === "writeRegister") {
			const [register, value] = command.args,
				old = registers[register];
			registers[register] = value;
			timed.observeWrite(
				register,
				value,
				old,
				command.intentMask,
				metadata,
				reply,
			);
			writes.push({
				frame: eventFrame ?? at,
				register,
				value,
				owner: metadata?.owner,
			});
		} else if (command.method === "forceKeyOff") {
			apply(
				{
					method: "writeRegister",
					args: [
						0x20 + command.args[0],
						registers[0x20 + command.args[0]] & ~16,
					],
					intentMask: 16,
				},
				reply,
				at,
				metadata,
			);
		} else if (command.method === "forceRhythmOff") {
			apply(
				{
					method: "writeRegister",
					args: [14, registers[14] & ~(16 >> command.args[0])],
					intentMask: 16 >> command.args[0],
				},
				reply,
				at,
				metadata,
			);
		} else
			throw Error("Unexpected OPLL harness operation: " + command.method);
	};
	const performance = createProcessorPerformance({
		chip: "ym2413",
		rate,
		nowFrame: () => frame,
		apply,
		getOpllRhythm: () => registers[14],
		patternCommandCost: opllTimedCommandCost,
		onDiscard: (command, metadata) => timed?.discard(command, metadata),
	});
	const read = () => ({ clock, registers: [...registers] });
	timed = createOpllTimedProcessor({
		performance,
		getState: read,
		getConfig: () => ({ clock, instanceId: "test-opll" }),
		dispatch: (command, reply, _at, metadata) =>
			performance.applyImmediate(command, reply, metadata),
		nowFrame: () => frame,
		sampleRate: rate,
	});
	const request = (method, args) => {
		assert.equal(method, "opllTimed");
		requests.push(structuredClone(args[0]));
		const id = replies.length + 1;
		timed.receive({ id, method, args }, port);
		const reply = replies.at(-1);
		return reply.error
			? Promise.reject(
					Object.assign(Error(reply.error), {
						name: reply.name ?? "Error",
					}),
				)
			: Promise.resolve(reply.value);
	};
	const api = attachOpllTimedClient(
		{
			clock,
			_getState: read,
			_timedClientStateComplete: true,
			_requestControl: request,
			dispose() {},
		},
		{},
		port,
	);
	return {
		api,
		timed,
		performance,
		registers,
		writes,
		requests,
		read,
		rate,
		frame: () => frame,
		manual(register, value, intentMask) {
			performance.applyImmediate(
				{
					method: "writeRegister",
					args: [register, value],
					...(intentMask === undefined ? {} : { intentMask }),
				},
				port,
			);
		},
		render(count, partition = 113) {
			for (let offset = 0; offset < count; ) {
				const size = Math.min(partition, count - offset);
				performance.render(
					new Float32Array(size),
					new Float32Array(size),
					(left, right) => {
						left.fill(0);
						right.fill(0);
					},
				);
				frame += size;
				offset += size;
			}
		},
		stop() {
			timed.clear();
			performance.clear();
		},
	};
}

for (const rate of [44100, 48000]) {
	test(`OPLL ${rate} Hz: compile and sample-clock writes preserve mixed units, same-time order and repeated bytes`, async () => {
		const f = setup(rate);
		const plan = f.api.build((b) => {
			b.setVoice(0, { instrument: 0, attenuation: 4 }).noteOn(0, "C4");
			b.atSample(441).setUserOperator(0, { ar: 7, dr: 3 });
			b.writeRegister(3, 7).writeRegister(3, 7);
			b.atSeconds(0.02).noteOff(0);
		});
		const trace = await f.api.compile(plan),
			receipt = await f.api.schedule(plan, { name: "exact" });
		f.render(receipt.startFrame + Math.round(rate * 0.02) + 1);
		const raw = (rows) =>
			rows.map(({ register, value }) => ({ register, value }));
		assert.deepEqual(raw(f.writes), raw(trace));
		const repeated = f.writes.filter((w) => w.register === 3);
		assert.equal(repeated.length, 2);
		assert(
			repeated.every(
				(w) => w.frame === receipt.startFrame + Math.round(rate * 0.01),
			),
		);
		assert.equal(f.registers[0x20] & 16, 0);
		f.api.dispose();
	});
	test(`OPLL ${rate} Hz: bounded repeats and invalid replacement preserve the original reservation`, async () => {
		const f = setup(rate),
			plan = f.api.build((b) => b.setUserOperator(0, { ar: 7 }));
		const receipt = await f.api.schedule(plan, {
			name: "motion",
			repeatSeconds: 1 / 110,
		});
		await assert.rejects(
			f.api.schedule(
				f.api.build((b) => b.setVoice(0, { attenuation: 16 })),
				{ name: "motion" },
			),
			/attenuation|Attenuation/,
		);
		assert.equal(f.performance.getStats().patternCount, 1);
		f.render(receipt.startFrame + Math.round(rate * 0.05));
		assert(f.writes.length >= 5);
		f.writes.forEach((w, i) =>
			assert.equal(
				w.frame,
				receipt.startFrame + Math.round((i * rate) / 110),
			),
		);
		await f.api.clearSchedule("motion");
		const count = f.writes.length;
		f.render(1000);
		assert.equal(f.writes.length, count);
		f.api.dispose();
	});
}

test("OPLL current/client/reset/snapshot compile paths are detached and detect incompatible snapshot identity", async () => {
	const f = setup();
	f.manual(4, 0x2b);
	f.manual(0x30, 0x94);
	const plan = f.api.build((b) => {
		b.setUserOperator(0, { ar: 7 });
		b.setVoice(0, { attenuation: 3 });
	});
	const snapshot = await f.api.captureState(),
		before = f.read(),
		count = f.writes.length,
		at = f.frame();
	const current = await f.api.compile(plan),
		requests = f.requests.length;
	assert.deepEqual(
		await f.api.compile(plan, { initialState: snapshot }),
		current,
	);
	assert.deepEqual(
		await f.api.compile(plan, { initialState: "client" }),
		current,
	);
	assert.equal(
		f.requests.length,
		requests,
		"snapshot and client paths have no RPC",
	);
	const reset = await f.api.compile(plan, { initialState: "reset" });
	assert.notDeepEqual(reset, current);
	assert.equal(f.requests.length, requests, "reset path has no RPC");
	assert.equal(current.find((w) => w.register === 4).value, 0x7b);
	assert.equal(current.find((w) => w.register === 0x30).value, 0x93);
	assert.deepEqual(f.read(), before);
	assert.equal(f.frame(), at);
	assert.equal(f.writes.length, count);
	f.manual(4, 0x11);
	assert.equal(snapshot.state.registers[4], 0x2b);
	await assert.rejects(
		f.api.compile(plan, {
			initialState: { ...snapshot, instanceId: "other" },
		}),
		/instance/,
	);
	await assert.rejects(
		f.api.compile(plan, {
			initialState: {
				...snapshot,
				state: { ...snapshot.state, clock: 4000000 },
			},
		}),
		/clock/,
	);
	f.api.dispose();
});

test("OPLL partial User operator and voice updates resolve against the actual renderer state at execution", async () => {
	const f = setup(),
		plan = f.api.build((b) => {
			b.atSeconds(0.01).setUserOperator(0, { ar: 7 });
			b.setVoice(0, { attenuation: 3 });
			b.setRhythm({ enabled: true, hiHat: true });
		});
	const receipt = await f.api.schedule(plan, { name: "partial" });
	f.manual(4, 0x2b);
	f.manual(0x30, 0x94);
	f.manual(14, 8);
	f.render(receipt.startFrame + Math.round(f.rate * 0.01) + 1);
	assert.equal(f.registers[4], 0x7b, "AR update preserves current DR");
	assert.equal(
		f.registers[0x30],
		0x93,
		"level update preserves current instrument",
	);
	assert.equal(
		f.registers[14],
		0x29,
		"partial Rhythm mode/hat update preserves snare",
	);
	f.api.dispose();
});

test("OPLL Rhythm reservations own individual triggers and clear never releases an adjacent drum", async () => {
	const f = setup();
	f.manual(14, 32);
	const hat = await f.api.schedule(
		f.api.build((b) => b.setRhythm({ hiHat: true })),
		{ name: "hat" },
	);
	f.render(hat.startFrame + 1);
	const snare = await f.api.schedule(
		f.api.build((b) => b.setRhythm({ snare: true })),
		{ name: "snare" },
	);
	f.render(snare.startFrame + 1 - f.frame());
	assert.equal(f.registers[14], 0x29);
	await f.api.clearSchedule("snare");
	assert.equal(f.registers[14], 0x21, "hat bit remains set");
	await f.api.clearSchedule("hat");
	assert.equal(f.registers[14], 0x20);
	f.api.dispose();
});

test("OPLL stale melodic KeyOff cannot retire a newer drum or manual melodic gate after mode changes", async () => {
	const f = setup();
	const old = await f.api.schedule(
		f.api.build((b) => {
			b.noteOn(6, "C4");
			b.atSeconds(0.02).keyOff(6);
		}),
		{ name: "old" },
	);
	f.render(old.startFrame + 1);
	f.manual(14, 0x30); // physical CH7 now has Bass drum rather than a melodic gate.
	f.render(Math.round(f.rate * 0.03));
	await f.api.clearSchedule("old");
	assert.equal(
		f.registers[14],
		0x30,
		"old melodic note cannot release Bass drum",
	);
	const drum = await f.api.schedule(
		f.api.build((b) => b.setRhythm({ snare: true })),
		{ name: "drum" },
	);
	f.render(drum.startFrame + 1 - f.frame());
	f.manual(14, 0);
	f.manual(0x27, 16); // back to CH8 melody, owned by the keyboard.
	await f.api.clearSchedule("drum");
	assert.equal(f.registers[0x27] & 16, 16);
	f.api.dispose();
});

test("OPLL shared Code Runtime Run / failed Apply / successful Apply / Stop preserve entry transactions", async () => {
	const f = setup(),
		logs = [];
	const runtime = createPlaygroundCodeRuntime({
		supportedSoundChips: ["ym2413"],
		ensureReady: async () => {},
		now: () => f.frame() / f.rate,
		useSoundChip: () => f.api,
		guardExecution: false,
		onLog: (line) => logs.push(line),
	});
	const source = (level) =>
		`const opll=await useSoundChip('ym2413');await opll.schedule(opll.build(b=>b.setVoice(CH1,{instrument:1,attenuation:${level}}).noteOn(CH1,'C4')),{name:'entry',repeatSeconds:.01});`;
	try {
		await runtime.run(source(4));
		f.render(900);
		assert.equal(f.registers[0x30] & 15, 4);
		await assert.rejects(
			runtime.apply(source(8) + `throw Error('failed Apply');`),
			/failed Apply/,
		);
		f.render(900);
		assert.equal(f.registers[0x30] & 15, 4);
		await runtime.apply(source(6));
		f.render(900);
		assert.equal(f.registers[0x30] & 15, 6);
		await runtime.stop();
		assert.equal(f.performance.getStats().patternCount, 0);
		assert.equal(f.registers[0x20] & 16, 0);
		const count = f.writes.length;
		f.render(2000);
		assert.equal(f.writes.length, count);
		assert(!logs.some((line) => line.startsWith("[cleanup]")));
	} finally {
		await runtime.stop();
		f.api.dispose();
	}
});

test("OPLL stopLoop releases only its Rhythm triggers and keeps a manual adjacent drum plus the entry melody", async () => {
	const f = setup();
	f.manual(14, 0x21); // independent manual Hi-hat
	const runtime = createPlaygroundCodeRuntime({
		supportedSoundChips: ["ym2413"],
		ensureReady: async () => {},
		now: () => f.frame() / f.rate,
		useSoundChip: () => f.api,
		guardExecution: false,
	});
	const entry = `const opll=await useSoundChip('ym2413');
    await opll.schedule(opll.build(b=>b.setVoice(CH1,{instrument:1,attenuation:5}).noteOn(CH1,'C4')),{name:'entry',repeatSeconds:.01});`;
	const until = async (predicate) => {
		for (let i = 0; i < 100; i++) {
			if (predicate()) return;
			await new Promise((resolve) => setTimeout(resolve, 1));
		}
		assert.fail("loop operation timed out");
	};
	try {
		await runtime.run(
			entry +
				`
      liveLoop('snare',async()=>{
        await opll.schedule(opll.build(b=>b.setRhythm({snare:true})),{name:'snare',repeatSeconds:.01});
        await beat(100);
      });`,
		);
		await until(() => f.performance.getStats().patternCount === 2);
		f.render(900);
		assert.equal(f.registers[14], 0x29);
		await runtime.apply(entry + `stopLoop('snare');`);
		await until(() => f.performance.getStats().patternCount === 1);
		assert.equal(
			f.registers[14],
			0x21,
			"only the loop-owned Snare bit is released",
		);
		const count = f.writes.length;
		f.render(2000);
		assert(f.writes.length > count, "entry melody remains scheduled");
		assert(
			f.writes.slice(count).every((w) => w.register !== 14),
			"retired loop cannot retrigger Rhythm",
		);
		assert.equal(f.registers[14], 0x21);
		await runtime.stop();
		assert.equal(f.registers[14], 0x21, "manual Hi-hat survives Code Stop");
	} finally {
		await runtime.stop();
		f.api.dispose();
	}
});

test("actual seeded OPLL examples execute: timed timbre and beat melody stay independent, and Stop cancels both", async () => {
	const f = setup(),
		logs = [];
	// The production client already exposes these immediate calls. Delegate
	// through the actual Synth rather than rewriting patch/register conversion.
	const immediate = new YM2413Synth({
		clock: 3579545,
		transport: { writeRegister: (r, v) => f.manual(r, v) },
	});
	for (const method of [
		"setRhythm",
		"setUserPatch",
		"setVoice",
		"noteOn",
		"noteOff",
	])
		f.api[method] = (...args) => {
			immediate.adoptRegisterSnapshot(f.registers);
			return immediate[method](...args);
		};
	const runtime = createPlaygroundCodeRuntime({
		supportedSoundChips: ["ym2413"],
		ensureReady: async () => {},
		now: () => f.frame() / f.rate,
		useSoundChip: () => f.api,
		guardExecution: false,
		onLog: (line) => logs.push(line),
	});
	const until = async (predicate) => {
		for (let i = 0; i < 100; i++) {
			if (predicate()) return;
			await new Promise((resolve) => setTimeout(resolve, 1));
		}
		assert.fail("seeded example action timed out");
	};
	try {
		await runtime.run(SMSGEAR_FM_TIMED_EXAMPLE);
		await until(() => f.performance.getStats().patternCount === 2);
		f.render(200);
		assert.equal(
			f.registers[0x30],
			4,
			"the seeded setup selected User and channel attenuation4",
		);
		assert.equal(
			f.registers[0x20] & 16,
			16,
			"the independent melody loop starts a note",
		);
		assert.equal(
			f.registers[2] & 63,
			24,
			"first timed TL point uses the seeded timbre plan",
		);
		f.render(6001);
		assert.equal(
			f.registers[2] & 63,
			23,
			"the next TL point moves while the same melody gate stays held",
		);
		assert.equal(f.registers[0x20] & 16, 16);
		f.render(9000 - f.frame());
		assert.equal(
			f.registers[0x20] & 16,
			0,
			"the note pattern releases independently at0.18 seconds",
		);
		f.render(12130 - f.frame());
		assert.equal(
			f.registers[2] & 63,
			21,
			"the timbre cycle keeps moving after note release",
		);
		assert.equal(f.registers[0x20] & 16, 0);
		assert(
			logs.some((line) => line.includes("register")),
			"console.table displays the compiled register trace",
		);
		await runtime.stop();
		assert.equal(f.performance.getStats().patternCount, 0);
		const count = f.writes.length;
		f.render(f.rate * 2);
		assert.equal(
			f.writes.length,
			count,
			"neither named cycle survives Stop",
		);
		assert(!logs.some((line) => line.startsWith("[cleanup]")));

		// Use the real immediate example as a new entry too, covering its former
		// const-fm collision with the runtime's compatibility global.
		await runtime.run(SMSGEAR_FM_EXAMPLE);
		await until(() => Boolean(f.registers[0x20] & 16));
		assert(runtime.getState().loopNames.includes("melody"));
		await runtime.stop();
		assert.equal(f.registers[0x20] & 16, 0);
	} finally {
		await runtime.stop();
		f.api.dispose();
	}
});

// Exercise immediate authoring intent annotations using the real public Synth.
// The bridge preserves a parameter edit's current owner while allowing an
// explicit Gate call to acquire it, as the production renderer distinguishes.
function immediateAnnotatedClient(f) {
	const messages = [];
	const port = {
		start() {},
		close() {},
		postMessage(data) {
			messages.push(data);
			f.performance.applyImmediate(
				data,
				{ postMessage() {} },
				data.keyIntent === false
					? { preserveOwner: true, keyIntent: false }
					: undefined,
			);
		},
	};
	const api = new YM2413Synth({
		clock: 3579545,
		transport: {
			writeRegister: (register, value) => f.manual(register, value),
		},
	});
	api.dispose = () => {};
	attachOpllTimedClient(api, {}, port);
	return {
		api,
		messages,
		adopt() {
			api.adoptRegisterSnapshot(f.registers);
		},
	};
}

test("annotated immediate same-On noteOn takes ownership while partial voice/pitch edits retain scheduled ownership", async () => {
	const f = setup(),
		manual = immediateAnnotatedClient(f);
	try {
		const plan = f.api.build((b) => {
			b.noteOn(0, "C4");
			b.atSeconds(0.02).noteOff(0);
		});
		const old = await f.api.schedule(plan, { name: "old" });
		f.render(old.startFrame + 1);
		manual.adopt();
		manual.api.noteOn(0, "E4");
		assert(
			manual.messages
				.filter((m) => m.args[0] === 0x20)
				.every((m) => m.keyIntent === true),
			"nested setPitch writes inherit the outer noteOn intent",
		);
		f.render(1200);
		await f.api.clearSchedule("old");
		assert.equal(
			f.registers[0x20] & 16,
			16,
			"same-On explicit manual note survives old Off and clear",
		);

		const next = await f.api.schedule(plan, { name: "parameter" });
		f.render(next.startFrame + 1 - f.frame());
		manual.adopt();
		manual.api.setVoice(0, { attenuation: 6, sustain: true });
		manual.adopt();
		manual.api.setFrequency(0, 440);
		assert.equal(
			manual.messages.at(-1).keyIntent,
			false,
			"frequency high bits are parameter edits",
		);
		f.render(1200);
		assert.equal(
			f.registers[0x20] & 16,
			0,
			"parameter edits did not steal the scheduled note: its KeyOff applies",
		);
		assert.equal(
			f.registers[0x20] & 32,
			32,
			"scheduled KeyOff preserves manual sustain",
		);
	} finally {
		manual.api.dispose();
		f.api.dispose();
	}
});

test("annotated immediate same-On Rhythm trigger retires only the explicitly touched drum owner", async () => {
	const f = setup(),
		manual = immediateAnnotatedClient(f);
	f.manual(14, 32);
	try {
		const hat = await f.api.schedule(
			f.api.build((b) => b.setRhythm({ hiHat: true })),
			{ name: "hat" },
		);
		f.render(hat.startFrame + 1);
		const snare = await f.api.schedule(
			f.api.build((b) => b.setRhythm({ snare: true })),
			{ name: "snare" },
		);
		f.render(snare.startFrame + 1 - f.frame());
		assert.equal(f.registers[14], 0x29);
		manual.adopt();
		manual.api.setRhythm({ hiHat: true });
		assert.equal(
			manual.messages.at(-1).intentMask,
			1,
			"same-On high-level call carries the Hi-hat bit only",
		);
		await f.api.clearSchedule("hat");
		assert.equal(
			f.registers[14],
			0x29,
			"old hat reservation cannot release its new manual owner",
		);
		await f.api.clearSchedule("snare");
		assert.equal(
			f.registers[14],
			0x21,
			"manual hat did not steal the adjacent snare reservation",
		);
		manual.adopt();
		manual.api.setRhythm({ snare: true });
		manual.adopt();
		manual.api.writeRegister(14, 0x29);
		assert.equal(
			manual.messages.at(-1).intentMask,
			31,
			"raw R14 writes retain explicit full trigger intent",
		);
	} finally {
		manual.api.dispose();
		f.api.dispose();
	}
});

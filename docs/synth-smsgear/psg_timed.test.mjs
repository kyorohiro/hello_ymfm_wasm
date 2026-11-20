// SPDX-License-Identifier: BSD-3-Clause
// Deterministic AudioWorklet scheduling harness. No AudioContext or physical output.
import test from "node:test";
import assert from "node:assert/strict";
import { createSegaPsgApi } from "../js/segapsg_api.js";
import { createProcessorPerformance } from "../js/playground_performance_processor.js";
import { PsgInspectorState } from "../js/playground_chip_inspector_state.js";
import {
	createPsgTimedProcessor,
	psgTimedCommandCost,
} from "./psg_timed_processor.js";
import { attachPsgTimedClient } from "./psg_timed_client.js";
import { createPlaygroundCodeRuntime } from "../js/playground_code_runtime.js";

function setup(rate = 48000) {
	let frame = 0,
		stereo = 255,
		timed,
		inspector,
		eventFrame;
	const writes = [],
		requests = [],
		replies = [];
	const clock = 3579545;
	const chip = { write() {}, reset() {} };
	const port = {
		postMessage(message) {
			replies.push(message);
		},
		start() {},
		close() {},
	};
	const apply = (command, reply, at = frame, metadata) => {
		if (command.method === "applyPsgTimedOperation") {
			eventFrame = at;
			try {
				return timed.apply(command, reply, at, metadata);
			} finally {
				eventFrame = undefined;
			}
		}
		if (command.method === "write") {
			const byte = command.args[0];
			const register =
				byte & 128
					? (byte >> 4) & 7
					: (command.psgRegister ?? inspector.latched);
			if (!(byte & 128) && register !== inspector.latched) {
				const low =
					register & 1
						? byte & 15
						: register === 6
							? inspector.mode
							: inspector.periods[register >> 1] & 15;
				chip.write(0x80 | (register << 4) | low);
			}
			chip.write(byte);
			timed.observeWrite(register, byte, metadata, reply);
			writes.push({
				frame: eventFrame ?? at,
				value: byte,
				register,
				channel: register >> 1,
				owner: metadata?.owner,
			});
		} else if (command.method === "setStereo") {
			stereo = command.args[0];
			writes.push({
				frame: eventFrame ?? at,
				stereo,
				owner: metadata?.owner,
			});
		} else if (command.method === "reset") {
			timed.clear();
			chip.reset();
			stereo = 255;
		} else if (command.method === "allNotesOff") {
			for (let channel = 0; channel < 4; channel++)
				apply(
					{ method: "write", args: [0x9f | (channel << 5)] },
					reply,
					at,
					metadata,
				);
		} else throw Error("Unexpected harness operation: " + command.method);
	};
	const performance = createProcessorPerformance({
		chip: "segapsg",
		rate,
		nowFrame: () => frame,
		apply,
		getPsgLatch: () => inspector?.latched,
		getPsgMode: () => inspector?.mode,
		patternCommandCost: psgTimedCommandCost,
		onDiscard: (command, metadata) => timed?.discard(command, metadata),
	});
	inspector = new PsgInspectorState(chip, {
		clock: () => clock,
		sampleRate: rate,
	});
	const read = () => ({
		clock,
		stereoEnabled: true,
		periods: [...inspector.periods],
		attenuations: [...inspector.lastVolumes],
		latched: inspector.latched,
		noiseMode: inspector.mode,
		stereo,
	});
	timed = createPsgTimedProcessor({
		performance,
		getState: read,
		getConfig: () => ({
			clock,
			stereoEnabled: true,
			instanceId: "test-psg",
		}),
		dispatch: (command, reply, _at, metadata) =>
			performance.applyImmediate(command, reply, metadata),
		nowFrame: () => frame,
		sampleRate: rate,
		retainLevels: (levels) => {
			inspector.lastVolumes = [...levels];
		},
	});
	const request = (method, args) => {
		assert.equal(method, "psgTimed");
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
	const api = attachPsgTimedClient(
		{ clock, stereoEnabled: true, _requestControl: request, dispose() {} },
		{},
		port,
	);
	return {
		api,
		performance,
		timed,
		inspector,
		read,
		writes,
		requests,
		replies,
		rate,
		frame: () => frame,
		manual(value) {
			performance.applyImmediate(
				{ method: "write", args: [value] },
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
	test(`PSG ${rate} Hz: compile and scheduled byte traces agree at exact mixed-unit sample offsets`, async () => {
		const f = setup(rate);
		const operations = f.api.build((b) => {
			b.setAttenuation(0, 4).noteOn(0, "C4");
			b.atSample(441).setNoise({ type: "white", rate: "high" });
			b.setNoise({ type: "white", rate: "high" }); // same value must retrigger twice
			b.setStereo(0x11);
			b.atSeconds(0.02).keyOff(0);
		});
		const expected = await f.api.compile(operations);
		const receipt = await f.api.schedule(operations, { name: "exact" });
		f.render(receipt.startFrame + Math.round(rate * 0.02) + 1);
		const compact = (row) =>
			row.stereo === undefined
				? {
						value: row.value,
						register: row.register,
						channel: row.channel,
					}
				: { stereo: row.stereo };
		assert.deepEqual(f.writes.map(compact), expected.map(compact));
		assert.deepEqual(
			f.writes
				.filter((row) => row.register === 6)
				.map((row) => row.frame),
			[
				receipt.startFrame + Math.round(rate * 0.01),
				receipt.startFrame + Math.round(rate * 0.01),
			],
		);
		assert.equal(f.inspector.attenuations[0], 15);
		assert.equal(
			f.read().attenuations[0],
			4,
			"keyOff preserves configured next-note attenuation",
		);
		f.api.dispose();
	});

	test(`PSG ${rate} Hz: repeats stay compact and invalid replacement preserves the accepted reservation`, async () => {
		const f = setup(rate);
		const plan = f.api.build((b) =>
			b.setNoise({ type: "periodic", rate: "tone3" }),
		);
		const receipt = await f.api.schedule(plan, {
			name: "repeat",
			repeatSeconds: 1 / 110,
		});
		const invalid = f.api.build((b) => b.setAttenuation(0, 16));
		await assert.rejects(
			f.api.schedule(invalid, { name: "repeat", repeatSeconds: 1 / 110 }),
			/Attenuation|attenuation/,
		);
		assert.equal(f.performance.getStats().patternCount, 1);
		f.render(receipt.startFrame + Math.round(rate * 0.05));
		const frames = f.writes
			.filter((row) => row.register === 6)
			.map((row) => row.frame);
		assert(frames.length >= 5);
		for (let index = 0; index < frames.length; index++)
			assert.equal(
				frames[index],
				receipt.startFrame + Math.round((index * rate) / 110),
			);
		assert.equal(await f.api.clearSchedule("repeat"), true);
		const count = f.writes.length;
		f.render(rate * 0.02);
		assert.equal(f.writes.length, count);
		assert.equal(f.performance.getStats().patternCount, 0);
		f.api.dispose();
	});
}

test("PSG capture/compile use detached current/reset/supplied state and reject incomplete client state without RPC", async () => {
	const f = setup();
	f.manual(0x94);
	f.manual(0xe7);
	f.manual(0x8a); // retain source latch and Noise mode
	const plan = f.api.build((b) => {
		b.write(3);
		b.keyOn(0);
	});
	const snapshot = await f.api.captureState(),
		before = f.read(),
		at = f.frame(),
		count = f.writes.length;
	assert(Object.isFrozen(snapshot));
	assert(Object.isFrozen(snapshot.state));
	assert(Object.isFrozen(snapshot.state.periods));
	const a = await f.api.compile(plan),
		requests = f.requests.length;
	const b = await f.api.compile(plan, { initialState: snapshot });
	assert.deepEqual(a, b);
	assert.equal(
		f.requests.length,
		requests,
		"snapshot reuse performs no request",
	);
	const reset = await f.api.compile(plan, { initialState: "reset" });
	assert.equal(
		f.requests.length,
		requests,
		"reset compile performs no request",
	);
	assert.notDeepEqual(
		a,
		reset,
		"current retained attenuation differs from the reset next-note level",
	);
	await assert.rejects(
		f.api.compile(plan, { initialState: "client" }),
		/Incomplete PSG client state/,
	);
	assert.equal(f.requests.length, requests);
	assert.deepEqual(f.read(), before);
	assert.equal(f.frame(), at);
	assert.equal(f.writes.length, count);
	f.manual(0xe0);
	assert.equal(snapshot.state.noiseMode, 7);
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
	await assert.rejects(
		f.api.compile(plan, {
			initialState: {
				...snapshot,
				state: { ...snapshot.state, stereoEnabled: false },
			},
		}),
		/stereo/,
	);
	f.api.dispose();
});

test("PSG delayed operations resolve retained volume, raw latch and Noise state immediately before application", async () => {
	const f = setup();
	const plan = f.api.build((b) => {
		b.atSeconds(0.01).write(5);
		b.keyOn(0);
		b.setNoise({ type: "white", rate: "tone3" });
	});
	const receipt = await f.api.schedule(plan, { name: "interleave" });
	f.manual(0x93);
	f.manual(0xc2); // CH1 volume3; latch CH3 period low2
	f.render(receipt.startFrame + Math.round(f.rate * 0.01) + 1);
	assert.equal(
		f.inspector.periods[2],
		0x52,
		"raw data follows the actually applied CH3 latch",
	);
	assert.equal(
		f.inspector.attenuations[0],
		3,
		"keyOn sees the new configured attenuation",
	);
	assert.equal(f.inspector.mode, 7);
	assert.equal(
		f.inspector.attenuations[1],
		15,
		"other channels remain untouched",
	);
	f.api.dispose();
});

test("PSG an old scheduled keyOff and cancellation cannot release a newer manual note", async () => {
	const f = setup();
	const old = f.api.build((b) => {
		b.noteOn(0, "C4");
		b.atSeconds(0.02).keyOff(0);
	});
	const receipt = await f.api.schedule(old, { name: "old" });
	f.render(receipt.startFrame + 1);
	f.manual(0x93);
	f.render(Math.round(f.rate * 0.03));
	assert.equal(f.inspector.attenuations[0], 3);
	await f.api.clearSchedule("old");
	assert.equal(f.inspector.attenuations[0], 3);
	const next = await f.api.schedule(
		f.api.build((b) => b.noteOn(1, "E4")),
		{ name: "one-shot" },
	);
	f.render(next.startFrame + 1 - f.frame());
	assert.equal(f.inspector.attenuations[1], 0);
	assert.equal(await f.api.clearSchedule("one-shot"), true);
	assert.equal(f.inspector.attenuations[1], 15);
	assert.equal(f.inspector.attenuations[0], 3);
	f.api.dispose();
});

test("PSG transactional Apply stage/abort/commit and loop-owner cancellation preserve ownership", async () => {
	const f = setup(),
		c = f.api._timedOperations;
	const plan = (level) => f.api.build((b) => b.setAttenuation(0, level));
	await c.schedule(
		plan(4),
		{ name: "apply", repeatSeconds: 0.01 },
		{ owner: "entry" },
	);
	await c.stage("failed", "entry", "schedule", [
		plan(8),
		{ name: "apply", repeatSeconds: 0.01 },
	]);
	f.render(900);
	assert.equal(f.inspector.attenuations[0], 4);
	await c.abort("failed", "entry");
	f.render(900);
	assert.equal(f.inspector.attenuations[0], 4);
	await c.stage("good", "entry", "schedule", [
		plan(6),
		{ name: "apply", repeatSeconds: 0.01 },
	]);
	await c.commit("good", "entry");
	f.render(900);
	assert.equal(f.inspector.attenuations[0], 6);
	await c.schedule(
		plan(2),
		{ name: "loop", repeatSeconds: 0.01 },
		{ owner: "loop-generation" },
	);
	await c.cancelOwner("loop-generation");
	assert.equal(f.performance.getStats().patternCount, 1);
	await c.stage("discard", "entry", "schedule", [
		plan(1),
		{ name: "unused" },
	]);
	f.stop();
	await c.commit("discard", "entry");
	assert.equal(
		f.performance.getStats().patternCount,
		0,
		"Stop discards both queued and staged work",
	);
	const count = f.writes.length;
	f.render(2000);
	assert.equal(f.writes.length, count);
	f.api.dispose();
});

test("Code Run / failed Apply / successful Apply / Stop use the shared reservation lifecycle", async () => {
	const f = setup(),
		logs = [];
	const runtime = createPlaygroundCodeRuntime({
		supportedSoundChips: ["segapsg"],
		ensureReady: async () => {},
		now: () => f.frame() / f.rate,
		useSoundChip: () => f.api,
		guardExecution: false,
		onLog: (line) => logs.push(line),
	});
	const source = (level) => `const psg=await useSoundChip('segapsg');
    await psg.schedule(psg.build(b=>b.setAttenuation(CH1,${level})),{name:'entry',repeatSeconds:0.01});`;
	try {
		await runtime.run(source(4));
		f.render(900);
		assert.equal(f.inspector.attenuations[0], 4);
		assert.equal(f.performance.getStats().patternCount, 1);
		await assert.rejects(
			runtime.apply(source(8) + `throw Error('failed Apply');`),
			/failed Apply/,
		);
		f.render(900);
		assert.equal(
			f.inspector.attenuations[0],
			4,
			"failed Apply retains the previous named reservation",
		);
		await runtime.apply(source(6));
		f.render(900);
		assert.equal(f.inspector.attenuations[0], 6);
		await runtime.stop();
		assert.equal(f.performance.getStats().patternCount, 0);
		assert.equal(
			f.inspector.attenuations[0],
			15,
			"Stop releases notes owned by the scheduled entry",
		);
		const count = f.writes.length;
		f.render(2000);
		assert.equal(f.writes.length, count, "no repeated writes survive Stop");
		assert.equal(
			logs.filter((line) => line.startsWith("[cleanup]")).length,
			0,
		);
	} finally {
		await runtime.stop();
		f.api.dispose();
	}
});

test("Code stopLoop cancels that loop generation without retiring another entry reservation", async () => {
	const f = setup();
	const runtime = createPlaygroundCodeRuntime({
		supportedSoundChips: ["segapsg"],
		ensureReady: async () => {},
		now: () => f.frame() / f.rate,
		useSoundChip: () => f.api,
		guardExecution: false,
	});
	const until = async (predicate) => {
		for (let i = 0; i < 100; i++) {
			if (predicate()) return;
			await new Promise((resolve) => setTimeout(resolve, 1));
		}
		assert.fail("loop action timed out");
	};
	try {
		await runtime.run(`const psg=await useSoundChip('segapsg');
      await psg.schedule(psg.build(b=>b.setAttenuation(CH2,5)),{name:'entry',repeatSeconds:0.01});
      liveLoop('noise',async()=>{
        await psg.schedule(psg.build(b=>b.noise({type:'white',rate:'high',attenuation:4})),{name:'noise-loop',repeatSeconds:0.01});
        await beat(100);
      });`);
		await until(() => f.performance.getStats().patternCount === 2);
		f.render(900);
		assert.equal(f.inspector.attenuations[3], 4);
		await runtime.apply(`const psg=await useSoundChip('segapsg');
      await psg.schedule(psg.build(b=>b.setAttenuation(CH2,5)),{name:'entry',repeatSeconds:0.01});
      stopLoop('noise');`);
		await until(() => f.performance.getStats().patternCount === 1);
		// The entry reservation remains active; the old loop generation's Noise
		// voice is released and cannot be resurrected by its former repeat.
		assert.equal(f.inspector.attenuations[3], 15);
		const count = f.writes.length;
		f.render(2000);
		assert(f.writes.length > count);
		assert(f.writes.slice(count).every((row) => row.channel === 1));
		assert.equal(f.inspector.attenuations[3], 15);
	} finally {
		await runtime.stop();
		f.api.dispose();
	}
});

test("PSG immediate metadata distinguishes explicit silence from retained key release without changing bytes", () => {
	const bytes = [],
		messages = [];
	const port = {
		postMessage: (value) => messages.push(value),
		addEventListener() {},
		removeEventListener() {},
		start() {},
	};
	const api = {
		...createSegaPsgApi({
			clock: 3579545,
			write: (value) => bytes.push(value),
			setStereo() {},
		}),
		clock: 3579545,
		stereoEnabled: true,
		dispose() {},
		_requestControl() {
			throw Error("unexpected state request");
		},
	};
	attachPsgTimedClient(api, {}, port);
	api.setAttenuation(0, 3);
	api.keyOff(0);
	api.setAttenuation(0, 15);
	assert.deepEqual(bytes, [0x93, 0x9f, 0x9f]);
	assert.deepEqual(
		messages.map((m) => m.args[0][0]),
		[3, 3, 15],
	);
	assert(messages.every((m) => m.method === "psgConfiguredLevels"));
	api.dispose();
	// The additive API preserves the immediate client's existing disposal behavior.
	assert.throws(() => api.build(() => {}), /stopped/);
	assert(messages.every((m) => m.args[1] === 1));
});

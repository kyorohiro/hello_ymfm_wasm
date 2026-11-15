import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import factory from '../generated/scsp_wasm.js';
import { Scsp } from '../js/scsp.js';
import { Pcm44100Resampler } from '../js/pcm_44100_resampler.js';
import { SynthInstrument } from './instrument.js';
const binary = await readFile(new URL('../generated/scsp_wasm.wasm', import.meta.url)),
	source = await readFile(new URL('./processor.js', import.meta.url), 'utf8');
async function make(t, rate) {
	let Class;
	const messages = [];
	vm.runInNewContext(source.replace(/^import .*;\n/gm, ''), {
		factory,
		Scsp,
		Pcm44100Resampler,
		SynthInstrument,
		Float32Array,
		sampleRate: rate,
		AudioWorkletProcessor: class {
			constructor() {
				this.port = { postMessage: (m) => messages.push(m) };
			}
		},
		registerProcessor(name, value) {
			assert.equal(name, 'tetorica-scsp-synth');
			Class = value;
		},
	});
	const p = new Class({ processorOptions: { wasmBinary: binary } });
	await p.ready;
	t.after(() => p.port.onmessage({ data: { method: 'dispose' } }));
	assert(messages.some((m) => m.ready));
	return {
		p,
		messages,
		async command(method, args = []) {
			p.port.onmessage({ data: { id: 1, method, args } });
			await p.ready;
			await Promise.resolve();
			const result = messages.at(-1);
			assert(!result.error, result.error);
			return result.value;
		},
		render(n) {
			const left = new Float32Array(n),
				right = left.slice();
			assert(p.process([], [[left, right]]));
			return { left, right };
		},
	};
}
test('dedicated processor handles grouped commands, all host rates and render partitions with exact Stop silence', async (t) => {
	for (const rate of [44100, 48000, 96000])
		for (const mode of ['fm2', 'fm4', 'fm6']) {
			const a = await make(t, rate),
				b = await make(t, rate);
			for (const x of [a, b]) {
				await x.command('setConfig', [{ mode }]);
				await x.command('setEffect', [
					{ enabled: true, timeMs: 20, send: 7, returnLevel: 7 },
				]);
				await x.command('noteOn', ['note', 69]);
			}
			const whole = a.render(8192),
				left = new Float32Array(8192),
				right = left.slice();
			for (let at = 0; at < 8192; at += 37) {
				const part = b.render(Math.min(37, 8192 - at));
				left.set(part.left, at);
				right.set(part.right, at);
			}
			assert.deepEqual(whole, { left, right });
			assert(left.some((x) => Math.abs(x) > 0.01));
			await a.command('setConfig', [{ fm: { algorithm: 'pairs' } }]);
			assert(a.render(128).left.every((v) => v === 0));
			await a.command('setConfig', [{ mode: 'pcm' }]);
			assert(a.render(128).left.every((x) => x === 0));
			await a.command('noteOn', ['next', 69]);
			await a.command('stopVoices');
			assert(a.render(128).left.every((x) => x === 0));
		}
});

test('processor Code shares authored groups and fences stale messages without stopping the keyboard', async (t) => {
	const f = await make(t, 48000);
	await f.command('setConfig', [{ mode: 'fm6' }]);
	const { session } = await f.command('beginCode');
	await f.command('code', [session, 'noteOn', [0, 'A4']]);
	await f.command('noteOn', ['keyboard', 60]);
	assert(f.render(4096).left.some((x) => Math.abs(x) > 0.01));
	await f.command('endCode', [session]);
	const author = await f.command('readAuthoring');
	assert.equal(author.state.voiceGroups.length, 1);
	assert.equal(author.state.voiceGroups[0].id, 'keyboard');
	assert(author.state.voiceGroups[0].held);
	assert(f.render(4096).left.some((x) => Math.abs(x) > 0.01));
	f.p.port.onmessage({
		data: { id: 99, method: 'code', args: [session, 'allNotesOff', []] },
	});
	await f.p.ready;
	await Promise.resolve();
	assert.equal(f.messages.at(-1).name, 'AbortError');
	assert.equal(f.messages.at(-1).id, 99);
	assert.equal(f.p.instrument.read().voiceGroups[0].id, 'keyboard');
});

test('processor migrates idle physical edits and routes direct controls without stale resampler audio', async (t) => {
	const source = await make(t, 48000),
		target = await make(t, 48000),
		pcm = Int8Array.from({ length: 128 }, (_, n) => (n < 64 ? 64 : -64));
	await source.command('invokePhysical', ['applyPCM', [30, pcm, { rootNote: 69, loopStartSamples: 0 }]]);
	await source.command('invokePhysical', ['setMix', [30, { totalLevel: 41 }]]);
	const expected = await source.command('readPhysical', [30]);
	await target.command('noteOn', ['old', 69]);
	assert(target.render(333).left.some((value) => Math.abs(value) > 0.01));
	await target.command('loadIdleState', [source.p.instrument.exportIdleState()]);
	assert.deepEqual(await target.command('readPhysical', [30]), expected);
	assert(target.render(128).left.every((value) => value === 0));
	await target.command('physicalNoteOn', ['direct', 30, 69]);
	assert.equal((await target.command('readAuthoring')).state.manualVoices[0].slot, 30);
	assert(target.render(4096).left.some((value) => Math.abs(value) > 0.001));
	assert.equal(await target.command('physicalNoteOff', ['direct']), true);
	await target.command('physicalNoteOn', ['second', 31, 72]);
	await target.command('stopPhysicalVoices');
	const state = (await target.command('readAuthoring')).state;
	assert.equal(state.slots[30].gate, false);
	assert.equal(state.slots[31].gate, false);
	assert.equal((await target.command('readPhysical', [30])).sample.id, expected.sample.id);
});

test('processor accepts fractional performance bend, preserves portable transpose and resets on command', async (t) => {
	const f = await make(t, 48000);
	await f.command('setConfig', [{ mode: 'fm2', transpose: 2 }]);
	assert.equal(await f.command('setPitchBend', [0.5]), 0.5);
	await f.command('noteOn', ['keyboard', 69]);
	const { session } = await f.command('beginCode');
	await f.command('code', [session, 'noteOn', [0, 69]]);
	let state = (await f.command('readAuthoring')).state;
	assert.equal(state.pitchBend, 0.5);
	assert.equal(state.config.transpose, 2);
	for (const group of state.voiceGroups) {
		const [modulator, carrier] = group.slots;
		assert(Math.abs(state.slots[carrier].frequencyHz - 440 * 2 ** (2.5 / 12)) < 1e-8);
		assert(Math.abs(state.slots[modulator].frequencyHz - 880 * 2 ** (2.5 / 12)) < 1e-8);
	}
	assert.equal((await f.command('exportPatch')).transpose, 2);
	assert(f.render(4096).left.some((x) => Math.abs(x) > 0.01));
	await f.command('setPitchBend', [0]);
	state = (await f.command('readAuthoring')).state;
	assert.equal(state.pitchBend, 0);
	for (const group of state.voiceGroups)
		assert(Math.abs(state.slots[group.slots[1]].frequencyHz - 440 * 2 ** (2 / 12)) < 1e-8);
});

function auditionPreset(patch) {
	const source = patch.operators.carrier;
	return {
		format: 'tetorica-scsp-voice',
		version: 1,
		...structuredClone(source),
		bits: 8,
		pcm: Array.from({ length: 64 }, (_, index) =>
			Math.round(64 * (1 - 4 * Math.abs(index / 64 - 0.5))),
		),
		options: {
			baseFrequencyHz: 440,
			sourceSampleRate: 28160,
			loopStartSamples: 0,
		},
		voice: {
			...source.voice,
			totalLevel: 0,
			directLevel: 7,
			envelope: {
				...source.voice.envelope,
				attackRate: 31,
				releaseRate: 31,
			},
		},
	};
}
test('paused audition owns independent RAM and voices while sharing the compiled native module', async (t) => {
	const f = await make(t, 48000),
		authored = await f.command('exportPatch'),
		ram = f.p.instrument.core.readRam();
	const preset = auditionPreset(authored);
	await f.command('loadAudition', [preset]);
	assert.equal(f.p.audition.core.module, f.p.instrument.core.module);
	assert.notEqual(f.p.audition.core.handle, f.p.instrument.core.handle);
	await f.command('auditionOn', ['preview', 69]);
	assert(f.render(4096).left.some((x) => Math.abs(x) > 0.01));
	const preview = await f.command('readAudition');
	assert.equal(preview.voiceGroups.length, 1);
	assert.equal(preview.voiceGroups[0].midi, 69);
	const slot = preview.slots[preview.voiceGroups[0].slots[0]];
	assert.equal(slot.sample.bits, 8);
	assert.equal(slot.sample.sourceSampleRate, 28160);
	assert.equal(slot.frequencyHz, 440);
	assert.deepEqual(await f.command('exportPatch'), authored);
	assert.deepEqual(f.p.instrument.core.readRam(), ram);
	assert.equal((await f.command('readAuthoring')).state.voiceGroups.length, 0);
	await f.command('auditionOff', ['preview']);
	f.render(8192);
	assert(f.render(512).left.every((x) => x === 0));
	await f.command('stopAudition');
	assert(f.render(128).left.every((x) => x === 0));
});
test('audition mixing is partition invariant and stopping it retains authored notes and PCM', async (t) => {
	for (const rate of [44100, 48000, 96000]) {
		const a = await make(t, rate),
			b = await make(t, rate),
			preset = auditionPreset(await a.command('exportPatch'));
		for (const f of [a, b]) {
			await f.command('loadAudition', [preset]);
			await f.command('noteOn', ['authored', 60]);
			await f.command('auditionOn', ['preview', 69]);
			await f.command('setPitchBend', [0.5]);
		}
		const whole = a.render(8192),
			left = new Float32Array(8192),
			right = left.slice();
		for (let at = 0; at < 8192; at += 37) {
			const part = b.render(Math.min(37, 8192 - at));
			left.set(part.left, at);
			right.set(part.right, at);
		}
		assert.deepEqual(whole, { left, right });
		assert.equal((await a.command('readAudition')).pitchBend, 0.5);
		const before = await a.command('exportPatch');
		await a.command('stopAudition');
		assert.equal((await a.command('readAuthoring')).state.voiceGroups[0].id, 'authored');
		assert(a.render(1024).left.some((x) => Math.abs(x) > 0.01));
		assert.deepEqual(await a.command('exportPatch'), before);
		assert.equal(await a.command('auditionOff', ['preview']), false);
		await a.command('stopVoices');
		assert(a.render(128).left.every((x) => x === 0));
	}
});
test('invalid audition replacement leaves the current preview and authored instrument intact', async (t) => {
	const f = await make(t, 44100),
		authored = await f.command('exportPatch'),
		preset = auditionPreset(authored);
	await f.command('loadAudition', [preset]);
	await f.command('auditionOn', ['preview', 69]);
	f.render(1000);
	const before = await f.command('readAudition');
	f.p.port.onmessage({
		data: {
			id: 77,
			method: 'loadAudition',
			args: [{ ...preset, bits: 7 }],
		},
	});
	await f.p.ready;
	await Promise.resolve();
	assert.equal(f.messages.at(-1).id, 77);
	assert.match(f.messages.at(-1).error, /PCM8\/16/);
	assert.deepEqual(await f.command('readAudition'), before);
	assert.deepEqual(await f.command('exportPatch'), authored);
	assert(f.render(1024).left.some((x) => Math.abs(x) > 0.01));
});

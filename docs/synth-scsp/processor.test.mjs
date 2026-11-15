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
async function commandError(f, method, args) {
	f.p.port.onmessage({ data: { id: 78, method, args } });
	await f.p.ready;
	await Promise.resolve();
	const result = f.messages.at(-1);
	assert.equal(result.id, 78);
	assert(result.error, `${method} unexpectedly succeeded`);
	return result;
}
function auditionFingerprint(f) {
	return {
		state: f.p.audition.read(),
		ram: f.p.audition.core.readRam(),
		registers: Array.from({ length: 512 }, (_, index) => f.p.audition.core.read(index * 2)),
		token: f.p.auditionToken,
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
	await source.command('invokePhysical', [
		'applyPCM',
		[30, pcm, { rootNote: 69, loopStartSamples: 0 }],
	]);
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
test('host Click guard preference reaches both authored and paused audition voices without editing their sound', async (t) => {
	const f = await make(t, 44100),
		patch = await f.command('exportPatch');
	await f.command('noteOn', ['authored', 57]);
	await f.command('loadAudition', [auditionPreset(patch)]);
	await f.command('auditionOn', ['preview', 69]);
	f.render(1024);
	const authored = f.p.instrument.core.readRam(),
		audition = f.p.audition.core.readRam();
	assert.equal(await f.command('setClickGuard', [false]), false);
	assert.equal((await f.command('readAuthoring')).state.clickGuard, false);
	assert.equal((await f.command('readAudition')).clickGuard, false);
	assert.equal(f.p.instrument.read().voiceGroups[0].held, true);
	assert.equal(f.p.audition.read().voiceGroups[0].held, true);
	assert.deepEqual(f.p.instrument.core.readRam(), authored);
	assert.deepEqual(f.p.audition.core.readRam(), audition);
	assert.deepEqual(await f.command('exportPatch'), patch);
	await f.command('auditionOff', ['preview']);
	const previewSlot = f.p.audition.read().voiceGroups[0].slots[0];
	assert.equal(f.p.audition.core.read(previewSlot * 32 + 10) & 31, 31);
	await f.command('auditionOn', ['guarded', 69]);
	assert.equal(await f.command('setClickGuard', [true]), true);
	await f.command('noteOff', ['authored']);
	await f.command('auditionOff', ['guarded']);
	const authoredSlot = f.p.instrument.read().voiceGroups[0].slots[0],
		guardedSlot = f.p.audition.read().voiceGroups.find((group) => group.id === 'guarded')
			.slots[0];
	assert.equal(f.p.instrument.core.read(authoredSlot * 32 + 10) & 31, 25);
	assert.equal(f.p.audition.core.read(guardedSlot * 32 + 10) & 31, 25);
	f.p.port.onmessage({ data: { id: 77, method: 'setClickGuard', args: ['false'] } });
	await f.p.ready;
	await Promise.resolve();
	assert.match(f.messages.at(-1).error, /one boolean/);
	assert.equal(f.p.instrument.read().clickGuard, true);
	assert.equal(f.p.audition.read().clickGuard, true);
});
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

test('owned audition edits update live Mix / LFO and next-note Envelope without changing authored voices', async (t) => {
	const f = await make(t, 44100),
		patch = await f.command('exportPatch'),
		preset = auditionPreset(patch),
		token = 'song:frame:slot0';
	await f.command('setClickGuard', [false]);
	await f.command('noteOn', ['authored', 57]);
	const { session } = await f.command('beginCode');
	await f.command('code', [session, 'noteOn', [0, 60]]);
	await f.command('loadAudition', [preset, token]);
	await f.command('auditionOn', ['preview', 69, token]);
	assert(f.render(1024).left.some((value) => Math.abs(value) > 0.01));
	const authored = f.p.instrument.read(),
		authoredRam = f.p.instrument.core.readRam(),
		auditionRam = f.p.audition.core.readRam(),
		slot = f.p.audition.read().voiceGroups[0].slots[0],
		envelopeWords = [8, 10].map((offset) => f.p.audition.core.read(slot * 32 + offset));
	const envelope = { attackRate: 24, releaseRate: 19, keyRateScaling: 3, loopLink: true },
		lfo = {
			frequencyCode: 12,
			pitchWave: 2,
			pitchDepth: 1,
			amplitudeWave: 1,
			amplitudeDepth: 3,
			reset: false,
		},
		mix = { totalLevel: 21, directLevel: 6, pan: 31 };
	const result = await f.command('invokeAudition', [token, 'setEnvelope', [0, envelope]]);
	assert.deepEqual(result.voice, result.state.slots[0]);
	for (const [key, value] of Object.entries(envelope))
		assert.equal(result.voice.envelope[key], value);
	assert.deepEqual(
		[8, 10].map((offset) => f.p.audition.core.read(slot * 32 + offset)),
		envelopeWords,
		'Envelope edits must leave the held note latched',
	);
	await f.command('invokeAudition', [token, 'setLfo', [0, lfo]]);
	await f.command('invokeAudition', [token, 'setMix', [0, mix]]);
	assert.equal(
		f.p.audition.core.read(slot * 32 + 18),
		(12 << 10) | (2 << 8) | (1 << 5) | (1 << 3) | 3,
	);
	assert.equal(f.p.audition.core.read(slot * 32 + 12) & 255, 21);
	assert.equal(f.p.audition.core.read(slot * 32 + 22), (6 << 13) | (31 << 8));
	assert.equal(f.p.audition.read().clickGuard, false);
	assert(f.p.audition.read().voiceGroups[0].held);
	assert.deepEqual(f.p.instrument.read(), authored);
	assert.deepEqual(f.p.instrument.core.readRam(), authoredRam);
	assert.deepEqual(f.p.audition.core.readRam(), auditionRam);
	assert.deepEqual(await f.command('exportPatch'), patch);
	await f.command('auditionOff', ['preview', token]);
	await f.command('auditionOn', ['next', 69, token]);
	const next = f.p.audition.read().voiceGroups.find((group) => group.id === 'next').slots[0];
	assert.equal(f.p.audition.core.read(next * 32 + 8) & 31, 24);
	assert.equal(f.p.audition.core.read(next * 32 + 10) & 0x7c1f, 0x4000 | (3 << 10) | 19);
	const audio = f.render(4096);
	assert([...audio.left, ...audio.right].every(Number.isFinite));
	assert(audio.left.some((value) => Math.abs(value) > 0.001));
});

test('invalid audition parameter edits preserve requested state, PCM and every native slot register', async (t) => {
	const f = await make(t, 44100),
		preset = auditionPreset(await f.command('exportPatch')),
		token = 'selection';
	await f.command('loadAudition', [preset, token]);
	await f.command('auditionOn', ['preview', 69, token]);
	f.render(512);
	const before = auditionFingerprint(f);
	for (const [method, parameters] of [
		['setEnvelope', [0, { attackRate: 32 }]],
		['setEnvelope', [0, { loopLink: 1 }]],
		['setLfo', [0, { amplitudeDepth: 8 }]],
		['setLfo', [0, { reset: 'true' }]],
		['setMix', [0, { pan: 31, directLevel: 8 }]],
		['setMix', [0, { totalLevel: 256 }]],
		['setMix', [1, { totalLevel: 10 }]],
		['loadPatch', [0, preset]],
		['setMix', [{ totalLevel: 10 }]],
	]) {
		await commandError(f, 'invokeAudition', [token, method, parameters]);
		assert.deepEqual(auditionFingerprint(f), before, `${method} must be atomic`);
	}
});

test('audition owner tokens fence stale edits, keys and Stop across selection replacement', async (t) => {
	const f = await make(t, 48000),
		preset = auditionPreset(await f.command('exportPatch'));
	await f.command('loadAudition', [preset, 'old']);
	await f.command('auditionOn', ['same-key', 69, 'old']);
	await f.command('loadAudition', [preset, 'current']);
	await f.command('auditionOn', ['same-key', 72, 'current']);
	f.render(1024);
	const before = auditionFingerprint(f);
	for (const [method, args] of [
		['invokeAudition', ['old', 'setMix', [0, { totalLevel: 255 }]]],
		['auditionOn', ['same-key', 69, 'old']],
		['auditionOff', ['same-key', 'old']],
		['auditionOn', ['same-key', 69]],
		['auditionOff', ['same-key']],
	]) {
		assert.equal((await commandError(f, method, args)).name, 'AbortError');
		assert.deepEqual(auditionFingerprint(f), before);
	}
	assert.equal(await f.command('stopAudition', ['old']), false);
	assert.deepEqual(auditionFingerprint(f), before);
	await f.command('stopAudition', ['current']);
	assert.equal(f.p.auditionToken, null);
	assert(f.render(128).left.every((value) => value === 0));
	assert.equal(
		(await commandError(f, 'invokeAudition', ['current', 'setMix', [0, { pan: 15 }]])).name,
		'AbortError',
	);
	await f.command('loadAudition', [preset, 'next']);
	await f.command('auditionOn', ['next', 69, 'next']);
	assert(f.render(1024).left.some((value) => Math.abs(value) > 0.01));
	await f.command('loadAudition', [preset]);
	await f.command('auditionOn', ['legacy', 69]);
	assert.equal(await f.command('auditionOff', ['legacy']), true);
});

test('audition replacement validates current bend before any native or owner mutation', async (t) => {
	const f = await make(t, 44100),
		preset = auditionPreset(await f.command('exportPatch'));
	await f.command('setClickGuard', [false]);
	await f.command('setPitchBend', [-2]);
	await f.command('loadAudition', [preset, 'kept']);
	await f.command('auditionOn', ['preview', 69, 'kept']);
	f.render(512);
	const before = auditionFingerprint(f),
		invalid = structuredClone(preset);
	invalid.options.sourceSampleRate = 44100 / 256;
	assert.match(
		(await commandError(f, 'loadAudition', [invalid, 'rejected'])).error,
		/pitch|ratio|range/i,
	);
	assert.deepEqual(auditionFingerprint(f), before);
	assert.equal(f.p.audition.read().clickGuard, false);
	assert(f.render(512).left.some((value) => Math.abs(value) > 0.01));
});

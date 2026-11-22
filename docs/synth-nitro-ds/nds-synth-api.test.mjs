// SPDX-License-Identifier: BSD-3-Clause
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { makeNdsSample, NdsSynth, ndsTimerForFrequency } from './nds-synth-api.js';
import { NDS_MAX_SAMPLE_BYTES } from './nds-core.js';
import { buildNdsOperations, compileNdsOperations } from './nds-timed-operations.js';

const wasmModule = await WebAssembly.compile(await readFile(
	new URL('./generated/skyemu-2sf.wasm', import.meta.url),
));
let Processor;
globalThis.AudioWorkletProcessor = class { port = { postMessage() {} }; };
globalThis.registerProcessor = (name, implementation) => {
	assert.equal(name, 'tetorica-nds-synth');
	Processor = implementation;
};
try {
	await import('./nds-worklet.js');
} finally {
	delete globalThis.AudioWorkletProcessor;
	delete globalThis.registerProcessor;
}

function endpoint(testContext, onRender) {
	let worklet;
	globalThis.sampleRate = 48000;
	try {
		worklet = new Processor({ processorOptions: { module: wasmModule } });
	} finally {
		delete globalThis.sampleRate;
	}
	const owners = Array(16).fill(null), pending = new Map();
	const channels = [new Float32Array(128), new Float32Array(128)];
	let id = 0, pump, blocks = 0;
	testContext.after(() => {
		clearImmediate(pump);
		worklet.port.onmessage({ data: { method: 'dispose' } });
	});
	function processPending() {
		pump = undefined;
		if (pending.size === 0) {
			blocks = 0;
			return;
		}
		try {
			assert(++blocks <= 2048, 'DS commands should complete after bounded processing');
			worklet.process([], [channels]);
			onRender?.(...channels);
		} catch (error) {
			for (const { reject } of pending.values()) reject(error);
			pending.clear();
		}
		pump = setImmediate(processPending);
	}
	worklet.port.postMessage = (message) => {
		const { id, owners: next, value, error, name } = structuredClone(message);
		const request = pending.get(id);
		if (!request) return;
		pending.delete(id);
		if (next) owners.splice(0, owners.length, ...next);
		if (error) {
			const failure = new Error(error);
			failure.name = name;
			request.reject(failure);
		} else request.resolve(value);
	};
	function request(method, args = []) {
		const message = structuredClone({ id: ++id, method, args });
		return new Promise((resolve, reject) => {
			pending.set(id, { resolve, reject });
			queueMicrotask(() => {
				worklet.port.onmessage({ data: message });
				if (!pump && pending.size > 0) pump = setImmediate(processPending);
			});
		});
	}
	return { chip: new NdsSynth(request, { owners }), request, worklet };
}

test('built-in DS sample formats and shapes sound as word-aligned loops in SkyEmu', async (t) => {
	const { chip, worklet } = endpoint(t);
	const left = new Float32Array(512), right = new Float32Array(512);
	for (const mode of ['pcm8', 'pcm16', 'adpcm']) {
		for (const shape of ['sine', 'triangle', 'saw', 'square']) {
			const { frames, ...sample } = makeNdsSample(mode, shape);
			assert.equal(frames, 64);
			assert.equal((sample.loopStartWords + sample.lengthWords) * 4, sample.bytes.length);
			if (mode === 'adpcm') assert.equal(sample.loopStartWords, 1);
			await chip.noteOn(0, 'A4', { ...sample, mode, frames, pan: 0 });
			worklet.process([], [[left, right]]);
			assert(left.some((value) => value > .025), `${mode} ${shape} positive signal`);
			assert(left.some((value) => value < -.025), `${mode} ${shape} negative signal`);
			assert(right.every((value) => value === 0), `${mode} ${shape} hard left pan`);
		}
	}
});

test('DS Worklet uses SkyEmu and exposes zero-based physical channels', async (t) => {
	const { chip, request } = endpoint(t);
	assert.equal(await request('ready'), 'skyemu');
	const initial = await chip.getState();
	assert.equal(initial.length, 16);
	assert(initial.every((row, channel) => row.channel === channel && !row.active && row.mode === 'pcm16'));
	const pcm = await chip.noteOn(0, 'A4', { mode: 'adpcm', shape: 'triangle', loop: false });
	assert.equal(pcm.timer, ndsTimerForFrequency(440, 64).timer);
	assert.equal((await chip.getState(0)).shape, 'triangle');
	assert.equal((await chip.configure(0, { shape: 'square' })).loop, false);
	const pulse = await chip.noteOn(8, 69, { mode: 'pulse' });
	assert.equal(pulse.timer, ndsTimerForFrequency(440, 8).timer);
	const noise = await chip.noteOn(14, 69, { mode: 'noise' });
	assert.equal(noise.timer, ndsTimerForFrequency(440, 1).timer);
	await assert.rejects(chip.noteOn(0, 'C4', { mode: 'noise' }), /channels 14–15/);
	assert.equal((await chip.getState(0)).token, pcm.token);
	await assert.rejects(chip.setFrequency(0, undefined), /positive finite Hz/);
});

test('Imported sample pitch follows source rate and root independently of loop length', async (t) => {
	const { chip } = endpoint(t);
	const { bytes } = makeNdsSample('pcm16');
	const sound = { mode: 'pcm16', bytes, sampleRate: 32000, rootNote: 69, loopStartWords: 4, lengthWords: 13 };
	const root = await chip.noteOn(0, 'A4', sound);
	assert.equal(root.timer, ndsTimerForFrequency(32000, 1).timer);
	assert(Math.abs(root.frequencyHz - 440) < 1);
	const state = await chip.getState(0);
	assert.equal(state.sampleRate, 32000);
	assert.equal(state.rootNote, 69);
	assert.equal(state.loopStartWords, 4);
	assert.equal(state.lengthWords, 13);
	await chip.configure(0, { loopStartWords: 7, lengthWords: 5 });
	assert.equal((await chip.setNote(0, 'A5')).timer, ndsTimerForFrequency(64000, 1).timer);
	assert.equal((await chip.setFrequency(0, 220)).timer, ndsTimerForFrequency(16000, 1).timer);
	assert.equal((await chip.getState(0)).loopStartWords, 7);
	const raw = await chip.noteOn(0, 'A5', { timer: 0xc000 });
	assert.equal(raw.timer, 0xc000);
	assert.equal((await chip.keyOn(0)).timer, 0xc000);
	assert.equal((await chip.setFrequency(0, Number.MAX_VALUE)).timer, 65535);
	assert.equal((await chip.setFrequency(0, Number.MIN_VALUE)).timer, 0);

	await assert.rejects(chip.configure(0, { sampleRate: 44100 }), /rootNote together/);
	await assert.rejects(chip.configure(0, { rootNote: 'R4', sampleRate: 44100 }), /note name/);
	await assert.rejects(chip.configure(0, { rootNote: 'A4', sampleRate: 44100, frames: 32 }), /source tuning or a sample-cycle length/);
	assert.equal((await chip.getState(0)).sampleRate, 32000);
	await chip.configure(0, { bytes });
	assert.equal((await chip.getState(0)).rootNote, null);
	assert.equal((await chip.noteOn(0, 'A4')).timer, ndsTimerForFrequency(440, 64).timer);
	await chip.configure(0, { rootNote: 'A3', sampleRate: 44100 });
	assert.equal((await chip.getState(0)).rootNote, 'A3');
	await chip.configure(0, { shape: 'saw' });
	assert.equal((await chip.getState(0)).sampleRate, null);
	await assert.rejects(chip.configure(0, { rootNote: 'A3', sampleRate: 44100 }), /requires imported/);
});

test('Identical imported ADPCM bytes are reused across explicit range changes on retrigger', async (t) => {
	const { chip, worklet } = endpoint(t);
	const { bytes, loopStartWords, lengthWords } = makeNdsSample('adpcm');
	const sound = { mode: 'adpcm', bytes, loop: true, loopStartWords, lengthWords, rootNote: 'C4', sampleRate: 22050 };
	const configure = worklet.core.configure.bind(worklet.core);
	const updates = [];
	worklet.core.configure = (channel, patch) => {
		updates.push(Object.hasOwn(patch, 'bytes'));
		return configure(channel, patch);
	};
	await chip.noteOn(0, 'C4', sound);
	const transposed = await chip.noteOn(0, 'C5', sound);
	assert.equal(transposed.timer, ndsTimerForFrequency(44100, 1).timer);
	assert.deepEqual(updates, [true, false]);
	bytes[4] ^= 1;
	await chip.noteOn(0, 'C4', sound);
	await chip.noteOn(0, 'C4', { ...sound, loopStartWords: loopStartWords + 1, lengthWords: lengthWords - 1 });
	assert.equal((await chip.getState(0)).loopStartWords, loopStartWords + 1);
	const { loopStartWords: _start, lengthWords: _length, ...soundWithoutRange } = sound;
	await chip.noteOn(0, 'C4', soundWithoutRange);
	assert.deepEqual(updates, [true, false, true, false, true]);
	assert.equal((await chip.getState(0)).loopStartWords, loopStartWords);
});

test('DS owner-scoped releases and live edits cannot change a replaced voice', async (t) => {
	const { chip, worklet } = endpoint(t);
	const keyboard = chip.forOwner('keyboard'), code = chip.forOwner('code');
	assert.equal(chip.forOwner('code'), code);
	const original = await keyboard.noteOn(0, 'A4', { volume: 100 });
	assert(keyboard.owns(0, original.token));
	const [replacement, staleEdit] = await Promise.all([
		code.noteOn(0, 'C5', { volume: 80 }),
		keyboard.configureOwned(0, original.token, { volume: 23 }),
	]);
	assert.equal(staleEdit, false);
	assert.equal((await code.getState(0)).volume, 80);
	assert(!keyboard.owns(0, original.token));
	assert.equal(await keyboard.noteOff(0, original.token), false);
	assert.equal(await keyboard.stopOwned(), 0);
	assert(code.owns(0, replacement.token));
	const retrigger = await code.noteOn(0, 'A4', { volume: 96 });
	assert.equal(await code.noteOff(0, replacement.token), false);
	assert.equal(await code.noteOff(0, retrigger.token), true);
	assert.equal((await code.getState(0)).releasing, true);
	const left = new Float32Array(512), right = new Float32Array(512);
	worklet.process([], [[left, right]]);
	assert(left.some((value) => value !== 0));
	assert(left.slice(384).every((value) => value === 0));
	assert.equal((await code.getState(0)).active, false);
	const key = await code.keyOn(0);
	assert.equal(await code.keyOff(0, key.token), true);
	assert.equal((await code.getState(0)).active, false);
});

test('DS owned timer changes and key tracking reuse the held PCM sample and preserve ownership', async (t) => {
	const { chip } = endpoint(t);
	const keyboard = chip.forOwner('keyboard'), code = chip.forOwner('code');
	const { bytes } = makeNdsSample('pcm16');
	const sample = { mode: 'pcm16', bytes, sampleRate: 32000, rootNote: 'C4', loopStartWords: 0, lengthWords: 32 };
	const note = await keyboard.noteOn(0, 'C5', { ...sample, timer: 0 });
	assert.equal(note.timer, 0);
	const fixed = ndsTimerForFrequency(16000, 1).timer;
	const changed = await keyboard.configureOwned(0, note.token, { timer: fixed });
	assert.equal(changed.timer, fixed);
	assert(changed.active && !changed.releasing);
	const tracked = await keyboard.configureOwned(0, note.token, {}, 'C5');
	assert.equal(tracked.timer, ndsTimerForFrequency(64000, 1).timer);
	assert.equal(tracked.token, note.token);
	assert.equal(tracked.byteLength, bytes.length);
	const replacement = await code.noteOn(0, 'C4');
	assert.equal(await keyboard.configureOwned(0, note.token, {}, 'C5'), false);
	assert.equal((await code.getState(0)).timer, replacement.timer);
});

test('DS held sample range updates preserve the playing note and reject a stale owner', async (t) => {
	const { chip, worklet } = endpoint(t);
	const keyboard = chip.forOwner('keyboard'), code = chip.forOwner('code');
	const bytes = new Uint8Array(32);
	bytes.fill(127, 16);
	const note = await keyboard.noteOn(0, 'C4', { mode: 'pcm8', bytes, loop: true, timer: 65187, pan: 0 });
	const left = new Float32Array(128), right = new Float32Array(128);
	worklet.process([], [[left, right]]);
	assert(left.some(value => value > 0));
	const range = { loopStartWords: 0, lengthWords: 4 };
	assert.equal(await keyboard.setOwnedSampleRange(0, note.token, range), true);
	worklet.process([], [[left, right]]);
	assert(left.every(value => value === 0));
	const playing = await chip.getState(0);
	assert(playing.active && !playing.releasing && playing.token === note.token);
	assert.equal(playing.lengthWords, 8, 'The range patch only applies to the held note');

	const replacement = await code.keyOn(0);
	assert.equal(await keyboard.setOwnedSampleRange(0, note.token, range), false);
	worklet.process([], [[left, right]]);
	assert(left.some(value => value > 0));
	assert(code.owns(0, replacement.token));
});

test('Preparing maximum-size ADPCM keeps existing SkyEmu audio and Capture running', async (t) => {
	const recorded = [];
	let preparing = false;
	const { chip, worklet } = endpoint(t, (left, right) => {
		if (preparing) recorded.push({ min: Math.min(...left), maxRight: Math.max(...right.map(Math.abs)) });
	});
	const timer = ndsTimerForFrequency(48000, 1).timer;
	const leftSample = new Uint8Array(32).fill(64);
	await chip.noteOn(0, 'C4', { mode: 'pcm8', bytes: leftSample, loop: true, timer, volume: 127, pan: 0 });
	const left = new Float32Array(128), right = new Float32Array(128);
	worklet.process([], [[left, right]]);
	await chip.startCapture(0, { format: 'pcm16', lengthWords: 32, timer });

	const bytes = new Uint8Array(NDS_MAX_SAMPLE_BYTES);
	new DataView(bytes.buffer).setInt16(0, 8192, true);
	preparing = true;
	const note = await chip.noteOn(2, 'C4', { mode: 'adpcm', bytes, loop: true, timer, volume: 127, pan: 127 });
	preparing = false;
	assert(recorded.length > 1, 'Long ADPCM preparation must yield across audio blocks');
	assert(recorded.every(({ min, maxRight }) => min > .1 && maxRight === 0),
		'The left note must continue uninterrupted while the new right note is being prepared');
	const capture = await chip.readCapture(0);
	assert.equal(capture.active, false);
	assert.equal(capture.recordedFrames, 64);
	const samples = new DataView(capture.bytes.buffer, capture.bytes.byteOffset, capture.bytes.byteLength);
	for (let byte = 0; byte < samples.byteLength; byte += 2)
		assert(samples.getInt16(byte, true) > 12000, 'Capture must continue to record the left note during preparation');
	assert(chip.owns(2, note.token));
	worklet.process([], [[left, right]]);
	assert(right.some((value) => value > .04), 'The prepared ADPCM should play on the right');

	await chip.noteOff(2, note.token);
	const release = [new Float32Array(512), new Float32Array(512)];
	worklet.process([], [release]);
	assert(release[1][0] > .04 && release[1][383] < .001);
	assert(release[1].slice(384).every((value) => value === 0), 'The ADPCM release must reach silence');
	assert(release[0].every((value) => value > .1), 'The other channel must keep playing during the release');
});

test('Stopping queued ADPCM owned by Code leaves the keyboard voice on the same channel', async (t) => {
	let renderedBlock;
	const { chip, worklet } = endpoint(t, () => renderedBlock?.());
	const keyboard = chip.forOwner('keyboard'), code = chip.forOwner('code');
	const original = await keyboard.noteOn(0, 'C4', { mode: 'pcm16', shape: 'sine', pan: 0 });
	const preparing = new Promise((resolve) => { renderedBlock = resolve; });
	const attack = assert.rejects(code.noteOn(0, 'A4', {
		mode: 'adpcm', bytes: new Uint8Array(NDS_MAX_SAMPLE_BYTES), loop: true, pan: 127,
	}), { name: 'AbortError' });
	await preparing;
	await code.stopOwned();
	await attack;

	const state = await keyboard.getState(0);
	assert.equal(state.token, original.token);
	assert(state.active && !state.releasing);
	assert(keyboard.owns(0, original.token));
	const left = new Float32Array(384), right = new Float32Array(384);
	worklet.process([], [[left, right]]);
	assert(left.some((value) => Math.abs(value) > .025));
	assert(right.every((value) => value === 0));

	const replacing = new Promise((resolve) => { renderedBlock = resolve; });
	const replacement = assert.rejects(code.noteOn(0, 'B4', {
		mode: 'adpcm', bytes: new Uint8Array(NDS_MAX_SAMPLE_BYTES), loop: true, pan: 127,
	}), { name: 'AbortError' });
	await replacing;
	assert.equal(await keyboard.noteOff(0, original.token), true);
	await code.stopOwned();
	await replacement;
	worklet.process([], [[left, right]]);
	assert.equal((await chip.getState(0)).active, false, 'Key-up during preparation must still release the sounding note');
});

test('DS worklet channel mix persists across note owners and physical register edits', async (t) => {
	const { chip, worklet } = endpoint(t);
	const keyboard = chip.forOwner('keyboard'), code = chip.forOwner('code');
	const note = await keyboard.noteOn(0, 'A4', { volume: 90, pan: 64 });
	const mix = { volume: .4, pan: -.25, muted: true };
	assert.deepEqual(await chip.setChannelMix(0, mix), mix);
	assert(keyboard.owns(0, note.token));
	const replacement = await code.noteOn(0, 'C4', { volume: 113, pan: 127 });
	assert(code.owns(0, replacement.token));
	assert.equal((await chip.getState(0)).volume, 113);
	assert.equal((await chip.getState(0)).pan, 127);
	assert.deepEqual(await chip.getChannelMix(0), mix);
	const left = new Float32Array(512), right = new Float32Array(512);
	worklet.process([], [[left, right]]);
	assert(right.every((value) => value === 0), 'An instrument write must not undo the software mute');
	await chip.setChannelMix(0, { muted: false });
	worklet.process([], [[left, right]]);
	assert(right.some((value) => value > .01), 'Unmuting must restore the held note in the audio output');
	const rows = await chip.getChannelMix();
	assert.equal(rows.length, 16);
	assert.deepEqual(rows[0], { ...mix, muted: false });
	assert.deepEqual(rows[1], { volume: 1, pan: 0, muted: false });
	await assert.rejects(chip.setChannelMix(16, { volume: .5 }), /DS channel/);
});

test('DS timed writes run on the exact output frame and merge with intervening channel edits', async (t) => {
	const { chip, worklet } = endpoint(t);
	const code = chip.forOwner('code');
	await code.configure(0, {
		mode: 'pcm8', bytes: new Uint8Array(32).fill(96), loop: true,
		timer: ndsTimerForFrequency(48000, 1).timer, volume: 96, pan: 0,
	});
	await code.prepareVoice(0);
	const capture = () => code.timedControl({ action: 'capture' });
	const before = await capture();
	const operations = buildNdsOperations(b => {
		b.keyOn(0);
		b.atSample(149).configure(0, { pan: 127 });
		b.atSeconds(149 / 44100).configure(0, { volume: 48 });
		b.atSample(257).keyOff(0);
	});
	const writes = compileNdsOperations(operations, before.state).slice(-3);
	const control = 0x04000400, gate = 0x80000000;
	assert.deepEqual(writes.map(({ register }) => register), [control, control, control]);
	assert.deepEqual(writes.map(({ value }) => value & 127), [96, 48, 48]);
	assert(writes.slice(0, 2).every(({ value }) => value & gate));
	assert.equal(writes[2].value & gate, 0);
	assert.equal((await capture()).state[0].control, before.state[0].control,
		'Compiling the same baseline must not write live registers');

	const accepted = await code.timedControl({
		action: 'schedule', owner: 'nds-test-timing', operations, options: { name: 'timing' },
	});
	await assert.rejects(code.timedControl({
		action: 'schedule', owner: 'nds-test-timing', operations, options: { name: 'timing', repeatSeconds: .001 },
	}), /repeat/i, 'Invalid replacement must leave the accepted schedule intact');
	await code.configure(0, { divider: 1 });
	const from = (await capture()).frame;
	const panFrame = accepted.startFrame - from + Math.round(149 / 44100 * 48000);
	const stopFrame = accepted.startFrame - from + Math.round(257 / 44100 * 48000);
	assert(panFrame > 0 && stopFrame > panFrame);
	const trace = [[], []];
	for (let start = 0; start < stopFrame + 128; start += 128) {
		const block = [new Float32Array(128), new Float32Array(128)];
		worklet.process([], [block]);
		block.forEach((side, index) => trace[index].push(...side));
	}
	const [left, right] = trace;
	assert(left.slice(panFrame - 30, panFrame).every(value => value > .02));
	assert(left.slice(panFrame).every(value => value === 0), 'Pan must change at the converted 149th sample');
	assert(right.slice(0, panFrame).every(value => value === 0));
	assert(right.slice(panFrame, stopFrame).every(value => value > .01));
	assert(right.slice(stopFrame).every(value => value === 0), 'Key Off must take effect at the exact output frame');
	const after = await capture();
	assert.equal(after.state[0].control & 0x37f, (1 << 8) | 48,
		'The write must retain the divider set after admission and apply the same-frame volume');
});

test('A pending DS scheduled release does not cut a keyboard note that took the channel', async (t) => {
	const { chip, worklet } = endpoint(t);
	const code = chip.forOwner('code'), keyboard = chip.forOwner('keyboard');
	await code.configure(8, { mode: 'pulse', timer: ndsTimerForFrequency(440, 8).timer });
	const operations = buildNdsOperations(b => {
		b.keyOn(8);
		b.atSample(1102).keyOff(8);
	});
	const receipt = await code.timedControl({
		action: 'schedule', owner: 'nds-test-ownership', operations, options: { name: 'ownership' },
	});
	const voice = () => chip.getState(8);
	const frame = async () => (await code.timedControl({ action: 'capture' })).frame;
	const block = [new Float32Array(128), new Float32Array(128)];
	const render = () => worklet.process([], [block]);
	for (let at = await frame(); at <= receipt.startFrame; at += block[0].length) render();
	assert((await voice()).active, 'The scheduled Key On should play');
	const held = await keyboard.noteOn(8, 'C5');
	const offFrame = receipt.startFrame + Math.round(1102 / 44100 * 48000);
	for (let at = await frame(); at <= offFrame + block[0].length; at += block[0].length) render();
	assert(keyboard.owns(8, held.token));
	assert((await voice()).active, 'The scheduled Key Off should keep the later keyboard note playing');
	assert(block[0].some(value => Math.abs(value) > .005));
});

test('DS keeps a newer pattern playing when another pattern releases or is cleared', async (t) => {
	const { chip, worklet } = endpoint(t);
	const code = chip.forOwner('code'), keyboard = chip.forOwner('keyboard');
	const owner = 'same-code-generation';
	await code.configure(8, { mode: 'pulse' });
	await code.configure(9, { mode: 'pulse' });
	const held = await keyboard.noteOn(9, 'C4');
	const older = buildNdsOperations(b => b.noteOn(8, 'A4').atSeconds(.01).keyOff(8));
	const newer = buildNdsOperations(b => b.atSeconds(.005).noteOn(8, 'A5'));
	await code.timedControl({ action: 'schedule', owner, operations: older, options: { name: 'older' } });
	await code.timedControl({ action: 'schedule', owner, operations: newer, options: { name: 'newer' } });
	worklet.process([], [[new Float32Array(768), new Float32Array(768)]]);
	assert((await code.getState(8)).active, 'The old Key Off must not release the newer reservation');
	assert.equal(await code.timedControl({ action: 'clear', owner, name: 'older' }), false);
	assert((await code.getState(8)).active);
	assert.equal(await code.timedControl({ action: 'clear', owner, name: 'newer' }), true);
	assert((await code.getState(8)).releasing, 'Canceling the current reservation uses the software release');
	assert(keyboard.owns(9, held.token));
});

test('DS timed Note On uses the prepared ADPCM sample and its root tuning', async (t) => {
	const { chip, worklet } = endpoint(t);
	const code = chip.forOwner('code');
	const { frames, ...sample } = makeNdsSample('adpcm', 'triangle');
	await code.configure(2, { ...sample, mode: 'adpcm', sampleRate: 32000, rootNote: 'A4', pan: 127 });
	const operations = buildNdsOperations(b => b.noteOn(2, 'A5'));
	const schedule = () => code.timedControl({ action: 'schedule', operations, options: { name: 'adpcm' } });
	await assert.rejects(schedule(), /prepare/i);
	await code.prepareVoice(2);
	const baseline = await code.timedControl({ action: 'capture' });
	const writes = compileNdsOperations(operations, baseline.state);
	const receipt = await schedule();
	const timer = ndsTimerForFrequency(64000, 1).timer;
	assert.equal(writes.find(({ register }) => register === 0x04000428).value & 0xffff, timer);
	const block = [new Float32Array(128), new Float32Array(128)];
	for (let at = baseline.frame; at <= receipt.startFrame + 128; at += block[0].length) worklet.process([], [block]);
	const state = await code.getState(2);
	assert.deepEqual([state.playingMode, state.timer, state.rootNote, state.sampleRate], ['adpcm', timer, 'A4', 32000]);
	assert(block[0].every(value => value === 0) && block[1].some(value => Math.abs(value) > .025),
		'The prepared ADPCM sample should reach the right output channel');
});

test('Every channel can prepare a long ADPCM replacement while the other channels play', async (t) => {
	const { chip, worklet } = endpoint(t);
	async function playAll(pan, predictor) {
		const bytes = new Uint8Array(NDS_MAX_SAMPLE_BYTES);
		new DataView(bytes.buffer).setInt16(0, predictor, true);
		return Promise.all(Array.from({ length: 16 }, (_, channel) => chip.noteOn(channel, 'C4', {
			mode: 'adpcm', bytes, loop: true, pan, timer: 65535, volume: 24,
		})));
	}
	await playAll(0, 4096);
	const notes = await playAll(127, 8192);
	assert.equal(notes.length, 16);
	for (const { channel, token } of notes) assert(chip.owns(channel, token));
	const left = new Float32Array(128), right = new Float32Array(128);
	worklet.process([], [[left, right]]);
	assert(left.every(value => value === 0));
	assert(right.some(value => value > .1));
});

// No browser, AudioContext or physical output: exercise lease and note lifetimes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createAswanSongAudition } from './song_audition.js';
import { createDefaultPreset, readPreset } from './preset.js';
const deferred = () => {
	let resolve, reject;
	const promise = new Promise((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return { promise, resolve, reject };
};
const turn = () => new Promise((resolve) => setImmediate(resolve));
async function until(predicate) {
	for (let i = 0; i < 100; i++) {
		if (predicate()) return;
		await turn();
	}
	throw Error('Missing audition gate');
}
const aborted = () => new DOMException('Old audition token', 'AbortError');
function target(key = 'A', channel = 0) {
	const preset = createDefaultPreset();
	preset.name = key;
	return { key, preset, channel, frequency: 123.456, referenceNote: 60, clock: 3072000 };
}
function fixture({ loadGate = null, readyGate = null, failLoad = false, initialPitch = 0 } = {}) {
	const events = [],
		states = [],
		errors = [];
	let ensureCalls = 0,
		loads = 0,
		current = null;
	const author = { unchanged: true },
		song = { unchanged: true };
	const engine = {
		author,
		song,
		async loadAudition(preset, options) {
			const item = {
				token: options.token,
				preset: readPreset(preset),
				notes: new Map(),
				pitch: initialPitch,
				stopped: false,
				options: structuredClone(options),
			};
			current = item;
			events.push(['load', structuredClone(preset), structuredClone(options)]);
			loads++;
			if (loads === 1 && loadGate) await loadGate.promise;
			if (item.stopped || current !== item) throw aborted();
			if (loads === 1 && failLoad) {
				failLoad = false;
				throw Error('Load failed');
			}
			return { token: item.token, state: { preset: readPreset(item.preset) } };
		},
		async invokeAudition(token, method, args) {
			if (current?.token !== token || current.stopped) throw aborted();
			events.push(['invoke', token, method, structuredClone(args)]);
			if (method === 'noteOn') {
				current.notes.clear();
				current.notes.set(args[0], args[1]);
			}
			if (method === 'noteOff') current.notes.delete(args[0]);
			if (method === 'setPreset') current.preset = readPreset(args[0]);
			if (method === 'setPitch') current.pitch = args[0];
			if (method === 'read') return { preset: readPreset(current.preset) };
			return true;
		},
		async stopAudition(token) {
			events.push(['stop', token]);
			if (current?.token !== token) return false;
			current.stopped = true;
			current.notes.clear();
			return true;
		},
	};
	let audio = engine;
	const controller = createAswanSongAudition({
		ensureAudio: async () => {
			ensureCalls++;
			if (readyGate) await readyGate.promise;
		},
		getAudio: () => audio,
		onState: (s) => states.push(s),
		onError: (e) => errors.push(e),
	});
	return {
		controller,
		engine,
		events,
		states,
		errors,
		get ensureCalls() {
			return ensureCalls;
		},
		get loads() {
			return loads;
		},
		get current() {
			return current;
		},
		replaceAudio(value) {
			audio = value;
		},
	};
}

test('selection is detached and lazy; preview borrows the same engine without touching Auto or song', async () => {
	const f = fixture(),
		selected = target();
	await f.controller.setSelection(selected);
	selected.preset.wave[0] = 15;
	assert.equal(f.ensureCalls, 0);
	assert(f.controller.read().hasSelection);
	const result = await f.controller.noteOn('one', 60);
	assert.equal(result.channel, 0);
	assert.equal(f.current.preset.wave[0], 8);
	assert.equal(f.current.options.frequencyHz, 123.456);
	assert.equal(f.current.options.referenceMidi, 60);
	assert.equal(f.current.options.clock, 3072000);
	assert.equal(f.controller.read().heldCount, 1);
	assert.equal(f.controller.read().token, f.current.token);
	assert.deepEqual(f.engine.author, { unchanged: true });
	assert.deepEqual(f.engine.song, { unchanged: true });
	assert.equal(await f.controller.noteOff('one'), true);
	assert.equal(f.current.notes.size, 0);
	await f.controller.dispose();
});

test('same paused target edits retain held voice and apply only to its private preview', async () => {
	const f = fixture(),
		value = target('frame', 2);
	value.preset.sweep = { enabled: true, step: -3, time: 8 };
	await f.controller.setSelection(value);
	await f.controller.noteOn('held', 67);
	const token = f.current.token,
		edited = readPreset(value.preset);
	edited.wave[0] = 1;
	edited.left = 4;
	edited.envelope.release = 0.3;
	await f.controller.edit(edited);
	assert.equal(f.loads, 1);
	assert.equal(f.current.token, token);
	assert(f.current.notes.has('held'));
	assert.equal(f.current.preset.wave[0], 1);
	assert.equal(f.current.preset.envelope.release, 0.3);
	assert(!f.events.some((e) => e[0] === 'invoke' && e[2] === 'noteOff'));
	assert.deepEqual(f.engine.author, { unchanged: true });
	await f.controller.dispose();
});

test('a late A load cannot resurrect after A→B→A, and its key-up cannot stop the new A', async () => {
	const gate = deferred(),
		f = fixture({ loadGate: gate });
	await f.controller.setSelection(target());
	const old = f.controller.noteOn('old', 60);
	await until(() => f.loads === 1);
	const oldToken = f.current.token;
	await f.controller.setSelection(target('B', 1));
	await f.controller.setSelection(target());
	const fresh = f.controller.noteOn('fresh', 64);
	gate.resolve();
	assert.equal(await old, null);
	await fresh;
	assert.equal(f.loads, 2);
	assert.notEqual(f.current.token, oldToken);
	assert(f.current.notes.has('fresh'));
	assert.equal(await f.controller.noteOff('old'), false);
	assert(f.current.notes.has('fresh'));
	assert(!f.events.some((e) => e[0] === 'invoke' && e[2] === 'noteOn' && e[3][0] === 'old'));
	await f.controller.dispose();
});

test('keyup during pending load cannot sound later, while a subsequent key can reuse the prepared preview', async () => {
	const gate = deferred(),
		f = fixture({ loadGate: gate });
	await f.controller.setSelection(target());
	const on = f.controller.noteOn('released', 60);
	await until(() => f.loads === 1);
	assert(f.controller.read().loading);
	const off = f.controller.noteOff('released');
	gate.resolve();
	assert.equal(await on, null);
	await off;
	assert(!f.events.some((e) => e[0] === 'invoke' && e[2] === 'noteOn'));
	assert.equal(f.controller.read().heldCount, 0);
	await f.controller.noteOn('next', 62);
	assert.equal(f.loads, 1);
	assert(f.current.notes.has('next'));
	await f.controller.dispose();
});

test('a stolen key-up never releases the newer owner on the selected physical channel', async () => {
	const f = fixture();
	await f.controller.setSelection(target());
	await f.controller.noteOn('old', 60);
	const result = await f.controller.noteOn('new', 64);
	assert.equal(result.stolenId, 'old');
	assert.equal(await f.controller.noteOff('old'), false);
	assert(f.current.notes.has('new'));
	assert.equal(f.controller.read().heldCount, 1);
	await f.controller.noteOff('new');
	assert.equal(f.current.notes.size, 0);
	await f.controller.dispose();
});

test('selection retirement before AudioContext readiness never loads the stale channel', async () => {
	const gate = deferred(),
		f = fixture({ readyGate: gate });
	await f.controller.setSelection(target());
	const old = f.controller.noteOn('old', 60);
	await until(() => f.ensureCalls === 1);
	await f.controller.setSelection(null);
	gate.resolve();
	assert.equal(await old, null);
	assert.equal(f.loads, 0);
	assert.equal(f.controller.read().hasSelection, false);
	await f.controller.dispose();
});

test('parameter edits during pending load are synchronized before the first note without reloading', async () => {
	const gate = deferred(),
		f = fixture({ loadGate: gate });
	await f.controller.setSelection(target());
	const on = f.controller.noteOn('held', 60);
	await until(() => f.loads === 1);
	const next = target();
	next.preset.left = 2;
	next.preset.wave[4] = 1;
	const edit = f.controller.setSelection(next);
	gate.resolve();
	await on;
	await edit;
	assert.equal(f.loads, 1);
	assert.equal(f.current.preset.left, 2);
	assert(
		f.events.findIndex((e) => e[0] === 'invoke' && e[2] === 'setPreset') <
			f.events.findIndex((e) => e[0] === 'invoke' && e[2] === 'noteOn'),
	);
	assert(f.current.notes.has('held'));
	await f.controller.dispose();
});

test('pending-load pitch follows the latest wheel value and a new target resets it', async () => {
	const gate = deferred(),
		f = fixture({ loadGate: gate });
	await f.controller.setSelection(target());
	const on = f.controller.noteOn('held', 60);
	await until(() => f.loads === 1);
	const a = f.controller.setPitch(-1),
		b = f.controller.setPitch(1.5);
	gate.resolve();
	await on;
	await a;
	await b;
	assert.equal(f.current.pitch, 1.5);
	await f.controller.setSelection(target('B'));
	assert.equal(f.controller.read().pitch, 0);
	await f.controller.noteOn('B', 60);
	assert.equal(f.current.pitch, 0);
	await f.controller.dispose();
});

test('Stop invalidates pending notes and tokens but retains selection for replay after blur', async () => {
	const f = fixture();
	await f.controller.setSelection(target());
	await f.controller.noteOn('one', 60);
	const old = f.current.token;
	await f.controller.stop();
	assert.equal(f.controller.read().heldCount, 0);
	assert(f.controller.read().hasSelection);
	await f.controller.noteOn('two', 60);
	assert.notEqual(f.current.token, old);
	assert(f.current.notes.has('two'));
	await f.controller.dispose();
});

test('invalid selection and transient DAC sample rejection leave the last good target intact', async () => {
	const f = fixture();
	await f.controller.setSelection(target());
	const pcm = target('PCM', 1);
	pcm.preset.source = 'pcm';
	assert.throws(() => f.controller.setSelection(pcm), /transient Voice PCM/);
	for (const value of [
		{ ...target(), frequency: 0 },
		{ ...target(), channel: 4 },
		{ ...target(), referenceNote: 200 },
		{ ...target(), clock: 0 },
	])
		assert.throws(() => f.controller.setSelection(value));
	assert.equal(f.controller.read().key, 'A');
	assert.equal(f.ensureCalls, 0);
	await f.controller.dispose();
});

test('a load failure is reported, preserves the selection, and allows retry with a fresh token', async () => {
	const f = fixture({ failLoad: true });
	await f.controller.setSelection(target());
	await assert.rejects(f.controller.noteOn('one', 60), /Load failed/);
	assert.equal(f.errors.length, 1);
	assert(f.controller.read().hasSelection);
	assert.equal(f.controller.read().heldCount, 0);
	await f.controller.noteOn('two', 60);
	assert(f.current.notes.has('two'));
	assert.equal(f.loads, 2);
	await f.controller.dispose();
});

test('dispose closes the controller synchronously while pending preparation is still retiring', async () => {
	const gate = deferred(),
		f = fixture({ loadGate: gate });
	await f.controller.setSelection(target());
	const on = f.controller.noteOn('old', 60);
	await until(() => f.loads === 1);
	const disposal = f.controller.dispose();
	await assert.rejects(f.controller.noteOn('new', 60), /disposed/);
	gate.resolve();
	await disposal;
	assert.equal(await on, null);
	assert.equal(f.controller.read().state, 'disposed');
	assert(!f.events.some((e) => e[0] === 'invoke' && e[2] === 'noteOn'));
});

test('source clock is forwarded without silently pretending a nonstandard song is a normal clock', async () => {
	const f = fixture();
	await f.controller.setSelection({ ...target(), clock: 4000000 });
	await f.controller.noteOn('one', 60);
	assert.equal(f.current.options.clock, 4000000);
	await f.controller.dispose();
});

test('an externally invalidated preview token is retired so the next key can prepare again', async () => {
	const f = fixture();
	await f.controller.setSelection(target());
	await f.controller.noteOn('first', 60);
	await f.controller.noteOff('first');
	f.current.stopped = true;
	assert.equal(await f.controller.noteOn('lost', 62), null);
	await f.controller.noteOn('retry', 64);
	assert.equal(f.loads, 2);
	assert(f.current.notes.has('retry'));
	await f.controller.dispose();
});

test('a fresh zero pitch overrides any inherited author wheel value before the first key', async () => {
	const f = fixture({ initialPitch: 1.5 });
	await f.controller.setSelection(target());
	await f.controller.noteOn('one', 60);
	assert.equal(f.current.pitch, 0);
	const pitchAt = f.events.findIndex(
			(e) => e[0] === 'invoke' && e[2] === 'setPitch' && e[3][0] === 0,
		),
		onAt = f.events.findIndex((e) => e[0] === 'invoke' && e[2] === 'noteOn');
	assert(pitchAt >= 0 && pitchAt < onAt);
	await f.controller.dispose();
});

test('changing Wave to Noise retires the held lease even when key and physical CH stay the same', async () => {
	const f = fixture(),
		wave = target('same', 3);
	await f.controller.setSelection(wave);
	await f.controller.noteOn('wave', 60);
	const old = f.current.token;
	const noise = { ...wave, preset: readPreset(wave.preset) };
	noise.preset.source = 'noise';
	await f.controller.setSelection(noise);
	assert.equal(f.controller.read().heldCount, 0);
	assert.equal(await f.controller.noteOff('wave'), false);
	await f.controller.noteOn('noise', 60);
	assert.notEqual(f.current.token, old);
	assert.equal(f.current.preset.source, 'noise');
	await f.controller.dispose();
});

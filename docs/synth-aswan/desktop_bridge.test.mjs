// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('./synth.js', import.meta.url), 'utf8');
const tail = source.slice(source.indexOf('// Desktop adapters reroute only'));
assert(tail.startsWith('// Desktop adapters reroute only'));
const keyboardSource = source.slice(
	source.indexOf('function press('),
	source.indexOf('function release('),
);
const songSource = source.slice(
	source.indexOf('async function playSong('),
	source.indexOf("$('aswanSongPlayButton').addEventListener"),
);
const deferred = () => {
	let resolve;
	const promise = new Promise((done) => {
		resolve = done;
	});
	return { promise, resolve };
};
const tick = async () => {
	for (let index = 0; index < 5; index++) await Promise.resolve();
};

function fixture({
	protocol = 'tauri:',
	hostname = 'localhost',
	top = true,
	ipc = true,
	audioReady = true,
} = {}) {
	const calls = [],
		events = [],
		notes = new Map();
	const window = { dispatchEvent: (event) => events.push(event.type) };
	window.top = top ? window : {};
	if (ipc)
		window.__TAURI_INTERNALS__ = {
			invoke() {
				throw Error('The bridge itself does not invoke desktop IPC');
			},
		};
	const host = {
		context: { sampleRate: 48000 },
		outputNode: { name: 'final-master' },
		async command(method, args = []) {
			calls.push(['command', method, args]);
		},
	};
	let queue = Promise.resolve();
	const preset = { source: 'pcm', pcm: { data: 'AAAA', rootNote: 60 }, left: 7, right: 15 };
	const context = vm.createContext({
		window,
		location: { protocol, hostname },
		DOMException,
		Event: class {
			constructor(type) {
				this.type = type;
			}
		},
		disposed: false,
		switchingAudioOutput: false,
		selectionGeneration: 3,
		authoredPitch: 2,
		preset,
		physical: [preset, preset, preset, preset],
		target: 1,
		notes,
		audio: audioReady ? host : null,
		ensureAudio: async () => {
			calls.push(['ensureAudio']);
			return host;
		},
		songPlayer: {
			async stop() {
				calls.push(['song.stop']);
			},
		},
		codeHost: {
			async stop() {
				calls.push(['code.stop']);
			},
		},
		async stopKeyboard() {
			calls.push(['keys.stop']);
			notes.clear();
		},
		updatePitchUi: (value) => calls.push(['pitchUi', value]),
		syncActivity: () => calls.push(['activity']),
		enqueue(action) {
			const task = queue.then(action);
			queue = task.catch(() => {});
			return task;
		},
	});
	vm.runInContext(tail, context, { filename: 'synth.js:desktop' });
	return {
		context,
		window,
		host,
		preset,
		notes,
		calls,
		events,
		getQueue: () => queue,
		blockQueue(promise) {
			queue = promise;
		},
	};
}

test('the frozen desktop bridge installs passively only in the top-level packaged IPC origin', async () => {
	for (const [protocol, hostname] of [
		['tauri:', 'localhost'],
		['http:', 'tauri.localhost'],
		['https:', 'tauri.localhost'],
	]) {
		const f = fixture({ protocol, hostname });
		assert(Object.isFrozen(f.window.tetoricaSynthAudio));
		assert.deepEqual(f.events, ['tetorica-synth-ready']);
		assert.deepEqual(f.calls, [], 'installation must not initialize audio or invoke IPC');
		const ready = await f.window.tetoricaSynthAudio.ensureReady();
		assert.equal(ready.context, f.host.context);
		assert.equal(
			ready.output,
			f.host.outputNode,
			'Native output taps the existing final Master, including song audio',
		);
	}
	for (const options of [
		{ protocol: 'https:', hostname: 'example.com' },
		{ protocol: 'http:', hostname: 'localhost' },
		{ protocol: 'tauri:', hostname: 'other' },
		{ protocol: 'file:', hostname: '' },
		{ top: false },
		{ ipc: false },
	]) {
		const f = fixture(options);
		assert.equal(f.window.tetoricaSynthAudio, undefined);
		assert.deepEqual(f.events, []);
		assert.deepEqual(f.calls, []);
	}
});

test('switching retires song, Code and preview keys before draining the queue and resetting native Pitch', async () => {
	const f = fixture(),
		code = deferred(),
		queue = deferred();
	f.notes.set('held', { id: 'preview', owner: 'audition' });
	f.context.codeHost.stop = async () => {
		f.calls.push(['code.stop']);
		await code.promise;
	};
	f.blockQueue(queue.promise);
	const bridge = f.window.tetoricaSynthAudio;
	bridge.setSwitching(true);
	const stopping = bridge.stopPlayback();
	await tick();
	assert.equal(f.context.authoredPitch, 0);
	assert.equal(f.context.selectionGeneration, 4);
	assert.deepEqual(
		f.calls.map((entry) => entry[0]),
		['pitchUi', 'song.stop', 'code.stop'],
	);
	code.resolve();
	await tick();
	assert.equal(f.notes.size, 0);
	assert.equal(
		f.calls.some((entry) => entry[0] === 'command'),
		false,
		'the existing queue must finish before the raw hardware stop',
	);
	queue.resolve();
	assert.equal(
		await stopping,
		true,
		'stopPlayback must not enqueue itself around nested queue operations',
	);
	assert.deepEqual(
		f.calls.filter((entry) => entry[0] === 'command').map((entry) => [entry[1], ...entry[2]]),
		[['stop'], ['setPitch', 0]],
	);
	assert.equal(f.context.preset, f.preset);
	assert.equal(f.context.physical[1], f.preset);
	assert.equal(f.context.target, 1, 'output changes keep the selected physical channel');
	assert.equal(f.context.switchingAudioOutput, true);
	bridge.setSwitching(false);
	assert.equal(f.context.switchingAudioOutput, false);
});

test('stopping before Enable does not create an AudioContext; a closed bridge cannot reopen one', async () => {
	const f = fixture({ audioReady: false }),
		bridge = f.window.tetoricaSynthAudio;
	await bridge.stopPlayback();
	assert.equal(
		f.calls.some((entry) => entry[0] === 'ensureAudio' || entry[0] === 'command'),
		false,
	);
	f.calls.length = 0;
	f.context.disposed = true;
	await assert.rejects(bridge.ensureReady(), { name: 'AbortError' });
	assert.equal(await bridge.stopPlayback(), false);
	assert.deepEqual(f.calls, []);
});

function keyboard(f) {
	f.main = {inert: false};
	Object.assign(f.context, {
		$: id => { assert.equal(id, 'aswanSynthMain'); return f.main; },
		serial: 0,
		songState: { busy: false },
		codeHost: { getState: () => ({ busy: false }) },
		liveSong: () => false,
		visualizer: { wake() {} },
		report(error) {
			throw error;
		},
	});
	vm.runInContext(keyboardSource, f.context, { filename: 'synth.js:keyboard' });
}
test('new keys are ignored while switching, and a queued key cannot start after output readiness was awaited', async () => {
	const f = fixture();
	keyboard(f);
	f.window.tetoricaSynthAudio.setSwitching(true);
	f.context.press('new', { key: 'a', midi: 60 });
	assert.equal(f.notes.size, 0);
	assert.equal(f.calls.length, 0);
	f.window.tetoricaSynthAudio.setSwitching(false);
	const opening = deferred();
	f.context.ensureAudio = () => opening.promise;
	f.context.press('pending', { key: 'a', midi: 60 });
	await tick();
	assert.equal(f.notes.size, 1);
	f.window.tetoricaSynthAudio.setSwitching(true);
	opening.resolve(f.host);
	await f.getQueue();
	assert.equal(f.notes.size, 0);
	assert.equal(
		f.calls.some((entry) => entry[0] === 'command'),
		false,
	);
});

test('queued song keys and private audition callbacks lose their lease when output switching starts', async () => {
	const f = fixture();
	keyboard(f);
	const queue = deferred();
	f.blockQueue(queue.promise);
	f.context.liveSong = () => true;
	f.context.songState = { busy: false, playing: true };
	f.context.playingSelection = () => ({ channel: 1, session: 3, epoch: 5, key: 'song3:1' });
	f.context.songPlayer.getManualState = () => ({ epoch: 5 });
	f.context.songPlayer.manualNoteOn = () => {
		throw Error('A retired song key must not start');
	};
	f.context.press('pending-song', { key: 'a', midi: 60 });
	f.window.tetoricaSynthAudio.setSwitching(true);
	queue.resolve();
	await f.getQueue();
	assert.equal(f.notes.size, 0);
	f.window.tetoricaSynthAudio.setSwitching(false);
	f.context.songState = { busy: false, paused: true };
	f.context.pausedSelection = () => ({ key: 'paused3:1' });
	let current;
	f.context.audition = {
		async noteOn(id, midi, options) {
			current = options.isCurrent;
			return false;
		},
	};
	f.context.press('pending-preview', { key: 's', midi: 62 });
	f.window.tetoricaSynthAudio.setSwitching(true);
	assert.equal(current(), false);
	await tick();
	assert.equal(f.notes.size, 0);
});

test('a pending song load or Resume cannot restart playback after output switching begins', async () => {
	for (const paused of [false, true]) {
		const f = fixture(),
			wait = deferred();
		Object.assign(f.context, {
			songState: { paused, playing: false },
			queue: paused ? wait.promise : Promise.resolve(),
			selectedSongPath: '/vgm/test.vgm',
			loadedSongKey: '',
		});
		Object.assign(f.context.codeHost, {
			project: { fs: { get: () => ({ data: new Uint8Array([1]), revision: 2 }) } },
			files: { workspaceId: 'test' },
		});
		Object.assign(f.context.songPlayer, {
			getEditSession: () => 9,
			async load() {
				await wait.promise;
			},
			async play() {
				throw Error('Stale load started playback');
			},
			async resume() {
				throw Error('Stale Resume started playback');
			},
		});
		vm.runInContext(songSource, f.context, { filename: 'synth.js:song' });
		const pending = f.context.playSong();
		await tick();
		f.window.tetoricaSynthAudio.setSwitching(true);
		wait.resolve();
		await assert.rejects(pending, /audio output change/);
		assert.equal(
			f.calls.some((entry) => entry[0] === 'keys.stop'),
			false,
		);
	}
});


test('workspace replacement blocks new performance keys until the main controls are unlocked', async () => {
	const f = fixture(); keyboard(f);
	f.main.inert = true;
	f.context.press('during-new', {key: 'a', midi: 60});
	await f.getQueue();
	assert.equal(f.notes.size, 0);
	assert.equal(f.calls.some(call => call[0] === 'command'), false);
	f.main.inert = false;
	f.context.press('after-new', {key: 'a', midi: 60});
	await f.getQueue();
	assert.equal(f.notes.size, 1);
	assert(f.calls.some(call => call[0] === 'command' && call[1] === 'noteOn'));
});

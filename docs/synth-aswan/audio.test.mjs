import test from 'node:test';
import assert from 'node:assert/strict';
import { createAudio, ASWAN_SYNTH_BALANCE } from './audio.js';
import { createDefaultPreset } from './preset.js';
const turn = () => new Promise((resolve) => setImmediate(resolve));
function setup(t) {
	const saved = Object.fromEntries(
			['AudioContext', 'AudioWorkletNode', 'fetch'].map((key) => [key, globalThis[key]]),
		),
		f = { contexts: [], worklets: [], messages: [], held: [], hold: null, errors: [] };
	class Node {
		constructor(context) {
			this.context = context;
			this.edges = new Set();
			this.gain = {
				value: 1,
				cancelScheduledValues() {},
				setValueAtTime(value) {
					this.value = value;
				},
				linearRampToValueAtTime(value) {
					this.value = value;
				},
			};
		}
		connect(target) {
			this.edges.add(target);
		}
		disconnect() {
			this.edges.clear();
		}
	}
	globalThis.AudioContext = class {
		constructor() {
			this.state = 'suspended';
			this.currentTime = 0;
			this.listeners = new Set();
			this.destination = new Node(this);
			this.audioWorklet = { addModule: async () => {} };
			f.contexts.push(this);
		}
		async resume() {
			this.state = 'running';
		}
		async close() {
			this.state = 'closed';
			for (const listener of this.listeners) listener();
		}
		createGain() {
			return new Node(this);
		}
		addEventListener(_e, fn) {
			this.listeners.add(fn);
		}
		removeEventListener(_e, fn) {
			this.listeners.delete(fn);
		}
	};
	globalThis.AudioWorkletNode = class extends Node {
		constructor(context) {
			super(context);
			this.session = 0;
			this.closed = false;
			this.port = {
				onmessage: null,
				postMessage: (message) => {
					f.messages.push(message);
					if (message.id === undefined) return;
					const answer = () =>
						queueMicrotask(() =>
							this.port.onmessage?.({
								data: {
									id: message.id,
									value:
										message.method === 'beginCode'
											? {
													session: ++this.session,
													clock: 3072000,
													channels: 4,
												}
											: message.method === 'loadAudition'
												? { token: message.args[1].token, state: {} }
												: true,
								},
							}),
						);
					if (f.hold === message.method) f.held.push(answer);
					else answer();
				},
				close: () => (this.closed = true),
			};
			f.worklets.push(this);
			queueMicrotask(() => this.port.onmessage?.({ data: { ready: true } }));
		}
	};
	globalThis.fetch = async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) });
	f.release = () => {
		f.hold = null;
		for (const answer of f.held.splice(0)) answer();
	};
	t.after(() => {
		for (const [key, value] of Object.entries(saved))
			if (value === undefined) delete globalThis[key];
			else globalThis[key] = value;
	});
	return f;
}
test('ASWAN host shares one Context and applies absolute chip calibration once to native and song paths', async (t) => {
	const f = setup(t),
		audio = await createAudio({ onError: (error) => f.errors.push(error) });
	t.after(() => audio.dispose());
	assert.equal(f.contexts.length, 1);
	assert.equal(audio.codeInputNode.gain.value, ASWAN_SYNTH_BALANCE);
	assert.equal(audio.songInputNode.gain.value, ASWAN_SYNTH_BALANCE);
	assert.equal(audio.outputNode.gain.value, 0.6);
	assert(f.worklets[0].edges.has(audio.codeInputNode));
	assert(audio.codeInputNode.edges.has(audio.codeOutputNode));
	assert(audio.codeOutputNode.edges.has(audio.outputNode));
	assert(audio.songInputNode.edges.has(audio.outputNode));
	audio.setChipVolume(0.5);
	audio.setVolume(1.2);
	assert.equal(audio.songInputNode.gain.value, 0.5);
	assert.equal(audio.codeInputNode.gain.value, 0.5);
	assert.equal(audio.outputNode.gain.value, 1.2);
	await audio.setChannelEnabled(3, false);
	assert(
		f.messages.some(
			(m) => m.method === 'setChannelEnabled' && m.args[0] === 3 && m.args[1] === false,
		),
	);
	const client = await audio.getAswanClient();
	assert.equal(await audio.getAswanClient(), client);
	await client.noteOn(0, 'C4');
	assert.throws(() => audio.command('stop', [true]));
	assert(client.isCurrent());
	await audio.stopCode(client);
	assert.throws(() => client.noteOff(0), { name: 'AbortError' });
	const fresh = await audio.getAswanClient();
	assert.equal(await audio.stopCode(client), false);
	assert(fresh.isCurrent());
	await fresh.dispose();
	assert.equal(audio.context.state, 'running');
	assert.equal(f.errors.length, 0);
});
test('stopped pending ASWAN Code startup cannot escape ownership or overtake the next Run', async (t) => {
	const f = setup(t),
		audio = await createAudio();
	t.after(() => audio.dispose());
	f.hold = 'beginCode';
	const pending = audio.getAswanClient(),
		rejected = assert.rejects(pending, { name: 'AbortError' });
	await turn();
	const stop = audio.stopCode(),
		fresh = audio.getAswanClient();
	await turn();
	assert.equal(f.messages.filter((m) => m.method === 'beginCode').length, 1);
	f.release();
	await rejected;
	await stop;
	assert((await fresh).isCurrent());
	assert.deepEqual(
		f.messages.filter((m) => ['beginCode', 'endCode'].includes(m.method)).map((m) => m.method),
		['beginCode', 'endCode', 'beginCode'],
	);
});
test('ASWAN processor failure invalidates clients, rejects pending RPCs and closes its Context', async (t) => {
	const f = setup(t),
		audio = await createAudio({ onError: (error) => f.errors.push(error) }),
		client = await audio.getAswanClient();
	f.hold = 'code';
	const result = client.noteOn(0, 60),
		rejected = assert.rejects(result, /processor failed/);
	f.worklets[0].onprocessorerror();
	await rejected;
	await turn();
	assert.equal(f.errors.length, 1);
	assert.equal(audio.context.state, 'closed');
	assert(f.worklets[0].closed);
	assert.throws(() => client.getState(), { name: 'AbortError' });
	await audio.dispose();
});
test('private audition facade shares Context / processor and fences pending load, ABA selections and stale Stop', async (t) => {
	const f = setup(t),
		audio = await createAudio(),
		preset = createDefaultPreset();
	t.after(() => audio.dispose());
	const a = await audio.loadAudition(preset, { token: 'A', channel: 2, frequencyHz: 750 });
	assert.equal(a.token, 'A');
	await audio.invokeAudition('A', 'noteOn', ['key', 60]);
	assert.equal(f.contexts.length, 1);
	assert.equal(f.worklets.length, 1);
	const invalid = { ...preset, source: 'pcm' };
	await assert.rejects(
		audio.loadAudition(invalid, { token: 'invalid', channel: 1 }),
		/frozen Voice/,
	);
	await audio.invokeAudition('A', 'read', []);
	f.hold = 'loadAudition';
	const pending = audio.loadAudition(preset, { token: 'B', channel: 0 }),
		rejected = assert.rejects(pending, { name: 'AbortError' });
	await turn();
	const stopped = audio.stopAudition('B');
	f.release();
	await rejected;
	await stopped;
	await assert.rejects(audio.invokeAudition('B', 'noteOn', ['old', 60]), { name: 'AbortError' });
	await audio.loadAudition(preset, { token: 'new-A', channel: 0 });
	assert.equal(await audio.stopAudition('A'), false);
	await audio.invokeAudition('new-A', 'noteOn', ['new', 60]);
	const before = f.messages.length;
	await audio.getAswanClient();
	await assert.rejects(audio.invokeAudition('new-A', 'noteOff', ['new']), { name: 'AbortError' });
	assert(f.messages.slice(before).some((message) => message.method === 'beginCode'));
});
test('a delayed audition edit reply cannot escape a newer load and global Stop clears its lease', async (t) => {
	const f = setup(t),
		audio = await createAudio(),
		preset = createDefaultPreset();
	t.after(() => audio.dispose());
	await audio.loadAudition(preset, { token: 'old', channel: 0 });
	f.hold = 'invokeAudition';
	const pending = audio.invokeAudition('old', 'setPreset', [preset]),
		rejected = assert.rejects(pending, { name: 'AbortError' });
	await turn();
	await audio.loadAudition(preset, { token: 'new', channel: 0 });
	f.release();
	await rejected;
	await audio.invokeAudition('new', 'read', []);
	await audio.command('stop');
	await assert.rejects(audio.readAudition('new'), { name: 'AbortError' });
});

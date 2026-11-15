import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import factory from '../generated/wonderswan_wasm.js';
import { WonderSwanAudioEngine } from '../js/wonderswanaudioengine.js';
import { AswanInstrument } from './instrument.js';
import { validateAswanCommand } from './code_endpoint.js';
const wasmBinary = await readFile(new URL('../generated/wonderswan_wasm.wasm', import.meta.url)),
	source = await readFile(new URL('./processor.js', import.meta.url), 'utf8');
async function make(t, rate) {
	let Class;
	const messages = [];
	vm.runInNewContext(source.replace(/^import .*;\n/gm, ''), {
		factory,
		WonderSwanAudioEngine,
		AswanInstrument,
		validateAswanCommand,
		sampleRate: rate,
		AudioWorkletProcessor: class {
			constructor() {
				this.port = { postMessage: (message) => messages.push(message) };
			}
		},
		registerProcessor(name, value) {
			assert.equal(name, 'tetorica-aswan-synth');
			Class = value;
		},
	});
	const p = new Class({ processorOptions: { wasmBinary } });
	await p.ready;
	assert(messages.some((message) => message.ready));
	t.after(() => p.port.onmessage({ data: { method: 'dispose' } }));
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
		render(frames) {
			const left = new Float32Array(frames),
				right = left.slice();
			p.process([], [[left, right]]);
			return { left, right };
		},
	};
}
test('actual ASWAN Worklet handles keyboard, presets, physical mute, Code and exact Stop at every host rate', async (t) => {
	for (const rate of [44100, 48000, 96000]) {
		const f = await make(t, rate),
			preset = (await f.command('read')).preset;
		await f.command('noteOn', ['held', 69]);
		assert(f.render(1024).left.some((v) => Math.abs(v) > 0.01));
		const { session } = await f.command('beginCode');
		await f.command('code', [session, 'noteOn', [1, 'C4']]);
		preset.wave.fill(15);
		await f.command('setPreset', [preset, 0]);
		assert.equal((await f.command('read')).codeActive, true);
		assert((await f.command('read')).channels[0].gate);
		await f.command('setChannelEnabled', [1, false]);
		assert.equal((await f.command('read')).channels[1].enabled, false);
		await f.command('stop');
		assert(f.render(128).left.every((v) => v === 0));
		f.p.port.onmessage({ data: { id: 77, method: 'code', args: [session, 'keyOff', [1]] } });
		await Promise.resolve();
		assert.equal(f.messages.at(-1).name, 'AbortError');
	}
});
test('malformed host commands do not stop a running native owner or overwrite its PCM', async (t) => {
	const f = await make(t, 48000);
	await f.command('noteOn', ['held', 69]);
	const before = await f.command('read');
	for (const [method, args] of [
		['stop', [true]],
		['setPreset', []],
		['noteOff', []],
		['setChannelEnabled', [0, 'false']],
	]) {
		f.p.port.onmessage({ data: { id: 88, method, args } });
		await Promise.resolve();
		assert(f.messages.at(-1).error);
		assert.deepEqual(await f.command('read'), before);
	}
});

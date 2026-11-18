import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
	createScspSsfPlaybackFixture,
	createScspSsfLiveFixture,
	createScspSsfCaptureFixture,
} from '../../test/helpers/scsp_ssf_fixture.mjs';
import { prepareScspSsfSource } from './ssf_source.js';
import { createScspSsfRenderer } from './ssf_renderer.js';
import { readScspSsfPcmPreview } from './ssf_snapshot.js';
import { checkSsfPlayerSources } from '../../scripts/build_ssf_player.mjs';
import createSsfPlayerModule from '../generated/ssf-player/ssf_player.js';

const wasmBinary = await readFile(
	new URL('../generated/ssf-player/ssf_player.wasm', import.meta.url),
);
const fixture = createScspSsfPlaybackFixture();
const prepared = await prepareScspSsfSource(fixture.standaloneFiles, '/ssf/standalone.ssf');
const create = (source) => createScspSsfRenderer(source, { wasmBinary });

function output(renderer, count) {
	const left = new Float32Array(count),
		right = new Float32Array(count);
	const produced = renderer.process(left, right, count);
	assert(produced >= 0 && produced <= count);
	assert(left.every(Number.isFinite) && right.every(Number.isFinite));
	return { left, right, produced };
}

test('SSF playback vendor files retain pinned source hashes and GPL provenance', async () => {
	const source = await checkSsfPlayerSources();
	assert.equal(source.commit, 'a28e0d7e14a3dc04a486ea26f30bc52edad3dc4d');
	assert.equal(source.license, 'GPL-2.0-or-later');
	assert(source.files.length > 100);
	assert(!source.files.some((file) => /font18x18ko|font12x13ja/.test(file.path)));
});

test('actual 68000 program configures SCSP PCM, renders finite audio and ends at the exact tagged frame', async () => {
	const renderer = await create(prepared);
	try {
		let frames = 0,
			peak = 0;
		while (!renderer.ended) {
			const { left, right, produced } = output(renderer, 2048);
			frames += produced;
			for (let index = 0; index < produced; index++)
				peak = Math.max(peak, Math.abs(left[index]), Math.abs(right[index]));
			assert(produced > 0);
		}
		assert.equal(frames, prepared.totalSamples);
		assert.equal(renderer.framesRendered, prepared.totalSamples);
		assert(peak > 0.1 && peak <= 1);
		const tail = output(renderer, 16);
		assert.equal(tail.produced, 0);
		assert(tail.left.every((value) => value === 0));
	} finally {
		renderer.dispose();
		renderer.dispose();
	}
	assert.throws(() => renderer.process(new Float32Array(1), new Float32Array(1), 1), /disposed/);
});

test('independent WASM machines can coexist and disposal leaves the other decoder running', async () => {
	const first = await create(prepared);
	const mini = await prepareScspSsfSource(fixture.files, '/ssf/Demo/track.minissf');
	const second = await create(mini);
	try {
		const a = output(first, 8192),
			b = output(second, 8192);
		assert(a.left.some((value) => value !== 0));
		assert(b.left.some((value) => value !== 0));
		assert.notDeepEqual(a.left, b.left);
		first.dispose();
		const later = output(second, 1024);
		assert(later.left.some((value) => value !== 0));
		assert.equal(second.framesRendered, 9216);
	} finally {
		first.dispose();
		second.dispose();
	}
});

test('relative volume including negative polarity and sample-exact software fade preserve the native waveform', async () => {
	const dry = await create({
		...prepared,
		lengthSeconds: prepared.durationSeconds,
		fadeSeconds: 0,
	});
	const faded = await create({ ...prepared, volume: -0.5 });
	try {
		let position = 0;
		while (!dry.ended) {
			const a = output(dry, 2048),
				b = output(faded, 2048);
			assert.equal(a.produced, b.produced);
			for (let index = 0; index < a.produced; index += 31) {
				const frame = position + index;
				const fade = frame >= 88200 ? (prepared.totalSamples - frame) / 11025 : 1;
				assert(Math.abs(b.left[index] - a.left[index] * -0.5 * fade) < 1e-7);
			}
			position += a.produced;
		}
		assert(faded.ended);
	} finally {
		dry.dispose();
		faded.dispose();
	}
});

test('unknown durations remain streaming and aborted or malformed sources fail before module creation', async () => {
	const renderer = await create({
		...prepared,
		lengthSeconds: null,
		durationSeconds: null,
		totalSamples: null,
	});
	try {
		assert.equal(output(renderer, 512).produced, 512);
		assert.equal(renderer.ended, false);
		assert.throws(
			() => renderer.process(new Float32Array(1), new Float32Array(1), 2),
			/buffers/,
		);
	} finally {
		renderer.dispose();
	}
	let calls = 0;
	const moduleFactory = () => {
		calls++;
		throw new Error('Module should not be created');
	};
	await assert.rejects(
		createScspSsfRenderer({ ...prepared, ram: new Uint8Array(5) }, { moduleFactory }),
		/512 KiB/,
	);
	await assert.rejects(
		createScspSsfRenderer({ ...prepared, volume: Infinity }, { moduleFactory }),
		/finite/,
	);
	const controller = new AbortController();
	controller.abort();
	await assert.rejects(
		createScspSsfRenderer(prepared, { signal: controller.signal, moduleFactory }),
		{ name: 'AbortError' },
	);
	assert.equal(calls, 0);
});

test('passive observation reads all 32 slots and same-boundary big-endian PCM without advancing the machine', async () => {
	const renderer = await create(prepared);
	try {
		const initial = renderer.readSnapshot();
		assert.equal(initial.frame, 0);
		assert.equal(initial.slots.length, 32);
		assert(initial.slots.every((slot) => !slot.active && !slot.gate));
		assert.deepEqual(initial.ram.subarray(0x1000, 0x1080), fixture.pcm);
		output(renderer, 256);
		const snapshot = renderer.readSnapshot();
		assert(snapshot.frame >= renderer.framesRendered);
		assert.equal(renderer.readSnapshot(), snapshot);
		assert.equal(renderer.framesRendered, 256);
		assert.equal(snapshot.slots[0].gate, true);
		assert.equal(snapshot.slots[0].active, true);
		assert.equal(snapshot.slots[0].sample.startAddress, 0x1000);
		assert.equal(snapshot.slots[0].sample.loopEnd, 64);
		assert.equal(snapshot.slots[0].sample.bits, 16);
		assert.equal(snapshot.slots[0].voice.frequencyHz, 44100);
		assert(snapshot.slots.slice(1).every((slot) => !slot.active));
		assert.equal(snapshot.globals.masterVolume, 15);
		assert.deepEqual(snapshot.ram.subarray(0x1000, 0x1080), fixture.pcm);
		const frozen = snapshot.ram.slice();
		output(renderer, 2048);
		assert.deepEqual(snapshot.ram, frozen);
		assert(renderer.readSnapshot().frame > snapshot.frame);
	} finally {
		renderer.dispose();
	}
});

test('reading snapshots between every short block preserves exact native PCM and final state', async () => {
	const observed = await create(prepared);
	const reference = await create(prepared);
	try {
		observed.readSnapshot();
		for (let index = 0; index < 160; index++) {
			const a = output(observed, 257),
				b = output(reference, 257);
			assert.deepEqual(a, b);
			const first = observed.readSnapshot();
			assert.equal(observed.readSnapshot(), first);
		}
		const a = observed.readSnapshot(),
			b = reference.readSnapshot();
		assert.deepEqual(a, b);
	} finally {
		observed.dispose();
		reference.dispose();
	}
});

test('live CPU edits remain visible across two physical slots with different PCM formats and LFO', async () => {
	const live = createScspSsfLiveFixture();
	const source = await prepareScspSsfSource(live.files, live.files[0].path);
	const renderer = await create(source);
	const levels = new Set(),
		pans = new Set();
	try {
		for (let index = 0; index < 16; index++) {
			output(renderer, 4096);
			const snapshot = renderer.readSnapshot(),
				a = snapshot.slots[0],
				b = snapshot.slots[1];
			assert(a.active && b.active);
			assert.equal(a.sample.bits, 16);
			assert.equal(b.sample.bits, 8);
			assert.equal(a.voice.envelope.attackRate, 31);
			assert.equal(b.voice.envelope.attackRate, 27);
			assert.equal(a.voice.lfo.frequencyCode, 10);
			assert.equal(b.voice.lfo.frequencyCode, 21);
			assert.equal(b.voice.modulation.writeInhibit, true);
			levels.add(a.voice.totalLevel);
			pans.add(b.voice.pan);
			const first = readScspSsfPcmPreview(snapshot, 0),
				second = readScspSsfPcmPreview(snapshot, 1);
			assert(first.pcm instanceof Int16Array);
			assert(second.pcm instanceof Int8Array);
			assert.equal(first.pcm.length, 64);
			assert.equal(second.pcm.length, 64);
			assert(first.pcm.some((value) => value !== 0));
			assert(second.pcm.some((value) => value !== 0));
		}
		assert.deepEqual(
			[...levels].sort((a, b) => a - b),
			[12, 36],
		);
		assert.deepEqual(
			[...pans].sort((a, b) => a - b),
			[6, 22],
		);
	} finally {
		renderer.dispose();
	}
});

test('live host writes change same-boundary all-slot parameters without advancing CPU, PCM phase or RAM', async () => {
	const original = createScspSsfCaptureFixture(),
		source = await prepareScspSsfSource(original.files, original.files[0].path),
		renderer = await create(source);
	try {
		output(renderer, 4096);
		const before = renderer.readSnapshot(),
			frame = renderer.framesRendered;
		const envelope = {
				attackRate: 20,
				decay1Rate: 5,
				decay2Rate: 6,
				decayLevel: 7,
				releaseRate: 18,
				keyRateScaling: 4,
				loopLink: true,
			},
			lfo = {
				frequencyCode: 12,
				pitchWave: 2,
				pitchDepth: 3,
				amplitudeWave: 1,
				amplitudeDepth: 4,
				reset: true,
			},
			mix = { totalLevel: 72, directLevel: 5, pan: 15 };
		const receipt = renderer.editVoice(0, 'setEnvelope', envelope);
		assert.deepEqual(receipt, { frame, nativeFrame: before.frame });
		renderer.editVoice(0, 'setLfo', lfo);
		renderer.editVoice(0, 'setMix', mix);
		const after = renderer.readSnapshot();
		assert.notEqual(after, before, 'a host write invalidates the same-frame cached snapshot');
		assert.equal(after.frame, before.frame);
		assert.equal(renderer.framesRendered, frame);
		for (const [key, value] of Object.entries(envelope))
			assert.equal(after.slots[0].voice.envelope[key], value);
		for (const [key, value] of Object.entries(lfo))
			assert.equal(after.slots[0].voice.lfo[key], value);
		for (const [key, value] of Object.entries(mix))
			assert.equal(after.slots[0].voice[key], value);
		for (const key of [
			'envelopeLevel',
			'envelopePhase',
			'currentAddress',
			'fractionalPhase',
			'lfoCounter',
			'lfoTimeCounter',
			'active',
			'gate',
		])
			assert.deepEqual(after.slots[0][key], before.slots[0][key], key);
		assert.deepEqual(after.ram, before.ram);
		assert.deepEqual(after.globals, before.globals);
		assert.deepEqual(after.slots.slice(1), before.slots.slice(1));
		for (const index of [2, 31]) {
			// The host write does not require capture eligibility: Noise, linked
			// voices and idle physical slots still own ordinary parameter registers.
			renderer.editVoice(index, 'setMix', { totalLevel: 37, pan: 22 });
			assert.equal(renderer.readSnapshot().slots[index].voice.totalLevel, 37);
			assert.equal(renderer.readSnapshot().slots[index].voice.pan, 22);
			assert.equal(renderer.readSnapshot().slots[index].gate, before.slots[index].gate);
		}
		const held = renderer.readSnapshot();
		for (const [slot, method, patch] of [
			[32, 'setMix', { pan: 0 }],
			[0, 'setMix', { pan: 0, directLevel: 8 }],
			[0, 'setEnvelope', { loopLink: 1 }],
			[0, 'setFrequency', { frequencyHz: 440 }],
		]) {
			assert.throws(() => renderer.editVoice(slot, method, patch));
			assert.equal(renderer.readSnapshot(), held);
		}
	} finally {
		renderer.dispose();
	}
	assert.throws(() => renderer.editVoice(0, 'setMix', { pan: 0 }), /disposed/);
});

test('host parameter masks retain hardware-only flags and DSP routing / return bits', async () => {
	const original = createScspSsfCaptureFixture(),
		source = await prepareScspSsfSource(original.files, original.files[0].path);
	const ram = source.ram.slice(),
		view = new DataView(ram.buffer),
		flags = new Map([
			[0x100008, 0x20],
			[0x10000a, 0x8000],
			[0x10000c, 0x300],
			[0x100016, 0xa7],
		]);
	const found = new Set();
	for (let address = 0x100; address < 0x600 - 8; address += 2) {
		if (view.getUint16(address, false) !== 0x33fc) continue;
		const target = view.getUint32(address + 4, false);
		if (!flags.has(target)) continue;
		view.setUint16(address + 2, view.getUint16(address + 2, false) | flags.get(target), false);
		found.add(target);
	}
	assert.equal(found.size, flags.size);
	const renderer = await create({ ...source, ram });
	try {
		output(renderer, 2048);
		const before = renderer.readSnapshot().slots[0];
		assert(
			before.flags.attackHold &&
				before.flags.envelopeBypass &&
				before.flags.soundDirect &&
				before.voice.modulation.writeInhibit,
		);
		assert.equal(before.registers[11] & 255, 0xa7);
		renderer.editVoice(0, 'setEnvelope', {
			attackRate: 12,
			decay1Rate: 23,
			decay2Rate: 9,
			decayLevel: 11,
			releaseRate: 17,
			keyRateScaling: 2,
			loopLink: true,
		});
		renderer.editVoice(0, 'setLfo', { reset: true, pitchDepth: 3 });
		renderer.editVoice(0, 'setMix', { totalLevel: 41, pan: 9, directLevel: 4 });
		const after = renderer.readSnapshot().slots[0];
		assert.equal(after.registers[4] & 0x20, before.registers[4] & 0x20);
		assert.equal(after.registers[5] & 0x8000, before.registers[5] & 0x8000);
		assert.equal(after.registers[6] & 0xff00, before.registers[6] & 0xff00);
		assert.equal(after.registers[11] & 255, before.registers[11] & 255);
		assert.equal(after.registers[10], before.registers[10]);
		assert.deepEqual(after.sample, before.sample);
		assert.deepEqual(after.dsp, before.dsp);
	} finally {
		renderer.dispose();
	}
});

test('native host edit ABI validates every masked word before any register write', async () => {
	let module, handle;
	const renderer = await createScspSsfRenderer(prepared, {
		wasmBinary,
		moduleFactory: async (options) => {
			module = await createSsfPlayerModule(options);
			const create = module._ssf_create;
			module._ssf_create = (...args) => (handle = create(...args));
			return module;
		},
	});
	let edits = 0,
		words = 0,
		ram = 0;
	try {
		assert.equal(module._ssf_abi_version(), 4);
		output(renderer, 2048);
		edits = module._malloc(9 * 4);
		words = module._malloc(1040 * 4);
		ram = module._malloc(524288);
		const read = () => {
			assert.equal(module._ssf_read_snapshot(handle, words, 1040, ram, 524288), 1);
			return {
				words: new Uint32Array(module.HEAPU8.buffer, words, 1040).slice(),
				ram: module.HEAPU8.slice(ram, ram + 524288),
			};
		};
		const before = read();
		for (const values of [
			[12, 255, 70, 22, 0xffff, 0],
			[12, 255, 70, 0, 0x800, 0],
			[12, 255, 70, 12, 255, 90],
			[8, 0x20, 0],
			[10, 0x8000, 0],
			[12, 255, 256],
		]) {
			new Uint32Array(module.HEAPU8.buffer, edits, values.length).set(values);
			assert.equal(module._ssf_edit_voice(handle, 0, edits, values.length / 3), 0);
			assert.deepEqual(read(), before);
		}
		new Uint32Array(module.HEAPU8.buffer, edits, 3).set([12, 255, 70]);
		assert.equal(module._ssf_edit_voice(handle, 32, edits, 1), 0);
		assert.equal(module._ssf_edit_voice(handle, 0, edits, 4), 0);
		assert.deepEqual(read(), before);
		assert.equal(module._ssf_edit_voice(handle, 0, edits, 1), 1);
		const after = read();
		assert.equal(after.words[16 + 6] & 255, 70);
		assert.deepEqual(after.ram, before.ram);
		assert.deepEqual(after.words.slice(0, 16), before.words.slice(0, 16));
	} finally {
		for (const pointer of [edits, words, ram]) if (pointer) module._free(pointer);
		renderer.dispose();
	}
});

test('live Envelope and amplitude LFO edits change an already held native voice without retrigger', async () => {
	const original = createScspSsfCaptureFixture(),
		source = await prepareScspSsfSource(original.files, original.files[0].path);
	for (const [method, patch] of [
		['setEnvelope', { decay1Rate: 31, decayLevel: 1, decay2Rate: 31 }],
		['setLfo', { frequencyCode: 31, amplitudeDepth: 7, amplitudeWave: 2, reset: false }],
	]) {
		const a = await create(source),
			b = await create(source);
		try {
			for (const renderer of [a, b]) {
				output(renderer, 4096);
				renderer.editVoice(1, 'setMix', { directLevel: 0 });
				renderer.editVoice(2, 'setMix', { directLevel: 0 });
			}
			assert.deepEqual(output(a, 4096), output(b, 4096));
			const before = a.readSnapshot().slots[0];
			a.editVoice(0, method, patch);
			const after = a.readSnapshot().slots[0];
			assert.equal(after.envelopePhase, before.envelopePhase);
			assert.equal(after.currentAddress, before.currentAddress);
			assert.equal(after.gate, true);
			const edited = output(a, 8192),
				original = output(b, 8192);
			assert.notDeepEqual(
				edited.left,
				original.left,
				`${method} should affect the existing held note`,
			);
			assert.equal(a.readSnapshot().slots[0].gate, true);
		} finally {
			a.dispose();
			b.dispose();
		}
	}
});

test('generated SSF module uses an explicitly provided WASM buffer rather than silently reloading a neighbor', async () => {
	await assert.rejects(
		createSsfPlayerModule({ wasmBinary: new Uint8Array([0, 1, 2, 3]), printErr() {} }),
		/Aborted|magic|CompileError/,
	);
});

test('host Mix edits audibly affect the running machine and the original 68000 driver continues to overwrite them', async () => {
	const live = createScspSsfLiveFixture(),
		source = await prepareScspSsfSource(live.files, live.files[0].path),
		a = await create(source),
		b = await create(source);
	try {
		assert.deepEqual(output(a, 4096), output(b, 4096));
		a.editVoice(0, 'setMix', { totalLevel: 100, pan: 15 });
		assert.equal(a.readSnapshot().slots[0].voice.totalLevel, 100);
		const changed = output(a, 4096),
			reference = output(b, 4096);
		assert.notDeepEqual(changed.left, reference.left);
		assert(changed.left.some((value) => value !== 0));
		let overwritten = false;
		for (let index = 0; index < 20; index++) {
			output(a, 4096);
			const current = a.readSnapshot();
			if ([12, 36].includes(current.slots[0].voice.totalLevel)) {
				overwritten = true;
				break;
			}
		}
		assert(
			overwritten,
			'CPU music driver must continue, including its later write to the same TL',
		);
	} finally {
		a.dispose();
		b.dispose();
	}
});

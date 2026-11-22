// SPDX-License-Identifier: BSD-3-Clause
// Verify the DS-only WASM against native libretro with no audio device.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isTwoSfPath } from '../../docs/synth-nitro-ds/2sf_source.js';
import { assembleTwoSf } from './assemble.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const args = process.argv.slice(2);
const realFolder = /^--real-folder=(.+)$/.exec(args[0] ?? '')?.[1];
assert(args.length === 0 || (args.length === 1 && realFolder),
	'Usage: node scripts/nds-2sf/check_skyemu_wasm.mjs [--real-folder=PATH]');
const rate = 48000;
const snapshotWords = 1 + 16 * 5;
const wasmPath = join(root, 'build/nds-2sf/skyemu-2sf.wasm');
const wasm = new WebAssembly.Module(readFileSync(wasmPath));
assert.deepEqual(WebAssembly.Module.imports(wasm), [
	{ module: 'env', name: 'emscripten_notify_memory_growth', kind: 'function' },
]);

function newCore() {
	const { exports: core } = new WebAssembly.Instance(wasm, {
		env: { emscripten_notify_memory_growth() {} },
	});
	core._initialize();
	return core;
}

function openRenderer(rom) {
	const core = newCore();
	const image = core.malloc(rom.length);
	const output = core.malloc(2048 * 4);
	assert(image && output, 'Allocate ROM and stereo PCM buffers');
	new Uint8Array(core.memory.buffer, image, rom.length).set(rom);
	assert.equal(core.nds_2sf_open(image, 1000), 0, 'Reject too-short ROM');
	assert.equal(core.nds_2sf_open(image, rom.length), 1, 'Boot ROM');
	assert.equal(core.nds_2sf_open(image, rom.length), 0, 'Keep existing console while open');
	core.free(image);
	assert.equal(core.nds_2sf_render(output, 0), 0, 'Reject empty render');
	assert.equal(core.nds_2sf_render(output, 2049), 0, 'Reject overlarge render');
	return { core, output };
}

function render(rom, frameCount, blockSize, snapshots) {
	const { core, output } = openRenderer(rom);
	const pcm = Buffer.alloc(frameCount * 4);
	for (let start = 0; start < frameCount; start += blockSize) {
		const count = Math.min(blockSize, frameCount - start);
		assert.equal(core.nds_2sf_render(output, count), count);
		pcm.set(new Uint8Array(core.memory.buffer, output, count * 4), start * 4);
		if (snapshots) {
			const snapshotCount = core.nds_2sf_snapshot_count();
			assert(snapshotCount <= 9, 'A render should produce a bounded number of snapshots');
			if (snapshotCount) {
				const words = new Uint32Array(core.memory.buffer, core.nds_2sf_snapshots(), snapshotCount * snapshotWords);
				for (let offset = 0; offset < words.length; offset += snapshotWords)
					snapshots.push(words.slice(offset, offset + snapshotWords));
			}
		}
	}
	core.nds_2sf_close();
	assert.equal(core.nds_2sf_render(output, 1), 0, 'Reject render after closing');
	core.free(output);
	return pcm;
}

function checkSnapshots(track, pcm, snapshots) {
	assert(snapshots.length >= 2, 'Expected a baseline and emulator-tick snapshots');
	assert.equal(snapshots[0][0], 0, 'Baseline snapshot should start at output frame zero');
	assert(snapshots.every(([frame], index) => index === 0 || frame > snapshots[index - 1][0]),
		'Snapshot positions should be strictly increasing in the 48 kHz output timeline');
	const sound = snapshots.find(row => row[1] >>> 31);
	assert(sound, 'The fixture should key on hardware CH0');
	const firstSignal = Math.floor(pcm.findIndex((byte) => byte !== 0) / 4);
	assert(firstSignal >= 0 && Math.abs(sound[0] - firstSignal) <= 1024,
		`CH0 activity should line up with the first PCM within one tick: snapshot ${sound[0]}, audio ${firstSignal}`);

	const last = snapshots.at(-1);
	const [, control, address, timerLoop, length] = last;
	const panRight = track === 'right-e5';
	assert.equal(control >>> 31, 1, 'CH0 should remain active');
	assert.equal((control >>> 29) & 3, 1, 'CH0 reads back as PCM16');
	assert.equal(control & 127, 100, 'CH0 volume should equal the authored setting');
	assert.equal((control >>> 8) & 3, 0, 'CH0 uses the unattenuated divider setting');
	assert.equal((control >>> 16) & 127, panRight ? 127 : 0, 'CH0 pan should match the selected track');
	assert.equal(address, 0x03800100, 'CH0 source should match the fixture wave address');
	assert.equal(timerLoop, panRight ? 64742 : 64346, 'CH0 timer and loop start should match the fixture');
	assert.equal(length, 16, 'CH0 loop length should match the 32 PCM16 samples');
	for (let channel = 1; channel < 16; channel++)
		assert.equal(last[1 + channel * 5] >>> 31, 0, `Hardware CH${channel} should stay idle`);
}

function renderDirect(rom, snapshot, frames) {
	const [, control, sourceAddress, timerLoop, length] = snapshot;
	const arm7Offset = rom.readUInt32LE(0x30);
	const arm7LoadAddress = rom.readUInt32LE(0x38);
	const byteLength = ((timerLoop >>> 16) + length) * 4;
	const sourceOffset = arm7Offset + sourceAddress - arm7LoadAddress;
	assert(sourceOffset >= arm7Offset && sourceOffset + byteLength <= arm7Offset + rom.readUInt32LE(0x3c),
		'Fixture PCM must be inside the ARM7 program image');

	const core = newCore();
	const upload = core.malloc(byteLength);
	const output = core.malloc(2048 * 4);
	const image = core.malloc(rom.length);
	assert(upload && output && image, 'Allocate direct PCM and mode-switch buffers');
	new Uint8Array(core.memory.buffer, upload, byteLength).set(rom.subarray(sourceOffset, sourceOffset + byteLength));
	new Uint8Array(core.memory.buffer, image, rom.length).set(rom);
	assert.equal(core.nds_synth_open(), 1, 'Initialize the shared audio core without a ROM');
	try {
		assert.equal(core.nds_synth_open(), 0, 'Keep the existing direct sound session');
		assert.equal(core.nds_2sf_open(image, rom.length), 0, 'A direct session already owns the console');
		assert.equal(core.nds_synth_render(output, 0), 0, 'Reject an empty direct render');
		assert.equal(core.nds_synth_render(output, 2049), 0, 'Reject an overlarge direct render');
		assert.equal(core.nds_synth_upload(4 * 1024 * 1024 - 1, upload, 2), 0, 'Reject a sample crossing the RAM boundary');
		assert.equal(core.nds_synth_write(2, control), 0, 'Reject an unaligned sound register');
		assert.equal(core.nds_synth_write(16 * 16, control), 0, 'Reject a non-channel register');
		assert.equal(core.nds_synth_write(0, control), 0, 'Reject PCM key-on before setting a valid source and range');
		assert.equal(core.nds_synth_upload(0, upload, byteLength), 1);
		// Direct samples live in main RAM. Use the register values from the
		// 2SF driver, with the source address redirected to the same PCM bytes.
		for (const [offset, value] of [[4, 0x02000000], [8, timerLoop], [12, length], [0, control]])
			assert.equal(core.nds_synth_write(offset, value), 1);
		const pcm = Buffer.alloc(frames * 4);
		for (let frame = 0; frame < frames; frame += 257) {
			const count = Math.min(257, frames - frame);
			assert.equal(core.nds_synth_render(output, count), count);
			pcm.set(new Uint8Array(core.memory.buffer, output, count * 4), frame * 4);
		}
		const right = ((control >>> 16) & 127) === 0;
		const switchedPan = (control & ~(127 << 16)) | ((right ? 127 : 0) << 16);
		assert.equal(core.nds_synth_write(0, switchedPan), 1, 'Update pan while the note stays enabled');
		assert.equal(core.nds_synth_render(output, 2048), 2048);
		const next = new Int16Array(core.memory.buffer, output, 2048 * 2);
		const peak = [0, 0];
		for (let i = 0; i < next.length; i++) peak[i % 2] = Math.max(peak[i % 2], Math.abs(next[i]));
		assert(peak[Number(right)] > 1000 && peak[Number(!right)] < peak[Number(right)] / 100,
			'A live CH0 register write should move the existing note to the other speaker');
		const previousPosition = core.nds_synth_position(0);
		assert.equal(core.nds_synth_range(0, 4, 4), 1, 'Move both PCM16 range bounds on the live channel');
		assert.equal(core.nds_synth_read(8) >>> 0, (4 << 16) | (timerLoop & 0xffff));
		assert.equal(core.nds_synth_read(12), 4);
		const expectedPosition = previousPosition < 16 ? previousPosition : 8 + (previousPosition - 16) % 8;
		assert.equal(core.nds_synth_position(0), expectedPosition);
		assert.equal(core.nds_synth_read(0) >>> 0, switchedPan >>> 0, 'The range edit preserves the active gate');
		assert.equal(core.nds_synth_range(0, 0xffff, 0x3fffff), 0, 'Reject a range past the end of RAM');
		assert.equal(core.nds_synth_read(12), 4, 'A rejected range keeps the committed length');
		assert.equal(core.nds_synth_position(0), expectedPosition, 'A rejected range keeps the cursor');
		core.nds_synth_close();
		assert.equal(core.nds_synth_render(output, 1), 0, 'Reject direct render after closing');
		assert.equal(core.nds_2sf_open(image, rom.length), 1, 'Boot 2SF on the same console after closing the direct session');
		assert.equal(core.nds_synth_open(), 0, 'A 2SF session already owns the console');
		return pcm;
	} finally {
		core.nds_synth_close();
		core.nds_2sf_close();
		core.free(image);
		core.free(output);
		core.free(upload);
	}
}

function alignedChanges(pcm, channel, count) {
	// The fixture starts each loop at zero and has just one rising zero
	// crossing per cycle. Skip boot, then align the two clocks at that point.
	const sample = frame => pcm.readInt16LE(frame * 4 + channel * 2);
	const frames = pcm.length / 4;
	let first = rate / 4;
	while (first < frames && !(sample(first - 1) < 0 && sample(first) === 0)) first++;
	assert(first < frames, 'The running fixture should reach a rising zero crossing');
	const changes = [];
	let previous;
	for (let frame = first; frame < frames && changes.length < count; frame++) {
		const value = pcm.readUInt32LE(frame * 4);
		if (value === previous) continue;
		changes.push({ value, frame: frame - first });
		previous = value;
	}
	assert.equal(changes.length, count, 'The loop should cycle continuously after the crossing');
	return changes;
}

function checkSharedSound(track, rom, reference, snapshot) {
	const direct = renderDirect(rom, snapshot, rate / 2);
	const channel = track === 'right-e5' ? 1 : 0;
	const expected = alignedChanges(reference, channel, 32 * 16);
	const actual = alignedChanges(direct, channel, expected.length);
	assert.deepEqual(actual.map(({ value }) => value), expected.map(({ value }) => value),
		`${track}: direct and 2SF should read the same repeating stereo PCM levels`);
	assert(actual.every(({ frame }, index) => Math.abs(frame - expected[index].frame) <= 1),
		`${track}: direct and 2SF should agree on loop speed within one output frame`);
	console.log(`${track}: ${expected.length} direct-mode stereo changes match the 2SF renderer`);
}

function adpcmFixture(replacement = false) {
	const bytes = Buffer.alloc(257 * 4);
	bytes.writeInt16LE(replacement ? -9701 : 1359, 0);
	bytes[2] = replacement ? 41 : 70;
	for (let i = 4; i < bytes.length; i++) bytes[i] = (i * 137 + (i >>> 2) * 73 + (replacement ? 63 : 0)) & 255;
	return bytes;
}

function withDirectAdpcm(core, { cache, timer, pnt, length, loop, beforeKeyOn }, run) {
	const bytes = adpcmFixture();
	const buffer = core.malloc(bytes.length), output = core.malloc(2048 * 4);
	assert(buffer && output, 'Allocate ADPCM upload and PCM output buffers');
	assert.equal(core.nds_synth_open(), 1);
	const control = (0xc0000000 | ((loop ? 1 : 2) << 27) | (43 << 16) | 109) >>> 0;
	function upload(sample) {
		new Uint8Array(core.memory.buffer, buffer, sample.length).set(sample);
		assert.equal(core.nds_synth_upload(0, buffer, sample.length), 1, 'Upload ADPCM at the current source address');
	}
	function render(frames) {
		assert.equal(core.nds_synth_render(output, frames), frames);
		return {
			pcm: Buffer.from(new Uint8Array(core.memory.buffer, output, frames * 4)),
			position: core.nds_synth_position(0),
			active: Boolean(core.nds_synth_read(0) >>> 31),
		};
	}
	try {
		assert.equal(core.nds_synth_set_adpcm_cache(Number(cache)), 1);
		upload(bytes);
		beforeKeyOn?.(upload);
		for (const [offset, value] of [[4, 0x02000000], [8, (pnt << 16) | timer], [12, length], [0, control]])
			assert.equal(core.nds_synth_write(offset, value), 1);
		return run({ core, render, upload, control });
	} finally {
		core.nds_synth_close();
		core.free(output);
		core.free(buffer);
	}
}

function checkAdpcmBlock(actual, expected, label) {
	if (!actual.pcm.equals(expected.pcm)) {
		const byte = actual.pcm.findIndex((value, index) => value !== expected.pcm[index]);
		const sample = byte - byte % 2;
		assert.fail(`${label}: frame ${Math.floor(sample / 4)} ${sample % 4 ? 'R' : 'L'} was ${actual.pcm.readInt16LE(sample)}, expected ${expected.pcm.readInt16LE(sample)}`);
	}
	assert.equal(actual.position, expected.position, `${label}: decoder position changed`);
	assert.equal(actual.active, expected.active, `${label}: active gate changed`);
}

function checkPreparedAdpcm(core, timer) {
	const replacement = adpcmFixture(true);
	const settings = { timer, pnt: 4, length: 191, loop: true };
	function renderShared({ core, render, control }, expand) {
		const initial = render(57);
		assert(initial.position < (settings.pnt + 9) * 8, 'The edit should occur before the first loop wraps');
		if (expand)
			assert.equal(core.nds_synth_range(0, settings.pnt, settings.length), 1, 'A running loop can extend into the prepared data');
		const otherControl = ((control & ~(127 << 16)) | (127 << 16)) >>> 0;
		for (const [offset, value] of [[4, 0x02000000], [8, (7 << 16) | 65533], [12, 250], [0, otherControl]])
			assert.equal(core.nds_synth_write(16 + offset, value), 1, 'A second channel uses the same sample address');
		const blocks = [];
		for (const frames of [19, 257, 2048, 511]) {
			blocks.push({
				...render(frames),
				otherPosition: core.nds_synth_position(1),
				otherActive: Boolean(core.nds_synth_read(16) >>> 31),
			});
		}
		return blocks;
	}
	const expected = withDirectAdpcm(core, { ...settings, cache: false, beforeKeyOn: upload => upload(replacement) },
		session => renderShared(session, false));
	const actual = withDirectAdpcm(core, {
		...settings,
		length: 9,
		cache: true,
		beforeKeyOn(upload) {
			const size = replacement.length;
			assert.equal(core.nds_synth_prepare_adpcm(0, size, 0), 0, 'Reject a zero decode budget');
			assert.equal(core.nds_synth_prepare_adpcm(0, size, 16385), 0, 'Reject an excessive decode budget');
			assert.equal(core.nds_synth_prepare_adpcm(1, size, 97), 0, 'Reject an unaligned sample source');
			assert.equal(core.nds_synth_prepare_adpcm(0, size, 1024), 2, 'The original upload is partly decoded');
			upload(replacement);
			const results = [];
			for (let chunk = 0; chunk < 32; chunk++) {
				const status = core.nds_synth_prepare_adpcm(0, size, 97);
				results.push(status);
				if (status !== 2) break;
			}
			assert.deepEqual(results, [...Array(Math.ceil((size * 2 - 8) / 97) - 1).fill(2), 1],
				'Replacement must restart preparation and obey the decode budget');
			assert.equal(core.nds_synth_prepare_adpcm(0, size, 1), 1, 'A prepared sample stays ready');
		},
	}, session => renderShared(session, true));
	for (let index = 0; index < expected.length; index++) {
		checkAdpcmBlock(actual[index], expected[index], 'Prepared ADPCM used on two channels');
		assert.equal(actual[index].otherPosition, expected[index].otherPosition, 'The shared sample keeps each channel’s own position');
		assert.equal(actual[index].otherActive, true, 'The second channel remains active');
	}
	console.log('Chunked ADPCM preparation restarts on upload and shared sample playback matches uncached PCM');
}

function checkDirectAdpcm() {
	const core = newCore();
	const normalTimer = 65536 - Math.round(16756991 / 32768);
	const chunks = [1, 17, 128, 257, 2048, 2048];
	for (const timer of [normalTimer, 65533, 65535]) {
		for (const loop of [false, true]) {
			// At timer 65535, the short looping sample can wrap several times
			// inside one output frame. The long one-shot also crosses its end.
			const settings = { timer, pnt: 4, length: loop ? 9 : 253, loop };
			const collect = ({ render }) => chunks.map(render);
			const expected = withDirectAdpcm(core, { ...settings, cache: false }, collect);
			const actual = withDirectAdpcm(core, { ...settings, cache: true }, collect);
			assert(expected.some(({ pcm }) => pcm.some(value => value !== 0)), 'The ADPCM fixture must produce a non-silent signal');
			assert.equal(expected.at(-1).active, loop, 'The loop stays active and the one-shot ends');
			for (let index = 0; index < chunks.length; index++)
				checkAdpcmBlock(actual[index], expected[index], `ADPCM ${loop ? 'loop' : 'one-shot'}, timer ${timer}, block ${index}`);
		}
	}

	const retuneWhilePlaying = cache => withDirectAdpcm(core, { timer: normalTimer, pnt: 4, length: 9, loop: true, cache },
		({ core, render }) => {
			render(321);
			assert.equal(core.nds_synth_write(8, (4 << 16) | 65535), 1);
			const fast = render(401);
			assert.equal(core.nds_synth_write(8, (4 << 16) | normalTimer), 1);
			return [fast, render(512)];
		});
	const retuned = retuneWhilePlaying(false), cachedRetuned = retuneWhilePlaying(true);
	for (let index = 0; index < retuned.length; index++)
		checkAdpcmBlock(cachedRetuned[index], retuned[index], 'ADPCM live timer write');

	const settings = { timer: 65533, pnt: 4, length: 22, loop: true };
	const rewriteWhilePlaying = (cache, replace) => withDirectAdpcm(core, { ...settings, cache }, ({ core, render, upload, control }) => {
		render(37);
		if (replace) upload(adpcmFixture(true));
		const held = render(533);
		assert.equal(core.nds_synth_write(0, control & 0x7fffffff), 1);
		assert.equal(core.nds_synth_write(0, control), 1);
		return [held, render(257)];
	});
	const unmodified = rewriteWhilePlaying(false, false);
	const rewritten = rewriteWhilePlaying(false, true);
	const cachedRewrite = rewriteWhilePlaying(true, true);
	for (let index = 0; index < rewritten.length; index++) {
		assert(!rewritten[index].pcm.equals(unmodified[index].pcm), 'A same-address upload must audibly change the fixture');
		checkAdpcmBlock(cachedRewrite[index], rewritten[index], index ? 'ADPCM retrigger after same-address upload' : 'ADPCM same-address upload while playing');
	}

	// Both traces have the same timer phase. The longer loop is edited
	// after the cursor has passed the new end, while still on its first pass.
	const outer = { timer: normalTimer, loop: true };
	const target = { pnt: 2, length: 4 };
	const expected = withDirectAdpcm(core, { ...outer, ...target, cache: false }, ({ render }) => {
		render(96);
		return render(1024);
	});
	const actual = withDirectAdpcm(core, { ...outer, pnt: 4, length: 60, cache: true }, ({ core, render }) => {
		const initial = render(96);
		assert(initial.position >= (target.pnt + target.length) * 8 && initial.position < (4 + 60) * 8);
		assert.equal(core.nds_synth_range(0, target.pnt, target.length), 1, 'Reposition the running ADPCM loop');
		return render(1024);
	});
	checkAdpcmBlock(actual, expected, 'ADPCM live loop range');
	console.log('Direct ADPCM cache matches uncached PCM, cursor and gate for loops, one-shots, live timer and range edits and same-address uploads');
	checkPreparedAdpcm(core, normalTimer);
}

function checkCaptureHistory(work) {
	const fixture = fileURLToPath(new URL('./make_fixture.py', import.meta.url));
	execFileSync('python3', [fixture, work, '--history-fixture'], { timeout: 60000 });
	const rom = readFileSync(join(work, 'history-overwrite.nds'));
	const { core, output } = openRenderer(rom);
	function capture(frame) {
		const bytes = core.nds_2sf_capture(frame, 0);
		assert.equal(bytes, 64, 'Expected the entire 32-frame PCM16 sample');
		return Buffer.from(new Uint8Array(core.memory.buffer, core.nds_2sf_capture_data(), bytes));
	}
	let initial;
	try {
		for (let start = 0; start < rate; start += 2048) {
			assert.equal(core.nds_2sf_render(output, 2048), 2048);
			const words = new Uint32Array(core.memory.buffer, core.nds_2sf_snapshots(),
				core.nds_2sf_snapshot_count() * snapshotWords).slice();
			for (let offset = 0; offset < words.length; offset += snapshotWords) {
				const [frame, control, address] = words.subarray(offset, offset + snapshotWords);
				if (!(control >>> 31)) continue;
				const sample = capture(frame);
				const revision = core.nds_2sf_capture_revision();
				assert(revision > 0, 'A retained sample has a nonzero revision');
				if (!initial) {
					assert.equal(sample.readInt16LE(0), 0, 'Original source starts at the sine zero crossing');
					assert.equal(sample.readInt16LE(2), 2341, 'Original source starts with the authored PCM16 samples');
					assert.equal(core.nds_2sf_capture(frame + 1, 0), -1, 'Reject a frame with no exact snapshot');
					assert.equal(core.nds_2sf_capture_revision(), 0, 'A failed capture clears the revision');
					assert.equal(core.nds_2sf_capture(frame, 1), -2, 'Reject an idle channel');
					initial = { frame, address, sample, revision, rewritten: false };
				} else if (!initial.rewritten && sample.readUInt32LE(0) === 0x1234abcd) {
					assert.equal(address, initial.address, 'The same source address now contains different PCM');
					assert.notEqual(revision, initial.revision, 'Rewriting the same RAM changes its capture revision');
					assert.deepEqual(sample.subarray(4), initial.sample.subarray(4), 'Only the first PCM word changed');
					assert.deepEqual(capture(initial.frame), initial.sample, 'Older observation must keep its own PCM bytes');
					assert.equal(core.nds_2sf_capture_revision(), initial.revision, 'The older observation keeps its revision too');
					initial.rewritten = true;
				} else if (sample.equals(initial.sample)) {
					assert.equal(revision, initial.revision, 'Unchanged PCM is retained with its original revision');
				}
			}
		}
		assert(initial?.rewritten, 'Expected the playing program to rewrite its sample');
		assert.equal(core.nds_2sf_capture(initial.frame, 0), -1, 'Expired sample observations should be rejected');
	} finally {
		core.nds_2sf_close();
		core.free(output);
	}
	console.log('Capture history retains original PCM across an in-place rewrite and drops expired observations');
}

function checkChannelEdits(rom) {
	const { core, output } = openRenderer(rom);
	const frames = 8192, blockSize = 2048, keepTimer = 0xffffffff;
	function snapshot() {
		const rows = new Uint32Array(core.memory.buffer, core.nds_2sf_snapshots(), core.nds_2sf_snapshot_count() * snapshotWords);
		return rows.slice(-snapshotWords);
	}
	try {
		for (let count = 0; count < frames; count += blockSize) assert.equal(core.nds_2sf_render(output, blockSize), blockSize);
		const before = snapshot();
		assert(before[1] >>> 31, 'The song fixture must already be playing');
		assert.equal(core.nds_2sf_edit_channel(16, 127, 70, keepTimer), -1, 'Reject invalid channel index');
		assert.equal(core.nds_2sf_edit_channel(0, 0x80000000, 0, keepTimer), -1, 'Reject key gate edits');
		assert.equal(core.nds_2sf_edit_channel(0, 127, 0x10080, keepTimer), -1, 'Reject writes outside the edit mask');
		assert.equal(core.nds_2sf_edit_channel(0, 0, 0, 65536), -1, 'Reject invalid timer');
		const mask = 0x077f037f, edit = (6 << 24) | (127 << 16) | (1 << 8) | 70;
		const appliedAt = core.nds_2sf_edit_channel(0, mask, edit, keepTimer);
		assert.equal(appliedAt, before[0], 'Edit applies after already-generated PCM');
		assert.equal(core.nds_2sf_render(output, blockSize), blockSize);
		const after = snapshot();
		assert.equal(after[1], ((before[1] & ~mask) | edit) >>> 0, 'Change selected bits without altering the gate or format');
		assert.deepEqual(after.subarray(2, 5), before.subarray(2, 5), 'Preserve sample source, timer and loop');
		assert.deepEqual(after.subarray(6), before.subarray(6), 'Preserve all other channels');
		const baseline = [];
		render(rom, frames + blockSize, blockSize, baseline);
		assert.equal(after[5], baseline.at(-1)[5], 'Volume, pan, divider and duty edits leave the PCM decoder cursor intact');
		let left = 0, right = 0;
		const pcm = new Int16Array(core.memory.buffer, output, blockSize * 2);
		for (let frame = appliedAt - frames; frame < blockSize; frame++) {
			left += Math.abs(pcm[frame * 2]);
			right += Math.abs(pcm[frame * 2 + 1]);
		}
		assert(right > 0 && right > left * 64, 'Editing song pan moves the subsequent audio to the right');
		assert.equal(core.nds_2sf_edit_channel(0, 0, 0, 65500), after[0]);
		assert.equal(core.nds_2sf_render(output, blockSize), blockSize);
		const retuned = snapshot();
		assert.equal(retuned[3], ((after[3] & 0xffff0000) | 65500) >>> 0, 'Timer edit preserves loop start');
		assert.equal(retuned[1], after[1], 'Timer edit preserves control including the gate');
	} finally {
		core.nds_2sf_close();
		core.free(output);
	}
	console.log('2SF channel edits change the playing mixer and timer without retriggering PCM');
}

function readNativePcm(path, frames) {
	const wave = readFileSync(path);
	// Header produced by render_skyemu.c. The comparison uses only PCM.
	assert.equal(wave.readUInt32LE(24), rate);
	assert.equal(wave.readUInt16LE(22), 2);
	assert.equal(wave.readUInt16LE(34), 16);
	const pcm = wave.subarray(44);
	assert.equal(pcm.length, frames * 4);
	return pcm;
}

function checkDemo(work) {
	const checker = fileURLToPath(new URL('./check_demo.py', import.meta.url));
	execFileSync('python3', [checker, '--work-dir', work], { stdio: 'inherit', timeout: 60000 });
	const frames = rate * 2;
	for (const track of ['left-a4', 'right-e5']) {
		const rom = readFileSync(join(work, track + '.nds'));
		const native = readNativePcm(join(work, track + '.wav'), frames);
		const regular = [], small = [];
		const reference = render(rom, frames, 2048, regular);
		assert(reference.equals(native), `${track}: 2048-frame blocks differed from Native PCM`);
		assert(render(rom, frames, 257, small).equals(native), `${track}: 257-frame blocks differed from Native PCM`);
		assert.deepEqual(small, regular, `${track}: snapshots changed with browser render-block size`);
		checkSnapshots(track, native, regular);
		checkSharedSound(track, rom, reference, regular.at(-1));
		console.log(`${track}: ${frames} stereo frames match native PCM and ${regular.length} snapshots agree across block sizes`);
	}
	checkChannelEdits(readFileSync(join(work, 'left-a4.nds')));
	checkCaptureHistory(work);
	checkDirectAdpcm();
}

async function checkRealFolder(work, folder) {
	const setRoot = resolve(folder);
	const tracks = readdirSync(setRoot, { recursive: true, withFileTypes: true })
		.filter(entry => entry.isFile() && isTwoSfPath(entry.name))
		.map(entry => join(entry.parentPath, entry.name)).sort();
	assert(tracks.length, 'The selected folder contains no .2sf or .mini2sf tracks');
	const renderer = join(root, 'build/nds-2sf/render-skyemu');
	const input = join(work, 'track.nds');
	const output = join(work, 'track.wav');
	const seconds = 8;
	const frames = rate * seconds;
	let nonSilentTracks = 0;
	for (const path of tracks) {
		try {
			const { rom } = await assembleTwoSf(path, { setRoot });
			writeFileSync(input, rom);
			execFileSync(renderer, [input, output, String(seconds)], { timeout: 30000 });
			const native = readNativePcm(output, frames);
			const result = render(rom, frames, 2048);
			if (!result.equals(native)) {
				const first = native.findIndex((byte, i) => byte !== result[i]);
				const sample = first - first % 2;
				throw Error(`first PCM difference at frame ${Math.floor(sample / 4)}, channel ${sample % 4 === 0 ? 'L' : 'R'} (Native ${native.readInt16LE(sample)}, WASM ${result.readInt16LE(sample)})`);
			}
			if (native.some(byte => byte !== 0)) nonSilentTracks++;
		} catch (error) {
			throw Error(`${relative(setRoot, path)}: ${error.message}`, { cause: error });
		}
	}
	console.log(JSON.stringify({
		tracks: tracks.length, nonSilentTracks, sampleRate: rate, secondsPerTrack: seconds,
		stereoFramesCompared: frames * tracks.length, pcmBitExact: true,
	}));
}

const work = mkdtempSync(join(tmpdir(), 'tetorica-2sf-parity-'));
try {
	if (realFolder) await checkRealFolder(work, realFolder);
	else checkDemo(work);
} finally {
	rmSync(work, { recursive: true, force: true });
}

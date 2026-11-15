// Calibration source evidence and offline PCM only; no audio device.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';
import { Scsp } from '../tetorica_src/runtime/scsp.js';
import { ScspSynth } from '../tetorica_src/runtime/scspsynth.js';
import { noteToHz } from '../tetorica_src/runtime/soundchip_pitch.js';
import factory from '../docs/generated/scsp_wasm.js';
import { buildScspCalibrationReference } from './soundchip_calibration_scsp.mjs';
import { assertMixerCalibrationSourceFreshness } from './mixer_calibration_sources.mjs';
import {
	restoreMixerCalibrationScspLoopLinkRevision as restore,
	SCSP_LOOP_LINK_REVISION_RECEIPT_PATH as receiptPath,
	SCSP_LOOP_LINK_REVISION_RECEIPT_OBJECT_SHA256 as pin,
	SCSP_LOOP_LINK_REVISION_BASE_COMMIT as baseCommit,
	SCSP_LOOP_LINK_REVISION_SOURCE_PATHS as paths,
	SCSP_LOOP_LINK_REVISION_REPORT_PATHS as reports,
	SCSP_LOOP_LINK_REVISION_RELATED_PATHS as related,
} from './mixer_calibration_scsp_loop_link_revision.mjs';
const read = (path) => readFile(new URL('../' + path, import.meta.url));
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const receipt = JSON.parse(await read(receiptPath));

test('the independently pinned additive API receipt restores exact source bodies and unchanged reports', async () => {
	assert.equal(sha(JSON.stringify(receipt)), pin);
	assert.equal(receipt.baseCommit, baseCommit);
	assert.equal(
		await read(receiptPath).then((bytes) => bytes.toString()),
		JSON.stringify(receipt, null, 2) + '\n',
	);
	assert.deepEqual(Object.keys(receipt.sources), [...paths]);
	for (const path of paths) {
		const current = await read(path),
			before = restore(path, current),
			entry = receipt.sources[path];
		assert.equal(current.length, entry.after.bytes);
		assert.equal(sha(current), entry.after.sha256);
		assert.equal(before.length, entry.before.bytes);
		assert.equal(sha(before), entry.before.sha256);
		assert.equal(restore(path, before), before, 'the predecessor needs no exception');
	}
	const web = await read('tetorica_src/runtime/scspsynth.js');
	assert.deepEqual(
		restore('web/scspsynth.js', web),
		restore('tetorica_src/runtime/scspsynth.js', web),
	);
	const docs = await read('docs/js/scspsynth.js'),
		record = receipt.sources['docs/js/scspsynth.js'].before;
	assert.equal(
		assertMixerCalibrationSourceFreshness({ path: 'js/scspsynth.js', bytes: docs, record }),
		'scsp-loop-link-hardware-api',
	);
	for (const path of reports) {
		const bytes = await read(path);
		assert.equal(bytes.length, receipt.reports[path].bytes);
		assert.equal(sha(bytes), receipt.reports[path].sha256);
	}
});

test('future flag/default/import/body edits and unrelated paths cannot use the reviewed API revision', async () => {
	for (const path of paths) {
		const bytes = await read(path),
			edited = Buffer.from(bytes);
		edited[Math.floor(edited.length / 2)] ^= 1;
		for (const changed of [
			edited,
			Buffer.concat([bytes, Buffer.from('\n')]),
			Buffer.from(bytes.toString().replace('loopLink:false', 'loopLink:true')),
		]) {
			if (changed.equals(bytes)) continue;
			assert.equal(restore(path, changed), changed, path);
			if (path === 'docs/js/scspsynth.js')
				assert.throws(
					() =>
						assertMixerCalibrationSourceFreshness({
							path: 'js/scspsynth.js',
							bytes: changed,
							record: receipt.sources[path].before,
						}),
					/remeasure/,
				);
		}
	}
	const bytes = await read(paths[0]);
	for (const path of [
		'js/another.js',
		'__proto__',
		'../docs/js/scspsynth.js',
		'generated/scsp_wasm.wasm',
	])
		assert.equal(restore(path, bytes), bytes);
});

test('reports, native output assets, reference, gain and declaration dependencies all remain mandatory', async () => {
	const path = 'docs/js/scspsynth.js',
		bytes = await read(path);
	const originals = new Map(
		await Promise.all(
			[...reports, ...related].map(async (path) => [
				new URL('../' + path, import.meta.url).href,
				await read(path),
			]),
		),
	);
	for (const dependency of [...reports, ...related]) {
		const target = new URL('../' + dependency, import.meta.url).href;
		assert.throws(
			() =>
				restore(path, bytes, {
					readSource(location) {
						const original = originals.get(location.href);
						return location.href === target
							? Buffer.concat([original, Buffer.from([0])])
							: original;
					},
				}),
			/dependency changed/,
			dependency,
		);
	}
});

test('forging the receipt cannot preserve its independent pin', async (t) => {
	const directory = await mkdtemp(join(tmpdir(), 'scsp-loop-link-receipt-'));
	t.after(() => rm(directory, { recursive: true, force: true }));
	const modulePath = join(directory, 'scripts/mixer_calibration_scsp_loop_link_revision.mjs');
	const jsonPath = join(directory, receiptPath);
	await mkdir(dirname(modulePath), { recursive: true });
	await mkdir(dirname(jsonPath), { recursive: true });
	await writeFile(
		modulePath,
		await read('scripts/mixer_calibration_scsp_loop_link_revision.mjs'),
	);
	const forged = structuredClone(receipt);
	forged.sources[paths[0]].after.sha256 = '0'.repeat(64);
	await writeFile(jsonPath, JSON.stringify(forged));
	const isolated = await import(pathToFileURL(modulePath));
	assert.throws(
		() => isolated.restoreMixerCalibrationScspLoopLinkRevision(paths[0], Buffer.alloc(1)),
		/independently pinned/,
	);
});

test('predecessor and current omitted / false APIs run the exact measured references with identical native PCM and writes', async () => {
	const before = restore(
		'tetorica_src/runtime/scspsynth.js',
		await read('tetorica_src/runtime/scspsynth.js'),
	);
	const OldSynth = vm.runInNewContext(
		before
			.toString()
			.replace(/^import .*;\n/gm, '')
			.replace(/^export /gm, '') + '\nScspSynth;',
		{
			noteToHz,
			SCSP_SAMPLE_RATE: 44100,
			SCSP_RAM_BYTES: 524288,
			Int8Array,
			Int16Array,
			Uint8Array,
			DataView,
			Array,
			Map,
			Math,
			Number,
			RangeError,
			TypeError,
			Error,
		},
	);
	const wasmBinary = await read('docs/generated/scsp_wasm.wasm');
	let verifiedFrames = 0;
	for (const role of ['primary', 'extra'])
		for (const frequencyHz of [220, 440, 880]) {
			const runs = [];
			try {
				for (const [Type, explicitFalse] of [
					[OldSynth, false],
					[ScspSynth, false],
					[ScspSynth, true],
				]) {
					const core = await Scsp.create({
							moduleFactory: factory,
							moduleOptions: { wasmBinary },
						}),
						writes = [];
					const write = core.write.bind(core);
					core.write = (...args) => {
						writes.push(args);
						return write(...args);
					};
					const synth = new Type(core);
					runs.push({ synth, core, writes });
					if (explicitFalse) {
						const set = synth.setPreset.bind(synth);
						synth.setPreset = (slot, patch) =>
							set(slot, {
								...patch,
								...(patch.envelope
									? { envelope: { ...patch.envelope, loopLink: false } }
									: {}),
							});
					}
					const program = buildScspCalibrationReference(frequencyHz, { role }).setup;
					const execute = new Function(
						'useSoundChip',
						'createSoundChip',
						'context',
						`return (async()=>{${program}})();`,
					);
					await execute(
						async () => synth,
						async () => synth,
						{},
					);
				}
				for (const frames of [1, 127, 4096, 44100]) {
					const expected = runs[0].synth.generateStereo(frames);
					assert.deepEqual(
						runs[1].synth.generateStereo(frames),
						expected,
						`${role}/${frequencyHz}/omitted/${frames}`,
					);
					assert.deepEqual(
						runs[2].synth.generateStereo(frames),
						expected,
						`${role}/${frequencyHz}/false/${frames}`,
					);
					verifiedFrames += frames;
				}
				for (const { synth } of runs) synth.keyOff(0);
				const released = runs[0].synth.generateStereo(6615);
				for (const run of runs.slice(1))
					assert.deepEqual(run.synth.generateStereo(6615), released);
				assert.deepEqual(runs[1].writes, runs[0].writes);
				assert.deepEqual(runs[2].writes, runs[0].writes);
				for (const run of runs) {
					run.synth.reset();
					assert.equal(run.core.read(10) & 0x4000, 0);
				}
			} finally {
				for (const { synth } of runs) synth.dispose();
			}
		}
	assert.equal(verifiedFrames, 289944);
});

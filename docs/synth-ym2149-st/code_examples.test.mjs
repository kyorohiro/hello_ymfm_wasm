import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { addYmCodeExamples, YM_CODE_EXAMPLES } from './code_examples.js';
import { createYmCodeProject, YM_PROJECT_FILE_BYTES } from './code_project.js';
import { loadPlaygroundCassette } from '../playground/playground_cassette.js';
import { Ay8910 } from '../js/ay8910.js';
import {
	buildAyOperations,
	compileAyOperations,
	createAyOperationResetState,
} from '../js/ay8910_operations.js';
import ayFactory from '../generated/ay8910_wasm.js';

const examplePaths = Object.keys(YM_CODE_EXAMPLES),
	encoder = new TextEncoder();

test('adding YM examples keeps saved source, sound, selection and input mode; edited examples are idempotent', () => {
	const project = createYmCodeProject({
		starterCode: 'throw new Error("saved Code must not run when adding examples");',
	});
	project.importFiles([
		{ path: '/notes.md', data: 'My unfinished composition' },
		{ path: '/data/opaque.bin', type: 'binary', data: Uint8Array.of(0, 255, 19) },
	]);
	project.select('/notes.md');
	project.setCodeState({ mode: 'keyboard', path: '/index.js' });
	const before = project.snapshot(), savedFiles = project.fs.list();

	assert.deepEqual(addYmCodeExamples(project), examplePaths);
	for (const file of savedFiles) assert.deepEqual(project.fs.get(file.path), file);
	for (const [path, source] of Object.entries(YM_CODE_EXAMPLES)) {
		assert.equal(project.fs.get(path).type, 'text');
		assert.equal(project.fs.get(path).data, source);
	}
	assert.deepEqual(project.settings, before.settings);
	assert.equal(project.selectedPath, before.selectedPath);
	assert.deepEqual(project.getCodeState(), before.codeState);
	assert.equal(project.cassetteName, before.name);

	project.writeEditorText(examplePaths[0], '// my edited buzzer\n');
	const edited = project.snapshot();
	assert.deepEqual(addYmCodeExamples(project), []);
	assert.deepEqual(project.snapshot(), edited);
});

test('YM examples preserve existing files and directory collisions, including case variants', async (t) => {
	for (const kind of ['file', 'directory']) {
		for (const uppercase of [false, true]) {
			await t.test(`${kind}, ${uppercase ? 'case variant' : 'exact path'}`, () => {
				const project = createYmCodeProject({ starterCode: '// keep index' }),
					collision = uppercase ? examplePaths[0].toUpperCase() : examplePaths[0];
				if (kind === 'file') project.importFiles([{ path: collision, data: '// keep user example' }]);
				else project.fs.mkdir(collision, { recursive: true });
				project.select(collision);
				project.setCodeState({ mode: 'code', path: '/index.js' });
				const before = project.snapshot();

				assert.deepEqual(addYmCodeExamples(project), examplePaths.slice(1));
				if (kind === 'file') assert.equal(project.fs.get(collision).data, '// keep user example');
				else assert.equal(project.fs.stat(collision).type, 'directory');
				if (uppercase) assert.equal(project.fs.has(examplePaths[0]), false);
				assert.equal(project.selectedPath, before.selectedPath);
				assert.deepEqual(project.getCodeState(), before.codeState);
				assert.equal(project.fs.get('/index.js').data, '// keep index');
				assert.deepEqual(addYmCodeExamples(project), []);
			});
		}
	}
});

test('an example parent occupied by a file rejects without partially adding Files', () => {
	const project = createYmCodeProject({ starterCode: '// saved entry' });
	project.importFiles([{ path: '/examples', data: 'a user file, not a folder' }]);
	project.select('/examples');
	const before = project.snapshot();
	assert.throws(() => addYmCodeExamples(project), /directory|file|parent/i);
	assert.deepEqual(project.snapshot(), before);
});

test('YM example capacity failure is atomic even when the first example would fit', () => {
	const project = createYmCodeProject({ starterCode: '// saved entry' }),
		sizes = Object.values(YM_CODE_EXAMPLES).map(source => encoder.encode(source).byteLength),
		freeBytes = sizes[0] + Math.floor(sizes.slice(1).reduce((sum, size) => sum + size, 0) / 2),
		usedBytes = encoder.encode(project.fs.get('/index.js').data).byteLength;
	assert(freeBytes >= sizes[0] && freeBytes < sizes.reduce((sum, size) => sum + size, 0));
	project.importFiles([{
		path: '/padding.bin', type: 'binary',
		data: new Uint8Array(YM_PROJECT_FILE_BYTES - usedBytes - freeBytes),
	}]);
	project.select('/padding.bin');
	project.setCodeState({ mode: 'code', path: '/index.js' });
	const before = project.snapshot();
	let changes = 0;
	project.onDidChange(() => changes++);

	assert.throws(() => addYmCodeExamples(project), /16 MiB/);
	assert.deepEqual(project.snapshot(), before);
	assert.equal(changes, 0, 'rejected insertion must not notify a partial project change');
});

test('YM examples and user edits round-trip through the existing Cassette project format', async () => {
	const project = createYmCodeProject({ starterCode: '// saved user entry\n' });
	addYmCodeExamples(project);
	project.writeEditorText(examplePaths[0], YM_CODE_EXAMPLES[examplePaths[0]] + '\n// user variation\n');
	project.importFiles([{ path: '/data/saved.bin', type: 'binary', data: Uint8Array.of(0, 255, 128) }]);
	project.fs.mkdir('/examples/empty', { recursive: true });
	project.select(examplePaths[0]);
	project.setCodeState({ mode: 'code', path: examplePaths[0] });
	const bytes = project.exportProject(), cassette = await loadPlaygroundCassette(bytes);
	for (const path of examplePaths) {
		assert.deepEqual(cassette.files.get(path.slice(1)), encoder.encode(project.fs.get(path).data));
	}
	const copy = createYmCodeProject({ starterCode: '// destination entry' }),
		beforeImport = copy.snapshot(),
		prepared = await copy.prepareImport(bytes);
	assert.deepEqual(copy.snapshot(), beforeImport, 'preparing a Cassette must not replace live Files');
	copy.restore(prepared);
	for (const file of project.fs.list()) {
		assert.equal(copy.fs.get(file.path).type, file.type);
		assert.deepEqual(copy.fs.get(file.path).data, file.data);
	}
	assert(copy.fs.listDirectories().includes('/examples/empty'));
	assert.equal(copy.selectedPath, project.selectedPath);
	assert.deepEqual(copy.getCodeState(), project.getCodeState());
	assert.deepEqual(copy.settings, project.settings);
	const restored = copy.snapshot();
	assert.deepEqual(addYmCodeExamples(copy), []);
	assert.deepEqual(copy.snapshot(), restored);
});

const ymClock = 2_000_000,
	envelopePeriod = 100,
	retriggerHz = 100,
	wasmBinary = readFileSync(new URL('../generated/ay8910_wasm.wasm', import.meta.url));

function envelopePlan(retrigger) {
	return buildAyOperations(b => {
		// Isolate the shared envelope: both generators disabled, only CH1 uses it.
		b.setVoice(0, { tone: false, noise: false, volume: 0, envelope: true });
		b.keyOff(1);
		b.keyOff(2);
		b.setEnvelope({ period: envelopePeriod, shape: 8 });
		if (retrigger) {
			for (let index = 1; index < retriggerHz; index++) {
				b.atSeconds(index / retriggerHz).setEnvelope({ shape: 8 });
			}
		}
	});
}

async function renderCompiled(rows, sampleRate) {
	const chip = await Ay8910.create({
		moduleFactory: ayFactory, moduleOptions: { wasmBinary },
		clock: ymClock, type: 0x10, flags: 1, sampleRate,
	});
	try {
		const pcm = new Float32Array(sampleRate), writes = [];
		let frame = 0;
		for (const row of rows) {
			const targetFrame = Math.round(row.offsetSeconds * sampleRate);
			assert(targetFrame >= frame && targetFrame < pcm.length);
			if (targetFrame > frame) pcm.set(chip.generateStereo(targetFrame - frame).left, frame);
			chip.writeRegister(row.register, row.value);
			writes.push({ frame: targetFrame, register: row.register, value: row.value });
			frame = targetFrame;
		}
		if (frame < pcm.length) pcm.set(chip.generateStereo(pcm.length - frame).left, frame);
		return { pcm, writes };
	} finally {
		chip.dispose();
	}
}

function differenceRms(left, right, lag = 0, start = 0) {
	let sum = 0, count = 0;
	for (let index = start; index + lag < right.length && index < left.length; index++) {
		sum += (left[index] - right[index + lag]) ** 2;
		count++;
	}
	return Math.sqrt(sum / count);
}

for (const sampleRate of [44100, 48000]) {
	test(`shipped YM2149 WASM: same-value R13 retriggers force the isolated envelope at ${sampleRate} Hz`, async () => {
		// Yamaha specifies 32 steps and fE = master/(256*EP), giving 78.125 Hz here:
		// https://ftpmirror.your.org/pub/misc/bitsavers/components/yamaha/YM2149_199209.pdf
		// Carré documents timer-driven R13 writes as Sync Buzzer (preserved original):
		// https://www.lynn3686.com/ym3456_tidy.html
		const naturalRows = compileAyOperations(envelopePlan(false), createAyOperationResetState(), { clock: ymClock }),
			syncRows = compileAyOperations(envelopePlan(true), createAyOperationResetState(), { clock: ymClock }),
			periodFrames = sampleRate / retriggerHz,
			r13 = syncRows.filter(row => row.register === 13);
		assert.equal(naturalRows.filter(row => row.register === 13).length, 1);
		assert.equal(r13.length, retriggerHz, 'compilation retains every repeated write of shape 8');
		assert(r13.every(row => row.value === 8));
		assert.deepEqual(r13.map(row => Math.round(row.offsetSeconds * sampleRate)),
			Array.from({ length: retriggerHz }, (_, index) => index * periodFrames));

		const natural = await renderCompiled(naturalRows, sampleRate),
			sync = await renderCompiled(syncRows, sampleRate);
		assert.deepEqual(sync.writes.filter(row => row.register === 13).map(row => row.frame),
			r13.map(row => Math.round(row.offsetSeconds * sampleRate)));
		assert(natural.pcm.every(Number.isFinite) && sync.pcm.every(Number.isFinite));
		const range = Math.max(...sync.pcm) - Math.min(...sync.pcm), start = periodFrames * 2;
		assert(range > 0.01, 'the isolated hardware envelope must produce a varying waveform');
		assert(differenceRms(natural.pcm, sync.pcm, 0, start) > range * 0.1,
			'periodic same-value R13 writes measurably change the free-running envelope');
		assert(differenceRms(sync.pcm, sync.pcm, periodFrames, start) < range * 1e-5,
			'the deliberately aligned 100 Hz case repeats every 441/480 output frames');
		assert(differenceRms(natural.pcm, natural.pcm, periodFrames, start) > range * 0.1,
			'the natural 78.125 Hz envelope must not already have the imposed 100 Hz period');
		const naturalPeriodFrames = Math.round(sampleRate * 256 * envelopePeriod / ymClock);
		assert(differenceRms(natural.pcm, natural.pcm, naturalPeriodFrames, start) < range * 0.04,
			'the control waveform agrees with the documented natural period within one output sample');
	});
}

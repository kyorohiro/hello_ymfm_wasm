import test from 'node:test';
import assert from 'node:assert/strict';
import {
	createYmCodeProject,
	createYmProjectStore,
	readYmProjectSound,
	YM_PROJECT_MANIFEST,
	YM_PROJECT_FILE_BYTES,
	YM_PROJECT_STORAGE_KEY,
} from './code_project.js';
import { createDefaultPreset } from './preset.js';
import {
	createPlaygroundCassetteZip,
	loadPlaygroundCassette,
} from '../playground/playground_cassette.js';

test('YM2149 ST project ZIP retains detached sound settings, opaque Files and JSON editor mode without executing', async () => {
	const settings = createDefaultPreset();
	settings.voices[0].period = 283;
	const p = createYmCodeProject({ settings, starterCode: 'globalThis.mustNotRun=true;' }),
		json = JSON.stringify(settings) + '\n';
	p.importFiles([
		{ path: '/presets/Wave.ym2149-st.json', data: json },
		{ path: '/data/raw.bin', type: 'binary', data: Uint8Array.of(0, 255, 17) },
	]);
	p.select('/presets/Wave.ym2149-st.json');
	p.setCodeState({ mode: 'keyboard', path: '/presets/Wave.ym2149-st.json' });
	const snapshot = p.snapshot();
	snapshot.settings.voices[0].period = 999;
	assert.equal(p.settings.voices[0].period, 283);
	const copy = createYmCodeProject(),
		prepared = await copy.prepareImport(p.exportProject());
	assert.equal(copy.fs.list().length, 0);
	copy.restore(prepared);
	assert.deepEqual(copy.settings, settings);
	assert.deepEqual(copy.getCodeState(), { mode: 'keyboard', path: '/presets/Wave.ym2149-st.json' });
	assert.equal(copy.fs.get('/presets/Wave.ym2149-st.json').data, json);
	assert.deepEqual(copy.fs.get('/data/raw.bin').data, Uint8Array.of(0, 255, 17));
	assert.equal(globalThis.mustNotRun, undefined);
	const cassette = await loadPlaygroundCassette(copy.exportProject());
	assert(cassette.files.has(YM_PROJECT_MANIFEST.slice(1)));
	assert.deepEqual(readYmProjectSound(json), settings);
});

test('YM2149 ST files use current virtual modules and detached binary reads', async () => {
	const p = createYmCodeProject({ starterCode: '// starter' });
	p.importFiles([
		{
			path: '/lib/notes.js',
			data: 'export const note=(await file("../data/note.json",{type:"json"})).note;',
		},
		{ path: '/data/note.json', data: '{"note":"E4"}' },
		{ path: '/data/raw.bin', type: 'binary', data: Uint8Array.of(4, 255) },
	]);
	const context = {};
	await new (Object.getPrototypeOf(async function () {}).constructor)(
		'context',
		p.prepareSource('context.note=(await import("./lib/notes.js")).note;'),
	)(context);
	delete globalThis.__tetoricaVirtualFiles;
	assert.deepEqual(context, { note: 'E4' });
	new Uint8Array(await p.readFile('/data/raw.bin', { type: 'arrayBuffer' })).fill(0);
	assert.deepEqual(
		new Uint8Array(await p.readFile('/data/raw.bin', { type: 'arrayBuffer' })),
		Uint8Array.of(4, 255),
	);
});

test('invalid YM2149 ST settings, manifests and capacity reject atomically; unfinished JSON remains editable', () => {
	const p = createYmCodeProject({ starterCode: 'kept' }),
		before = p.snapshot();
	assert.throws(() => p.restore({ ...before, settings: { ...before.settings, voices: [] } }));
	assert.deepEqual(p.snapshot(), before);
	assert.throws(
		() => p.restore({ ...before, codeState: { mode: 'code', path: '/missing.json' } }),
		/selection/,
	);
	assert.deepEqual(p.snapshot(), before);
	assert.throws(
		() =>
			p.importFiles([
				{
					path: '/too-large.bin',
					type: 'binary',
					data: new Uint8Array(YM_PROJECT_FILE_BYTES),
				},
			]),
		/16 MiB/,
	);
	assert.deepEqual(p.snapshot(), before);
	assert.throws(
		() => p.importFiles([{ path: YM_PROJECT_MANIFEST, data: 'reserved' }]),
		/reserved/,
	);
	p.importFiles([{ path: '/unfinished.json', data: '{not finished' }]);
	p.setCodeState({ mode: 'code', path: '/unfinished.json' });
	assert.equal(p.fs.get('/unfinished.json').data, '{not finished');
	assert.equal(readYmProjectSound('{"ordinary":1}'), null);
	assert.throws(() =>
		readYmProjectSound({ ...createDefaultPreset(), voices: [{ tone: true }] }),
	);
});

test('generic cassette keeps existing YM2149 ST settings and supplied JS instead of reseeding a starter', async () => {
	const settings = createDefaultPreset();
	settings.noisePeriod = 7;
	settings.voices[0].noise = true;
	const p = createYmCodeProject({ settings, getStarterCode: () => 'starter' }),
		zip = createPlaygroundCassetteZip([{ path: '/index.js', type: 'text', data: 'imported' }]);
	p.restore(await p.prepareImport(zip));
	assert.equal(p.fs.get('/index.js').data, 'imported');
	assert.deepEqual(p.settings, settings);
	const restored = createYmCodeProject({
		snapshot: p.snapshot(),
		getStarterCode: () => assert.fail('No reseed'),
	});
	assert.equal(restored.fs.get('/index.js').data, 'imported');
});

test('JSON editor paths and large text preserve separate JS and total project limits', () => {
	const p = createYmCodeProject({ starterCode: '// js' }),
		large = 'x'.repeat(2 * 1024 * 1024 + 1);
	p.importFiles([{ path: '/notes.json', data: large }]);
	p.writeEditorText('/notes.json', large + '!');
	assert.equal(p.fs.get('/notes.json').data.length, large.length + 1);
	assert.throws(() => p.writeEditorText('/index.js', large), /2 MiB/);
	assert.equal(p.fs.get('/index.js').data, '// js');
	p.importFiles([{ path: '/binary.bin', type: 'binary', data: Uint8Array.of(1) }]);
	assert.throws(() => p.setCodeState({ mode: 'code', path: '/binary.bin' }), /selection/);
	p.setCodeState({ mode: 'code', path: '/notes.json' });
	assert.deepEqual(createYmCodeProject({ snapshot: p.snapshot() }).getCodeState(), {
		mode: 'code',
		path: '/notes.json',
	});
});

test('YM2149 ST local store has its own namespace and retains binary snapshots', async () => {
	const values = new Map([['tetorica-spu-synth-project-v1', 'SPU kept']]),
		storage = {
			getItem: (key) => values.get(key) ?? null,
			setItem: (key, value) => values.set(key, value),
		};
	const store = createYmProjectStore({ indexedDB: null, storage }),
		p = createYmCodeProject();
	p.importFiles([{ path: '/raw.bin', type: 'binary', data: Uint8Array.of(3, 255) }]);
	assert.equal(await store.read(), null);
	await store.write(p.snapshot());
	assert(values.has(YM_PROJECT_STORAGE_KEY));
	const copy = createYmCodeProject({ snapshot: await store.read() });
	assert.deepEqual(copy.fs.get('/raw.bin').data, Uint8Array.of(3, 255));
	assert.equal(values.get('tetorica-spu-synth-project-v1'), 'SPU kept');
	assert.match(
		values.get(YM_PROJECT_STORAGE_KEY),
		/"\$ymBytes"/,
		'the existing fallback encoding is retained',
	);
	await store.close();
});

test('YM2149 ST reads an existing fallback project without replacing its settings, Code or binary files', async () => {
	const preset = createDefaultPreset();
	preset.voices[0].volume = 3;
	const project = createYmCodeProject({
		settings: preset,
		starterCode: '// existing YM2149 ST source\n',
	});
	project.importFiles([
		{ path: '/raw/sample.bin', type: 'binary', data: Uint8Array.of(0, 128, 255) },
	]);
	project.setCodeState({ mode: 'code', path: '/index.js' });
	const legacy = JSON.stringify(project.snapshot(), (_key, value) =>
		value instanceof Uint8Array ? { $ymBytes: Array.from(value) } : value,
	);
	const values = new Map([[YM_PROJECT_STORAGE_KEY, legacy]]),
		storage = {
			getItem: (key) => values.get(key) ?? null,
			setItem: () => assert.fail('Read never replaces the stored project'),
		};
	const store = createYmProjectStore({ indexedDB: null, storage }),
		restored = createYmCodeProject({ snapshot: await store.read() });
	assert.deepEqual(restored.snapshot(), project.snapshot());
	assert.equal(values.get(YM_PROJECT_STORAGE_KEY), legacy);
	await store.close();
});


test('YM2149 ST metadata listing caches Files and returns detached entries', () => {
 const project=createYmCodeProject({starterCode:'x'});
 project.importFiles([{path:'/data/opaque.bin',type:'binary',data:Uint8Array.of(1,2,3)}]);
 let lists=0;
 const list=project.fs.list.bind(project.fs);
 project.fs.list=()=>{lists++;return list();};
 const first=project.listEntries();
 project.select('/data/opaque.bin');
 const second=project.listEntries();
 assert.equal(lists,1);
 assert.deepEqual(first,second);
 first[0].path='mutated';
 assert.notEqual(project.listEntries()[0].path,'mutated');
});

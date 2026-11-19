import test from 'node:test';
import assert from 'node:assert/strict';
import {
	createAswanCodeProject,
	createAswanProjectStore,
	readAswanProjectSound,
	ASWAN_PROJECT_MANIFEST,
	ASWAN_PROJECT_FILE_BYTES,
	ASWAN_PROJECT_STORAGE_KEY,
} from './code_project.js';
import { createDefaultPreset } from './preset.js';
import {
	createPlaygroundCassetteZip,
	loadPlaygroundCassette,
} from '../playground/playground_cassette.js';

test('ASWAN project ZIP retains detached sound settings, opaque Files and JSON editor mode without executing', async () => {
	const settings = createDefaultPreset();
	settings.source = 'wave';
	settings.wave[4] = 1;
	const p = createAswanCodeProject({ settings, starterCode: 'globalThis.mustNotRun=true;' }),
		json = JSON.stringify(settings) + '\n';
	p.importFiles([
		{ path: '/presets/Wave.aswan.json', data: json },
		{ path: '/data/raw.bin', type: 'binary', data: Uint8Array.of(0, 255, 17) },
	]);
	p.select('/presets/Wave.aswan.json');
	p.setCodeState({ mode: 'keyboard', path: '/presets/Wave.aswan.json' });
	const snapshot = p.snapshot();
	snapshot.settings.wave[4] = 15;
	assert.equal(p.settings.wave[4], 1);
	const copy = createAswanCodeProject(),
		prepared = await copy.prepareImport(p.exportProject());
	assert.equal(copy.fs.list().length, 0);
	copy.restore(prepared);
	assert.deepEqual(copy.settings, settings);
	assert.deepEqual(copy.getCodeState(), { mode: 'keyboard', path: '/presets/Wave.aswan.json' });
	assert.equal(copy.fs.get('/presets/Wave.aswan.json').data, json);
	assert.deepEqual(copy.fs.get('/data/raw.bin').data, Uint8Array.of(0, 255, 17));
	assert.equal(globalThis.mustNotRun, undefined);
	const cassette = await loadPlaygroundCassette(copy.exportProject());
	assert(cassette.files.has(ASWAN_PROJECT_MANIFEST.slice(1)));
	assert.deepEqual(readAswanProjectSound(json), settings);
});

test('ASWAN files use current virtual modules and detached binary reads', async () => {
	const p = createAswanCodeProject({ starterCode: '// starter' });
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

test('invalid ASWAN settings, manifests and capacity reject atomically; unfinished JSON remains editable', () => {
	const p = createAswanCodeProject({ starterCode: 'kept' }),
		before = p.snapshot();
	assert.throws(() => p.restore({ ...before, settings: { ...before.settings, source: 'fds' } }));
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
					data: new Uint8Array(ASWAN_PROJECT_FILE_BYTES),
				},
			]),
		/16 MiB/,
	);
	assert.deepEqual(p.snapshot(), before);
	assert.throws(
		() => p.importFiles([{ path: ASWAN_PROJECT_MANIFEST, data: 'reserved' }]),
		/reserved/,
	);
	p.importFiles([{ path: '/unfinished.json', data: '{not finished' }]);
	p.setCodeState({ mode: 'code', path: '/unfinished.json' });
	assert.equal(p.fs.get('/unfinished.json').data, '{not finished');
	assert.equal(readAswanProjectSound('{"ordinary":1}'), null);
	assert.throws(() =>
		readAswanProjectSound({ ...createDefaultPreset(), wave: { samples: [], level: 1 } }),
	);
});

test('generic cassette keeps existing ASWAN settings and supplied JS instead of reseeding a starter', async () => {
	const settings = createDefaultPreset();
	settings.noise.type = 7;
	settings.source = 'noise';
	const p = createAswanCodeProject({ settings, getStarterCode: () => 'starter' }),
		zip = createPlaygroundCassetteZip([{ path: '/index.js', type: 'text', data: 'imported' }]);
	p.restore(await p.prepareImport(zip));
	assert.equal(p.fs.get('/index.js').data, 'imported');
	assert.deepEqual(p.settings, settings);
	const restored = createAswanCodeProject({
		snapshot: p.snapshot(),
		getStarterCode: () => assert.fail('No reseed'),
	});
	assert.equal(restored.fs.get('/index.js').data, 'imported');
});

test('JSON editor paths and large text preserve separate JS and total project limits', () => {
	const p = createAswanCodeProject({ starterCode: '// js' }),
		large = 'x'.repeat(2 * 1024 * 1024 + 1);
	p.importFiles([{ path: '/notes.json', data: large }]);
	p.writeEditorText('/notes.json', large + '!');
	assert.equal(p.fs.get('/notes.json').data.length, large.length + 1);
	assert.throws(() => p.writeEditorText('/index.js', large), /2 MiB/);
	assert.equal(p.fs.get('/index.js').data, '// js');
	p.importFiles([{ path: '/binary.bin', type: 'binary', data: Uint8Array.of(1) }]);
	assert.throws(() => p.setCodeState({ mode: 'code', path: '/binary.bin' }), /selection/);
	p.setCodeState({ mode: 'code', path: '/notes.json' });
	assert.deepEqual(createAswanCodeProject({ snapshot: p.snapshot() }).getCodeState(), {
		mode: 'code',
		path: '/notes.json',
	});
});

test('ASWAN local store has its own namespace and retains binary snapshots', async () => {
	const values = new Map([['tetorica-spu-synth-project-v1', 'SPU kept']]),
		storage = {
			getItem: (key) => values.get(key) ?? null,
			setItem: (key, value) => values.set(key, value),
		};
	const store = createAswanProjectStore({ indexedDB: null, storage }),
		p = createAswanCodeProject();
	p.importFiles([{ path: '/raw.bin', type: 'binary', data: Uint8Array.of(3, 255) }]);
	assert.equal(await store.read(), null);
	await store.write(p.snapshot());
	assert(values.has(ASWAN_PROJECT_STORAGE_KEY));
	const copy = createAswanCodeProject({ snapshot: await store.read() });
	assert.deepEqual(copy.fs.get('/raw.bin').data, Uint8Array.of(3, 255));
	assert.equal(values.get('tetorica-spu-synth-project-v1'), 'SPU kept');
	assert.match(
		values.get(ASWAN_PROJECT_STORAGE_KEY),
		/"\$aswanBytes"/,
		'the existing fallback encoding is retained',
	);
	await store.close();
});

test('ASWAN reads an existing fallback project without replacing its settings, Code or binary files', async () => {
	const preset = createDefaultPreset();
	preset.source = 'wave';
	preset.wave[7] = 3;
	const project = createAswanCodeProject({
		settings: preset,
		starterCode: '// existing ASWAN source\n',
	});
	project.importFiles([
		{ path: '/raw/sample.bin', type: 'binary', data: Uint8Array.of(0, 128, 255) },
	]);
	project.setCodeState({ mode: 'code', path: '/index.js' });
	const legacy = JSON.stringify(project.snapshot(), (_key, value) =>
		value instanceof Uint8Array ? { $aswanBytes: Array.from(value) } : value,
	);
	const values = new Map([[ASWAN_PROJECT_STORAGE_KEY, legacy]]),
		storage = {
			getItem: (key) => values.get(key) ?? null,
			setItem: () => assert.fail('Read never replaces the stored project'),
		};
	const store = createAswanProjectStore({ indexedDB: null, storage }),
		restored = createAswanCodeProject({ snapshot: await store.read() });
	assert.deepEqual(restored.snapshot(), project.snapshot());
	assert.equal(values.get(ASWAN_PROJECT_STORAGE_KEY), legacy);
	await store.close();
});

test('ASWAN original VGM/VGZ Files are opaque, collision-safe and survive project ZIP unchanged', async () => {
	const project = createAswanCodeProject({ starterCode: 'author code' });
	project.fs.mkdir('/vgm/SONG.vgm', { recursive: true });
	const original = Uint8Array.of(0x1f, 0x8b, 8, 0, 255),
		paths = project.importSongSources([
			{ name: 'Song.vgm', bytes: original },
			{ name: 'Song.vgm', bytes: original },
			{ name: '曲.vgz', bytes: original },
		]);
	assert.deepEqual(paths, ['/vgm/Song-2.vgm', '/vgm/Song-3.vgm', '/vgm/曲.vgz']);
	original[0] = 0;
	assert.equal(project.fs.get(paths[0]).data[0], 31);
	const restored = createAswanCodeProject({
		snapshot: await project.prepareImport(project.exportProject()),
	});
	assert.deepEqual(restored.fs.get(paths[2]).data, Uint8Array.of(31, 139, 8, 0, 255));
	assert.equal(restored.fs.get('/index.js').data, 'author code');
	assert.equal(restored.getCodeState().mode, 'keyboard');
});

test('ASWAN multi-song capacity failure is atomic and metadata listing does not recopy binary on selections', () => {
	const project = createAswanCodeProject({ starterCode: 'x' });
	project.importSongSources([{ name: 'kept.vgm', bytes: Uint8Array.of(1, 2, 3) }]);
	const before = project.snapshot();
	assert.throws(
		() =>
			project.importSongSources([
				{ name: 'small.vgm', bytes: Uint8Array.of(4) },
				{ name: 'large.vgz', bytes: new Uint8Array(ASWAN_PROJECT_FILE_BYTES) },
			]),
		/16 MiB/,
	);
	assert.deepEqual(project.snapshot(), before);
	let lists = 0;
	const list = project.fs.list.bind(project.fs);
	project.fs.list = () => {
		lists++;
		return list();
	};
	const first = project.listEntries();
	project.select('/vgm/kept.vgm');
	const second = project.listEntries();
	assert.equal(lists, 1);
	assert.deepEqual(first, second);
	first[0].path = 'mutated';
	assert.notEqual(project.listEntries()[0].path, 'mutated');
});

test('ASWAN v1 drafts migrate with Wave/Noise/Sweep/Voice PCM, Files and selection intact', async () => {
	const settings = createDefaultPreset();
	settings.source = 'wave';
	settings.noise.type = 5;
	settings.wave[3] = 12;
	settings.sweep.enabled = true;
	const old = createAswanCodeProject({settings, starterCode: '// original'});
	old.importSongSources([{name: 'original.vgz', bytes: Uint8Array.of(0, 128, 255)}]);
	old.fs.mkdir('/empty', {recursive: true});
	old.select('/index.js');
	old.setCodeState({mode: 'code', path: '/index.js'});
	const {workspace, ...legacy} = old.snapshot();
	legacy.version = 1;
	const migrated = createAswanCodeProject({snapshot: legacy});
	assert.equal(migrated.snapshot().version, 2);
	assert.equal(migrated.autoApply, true);
	assert.deepEqual(migrated.settings, settings);
	assert.deepEqual(migrated.fs.snapshot(), migrated.savedFs.snapshot());
	assert.equal(migrated.selectedPath, '/index.js');
	assert.deepEqual(migrated.getCodeState(), legacy.codeState);
	assert.deepEqual(migrated.getDirtyPaths(), []);
	// Also cover a legacy ZIP, not just the local-draft representation.
	const {filesystem, ...manifest} = legacy;
	const zip = createPlaygroundCassetteZip([
		...old.fs.list(),
		{path: ASWAN_PROJECT_MANIFEST, type: 'text', data: JSON.stringify(manifest)},
	], {directories: old.fs.listDirectories(), preserveMetadataFiles: true});
	migrated.restore(await migrated.prepareImport(zip));
	assert.deepEqual(migrated.settings, settings);
	assert.deepEqual(migrated.fs.get('/vgm/original.vgz').data, Uint8Array.of(0, 128, 255));
	assert(migrated.savedFs.stat('/empty'));
});

test('ASWAN Save/Discard keeps independent accepted files and exact binary bytes', () => {
	const p = createAswanCodeProject({starterCode: 'accepted'});
	p.importFiles([{path: '/data/raw.bin', type: 'binary', data: Uint8Array.of(0, 255)}]);
	assert.equal(p.autoApply, true);
	p.setAutoApply(false);
	p.writeEditorText('/index.js', 'draft');
	p.fs.writeBinary('/data/raw.bin', Uint8Array.of(1, 254));
	assert.equal(p.savedFs.get('/index.js').data, 'accepted');
	assert.equal(p.isFileModified('/index.js'), true);
	p.saveFiles(['/index.js']);
	assert.equal(p.savedFs.get('/index.js').data, 'draft');
	assert.equal(p.isFileModified('/index.js'), false);
	assert.equal(p.isFileModified('/data/raw.bin'), true);
	p.discardFiles(['/data/raw.bin']);
	assert.deepEqual(p.fs.get('/data/raw.bin').data, Uint8Array.of(0, 255));
	p.writeEditorText('/index.js', 'all saved');
	p.saveAll();
	assert.equal(p.savedFs.get('/index.js').data, 'all saved');
	p.writeEditorText('/index.js', 'auto accepted');
	p.setAutoApply(true);
	assert.equal(p.savedFs.get('/index.js').data, 'auto accepted');
	assert.deepEqual(p.getDirtyPaths(), []);
});

test('ASWAN v2 Cassette uses ordinary saved files plus recoverable working differences', async () => {
	const p = createAswanCodeProject({starterCode: '// accepted'});
	p.importFiles([
		{path: '/data/raw.bin', type: 'binary', data: Uint8Array.of(2, 128)},
		{path: '/vgm/reference.vgz', type: 'binary', data: Uint8Array.of(0, 255, 5)},
		{path: '/remove.txt', type: 'text', data: 'old'},
		{path: '/metadata.json', type: 'text', data: '{"user":"kept"}'},
	]);
	p.fs.mkdir('/old-empty', {recursive: true});
	p.setAutoApply(false);
	p.writeEditorText('/index.js', '// working');
	p.fs.writeBinary('/data/raw.bin', Uint8Array.of(3, 129));
	p.fs.remove('/remove.txt');
	p.fs.remove('/old-empty');
	p.fs.mkdir('/new-empty', {recursive: true});
	p.fs.writeText('/unfinished.json', '{unfinished');
	p.select('/unfinished.json');
	p.setCodeState({mode: 'keyboard', path: '/unfinished.json'});
	const zip = p.exportProject(), cassette = await loadPlaygroundCassette(zip);
	assert.equal(new TextDecoder().decode(cassette.files.get('index.js')), '// accepted');
	assert.deepEqual(cassette.files.get('data/raw.bin'), Uint8Array.of(2, 128));
	const manifest = JSON.parse(new TextDecoder().decode(cassette.files.get(ASWAN_PROJECT_MANIFEST.slice(1))));
	assert.equal(manifest.filesystem, undefined);
	assert.equal(manifest.workspace, undefined);
	assert(!manifest.workingDelta.files.some(file => file.path === '/vgm/reference.vgz'), 'unchanged source is not duplicated');
	const copy = createAswanCodeProject();
	copy.restore(await copy.prepareImport(zip));
	assert.equal(copy.autoApply, false);
	assert.equal(copy.fs.get('/index.js').data, '// working');
	assert.equal(copy.savedFs.get('/index.js').data, '// accepted');
	assert.deepEqual(copy.fs.get('/data/raw.bin').data, Uint8Array.of(3, 129));
	assert.deepEqual(copy.savedFs.get('/data/raw.bin').data, Uint8Array.of(2, 128));
	assert.equal(copy.fs.get('/remove.txt'), null);
	assert.equal(copy.savedFs.get('/remove.txt').data, 'old');
	assert(copy.fs.stat('/new-empty'));
	assert(copy.savedFs.stat('/old-empty'));
	assert.equal(copy.fs.get('/metadata.json').data, '{"user":"kept"}');
	assert.equal(copy.fs.get('/unfinished.json').data, '{unfinished');
	assert.equal(copy.selectedPath, '/unfinished.json');
	assert.deepEqual(copy.getCodeState(), p.getCodeState());
	assert.deepEqual(copy.getDirtyPaths(), p.getDirtyPaths());
});

test('ASWAN saved Code compiles an accepted entry, modules and data without running drafts', async () => {
	const p = createAswanCodeProject({starterCode: 'context.value=(await import("./lib.js")).value;'});
	p.importFiles([
		{path: '/lib.js', data: 'export const value=(await file("./data.json",{type:"json"})).value;'},
		{path: '/data.json', data: '{"value":"accepted"}'},
	]);
	p.setAutoApply(false);
	p.writeEditorText('/index.js', 'throw Error("draft executed");');
	p.writeEditorText('/lib.js', 'throw Error("draft module executed");');
	p.writeEditorText('/data.json', '{"value":"draft"}');
	const context = {}, AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
	try {
		await new AsyncFunction('context', p.prepareSavedSource(p.fs.get('/index.js').data))(context);
		assert.equal(context.value, 'accepted');
		assert.equal((await p.readSavedFile('/data.json', {type: 'json'})).value, 'accepted');
		assert.equal((await p.readFile('/data.json', {type: 'json'})).value, 'draft');
	} finally { delete globalThis.__tetoricaVirtualFiles; }
	p.fs.writeText('/new.js', '// not saved');
	assert.throws(() => p.prepareSavedSource('// not saved', {path: '/new.js'}), /Save/);
});

test('ASWAN invalid two-version snapshots and recoveries reject before changing the project', async () => {
	const p = createAswanCodeProject({starterCode: '// kept'});
	p.setAutoApply(false);
	p.writeEditorText('/index.js', '// working');
	const before = p.snapshot();
	const inconsistent = structuredClone(before);
	inconsistent.filesystem.files.find(file => file.path === '/index.js').data = 'inconsistent';
	assert.throws(() => p.restore(inconsistent), /Inconsistent/);
	assert.deepEqual(p.snapshot(), before);
	const invalidSaved = structuredClone(before);
	invalidSaved.workspace.saved.files.push({path: ASWAN_PROJECT_MANIFEST, type: 'text', data: 'reserved'});
	assert.throws(() => p.restore(invalidSaved), /reserved/);
	assert.deepEqual(p.snapshot(), before);
	const cassette = await loadPlaygroundCassette(p.exportProject());
	const manifest = JSON.parse(new TextDecoder().decode(cassette.files.get(ASWAN_PROJECT_MANIFEST.slice(1))));
	manifest.workingDelta.files.push({path: '/index.js', type: 'text', data: 'duplicate'});
	const zip = createPlaygroundCassetteZip([
		{path: '/index.js', type: 'text', data: '// kept'},
		{path: ASWAN_PROJECT_MANIFEST, type: 'text', data: JSON.stringify(manifest)},
	]);
	await assert.rejects(p.prepareImport(zip), /Duplicate/);
	assert.deepEqual(p.snapshot(), before);
	const small = createAswanCodeProject({starterCode: '// valid'});
	small.setAutoApply(false);
	small.fs.writeBinary('/too-large.bin', new Uint8Array(ASWAN_PROJECT_FILE_BYTES));
	assert.throws(() => small.saveAll(), /16 MiB/);
	assert.equal(small.savedFs.has('/too-large.bin'), false);
	assert.throws(() => small.setAutoApply(true), /16 MiB/);
	assert.equal(small.autoApply, false);
});

test('ASWAN pending Code recovery retains both versions without accepting or executing a draft', () => {
	const p = createAswanCodeProject({starterCode: '// original'});
	p.recoverCode('/index.js', {source: '// pending', savedSource: '// accepted', autoSave: false});
	assert.equal(p.autoApply, false);
	assert.equal(p.fs.get('/index.js').data, '// pending');
	assert.equal(p.savedFs.get('/index.js').data, '// accepted');
	assert.equal(p.isFileModified('/index.js'), true);
	p.recoverCode('/new.js', {source: '// unsaved new file', savedSource: null, autoSave: false});
	assert.equal(p.savedFs.has('/new.js'), false);
	const before = p.snapshot();
	assert.throws(() => p.recoverCode('/index.js', {source: 'x'.repeat(2*1024*1024+1), savedSource: '// kept', autoSave: false}), /2 MiB/);
	assert.deepEqual(p.snapshot(), before);
	assert.throws(() => p.recoverCode(ASWAN_PROJECT_MANIFEST, {source: '{}', savedSource: null, autoSave: false}), /recovery path/);
	assert.deepEqual(p.snapshot(), before);
});

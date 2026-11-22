import test from 'node:test';
import assert from 'node:assert/strict';
import { setupAswanCodeFiles } from './code_files.js';
import { createAswanCodeProject, ASWAN_PROJECT_FILE_BYTES } from './code_project.js';
import { createDefaultPreset, readPreset } from './preset.js';
import { createWonderSwanSampleVgm } from '../../test/helpers/wonderswan_sample_vgm_fixture.mjs';

class Element {
	constructor(doc, tag = 'div') {
		Object.assign(this, {
			ownerDocument: doc,
			tagName: tag.toUpperCase(),
			children: [],
			listeners: new Map(),
			attributes: {},
			dataset: {},
			style: {},
			parentNode: null,
			hidden: false,
			value: '',
			disabled: false,
		});
		const names = new Set();
		this.classList = {
			toggle: (name, on) => (on ? names.add(name) : names.delete(name)),
			contains: (name) => names.has(name),
			add: (name) => names.add(name),
			remove: (name) => names.delete(name),
		};
	}
	append(...nodes) {
		for (const node of nodes) {
			node.parentNode = this;
			this.children.push(node);
		}
	}
	appendChild(node) {
		this.append(node);
		return node;
	}
	replaceChildren(...nodes) {
		for (const node of this.children) node.parentNode = null;
		this.children = [];
		this.append(...nodes);
	}
	remove() {
		if (this.parentNode)
			this.parentNode.children = this.parentNode.children.filter((node) => node !== this);
		this.parentNode = null;
	}
	setAttribute(key, value) {
		this.attributes[key] = String(value);
	}
	getAttribute(key) {
		return this.attributes[key] ?? null;
	}
	addEventListener(type, fn) {
		if (!this.listeners.has(type)) this.listeners.set(type, new Set());
		this.listeners.get(type).add(fn);
	}
	removeEventListener(type, fn) {
		this.listeners.get(type)?.delete(fn);
	}
	querySelectorAll(selector) {
		return walk(this).filter((node) => selector === 'button' && node.tagName === 'BUTTON');
	}
	focus() {
		this.ownerDocument.activeElement = this;
	}
	blur() {
		if (this.ownerDocument.activeElement === this) this.ownerDocument.activeElement = null;
	}
	select() {}
	showModal() {
		this.open = true;
	}
	close() {
		this.open = false;
	}
	async fire(type, extra = {}) {
		const event = { target: this, preventDefault() {}, stopPropagation() {}, ...extra };
		for (const fn of this.listeners.get(type) ?? []) await fn(event);
	}
}
const walk = (node) => [node, ...node.children.flatMap(walk)],
	deferred = () => {
		let resolve;
		const promise = new Promise((r) => (resolve = r));
		return { promise, resolve };
	};
function fixture(t, options = {}) {
	const doc = new Element(null, 'document');
	doc.ownerDocument = doc;
	doc.body = doc;
	doc.createElement = (tag) => new Element(doc, tag);
	doc.getElementById = (id) => walk(doc).find((node) => node.id === id);
	doc.defaultView = new Element(doc, 'window');
	const main = new Element(doc);
	main.id = 'aswanSynthMain';
	doc.append(main);
	doc.querySelector = (selector) => (selector === '.aswan-main' ? main : null);
	for (const id of ['aswanFilesPanel', 'aswanFilesToggle', 'synthWorkspace']) {
		const node = new Element(doc);
		node.id = id;
		node.hidden = id === 'aswanFilesPanel';
		doc.append(node);
	}
	const select = new Element(doc, 'select');
	select.id = 'aswanPresetSelect';
	doc.append(select);
	const previous = globalThis.document;
	globalThis.document = doc;

	let settings = readPreset(options.settings ?? createDefaultPreset());
	const project = options.project ?? createAswanCodeProject({ settings, starterCode: '// kept' }),
		writes = [],
		calls = [],
		opened = [],
		statuses = [];
	const store = options.store ?? {
		read: async () => null,
		write: async (value) => {
			writes.push(structuredClone(value));
			return true;
		},
		close: async () => {},
	};
	const files = setupAswanCodeFiles({
		project,
		document: doc,
		store,
		getSettings: () => settings,
		applySettings: async (value) => {
			calls.push(['apply', value]);
			settings = readPreset(value);
		},
		onBeforeSoundApply: async () => calls.push(['sound']),
		onBeforeWorkspaceReplace: async () => calls.push(['before']),
		setStatus: (message) => statuses.push(message),
		...options,
	});
	files.setCodeControls({
		flush: async () => true,
		openFile: async (path, options) => {
			opened.push({ path, options });
			return true;
		},
		setBusy() {},
	});
	t.after(async () => { try { await files.dispose(); } finally { globalThis.document = previous; } });
	return {
		files,
		project,
		doc,
		writes,
		calls,
		opened,
		statuses,
		setSettings(value) {
			settings = readPreset(value);
		},
	};
}

test('ASWAN saves named presets without acquiring audio, applying or changing Code mode/focus', async (t) => {
	const f = fixture(t);
	await f.files.ready;
	let flushes = 0;
	f.files.setCodeControls({
		activePath: '/index.js',
		executionPath: '/index.js',
		isCodeMode: () => false,
		setBusy() {},
		flush: async () => {
			flushes++;
			return true;
		},
		openFile: async (path, options) => f.opened.push({ path, options }),
		stop: () => assert.fail('Save never stops'),
		workspaceReplaced: () => assert.fail('Save never replaces'),
	});
	const one = await f.files.saveSound();
	assert.equal(one, '/presets/Sine.aswan.json');
	assert.deepEqual(JSON.parse(f.project.fs.get(one).data), createDefaultPreset());
	f.project.fs.mkdir('/presets/SINE (2).aswan.json');
	const two = await f.files.saveSound();
	assert.equal(two, '/presets/Sine (3).aswan.json');
	assert.deepEqual(
		f.opened,
		[one, two].map((path) => ({ path, options: { show: false } })),
	);
	assert.deepEqual(f.calls, []);
	assert.equal(f.doc.getElementById('aswanFilesPanel').hidden, false);
	assert.equal(f.doc.getElementById('aswanFileTextEditor'), undefined);
	assert.equal(
		f.doc.getElementById('aswanPresetSelect').value,
		'',
		'Saving does not imply a preset was loaded',
	);
});

test('ASWAN file selection preserves mode, text edits do not apply, explicit valid preset selection does', async (t) => {
	const f = fixture(t);
	await f.files.ready;
	let mode = false;
	f.files.setCodeControls({
		flush: async () => true,
		isCodeMode: () => mode,
		openFile: async (path, options) => f.opened.push({ path, options }),
		setBusy() {},
	});
	f.project.importFiles([
		{ path: '/notes.json', data: '{}' },
		{ path: '/presets/Sine.aswan.json', data: JSON.stringify(createDefaultPreset()) },
		{ path: '/unfinished.json', data: '{unfinished' },
	]);
	for (const path of ['/index.js', '/notes.json', '/presets/Sine.aswan.json', '/unfinished.json'])
		await f.files.selectFile(path);
	assert(f.opened.every((entry) => entry.options.show === false));
	assert.deepEqual(
		f.calls.map((entry) => entry[0]),
		['sound', 'apply'],
	);
	assert.match(f.statuses.at(-1), /current sound kept/);
	mode = true;
	await f.files.selectFile('/notes.json');
	assert.equal(f.opened.at(-1).options.show, true);
	f.project.writeEditorText('/notes.json', '{"unfinished":');
	await f.files.persistCode();
	assert.equal(f.calls.length, 2);
});

test('ASWAN JSON selection cancels pending execution before waiting for flush', async (t) => {
	const f = fixture(t);
	await f.files.ready;
	f.project.importFiles([{ path: '/notes.json', data: '{}' }]);
	const gate = deferred(),
		events = [];
	f.files.setCodeControls({
		cancelPendingExecution() {
			events.push('cancel');
		},
		flush: async () => {
			events.push('flush');
			await gate.promise;
		},
		openFile: async () => events.push('open'),
		setBusy() {},
	});
	const pending = f.files.selectFile('/notes.json');
	assert.deepEqual(events, ['cancel']);
	await Promise.resolve();
	assert.deepEqual(events, ['cancel', 'flush']);
	gate.resolve();
	await pending;
	assert.deepEqual(events, ['cancel', 'flush', 'open']);
});

test('ASWAN sound selection has a separate hook and failed/cancelled apply never marks a preset loaded', async (t) => {
	let result = false,
		settings = createDefaultPreset();
	const f = fixture(t, {
		getSettings: () => settings,
		applySettings: async (value) => {
			if (result instanceof Error) throw result;
			if (result) settings = value;
			return result;
		},
		onBeforeWorkspaceReplace: () => assert.fail('A sound is not a workspace replacement'),
	});
	await f.files.ready;
	const next = createDefaultPreset();
	next.source = 'wave';
	f.project.importFiles([{ path: '/Selected.aswan.json', data: JSON.stringify(next) }]);
	const previous = f.project.settings;
	const initialSelection = f.project.selectedPath;
	assert.equal(await f.files.selectFile('/Selected.aswan.json'), false);
	assert.deepEqual(f.project.settings, previous);
	assert.equal(f.project.selectedPath, initialSelection);
	result = Error('upload failed');
	await assert.rejects(f.files.selectFile('/Selected.aswan.json'), /upload failed/);
	assert.deepEqual(f.project.settings, previous);
	assert.equal(f.doc.getElementById('aswanPresetSelect').value, '');
	assert.deepEqual(
		f.calls.map((call) => call[0]),
		['sound', 'sound'],
	);
	result = true;
	assert.equal(await f.files.selectFile('/Selected.aswan.json'), true);
	assert.deepEqual(f.project.settings, next);
});

test('a Stop after sound commit persists the reconciled host sound without marking the cancelled selection applied', async (t) => {
	let settings = createDefaultPreset();
	const next = structuredClone(settings);
	next.source = 'noise';
	const f = fixture(t, {
		getSettings: () => settings,
		applySettings: async () => {
			settings = next;
			return false;
		},
	});
	await f.files.ready;
	f.project.importFiles([{ path: '/Selected.aswan.json', data: JSON.stringify(next) }]);
	const selected = f.project.selectedPath;
	assert.equal(await f.files.selectFile('/Selected.aswan.json'), false);
	assert.deepEqual(f.project.settings, next);
	assert.equal(f.project.selectedPath, selected);
	assert.equal(f.doc.getElementById('aswanPresetSelect').value, '');
	await f.files.persistCode();
	assert.deepEqual(f.writes.at(-1).settings, next);
});

test('ASWAN duplicate/rename/delete preserve binary data and stop only the executed JS path', async (t) => {
	const f = fixture(t);
	await f.files.ready;
	f.project.importFiles([
		{ path: '/folder/code.js', data: 'kept' },
		{ path: '/folder/raw.bin', type: 'binary', data: Uint8Array.of(0, 255) },
	]);
	let stops = 0;
	const changes = [];
	f.files.setCodeControls({
		activePath: '/notes.json',
		executionPath: '/folder/code.js',
		flush: async () => true,
		isCodeMode: () => false,
		openFile: async () => true,
		pathChanged: (...args) => changes.push(args),
		stop: async () => {
			stops++;
		},
		setBusy() {},
	});
	const copy = await f.files.duplicate('/folder');
	assert.equal(copy, '/folder-copy');
	assert.deepEqual(f.project.fs.get('/folder-copy/raw.bin').data, Uint8Array.of(0, 255));
	assert.equal(stops, 0);
	await f.files.move('/folder-copy/code.js', '/folder-copy/code.json');
	assert.equal(stops, 0);
	await f.files.remove('/folder-copy');
	assert.equal(stops, 0);
	await f.files.move('/folder/code.js', '/folder/code.json');
	assert.equal(stops, 1);
	assert.deepEqual(changes.at(-1), ['/folder/code.js', '/folder/code.json']);
});

test('ASWAN Files Undo restores both versions, pending paths, and the editor without running Code', async t => {
	const f = fixture(t);
	await f.files.ready;
	const undo = f.doc.getElementById('aswanFileUndoButton');
	assert.equal(undo.disabled, true);
	const bytes = Uint8Array.of(0, 255, 24);
	f.project.importFiles([{ path: '/data/raw.bin', type: 'binary', data: bytes }]);
	f.project.setAutoApply(false);
	f.project.writeEditorText('/index.js', '// working draft');
	f.project.select('/index.js');
	f.project.setCodeState({ mode: 'code', path: '/index.js' });
	const before = f.project.snapshot();
	const restored = [];
	let retired = 0;
	f.files.setCodeControls({
		flush: async () => true, setBusy() {},
		workspaceReplaced: async () => { retired++; },
		pathChanged: (source, destination) => {
			if (f.project.getCodeState().path === source) f.project.setCodeState({ mode: 'code', path: destination });
		},
		restoreState: async state => { restored.push(state); },
		run: () => assert.fail('Undo must never run Code'),
	});
	await f.files.createFile('/new.js');
	await f.files.duplicate('/data');
	await f.files.move('/index.js', '/renamed.js');
	assert.equal(f.project.fs.get('/renamed.js')?.data, '// working draft');
	await f.files.saveAll();
	assert.equal(f.project.savedFs.get('/renamed.js')?.data, '// working draft');
	assert.equal(await f.files.undo(), true);
	assert.equal(f.project.savedFs.get('/index.js')?.data, '// kept');
	assert.deepEqual(f.project.getPendingMoves(), [['/index.js', '/renamed.js']]);
	await f.files.remove('/renamed.js');
	assert.equal(undo.disabled, false);
	await undo.fire('click');
	await new Promise(resolve => setImmediate(resolve));
	assert.equal(f.project.fs.get('/renamed.js')?.data, '// working draft', f.statuses.at(-1));
	assert.deepEqual(f.project.getPendingMoves(), [['/index.js', '/renamed.js']]);
	assert.equal(await f.files.undo(), true);
	assert.equal(f.project.fs.get('/index.js').data, '// working draft');
	assert.equal(f.project.savedFs.get('/index.js').data, '// kept');
	assert(!f.project.fs.has('/renamed.js'));
	assert.equal(await f.files.undo(), true);
	assert(!f.project.fs.has('/data-copy'));
	assert.deepEqual(f.project.fs.get('/data/raw.bin').data, bytes);
	assert.equal(await f.files.undo(), true);
	assert.deepEqual(f.project.snapshot(), before);
	assert.deepEqual(restored.at(-1), before.codeState);
	assert.equal(retired, 5);
	assert.equal(undo.disabled, true);
	assert.equal(f.writes.at(-1).workspace.working.files.find(file => file.path === '/index.js')?.data, '// working draft');
});

test('ASWAN Files Undo rolls back a failed editor restoration and can be retried', async t => {
	const f = fixture(t);
	await f.files.ready;
	await f.files.createFile('/keep-on-failure.js');
	const current = f.project.snapshot(), identity = f.files.workspaceId;
	let shouldFail = true;
	f.files.setCodeControls({
		flush: async () => true, setBusy() {}, workspaceReplaced: async () => true,
		restoreState: async () => {
			if (!shouldFail) return true;
			shouldFail = false;
			return false;
		},
	});
	assert.equal(await f.files.undo(), false);
	assert.deepEqual(f.project.snapshot(), current);
	assert.equal(f.files.workspaceId, identity);
	assert.equal(await f.files.undo(), true);
	assert(!f.project.fs.has('/keep-on-failure.js'));
});

test('ASWAN Files Undo retains only the last 20 operations and starts fresh for a new Cassette', async t => {
	const f = fixture(t);
	await f.files.ready;
	for (let index = 0; index < 21; index++) await f.files.createFile(`/edit-${index}.js`);
	for (let index = 0; index < 20; index++) assert.equal(await f.files.undo(), true);
	assert.equal(await f.files.undo(), false);
	assert(f.project.fs.has('/edit-0.js'));
	assert(!f.project.fs.has('/edit-1.js'));
	await f.files.createFile('/before-new.js');
	assert.equal(await f.files.newProject(), true);
	assert.equal(await f.files.undo(), false);
});

test('ASWAN local restore and project import apply detached settings but never execute source', async (t) => {
	const preset = createDefaultPreset();
	preset.source = 'wave';
	preset.wave[2] = 3;
	const saved = createAswanCodeProject({
		settings: preset,
		starterCode: 'throw Error("never run")',
	});
	saved.setCodeState({ mode: 'code', path: '/index.js' });
	const f = fixture(t, {
		store: {
			read: async () => ({
				...saved.snapshot(),
				workspaceId: 'restored-aswan',
				filesVisible: true,
			}),
			write: async () => true,
			close: async () => {},
		},
	});
	await f.files.ready;
	assert.equal(f.files.workspaceId, 'restored-aswan');
	assert.deepEqual(f.project.settings, preset);
	assert.deepEqual(f.files.getCodeState(), { mode: 'code', path: '/index.js' });
	assert.deepEqual(
		f.calls.map((entry) => entry[0]),
		['before', 'apply'],
	);
	f.files.setCodeControls({
		flush: async () => true,
		workspaceReplaced: async () => true,
		restoreState: async () => {},
		setBusy() {},
	});
	await f.files.importProject(saved.exportProject());
	assert.equal(f.project.fs.get('/index.js').data, 'throw Error("never run")');
	assert.deepEqual(f.project.settings, preset);
});

test('ASWAN malformed imports and capacity failure leave Files atomic', async (t) => {
	const gate = deferred();
	const f = fixture(t, {
		store: {
			read: async () => {
				await gate.promise;
				return null;
			},
			write: async () => true,
			close: async () => {},
		},
	});
	gate.resolve();
	await f.files.ready;
	const before = f.project.snapshot();
	await assert.rejects(f.files.importProject(Uint8Array.of(1, 2, 3)));
	assert.deepEqual(f.project.snapshot(), before);
	f.project.importFiles([
		{
			path: '/padding.bin',
			type: 'binary',
			data: new Uint8Array(ASWAN_PROJECT_FILE_BYTES - 100),
		},
	]);
	const full = f.project.snapshot();
	await assert.rejects(f.files.saveSound(), /16 MiB/);
	assert.deepEqual(f.project.snapshot(), full);
	assert.equal(f.doc.querySelector('.aswan-main').inert, false);
});

test('late ASWAN file reads cannot overwrite a newer edit or a disposed workspace', async (t) => {
	const f = fixture(t);
	await f.files.ready;
	const gate = deferred();
	const pending = f.files.importFiles([
		{ name: 'stale.txt', size: 4, arrayBuffer: () => gate.promise },
	]);
	await f.files.createFile('/new.js');
	f.project.writeEditorText('/new.js', 'latest unflushed text');
	gate.resolve(new TextEncoder().encode('late').buffer);
	assert.deepEqual(await pending, []);
	assert(!f.project.fs.has('/stale.txt'));
	assert.equal(f.project.fs.get('/new.js').data, 'latest unflushed text');
	const disposedRead = deferred(),
		late = f.files.importFiles([
			{ name: 'after-close.txt', size: 4, arrayBuffer: () => disposedRead.promise },
		]);
	await f.files.dispose();
	disposedRead.resolve(new TextEncoder().encode('late').buffer);
	assert.deepEqual(await late, []);
	assert(!f.project.fs.has('/after-close.txt'));
});

test('an external import generation can cancel a pending read without a newer Files operation', async (t) => {
	const f = fixture(t);
	await f.files.ready;
	const before = f.project.snapshot(),
		gate = deferred();
	let current = true,
		secondReads = 0,
		flushes = 0;
	f.files.setCodeControls({
		flush: async () => {
			flushes++;
			return true;
		},
		setBusy() {},
	});
	const pending = f.files.importFiles(
		[
			{ name: 'superseded.aswan.json', size: 2, arrayBuffer: () => gate.promise },
			{
				name: 'never-read.txt',
				size: 1,
				arrayBuffer: async () => {
					secondReads++;
					return Uint8Array.of(1).buffer;
				},
			},
		],
		{ isCurrent: () => current },
	);
	await Promise.resolve();
	current = false;
	gate.resolve(new TextEncoder().encode('{}').buffer);
	assert.deepEqual(await pending, []);
	assert.deepEqual(f.project.snapshot(), before);
	assert.equal(secondReads, 0);
	assert.equal(flushes, 0);
	assert.deepEqual(f.calls, []);
	let reads = 0;
	assert.deepEqual(
		await f.files.importFiles(
			[
				{
					name: 'already-old.txt',
					size: 1,
					arrayBuffer: async () => {
						reads++;
						return new ArrayBuffer(1);
					},
				},
			],
			{ isCurrent: () => false },
		),
		[],
	);
	assert.equal(reads, 0);
});

test('an externally superseded import cannot commit after a pending editor flush', async (t) => {
	const f = fixture(t);
	await f.files.ready;
	const before = f.project.snapshot(),
		gate = deferred();
	let current = true,
		entered;
	const begun = new Promise((resolve) => (entered = resolve));
	f.files.setCodeControls({
		flush: async () => {
			entered();
			await gate.promise;
			return true;
		},
		setBusy() {},
	});
	const pending = f.files.importFiles(
		[
			{
				name: 'superseded.json',
				size: 2,
				arrayBuffer: async () => new TextEncoder().encode('{}').buffer,
			},
		],
		{ isCurrent: () => current },
	);
	await begun;
	current = false;
	gate.resolve();
	assert.deepEqual(await pending, []);
	assert.deepEqual(f.project.snapshot(), before);
	assert.deepEqual(f.calls, []);
});

test('external import invalidation is checked after workspace retirement and before atomic replacement', async (t) => {
	const f = fixture(t);
	await f.files.ready;
	const before = f.project.snapshot(),
		gate = deferred();
	let current = true,
		entered;
	const begun = new Promise((resolve) => (entered = resolve));
	f.files.setCodeControls({
		activePath: '/index.js',
		executionPath: '/index.js',
		flush: async () => true,
		setBusy() {},
		workspaceReplaced: async () => {
			entered();
			await gate.promise;
			return true;
		},
		restoreState: () => assert.fail('A cancelled replacement must not restore Code'),
	});
	const pending = f.files.importFiles(
		[
			{
				name: 'index.js',
				size: 4,
				arrayBuffer: async () => new TextEncoder().encode('late').buffer,
			},
		],
		{ isCurrent: () => current },
	);
	await begun;
	current = false;
	gate.resolve();
	assert.deepEqual(await pending, []);
	assert.deepEqual(f.project.snapshot(), before);
	assert.equal(f.doc.querySelector('.aswan-main').inert, false);
});

test('ASWAN local Files restoration retains a preset edited while storage was pending', async (t) => {
	const gate = deferred(),
		old = createAswanCodeProject({ starterCode: 'restored code' }),
		f = fixture(t, {
			store: { read: () => gate.promise, write: async () => true, close: async () => {} },
		});
	const edited = createDefaultPreset();
	edited.source = 'wave';
	edited.wave[0] = 3;
	f.setSettings(edited);
	f.files.markSoundDirty();
	gate.resolve(old.snapshot());
	await f.files.ready;
	assert.deepEqual(f.project.settings, edited);
	assert.deepEqual(f.calls.at(-1), ['apply', edited]);
	assert.equal(f.project.fs.get('/index.js').data, 'restored code');
});

test('ASWAN automatically persists an early sound edit after a slow successful startup read', async (t) => {
	const gate = deferred(),
		saved = createAswanCodeProject({ starterCode: '// durable source' }),
		writes = [];
	saved.importFiles([
		{ path: '/raw/kept.bin', type: 'binary', data: Uint8Array.of(0, 128, 255) },
	]);
	const f = fixture(t, {
		store: {
			read: () => gate.promise,
			write: async (value) => {
				writes.push(structuredClone(value));
				return true;
			},
			close: async () => {},
		},
	});
	await Promise.resolve();
	// A selection change schedules a normal save while the source read is
	// pending. Let that debounce expire before allowing restoration to finish.
	f.files.rememberCodeState({ mode: 'code', path: '/index.js' });
	const edited = createDefaultPreset();
	edited.source = 'wave';
	edited.wave[1] = 3;
	f.setSettings(edited);
	f.files.markSoundDirty();
	await new Promise((resolve) => setTimeout(resolve, 150));
	assert.equal(writes.length, 0);
	gate.resolve(saved.snapshot());
	await f.files.ready;
	await new Promise((resolve) => setTimeout(resolve, 150));
	assert.equal(
		writes.length,
		1,
		'successful startup must reschedule the early edited sound without a manual save',
	);
	const restored = createAswanCodeProject({ snapshot: writes[0] });
	assert.deepEqual(restored.settings, edited);
	assert.equal(restored.fs.get('/index.js').data, '// durable source');
	assert.deepEqual(restored.fs.get('/raw/kept.bin').data, Uint8Array.of(0, 128, 255));
});

test('ASWAN persistence waits for successful startup restoration and never reloads state during later saves', async (t) => {
	const gate = deferred(),
		old = createAswanCodeProject({ starterCode: '// durable source' }),
		writes = [];
	let reads = 0;
	old.importFiles([{ path: '/raw/kept.bin', type: 'binary', data: Uint8Array.of(0, 255) }]);
	const f = fixture(t, {
		store: {
			read: () => {
				reads++;
				return gate.promise;
			},
			write: async (value) => {
				writes.push(structuredClone(value));
				return true;
			},
			close: async () => {},
		},
	});
	await Promise.resolve();
	assert.equal(await f.files.persistCode(), false);
	assert.equal(writes.length, 0, 'pending startup read must not save a default workspace');
	const edited = createDefaultPreset();
	edited.source = 'wave';
	edited.wave[0] = 2;
	f.setSettings(edited);
	f.files.markSoundDirty();
	gate.resolve(old.snapshot());
	await f.files.ready;
	assert.equal(reads, 1);
	assert.deepEqual(f.project.settings, edited);
	f.project.writeEditorText('/index.js', '// latest live source');
	assert.equal(await f.files.persistCode(), true);
	assert.equal(reads, 1, 'save/reconnect never reruns startup restoration');
	assert.equal(
		writes.at(-1).filesystem.files.find((file) => file.path === '/index.js').data,
		'// latest live source',
	);
	assert.deepEqual(f.project.fs.get('/raw/kept.bin').data, Uint8Array.of(0, 255));
});

test('ASWAN unread or invalid initial drafts cannot be overwritten by later edits, Files operations or disposal', async (t) => {
	for (const failure of ['read', 'invalid'])
		await t.test(failure, async (t) => {
			const writes = [],
				durable = createAswanCodeProject({ starterCode: '// stored source' }).snapshot();
			const f = fixture(t, {
				store: {
					read: async () => {
						if (failure === 'read')
							throw new DOMException('Injected backend read error', 'UnknownError');
						return { ...durable, format: 'invalid' };
					},
					write: async (value) => {
						writes.push(value);
						return true;
					},
					close: async () => {},
				},
			});
			await f.files.ready;
			assert.match(f.statuses.at(-1), /Local project restore failed/);
			const edited = createDefaultPreset();
			edited.source = 'noise';
			f.setSettings(edited);
			f.files.markSoundDirty();
			f.project.writeEditorText('/index.js', '// unsaved current edit');
			assert.equal(await f.files.persistCode(), false);
			await f.files.createFile('/notes.txt');
			assert.equal(writes.length, 0);
			const exported = await f.files.exportProject(),
				copy = createAswanCodeProject();
			copy.restore(await copy.prepareImport(exported));
			assert.equal(copy.fs.get('/index.js').data, '// unsaved current edit');
			assert.deepEqual(copy.settings, edited);
			await f.files.dispose();
			assert.equal(writes.length, 0, 'shutdown must not save defaults over an unread draft');
		});
});

test('ASWAN Load VGM and Add files retain exact sources under unique /vgm paths without audio or Code mode changes', async (t) => {
	const f = fixture(t);
	await f.files.ready;
	let flushes = 0;
	f.files.setCodeControls({
		activePath: '/index.js',
		executionPath: '/index.js',
		isCodeMode: () => true,
		flush: async () => {
			flushes++;
			return true;
		},
		setBusy() {},
		openFile: () => assert.fail('Song import does not open Code'),
		workspaceReplaced: () => assert.fail('Song import does not stop Code'),
	});
	const data = Uint8Array.of(31, 139, 8, 255),
		path = await f.files.saveSongSource({ name: 'Original.VGZ', bytes: data });
	assert.equal(path, '/vgm/Original.VGZ');
	assert.deepEqual(f.project.fs.get(path).data, data);
	assert.equal(f.project.selectedPath, path);
	const source = createWonderSwanSampleVgm();
	const paths = await f.files.importFiles([
		{ name: 'Original.vgm', size: source.length, arrayBuffer: async () => source.buffer },
	]);
	assert(paths.includes('/vgm/Original.vgm'));
	assert(paths.some((path) => path.startsWith('/presets/Original/')));
	const previous = f.project.snapshot();
	await assert.rejects(
		f.files.importFiles([
			{ name: 'invalid.vgm', size: 1, arrayBuffer: async () => Uint8Array.of(0).buffer },
		]),
	);
	assert.deepEqual(f.project.snapshot(), previous);
	assert.equal(await f.files.selectFile(path), true);
	assert.match(f.statuses.at(-1), /Press Play.*instrument is kept/);
	assert.deepEqual(f.calls, []);
	assert(flushes >= 3);
});

test('ASWAN song save preflights total capacity after flushing and rejects stale/disposed requests', async (t) => {
	const f = fixture(t);
	await f.files.ready;
	let current = true;
	const gate = deferred();
	f.files.setCodeControls({
		flush: async () => {
			await gate.promise;
			return true;
		},
		setBusy() {},
	});
	const pending = f.files.saveSongSource(
		{ name: 'stale.vgm', bytes: Uint8Array.of(1) },
		{ isCurrent: () => current },
	);
	current = false;
	gate.resolve();
	assert.equal(await pending, false);
	assert(!f.project.fs.has('/vgm/stale.vgm'));
	f.files.setCodeControls({ flush: async () => true, setBusy() {} });
	f.project.importFiles([
		{
			path: '/padding.bin',
			type: 'binary',
			data: new Uint8Array(ASWAN_PROJECT_FILE_BYTES - 10),
		},
	]);
	const before = f.project.snapshot();
	await assert.rejects(
		f.files.saveSongSource({ name: 'large.vgm', bytes: new Uint8Array(20) }),
		/16 MiB/,
	);
	assert.deepEqual(f.project.snapshot(), before);
	await f.files.dispose();
	assert.equal(
		await f.files.saveSongSource({ name: 'after.vgm', bytes: Uint8Array.of(1) }),
		false,
	);
});

test('ASWAN Capture atomically keeps old/new presets and untouched song bytes/revision, without changing Code mode', async (t) => {
	const f = fixture(t);
	await f.files.ready;
	const raw = Uint8Array.of(0, 255, 17);
	f.project.importSongSources([{ name: 'song.vgm', bytes: raw }]);
	const sourcePath = '/vgm/song.vgm',
		revision = f.project.fs.getRevision(sourcePath);
	let flushes = 0;
	f.files.setCodeControls({
		activePath: '/index.js',
		executionPath: null,
		isCodeMode: () => false,
		setBusy() {},
		flush: async () => {
			if (flushes++ === 0) f.project.writeEditorText('/index.js', 'latest editor draft');
			return true;
		},
		openFile: async (path, options) => f.opened.push({ path, options }),
		stop: () => assert.fail('Capture Files never stops a transport'),
		workspaceReplaced: () => assert.fail('Capture does not replace Code'),
	});
	const original = readPreset(createDefaultPreset()),
		captured = readPreset(original);
	captured.source = 'wave';
	captured.wave[0] = 1;
	const result = await f.files.saveCapturedSound(captured, {
		apply: async (value, { isCurrent }) => {
			assert(isCurrent());
			f.setSettings(value);
		},
	});
	assert.equal(result.originalPath, '/presets/Sine.aswan.json');
	assert.equal(result.path, '/presets/Sine (2).aswan.json');
	assert.deepEqual(JSON.parse(f.project.fs.get(result.originalPath).data), original);
	assert.deepEqual(JSON.parse(f.project.fs.get(result.path).data), captured);
	assert.deepEqual(f.project.settings, captured);
	assert.equal(f.project.fs.get('/index.js').data, 'latest editor draft');
	assert.equal(f.project.fs.getRevision(sourcePath), revision);
	assert.deepEqual(f.project.fs.get(sourcePath).data, raw);
	assert.deepEqual(f.opened, [{ path: result.path, options: { show: false } }]);
	assert.deepEqual(f.calls, []);
	assert.equal(flushes, 1);
});

test('ASWAN Capture preflight/failed/stale apply leaves Files and source selection untouched', async (t) => {
	const f = fixture(t);
	await f.files.ready;
	const before = f.project.snapshot();
	await assert.rejects(
		f.files.saveCapturedSound(createDefaultPreset(), {
			apply: async () => {
				throw Error('apply failed');
			},
		}),
		/apply failed/,
	);
	assert.deepEqual(f.project.snapshot(), before);
	let current = true;
	assert.equal(
		await f.files.saveCapturedSound(createDefaultPreset(), {
			isCurrent: () => current,
			apply: async () => {
				current = false;
			},
		}),
		false,
	);
	assert.deepEqual(f.project.snapshot(), before);
	f.project.importFiles([
		{
			path: '/padding.bin',
			type: 'binary',
			data: new Uint8Array(ASWAN_PROJECT_FILE_BYTES - 20),
		},
	]);
	const full = f.project.snapshot();
	await assert.rejects(
		f.files.saveCapturedSound(createDefaultPreset(), {
			apply: () => assert.fail('Capacity must be checked before author changes'),
		}),
		/16 MiB/,
	);
	assert.deepEqual(f.project.snapshot(), full);
});

test('ASWAN committed Capture remains successful if Stop cancels the pending Code display', async (t) => {
	const f = fixture(t);
	await f.files.ready;
	const gate = deferred();
	let current = true;
	f.files.setCodeControls({
		flush: async () => true,
		setBusy() {},
		openFile: () => gate.promise,
	});
	const captured = createDefaultPreset();
	captured.name = 'Committed Capture';
	captured.source = 'noise';
	const saving = f.files.saveCapturedSound(captured, {
		isCurrent: () => current,
		apply: async (value) => f.setSettings(value),
	});
	while (!f.project.fs.has('/presets/Committed Capture.aswan.json')) await Promise.resolve();
	current = false;
	gate.resolve();
	const result = await saving;
	assert.equal(result.committed, true);
	assert.equal(result.path, '/presets/Committed Capture.aswan.json');
	assert.deepEqual(f.project.settings, captured);
	assert.deepEqual(JSON.parse(f.project.fs.get(result.path).data), captured);
	assert(f.writes.some((snapshot) => snapshot.settings.source === 'noise'));
});

test('ASWAN committed Capture survives an editor display rejection and still persists the two presets', async (t) => {
	const f = fixture(t);
	await f.files.ready;
	f.files.setCodeControls({
		flush: async () => true,
		setBusy() {},
		openFile: async () => {
			throw Error('Editor unavailable');
		},
	});
	const captured = createDefaultPreset();
	captured.name = 'Saved despite editor';
	captured.source = 'wave';
	const result = await f.files.saveCapturedSound(captured, {
		apply: async (value) => f.setSettings(value),
	});
	assert.equal(result.committed, true);
	assert(f.project.fs.has(result.originalPath));
	assert(f.project.fs.has(result.path));
	assert.deepEqual(f.project.settings, captured);
	assert.match(f.statuses.at(-1), /Captured to.*Code display failed: Editor unavailable/);
	assert(f.writes.some((snapshot) => snapshot.settings.source === 'wave'));
});

test('ASWAN VGM sounds save as a passive folder batch, keeping raw selection, unflushed Code and author settings', async (t) => {
	const f = fixture(t);
	await f.files.ready;
	const raw = Uint8Array.of(1, 255, 0),
		song = await f.files.saveSongSource({ name: 'Reference.vgz', bytes: raw }),
		revision = f.project.fs.getRevision(song);
	f.project.setCodeState({ mode: 'code', path: '/index.js' });
	const original = f.project.settings;
	const focus = f.doc.createElement('textarea');
	f.doc.append(focus);
	focus.focus();
	let flushes = 0;
	f.files.setCodeControls({
		activePath: '/index.js',
		executionPath: '/index.js',
		isCodeMode: () => true,
		setBusy() {},
		flush: async () => {
			if (flushes++ === 0) f.project.writeEditorText('/index.js', 'unflushed performance');
			return true;
		},
		openFile: () => assert.fail('Batch save must not open Code'),
		stop: () => assert.fail('Batch save must not stop Code'),
		workspaceReplaced: () => assert.fail('Batch save must not replace Code'),
	});
	const one = createDefaultPreset(),
		two = readPreset(one);
	two.name = 'Wave';
	two.source = 'wave';
	const result = await f.files.saveVgmSounds({
		name: 'Reference.vgz',
		voices: [{ preset: one }, { preset: two }],
	});
	assert.deepEqual(result, {
		paths: ['/presets/Reference/Sine.aswan.json', '/presets/Reference/Wave.aswan.json'],
		directory: '/presets/Reference',
	});
	assert.deepEqual(JSON.parse(f.project.fs.get(result.paths[0]).data), one);
	assert.deepEqual(JSON.parse(f.project.fs.get(result.paths[1]).data), two);
	assert.equal(f.project.selectedPath, song);
	assert.equal(f.project.fs.getRevision(song), revision);
	assert.deepEqual(f.project.fs.get(song).data, raw);
	assert.deepEqual(f.project.getCodeState(), { mode: 'code', path: '/index.js' });
	assert.equal(f.project.fs.get('/index.js').data, 'unflushed performance');
	assert.deepEqual(f.project.settings, original);
	assert.equal(f.doc.activeElement, focus);
	assert.deepEqual(f.calls, []);
	assert.equal(f.doc.getElementById('aswanFilesPanel').hidden, false);
	assert.equal(f.doc.getElementById('aswanPresetSelect').value, '');
	assert.match(f.statuses.at(-1), /Saved 2 VGM sound\(s\).*Choose a preset/);
	const restored = createAswanCodeProject({
		snapshot: await f.project.prepareImport(f.project.exportProject()),
	});
	assert.deepEqual(restored.settings, original);
	assert.deepEqual(restored.fs.get(song).data, raw);
	assert.deepEqual(JSON.parse(restored.fs.get(result.paths[1]).data), two);
});

test('ASWAN VGM folders and batch filenames avoid portable Unicode, casefold, file and directory collisions', async (t) => {
	const f = fixture(t);
	await f.files.ready;
	f.project.importFiles([{ path: '/presets/CAFÉ', data: 'existing file' }]);
	const one = createDefaultPreset();
	one.name = 'e\u0301';
	const two = readPreset(one);
	two.name = 'É';
	const result = await f.files.saveVgmSounds({
		name: 'cafe\u0301.vgm',
		voices: [{ preset: one }, { preset: two }],
	});
	assert.deepEqual(result, {
		directory: '/presets/café (2)',
		paths: ['/presets/café (2)/é.aswan.json', '/presets/café (2)/É (2).aswan.json'],
	});
	const next = await f.files.saveVgmSounds({ name: 'Café.VGZ', voices: [{ preset: one }] });
	assert.equal(next.directory, '/presets/Café (3)');
	const reserved = await f.files.saveVgmSounds({ name: 'CON.vgm', voices: [{ preset: one }] });
	assert.equal(reserved.directory, '/presets/_CON');
	const portable = await f.files.saveVgmSounds({
		name: 'bad:*?.vgz',
		voices: [{ preset: { ...one, name: 'A/B:*?' } }],
	});
	assert.equal(portable.directory, '/presets/bad___');
	assert.equal(portable.paths[0], '/presets/bad___/A_B___.aswan.json');
});

test('ASWAN VGM sound capacity or invalid voices fail atomically without removing the separately saved raw log', async (t) => {
	const f = fixture(t);
	await f.files.ready;
	const source = await f.files.saveSongSource({ name: 'kept.vgm', bytes: Uint8Array.of(0, 255) });
	const before = f.project.snapshot();
	await assert.rejects(
		f.files.saveVgmSounds({
			name: 'bad.vgm',
			voices: [{ preset: createDefaultPreset() }, { preset: {} }],
		}),
	);
	assert.deepEqual(f.project.snapshot(), before);
	const total = f.project.listEntries().reduce((sum, file) => sum + file.size, 0);
	f.project.importFiles([
		{
			path: '/padding.bin',
			type: 'binary',
			data: new Uint8Array(ASWAN_PROJECT_FILE_BYTES - total - 20),
		},
	]);
	const full = f.project.snapshot();
	await assert.rejects(
		f.files.saveVgmSounds({ name: 'full.vgm', voices: [{ preset: createDefaultPreset() }] }),
		/16 MiB/,
	);
	assert.deepEqual(f.project.snapshot(), full);
	assert.deepEqual(f.project.fs.get(source).data, Uint8Array.of(0, 255));
	assert(!f.project.fs.listDirectories().includes('/presets/full'));
});

test('ASWAN VGM batch rejects stale flush and disposal before committing any files', async (t) => {
	const f = fixture(t);
	await f.files.ready;
	const flush = deferred();
	let current = true;
	f.files.setCodeControls({ flush: () => flush.promise, setBusy() {} });
	const saving = f.files.saveVgmSounds(
		{ name: 'stale.vgm', voices: [{ preset: createDefaultPreset() }] },
		{ isCurrent: () => current },
	);
	current = false;
	flush.resolve();
	assert.equal(await saving, false);
	assert(!f.project.fs.has('/presets/stale/Sine.aswan.json'));
	await f.files.dispose();
	assert.equal(
		await f.files.saveVgmSounds({
			name: 'disposed.vgm',
			voices: [{ preset: createDefaultPreset() }],
		}),
		false,
	);
});

test('ASWAN committed VGM batch returns success after late cancellation during local persistence', async (t) => {
	const gate = deferred();
	let block = false;
	const f = fixture(t, {
		store: {
			read: async () => null,
			write: async () => {
				if (block) await gate.promise;
				return true;
			},
			close: async () => {},
		},
	});
	await f.files.ready;
	let current = true;
	block = true;
	const saving = f.files.saveVgmSounds(
		{ name: 'committed.vgm', voices: [{ preset: createDefaultPreset() }] },
		{ isCurrent: () => current },
	);
	while (!f.project.fs.has('/presets/committed/Sine.aswan.json')) await Promise.resolve();
	current = false;
	gate.resolve();
	assert.deepEqual(await saving, {
		directory: '/presets/committed',
		paths: ['/presets/committed/Sine.aswan.json'],
	});
});

test('zero extracted ASWAN voices and plain JSON import remain passive without choosing or applying a sound', async (t) => {
	const f = fixture(t);
	await f.files.ready;
	const before = f.project.snapshot();
	let flushed = 0;
	f.files.setCodeControls({
		flush: async () => {
			flushed++;
			return true;
		},
		setBusy() {},
	});
	assert.deepEqual(await f.files.saveVgmSounds({ name: 'silent.vgm', voices: [] }), {
		paths: [],
		directory: null,
	});
	assert.deepEqual(f.project.snapshot(), before);
	assert.equal(flushed, 0);
	const bytes = new TextEncoder().encode(JSON.stringify(createDefaultPreset()));
	assert.deepEqual(
		await f.files.importFiles([
			{
				name: 'imported.aswan.json',
				size: bytes.length,
				arrayBuffer: async () => bytes.buffer,
			},
		]),
		['/imported.aswan.json'],
	);
	assert.equal(f.project.selectedPath, before.selectedPath);
	assert.deepEqual(f.calls, []);
	assert.deepEqual(f.project.settings, before.settings);
	assert.match(f.statuses.at(-1), /Code was not run/);
});

test('ASWAN importVgm commits source and extracted presets together, passively and with portable JSON', async (t) => {
	const f = fixture(t);
	await f.files.ready;
	const bytes = createWonderSwanSampleVgm();
	const original = f.project.settings;
	f.files.setCodeControls({
		flush: async () => true,
		setBusy() {},
		openFile: () => assert.fail('Import does not switch Code'),
		workspaceReplaced: () => assert.fail('Import does not stop Code'),
	});
	const result = await f.files.importVgm(bytes, { name: 'Reference.vgm' });
	assert.equal(result.committed, true);
	assert.equal(result.sourcePath, '/vgm/Reference.vgm');
	assert.equal(result.paths.length, 2);
	assert.deepEqual(f.project.fs.get(result.sourcePath).data, bytes);
	assert.deepEqual(f.project.settings, original);
	assert.deepEqual(f.calls, []);
	for (const path of result.paths)
		assert.deepEqual(
			readPreset(JSON.parse(f.project.fs.get(path).data)).format,
			'tetorica-aswan-voice',
		);
	const restored = createAswanCodeProject({
		snapshot: await f.project.prepareImport(f.project.exportProject()),
	});
	assert.deepEqual(restored.fs.get(result.sourcePath).data, bytes);
});

test('ASWAN source plus extracted presets preflight the joint capacity and cancel before mutation', async (t) => {
	const f = fixture(t);
	await f.files.ready;
	const bytes = createWonderSwanSampleVgm();
	const original = f.project.snapshot();
	assert.equal(
		await f.files.importVgm(bytes, { name: 'stale.vgm', isCurrent: () => false }),
		false,
	);
	assert.deepEqual(f.project.snapshot(), original);
	const used = f.project.listEntries().reduce((sum, file) => sum + file.size, 0);
	f.project.importFiles([
		{
			path: '/padding.bin',
			type: 'binary',
			data: new Uint8Array(ASWAN_PROJECT_FILE_BYTES - used - bytes.length - 10),
		},
	]);
	const before = f.project.snapshot();
	await assert.rejects(f.files.importVgm(bytes, { name: 'too-full.vgm' }), /16 MiB/);
	assert.deepEqual(f.project.snapshot(), before);
});

test('ASWAN Save selected value is one passive preset, leaving Auto and running Code untouched', async (t) => {
	const f = fixture(t);
	await f.files.ready;
	const before = f.project.settings;
	f.files.setCodeControls({
		activePath: '/index.js',
		executionPath: '/index.js',
		isCodeMode: () => false,
		setBusy() {},
		flush: async () => true,
		openFile: async (path, options) => f.opened.push({ path, options }),
		stop: () => assert.fail('Saving a selected value does not stop Code'),
		workspaceReplaced: () =>
			assert.fail('Saving a selected value does not replace the workspace'),
	});
	const selected = readPreset(before);
	selected.name = 'CH4 selected';
	selected.source = 'noise';
	selected.noise.type = 7;
	selected.left = 3;
	const path = await f.files.saveSound({ value: selected });
	assert.equal(path, '/presets/CH4 selected.aswan.json');
	assert.deepEqual(JSON.parse(f.project.fs.get(path).data), selected);
	assert.deepEqual(f.project.settings, before);
	assert.equal(f.project.fs.list().filter((file) => file.path.startsWith('/presets/')).length, 1);
	assert.deepEqual(f.calls, []);
	assert.deepEqual(f.opened, [{ path, options: { show: false } }]);
	selected.wave[0] = 15;
	assert.notEqual(JSON.parse(f.project.fs.get(path).data).wave[0], 15);
	await f.files.persistCode();
	assert.deepEqual(f.writes.at(-1).settings, before);
	const snapshot = f.project.snapshot();
	await assert.rejects(f.files.saveSound({ value: {} }));
	assert.deepEqual(f.project.snapshot(), snapshot);
});

test('ASWAN Files defaults to Auto apply and exposes Save/Discard with dirty filename dots', async t => {
	const f = fixture(t); await f.files.ready;
	assert.equal(f.doc.getElementById('aswanFilesAutoApply').checked, true);
	await f.files.setAutoApply(false);
	f.project.writeEditorText('/index.js', '// draft'); f.files.codeEdited('/index.js');
	assert.equal(f.project.savedFs.get('/index.js').data, '// kept');
	const entry = walk(f.doc).find(node => node.getAttribute('data-file-path') === '/index.js' && node.tagName === 'BUTTON');
	assert.equal(entry.getAttribute('data-modified'), 'true');
	assert.match(entry.textContent, /●$/);
	assert.equal(f.doc.getElementById('aswanFileSaveButton').disabled, false);
	await f.files.saveCurrent();
	assert.equal(f.project.savedFs.get('/index.js').data, '// draft');
	assert.equal(f.project.isFileModified('/index.js'), false);
	assert.equal(f.doc.getElementById('aswanFileSaveButton').disabled, true);
});

test('ASWAN Auto controls update the linked JSON; manual drafts apply only at Save and Discard restores controls', async t => {
	const applied = [];
	let host = createDefaultPreset();
	const f = fixture(t, {getSettings: () => host, applySettings: async (value, options) => {
		applied.push({value: readPreset(value), ...options}); host = readPreset(options.displayPreset ?? value);
	}}); await f.files.ready;
	const path = await f.files.saveSound();
	assert.equal(f.project.activeSoundPath, path);
	await f.files.setAutoApply(false);
	host = {...host, left: 4}; f.files.recordSoundEdit(host);
	assert.equal(JSON.parse(f.project.fs.get(path).data).left, 4);
	assert.equal(JSON.parse(f.project.savedFs.get(path).data).left, 9);
	assert.equal(f.project.savedSettings.left, 9);
	await f.files.saveCurrent();
	assert.equal(applied.at(-1).source, 'save');
	assert.equal(applied.at(-1).applyAudio, true);
	assert.equal(applied.at(-1).value.left, 4);
	assert.equal(f.project.savedSettings.left, 4);
	host = {...host, right: 2}; f.files.recordSoundEdit(host);
	await f.files.discardCurrent();
	assert.equal(host.right, 9);
	assert.equal(applied.at(-1).applyAudio, false);
	assert.equal(f.project.isFileModified(path), false);
	await f.files.setAutoApply(true);
	host = {...host, wave: host.wave.map((v, i) => i === 1 ? 0 : v)};
	f.files.recordSoundEdit(host);
	assert.equal(JSON.parse(f.project.savedFs.get(path).data).wave[1], 0);
});

test('ASWAN valid active JSON follows Auto apply while malformed text is kept and protected from knobs', async t => {
	let host = createDefaultPreset(); const applied = [];
	const f = fixture(t, {getSettings: () => host, applySettings: async (value, options) => {
		host = readPreset(options.displayPreset ?? value); applied.push(options);
	}}); await f.files.ready;
	const path = await f.files.saveSound();
	const edit = {...host, left: 3};
	f.project.writeEditorText(path, JSON.stringify(edit)); f.files.codeEdited(path);
	await f.files.saveCurrent();
	assert.equal(host.left, 3);
	assert(applied.some(options => options.source === 'json' && options.applyAudio));
	await f.files.setAutoApply(false);
	f.project.writeEditorText(path, '{ unfinished'); f.files.codeEdited(path);
	assert.throws(() => f.files.recordSoundEdit({...host, right: 1}), /Finish or Discard/);
	assert.equal(f.project.fs.get(path).data, '{ unfinished');
	await f.files.saveCurrent();
	assert.equal(f.project.savedFs.get(path).data, '{ unfinished');
	assert.equal(host.left, 3);
	assert.equal(applied.at(-1).applyAudio, false);
	assert.match(f.statuses.at(-1), /JSON not applied/);
});

test('ASWAN Save all and Discard all retain binary drafts, pending folder renames and linked sound selection', async t => {
	const f = fixture(t); await f.files.ready;
	const path = await f.files.saveSound();
	f.project.importFiles([{path: '/data/raw.bin', type: 'binary', data: Uint8Array.of(0, 255)}]);
	await f.files.setAutoApply(false);
	await f.files.move('/presets', '/sounds');
	const moved = '/sounds' + path.slice('/presets'.length);
	assert.equal(f.project.activeSoundPath, moved);
	f.project.fs.writeBinary('/data/raw.bin', Uint8Array.of(127, 128));
	await f.files.discardAll();
	assert.equal(f.project.activeSoundPath, path);
	assert(f.project.fs.has(path)); assert(!f.project.fs.has(moved));
	assert.deepEqual(f.project.fs.get('/data/raw.bin').data, Uint8Array.of(0, 255));
	await f.files.move('/presets', '/sounds');
	f.project.fs.writeBinary('/data/raw.bin', Uint8Array.of(1, 254));
	await f.files.saveAll();
	assert.equal(f.project.savedFs.has(path), false);
	assert(f.project.savedFs.has(moved));
	assert.deepEqual(f.project.savedFs.get('/data/raw.bin').data, Uint8Array.of(1, 254));
	assert.deepEqual(f.project.getDirtyPaths(), []);
});

test('ASWAN failed sound Save cannot promote files or lose the working draft', async t => {
	let host = createDefaultPreset(), fail = false;
	const f = fixture(t, {getSettings: () => host, applySettings: async (value, options) => {
		if (fail && options.source === 'save') throw Error('device unavailable');
		host = readPreset(options.displayPreset ?? value);
	}}); await f.files.ready;
	const path = await f.files.saveSound(); await f.files.setAutoApply(false);
	host = {...host, left: 1}; f.files.recordSoundEdit(host);
	const before = f.project.snapshot(); fail = true;
	await assert.rejects(f.files.saveCurrent(), /device unavailable/);
	assert.deepEqual(f.project.snapshot(), before);
	assert.equal(f.project.isFileModified(path), true);
});

test('ASWAN manual renamed Code stays running and Save accepts both sides without restarting', async t => {
	const f = fixture(t); await f.files.ready; await f.files.setAutoApply(false);
	const changes = [];
	f.files.setCodeControls({activePath: '/index.js', executionPath: '/index.js',
		flush: async () => true, setBusy() {}, pathChanged: (...args) => changes.push(args),
		stop: () => assert.fail('Manual Files changes must keep Code running')});
	await f.files.move('/index.js', '/renamed.js');
	assert.equal(changes.at(-1)[2].preserveExecution, true);
	assert.equal(f.project.savedFs.has('/index.js'), true);
	await f.files.saveCurrent();
	assert.equal(f.project.savedFs.has('/index.js'), false);
	assert.equal(f.project.savedFs.get('/renamed.js').data, '// kept');
	assert.deepEqual(f.project.getPendingMoves(), []);
});

test('ASWAN manual project restore plays accepted sound while retaining edited JSON and visible draft', async t => {
	const p = createAswanCodeProject();
	const original = p.settings, draft = {...original, left: 2};
	p.importFiles([{path: '/presets/voice.aswan.json', data: JSON.stringify(original)}]);
	p.setActiveSoundPath('/presets/voice.aswan.json'); p.setAutoApply(false);
	p.writeEditorText(p.activeSoundPath, JSON.stringify(draft)); p.setSettings(draft);
	const applications = [];
	const f = fixture(t, {store: {read: async () => p.snapshot(), write: async () => true},
		applySettings: async (value, options) => applications.push({value, options})});
	await f.files.ready;
	assert.equal(applications[0].value.left, 9);
	assert.equal(applications[0].options.displayPreset.left, 2);
	assert.equal(f.project.savedSettings.left, 9);
	assert.equal(f.project.settings.left, 2);
	assert.equal(f.project.autoApply, false);
});

test('ASWAN Auto apply checkbox keeps the requested value while flushing and restores it on failure', async t => {
	const f = fixture(t); await f.files.ready;
	const gate = deferred();
	f.files.setCodeControls({flush: () => gate.promise, setBusy() {}});
	const pending = f.files.setAutoApply(false);
	assert.equal(f.doc.getElementById('aswanFilesAutoApply').checked, false);
	assert.equal(f.doc.getElementById('aswanFilesAutoApply').disabled, true);
	f.project.select('/index.js'); // A render while awaiting flush must not reset the checkbox.
	assert.equal(f.doc.getElementById('aswanFilesAutoApply').checked, false);
	gate.resolve(false);
	assert.equal(await pending, false);
	assert.equal(f.doc.getElementById('aswanFilesAutoApply').checked, true);
	assert.equal(f.doc.getElementById('aswanFilesAutoApply').disabled, false);
});

test('ASWAN manual rename back to the saved name clears its pending move without losing edits', async t => {
	const f = fixture(t); await f.files.ready;
	await f.files.setAutoApply(false);
	f.project.select('/index.js');
	await f.files.move('/index.js', '/temporary.js');
	f.project.writeEditorText('/temporary.js', '// changed');
	await f.files.move('/temporary.js', '/index.js');
	assert.deepEqual(f.project.getPendingMoves(), []);
	assert.equal(f.project.fs.get('/index.js').data, '// changed');
	assert.equal(f.project.savedFs.get('/index.js').data, '// kept');
	await f.files.discardCurrent();
	assert.equal(f.project.fs.get('/index.js').data, '// kept');
});

test('ASWAN New Cassette confirms before stopping and restores defaults, original starter and fresh identity without running', async t => {
	let committed = 0;
	const f = fixture(t, {onNewProject: () => committed++}); await f.files.ready;
	f.project.writeEditorText('/index.js', 'globalThis.mustNotRunNewAswan=true;');
	f.project.importFiles([{path: '/data/old.bin', type: 'binary', data: Uint8Array.of(0,255)}]);
	f.project.setCodeState({mode: 'code', path: '/index.js'}); f.project.select('/data/old.bin');
	f.setSettings({...createDefaultPreset(), source: 'noise', left: 2});
	const identity = f.files.workspaceId, states = []; let stopped = 0;
	f.files.setCodeControls({setBusy() {}, flush: async () => true,
		captureState: () => ({mode: 'code', path: '/index.js'}), workspaceReplaced: async () => stopped++,
		restoreState: async state => states.push(state), run: () => assert.fail('New must not run Code')});
	await f.doc.getElementById('aswanProjectNewButton').fire('click');
	assert.equal(f.doc.getElementById('aswanNewCassetteDialog').open, true);
	assert.equal(stopped, 0);
	await f.doc.getElementById('aswanNewCassetteCancel').fire('click');
	assert.equal(stopped, 0); assert(f.project.fs.has('/data/old.bin'));
	assert.equal(await f.files.newProject(), true);
	assert.equal(stopped, 1); assert.equal(committed, 1);
	assert.notEqual(f.files.workspaceId, identity);
	assert.deepEqual(f.project.settings, createDefaultPreset());
	assert.deepEqual(f.project.fs.list().map(file => file.path), ['/index.js']);
	assert.equal(f.project.savedFs.get('/index.js').data, '// kept');
	assert.deepEqual(states, [{mode: 'keyboard', path: '/index.js'}]);
	assert.equal(f.writes.at(-1).workspaceId, f.files.workspaceId);
	assert.equal(globalThis.mustNotRunNewAswan, undefined);
});

test('ASWAN New exports both Code versions, opaque songs and the current draft before retiring the performance', async t => {
	const downloads = [], order = [];
	const f = fixture(t, {downloadFile: async (bytes, name, type) => { downloads.push({bytes,name,type}); order.push('export'); }});
	await f.files.ready; await f.files.setAutoApply(false);
	f.project.writeEditorText('/index.js', '// unsaved Code');
	f.project.importFiles([{path: '/vgm/original.vgz', type: 'binary', data: Uint8Array.of(0,128,255)}]);
	f.project.saveFiles(['/vgm/original.vgz']);
	const draft = {...createDefaultPreset(), left: 1}; f.setSettings(draft); f.files.recordSoundEdit(draft);
	f.files.setCodeControls({setBusy() {}, flush: async () => true, workspaceReplaced: async () => order.push('stop'), restoreState: async () => {}});
	assert.equal(await f.files.newProject({exportCurrent: true}), true);
	assert.deepEqual(order, ['export', 'stop']);
	assert.match(downloads[0].name, /\.cassette\.zip$/); assert.equal(downloads[0].type, 'application/zip');
	const backup = createAswanCodeProject({snapshot: await f.project.prepareImport(downloads[0].bytes)});
	assert.equal(backup.fs.get('/index.js').data, '// unsaved Code');
	assert.equal(backup.savedFs.get('/index.js').data, '// kept');
	assert.deepEqual(backup.fs.get('/vgm/original.vgz').data, Uint8Array.of(0,128,255));
	assert.equal(backup.settings.left, 1); assert.equal(backup.savedSettings.left, 9);
	assert.equal(f.project.autoApply, false);
	assert.deepEqual(f.project.getDirtyPaths(), []);
});

test('ASWAN failed or cancelled backup keeps the old project, identity and performance', async t => {
	for (const outcome of ['throw','cancel']) await t.test(outcome, async t => {
		const f = fixture(t, {downloadFile: async () => { if(outcome==='throw') throw Error('Backup unavailable'); return false; }});
		await f.files.ready; const before=f.project.snapshot(), identity=f.files.workspaceId;
		f.files.setCodeControls({setBusy() {}, flush: async()=>true, workspaceReplaced:()=>assert.fail('No retirement without backup')});
		if(outcome==='throw') await assert.rejects(f.files.newProject({exportCurrent:true}), /Backup unavailable/);
		else assert.equal(await f.files.newProject({exportCurrent:true}),false);
		assert.deepEqual(f.project.snapshot(),before); assert.equal(f.files.workspaceId,identity);
		assert.equal(f.calls.length,0);
	});
});

test('ASWAN invalid defaults, cancelled flush and duplicate requests cannot retire owners or create late backups', async t => {
	const gate=deferred(), started=deferred(); let downloads=0;
	const f=fixture(t,{downloadFile:async()=>{downloads++;return true;}});await f.files.ready;
	const before=f.project.snapshot(), prepare=f.project.prepareNew;
	f.project.prepareNew=()=>{throw Error('Bad template');};
	await assert.rejects(f.files.newProject(),/Bad template/);assert.deepEqual(f.project.snapshot(),before);
	f.project.prepareNew=prepare;
	f.files.setCodeControls({setBusy(){},flush:()=>{started.resolve();return gate.promise;},workspaceReplaced:()=>assert.fail('Cancelled')});
	const pending=f.files.newProject({exportCurrent:true});await started.promise;
	assert.equal(await f.files.newProject(),false);
	await f.doc.getElementById('aswanNewCassetteDialog').fire('cancel');gate.resolve(true);
	assert.equal(await pending,false);assert.equal(downloads,0);assert.deepEqual(f.project.snapshot(),before);
});

test('ASWAN rejected initialization and editor restore roll back both versions, linked sound and selection', async t => {
	for(const phase of ['apply-false','apply-throw','editor-false','editor-throw','cleanup-false']) await t.test(phase, async t => {
		let applications=0, restores=0;const states=[];
		const f=fixture(t,{applySettings:async(value,options)=>{
			f.setSettings(options.displayPreset??value);
			if(++applications===1){if(phase==='apply-false')return false;if(phase==='apply-throw')throw Error('Apply failed');}
		},onBeforeWorkspaceReplace:async()=>phase==='cleanup-false'?false:undefined});
		await f.files.ready;await f.files.setAutoApply(false);
		const draft={...createDefaultPreset(),left:2};f.setSettings(draft);f.files.recordSoundEdit(draft);
		f.project.writeEditorText('/index.js','// unsaved');f.project.setCodeState({mode:'code',path:'/index.js'});
		const before=f.project.snapshot(),identity=f.files.workspaceId;
		f.files.setCodeControls({setBusy(){},flush:async()=>true,workspaceReplaced:async()=>true,
			restoreState:async state=>{states.push(state);if(++restores===1){if(phase==='editor-false')return false;if(phase==='editor-throw')throw Error('Editor failed');}}});
		if(phase.endsWith('throw'))await assert.rejects(f.files.newProject(),/failed/);
		else assert.equal(await f.files.newProject(),false);
		assert.deepEqual(f.project.snapshot(),before);assert.equal(f.files.workspaceId,identity);
		assert.deepEqual(states.at(-1),before.codeState);
		assert.equal(f.doc.querySelector('.aswan-main').inert,false);
		if(phase!=='cleanup-false')assert.equal(applications,2);
	});
});

test('ASWAN cancellation during native Apply restores the previous project and leaves Code stopped', async t => {
	const gate=deferred(),started=deferred();let applications=0,retired=0;
	const f=fixture(t,{applySettings:async()=>{if(++applications===1){started.resolve();await gate.promise;}}});
	await f.files.ready;const before=f.project.snapshot(),identity=f.files.workspaceId;
	f.files.setCodeControls({setBusy(){},flush:async()=>true,workspaceReplaced:async()=>retired++,restoreState:async()=>{}});
	const pending=f.files.newProject();await started.promise;
	await f.doc.getElementById('aswanNewCassetteCancel').fire('click');gate.resolve();
	assert.equal(await pending,false);assert.equal(retired,1);assert.equal(applications,2);
	assert.deepEqual(f.project.snapshot(),before);assert.equal(f.files.workspaceId,identity);
	assert.match(f.statuses.at(-1),/Performance remains stopped/);
});

test('ASWAN disposal during pending New cannot commit defaults or overwrite the restored source with a retired editor', async t => {
	const gate=deferred(),started=deferred();let flushes=0;
	const f=fixture(t,{applySettings:async()=>{started.resolve();await gate.promise;}});await f.files.ready;
	f.project.writeEditorText('/index.js','// keep this Code');const before=f.project.snapshot();
	f.files.setCodeControls({setBusy(){},flush:async()=>{if(++flushes>1)f.project.writeEditorText('/index.js','// stale model');return true;},workspaceReplaced:async()=>true,restoreState:async()=>{}});
	const pending=f.files.newProject();await started.promise;
	const disposing=f.files.dispose();gate.resolve();
	assert.equal(await pending,false);await disposing;
	assert.equal(flushes,1);assert.deepEqual(f.project.snapshot(),before);
	assert.equal(f.doc.getElementById('aswanNewCassetteDialog'),undefined);
	assert.equal(await f.files.newProject(),false);
});

test('ASWAN New retains exportable fresh files when browser storage fails', async t => {
	const f=fixture(t,{store:{read:async()=>null,write:async()=>{throw Error('Quota exceeded');},close:async()=>{}}});
	await f.files.ready;f.files.setCodeControls({setBusy(){},flush:async options=>options?.persist===false,workspaceReplaced:async()=>true,restoreState:async()=>{}});
	assert.equal(await f.files.newProject(),true);assert.match(f.statuses.at(-1),/Local save unavailable/);
	const copy=createAswanCodeProject({snapshot:await f.project.prepareImport(f.project.exportProject())});
	assert.equal(copy.fs.get('/index.js').data,'// kept');
});

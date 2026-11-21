// SPDX-License-Identifier: BSD-3-Clause
import { createVirtualFileSystem, transferVirtualFiles } from '../js/tetorica_virtual_files/filesystem.js';
import { dirname, normalizeVirtualPath } from '../js/tetorica_virtual_files/path.js';
import { createVirtualFileWorkspace } from '../js/tetorica_virtual_files/workspace.js';
import { createPlaygroundCassetteZip, loadPlaygroundCassette } from '../playground/playground_cassette.js';
import { createSynthProjectStore } from '../synth/synth_project_store.js';

export const NDS_PROJECT_FORMAT = 'tetorica-nds-code-project';
export const NDS_PROJECT_MANIFEST = '/nds-synth.project.json';
export const NDS_PROJECT_FILE_BYTES = 16 * 1024 * 1024 - 65536;
export const NDS_PROJECT_CODE_LENGTH = 2 * 1024 * 1024;
const WORKING_ROOT = '/.nds-working';
const STORAGE_KEY = 'tetorica-nitro-ds-project-v1';
const MAX_ENTRIES = 4096;
const METADATA = ['/metadata.json', '/cassette.metadata.js'];
const INTERNAL = [NDS_PROJECT_MANIFEST, WORKING_ROOT, '/__proto__', ...METADATA];
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const inside = (path, root) => path === root || path.startsWith(root + '/');
export const isNdsCodePath = path => /\.m?js$/i.test(path);
export const isNdsTextPath = path => /\.(?:m?js|json|txt|md|css|html|csv|ya?ml|glsl)$/i.test(path);

export function ndsProjectPath(value) {
	const path = normalizeVirtualPath(value);
	if (path === '/' || path.length > 1024 || /[\u0000-\u001f\u007f]/.test(path) || path.isWellFormed?.() === false ||
		path.split('/').some(part => part === '.git' || part === '.tet.ss') || INTERNAL.some(root => inside(path, root)))
		throw Error(`That DS project path is reserved or invalid: ${path}`);
	return path;
}

function canonicalPath(path) {
	if (ndsProjectPath(path) !== path) throw Error(`Invalid DS project path: ${path}`);
	return path;
}

function fileSize(path, data) {
	if (typeof data === 'string' && data.isWellFormed?.() === false) throw Error('DS project text must be valid Unicode.');
	if (isNdsCodePath(path) && typeof data !== 'string') throw Error('DS project JavaScript files must be UTF-8 text.');
	const size = typeof data === 'string' ? encoder.encode(data).byteLength : data.byteLength;
	if (typeof data === 'string' && size > NDS_PROJECT_CODE_LENGTH) throw Error('DS project text exceeds 2 MiB.');
	return size;
}

function checkBudget(bytes, entries) {
	if (bytes > NDS_PROJECT_FILE_BYTES) throw Error('DS project files exceed the Cassette size limit.');
	if (entries > MAX_ENTRIES) throw Error('DS project contains too many files or folders.');
}

function checkLayer(layer) {
	if (layer?.version !== 1 || !Array.isArray(layer.files) || !Array.isArray(layer.directories))
		throw Error('Unsupported DS filesystem snapshot.');
	checkBudget(0, layer.files.length + layer.directories.length);
	const directories = new Set(layer.directories), paths = new Set();
	if (!directories.has('/') || directories.size !== layer.directories.length) throw Error('Invalid DS project directories.');
	for (const path of directories) {
		if (path !== '/' && (!directories.has(dirname(canonicalPath(path))))) throw Error('Missing DS project parent directory.');
	}
	let bytes = 0;
	for (const file of layer.files) {
		const path = canonicalPath(file?.path);
		const type = typeof file.data === 'string' ? 'text' : file.data instanceof Uint8Array ? 'binary' : null;
		if (!type || file.type !== type || paths.has(path) || directories.has(path) || !directories.has(dirname(path)))
			throw Error('Invalid DS project file.');
		paths.add(path);
		bytes += fileSize(path, file.data);
	}
	checkBudget(bytes, paths.size + directories.size);
}

function checkedWorkspace(snapshot) {
	if (snapshot?.format !== NDS_PROJECT_FORMAT || snapshot.version !== 1 || snapshot.workspace?.version !== 1)
		throw Error('Unsupported DS project format or version.');
	checkLayer(snapshot.workspace.saved);
	checkLayer(snapshot.workspace.working);
	return snapshot.workspace;
}

function readFile(path, type, bytes) {
	return { path, type, data: type === 'text' ? decoder.decode(bytes) : bytes };
}

function sameFile(current, saved) {
	if (current.type !== saved?.type) return false;
	return current.type === 'text' ? current.data === saved.data : current.data.length === saved.data.length &&
		current.data.every((value, index) => value === saved.data[index]);
}

const difference = (left, right) => left.filter(value => !right.has(value));
const payloadPath = index => `${WORKING_ROOT}/${index}`;

function encodeCassette({ saved, working, autoSave }) {
	const savedFiles = new Map(saved.files.map(file => [file.path, file]));
	const workingFiles = new Set(working.files.map(file => file.path));
	const modified = working.files.filter(file => !sameFile(file, savedFiles.get(file.path)));
	const manifest = {
		format: NDS_PROJECT_FORMAT, version: 1, autoSave,
		textPaths: saved.files.filter(file => file.type === 'text').map(file => file.path),
		changes: modified.map(({ path, type }) => ({ path, type })),
		removed: difference([...savedFiles.keys()], workingFiles),
		addedDirectories: difference(working.directories, new Set(saved.directories)),
		removedDirectories: difference(saved.directories, new Set(working.directories)),
	};
	const entries = [...saved.files, { path: NDS_PROJECT_MANIFEST, type: 'text', data: JSON.stringify(manifest, null, 2) + '\n' }];
	entries.push(...modified.map((file, index) => ({ ...file, path: payloadPath(index) })));
	return createPlaygroundCassetteZip(entries, { directories: saved.directories });
}

function decodeCassette(cassette) {
	const files = new Map([...cassette.files].map(([path, bytes]) => ['/' + path, bytes]));
	const manifestBytes = files.get(NDS_PROJECT_MANIFEST);
	for (const path of [...METADATA, NDS_PROJECT_MANIFEST]) files.delete(path);
	if (!manifestBytes) {
		const standalone = [...files].map(([path, bytes]) => readFile(canonicalPath(path), isNdsTextPath(path) ? 'text' : 'binary', bytes));
		const fs = createVirtualFileSystem();
		fs.replace(standalone, cassette.directories.map(canonicalPath));
		const saved = fs.snapshot();
		return { version: 1, working: saved, saved, autoSave: true };
	}
	let manifest;
	try { manifest = JSON.parse(decoder.decode(manifestBytes)); }
	catch { throw Error('Invalid DS project manifest JSON.'); }
	if (manifest?.format !== NDS_PROJECT_FORMAT || manifest.version !== 1 || typeof manifest.autoSave !== 'boolean' ||
		!['textPaths', 'changes', 'removed', 'addedDirectories', 'removedDirectories'].every(key => Array.isArray(manifest[key])))
		throw Error('Invalid DS project manifest.');

	const pending = manifest.changes.map((file, index) => {
		const bytes = files.get(payloadPath(index));
		if (!bytes || !['text', 'binary'].includes(file?.type)) throw Error('Invalid DS working file payload.');
		files.delete(payloadPath(index));
		return readFile(canonicalPath(file.path), file.type, bytes);
	});
	const textPaths = new Set(manifest.textPaths.map(canonicalPath));
	if (textPaths.size !== manifest.textPaths.length || [...textPaths].some(path => !files.has(path)))
		throw Error('Invalid DS saved text paths.');
	const saved = { version: 1, files: [...files].map(([path, bytes]) => readFile(canonicalPath(path), textPaths.has(path) ? 'text' : 'binary', bytes)),
		directories: ['/', ...cassette.directories.map(canonicalPath)].sort() };
	const workingFiles = new Map(saved.files.map(file => [file.path, file]));
	const seen = new Set();
	for (const path of manifest.removed.map(canonicalPath)) {
		if (!workingFiles.delete(path)) throw Error('Invalid DS working deletion.');
		seen.add(path);
	}
	for (const file of pending) {
		if (seen.has(file.path)) throw Error('Duplicate DS working path.');
		seen.add(file.path);
		workingFiles.set(file.path, file);
	}
	const directories = new Set(saved.directories), deleted = new Set();
	for (const path of manifest.removedDirectories.map(canonicalPath)) {
		if (!directories.delete(path)) throw Error('Invalid DS working folder deletion.');
		deleted.add(path);
	}
	for (const path of manifest.addedDirectories.map(canonicalPath)) {
		if (directories.has(path) || deleted.has(path)) throw Error('Invalid DS working folder creation.');
		directories.add(path);
	}
	const working = { version: 1, files: [...workingFiles.values()], directories: [...directories].sort() };
	return { version: 1, saved, working, autoSave: manifest.autoSave };
}

function preparedImportEntries(entries) {
	if (!Array.isArray(entries)) throw TypeError('Choose DS project files.');
	return entries.map(file => {
		const path = ndsProjectPath(file?.path);
		const type = file.type ?? (typeof file.data === 'string' || isNdsTextPath(path) ? 'text' : 'binary');
		if (!['text', 'binary'].includes(type)) throw TypeError('DS project files must be text or binary.');
		if (!(typeof file.data === 'string' || file.data instanceof Uint8Array || file.data instanceof ArrayBuffer))
			throw TypeError('DS project file data must be text or binary bytes.');
		const data = type === 'text' && typeof file.data !== 'string' ? decoder.decode(file.data) : file.data;
		if (type === 'text' ? typeof data !== 'string' : !(data instanceof Uint8Array || data instanceof ArrayBuffer))
			throw TypeError('DS project file type does not match its data.');
		return { path, data };
	});
}

export function createNdsProject({ starterCode = '', starterFiles = [] } = {}) {
	const workspace = createVirtualFileWorkspace(preparedImportEntries([{ path: '/index.js', type: 'text', data: starterCode }, ...starterFiles]));
	const fs = workspace.working, savedFs = workspace.saved;
	const initial = fs.snapshot();
	checkLayer(initial);
	const wrap = layers => ({ format: NDS_PROJECT_FORMAT, version: 1, workspace: layers });
	const snapshot = () => wrap(workspace.snapshot());
	const restore = value => { workspace.restore(checkedWorkspace(value)); return snapshot(); };
	function editLayers(change) {
		const candidate = createVirtualFileWorkspace();
		candidate.restore(workspace.snapshot());
		const result = change(candidate);
		workspace.restore(checkedWorkspace(wrap(candidate.snapshot())));
		return result;
	}
	return {
		workspace, fs, savedFs, onDidChange: workspace.onDidChange, snapshot, restore,
		get autoApply() { return workspace.autoSave; },
		setAutoApply: workspace.setAutoSave, saveAll: workspace.saveAll, discardAll: () => workspace.discard('/'),
		saveFiles: paths => editLayers(candidate => candidate.saveMany(paths)),
		discardFiles: paths => editLayers(candidate => candidate.discardMany(paths)),
		getDirtyPaths: workspace.getDirtyPaths, isFileModified: workspace.isDirty,
		reset() { return restore(wrap({ version: 1, working: initial, saved: initial, autoSave: workspace.autoSave })); },
		importFiles(entries) {
			const files = preparedImportEntries(entries);
			editLayers(({ working }) => working.writeFiles(files));
			return files.map(file => file.path);
		},
		makeDirectory: (path, options) => editLayers(({ working }) => working.mkdir(ndsProjectPath(path), options)),
		transfer: (source, target, options) => editLayers(({ working }) =>
			transferVirtualFiles(working, ndsProjectPath(source), ndsProjectPath(target), options)),
		remove: (path, options = { recursive: true }) => fs.remove(ndsProjectPath(path), options),
		writeEditorText(path, source) {
			path = ndsProjectPath(path);
			if (typeof source !== 'string' || (fs.has(path) ? fs.get(path).type !== 'text' : !isNdsCodePath(path)))
				throw TypeError('Choose a DS project text file.');
			const directories = new Set(fs.listDirectories());
			let bytes = fileSize(path, source), count = fs.has(path) ? 0 : 1;
			for (const directory of directories) for (const name of fs.readdir(directory)) {
				const current = `${directory === '/' ? '' : directory}/${name}`;
				if (directories.has(current)) continue;
				count++;
				if (current !== path) bytes += fs.stat(current).size;
			}
			for (let parent = dirname(path); !directories.has(parent); parent = dirname(parent)) directories.add(parent);
			checkBudget(bytes, count + directories.size);
			fs.writeText(path, source);
		},
		recoverCode(path, { source, savedSource, autoSave }) {
			path = canonicalPath(path);
			if (typeof source !== 'string' || (savedSource !== null && typeof savedSource !== 'string') || typeof autoSave !== 'boolean' ||
				(autoSave && source !== savedSource)) throw Error('Invalid DS code recovery versions.');
			const working = createVirtualFileSystem(), saved = createVirtualFileSystem();
			working.restore(fs.snapshot());
			working.writeText(path, source);
			if (autoSave) return restore(wrap({ version: 1, autoSave, working: working.snapshot(), saved: working.snapshot() }));
			saved.restore(savedFs.snapshot());
			if (savedSource === null) saved.delete(path);
			else saved.writeText(path, savedSource);
			return restore(wrap({ version: 1, autoSave, working: working.snapshot(), saved: saved.snapshot() }));
		},
		async prepareImport(bytes, { isCurrent = () => true } = {}) {
			const check = () => { if (!isCurrent()) throw new DOMException('DS Cassette import cancelled', 'AbortError'); };
			check();
			const cassette = await loadPlaygroundCassette(bytes);
			check();
			const next = wrap(decodeCassette(cassette));
			const candidate = createVirtualFileWorkspace();
			candidate.restore(checkedWorkspace(next));
			return wrap(candidate.snapshot());
		},
		exportCassette() { return encodeCassette(checkedWorkspace(snapshot())); },
	};
}

function binaryText(bytes) {
	let text = '';
	for (let offset = 0; offset < bytes.length; offset += 32768)
		text += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
	return btoa(text);
}

export function createNdsProjectStore({ indexedDB = globalThis.indexedDB, storage = globalThis.localStorage } = {}) {
	return createSynthProjectStore({ indexedDB, name: 'tetorica-nitro-ds-files',
		readFallback() {
			const source = storage?.getItem(STORAGE_KEY);
			return source ? JSON.parse(source, (_key, value) => typeof value?.ndsBytes === 'string'
				? Uint8Array.from(atob(value.ndsBytes), char => char.charCodeAt(0)) : value) : null;
		},
		writeFallback(value) {
			if (!storage) return false;
			storage.setItem(STORAGE_KEY, JSON.stringify(value, (_key, item) => item instanceof Uint8Array ? { ndsBytes: binaryText(item) } : item));
			return true;
		},
	});
}

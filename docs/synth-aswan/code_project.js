// ASWAN Code project data. Restoring Files never creates audio or runs Code.
import {
	createVirtualFileSystem,
	isCheckpointPath,
} from '../js/tetorica_virtual_files/filesystem.js';
import { createVirtualFileWorkspace } from '../js/tetorica_virtual_files/workspace.js';
import { normalizeVirtualPath } from '../js/tetorica_virtual_files/path.js';
import {
	createPlaygroundCassetteZip,
	loadPlaygroundCassette,
} from '../playground/playground_cassette.js';
import { createSynthCodeProject } from '../synth/synth_code_project.js?v=huc-working-saved-1';
import { createSynthProjectStore } from '../synth/synth_project_store.js?v=draft-reconnect-1';
import { readPreset, createDefaultPreset } from './preset.js';

export const ASWAN_PROJECT_FORMAT = 'tetorica-aswan-code-project';
export const ASWAN_PROJECT_MANIFEST = '/aswan-synth.project.json';
export const ASWAN_PROJECT_STORAGE_KEY = 'tetorica-aswan-synth-project-v1';
// Shared cassette ZIPs are bounded to 16 MiB, including their manifest.
export const ASWAN_PROJECT_FILE_BYTES = 16 * 1024 * 1024 - 65536;
export const ASWAN_PROJECT_CODE_LENGTH = 2 * 1024 * 1024;
const MAX_TEXT = ASWAN_PROJECT_CODE_LENGTH;
const clone = (value) => structuredClone(value);
export const isAswanCodePath = (path) =>
	typeof path === 'string' &&
	/\.m?js$/i.test(path) &&
	!path.split('/').some((part) => ['.git', '.tet.ss'].includes(part));
export const isAswanTextPath = (path) =>
	/\.(?:m?js|json|txt|md|css|html|csv|ya?ml|glsl)$/i.test(path);
export const isAswanSongFilename = (name) =>
	typeof name === 'string' && /\.(?:vgm|vgz)$/i.test(name);
export const isAswanSongPath = (path) =>
	typeof path === 'string' && path.startsWith('/vgm/') && isAswanSongFilename(path);
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const text = (data) => (typeof data === 'string' ? data : decoder.decode(data));
const name = (value) => {
	if (
		typeof value !== 'string' ||
		!value.trim() ||
		value.length > 120 ||
		/[\u0000-\u001f/\\]/.test(value)
	)
		throw Error('Project name must be 1–120 characters without slashes.');
	return value.trim();
};
const editorPath = (path, fs) =>
	typeof path === 'string' &&
	path.startsWith('/') &&
	!path.split('/').some((part) => ['..', '.git', '.tet.ss'].includes(part)) &&
	fs.get(path)?.type === 'text';
function codeState(value, fs) {
	if (value == null) return { mode: 'keyboard', path: null };
	if (
		!value ||
		!['keyboard', 'code'].includes(value.mode) ||
		(value.path !== null && !editorPath(value.path, fs))
	)
		throw Error('Invalid ASWAN Code selection.');
	return { mode: value.mode, path: value.path };
}
function selectedPath(value, fs) {
	if (value === null || value === undefined) return null;
	const path = normalizeVirtualPath(value);
	if (!fs.stat(path)) throw Error('Selected project file is missing.');
	return path;
}
function pathForUser(path) {
	path = normalizeVirtualPath(path);
	if (path === '/' || path === ASWAN_PROJECT_MANIFEST || isCheckpointPath(path))
		throw Error('That project path is reserved.');
	return path;
}
/** Keep original log bytes opaque. Parsing and audio are explicit Play actions. */
export function aswanSongSourceEntries(project, sources) {
	if (!Array.isArray(sources)) throw TypeError('Song sources must be an array.');
	const fold = (path) => path.normalize('NFC').toLowerCase(),
		encoder = new TextEncoder();
	const used = new Set(
		[...project.fs.list().map((file) => file.path), ...project.fs.listDirectories()].map(fold),
	);
	return sources.map((source) => {
		if (!source || typeof source.name !== 'string' || !(source.bytes instanceof Uint8Array))
			throw TypeError('A VGM source needs a name and Uint8Array bytes.');
		let name = source.name
			.split(/[\\/]/)
			.pop()
			.normalize('NFC')
			.replace(/[\u0000-\u001f\u007f<>:"|?*\ud800-\udfff]/gu, '_')
			.trim()
			.replace(/^\.+|[. ]+$/g, '');
		if (!isAswanSongFilename(name)) throw Error('Use a .vgm or .vgz song file name.');
		const extension = name.slice(-4);
		let stem = name.slice(0, -4),
			bounded = '';
		for (const character of stem) {
			if (encoder.encode(bounded + character).length > 200) break;
			bounded += character;
		}
		stem = bounded.replace(/[. ]+$/g, '') || 'Untitled';
		if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(stem.split('.')[0].trimEnd()))
			stem = '_' + stem;
		let path = `/vgm/${stem}${extension}`,
			index = 1;
		while (used.has(fold(path))) path = `/vgm/${stem}-${++index}${extension}`;
		used.add(fold(path));
		return { path, type: 'binary', data: source.bytes };
	});
}
/** Validate a portable sound without rewriting the editable source document.
 * Only explicit sound selection applies this data to the current ASWAN. */
export function readAswanProjectSound(data) {
	const value =
		typeof data === 'string' || ArrayBuffer.isView(data) || data instanceof ArrayBuffer
			? JSON.parse(text(data))
			: data;
	if (value?.format !== 'tetorica-aswan-voice') return null;
	return readPreset(value);
}
function validateFiles(fs) {
	let total = 0;
	for (const file of fs.list()) {
		total +=
			file.type === 'text'
				? new TextEncoder().encode(file.data).byteLength
				: file.data.byteLength;
		if (isCheckpointPath(file.path)) continue;
		if (file.path === ASWAN_PROJECT_MANIFEST)
			throw Error('ASWAN project manifest is reserved.');
		if (isAswanCodePath(file.path) && (file.type !== 'text' || file.data.length > MAX_TEXT))
			throw Error('JavaScript files must be UTF-8 text no larger than 2 MiB.');
	}
	if (total > ASWAN_PROJECT_FILE_BYTES)
		throw Error(
			'Code project files exceed the 16 MiB cassette limit. Use Save preset for a larger audio instrument.',
		);
}
// ZIPs expose saved files as ordinary entries. Only changed working files are
// encoded in the manifest; unchanged VGM and PCM payloads are not copied again.
const METADATA_PATHS = new Set(['/metadata.json', '/cassette.metadata.js']);
const sameFile = (a, b) => Boolean(a && b && a.type === b.type && (
	typeof a.data === 'string' ? a.data === b.data :
		a.data.length === b.data.length && a.data.every((value, index) => value === b.data[index])
));
const sameSnapshot = (a, b) => a.files.length === b.files.length &&
	JSON.stringify([...a.directories].sort()) === JSON.stringify([...b.directories].sort()) &&
	a.files.every(file => sameFile(file, b.files.find(other => other.path === file.path)));
function canonicalDataPath(value) {
	if (typeof value !== 'string' || normalizeVirtualPath(value) !== value ||
		value === '/' || value === ASWAN_PROJECT_MANIFEST)
		throw Error('Invalid ASWAN recovery path.');
	return value;
}
function encodeFile(file) {
	if (file.type === 'text') return {path: file.path, type: 'text', data: file.data};
	let source = '';
	for (let offset = 0; offset < file.data.length; offset += 32768)
		source += String.fromCharCode(...file.data.subarray(offset, offset + 32768));
	return {path: file.path, type: 'binary', data: btoa(source)};
}
function decodeFile(file) {
	if (!file || !['text', 'binary'].includes(file.type) || typeof file.data !== 'string')
		throw Error('Invalid ASWAN working file.');
	const path = canonicalDataPath(file.path);
	if (file.type === 'text') return {path, type: 'text', data: file.data};
	if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(file.data))
		throw Error('Invalid ASWAN working binary encoding.');
	return {path, type: 'binary', data: Uint8Array.from(atob(file.data), character => character.charCodeAt(0))};
}
function workingDelta(workspace) {
	const state = workspace.snapshot(),
		saved = new Map(state.saved.files.map(file => [file.path, file])),
		working = new Set(state.working.files.map(file => file.path));
	return {
		version: 1,
		autoSave: state.autoSave,
		files: state.working.files.filter(file => !sameFile(file, saved.get(file.path))).map(encodeFile),
		deleted: state.saved.files.filter(file => !working.has(file.path)).map(file => file.path),
		directories: {
			created: state.working.directories.filter(path => !state.saved.directories.includes(path)),
			deleted: state.saved.directories.filter(path => !state.working.directories.includes(path)),
		},
		savedTextPaths: state.saved.files.filter(file => file.type === 'text').map(file => file.path),
		metadataPaths: state.saved.files.filter(file => METADATA_PATHS.has(file.path)).map(file => file.path),
	};
}
function restoreDelta(entries, directories, delta) {
	if (!delta || delta.version !== 1 || typeof delta.autoSave !== 'boolean' ||
		!Array.isArray(delta.files) || !Array.isArray(delta.deleted) ||
		!Array.isArray(delta.savedTextPaths) || !Array.isArray(delta.metadataPaths) ||
		!delta.directories || !Array.isArray(delta.directories.created) || !Array.isArray(delta.directories.deleted))
		throw Error('Invalid ASWAN working recovery state.');
	const metadataPaths = new Set(delta.metadataPaths);
	if (metadataPaths.size !== delta.metadataPaths.length || [...metadataPaths].some(path => !METADATA_PATHS.has(path)))
		throw Error('Invalid ASWAN metadata recovery paths.');
	const savedFiles = entries.filter(file => !METADATA_PATHS.has(file.path) || metadataPaths.has(file.path));
	for (const path of metadataPaths)
		if (!savedFiles.some(file => file.path === path)) throw Error('Missing ASWAN original metadata file.');
	const textPaths = new Set(delta.savedTextPaths);
	if (textPaths.size !== delta.savedTextPaths.length) throw Error('Duplicate ASWAN saved text path.');
	for (const path of textPaths) {
		canonicalDataPath(path);
		const file = savedFiles.find(file => file.path === path);
		if (!file) throw Error('Missing ASWAN saved text file.');
		file.type = 'text';
		file.data = text(file.data);
	}
	const saved = createVirtualFileSystem();
	saved.replace(savedFiles, directories);
	const files = new Map(saved.list().map(file => [file.path, file])), seen = new Set();
	for (const path of delta.deleted) {
		canonicalDataPath(path);
		if (seen.has(path) || !files.has(path)) throw Error('Invalid ASWAN working deletion.');
		seen.add(path);
		files.delete(path);
	}
	for (const file of delta.files.map(decodeFile)) {
		if (seen.has(file.path)) throw Error('Duplicate ASWAN working path.');
		seen.add(file.path);
		files.set(file.path, file);
	}
	const dirs = new Set(saved.listDirectories()), seenDirs = new Set();
	for (const path of delta.directories.deleted) {
		canonicalDataPath(path);
		if (seenDirs.has(path) || !dirs.has(path)) throw Error('Invalid ASWAN working folder deletion.');
		seenDirs.add(path);
		dirs.delete(path);
	}
	for (const path of delta.directories.created) {
		canonicalDataPath(path);
		if (seenDirs.has(path) || dirs.has(path)) throw Error('Invalid ASWAN working folder creation.');
		seenDirs.add(path);
		dirs.add(path);
	}
	const working = createVirtualFileSystem();
	working.replace([...files.values()], [...dirs]);
	return {version: 1, working: working.snapshot(), saved: saved.snapshot(), autoSave: delta.autoSave};
}

function soundPath(value,working,saved){
  if(value==null)return null;const path=pathForUser(canonicalDataPath(value)),file=working.get(path)??saved.get(path);
  if(file?.type!=='text'||!isAswanTextPath(path))throw Error('Active ASWAN sound document is missing or not text.');return path;
}
function pendingPaths(value){
  if(!Array.isArray(value))throw Error('Invalid ASWAN pending moves.');
  const sources=new Set(),targets=new Set();
  return value.map(pair=>{if(!Array.isArray(pair)||pair.length!==2)throw Error('Invalid ASWAN pending move.');const [source,target]=pair.map(value=>pathForUser(canonicalDataPath(value)));
    if(source===target||sources.has(source)||targets.has(target))throw Error('Duplicate ASWAN pending move.');sources.add(source);targets.add(target);return[source,target];});
}
// These aliases apply only to our ZIP manifest. Public snapshots keep both
// settings objects explicit, but unchanged PCM payloads need not be stored a
// second time solely to retain the accepted authoring cache.
function compactManifestSettings(value){
  const result=clone(value);
  if(JSON.stringify(result.settings)===JSON.stringify(result.savedSettings)){
    delete result.savedSettings;result.savedSettingsSource='settings';
  }else if(result.savedSettings.pcm.data===result.settings.pcm.data){
    delete result.savedSettings.pcm.data;result.savedPcmSource='settings';
  }
  return result;
}
function expandManifestSettings(value){
  const result={...value};
  if(value.savedSettingsSource!==undefined){
    if(value.savedSettingsSource!=='settings'||value.savedSettings!==undefined||value.savedPcmSource!==undefined)throw Error('Invalid ASWAN accepted-settings alias.');
    result.savedSettings=readPreset(value.settings);
  }else if(value.savedPcmSource!==undefined){
    if(value.savedPcmSource!=='settings'||!value.savedSettings?.pcm||value.savedSettings.pcm.data!==undefined||typeof value.settings?.pcm?.data!=='string')throw Error('Invalid ASWAN accepted-PCM alias.');
    result.savedSettings={...value.savedSettings,pcm:{...value.savedSettings.pcm,data:value.settings.pcm.data}};
  }
  return result;
}

export function createAswanCodeProject({
	settings = createDefaultPreset(),
	snapshot,
	starterCode,
	getStarterCode,
} = {}) {
	const workspace = createVirtualFileWorkspace(),
		fs = workspace.working,
		savedFs = workspace.saved,
		listeners = new Set();
	let current = readPreset(settings),
		accepted = readPreset(settings), activeSound = null, moves = [],
		selected = null,
		state = { mode: 'keyboard', path: null },
		projectName = 'Tetorica ASWAN',
		restoring = false,
		entryCache = null;
	const notify = () => {
		if (!restoring) for (const listener of listeners) listener();
	};
	workspace.onDidChange(() => {
		entryCache = null;
		notify();
	});
	const project = {
		fs,
		savedFs,
		workspace,
		get autoApply() { return workspace.autoSave; },
		setAutoApply(enabled) {
			if (enabled) validateFiles(fs);
			workspace.setAutoSave(enabled);
			if (enabled) moves = [];
			return workspace.autoSave;
		},
		getDirtyPaths: () => workspace.getDirtyPaths(),
		isFileModified: (path) => workspace.isDirty(path),
		saveFiles(paths) {
			validateFiles(fs);
			workspace.saveMany(paths);
			return [...paths];
		},
		discardFiles(paths) {
			workspace.discardMany(paths);
			return [...paths];
		},
		saveAll() {
			validateFiles(fs);
			const paths = workspace.getDirtyPaths();
			workspace.saveAll();
			moves = [];
			return paths;
		},
		onDidChange(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		get settings() {
			return readPreset(current);
		},
		setSettings(value) {
			const next = readPreset(value);
			if (JSON.stringify(next) !== JSON.stringify(current)) {
				current = next;
				notify();
			}
			return project.settings;
		},
		get savedSettings() { return readPreset(accepted); },
		setSavedSettings(value) {
			const next = readPreset(value);
			if (JSON.stringify(next) !== JSON.stringify(accepted)) { accepted = next; notify(); }
			return project.savedSettings;
		},
		get activeSoundPath() { return activeSound; },
		setActiveSoundPath(value) {
			const next = soundPath(value, fs, savedFs);
			if (next !== activeSound) { activeSound = next; notify(); }
			return activeSound;
		},
		getPendingMoves: () => clone(moves),
		setPendingMoves(value) { moves = pendingPaths(value); notify(); return clone(moves); },
		listEntries() {
			entryCache ??= fs
				.list()
				.map((file) => ({
					path: file.path,
					revision: file.revision,
					type: 'file',
					fileType: file.type,
					size:
						file.type === 'text'
							? new TextEncoder().encode(file.data).byteLength
							: file.data.byteLength,
				}));
			return entryCache.map((entry) => ({ ...entry }));
		},
		get selectedPath() {
			return selected;
		},
		get cassetteName() {
			return projectName;
		},
		select(path) {
			const next = selectedPath(path, fs);
			if (next !== selected) {
				selected = next;
				notify();
			}
			return selected;
		},
		writeEditorText(path, source) {
			path = pathForUser(path);
			if (typeof source !== 'string') throw TypeError('Editor content must be text.');
			if (!editorPath(path, fs) && !(isAswanCodePath(path) && !fs.has(path)))
				throw Error('Choose a project text file.');
			if (isAswanCodePath(path) && source.length > MAX_TEXT)
				throw Error('JavaScript files must be UTF-8 text no larger than 2 MiB.');
			const encoder = new TextEncoder();
			let total = encoder.encode(source).byteLength;
			for (const file of fs.list())
				if (file.path !== path)
					total +=
						file.type === 'text'
							? encoder.encode(file.data).byteLength
							: file.data.byteLength;
			if (total > ASWAN_PROJECT_FILE_BYTES)
				throw Error(
					'Code project files exceed the 16 MiB cassette limit. Use Save preset for a larger audio instrument.',
				);
			fs.writeText(path, source);
		},
		setCodeState(value) {
			const next = codeState(value, fs);
			if (next.mode !== state.mode || next.path !== state.path) {
				state = next;
				notify();
			}
		},
		getCodeState: () => clone(state),
		snapshot() {
			return {
				format: ASWAN_PROJECT_FORMAT,
				version: 2,
				name: projectName,
				settings: project.settings,
				savedSettings: project.savedSettings,
				activeSoundPath: activeSound,
				pendingMoves: clone(moves),
				selectedPath: selected,
				codeState: clone(state),
				filesystem: fs.snapshot(),
				workspace: workspace.snapshot(),
			};
		},
		restore(value) {
			if (value?.format !== ASWAN_PROJECT_FORMAT || ![1, 2].includes(value.version))
				throw Error('Unsupported ASWAN project format/version.');
			const candidate = createVirtualFileWorkspace();
			if (value.version === 1) {
				const legacy = createVirtualFileSystem();
				legacy.restore(value.filesystem);
				candidate.restore({version: 1, working: legacy.snapshot(), saved: legacy.snapshot(), autoSave: true});
			} else {
				candidate.restore(value.workspace);
				if (value.filesystem !== undefined) {
					const compatible = createVirtualFileSystem();
					compatible.restore(value.filesystem);
					if (!sameSnapshot(compatible.snapshot(), candidate.working.snapshot()))
						throw Error('Inconsistent ASWAN working filesystem snapshot.');
				}
			}
			validateFiles(candidate.working);
			validateFiles(candidate.saved);
			const nextSettings = readPreset(value.settings),
				nextAccepted = readPreset(value.version === 1 ? value.settings : value.savedSettings ?? value.settings),
				nextActive = soundPath(value.activeSoundPath, candidate.working, candidate.saved),
				nextMoves = pendingPaths(value.pendingMoves ?? []),
				nextSelected = selectedPath(value.selectedPath, candidate.working),
				nextState = codeState(value.codeState, candidate.working),
				nextName = name(value.name);
			restoring = true;
			try {
				workspace.restore(candidate.snapshot());
				current = nextSettings;
				accepted = nextAccepted; activeSound = nextActive; moves = nextMoves;
				selected = nextSelected;
				state = nextState;
				projectName = nextName;
			} finally {
				restoring = false;
			}
			notify();
			return project.snapshot();
		},
		importFiles(entries) {
			const candidate = createVirtualFileSystem();
			candidate.restore(fs.snapshot());
			const normalized = entries.map((entry) => ({
				path: pathForUser(entry.path),
				type: entry.type ?? (isAswanTextPath(entry.path) ? 'text' : 'binary'),
				data: entry.data,
			}));
			for (const entry of normalized)
				if (entry.type === 'text' && typeof entry.data !== 'string')
					entry.data = text(entry.data);
			candidate.writeFiles(normalized);
			validateFiles(candidate);
			fs.restore(candidate.snapshot());
			return normalized.map((entry) => entry.path);
		},
		importSongSources(sources) {
			return project.importFiles(aswanSongSourceEntries(project, sources));
		},
		async prepareImport(bytes) {
			const cassette = await loadPlaygroundCassette(bytes),
				files = [],
				manifest = cassette.files.get(ASWAN_PROJECT_MANIFEST.slice(1));
			let metadata = null;
			if (manifest) {
				try {
					metadata = JSON.parse(text(manifest));
				} catch {
					throw Error('Invalid ASWAN project manifest JSON.');
				}
			}
			if (metadata && (metadata.format !== ASWAN_PROJECT_FORMAT || ![1, 2].includes(metadata.version)))
				throw Error('Unsupported ASWAN project format/version.');
			if (metadata?.version === 2) {
				for (const [path, data] of cassette.files)
					if ('/' + path !== ASWAN_PROJECT_MANIFEST) files.push({path: '/' + path, type: 'binary', data});
				const layers = restoreDelta(files, cassette.directories, metadata.workingDelta);
				const candidate = createAswanCodeProject({settings: current});
				candidate.restore({...expandManifestSettings(metadata), workspace: layers, filesystem: layers.working});
				return candidate.snapshot();
			}
			for (const [path, data] of cassette.files) {
				if ('/' + path === ASWAN_PROJECT_MANIFEST) continue;
				files.push({
					path: '/' + path,
					type: isAswanTextPath(path) ? 'text' : 'binary',
					data: isAswanTextPath(path) ? text(data) : data,
				});
			}
			const candidate = createAswanCodeProject({ settings: current });
			candidate.fs.writeFiles(files);
			for (const directory of cassette.directories)
				if (directory !== '/') candidate.fs.mkdir(directory, { recursive: true });
			const next = metadata ?? {
				format: ASWAN_PROJECT_FORMAT,
				version: 1,
				name: projectName,
				settings: project.settings,
				selectedPath: null,
				codeState: { mode: 'keyboard', path: null },
			};
			candidate.restore({ ...next, filesystem: candidate.fs.snapshot() });
			return candidate.snapshot();
		},
		exportProject() {
			validateFiles(fs);
			validateFiles(savedFs);
			const {filesystem, workspace: layers, ...manifest} = project.snapshot();
			const metadata = JSON.stringify({...compactManifestSettings(manifest), workingDelta: workingDelta(workspace)}, null, 2) + '\n';
			const total = new TextEncoder().encode(metadata).byteLength + savedFs.list().reduce(
				(bytes, file) => bytes + (file.type === 'text' ? new TextEncoder().encode(file.data).byteLength : file.data.byteLength), 0);
			if (total > 16 * 1024 * 1024) throw Error('Code project exceeds the 16 MiB expanded cassette limit.');
			return createPlaygroundCassetteZip(
				[...savedFs.list(), {path: ASWAN_PROJECT_MANIFEST, type: 'text', data: metadata}],
				{directories: savedFs.listDirectories(), preserveMetadataFiles: true},
			);
		},
		recoverCode(path, {source, savedSource, autoSave}) {
			path = pathForUser(canonicalDataPath(path));
			if (!isAswanTextPath(path) || typeof source !== 'string' ||
				(savedSource !== null && typeof savedSource !== 'string') || typeof autoSave !== 'boolean')
				throw Error('Invalid ASWAN Code recovery versions.');
			const working = createVirtualFileSystem(), saved = createVirtualFileSystem();
			working.restore(fs.snapshot());
			saved.restore(savedFs.snapshot());
			working.writeText(path, source);
			if (savedSource === null) {
				if (saved.has(path)) saved.remove(path);
			} else saved.writeText(path, savedSource);
			const candidate = createVirtualFileWorkspace();
			candidate.restore({version: 1, working: working.snapshot(), saved: saved.snapshot(), autoSave});
			validateFiles(candidate.working);
			validateFiles(candidate.saved);
			workspace.restore(candidate.snapshot());
		},
	};
	Object.assign(project, createSynthCodeProject(project));
	// Prepared for the Files acceptance UI. The current host still uses working
	// readers until Save/Discard and active sound acceptance ship together.
	const savedCode = createSynthCodeProject(project, {version: 'saved'});
	project.readSavedFile = savedCode.readFile;
	project.prepareSavedSource = savedCode.prepareSource;
	if (starterCode === undefined && !snapshot && getStarterCode) starterCode = getStarterCode();
	if (starterCode !== undefined) {
		if (typeof starterCode !== 'string') throw TypeError('Starter code must be text.');
		fs.writeText('/index.js', starterCode);
	}
	if (snapshot) project.restore(snapshot);
	return project;
}

function storageJson(snapshot) {
	return JSON.stringify(snapshot, (_key, value) =>
		value instanceof Uint8Array ? { $aswanBytes: Array.from(value) } : value,
	);
}
function storageParse(source) {
	return JSON.parse(source, (_key, value) =>
		value && Array.isArray(value.$aswanBytes) ? Uint8Array.from(value.$aswanBytes) : value,
	);
}
export function createAswanProjectStore({
	indexedDB = globalThis.indexedDB,
	storage = globalThis.localStorage,
} = {}) {
	return createSynthProjectStore({
		indexedDB,
		name: 'tetorica-aswan-synth-files',
		readFallback() {
			const source = storage?.getItem(ASWAN_PROJECT_STORAGE_KEY);
			return source ? storageParse(source) : null;
		},
		writeFallback(snapshot) {
			if (!storage) return false;
			storage.setItem(ASWAN_PROJECT_STORAGE_KEY, storageJson(snapshot));
			return true;
		},
	});
}

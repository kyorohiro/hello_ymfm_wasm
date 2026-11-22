// SPDX-License-Identifier: BSD-3-Clause
import { validateBuzzerPattern } from './buzzer.js';
import { createVirtualFileWorkspace } from '../js/tetorica_virtual_files/workspace.js';
import { isCheckpointPath, transferVirtualFiles } from '../js/tetorica_virtual_files/filesystem.js';
import { normalizeVirtualPath } from '../js/tetorica_virtual_files/path.js';
import { createPlaygroundCassetteZip, loadPlaygroundCassette } from '../playground/playground_cassette.js';
import { renderFileTree } from '../playground/playground_file_tree.js';
import { createSynthCodeProject } from '../synth/synth_code_project.js';
import { setupSynthMenu } from '../synth/synth_menu.js';
import { createSynthProjectStore } from '../synth/synth_project_store.js';

const MAX_BYTES = 16 * 1024 * 1024;
const PATTERN_PATH = '/pattern.json';
const DRAFT_ROOT = '/.lcd-buzzer-drafts';
const WORKSPACE_FORMAT = 'tetorica-lcd-buzzer';
const TEXT_FILE = /\.(?:m?js|json|txt|md|csv|css|html|ya?ml)$/i;
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const encoder = new TextEncoder();
const inside = (path, root) => path === root || path?.startsWith(root + '/');
const patternPath = path => path === PATTERN_PATH || /\.lcd-buzzer\.json$/i.test(path);
const basename = path => path.slice(path.lastIndexOf('/') + 1);

function patternText(value) {
	return JSON.stringify(validateBuzzerPattern(value), null, 2) + '\n';
}

function userPath(value) {
	const path = normalizeVirtualPath(value);
	if (path === '/' || path === '/metadata.json' || path === '/cassette.metadata.js' ||
		inside(path, DRAFT_ROOT) || isCheckpointPath(path) || path.split('/').includes('__proto__') ||
		/[\x00-\x1f\x7f]/.test(path)) throw Error('Choose a non-reserved file path.');
	return path;
}

function exists(fs, path) {
	if (typeof path !== 'string') return false;
	try { fs.stat(path); return true; } catch { return false; }
}

function fileBytes(data) {
	return typeof data === 'string' ? encoder.encode(data).byteLength : data.byteLength;
}

function checkSize(entries) {
	if (entries.reduce((total, { data }) => total + fileBytes(data), 0) > MAX_BYTES)
		throw Error('Files exceed the 16 MiB Cassette size limit.');
}

function validateProjectSnapshot(snapshot) {
	const workspace = createVirtualFileWorkspace();
	if (!snapshot || snapshot.format !== WORKSPACE_FORMAT || snapshot.version !== 1)
		throw Error('Unsupported LCD Buzzer project.');
	for (const layer of [snapshot.workspace?.working, snapshot.workspace?.saved]) {
		if (!Array.isArray(layer?.files) || !Array.isArray(layer?.directories))
			throw Error('Invalid Cassette file list.');
		for (const file of layer.files) {
			if (userPath(file.path) !== file.path) throw Error('Invalid Cassette file path.');
		}
		for (const path of layer.directories)
			if (path !== '/' && userPath(path) !== path) throw Error('Invalid Cassette folder path.');
		checkSize(layer.files);
	}
	workspace.restore(snapshot.workspace);
	const selected = snapshot.selected === null ? null : userPath(snapshot.selected);
	if (selected && !exists(workspace.working, selected) && !exists(workspace.saved, selected))
		throw Error('The selected file is missing from this Cassette.');
	const activePattern = snapshot.activePattern === null ? null : userPath(snapshot.activePattern);
	if (activePattern && (!patternPath(activePattern) || !workspace.working.has(activePattern)))
		throw Error('The active pattern file is missing from this Cassette.');
	const codePath = snapshot.codeState?.path;
	const codeMode = snapshot.codeState?.mode;
	if (!['keyboard', 'code'].includes(codeMode) || (codePath !== null &&
		(typeof codePath !== 'string' || workspace.working.get(codePath)?.type !== 'text')))
		throw Error('Invalid Cassette editor selection.');
	if (!Array.isArray(snapshot.moves) || snapshot.moves.some(pair => !Array.isArray(pair) || pair.length !== 2))
		throw Error('Invalid Cassette file moves.');
	const moves = snapshot.moves.map(([from, to]) => [userPath(from), userPath(to)]);
	return {
		format: WORKSPACE_FORMAT, version: 1, workspace: workspace.snapshot(), moves, selected, activePattern,
		codeState: { mode: codeMode, path: codePath }, pattern: validateBuzzerPattern(snapshot.pattern),
		filesVisible: Boolean(snapshot.filesVisible),
	};
}

export function encodeBuzzerCassette(state) {
	const { workspace, ...metadata } = validateProjectSnapshot(state);
	const { saved, working, autoSave } = workspace;
	const accepted = new Map(saved.files.map(file => [file.path, file]));
	const workingPaths = new Set(working.files.map(file => file.path));
	const archived = [];
	const changed = [];
	for (const file of working.files) {
		const savedFile = accepted.get(file.path);
		const sameData = savedFile?.type === file.type && (file.type === 'text'
			? file.data === savedFile.data
			: file.data.length === savedFile.data.length && file.data.every((byte, i) => byte === savedFile.data[i]));
		if (sameData) continue;
		const archivePath = `${DRAFT_ROOT}/${archived.length}`;
		archived.push({ ...file, path: archivePath });
		changed.push({ path: file.path, type: file.type, archivePath });
	}
	const deleted = saved.files.map(file => file.path).filter(path => !workingPaths.has(path));
	return createPlaygroundCassetteZip([...saved.files, ...archived], {
		directories: saved.directories,
		metadata: {
			lcdBuzzer: {
				...metadata, autoSave, changed, deleted, workingDirectories: working.directories,
				textPaths: saved.files.filter(file => file.type === 'text').map(file => file.path),
			},
		},
	});
}

export async function decodeBuzzerCassette(bytes) {
	const cassette = await loadPlaygroundCassette(bytes);
	const state = cassette.metadata.lcdBuzzer;
	if (!state || state.format !== WORKSPACE_FORMAT || state.version !== 1) throw Error('Choose an LCD Buzzer Cassette.');
	if (!Array.isArray(state.textPaths) || !Array.isArray(state.changed) || !Array.isArray(state.deleted) ||
		!Array.isArray(state.workingDirectories)) throw Error('Invalid Cassette file metadata.');
	const textPaths = new Set(state.textPaths.map(userPath));
	const entries = new Map([...cassette.files].map(([path, data]) => ['/' + path, data]));
	const saved = [];
	for (const [path, bytes] of entries) {
		if (path === '/metadata.json' || inside(path, DRAFT_ROOT)) continue;
		const isText = textPaths.delete(path);
		saved.push({ path: userPath(path), type: isText ? 'text' : 'binary', data: isText ? decoder.decode(bytes) : bytes });
	}
	if (textPaths.size) throw Error('A saved text file is missing from this Cassette.');
	const working = new Map(saved.map(file => [file.path, file]));
	const touched = new Set();
	for (const original of state.deleted) {
		const path = userPath(original);
		if (!working.delete(path)) throw Error('Invalid deleted file in Cassette.');
		touched.add(path);
	}
	for (const [index, entry] of state.changed.entries()) {
		const path = userPath(entry.path);
		const archivePath = `${DRAFT_ROOT}/${index}`;
		const bytes = entries.get(archivePath);
		if (entry.archivePath !== archivePath || !bytes || touched.has(path) || !['text', 'binary'].includes(entry.type))
			throw Error('Invalid working file in Cassette.');
		touched.add(path);
		working.set(path, { path, type: entry.type, data: entry.type === 'text' ? decoder.decode(bytes) : bytes });
	}
	return validateProjectSnapshot({
		...state,
		workspace: {
			version: 1, autoSave: state.autoSave,
			saved: { version: 1, files: saved, directories: cassette.directories.filter(path => !inside(path, DRAFT_ROOT)) },
			working: { version: 1, files: [...working.values()], directories: state.workingDirectories },
		},
	});
}

export function setupBuzzerWorkspace({ document: doc, setStatus, getPattern, applyPattern, stopPerformance, getStarterCode }) {
	const win = doc.defaultView;
	const byId = id => doc.getElementById(id);
	const panel = byId('buzzerFilesPanel');
	const toggle = byId('buzzerFilesToggle');
	const defaultPattern = validateBuzzerPattern(getPattern());
	const starterFiles = () => [
		{ path: '/index.js', data: getStarterCode() },
		{ path: PATTERN_PATH, data: patternText(defaultPattern) },
	];
	const workspace = createVirtualFileWorkspace(starterFiles());
	const fs = workspace.working, savedFs = workspace.saved;
	const store = createSynthProjectStore({ name: 'tetorica-lcd-buzzer-synth-project' });
	const expanded = new Map();
	const moves = new Map();
	let code, selected = '/index.js', activePattern = PATTERN_PATH;
	let codeState = { mode: 'keyboard', path: '/index.js' };
	let identity = win.crypto.randomUUID?.() ?? `buzzer-${Date.now()}`;
	let busy = true, restoring = false, persistenceReady = false, saveTimer = null;
	let applying = false;

	const make = (tag, text) => {
		const element = doc.createElement(tag);
		if (text) element.textContent = text;
		return element;
	};
	const report = error => setStatus(error.message || String(error));
	const button = (id, label, onClick) => {
		const element = make('button', label);
		element.type = 'button';
		element.id = id;
		element.addEventListener('click', () => { void Promise.resolve().then(onClick).catch(report); });
		return element;
	};
	const project = {
		workspace, fs, savedFs,
		onDidChange: listener => workspace.onDidChange(listener),
		get autoApply() { return workspace.autoSave; },
		writeEditorText(path, source) {
			path = userPath(path);
			if (typeof source !== 'string') throw Error('Expected text.');
			checkSize([...fs.list().filter(file => file.path !== path), { data: source }]);
			fs.writeFile(path, source);
		},
	};
	Object.assign(project, createSynthCodeProject(project, { channelCount: 1 }));
	const savedCode = createSynthCodeProject(project, { version: 'saved', channelCount: 1 });
	project.readSavedFile = savedCode.readFile;
	project.prepareSavedSource = savedCode.prepareSource;
	project.recoverCode = (path, { source, savedSource, autoSave }) => {
		if (autoSave) return project.writeEditorText(path, source);
		path = userPath(path);
		const snapshot = workspace.snapshot();
		const saved = createVirtualFileWorkspace();
		saved.working.restore(snapshot.saved);
		if (savedSource === null) {
			if (saved.working.has(path)) saved.working.remove(path);
		} else saved.working.writeFile(path, savedSource);
		const working = createVirtualFileWorkspace();
		working.working.restore(snapshot.working);
		working.working.writeFile(path, source);
		checkSize(working.working.list());
		checkSize(saved.working.list());
		workspace.restore({ ...snapshot, autoSave: false, working: working.working.snapshot(), saved: saved.working.snapshot() });
	};

	const heading = make('div');
	heading.className = 'buzzer-files-heading';
	const title = make('h2', 'Files');
	const guide = make('a', 'Sound chip');
	guide.className = 'buzzer-files-guide';
	guide.href = '#buzzerChipGuide';
	guide.addEventListener('click', () => {
		const details = byId('buzzerChipGuide');
		if (details) details.open = true;
	});
	const autoLabel = make('label', 'Auto apply ');
	const auto = make('input');
	auto.type = 'checkbox';
	auto.id = 'buzzerFilesAutoApply';
	autoLabel.append(auto);
	heading.append(title, autoLabel);
	const actions = make('div');
	actions.className = 'buzzer-files-actions';
	const filePathLabel = make('p');
	filePathLabel.className = 'buzzer-file-path';
	filePathLabel.setAttribute('aria-live', 'polite');
	const tree = make('div');
	tree.id = 'buzzerFilesTree';
	tree.className = 'buzzer-files-tree';
	actions.setAttribute('role', 'group');
	actions.setAttribute('aria-label', 'Files actions');
	panel.append(heading, guide, actions, tree, filePathLabel);

	const nameDialog = make('dialog');
	nameDialog.className = 'buzzer-file-dialog';
	const nameForm = make('form');
	const nameLabel = make('label');
	const nameInput = make('input');
	nameInput.type = 'text';
	nameInput.required = true;
	nameLabel.htmlFor = nameInput.id = 'buzzerFileName';
	const nameActions = make('div');
	nameActions.className = 'buzzer-file-dialog-actions';
	const nameCancel = button('buzzerFileNameCancel', 'Cancel', () => nameDialog.close());
	const nameConfirm = make('button', 'OK');
	nameConfirm.id = 'buzzerFileNameConfirm';
	nameConfirm.type = 'submit';
	nameActions.append(nameCancel, nameConfirm);
	nameForm.append(nameLabel, nameInput, nameActions);
	nameDialog.append(nameForm);
	let pendingName;
	nameDialog.addEventListener('close', () => { pendingName = null; });
	nameForm.addEventListener('submit', event => {
		event.preventDefault();
		const apply = pendingName;
		if (!apply) return;
		void transact(async () => {
			await apply(userPath(nameInput.value));
			nameDialog.close();
		}).catch(report);
	});
	doc.body.append(nameDialog);

	const newDialog = make('dialog');
	newDialog.id = 'buzzerNewCassetteDialog';
	newDialog.className = 'buzzer-file-dialog';
	newDialog.setAttribute('aria-labelledby', 'buzzerNewCassetteTitle');
	const newTitle = make('h2', 'Create a new Cassette?');
	newTitle.id = 'buzzerNewCassetteTitle';
	const newActions = make('div');
	newActions.className = 'buzzer-file-dialog-actions';
	const newCancel = button('buzzerNewCassetteCancel', 'Cancel', () => newDialog.close());
	const createNew = button('buzzerNewCassetteCreate', 'Create without export', () => newCassette(false));
	const exportNew = button('buzzerNewCassetteExport', 'Export current & create', () => newCassette(true));
	newActions.append(newCancel, exportNew, createNew);
	newDialog.append(newTitle, make('p', 'A new Cassette starts with the original pattern and starter Code. Export the current Cassette to keep your work.'), newActions);
	doc.body.append(newDialog);

	const cassetteInput = make('input'), fileInput = make('input');
	cassetteInput.hidden = fileInput.hidden = true;
	cassetteInput.type = fileInput.type = 'file';
	cassetteInput.id = 'buzzerCassetteInput';
	fileInput.id = 'buzzerFilesImportInput';
	cassetteInput.accept = '.zip,application/zip';
	fileInput.multiple = true;
	panel.append(cassetteInput, fileInput);

	function askName(label, value, apply) {
		if (busy) return;
		pendingName = apply;
		nameLabel.textContent = label;
		nameInput.value = value;
		nameDialog.showModal();
		nameInput.select();
	}

	function setVisible(visible) {
		panel.hidden = !visible;
		toggle.setAttribute('aria-expanded', String(visible));
		if (visible) render();
		schedulePersist();
	}

	function syncPattern(pattern) {
		applying = true;
		try { applyPattern(validateBuzzerPattern(typeof pattern === 'string' ? JSON.parse(pattern) : pattern)); }
		finally { applying = false; }
	}

	function patternChanged() {
		if (applying || restoring) return;
		try {
			if (activePattern) {
				const source = fs.get(activePattern)?.data;
				if (typeof source === 'string') {
					// Leave a partially edited pattern document available in Code.
					validateBuzzerPattern(JSON.parse(source));
					project.writeEditorText(activePattern, patternText(getPattern()));
					if (code?.activePath === activePattern) code.reloadFile?.();
				}
			}
		} catch (error) { report(error); }
		schedulePersist();
	}

	function snapshot() {
		const editor = code?.captureState?.() ?? codeState;
		return {
			format: WORKSPACE_FORMAT, version: 1, id: identity, workspace: workspace.snapshot(),
			moves: [...moves], activePattern, selected, pattern: validateBuzzerPattern(getPattern()),
			codeState: { mode: editor.mode, path: fs.get(editor.path ?? '/')?.type === 'text' ? editor.path : null },
			filesVisible: !panel.hidden,
		};
	}

	async function persistCode() {
		clearTimeout(saveTimer);
		if (!persistenceReady || restoring) return false;
		try { return await store.write(snapshot()); }
		catch (error) { report(Error(`Local save failed. Export Cassette to keep the project. ${error.message}`)); return false; }
	}

	function schedulePersist() {
		if (!persistenceReady || restoring) return;
		clearTimeout(saveTimer);
		saveTimer = setTimeout(() => { void persistCode(); }, 200);
	}

	async function transact(action) {
		if (busy) return;
		busy = true;
		code?.setBusy?.(true);
		render();
		try {
			if (await code?.flush?.({ persist: false }) === false) return;
			return await action();
		} finally {
			busy = false;
			code?.setBusy?.(false);
			render();
		}
	}

	function relatedPaths(path) {
		const related = new Set([path]);
		for (const [from, to] of moves)
			if (inside(from, path) || inside(to, path) || inside(path, from) || inside(path, to)) {
				related.add(from);
				related.add(to);
			}
		return [...related].filter(candidate => exists(fs, candidate) || exists(savedFs, candidate));
	}

	async function save(all = false) {
		await transact(async () => {
			const paths = all ? workspace.getDirtyPaths() : relatedPaths(selected ?? code?.activePath ?? activePattern ?? PATTERN_PATH);
			if (all) workspace.saveAll();
			else if (paths.length) workspace.saveMany(paths);
			for (const [from, to] of moves)
				if (all || paths.some(path => inside(from, path) || inside(to, path))) moves.delete(from);
			const durable = await persistCode();
			setStatus((all ? 'Saved all files.' : 'Saved selected file.') + (durable ? '' : ' Export a Cassette for a durable copy.'));
		});
	}

	async function discard() {
		await transact(async () => {
			if (!selected) return;
			const paths = relatedPaths(selected);
			if (!paths.length) return;
			const before = selected;
			const original = [...moves].find(([, to]) => to === selected)?.[0];
			workspace.discardMany(paths);
			selected = exists(fs, original) ? original : exists(fs, selected) ? selected : null;
			for (const [from, to] of moves)
				if (paths.some(path => inside(from, path) || inside(to, path))) moves.delete(from);
			if (code?.activePath === before && before !== selected) code.pathChanged(before, selected, { preserveExecution: true });
			else code?.reloadFile?.();
			if (activePattern === before || activePattern && !fs.has(activePattern)) {
				activePattern = selected && patternPath(selected) ? selected : null;
				if (activePattern) syncPattern(fs.get(activePattern).data);
			}
			await persistCode();
			setStatus('Discarded working changes.');
		});
	}

	async function selectFile(path) {
		if (busy) return false;
		const file = fs.get(path);
		selected = path;
		render();
		schedulePersist();
		if (file?.type !== 'text') return true;
		if (patternPath(path)) {
			try {
				syncPattern(file.data);
				activePattern = path;
				schedulePersist();
				setStatus(`Loaded ${basename(path)}.`);
			} catch (error) {
				setStatus(`Check ${basename(path)} in Code. ${error.message}`);
			}
			if (code?.isCodeMode?.()) await code.openFile(path);
			return true;
		}
		return await code?.openFile?.(path) ?? true;
	}

	function newCode() {
		askName('New JavaScript file', '/untitled.js', async path => {
			if (!/\.m?js$/i.test(path)) throw Error('Choose a .js or .mjs filename.');
			if (exists(fs, path) || exists(savedFs, path)) throw Error('That path already exists.');
			project.writeEditorText(path, '');
			selected = path;
			setVisible(true);
			nameDialog.close();
			await code?.openFile?.(path);
		});
	}

	function savePattern() {
		askName('Save pattern as', '/untitled.lcd-buzzer.json', async path => {
			if (!patternPath(path)) throw Error('Use a .lcd-buzzer.json filename.');
			if (path !== activePattern && (exists(fs, path) || exists(savedFs, path))) throw Error('That path already exists.');
			project.writeEditorText(path, patternText(getPattern()));
			workspace.save(path);
			selected = activePattern = path;
			if (code?.activePath === path) code.reloadFile?.();
			setVisible(true);
			await persistCode();
			setStatus(`Saved pattern as ${basename(path)}.`);
		});
	}

	function transfer(source, destination, copy = false) {
		source = userPath(source);
		destination = userPath(destination);
		if (source === destination) return;
		if (activePattern && inside(activePattern, source) && !copy &&
			!patternPath(destination + activePattern.slice(source.length)))
			throw Error('Keep the .lcd-buzzer.json extension for an active pattern.');
		if (exists(savedFs, destination) && !exists(fs, destination))
			throw Error('A saved file already uses that path.');
		transferVirtualFiles(fs, source, destination, { copy });
		if (!copy) {
			if (!workspace.autoSave) {
				const move = [...moves].find(([, to]) => to === source);
				if (move) moves.set(move[0], destination);
				else if (exists(savedFs, source)) moves.set(source, destination);
			}
			if (activePattern && inside(activePattern, source)) activePattern = destination + activePattern.slice(source.length);
			code?.pathChanged?.(source, destination, { preserveExecution: !workspace.autoSave });
		}
		selected = destination;
		schedulePersist();
	}

	function rename() {
		if (!selected || !exists(fs, selected)) return;
		const source = selected;
		askName('Rename or move file', source, path => transfer(source, path));
	}

	async function remove() {
		if (!selected || !exists(fs, selected)) return;
		const path = selected;
		if (!win.confirm(`Delete ${path}?`)) return;
		await transact(() => {
			fs.remove(path, { recursive: true });
			code?.pathChanged?.(path, null, { preserveExecution: !workspace.autoSave });
			if (activePattern && inside(activePattern, path)) activePattern = null;
			if (!exists(savedFs, path)) selected = null;
			schedulePersist();
		});
	}

	async function importFiles(files, directory = '') {
		if (!files.length) return;
		await transact(async () => {
			if (files.reduce((total, file) => total + file.size, 0) > MAX_BYTES)
				throw Error('Selected files exceed the 16 MiB Cassette size limit.');
			const incoming = [];
			const occupied = new Set([...fs.list(), ...savedFs.list()].map(file => file.path));
			for (const file of files) {
				const path = userPath(`${directory}/${file.name}`);
				if (occupied.has(path)) throw Error(`${path} already exists.`);
				occupied.add(path);
				const bytes = new Uint8Array(await file.arrayBuffer());
				incoming.push({ path, data: TEXT_FILE.test(path) ? decoder.decode(bytes) : bytes });
			}
			checkSize([...fs.list(), ...incoming]);
			fs.writeFiles(incoming);
			selected = incoming[0].path;
			setVisible(true);
			await persistCode();
			setStatus(`Imported ${incoming.length} file${incoming.length === 1 ? '' : 's'}.`);
		});
	}

	function downloadCassette() {
		const bytes = encodeBuzzerCassette(snapshot());
		const url = win.URL.createObjectURL(new win.Blob([bytes], { type: 'application/zip' }));
		const link = make('a');
		link.href = url;
		link.download = 'tetorica-lcd-buzzer.cassette.zip';
		link.click();
		win.setTimeout(() => win.URL.revokeObjectURL(url), 1000);
	}

	function restoreProject(state, id) {
		restoring = true;
		try {
			workspace.restore(state.workspace);
			identity = id ?? win.crypto.randomUUID?.() ?? `buzzer-${Date.now()}`;
			selected = state.selected;
			activePattern = state.activePattern;
			codeState = state.codeState;
			moves.clear();
			for (const [from, to] of state.moves) moves.set(from, to);
			setVisible(state.filesVisible);
			syncPattern(state.pattern);
		} finally {
			restoring = false;
			render();
		}
	}

	async function replaceProject(state) {
		const previous = snapshot();
		if (await code?.workspaceReplaced?.() === false) return false;
		await stopPerformance();
		try {
			restoreProject(state);
			if (await code?.restoreState?.(codeState) === false) throw Error('Could not open the Cassette editor.');
		} catch (error) {
			clearTimeout(saveTimer);
			restoreProject(previous, previous.id);
			await code?.restoreState?.(codeState);
			throw error;
		}
		persistenceReady = true;
		await persistCode();
		return true;
	}

	async function newCassette(exportCurrent) {
		await transact(async () => {
			const fresh = createVirtualFileWorkspace(starterFiles(), { autoSave: workspace.autoSave });
			const state = validateProjectSnapshot({
				...snapshot(), workspace: fresh.snapshot(), activePattern: PATTERN_PATH, selected: '/index.js',
				codeState: { mode: 'keyboard', path: '/index.js' }, pattern: defaultPattern, moves: [],
			});
			if (exportCurrent) downloadCassette();
			if (await replaceProject(state)) {
				newDialog.close();
				setStatus('New Cassette created. Ready to edit.');
			}
		});
	}

	const newButton = button('buzzerFileNew', 'New JS', newCode);
	const patternButton = button('buzzerSavePattern', 'Save pattern…', savePattern);
	const saveButton = button('buzzerFileSave', 'Save', () => save());
	const discardButton = button('buzzerFileDiscard', 'Discard', discard);
	const renameButton = button('buzzerFileRename', 'Rename…', rename);
	const deleteButton = button('buzzerFileDelete', 'Delete…', remove);
	const addButton = button('buzzerFileImport', 'Add files…', () => { fileInput.value = ''; fileInput.click(); });
	actions.append(newButton, patternButton, saveButton, discardButton, renameButton, deleteButton, addButton);

	function render() {
		const files = fs.list(), directories = fs.listDirectories().filter(path => path !== '/');
		const dirty = new Set(workspace.getDirtyPaths());
		const missing = savedFs.list().filter(file => !fs.has(file.path));
		renderFileTree(tree, [...files, ...missing, ...directories.map(path => ({ path, type: 'directory' }))], {
			selectedPath: selected, expanded,
			onOpen: path => { void selectFile(path).catch(report); },
			onTransfer: (source, destination, copy) => { void transact(() => transfer(source, destination, copy)).catch(report); },
			onImport: (files, directory) => { void importFiles(files, directory).catch(report); },
		});
		for (const node of tree.querySelectorAll('[data-file-path]')) {
			const path = node.getAttribute('data-file-path');
			if (node.matches('summary')) node.addEventListener('click', () => {
				selected = path;
				filePathLabel.textContent = path;
				updateActions();
			});
			if (node.matches('button') && dirty.has(path)) {
				node.textContent += ' ●';
				node.setAttribute('data-modified', '');
			}
		}
		filePathLabel.textContent = selected ?? '';
		panel.setAttribute('aria-busy', String(busy));
		auto.checked = workspace.autoSave;
		updateActions();
	}

	function updateActions() {
		const selectedExists = exists(fs, selected);
		const selectionDirty = selected && workspace.isDirty(selected);
		for (const control of [auto, newButton, patternButton, addButton]) control.disabled = busy;
		for (const id of ['buzzerMenuNew', 'buzzerMenuImport', 'buzzerMenuAddFiles', 'buzzerMenuExport', 'buzzerMenuSave']) {
			const control = byId(id);
			if (control) control.disabled = busy;
		}
		saveButton.disabled = discardButton.disabled = busy || !selectionDirty;
		renameButton.disabled = deleteButton.disabled = busy || !selectedExists;
	}

	auto.addEventListener('change', () => {
		const enabled = auto.checked;
		void transact(async () => {
			workspace.setAutoSave(enabled);
			if (enabled) moves.clear();
			await persistCode();
			setStatus(enabled ? 'Auto apply enabled.' : 'Auto apply paused. Save to accept edits.');
		}).catch(report);
	});
	toggle.addEventListener('click', () => setVisible(panel.hidden));
	fileInput.addEventListener('change', () => { void importFiles([...fileInput.files]).catch(report); });
	cassetteInput.addEventListener('change', () => {
		const file = cassetteInput.files[0];
		if (!file) return;
		void transact(async () => {
			if (file.size > MAX_BYTES) throw Error('Cassette exceeds the 16 MiB limit.');
			const state = await decodeBuzzerCassette(new Uint8Array(await file.arrayBuffer()));
			if (await replaceProject(state)) setStatus('Cassette opened. Ready to edit.');
		}).catch(report);
	});
	byId('buzzerMenuNew')?.addEventListener('click', () => { if (!busy) newDialog.showModal(); });
	byId('buzzerMenuImport')?.addEventListener('click', () => {
		if (!busy) { cassetteInput.value = ''; cassetteInput.click(); }
	});
	byId('buzzerMenuAddFiles')?.addEventListener('click', () => {
		if (!busy) { fileInput.value = ''; fileInput.click(); }
	});
	byId('buzzerMenuExport')?.addEventListener('click', () => {
		void transact(() => { downloadCassette(); setStatus('Cassette exported.'); }).catch(report);
	});
	byId('buzzerMenuSave')?.addEventListener('click', () => { void save(true).catch(report); });
	doc.addEventListener('keydown', event => {
		if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey || event.isComposing ||
			event.key.toLowerCase() !== 's' || doc.querySelector('dialog[open]')) return;
		event.preventDefault();
		event.stopImmediatePropagation();
		if (!event.repeat) void save(!selected && !code?.activePath).catch(report);
	}, true);
	win.addEventListener('pagehide', () => { void persistCode(); });
	workspace.onDidChange(() => { if (!restoring) { render(); schedulePersist(); } });
	setupSynthMenu({ document: doc, window: win });

	const setCodeControls = controls => { code = controls; };
	const ready = Promise.resolve().then(async () => {
		try {
			const state = await store.read();
			if (state) restoreProject(validateProjectSnapshot(state), state.id);
			persistenceReady = true;
		} catch (error) { report(Error(`Could not restore the local Cassette. ${error.message}`)); }
		finally { busy = false; render(); }
	});
	const files = {
		ready, setCodeControls, persistCode, selectFile, setVisible,
		get workspaceId() { return identity; },
		isAutoApply: () => workspace.autoSave,
		getCodeState: () => codeState,
		rememberCodeState: state => { codeState = state; schedulePersist(); },
		codeEdited(path) {
			if (path !== activePattern) return;
			try { syncPattern(fs.get(path).data); } catch {} // Allow incomplete JSON drafts.
		},
		recoverCodeState(path) { this.codeEdited(path); schedulePersist(); },
	};
	render();
	return { project, files, ready, setCodeControls, patternChanged };
}

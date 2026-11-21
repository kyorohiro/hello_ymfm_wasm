// SPDX-License-Identifier: BSD-3-Clause
import { renderFileTree } from '../playground/playground_file_tree.js';
import { installSpuFileContextMenu } from '../synth-spu/file_context_menu.js';
import { createNdsProjectStore, isNdsCodePath, isNdsTextPath, ndsProjectPath, NDS_PROJECT_FILE_BYTES } from './nds-project.js';
import { isNdsPresetPath, NDS_PRESET_EXTENSION, readNdsPreset, writeNdsPreset } from './nds-preset.js?v=nds-2sf-audition-1';
import { saveTwoSfSong } from './2sf-project.js';

const INDEX = '/index.js';
const INITIAL_ID = 'tetorica-nitro-ds';
const basename = (path) => path.split('/').at(-1);
const dirname = (path) => path.slice(0, path.lastIndexOf('/')) || '/';
const inside = (path, directory) => path === directory || Boolean(path?.startsWith(directory + '/'));
const childOf = (directory, name) => `${directory === '/' ? '' : directory}/${name}`;
const makeIdentity = () => globalThis.crypto?.randomUUID?.() ?? `nds-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const CASSETTE_BYTES = 16 * 1024 * 1024;
const utf8 = new TextEncoder();
function pathType(fs, path) {
	if (!path) return null;
	if (fs.has(path)) return 'file';
	return fs.listDirectories().includes(path) ? 'directory' : null;
}

function presetPath(project, name) {
	const display = name.normalize('NFC').trim();
	const base = (isNdsPresetPath(display) ? display.slice(0, -NDS_PRESET_EXTENSION.length) : display)
		.replace(/[<>:"/\\|?*]/g, '_').replace(/^\.+|[. ]+$/g, '');
	let stem = '', bytes = 0;
	for (const character of base) {
		bytes += utf8.encode(character).length;
		if (bytes > 160) break;
		stem += character;
	}
	stem = stem.replace(/[. ]+$/g, '');
	if (!stem) stem = 'DS sound';
	if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(stem.split('.')[0].trimEnd())) stem = `_${stem}`;
	const fold = path => path.normalize('NFC').toLowerCase();
	const occupied = new Set([project.fs, project.savedFs].flatMap(fs => [
		...fs.list().map(file => file.path), ...fs.listDirectories(),
	]).map(fold));
	let count = 1, path = `/presets/${stem}${NDS_PRESET_EXTENSION}`;
	while (occupied.has(fold(path))) path = `/presets/${stem} (${++count})${NDS_PRESET_EXTENSION}`;
	return path;
}

export function setupNdsFiles({ project, setStatus = () => {}, onBeforeWorkspaceReplace = async () => {},
	onSelectPreset, onSelectReference, store = createNdsProjectStore(), document: doc = globalThis.document } = {}) {
	const win = doc.defaultView;
	const byId = (id) => doc.getElementById(id);
	const panel = byId('ndsFilesPanel'), toggle = byId('ndsFilesToggle'), workspace = byId('synthWorkspace');
	const menuNew = byId('ndsNewCassette'), menuImport = byId('ndsImportCassette'), menuExport = byId('ndsExportCassette');
	const make = (tag, id, text) => {
		const node = doc.createElement(tag);
		if (id) node.id = id;
		if (text) node.textContent = text;
		return node;
	};
	function button(id, text) {
		const node = make('button', id, text); node.type = 'button'; return node;
	}
	function fileInput(id) {
		const node = make('input', id); node.type = 'file'; node.hidden = true; return node;
	}
	const heading = make('div'), tools = make('div'), actions = make('div');
	heading.className = 'nds-files-heading';
	tools.className = actions.className = 'nds-files-toolbar';
	const newJs = button('ndsNewJs', '+JS'), addFiles = button('ndsAddFiles', 'Add files…');
	const save = button('ndsSaveFile', 'Save'), saveAll = button('ndsSaveAll', 'Save all');
	const discard = button('ndsDiscardFile', 'Discard'), discardAll = button('ndsDiscardAll', 'Discard all');
	const automatic = make('input', 'ndsAutoApply'), automaticLabel = make('label');
	automatic.type = 'checkbox'; automaticLabel.append(automatic, ' Auto apply');
	const tree = make('div', 'ndsFilesTree'), status = make('p', 'ndsFilesStatus');
	status.setAttribute('role', 'status'); status.className = 'nds-files-status';
	const input = fileInput('ndsFileInput'), cassetteInput = fileInput('ndsCassetteInput');
	input.multiple = true; cassetteInput.accept = '.zip,application/zip';
	heading.append(make('h2', '', 'Files'), tools);
	tools.append(newJs, addFiles);
	actions.append(save, saveAll, discard, discardAll, automaticLabel);
	panel.append(heading, actions, tree, status, input, cassetteInput);

	const nameDialog = make('dialog', 'ndsFileNameDialog'), nameForm = make('form');
	const nameTitle = make('h2', 'ndsFileNameTitle'), name = make('input', 'ndsFileName');
	const nameCancel = button('ndsFileNameCancel', 'Cancel'), nameConfirm = button('ndsFileNameConfirm', 'Create');
	const nameError = make('p', 'ndsFileNameError'); nameError.setAttribute('role', 'alert');
	name.setAttribute('aria-label', 'Project path'); name.required = true; name.autocomplete = 'off';
	nameConfirm.type = 'submit'; nameForm.append(nameTitle, name, nameError, nameCancel, nameConfirm);
	nameDialog.append(nameForm); nameDialog.setAttribute('aria-labelledby', nameTitle.id);
	const resetDialog = make('dialog', 'ndsNewCassetteDialog');
	const resetTitle = make('h2', 'ndsNewCassetteTitle', 'Create a new Cassette?');
	const resetCancel = button('ndsNewCassetteCancel', 'Cancel');
	const resetExport = button('ndsNewCassetteExport', 'Export current & create');
	const resetCreate = button('ndsNewCassetteCreate', 'Create without export');
	resetDialog.setAttribute('aria-labelledby', resetTitle.id);
	resetDialog.append(resetTitle, make('p', '', 'The new project starts with index.js and examples. Export the current project to keep your edits.'),
		resetCancel, resetExport, resetCreate);
	nameDialog.className = resetDialog.className = 'nds-file-dialog';
	doc.body.append(nameDialog, resetDialog);

	let selected = INDEX, codeState = { mode: 'keyboard', path: INDEX }, code = null;
	let identity = INITIAL_ID, busy = true, disposed = false, restoring = false, saveTimer = 0;
	let visibleTouched = false, structure = null, namedAction = null, selectionRevision = 0;
	const expanded = new Map([['/examples', true]]), listeners = [];
	const listen = (node, type, fn, options) => {
		node.addEventListener(type, fn, options);
		listeners.push(() => node.removeEventListener(type, fn, options));
	};
	const say = (message) => { if (!disposed) { status.textContent = message; setStatus(message); } };
	const report = (error) => { if (error?.name !== 'AbortError') say(`Files: ${error.message}`); };
	const hasPath = (path) => Boolean(pathType(project.fs, path) || pathType(project.savedFs, path));
	const editable = (path) => Boolean(path && isNdsTextPath(path) && project.fs.get(path)?.type === 'text');
	function reveal(path) {
		for (let parent = dirname(path); parent !== '/'; parent = dirname(parent)) expanded.set(parent, true);
	}
	function setVisible(visible, persist = true) {
		if (persist) visibleTouched = true;
		panel.hidden = !visible;
		workspace.classList.toggle('has-files', Boolean(visible));
		toggle.setAttribute('aria-expanded', String(Boolean(visible)));
		code?.layoutEditor();
		if (persist) schedule();
	}
	function selection(path) {
		selected = path;
		if (path) reveal(path);
		render(); schedule();
		return ++selectionRevision;
	}
	function render() {
		if (disposed) return;
		if (!hasPath(selected)) selected = hasPath(code?.activePath) ? code.activePath : '/';
		const directories = new Set(project.fs.listDirectories());
		const entries = new Map();
		for (const parent of directories) {
			if (parent !== '/') entries.set(parent, { path: parent, type: 'directory' });
			for (const name of project.fs.readdir(parent)) {
				const path = childOf(parent, name);
				if (!directories.has(path)) entries.set(path, { path, type: 'file' });
			}
		}
		const working = new Set(entries.keys());
		const changes = project.workspace.getDirtyPaths(), dirty = new Set(changes);
		for (const path of changes) {
			for (let parent = dirname(path); parent !== '/'; parent = dirname(parent)) dirty.add(parent);
			if (path !== '/' && !entries.has(path)) {
				const type = pathType(project.savedFs, path);
				if (type) entries.set(path, { path, type });
			}
		}
		const signature = JSON.stringify([...entries.values()]);
		if (signature !== structure) {
			structure = signature;
			renderFileTree(tree, [...entries.values()], { selectedPath: selected, expanded,
				onOpen: (path) => void selectFile(path).catch(report),
				onTransfer: (source, destination, copy) => void transfer(source, destination, copy).catch(report),
				onImport: (files, directory) => void importFiles(files, directory || '/').catch(report),
			});
		}
		for (const row of tree.querySelectorAll('[data-file-path]')) {
			const path = row.dataset.filePath, changed = path !== '/' && dirty.has(path);
			row.setAttribute('aria-current', String(path === selected));
			row.dataset.unsaved = String(changed);
			row.dataset.deleted = String(path !== '/' && !working.has(path));
			let mark = row.querySelector('.nds-file-unsaved');
			if (changed && !mark) {
				mark = make('span', '', ' ●'); mark.className = 'nds-file-unsaved';
				mark.setAttribute('aria-label', 'Unsaved changes'); row.append(mark);
			} else if (!changed) mark?.remove();
			if (row.localName === 'summary' && expanded.has(path)) row.parentElement.open = expanded.get(path);
			if (row.localName === 'button') row.disabled = busy;
		}
		const changed = selected !== '/' && dirty.has(selected);
		const anyChanges = changes.length > 0;
		save.disabled = discard.disabled = busy || !changed;
		saveAll.disabled = discardAll.disabled = busy || !anyChanges;
		automatic.checked = project.autoApply;
		for (const control of [newJs, addFiles, automatic, menuNew, menuImport, menuExport, resetCreate, resetExport, resetCancel, nameConfirm, nameCancel])
			control.disabled = busy;
		panel.setAttribute('aria-busy', String(busy));
		code?.setBusy(busy);
	}
	function setBusy(value) { busy = value; render(); }
	function schedule() {
		if (disposed || restoring) return;
		clearTimeout(saveTimer);
		saveTimer = setTimeout(() => void persistCode(), 140);
	}
	async function persistCode() {
		if (disposed || restoring) return false;
		clearTimeout(saveTimer);
		try {
			return await store.write({ project: project.snapshot(), workspaceId: identity, codeState,
				filesVisible: !panel.hidden, selected });
		} catch (error) {
			report(new Error(`Could not save the local project. Export Cassette to keep it. ${error.message}`));
			return false;
		}
	}
	const commitFiles = () => code ? code.flush() : persistCode();
	async function selectFile(path, { showSource = true } = {}) {
		await ready;
		if (disposed || busy || !hasPath(path)) return false;
		const revision = selection(path);
		const showText = showSource && editable(path);
		if (isNdsPresetPath(path) && onSelectPreset) {
			if (showText && code) await code.openFile(path, { show: code.isCodeMode() });
			if (disposed || busy || revision !== selectionRevision) return false;
			const source = project.savedFs.get(path);
			if (!source) {
				say('Save this sound file to make it available for playing.');
				return false;
			}
			if (source.type !== 'text') throw new TypeError('DS sound presets must be JSON text.');
			const sound = readNdsPreset(source.data);
			if ((await onSelectPreset(sound, path)) === false || disposed || revision !== selectionRevision) return false;
			say(`Sound loaded · ${sound.name}.`);
			return true;
		}
		if (showText) return code?.openFile(path, { show: code.isCodeMode() });
		if (onSelectReference?.(path)) {
			say(`Song selected · ${basename(path)}.`);
			return true;
		}
		if (project.fs.has(path)) say(`${basename(path)} · ${project.fs.stat(path).size.toLocaleString()} bytes`);
		return true;
	}
	async function operation(run, { persistBefore = false } = {}) {
		await ready;
		if (disposed || busy) return false;
		setBusy(true);
		try {
			await code?.flush({ persist: persistBefore });
			if (disposed) return false;
			return await run();
		} finally { if (!disposed) setBusy(false); }
	}
	async function savePreset(name, sound) {
		const source = writeNdsPreset(name, sound);
		return operation(async () => {
			const path = presetPath(project, name);
			project.importFiles([{ path, type: 'text', data: source }], { save: true });
			selection(path);
			if (await commitFiles()) say(`Sound saved · ${basename(path)}.`);
			return path;
		});
	}

	async function saveReferenceSong(path, files) {
		return operation(async () => {
			const saved = await saveTwoSfSong(project, path, files, { isCurrent: () => !disposed });
			if (await commitFiles()) say(`Saved song to Files · ${basename(saved.path)}.`);
			return saved;
		});
	}

	async function applyChanges({ all = false, reverting = false, target = selected } = {}) {
		return operation(async () => {
			const path = all ? '/' : target;
			if (!project.workspace.isDirty(path)) return false;
			if (reverting) {
				project.discardFiles([path]);
				if (inside(code?.activePath, path) || all) code?.reloadFile();
			} else project.saveFiles([path]);
			render();
			if (await commitFiles()) say(reverting ? 'Changes discarded.' : 'Files saved.');
			return true;
		});
	}
	function chooseDirectory(path) {
		return pathType(project.fs, path) === 'directory' ? path : dirname(path);
	}
	async function importFiles(files, directory = '/') {
		if (!files.length) return false;
		return operation(async () => {
			let total = 0;
			const plan = files.map(file => {
				total += file.size;
				if (total > NDS_PROJECT_FILE_BYTES) throw new Error('The imported files exceed the project size limit.');
				return { file, path: ndsProjectPath(childOf(directory, file.name)) };
			});
			const entries = [];
			for (const { file, path } of plan) entries.push({ path, data: new Uint8Array(await file.arrayBuffer()) });
			if (disposed) return false;
			project.importFiles(entries);
			if (entries.some(entry => entry.path === code?.activePath)) code.reloadFile();
			selection(entries[0].path);
			if (await commitFiles()) say(`Added ${entries.length} ${entries.length === 1 ? 'file' : 'files'}.`);
			return true;
		});
	}
	async function transfer(source, destination, copy) {
		return operation(async () => {
			const next = ndsProjectPath(destination);
			if (source === next && !copy) return false;
			project.transfer(source, next, { copy });
			if (!copy) code?.pathChanged(source, next, { preserveExecution: true });
			selection(next); await commitFiles();
			return true;
		}, { persistBefore: !copy });
	}
	function duplicate(path) {
		const display = basename(path);
		const extension = pathType(project.fs, path) !== 'file' ? '' :
			isNdsPresetPath(path) ? display.slice(-NDS_PRESET_EXTENSION.length) : display.match(/\.[^.]+$/)?.[0] ?? '';
		const stem = extension ? display.slice(0, -extension.length) : display;
		const occupied = new Set([...project.fs.list().map(file => file.path), ...project.fs.listDirectories()].map(path => path.toLowerCase()));
		let counter = 0, next;
		do {
			counter++;
			next = childOf(dirname(path), `${stem}-copy${counter === 1 ? '' : `-${counter}`}${extension}`);
		} while (occupied.has(next.toLowerCase()));
		return transfer(path, next, true);
	}
	function ask(action, path = selected) {
		if (busy || disposed) return;
		namedAction = { action, path };
		nameTitle.textContent = { new: 'New JavaScript file', folder: 'New folder', rename: 'New project path', delete: 'Delete this project path?' }[action];
		name.value = action === 'new' ? childOf(chooseDirectory(path), 'untitled.js') :
			action === 'folder' ? childOf(chooseDirectory(path), 'New folder') : path;
		name.readOnly = action === 'delete';
		nameConfirm.textContent = { new: 'Create', folder: 'Create', rename: 'Rename', delete: 'Delete' }[action];
		nameError.textContent = '';
		nameDialog.showModal(); name.focus(); name.select();
	}
	async function changePath(action, path, value) {
		if (action === 'rename') return transfer(path, value, false);
		let openAfter = null;
		const result = await operation(async () => {
			if (action === 'delete') {
				project.remove(path);
				// Reload clears the shared editor's journal if its file is now gone.
				if (inside(code?.activePath, path)) code.reloadFile();
				selection(pathType(project.savedFs, path) ? path : dirname(path));
			} else {
				const next = ndsProjectPath(value);
				if (pathType(project.fs, next)) throw new Error('That project path already exists.');
				if (action === 'new') {
					if (!isNdsCodePath(next)) throw new Error('Use a .js or .mjs extension.');
					project.writeEditorText(next, '// Write your DS performance here.\n');
					openAfter = next;
				} else project.makeDirectory(next);
				selection(next);
			}
			await commitFiles();
			return true;
		}, { persistBefore: action === 'delete' });
		if (result && openAfter && !disposed) {
			if (nameDialog.open) nameDialog.close();
			await selectFile(openAfter);
		}
		return result;
	}

	function download(bytes) {
		const url = win.URL.createObjectURL(new Blob([bytes], { type: 'application/zip' }));
		const link = make('a'); link.href = url; link.download = 'nitro-ds.cassette.zip'; link.click();
		setTimeout(() => win.URL.revokeObjectURL(url), 1000);
	}
	async function exportCassette() {
		return operation(async () => {
			download(await project.exportCassette());
			say('Cassette exported.');
			return true;
		});
	}
	async function replaceWorkspace(next, { backup = false } = {}) {
		return operation(async () => {
			if (next?.size > CASSETTE_BYTES) throw new Error('Cassette is larger than the 16 MiB limit.');
			const current = () => !disposed;
			const candidate = next ? await project.prepareImport(await next.arrayBuffer(), { isCurrent: current }) : null;
			if (disposed) return false;
			if (backup) download(await project.exportCassette());
			if (!current()) return false;
			const previous = project.snapshot(), previousState = codeState, previousId = identity, previousPath = selected;
			selectionRevision++;
			if ((await code?.workspaceReplaced()) === false || !current()) return false;
			restoring = true;
			try {
				if ((await onBeforeWorkspaceReplace({ isCurrent: current })) === false || !current()) {
					if (current()) await code?.restoreState(previousState);
					return false;
				}
				if (candidate) project.restore(candidate);
				else project.reset();
				identity = makeIdentity();
				selected = editable(INDEX) ? INDEX : project.fs.list().find(({ path }) => editable(path))?.path ?? '/';
				codeState = { mode: 'keyboard', path: editable(selected) ? selected : null };
				if (editable(selected)) await code?.restoreState(codeState);
			} catch (error) {
				project.restore(previous); identity = previousId; codeState = previousState; selected = previousPath;
				await code?.restoreState(codeState);
				throw error;
			} finally { restoring = false; }
			if (resetDialog.open) resetDialog.close();
			setVisible(true, false);
			if (await commitFiles()) say(candidate ? 'Cassette imported.' : 'New Cassette created.');
			return true;
		});
	}

	const contextMenu = installSpuFileContextMenu({ root: tree, document: doc, isBusy: () => busy || disposed,
		onError: report, onTarget: selection,
		getActions: (path) => [
			['duplicate', 'Duplicate'], ['rename', 'Rename…'], ['delete', 'Delete…'],
			['new', 'New JavaScript file…'], ['folder', 'New folder…'],
		].map(([id, label]) => ({ id, label, disabled: ['duplicate', 'rename', 'delete'].includes(id) &&
			(path === '/' || !pathType(project.fs, path)) })),
		onAction: (action, path) => action === 'duplicate' ? duplicate(path) : ask(action, path),
	});
	contextMenu.element.classList.add('nds-file-context-menu');
	const closeMenu = () => { byId('menu').parentElement.open = false; };
	listen(toggle, 'click', () => setVisible(panel.hidden));
	listen(tree, 'click', (event) => {
		const row = event.target.closest('summary[data-file-path],.file-tree-root');
		if (!row || busy) return;
		if (row.localName === 'summary') expanded.set(row.dataset.filePath, !row.parentElement.open);
		event.preventDefault(); selection(row.dataset.filePath);
	});
	listen(panel, 'keydown', (event) => {
		if (event.target?.closest?.('textarea,select,[contenteditable],input:not([type=checkbox])') ||
			['Enter', ' '].includes(event.key) && event.target?.closest?.('button, summary, input')) event.stopPropagation();
	});
	listen(newJs, 'click', () => ask('new'));
	listen(addFiles, 'click', () => input.click());
	listen(input, 'change', () => {
		const files = [...input.files]; input.value = '';
		void importFiles(files, chooseDirectory(selected)).catch(report);
	});
	listen(automatic, 'change', () => {
		const value = automatic.checked; automatic.blur();
		void operation(async () => { project.setAutoApply(value); await commitFiles(); }).catch(report);
	});
	for (const [control, options] of [[save, {}], [saveAll, { all: true }], [discard, { reverting: true }],
		[discardAll, { all: true, reverting: true }]])
		listen(control, 'click', () => void applyChanges(options).catch(report));
	listen(win, 'keydown', (event) => {
		if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || event.key.toLowerCase() !== 's' ||
			nameDialog.open || resetDialog.open) return;
		event.preventDefault(); event.stopPropagation();
		const target = event.target?.closest?.('#synthCodePanel,.monaco-editor') ? code?.activePath ?? selected : selected;
		if (!busy) void applyChanges({ target }).catch(report);
	}, true);
	listen(nameCancel, 'click', () => nameDialog.close());
	listen(nameDialog, 'cancel', (event) => { if (busy) event.preventDefault(); });
	listen(nameForm, 'submit', (event) => {
		event.preventDefault();
		if (!namedAction || busy) return;
		const { action, path } = namedAction;
		void changePath(action, path, name.value).then(done => { if (done && nameDialog.open) nameDialog.close(); })
			.catch(error => { nameError.textContent = error.message; });
	});
	listen(menuNew, 'click', () => { closeMenu(); if (!busy) resetDialog.showModal(); });
	listen(menuImport, 'click', () => { closeMenu(); cassetteInput.click(); });
	listen(menuExport, 'click', () => { closeMenu(); void exportCassette().catch(report); });
	listen(cassetteInput, 'change', () => {
		const file = cassetteInput.files[0]; cassetteInput.value = '';
		if (file) void replaceWorkspace(file).catch(report);
	});
	listen(resetCancel, 'click', () => { if (!busy) resetDialog.close(); });
	listen(resetDialog, 'cancel', (event) => { if (busy) event.preventDefault(); });
	listen(resetCreate, 'click', () => void replaceWorkspace().catch(error => { resetDialog.close(); report(error); }));
	listen(resetExport, 'click', () => void replaceWorkspace(null, { backup: true }).catch(error => { resetDialog.close(); report(error); }));

	const unwatch = project.onDidChange(() => { render(); schedule(); });
	const ready = (async () => {
		restoring = true;
		try {
			const saved = await store.read();
			if (disposed || !saved) return;
			project.restore(saved.project);
			if (typeof saved.workspaceId === 'string') identity = saved.workspaceId;
			selected = typeof saved.selected === 'string' && hasPath(saved.selected) ? saved.selected : INDEX;
			if (editable(saved.codeState?.path)) codeState = { mode: saved.codeState.mode === 'code' ? 'code' : 'keyboard', path: saved.codeState.path };
			else codeState = { mode: 'keyboard', path: editable(INDEX) ? INDEX : null };
			reveal(selected);
			if (!visibleTouched) setVisible(Boolean(saved.filesVisible), false);
		} catch (error) { report(error); }
		finally { restoring = false; if (!disposed) setBusy(false); }
	})();
	render();
	return {
		ready, get workspaceId() { return identity; },
		getCodeState: () => ({ ...codeState }),
		setCodeControls(controls) { code = controls; code.setBusy(busy); },
		rememberCodeState(state) { codeState = { ...state }; schedule(); },
		codeEdited(path) { if (selected === path) render(); },
		recoverCodeState() { schedule(); }, persistCode, selectFile, savePreset, saveReferenceSong, setVisible,
		async dispose() {
			if (disposed) return;
			const saved = persistCode(); disposed = true;
			clearTimeout(saveTimer); unwatch(); contextMenu.dispose();
			for (const remove of listeners) remove();
			nameDialog.remove(); resetDialog.remove();
			await saved; await store.close();
		},
	};
}

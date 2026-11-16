// Compact YM2149 ST Files adapter for the shared Synth Code editor.
import { renderFileTree } from '../playground/playground_file_tree.js';
import { transferVirtualFiles, isCheckpointPath } from '../js/tetorica_virtual_files/filesystem.js';
import { normalizeVirtualPath } from '../js/tetorica_virtual_files/path.js';
import { installSpuFileContextMenu as installYmFileContextMenu } from '../synth-spu/file_context_menu.js?v=spu-files-menu-1';
import {ymMusicEntries} from './music_files.js';
import { addYmCodeExamples } from './code_examples.js';
import { createDefaultPreset } from './preset.js';
import {
	createYmCodeProject,
	createYmProjectStore,
	readYmProjectSound,
	isYmCodePath,
	isYmTextPath,
	YM_PROJECT_MANIFEST,
	YM_PROJECT_CODE_LENGTH,
} from './code_project.js?v=draft-reconnect-1';

const inside = (path, directory) => path === directory || path?.startsWith(directory + '/');
const basename = (path) => path.split('/').pop(),
	dirname = (path) => path.slice(0, path.lastIndexOf('/')) || '/';
const workspaceId = () =>
	globalThis.crypto?.randomUUID?.() ??
	`ym-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const encoder = new TextEncoder();
function soundFileStem(value, extension = /\.ym2149-st\.json$/i) {
	const cleaned = value
		.normalize('NFC')
		.replace(/[\u0000-\u001f\u007f<>:"/\\|?*\ud800-\udfff]/gu, '_')
		.trim()
		.replace(extension, '')
		.replace(/^\.+|[. ]+$/g, '');
	// Leave room for the extension and collision suffix on exported filesystems.
	let stem = '',
		bytes = 0;
	for (const character of cleaned) {
		const length = encoder.encode(character).length;
		if (bytes + length > 160) break;
		stem += character;
		bytes += length;
	}
	stem = stem.replace(/[. ]+$/g, '') || 'Untitled';
	return /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(stem.split('.')[0].trimEnd())
		? '_' + stem
		: stem;
}
function newSoundPath(project, name, occupiedPaths) {
	const stem = soundFileStem(name),
		fold = (path) => path.normalize('NFC').toLowerCase();
	const occupied =
		occupiedPaths ??
		new Set(
			[...project.fs.list().map((file) => file.path), ...project.fs.listDirectories()].map(
				fold,
			),
		);
	let index = 1,
		path = '/presets/' + stem + '.ym2149-st.json';
	while (occupied.has(fold(path))) path = `/presets/${stem} (${++index}).ym2149-st.json`;
	return path;
}
const foldedPath = (path) => path.normalize('NFC').toLowerCase();
const occupied = (project, path) =>
	[...project.fs.list().map((file) => file.path), ...project.fs.listDirectories()].some(
		(item) => foldedPath(item) === foldedPath(path),
	);
function copyPath(project, path) {
	const name = basename(path),
		directory = dirname(path),
		folder = project.fs.stat(path).type === 'directory';
	const extension = folder
		? ''
		: (name.match(/\.ym2149-st\.json$/i)?.[0] ?? name.match(/\.[^./]+$/)?.[0] ?? '');
	const stem = extension ? name.slice(0, -extension.length) : name;
	let index = 1,
		result;
	do {
		result = `${directory === '/' ? '' : directory}/${stem}-copy${index === 1 ? '' : `-${index}`}${extension}`;
		index++;
	} while (occupied(project, result));
	return result;
}
export function setupYmCodeFiles({
	project = createYmCodeProject(),
	getSettings = () => project.settings,
	getStarterCode = () => '',
	applySettings = async () => {},
	onBeforeWorkspaceReplace = async () => {},
	onBeforeNewProject = async () => {},
	onBeforeSoundApply = async () => {},
	setStatus = () => {},
	store = createYmProjectStore(),
	document: doc = globalThis.document,
	// Optional download sink for hosts and tests; defaults to a browser download.
	downloadFile,
} = {}) {
	const panel = doc.getElementById('ymFilesPanel'),
		toggle = doc.getElementById('ymFilesToggle'),
		workspace = doc.getElementById('synthWorkspace');
	const presetSelect = doc.getElementById('ymPresetSelect'),
		presetCache = new Map();
	let presetSignature = '',
		appliedPreset = null,
		presetOptions = new Map();
	if (!panel || !toggle || !workspace) throw Error('YM2149 ST Files mount is missing.');
	const win = doc.defaultView ?? globalThis,
		main = doc.getElementById('ymSynthMain'),
		listeners = [],
		expanded = new Map([
			['/presets', true],
			['/examples', true],
			['/lib', true],
			['/data', true],
		]);
	let code = null,
		busy = true,
		disposed = false,
		restoring = false,
		persistenceReady = false,
		operation = 0,
		editRevision = 0,
		saveTimer = null,
		identity = workspaceId(),
		visibilityTouched = false,
		pendingNewProject = null;
	const make = (tag, id, text) => {
		const node = doc.createElement(tag);
		if (id) node.id = id;
		if (text !== undefined) node.textContent = text;
		return node;
	};
	const listen = (node, type, fn, options) => {
		node?.addEventListener(type, fn, options);
		listeners.push(() => node?.removeEventListener(type, fn, options));
	};
	const heading = make('div');
	heading.className = 'ym-files-heading';
	const title = make('h2', null, 'FILES');
	const toolbar = make('div');
	toolbar.className = 'ym-files-toolbar';
	toolbar.setAttribute('role', 'group');
	toolbar.setAttribute('aria-label', 'Create project files');
	heading.append(title, toolbar);
	const actions = make('div');
	actions.className = 'ym-files-actions';
	actions.setAttribute('role', 'group');
	actions.setAttribute('aria-label', 'Selected file actions');
	const buttons = new Map();
	for (const [id, label] of [
		['ymFileNewButton', 'New JS'],
		['ymFileSaveSoundButton', 'Save sound'],
		['ymProjectNewButton', 'New Project…'],
		['ymFileRenameButton', 'Rename…'],
		['ymFileDeleteButton', 'Delete…'],
		['ymFileImportButton', 'Add files…'],
		['ymFileExportButton', 'Export file'],
		['ymProjectExportButton', 'Export project'],
		['ymProjectImportButton', 'Import project…'],
	]) {
		const button = make('button', id, label);
		button.type = 'button';
		(['ymFileNewButton', 'ymFileSaveSoundButton'].includes(id)
			? toolbar
			: actions
		).append(button);
		buttons.set(id, button);
		if (id === 'ymFileNewButton')
			button.title = 'New JavaScript file; end the path with / to create a folder';
		const destination = {
			ymProjectNewButton: ['ymMenuProjectNew', 'New Project…'],
			ymProjectImportButton: ['ymMenuProjectImport', 'Project · ZIP…'],
			ymProjectExportButton: ['ymMenuProjectExport', 'Project · ZIP'],
			ymFileImportButton: ['ymMenuFilesImport', 'Project files…'],
			ymFileExportButton: ['ymMenuFileExport', 'Selected file'],
		}[id];
		const mount = destination && doc.getElementById(destination[0]);
		if (mount) {
			button.textContent = destination[1];
			button.setAttribute('data-close-synth-menu', '');
			mount.append(button);
		}
		listen(button, 'pointerdown', (event) => {
			if (event.button === 0) {
				event.preventDefault();
				if (id !== 'ymFileSaveSoundButton' || !code?.isCodeMode?.())
					doc.activeElement?.blur?.();
			}
		});
	}
	const selected = make('p', 'ymFilesSelected', '');
	selected.className = 'ym-files-path ym-sr-only';
	selected.setAttribute('role', 'status');
	const tree = make('div', 'ymFilesTree');
	tree.setAttribute('aria-label', 'YM2149 ST project files');
	const info = make(
		'p',
		'ymFilesStatus',
		'Code and text edits save locally. Importing a project never runs it.',
	);
	info.className = 'ym-files-status';
	info.setAttribute('role', 'status');
	const fileInput = make('input', 'ymFilesInput');
	fileInput.type = 'file';
	fileInput.multiple = true;
	fileInput.hidden = true;
	const projectInput = make('input', 'ymProjectFileInput');
	projectInput.type = 'file';
	projectInput.accept = '.zip,application/zip';
	projectInput.hidden = true;
	const dialog = make('dialog', 'ymFileNameDialog'),
		form = make('form'),
		label = make('label', 'ymFileNameLabel', 'File path'),
		nameInput = make('input', 'ymFileNameInput');
	label.htmlFor = nameInput.id;
	const confirm = make('button', 'ymFileNameConfirm', 'Create'),
		cancel = make('button', 'ymFileNameCancel', 'Cancel');
	confirm.type = 'submit';
	cancel.type = 'button';
	form.append(label, nameInput, confirm, cancel);
	dialog.append(form);
	panel.append(heading, tree, actions, selected, info, fileInput, projectInput, dialog);
	const newProjectDialog = make('dialog', 'ymNewProjectDialog'),
		newProjectTitle = make('h2', 'ymNewProjectTitle', 'Create a new project?'),
		newProjectDescription = make(
			'p',
			null,
			'This replaces the current browser project and stops the current performance. The new project contains the starter code and examples with the default sound.',
		),
		newProjectActions = make('div'),
		newProjectCancel = make('button', 'ymNewProjectCancel', 'Cancel'),
		newProjectExport = make('button', 'ymNewProjectExport', 'Export current & create'),
		newProjectCreate = make('button', 'ymNewProjectCreate', 'Create without export');
	newProjectDialog.className = 'ym-new-project-dialog';
	newProjectDialog.setAttribute('role', 'dialog');
	newProjectDialog.setAttribute('aria-labelledby', newProjectTitle.id);
	newProjectActions.className = 'ym-new-project-actions';
	for (const button of [newProjectCancel, newProjectExport, newProjectCreate]) button.type = 'button';
	newProjectActions.append(newProjectCancel, newProjectExport, newProjectCreate);
	newProjectDialog.append(newProjectTitle, newProjectDescription, newProjectActions);
	doc.body.append(newProjectDialog);
	let dialogAction = null,
		dialogPath = null;
	const say = (message) => {
		if (!disposed) {
			info.textContent = message;
			setStatus(message);
		}
	};
	const report = (error) => {
		if (error?.name !== 'AbortError') say(`Files: ${error?.message ?? error}`);
	};
	const allowed = (path) => {
		path = normalizeVirtualPath(path);
		if (path === '/' || path === YM_PROJECT_MANIFEST || isCheckpointPath(path))
			throw Error('That path is reserved.');
		return path;
	};
	function renderPresets(files) {
		if (!presetSelect) {
			const paths = new Set(files.map((file) => file.path));
			for (const path of presetCache.keys()) if (!paths.has(path)) presetCache.delete(path);
			return;
		}
		const present = new Set(),
			entries = [];
		for (const file of files) {
			if (!file.path.startsWith('/presets/')) continue;
			if (file.type !== 'text' || !/\.json$/i.test(file.path)) continue;
			present.add(file.path);
			let saved = presetCache.get(file.path);
			if (saved?.kind !== 'json' || saved.data !== file.data) {
				let name = null;
				try {
					name = readYmProjectSound(file.data)?.name ?? null;
				} catch {}
				saved = { kind: 'json', data: file.data, name };
				presetCache.set(file.path, saved);
			}
			if (saved.name !== null)
				entries.push({
					kind: 'json',
					path: file.path,
					value: file.path,
					label: `${saved.name} · ${file.path}`,
				});
		}
		for (const path of presetCache.keys()) if (!present.has(path)) presetCache.delete(path);
		entries.sort((a, b) => a.path.localeCompare(b.path));
		presetOptions = new Map(entries.map((entry) => [entry.value, entry]));
		const signature = JSON.stringify(entries);
		if (signature !== presetSignature) {
			presetSignature = signature;
			const placeholder = make(
				'option',
				null,
				entries.length ? 'Load preset…' : 'No playable presets',
			);
			placeholder.value = '';
			placeholder.disabled = true;
			const options = entries.map((entry) => {
				const option = make('option', null, entry.label);
				option.value = entry.value;
				option.title = entry.path;
				return option;
			});
			presetSelect.replaceChildren(placeholder, ...options);
		}
		const applied =
			appliedPreset &&
			entries.find(
				(entry) =>
					entry.path === appliedPreset.path &&
					presetCache.get(entry.path)?.data === appliedPreset.data,
			);
		if (applied) appliedPreset.data = presetCache.get(applied.path).data;
		else appliedPreset = null;
		presetSelect.value = applied?.value ?? '';
		presetSelect.disabled = busy || !entries.length;
	}
	function render() {
		if (disposed) return;
		const selectedPath = project.selectedPath ?? '';
		if (selected.textContent !== selectedPath) selected.textContent = selectedPath;
		panel.setAttribute('aria-busy', String(busy));
		const files = project.fs.list().filter((file) => !isCheckpointPath(file.path));
		renderPresets(files);
		renderFileTree(
			tree,
			[
				...files,
				...project.fs
					.listDirectories()
					.filter((path) => path !== '/' && !isCheckpointPath(path))
					.map((path) => ({ path, type: 'directory' })),
			],
			{
				selectedPath: project.selectedPath,
				expanded,
				onOpen: (path) => void selectFile(path).catch(report),
				onImport: (files) => void importFiles(files).catch(report),
				onTransfer: (source, destination, copy) =>
					void move(source, destination, copy).catch(report),
			},
		);
		for (const [id, button] of buttons)
			button.disabled =
				busy ||
				([
					'ymFileExportButton',
					'ymFileRenameButton',
					'ymFileDeleteButton',
				].includes(id) &&
					!project.selectedPath);
		code?.setBusy?.(busy);
		newProjectExport.disabled = busy;
		newProjectCreate.disabled = busy;
		for (const button of tree.querySelectorAll('button')) button.disabled = busy;
	}
	function setBusy(value, { lockMain = true } = {}) {
		busy = value;
		if (main) main.inert = Boolean(value && lockMain);
		render();
	}
	async function persistCode() {
		if (disposed || !persistenceReady) return false;
		if (!busy && !restoring) project.setSettings(getSettings());
		try {
			return await store.write({
				...project.snapshot(),
				workspaceId: identity,
				filesVisible: !panel.hidden,
			});
		} catch (error) {
			report(
				Error(`Local save failed: ${error.message}. Export project to keep your files.`),
			);
			return false;
		}
	}
	function schedule() {
		if (disposed || restoring) return;
		clearTimeout(saveTimer);
		saveTimer = setTimeout(() => void persistCode(), 120);
	}
	function setVisible(value) {
		visibilityTouched = true;
		panel.hidden = !value;
		workspace.classList.toggle('has-files', Boolean(value));
		toggle.setAttribute('aria-expanded', String(Boolean(value)));
	}
	const executionPath = () =>
		code?.executionPath ?? (isYmCodePath(code?.activePath) ? code.activePath : null);
	const openInCurrentMode = (path) =>
		code?.openFile?.(path, { show: Boolean(code?.isCodeMode?.()) });
	function reveal(path) {
		for (let directory = dirname(path); directory !== '/'; directory = dirname(directory))
			expanded.set(directory, true);
	}
	async function selectFile(path) {
		if (!disposed && !busy) code?.cancelPendingExecution?.();
		await api.ready;
		if (disposed || busy) return false;
		const token = ++operation;
		await code?.flush?.();
		if (disposed || token !== operation) return false;
		path = normalizeVirtualPath(path);
		const file = project.fs.get(path);
		if (!file) throw Error('Choose a file.');
		if (isYmCodePath(path)) {
			project.select(path);
			render();
			return await openInCurrentMode(path);
		}
		let sound = null,
			soundError = null;
		if (file.type === 'text' && /\.json$/i.test(path)) {
			try {
				sound = readYmProjectSound(file.data);
			} catch (error) {
				soundError = error;
			}
		}
		if (sound) {
			setBusy(true);
			try {
				await onBeforeSoundApply();
				if (disposed || token !== operation) return false;
				const applied = await applySettings(sound, {
					isCurrent: () => !disposed && token === operation,
				});
				if (applied === false || disposed || token !== operation) return false;
			} finally {
				if (!disposed) {
					// A Stop can arrive after the chip committed but before its reply.
					// Persist the host's reconciled sound without marking a failed file
					// selection as the applied preset.
					if (token === operation) project.setSettings(getSettings());
					setBusy(false);
					if (token === operation) schedule();
				}
			}
		}
		if (sound) {
			project.setSettings(sound);
			appliedPreset = { kind: 'json', path, data: file.data };
		}
		project.select(path);
		render();
		schedule();
		if (file.type === 'text') await openInCurrentMode(path);
		if (disposed || token !== operation) return false;
		say(
			sound
				? 'YM2149 ST sound loaded. Edit its JSON in Code; select it again to apply changes.'
				: soundError
					? `JSON was not applied; current sound kept. Edit it in Code: ${soundError.message}`
					: file.type === 'text'
						? 'Text edits save to Files from Code; select a YM2149 ST sound JSON again to apply it.'
						: `Binary file · ${file.data.byteLength} bytes. Export it to use it elsewhere.`,
		);
		return true;
	}
	async function importFiles(files, { isCurrent = () => true } = {}) {
		if (disposed || !isCurrent()) return [];
		await api.ready;
		if (disposed || busy || !isCurrent()) return [];
		const token = ++operation,
			current = () => !disposed && token === operation && isCurrent();
		const entries = [];
		for (const file of files) {
			if (!current()) return [];
			if (file.size > 16 * 1024 * 1024) throw Error('A project file exceeds 16 MiB.');
			const bytes = new Uint8Array(await file.arrayBuffer());
			if (!current()) return [];
			entries.push({
				path: '/' + basename(file.name),
				type: isYmTextPath(file.name) ? 'text' : 'binary',
				data: isYmTextPath(file.name) ? decoder.decode(bytes) : bytes,
			});
		}
		if (!current()) return [];
		await code?.flush?.();
		if (!current()) return [];
		const candidate = createYmCodeProject({ snapshot: project.snapshot() }),
			paths = candidate.importFiles(entries);
		const replaceActive = paths.includes(code?.activePath),
			replaceExecution = paths.includes(executionPath());
		setBusy(true);
		try {
			if (replaceExecution) {
				if ((await code.workspaceReplaced()) === false || !current()) return [];
			}
			if (!current()) return [];
			project.restore(candidate.snapshot());
			if (replaceActive || replaceExecution) await code.restoreState(project.getCodeState());
			render();
			await persistCode();
			say(`Added ${paths.length} file(s). Code was not run.`);
			return paths;
		} finally {
			if (!disposed) setBusy(false);
		}
	}
	async function importProject(bytes) {
		await api.ready;
		if (disposed || busy) return false;
		const token = ++operation;
		const candidate = await project.prepareImport(bytes);
		if (disposed || token !== operation) return false;
		await code?.flush?.();
		if (disposed || token !== operation) return false;
		setBusy(true);
		try {
			if ((await code?.workspaceReplaced?.()) === false || disposed || token !== operation)
				return false;
			await onBeforeWorkspaceReplace();
			if (disposed || token !== operation) return false;
			await applySettings(candidate.settings, {
				isCurrent: () => !disposed && token === operation,
			});
			if (disposed || token !== operation) return false;
			restoring = true;
			try {
				appliedPreset = null;
				presetCache.clear();
				project.restore(candidate);
				identity = workspaceId();
			} finally {
				restoring = false;
			}
			await code?.restoreState?.(project.getCodeState());
			await persistCode();
			say('YM2149 ST project imported. Code was not run.');
			return true;
		} finally {
			if (!disposed) setBusy(false);
		}
	}
	async function exportProject() {
		await api.ready;
		await code?.flush?.();
		project.setSettings(getSettings());
		return project.exportProject();
	}
	function cancelNewProject() {
		if (pendingNewProject !== null) operation++;
		newProjectDialog.close();
	}
	function askNewProject() {
		if (disposed || busy) return;
		newProjectDialog.showModal();
		newProjectCancel.focus();
	}
	async function newProject({ exportCurrent = false } = {}) {
		if (typeof exportCurrent !== 'boolean') throw TypeError('exportCurrent must be a boolean.');
		await api.ready;
		if (disposed || busy) return false;
		const token = ++operation,
			current = () => !disposed && token === operation;
		let previous = null,
			previousIdentity = identity,
			previousPersistence = persistenceReady,
			retired = false,
			applyAttempted = false,
			committed = false,
			failure = null;
		pendingNewProject = token;
		clearTimeout(saveTimer);
		setBusy(true);
		try {
			if ((await code?.flush?.()) === false || !current()) return false;
			restoring = true;
			project.setSettings(getSettings());
			if (code?.captureState) project.setCodeState(code.captureState());
			previous = project.snapshot();
			const fresh = createYmCodeProject({ settings: createDefaultPreset(), getStarterCode });
			addYmCodeExamples(fresh);
			fresh.select('/index.js');
			fresh.setCodeState({ mode: 'keyboard', path: '/index.js' });
			if (exportCurrent) {
				const oldProject = createYmCodeProject({ snapshot: previous });
				const exported = await (downloadFile ?? download)(
					oldProject.exportProject(),
					oldProject.cassetteName + '.cassette.zip',
					'application/zip',
				);
				if (exported === false || !current()) return false;
			}
			if (!current()) return false;
			// Block incidental saves until the replacement and editor state both
			// commit. A confirmed new project may recover an unread old draft.
			persistenceReady = false;
			retired = true;
			if ((await code?.workspaceReplaced?.()) === false || !current()) return false;
			if ((await onBeforeWorkspaceReplace({ isCurrent: current })) === false || !current()) return false;
			if ((await onBeforeNewProject({ isCurrent: current })) === false || !current()) return false;
			applyAttempted = true;
			if ((await applySettings(fresh.settings, { isCurrent: current })) === false || !current()) return false;
			project.restore(fresh.snapshot());
			identity = workspaceId();
			if ((await code?.restoreState?.(project.getCodeState())) === false || !current()) return false;
			committed = true;
			persistenceReady = true;
			restoring = false;
			appliedPreset = null;
			presetCache.clear();
			newProjectDialog.close();
			const persisted = await persistCode();
			say(
				'New YM2149 ST project created. Code was not run.' +
					(persisted === false
						? ' Local save unavailable; export the project to keep it.'
						: ' Saved locally.'),
			);
			return true;
		} catch (error) {
			failure = error;
			throw error;
		} finally {
			if (!committed) {
				persistenceReady = previousPersistence;
				if (previous && retired) {
					project.restore(previous);
					identity = previousIdentity;
					if (!disposed) {
						if (applyAttempted) {
							try {
								await applySettings(previous.settings, {
									isCurrent: () => !disposed && pendingNewProject === token,
								});
							} catch (error) { report(Error('Previous sound could not be restored: ' + error.message)); }
						}
						try { await code?.restoreState?.(previous.codeState); }
						catch (error) { report(Error('Previous Code display could not be restored: ' + error.message)); }
					}
				}
			}
			restoring = false;
			if (!committed && !failure && current())
				say('New Project was not created; previous project kept.');
			if (pendingNewProject === token) {
				pendingNewProject = null;
				if (!disposed) {
					setBusy(false);
					if (!committed && previous && persistenceReady) schedule();
				}
			}
		}
	}
	async function move(source, destination, copy = false) {
		if (disposed || busy) return false;
		const token = ++operation;
		await code?.flush?.();
		if (disposed || token !== operation) return false;
		source = allowed(source);
		destination = allowed(destination);
		setBusy(true, { lockMain: !copy });
		try {
			if (
				occupied(project, destination) &&
				(copy || foldedPath(source) !== foldedPath(destination))
			)
				throw Error('That path already exists.');
			for (const file of project.fs.list())
				if (
					inside(file.path, source) &&
					isYmCodePath(destination + file.path.slice(source.length)) &&
					(file.type !== 'text' || file.data.length > YM_PROJECT_CODE_LENGTH)
				)
					throw Error('JavaScript files must be UTF-8 text no larger than 2 MiB.');
			let copied = null;
			if (copy) {
				const candidate = createYmCodeProject({ snapshot: project.snapshot() });
				transferVirtualFiles(candidate.fs, source, destination, { copy: true });
				candidate.restore(candidate.snapshot());
				copied = candidate.fs.snapshot();
			}
			const runningPath = executionPath(),
				movedCodePath = inside(runningPath, source)
					? destination + runningPath.slice(source.length)
					: null;
			if (!copy && movedCodePath && !isYmCodePath(movedCodePath))
				if ((await code?.stop?.()) === false || disposed || token !== operation)
					return false;
			if (disposed || token !== operation) return false;
			const previousApplied = appliedPreset;
			if (!copy && appliedPreset && inside(appliedPreset.path, source))
				appliedPreset = {
					...appliedPreset,
					path: destination + appliedPreset.path.slice(source.length),
				};
			try {
				if (copy) project.fs.restore(copied);
				else transferVirtualFiles(project.fs, source, destination);
			} catch (error) {
				appliedPreset = previousApplied;
				throw error;
			}
			if (!copy) {
				if (inside(project.selectedPath, source))
					project.select(destination + project.selectedPath.slice(source.length));
				code?.pathChanged?.(source, destination);
			}
			render();
			await persistCode();
			return true;
		} finally {
			if (!disposed) setBusy(false);
		}
	}
	async function duplicate(path) {
		await api.ready;
		if (disposed || busy) return false;
		path = allowed(path);
		const destination = copyPath(project, path);
		if (!(await move(path, destination, true)) || disposed) return false;
		const token = operation;
		project.select(destination);
		reveal(destination);
		render();
		if (project.fs.get(destination)?.type === 'text') await openInCurrentMode(destination);
		if (disposed || token !== operation) return false;
		await persistCode();
		say(`Duplicated ${path} to ${destination}.`);
		return destination;
	}
	async function remove(path) {
		if (disposed || busy) return false;
		const token = ++operation;
		await code?.flush?.();
		if (disposed || token !== operation) return false;
		path = allowed(path);
		setBusy(true);
		try {
			if (inside(executionPath(), path)) await code.stop();
			if (disposed || token !== operation) return false;
			if (inside(project.selectedPath, path)) project.select(null);
			project.fs.remove(path, { recursive: true });
			code?.pathChanged?.(path, null);
			render();
			await persistCode();
			return true;
		} finally {
			if (!disposed) setBusy(false);
		}
	}
	async function createFile(path) {
		await api.ready;
		if (disposed || busy) return false;
		const token = ++operation,
			directory = String(path).endsWith('/');
		path = allowed(path);
		await code?.flush?.();
		if (disposed || token !== operation) return false;
		if (occupied(project, path)) throw Error('That path already exists.');
		setBusy(true, { lockMain: false });
		try {
			const candidate = createYmCodeProject({ snapshot: project.snapshot() });
			if (directory) candidate.fs.mkdir(path, { recursive: true });
			else candidate.importFiles([{ path, type: 'text', data: '' }]);
			candidate.restore(candidate.snapshot());
			project.fs.restore(candidate.fs.snapshot());
			project.select(path);
			reveal(path);
			if (directory) expanded.set(path, true);
			render();
			if (!directory) await openInCurrentMode(path);
			if (disposed || token !== operation) return false;
			await persistCode();
			say(`Created ${path}.`);
			return true;
		} finally {
			if (!disposed) setBusy(false);
		}
	}
	async function saveSound({ path: requestedPath, value } = {}) {
		if (disposed || busy) return false;
		const token = ++operation;
		setBusy(true, { lockMain: false });
		try {
			if (requestedPath !== undefined) {
				requestedPath = allowed(requestedPath);
				if (!/\.ym2149-st\.json$/i.test(requestedPath))
					throw Error('Use a .ym2149-st.json instrument file name.');
				if (occupied(project, requestedPath)) throw Error('That path already exists.');
			}
			const sound = readYmProjectSound(value === undefined ? getSettings() : value);
			if (!sound) throw Error('Expected a YM2149 ST instrument.');
			if (disposed || token !== operation) return false;
			const path = requestedPath ?? newSoundPath(project, sound.name);
			if (occupied(project, path)) throw Error('That path already exists.');
			if (requestedPath !== undefined) {
				sound.name = basename(path).replace(/\.ym2149-st\.json$/i, '');
				readYmProjectSound(sound);
			}
			// importFiles validates its candidate before touching this workspace.
			// Name / size failures must keep both existing files and selection.
			project.importFiles([
				{ path, type: 'text', data: JSON.stringify(sound, null, 2) + '\n' },
			]);
			project.select(path);
			reveal(path);
			setVisible(true);
			render();
			await code?.openFile?.(path, { show: false });
			if (disposed || token !== operation) return false;
			const persisted = await persistCode();
			say(
				(value === undefined
					? 'Current YM2149 ST instrument saved to '
					: 'Selected YM2149 ST sound saved to ') +
					path +
					(persisted === false
						? ' in Files. Local save unavailable; export the project to keep it.'
						: ''),
			);
			return path;
		} finally {
			if (!disposed) setBusy(false);
		}
	}
	/** Capture is a two-preset transaction. Audio ownership stays with the host;
	 * validation and capacity failures happen before its apply callback. */
	async function saveCapturedSound(
		value,
		{ isCurrent = () => true, apply = async () => {} } = {},
	) {
		await api.ready;
		if (disposed || busy || !isCurrent()) return false;
		const token = ++operation,
			current = () => !disposed && token === operation && isCurrent();
		setBusy(true, { lockMain: false });
		try {
			if ((await code?.flush?.()) === false || !current()) return false;
			const original = readYmProjectSound(getSettings()),
				captured = readYmProjectSound(value);
			if (!original || !captured)
				throw Error('Capture requires complete YM2149 ST instrument presets.');
			const candidate = createYmCodeProject({ snapshot: project.snapshot() });
			const originalPath = newSoundPath(candidate, original.name);
			candidate.importFiles([
				{
					path: originalPath,
					type: 'text',
					data: JSON.stringify(original, null, 2) + '\n',
				},
			]);
			const capturedPath = newSoundPath(candidate, captured.name);
			candidate.importFiles([
				{
					path: capturedPath,
					type: 'text',
					data: JSON.stringify(captured, null, 2) + '\n',
				},
			]);
			candidate.setSettings(captured);
			candidate.select(capturedPath);
			if (!current()) return false;
			if (
				(await apply(readYmProjectSound(captured), { isCurrent: current })) === false ||
				!current()
			)
				return false;
			// Host UI is locked until this returns; do not overwrite a stale source.
			project.restore(candidate.snapshot());
			appliedPreset = null;
			reveal(capturedPath);
			setVisible(true);
			render();
			// This is the commit point. A later Stop/Resume must not ask the host to
			// roll its instrument back while the committed Files contain Capture.
			const result = {
				path: capturedPath,
				originalPath,
				preset: readYmProjectSound(captured),
				committed: true,
			};
			let editorError = '';
			try {
				await code?.openFile?.(capturedPath, { show: false });
			} catch (error) {
				editorError = ` Code display failed: ${error?.message ?? String(error)}`;
			}
			const persisted = await persistCode();
			say(
				`Captured to ${capturedPath}. Previous sound kept in ${originalPath}.` +
					editorError +
					(persisted === false
						? ' Local save unavailable; export the project to keep both sounds.'
						: ''),
			);
			return result;
		} finally {
			if (!disposed) setBusy(false);
		}
	}
	function download(bytes, filename, type = 'application/octet-stream') {
		const url = URL.createObjectURL(new Blob([bytes], { type })),
			link = make('a');
		link.href = url;
		link.download = filename;
		link.click();
		setTimeout(() => URL.revokeObjectURL(url), 1000);
	}
	function ask(action, path = project.selectedPath) {
		if (disposed || busy) return;
		dialogAction = action;
		dialogPath = path;
		const directory =
			path && project.fs.stat(path).type === 'directory' ? path : path ? dirname(path) : '/';
		label.textContent = {
			delete: 'Delete this project path?',
			rename: 'New file path',
			instrument: 'New instrument · .ym2149-st.json path',
			folder: 'New folder path',
			new: 'New JavaScript file path',
		}[action];
		nameInput.value =
			action === 'new'
				? `${directory === '/' ? '' : directory}/untitled.js`
				: action === 'folder'
					? `${directory === '/' ? '' : directory}/New folder/`
					: action === 'instrument'
						? `${directory === '/' ? '/presets' : directory}/Untitled.ym2149-st.json`
						: (path ?? '');
		nameInput.readOnly = action === 'delete';
		confirm.textContent =
			action === 'delete' ? 'Delete' : action === 'rename' ? 'Rename' : 'Create';
		dialog.showModal();
		nameInput.focus();
		nameInput.select?.();
	}
	const contextMenu = installYmFileContextMenu({
		root: tree,
		document: doc,
		isBusy: () => disposed || busy,
		onError: report,
		onTarget: (path) => {
			if (project.fs.stat(path)) project.select(path);
		},
		getActions: (path) =>
			[
				['duplicate', 'Duplicate'],
				['rename', 'Rename…'],
				['delete', 'Delete'],
				['instrument', 'New instrument…'],
				['new', 'New JavaScript file…'],
				['folder', 'New folder…'],
			].map(([id, label]) => ({
				id,
				label,
				disabled: path === '/' && ['duplicate', 'rename', 'delete'].includes(id),
			})),
		onAction: (action, path) => (action === 'duplicate' ? duplicate(path) : ask(action, path)),
	});
	contextMenu.element.id = 'ymFileContextMenu';
	contextMenu.element.className = 'ym-file-context-menu';
	listen(toggle, 'click', () => setVisible(panel.hidden));
	listen(panel, 'keydown', (event) => event.stopPropagation());
	listen(tree, 'click', (event) => {
		const summary = event.target?.closest?.('summary[data-file-path]');
		if (!summary || busy) return;
		event.preventDefault();
		const path = summary.getAttribute('data-file-path');
		expanded.set(path, !summary.parentNode.open);
		project.select(path);
		render();
		schedule();
	});
	listen(form, 'submit', (event) => {
		event.preventDefault();
		const action = dialogAction,
			value = nameInput.value,
			path = dialogPath;
		dialog.close();
		void Promise.resolve()
			.then(() => {
				if (action === 'new') {
					if (!isYmCodePath(value)) throw Error('Use a .js or .mjs file name.');
					return createFile(value);
				}
				if (action === 'folder') return createFile(value.replace(/\/$/, '') + '/');
				if (action === 'instrument') return saveSound({ path: value });
				return action === 'rename' ? move(path, value) : remove(path);
			})
			.catch(report);
	});
	listen(cancel, 'click', () => dialog.close());
	listen(newProjectCancel, 'click', cancelNewProject);
	listen(newProjectDialog, 'cancel', (event) => {
		event.preventDefault();
		cancelNewProject();
	});
	listen(newProjectExport, 'click', () => void newProject({ exportCurrent: true }).catch(report));
	listen(newProjectCreate, 'click', () => void newProject().catch(report));
	listen(presetSelect, 'change', () => {
		const choice = presetOptions.get(presetSelect.value);
		presetSelect.blur();
		if (choice) void selectFile(choice.path).catch(report);
	});
	for (const [id, fn] of [
		['ymProjectNewButton', askNewProject],
		['ymFileNewButton', () => ask('new')],
		['ymFileRenameButton', () => ask('rename')],
		['ymFileDeleteButton', () => ask('delete')],
		[
			'ymFileImportButton',
			() => {
				setVisible(true);
				fileInput.value = '';
				fileInput.click();
			},
		],
		[
			'ymProjectImportButton',
			() => {
				setVisible(true);
				projectInput.value = '';
				projectInput.click();
			},
		],
		['ymFileSaveSoundButton', () => void saveSound().catch(report)],
		[
			'ymProjectExportButton',
			() =>
				void exportProject()
					.then((bytes) =>
						download(bytes, project.cassetteName + '.cassette.zip', 'application/zip'),
					)
					.catch(report),
		],
		[
			'ymFileExportButton',
			() => {
				const file = project.fs.get(project.selectedPath);
				if (file)
					download(
						file.data,
						basename(file.path),
						file.type === 'text' ? 'text/plain;charset=utf-8' : undefined,
					);
			},
		],
	])
		listen(buttons.get(id), 'click', fn);
	listen(fileInput, 'change', () => {
		const files = [...fileInput.files];
		fileInput.value = '';
		void importFiles(files).catch(report);
	});
	listen(projectInput, 'change', () => {
		const [file] = projectInput.files;
		projectInput.value = '';
		if (file) void file.arrayBuffer().then(importProject).catch(report);
	});
	listen(
		doc,
		'keydown',
		(event) => {
			if (
				(event.ctrlKey || event.metaKey) &&
				!event.altKey &&
				event.key.toLowerCase() === 's'
			) {
				event.preventDefault();
				event.stopPropagation();
				void (code?.flush?.() ?? persistCode()).catch(report);
			}
		},
		true,
	);
	listen(win, 'pagehide', () => {
		void code?.flush?.();
		void persistCode();
	});
	const unwatch = project.onDidChange(() => {
		render();
		schedule();
	});
	const api = {
		project,
		async importMusicSources(sources,{isCurrent=()=>true}={}) {
			await api.ready;
			if(disposed||busy||!isCurrent())return [];
			const token=++operation,current=()=>!disposed&&token===operation&&isCurrent();
			setBusy(true,{lockMain:false});
			try {
				if((await code?.flush?.())===false||!current())return [];
				const candidate=createYmCodeProject({snapshot:project.snapshot()});
				const entries=ymMusicEntries(candidate,sources);candidate.importFiles(entries);
				if(!current())return [];
				project.fs.restore(candidate.fs.snapshot());
				render();await persistCode();return entries.map(entry=>entry.path);
			} finally {if(!disposed)setBusy(false);}
		},
		get workspaceId() {
			return identity;
		},
		setVisible,
		setCodeControls(value) {
			code = value;
			render();
		},
		rememberCodeState(value) {
			if (!disposed) project.setCodeState(value);
		},
		getCodeState: () => project.getCodeState(),
		persistCode,
		selectFile,
		importFiles,
		importProject,
		exportProject,
		createFile,
		newProject,
		move,
		duplicate,
		remove,
		saveSound,
		saveCapturedSound,
		markSoundDirty() {
			editRevision++;
			appliedPreset = null;
			if (presetSelect) presetSelect.value = '';
			if (disposed || busy || restoring) return;
			project.setSettings(getSettings());
			schedule();
		},
		async dispose() {
			if (disposed) return;
			operation++;
			contextMenu.dispose();
			newProjectDialog.close();
			newProjectDialog.remove();
			await code?.flush?.();
			await persistCode();
			disposed = true;
			if (main) main.inert = false;
			clearTimeout(saveTimer);
			unwatch();
			for (const cleanup of listeners) cleanup();
			await store.close?.();
		},
	};
	const initialEditRevision = editRevision;
	api.ready = Promise.resolve().then(async () => {
		const before = initialEditRevision;
		let examplesAdded = false;
		try {
			const saved = await store.read();
			if (disposed) return;
			if (saved) {
				const candidate = createYmCodeProject({ snapshot: saved });
				if (before !== editRevision) candidate.setSettings(getSettings());
				restoring = true;
				try {
					await onBeforeWorkspaceReplace();
					if (disposed) return;
					if (before !== editRevision) candidate.setSettings(getSettings());
					await applySettings(candidate.settings, { isCurrent: () => !disposed });
					if (disposed) return;
					presetCache.clear();
					appliedPreset = null;
					project.restore(candidate.snapshot());
					identity = typeof saved.workspaceId === 'string' ? saved.workspaceId : identity;
					if (!visibilityTouched) setVisible(Boolean(saved.filesVisible));
				} finally {
					restoring = false;
				}
			}
			// Never save defaults over an unread or invalid stored project. Only
			// the initial successful restore enables persistence; reconnect is I/O.
			persistenceReady = true;
			// Seed only the known startup workspace, after its saved state has been
			// validated. Explicit project imports remain exactly as imported.
			restoring = true;
			try {
				examplesAdded = addYmCodeExamples(project).length > 0;
			} catch (error) {
				report(
					Error('Default examples could not be added; current files kept. ' + error.message),
				);
			} finally {
				restoring = false;
			}
		} catch (error) {
			report(Error('Local project restore failed; current files kept. ' + error.message));
		} finally {
			if (!disposed) {
				setBusy(false);
				if (persistenceReady && (examplesAdded || before !== editRevision)) schedule();
			}
		}
	});
	if (main) main.inert = true;
	render();
	return api;
}

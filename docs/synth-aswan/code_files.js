// Compact ASWAN Files adapter for the shared Synth Code editor.
import { extractVgmInstruments } from './vgm_import.js';
import { renderFileTree } from '../playground/playground_file_tree.js';
import { transferVirtualFiles, isCheckpointPath } from '../js/tetorica_virtual_files/filesystem.js';
import { normalizeVirtualPath } from '../js/tetorica_virtual_files/path.js';
import { installSpuFileContextMenu as installAswanFileContextMenu } from '../synth-spu/file_context_menu.js?v=spu-files-menu-1';
import {
	createAswanCodeProject,
	createAswanProjectStore,
	readAswanProjectSound,
	isAswanCodePath,
	isAswanTextPath,
	isAswanSongFilename,
	isAswanSongPath,
	ASWAN_PROJECT_MANIFEST,
	ASWAN_PROJECT_CODE_LENGTH,
	ASWAN_PROJECT_FILE_BYTES,
} from './code_project.js?v=draft-reconnect-1';

const inside = (path, directory) => path === directory || path?.startsWith(directory + '/');
const basename = (path) => path.split('/').pop(),
	dirname = (path) => path.slice(0, path.lastIndexOf('/')) || '/';
const workspaceId = () =>
	globalThis.crypto?.randomUUID?.() ??
	`aswan-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const encoder = new TextEncoder();
function soundFileStem(value, extension = /\.aswan\.json$/i) {
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
		path = '/presets/' + stem + '.aswan.json';
	while (occupied.has(fold(path))) path = `/presets/${stem} (${++index}).aswan.json`;
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
		: (name.match(/\.aswan\.json$/i)?.[0] ?? name.match(/\.[^./]+$/)?.[0] ?? '');
	const stem = extension ? name.slice(0, -extension.length) : name;
	let index = 1,
		result;
	do {
		result = `${directory === '/' ? '' : directory}/${stem}-copy${index === 1 ? '' : `-${index}`}${extension}`;
		index++;
	} while (occupied(project, result));
	return result;
}
/** Prepare a passive, complete preset batch; callers commit a candidate once. */
export function aswanVgmSoundEntries(project, { name, voices }) {
	if (typeof name !== 'string' || !Array.isArray(voices))
		throw TypeError('VGM sounds need a source name and voice array.');
	if (!voices.length) return { entries: [], directory: null };
	const metadata = project.listEntries(),
		used = new Set(
			[...metadata.map((file) => file.path), ...project.fs.listDirectories()].map(foldedPath),
		);
	const stem = soundFileStem(basename(name.replace(/\\/g, '/')), /\.(?:vgm|vgz)$/i);
	let index = 1,
		directory = '/presets/' + stem;
	while (used.has(foldedPath(directory))) directory = `/presets/${stem} (${++index})`;
	let total = metadata.reduce((bytes, file) => bytes + file.size, 0);
	const entries = voices.map((voice) => {
		const sound = readAswanProjectSound(voice?.preset);
		if (!sound) throw Error('Every extracted VGM voice must contain a complete ASWAN preset.');
		const stem = soundFileStem(sound.name);
		let index = 1,
			path = `${directory}/${stem}.aswan.json`;
		while (used.has(foldedPath(path))) path = `${directory}/${stem} (${++index}).aswan.json`;
		used.add(foldedPath(path));
		const data = JSON.stringify(sound, null, 2) + '\n';
		total += encoder.encode(data).byteLength;
		if (total > ASWAN_PROJECT_FILE_BYTES)
			throw Error(
				'VGM sounds exceed the 16 MiB cassette limit. Current Files and instrument are kept.',
			);
		return { path, type: 'text', data };
	});
	return { entries, directory };
}

export function setupAswanCodeFiles({
	project = createAswanCodeProject(),
	getSettings = () => project.settings,
	applySettings = async () => {},
	onBeforeWorkspaceReplace = async () => {},
	onBeforeSoundApply = async () => {},
	setStatus = () => {},
	store = createAswanProjectStore(),
	document: doc = globalThis.document,
} = {}) {
	const panel = doc.getElementById('aswanFilesPanel'),
		toggle = doc.getElementById('aswanFilesToggle'),
		workspace = doc.getElementById('synthWorkspace');
	const presetSelect = doc.getElementById('aswanPresetSelect'),
		presetCache = new Map();
	let presetSignature = '',
		appliedPreset = null,
		presetOptions = new Map();
	if (!panel || !toggle || !workspace) throw Error('ASWAN Files mount is missing.');
	const hasPath = (fs, path) => { try { return Boolean(path && fs.stat(path)); } catch { return false; } };
	const win = doc.defaultView ?? globalThis,
		main = doc.getElementById('aswanSynthMain'),
		listeners = [],
		expanded = new Map([
			['/presets', true],
			['/lib', true],
			['/data', true],
			['/vgm', true],
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
		soundEditOperation = 0, soundApplicationPending = false, pendingSoundEdit = Promise.resolve(), pendingAutoValue = null;
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
	heading.className = 'aswan-files-heading';
	const title = make('h2', null, 'FILES');
	const toolbar = make('div');
	toolbar.className = 'aswan-files-toolbar';
	toolbar.setAttribute('role', 'group');
	toolbar.setAttribute('aria-label', 'Create project files');
	heading.append(title, toolbar);
	const actions = make('div');
	actions.className = 'aswan-files-actions';
	actions.setAttribute('role', 'group');
	actions.setAttribute('aria-label', 'Selected file actions');
	const buttons = new Map();
	for (const [id, label] of [
		['aswanFileNewButton', '+ JS'],
		['aswanFileSaveButton', 'Save'],
		['aswanFileSaveAllButton', 'Save all'],
		['aswanFileDiscardButton', 'Discard'],
		['aswanFileDiscardAllButton', 'Discard all'],
		['aswanFileSaveSoundButton', 'Save sound'],
		['aswanFileRenameButton', 'Rename…'],
		['aswanFileDeleteButton', 'Delete…'],
		['aswanFileImportButton', 'Add files…'],
		['aswanFileExportButton', 'Export file'],
		['aswanProjectExportButton', 'Export project'],
		['aswanProjectImportButton', 'Import project…'],
	]) {
		const button = make('button', id, label);
		button.type = 'button';
		(id === 'aswanFileNewButton' || id === 'aswanFileSaveSoundButton'
			? toolbar
			: actions
		).append(button);
		buttons.set(id, button);
		if (id === 'aswanFileNewButton')
			button.title = 'New JavaScript file; end the path with / to create a folder';
		const destination = {
			aswanProjectImportButton: ['aswanMenuProjectImport', 'Project · ZIP…'],
			aswanProjectExportButton: ['aswanMenuProjectExport', 'Project · ZIP'],
			aswanFileImportButton: ['aswanMenuFilesImport', 'Project files…'],
			aswanFileExportButton: ['aswanMenuFileExport', 'Selected file'],
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
				if (id !== 'aswanFileSaveSoundButton' || !code?.isCodeMode?.())
					doc.activeElement?.blur?.();
			}
		});
	}
	const autoLabel = make('label');
	autoLabel.className = 'aswan-files-auto';
	const autoToggle = make('input', 'aswanFilesAutoApply');
	autoToggle.type = 'checkbox'; autoToggle.checked = project.autoApply;
	autoLabel.append(autoToggle, make('span', null, 'Auto apply'));
	const selected = make('p', 'aswanFilesSelected', '');
	selected.className = 'aswan-files-path aswan-sr-only';
	selected.setAttribute('role', 'status');
	const tree = make('div', 'aswanFilesTree');
	tree.setAttribute('aria-label', 'ASWAN project files');
	const info = make(
		'p',
		'aswanFilesStatus',
		'Auto apply saves edits immediately. Turn it off to edit, then Save. Importing never runs Code.',
	);
	info.className = 'aswan-files-status';
	info.setAttribute('role', 'status');
	const fileInput = make('input', 'aswanFilesInput');
	fileInput.type = 'file';
	fileInput.multiple = true;
	fileInput.hidden = true;
	const projectInput = make('input', 'aswanProjectFileInput');
	projectInput.type = 'file';
	projectInput.accept = '.zip,application/zip';
	projectInput.hidden = true;
	const dialog = make('dialog', 'aswanFileNameDialog'),
		form = make('form'),
		label = make('label', 'aswanFileNameLabel', 'File path'),
		nameInput = make('input', 'aswanFileNameInput');
	label.htmlFor = nameInput.id;
	const confirm = make('button', 'aswanFileNameConfirm', 'Create'),
		cancel = make('button', 'aswanFileNameCancel', 'Cancel');
	confirm.type = 'submit';
	cancel.type = 'button';
	form.append(label, nameInput, confirm, cancel);
	dialog.append(form);
	panel.append(heading, autoLabel, tree, actions, selected, info, fileInput, projectInput, dialog);
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
		if (path === '/' || path === ASWAN_PROJECT_MANIFEST || isCheckpointPath(path))
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
					name = readAswanProjectSound(file.data)?.name ?? null;
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
		for (const node of tree.querySelectorAll('button')) {
			const path = node.getAttribute('data-file-path');
			if (path && project.isFileModified(path)) {
				node.textContent += ' ●';
				node.title = path + ' · Unsaved changes';
				node.setAttribute('data-modified', 'true');
			}
		}
		autoToggle.checked = pendingAutoValue ?? project.autoApply; autoToggle.disabled = busy || pendingAutoValue !== null;
		for (const [id, button] of buttons)
			button.disabled =
				busy ||
				([
					'aswanFileExportButton',
					'aswanFileRenameButton',
					'aswanFileDeleteButton',
				].includes(id) &&
					!project.selectedPath);
		for (const id of ['aswanFileSaveButton', 'aswanFileDiscardButton'])
			buttons.get(id).disabled = busy || !(project.selectedPath && project.isFileModified(project.selectedPath));
		for (const id of ['aswanFileSaveAllButton', 'aswanFileDiscardAllButton'])
			buttons.get(id).disabled = busy || !project.getDirtyPaths().length;
		code?.setBusy?.(busy);
		for (const button of tree.querySelectorAll('button')) button.disabled = busy;
	}
	function setBusy(value, { lockMain = true } = {}) {
		busy = value;
		if (main) main.inert = Boolean(value && lockMain);
		render();
	}
	async function persistCode() {
		if (disposed || !persistenceReady) return false;
		if (!busy && !restoring && !soundApplicationPending) {
			project.setSettings(getSettings());
			if (project.autoApply) project.setSavedSettings(project.settings);
		}
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
	async function flushCode() {
		const result = await code?.flush?.();
		await pendingSoundEdit;
		return result;
	}
	const executionPath = () =>
		code?.executionPath ?? (isAswanCodePath(code?.activePath) ? code.activePath : null);
	const openInCurrentMode = (path) =>
		code?.openFile?.(path, { show: Boolean(code?.isCodeMode?.()) });
	function reveal(path) {
		for (let directory = dirname(path); directory !== '/'; directory = dirname(directory))
			expanded.set(directory, true);
	}
  const soundPath=()=>project.activeSoundPath??null;
  const pendingMoves=()=>project.getPendingMoves?.()??[];
  function savedPath(path){
    if(!path)return path;
    const move=pendingMoves().find(([,destination])=>inside(path,destination));
    const original=move?move[0]+path.slice(move[1].length):null;
    return original&&hasPath(project.savedFs,original)?original:path;
  }
  function soundFromFile(path,fs=project.fs){
    const file=path&&fs.get(path);return file?.type==='text'?readAswanProjectSound(file.data):null;
  }
  function displaySound(){try{return soundFromFile(soundPath())??project.settings;}catch{return project.settings;}}
  function expandedSavePaths(paths){
    const result=new Set(paths);
    for(const path of paths)for(const[source,destination]of pendingMoves()){
      if(inside(path,destination))result.add(source+path.slice(destination.length));
      if(inside(path,source))result.add(destination+path.slice(source.length));
      if(inside(source,path)||inside(destination,path)){result.add(source);result.add(destination);}
    }
    return [...result].filter(path=>hasPath(project.fs,path)||hasPath(project.savedFs,path));
  }
  function canEditSound(){
    if(disposed||busy||restoring)throw Error('Wait for the current Files operation before editing the instrument.');
    const path=soundPath();if(!path)return true;
    try{if(!soundFromFile(path))throw Error('Expected a ASWAN sound JSON.');}
    catch(error){throw Error(`Finish or Discard the JSON edits in ${path} before changing its controls. ${error.message}`);}
    return true;
  }
  function adoptExternalSound(value){
    if(disposed||busy||restoring)throw Error('Wait for the current Files operation before loading an instrument.');
    const sound=readAswanProjectSound(value);if(!sound)throw Error('Expected a ASWAN instrument.');
    soundEditOperation++;soundApplicationPending=false;editRevision++;
    project.setActiveSoundPath(null);project.setSettings(sound);project.setSavedSettings(sound);appliedPreset=null;
    render();schedule();return sound;
  }
  function validateSoundEdit(value=getSettings()) {
    canEditSound();
    const sound=readAswanProjectSound(value);if(!sound)throw Error('Expected an ASWAN instrument.');
    const path=soundPath()??newSoundPath(project,sound.name), source=JSON.stringify(sound,null,2)+'\n';
    const bytes=encoder.encode(source).byteLength+project.listEntries().reduce((total,file)=>total+(file.path===path?0:file.size),0);
    if(bytes>ASWAN_PROJECT_FILE_BYTES)throw Error('Instrument exceeds the 16 MiB Project limit. Export preset to keep a larger instrument.');
    return {sound,path,source};
  }
  function recordSoundEdit(value=getSettings()) {
    const {sound,path,source}=validateSoundEdit(value),active=soundPath();
    if(!active){project.importFiles([{path,type:'text',data:source}]);project.setActiveSoundPath(path);}
    else project.writeEditorText(path,source);
    soundEditOperation++;soundApplicationPending=false;
    editRevision++;project.setSettings(sound);if(project.autoApply)project.setSavedSettings(sound);
    project.select(path);appliedPreset={kind:'json',path,data:project.fs.get(path).data};reveal(path);
    if(code?.activePath===path)code.reloadFile?.(path);
    render();schedule();return path;
  }
  function codeEdited(path){
    if(disposed)return;project.select(path);if(path!==soundPath())return;
    let sound;try{sound=soundFromFile(path);if(!sound)throw Error('Expected a ASWAN sound JSON.');}
    catch(error){say(`JSON not applied; current sound kept. ${error.message}`);return;}
    const token=++soundEditOperation,workspace=identity;soundApplicationPending=false;
    project.setSettings(sound);if(project.autoApply)project.setSavedSettings(sound);
    editRevision++;appliedPreset={kind:'json',path,data:project.fs.get(path).data};
    soundApplicationPending=true;
    pendingSoundEdit=Promise.resolve().then(async()=>{
      const current=()=>!disposed&&token===soundEditOperation&&workspace===identity&&soundPath()===path;
      const result=await applySettings(sound,{record:false,source:'json',load:false,applyAudio:project.autoApply,displayPreset:sound,isCurrent:current});
      // An incomplete later edit is source text, not a newer playable command.
      // Keep this last valid command, then restore its warning after the ack.
      if(current())try{if(!soundFromFile(path))throw Error('Expected a ASWAN sound JSON.');}catch(error){say(`JSON not applied; current sound kept. ${error.message}`);}
      return result;
    }).catch(report).finally(()=>{if(token===soundEditOperation)soundApplicationPending=false;});
    render();schedule();
  }
  async function recoverCodeState(path){
    if(disposed||path!==soundPath())return false;
    let working=null,accepted=null;
    try{working=soundFromFile(path);}catch{}
    try{accepted=soundFromFile(savedPath(path),project.savedFs);}catch{}
    if(accepted)project.setSavedSettings(accepted);
    project.setSettings(working??accepted??project.settings);
    const token=++soundEditOperation,workspace=identity;soundApplicationPending=false;
    await applySettings(project.savedSettings,{record:false,source:'restore',load:false,applyAudio:true,displayPreset:project.settings,
      isCurrent:()=>!disposed&&token===soundEditOperation&&workspace===identity});
    appliedPreset={kind:'json',path,data:project.fs.get(path)?.data};render();schedule();return true;
  }
	// Acceptance is prepared separately. A rejected/cancelled sound application
	// cannot promote working files to saved or consume a pending rename.
	async function changeAcceptance(kind, all = false, enabled = false) {
		await api.ready;
		if (disposed || busy) return false;
		if ((await code?.flush?.({persist: false})) === false) return false;
		await pendingSoundEdit;
		if (disposed || busy) return false;
		const path = project.selectedPath ?? code?.activePath ?? soundPath();
		if (kind !== 'auto' && !all && !path) return false;
		const token = ++operation, current = () => !disposed && token === operation;
		const active = soundPath(), activeOriginal = savedPath(active), original = savedPath(path);
		const editorPath = code?.activePath, editorOriginal = savedPath(editorPath);
		const targets = all ? project.getDirtyPaths() : path && project.isFileModified(path) ? expandedSavePaths([path]) : [];
		const candidate = createAswanCodeProject({snapshot: project.snapshot()});
		setBusy(true, {lockMain: false});
		try {
			if (kind === 'auto') candidate.setAutoApply(enabled);
			else if (kind === 'save') {
				if (all) candidate.saveAll(); else if (targets.length) candidate.saveFiles(targets);
			} else if (targets.length) candidate.discardFiles(targets);
			if (kind !== 'auto') candidate.setPendingMoves(candidate.getPendingMoves().filter(
				([source, destination]) => !targets.some(target => inside(source, target) || inside(destination, target))));
			const changesSound = Boolean(active && (kind === 'auto' || targets.some(root => inside(active, root) || inside(activeOriginal, root))));
			if (kind === 'discard') {
				if (changesSound) candidate.setActiveSoundPath(hasPath(candidate.fs, activeOriginal) ? activeOriginal : null);
				candidate.select(hasPath(candidate.fs, original) ? original : null);
			}
			if (candidate.activeSoundPath && !hasPath(candidate.fs, candidate.activeSoundPath) && !hasPath(candidate.savedFs, candidate.activeSoundPath))
				candidate.setActiveSoundPath(null);
			let invalid = null;
			if (changesSound) {
				let accepted = candidate.savedSettings, shown = candidate.settings;
				const activePath = candidate.activeSoundPath;
				try {
					if (activePath && candidate.savedFs.has(activePath)) {
						accepted = soundFromFile(activePath, candidate.savedFs);
						if (!accepted) throw Error('Expected an ASWAN sound JSON.');
					}
				} catch (error) { invalid = error; accepted = candidate.savedSettings; }
				try { shown = soundFromFile(activePath, candidate.fs) ?? accepted; } catch { shown = accepted; }
				candidate.setSettings(shown);
				candidate.setSavedSettings(accepted);
				const applyAudio = kind === 'save' || kind === 'auto' && enabled;
				if ((await applySettings(accepted, {record: false, source: kind, load: false,
					applyAudio: applyAudio && !invalid, displayPreset: shown, isCurrent: current})) === false || !current()) return false;
			}
			if (!current()) return false;
			project.restore(candidate.snapshot());
			if (kind === 'discard') {
				if (editorPath && editorPath !== editorOriginal && (all || inside(editorPath, path)))
					code?.pathChanged?.(editorPath, editorOriginal, {preserveExecution: true});
				await code?.reloadFile?.();
			}
			render();
			const durable = await persistCode();
			say((kind === 'auto' ? (enabled ? 'Auto apply on. Edits apply immediately.' : 'Auto apply off. Save to apply edits.') :
				kind === 'save' ? `Saved ${all ? 'all files' : path}.` : `Discarded ${all ? 'all unsaved changes' : path}.`) +
				(invalid ? ` JSON not applied; current sound kept. ${invalid.message}` : '') +
				(durable === false ? ' Local save unavailable; Export Cassette to keep both versions.' : ''));
			return true;
		} finally { if (!disposed) setBusy(false); }
	}
	const saveCurrent = (all = false) => changeAcceptance('save', all);
	const discardCurrent = (all = false) => changeAcceptance('discard', all);
	async function setAutoApply(enabled) {
		if (typeof enabled !== 'boolean') throw TypeError('Auto apply must be boolean.');
		if (disposed || busy || pendingAutoValue !== null) return false;
		pendingAutoValue = enabled; render();
		try { return await changeAcceptance('auto', false, enabled); }
		finally { pendingAutoValue = null; render(); }
	}
  async function selectFile(path){
    if(!disposed&&!busy)code?.cancelPendingExecution?.();
    await api.ready;if(disposed||busy)return false;const token=++operation;
    await code?.flush?.();await pendingSoundEdit;if(disposed||token!==operation)return false;
    path=normalizeVirtualPath(path);const file=project.fs.get(path);if(!file)throw Error('Choose a file.');
    if(isAswanCodePath(path)){project.select(path);render();return await openInCurrentMode(path);}
    let sound=null,soundError=null,accepted=null;
    if(file.type==='text'&&/\.json$/i.test(path)){try{sound=readAswanProjectSound(file.data);}catch(error){soundError=error;}}
    try{accepted=soundFromFile(savedPath(path),project.savedFs);}catch{}
    const instrument=Boolean(sound||accepted||path===soundPath()||/\.aswan\.json$/i.test(path));
    if(instrument){
      accepted=project.autoApply?sound:accepted;
      const audible=accepted??project.savedSettings,display=sound??accepted??project.settings;
      setBusy(true);
      try{
        if(accepted)await onBeforeSoundApply();if(disposed||token!==operation)return false;
        const applied=await applySettings(audible,{record:false,source:'selection',load:true,applyAudio:Boolean(accepted),displayPreset:display,isCurrent:()=>!disposed&&token===operation});
        if(applied===false||disposed||token!==operation)return false;
      }finally{
        if(!disposed){
          // A Stop can arrive after the chip committed but before its reply.
          // Persist the host's reconciled sound without marking a failed file
          // selection as the applied preset.
          if(token===operation){project.setSettings(getSettings());if(project.autoApply)project.setSavedSettings(project.settings);}
          setBusy(false);if(token===operation)schedule();
        }
      }
    }
    if(instrument){project.setActiveSoundPath(path);if(sound)project.setSettings(sound);if(accepted)project.setSavedSettings(accepted);appliedPreset={kind:'json',path,data:file.data};}
    project.select(path);render();schedule();
    if(file.type==='text')await openInCurrentMode(path);
    if(disposed||token!==operation)return false;
    say(sound?(project.autoApply?'ASWAN sound loaded. Controls and valid JSON edits update this file automatically.':'Sound draft selected. Saved sound plays; Save applies your edits.'):soundError?`JSON was not applied; current sound kept. Edit it in Code: ${soundError.message}`:isAswanSongPath(path)?'VGM source selected. Press Play in the song list; your instrument is kept.':file.type==='text'?'Text edits save to Files from Code; valid edits to the active sound follow Auto apply.':`Binary file · ${file.data.byteLength} bytes. Export it to use it elsewhere.`);return true;
  }
	async function importFiles(files, { isCurrent = () => true } = {}) {
		if (disposed || !isCurrent()) return [];
		await api.ready;
		if (disposed || busy || !isCurrent()) return [];
		const token = ++operation,
			current = () => !disposed && token === operation && isCurrent();
		const entries = [],
			songs = [];
		for (const file of files) {
			if (!current()) return [];
			if (file.size > 16 * 1024 * 1024) throw Error('A project file exceeds 16 MiB.');
			const bytes = new Uint8Array(await file.arrayBuffer());
			if (!current()) return [];
			if (isAswanSongFilename(file.name)) songs.push({ name: file.name, bytes });
			else
				entries.push({
					path: '/' + basename(file.name),
					type: isAswanTextPath(file.name) ? 'text' : 'binary',
					data: isAswanTextPath(file.name) ? decoder.decode(bytes) : bytes,
				});
		}
		if (!current()) return [];
		await flushCode();
		if (!current()) return [];
		const extracted = [];
		for (const song of songs) {
			const result = await extractVgmInstruments(song.bytes, { allowEmpty: true });
			if (!current()) return [];
			extracted.push({ name: song.name, ...result });
		}
		const candidate = createAswanCodeProject({ snapshot: project.snapshot() }),
			songPaths = candidate.importSongSources(songs),
			paths = [...candidate.importFiles(entries), ...songPaths];
		for (const result of extracted) {
			const batch = aswanVgmSoundEntries(candidate, result);
			paths.push(...candidate.importFiles(batch.entries));
		}
		const replaceActive = paths.includes(code?.activePath),
			replaceExecution = paths.includes(executionPath());
		if (songPaths.length) candidate.select(songPaths.at(-1));
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
	/** Store one original log and its static presets atomically, without applying or running it. */
	async function importVgm(bytes, { name = 'Imported.vgm', isCurrent = () => true } = {}) {
		await api.ready;
		if (disposed || busy || !isCurrent()) return false;
		const token = ++operation,
			current = () => !disposed && token === operation && isCurrent();
		const result = await extractVgmInstruments(bytes, { allowEmpty: true });
		if (!current()) return false;
		if ((await flushCode()) === false || !current()) return false;
		const candidate = createAswanCodeProject({ snapshot: project.snapshot() });
		const [sourcePath] = candidate.importSongSources([{ name, bytes }]);
		const { entries, directory } = aswanVgmSoundEntries(candidate, {
			name,
			voices: result.voices,
		});
		const paths = candidate.importFiles(entries);
		candidate.select(sourcePath);
		if (!current()) return false;
		setBusy(true, { lockMain: false });
		try {
			project.restore(candidate.snapshot());
			reveal(sourcePath);
			if (directory) {
				reveal(directory);
				expanded.set(directory, true);
			}
			setVisible(true);
			render();
			const committed = { ...result, sourcePath, paths, directory, committed: true };
			const persisted = await persistCode();
			say(
				`Added ${sourcePath} and ${paths.length} sound preset(s). Select a sound to load it; Play is separate.` +
					(persisted === false
						? ' Local save unavailable; export the project to keep these files.'
						: ''),
			);
			return committed;
		} finally {
			if (!disposed) setBusy(false);
		}
	}
	async function saveSongSource(source, { isCurrent = () => true } = {}) {
		await api.ready;
		if (disposed || busy || !isCurrent()) return false;
		const token = ++operation,
			current = () => !disposed && token === operation && isCurrent();
		if ((await flushCode()) === false || !current()) return false;
		const candidate = createAswanCodeProject({ snapshot: project.snapshot() }),
			paths = candidate.importSongSources([source]);
		if (!current()) return false;
		setBusy(true, { lockMain: false });
		try {
			candidate.select(paths[0]);
			project.restore(candidate.snapshot());
			reveal(paths[0]);
			setVisible(true);
			render();
			await persistCode();
			if (!current()) return false;
			say(
				`Original VGM source saved to ${paths[0]}. Press Play to hear it; current instrument kept.`,
			);
			return paths[0];
		} finally {
			if (!disposed) setBusy(false);
		}
	}
	/** Static VGM extraction saves a passive batch, separate from its raw log.
	 * No voice is selected, applied, opened in Code or played by this operation. */
	async function saveVgmSounds({ name, voices }, { isCurrent = () => true } = {}) {
		if (disposed || !isCurrent()) return false;
		if (typeof name !== 'string' || !Array.isArray(voices))
			throw TypeError('VGM sounds need a source name and voice array.');
		if (!voices.length) return { paths: [], directory: null };
		await api.ready;
		if (disposed || busy || !isCurrent()) return false;
		const token = ++operation,
			current = () => !disposed && token === operation && isCurrent();
		if (!current() || (await flushCode()) === false || !current()) return false;
		const { entries, directory } = aswanVgmSoundEntries(project, { name, voices });
		const candidate = createAswanCodeProject({ snapshot: project.snapshot() });
		candidate.importFiles(entries);
		if (!current()) return false;
		setBusy(true, { lockMain: false });
		try {
			project.restore(candidate.snapshot());
			reveal(directory);
			expanded.set(directory, true);
			setVisible(true);
			render();
			// Once committed, a late cancellation cannot turn this saved batch into
			// an apparent failure. The importer still fences its own later UI work.
			const result = { paths: entries.map((entry) => entry.path), directory };
			const persisted = await persistCode();
			say(
				`Saved ${entries.length} VGM sound(s) to ${directory}. Choose a preset in Files to load it.` +
					(persisted === false
						? ' Local save unavailable; export the project to keep the sounds.'
						: ''),
			);
			return result;
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
		await flushCode();
		if (disposed || token !== operation) return false;
		setBusy(true);
		try {
			if ((await code?.workspaceReplaced?.()) === false || disposed || token !== operation)
				return false;
			await onBeforeWorkspaceReplace();
			if (disposed || token !== operation) return false;
			const applied = await applySettings(candidate.savedSettings ?? candidate.settings, {
				record: false, source: 'restore', load: true, applyAudio: true, displayPreset: candidate.settings,
				isCurrent: () => !disposed && token === operation,
			});
			if (applied === false || disposed || token !== operation) return false;
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
			say('ASWAN project imported. Code was not run.');
			return true;
		} finally {
			if (!disposed) setBusy(false);
		}
	}
	async function exportProject() {
		await api.ready;
		await flushCode();
		project.setSettings(getSettings());
		return project.exportProject();
	}
	async function move(source, destination, copy = false) {
		if (disposed || busy) return false;
		const token = ++operation;
		await flushCode();
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
					isAswanCodePath(destination + file.path.slice(source.length)) &&
					(file.type !== 'text' || file.data.length > ASWAN_PROJECT_CODE_LENGTH)
				)
					throw Error('JavaScript files must be UTF-8 text no larger than 2 MiB.');
			let copied = null;
			if (copy) {
				const candidate = createAswanCodeProject({ snapshot: project.snapshot() });
				transferVirtualFiles(candidate.fs, source, destination, { copy: true });
				candidate.restore(candidate.snapshot());
				copied = candidate.fs.snapshot();
			}
			const runningPath = executionPath(),
				movedCodePath = inside(runningPath, source)
					? destination + runningPath.slice(source.length)
					: null;
			if (project.autoApply && !copy && movedCodePath && !isAswanCodePath(movedCodePath))
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
				if (!project.autoApply) {
					const original = savedPath(source), prior = pendingMoves();
					const moves = prior.filter(([, target]) => !inside(target, source));
					if (original !== destination && hasPath(project.savedFs, original)) moves.push([original, destination]);
					project.setPendingMoves(moves);
				}
				if (inside(soundPath(), source)) project.setActiveSoundPath(destination + soundPath().slice(source.length));
				if (inside(project.selectedPath, source))
					project.select(destination + project.selectedPath.slice(source.length));
				if (project.autoApply) code?.pathChanged?.(source, destination);
				else code?.pathChanged?.(source, destination, {preserveExecution: true});
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
		await flushCode();
		if (disposed || token !== operation) return false;
		path = allowed(path);
		setBusy(true);
		try {
			if (project.autoApply && inside(executionPath(), path)) await code.stop();
			if (disposed || token !== operation) return false;
			if (inside(project.selectedPath, path)) project.select(null);
			project.fs.remove(path, { recursive: true });
			if (soundPath() && !project.fs.has(soundPath()) && !project.savedFs.has(soundPath())) project.setActiveSoundPath(null);
			if (project.autoApply) code?.pathChanged?.(path, null);
			else code?.pathChanged?.(path, null, {preserveExecution: true});
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
		await flushCode();
		if (disposed || token !== operation) return false;
		if (occupied(project, path)) throw Error('That path already exists.');
		setBusy(true, { lockMain: false });
		try {
			const candidate = createAswanCodeProject({ snapshot: project.snapshot() });
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
				if (!/\.aswan\.json$/i.test(requestedPath))
					throw Error('Use a .aswan.json instrument file name.');
				if (occupied(project, requestedPath)) throw Error('That path already exists.');
			}
			const sound = readAswanProjectSound(value === undefined ? getSettings() : value);
			if (!sound) throw Error('Expected a ASWAN instrument.');
			if (disposed || token !== operation) return false;
			const path = requestedPath ?? newSoundPath(project, sound.name);
			if (occupied(project, path)) throw Error('That path already exists.');
			if (requestedPath !== undefined) {
				sound.name = basename(path).replace(/\.aswan\.json$/i, '');
				readAswanProjectSound(sound);
			}
			// importFiles validates its candidate before touching this workspace.
			// Name / size failures must keep both existing files and selection.
			const candidate = createAswanCodeProject({snapshot: project.snapshot()});
			candidate.importFiles([{path, type: 'text', data: JSON.stringify(sound, null, 2) + '\n'}]);
			candidate.saveFiles([path]);
			if (value === undefined) {
				candidate.setActiveSoundPath(path);
				candidate.setSettings(sound); candidate.setSavedSettings(sound);
				if (!project.autoApply && (await applySettings(sound, {record: false, source: 'save', load: false,
					applyAudio: true, displayPreset: sound, isCurrent: () => !disposed && token === operation})) === false) return false;
			}
			if (disposed || token !== operation) return false;
			project.restore(candidate.snapshot());
			project.select(path);
			reveal(path);
			setVisible(true);
			render();
			await code?.openFile?.(path, { show: false });
			if (disposed || token !== operation) return false;
			const persisted = await persistCode();
			say(
				(value === undefined
					? 'Current ASWAN instrument saved to '
					: 'Selected ASWAN sound saved to ') +
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
			if ((await flushCode()) === false || !current()) return false;
			const original = readAswanProjectSound(getSettings()),
				captured = readAswanProjectSound(value);
			if (!original || !captured)
				throw Error('Capture requires complete ASWAN instrument presets.');
			const candidate = createAswanCodeProject({ snapshot: project.snapshot() });
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
			candidate.saveFiles([originalPath, capturedPath]);
			candidate.setSettings(captured); candidate.setSavedSettings(captured);
			candidate.setActiveSoundPath(capturedPath);
			candidate.select(capturedPath);
			if (!current()) return false;
			if (
				(await apply(readAswanProjectSound(captured), { isCurrent: current })) === false ||
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
				preset: readAswanProjectSound(captured),
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
			instrument: 'New instrument · .aswan.json path',
			folder: 'New folder path',
			new: 'New JavaScript file path',
		}[action];
		nameInput.value =
			action === 'new'
				? `${directory === '/' ? '' : directory}/untitled.js`
				: action === 'folder'
					? `${directory === '/' ? '' : directory}/New folder/`
					: action === 'instrument'
						? `${directory === '/' ? '/presets' : directory}/Untitled.aswan.json`
						: (path ?? '');
		nameInput.readOnly = action === 'delete';
		confirm.textContent =
			action === 'delete' ? 'Delete' : action === 'rename' ? 'Rename' : 'Create';
		dialog.showModal();
		nameInput.focus();
		nameInput.select?.();
	}
	const contextMenu = installAswanFileContextMenu({
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
					if (!isAswanCodePath(value)) throw Error('Use a .js or .mjs file name.');
					return createFile(value);
				}
				if (action === 'folder') return createFile(value.replace(/\/$/, '') + '/');
				if (action === 'instrument') return saveSound({ path: value });
				return action === 'rename' ? move(path, value) : remove(path);
			})
			.catch(report);
	});
	listen(cancel, 'click', () => dialog.close());
	listen(presetSelect, 'change', () => {
		const choice = presetOptions.get(presetSelect.value);
		presetSelect.blur();
		if (choice) void selectFile(choice.path).catch(report);
	});
	for (const [id, fn] of [
		['aswanFileNewButton', () => ask('new')],
		['aswanFileRenameButton', () => ask('rename')],
		['aswanFileDeleteButton', () => ask('delete')],
		[
			'aswanFileImportButton',
			() => {
				setVisible(true);
				fileInput.value = '';
				fileInput.click();
			},
		],
		[
			'aswanProjectImportButton',
			() => {
				setVisible(true);
				projectInput.value = '';
				projectInput.click();
			},
		],
		['aswanFileSaveSoundButton', () => void saveSound().catch(report)],
		[
			'aswanProjectExportButton',
			() =>
				void exportProject()
					.then((bytes) =>
						download(bytes, project.cassetteName + '.cassette.zip', 'application/zip'),
					)
					.catch(report),
		],
		[
			'aswanFileExportButton',
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
	listen(autoToggle, 'change', () => { void setAutoApply(autoToggle.checked).catch(report); autoToggle.blur(); });
	for (const [id, action] of [
		['aswanFileSaveButton', () => saveCurrent()], ['aswanFileSaveAllButton', () => saveCurrent(true)],
		['aswanFileDiscardButton', () => discardCurrent()], ['aswanFileDiscardAllButton', () => discardCurrent(true)],
	]) listen(buttons.get(id), 'click', () => void action().catch(report));
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
				!event.altKey && !event.shiftKey && !event.isComposing &&
				event.key?.toLowerCase() === 's' && !doc.querySelector?.('dialog[open]')
			) {
				event.preventDefault();
				event.stopPropagation();
				event.stopImmediatePropagation?.();
				if (!event.repeat) void saveCurrent().catch(report);
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
		move,
		duplicate,
		remove,
		saveSound,
		importVgm,
		saveSongSource,
		saveVgmSounds,
		saveCapturedSound,
		isAutoApply: () => project.autoApply,
		getSavedEditorPreset: () => project.savedSettings,
		recordSoundEdit, validateSoundEdit, canEditSound, adoptExternalSound, codeEdited, recoverCodeState,
		saveCurrent, saveAll: () => saveCurrent(true),
		discardCurrent, discardAll: () => discardCurrent(true), setAutoApply,
		markSoundDirty(value = getSettings()) {
			if (disposed) return false;
			if (busy || restoring) {
				editRevision++; project.setSettings(value);
				if (project.autoApply) project.setSavedSettings(value);
				return false;
			}
			return recordSoundEdit(value);
		},
		async dispose() {
			if (disposed) return;
			operation++;
			contextMenu.dispose();
			await flushCode();
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
		try {
			const saved = await store.read();
			if (disposed) return;
			if (saved) {
				const candidate = createAswanCodeProject({ snapshot: saved });
				if (before !== editRevision) { candidate.setSettings(getSettings()); if (candidate.autoApply) candidate.setSavedSettings(getSettings()); }
				restoring = true;
				try {
					await onBeforeWorkspaceReplace();
					if (disposed) return;
					if (before !== editRevision) { candidate.setSettings(getSettings()); if (candidate.autoApply) candidate.setSavedSettings(getSettings()); }
					const applied = await applySettings(candidate.savedSettings, {record: false, source: 'restore', load: true, applyAudio: true, displayPreset: candidate.settings, isCurrent: () => !disposed });
					if (applied === false) throw Error('Sound restoration was cancelled.');
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
		} catch (error) {
			report(Error('Local project restore failed; current files kept. ' + error.message));
		} finally {
			if (!disposed) {
				setBusy(false);
				if (persistenceReady && before !== editRevision) schedule();
			}
		}
	});
	if (main) main.inert = true;
	render();
	return api;
}

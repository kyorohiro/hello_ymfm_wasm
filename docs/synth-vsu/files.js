// SPDX-License-Identifier: BSD-3-Clause
import { isCheckpointPath, transferVirtualFiles } from '../js/tetorica_virtual_files/filesystem.js';
import { dirname, normalizeVirtualPath } from '../js/tetorica_virtual_files/path.js';
import { createVirtualFileWorkspace } from '../js/tetorica_virtual_files/workspace.js';
import { createPlaygroundCassetteZip, loadPlaygroundCassette } from '../playground/playground_cassette.js';
import { renderFileTree } from '../playground/playground_file_tree.js';
import { installSpuFileContextMenu } from '../synth-spu/file_context_menu.js';
import { createSynthCodeProject } from '../synth/synth_code_project.js';
import { setupSynthMenu } from '../synth/synth_menu.js';
import { createSynthProjectStore } from '../synth/synth_project_store.js';
import { looksLikeGzip } from '../js/vgm_file.js';
import { createDefaultVsuPatch } from './patch.js?v=vsu-noise';
import { loadVsuVgm } from './vgm.js';
import { extractVsuVgmPresets } from './vgm-presets.js?v=vsu-noise';

const ENTRY_PATH = '/index.js';
const PROJECT_FORMAT = 'tetorica-vsu-project';
const CASSETTE_NAME = 'tetorica-vsu.cassette.zip';
const STORAGE_NAME = 'tetorica-vsu-synth-project';
const MAX_BYTES = 16 * 1024 * 1024;
const JS_PATH = /\.m?js$/i;
const PATCH_PATH = /\.vsu\.json$/i;
const VGM_PATH = /\.vg[mz]$/i;
const FILE_SUFFIX = /\.(?:vsu\.json|m?js|vg[mz])$/i;
const VGM_DIRECTORY = '/vgm';
const PRESET_DIRECTORY = '/presets';
const decoder = new TextDecoder('utf-8', { fatal: true });
const encoder = new TextEncoder();

const isInside = (path, parent) => path === parent || path?.startsWith(parent + '/');
const basename = path => path.slice(path.lastIndexOf('/') + 1);
const join = (directory, name) => (directory === '/' ? '' : directory) + '/' + name;

function userPath(path) {
  const normalized = normalizeVirtualPath(path);
  if (normalized !== path || normalized === '/' || isCheckpointPath(path) ||
      ['/metadata.json', '/cassette.metadata.js'].includes(path) ||
      path.split('/').includes('__proto__') || /[\x00-\x1f\x7f]/.test(path)) {
    throw new Error('Choose a valid project file or folder name.');
  }
  return path;
}

function namedPath(directory, name, extension, kind) {
  name = name.trim();
  if (!name || name === '.' || name === '..' || /[\\/]/.test(name))
    throw new Error('Enter a file or folder name.');
  if (extension && !kind.test(name)) name += extension;
  return userPath(join(directory, name));
}

function parsePatch(text, validatePatch) {
  return validatePatch(JSON.parse(text));
}

function fileBytes(entries) {
  return entries.reduce((size, { data }) => size +
    (typeof data === 'string' ? encoder.encode(data).byteLength : data.byteLength), 0);
}

function checkSize(entries) {
  if (fileBytes(entries) > MAX_BYTES) throw new Error('Project files exceed the 16 MiB limit.');
}

function validateEntries(entries, validatePatch) {
  for (const { path, data } of entries) {
    userPath(path);
    if (VGM_PATH.test(path)) {
      if (!(data instanceof Uint8Array) || data.byteLength < 10 ||
          (!looksLikeGzip(data) && ![0x56, 0x67, 0x6d, 0x20].every((byte, index) => byte === data[index])))
        throw new Error('Choose a VGM or VGZ file.');
    } else {
      if (typeof data !== 'string' || (!PATCH_PATH.test(path) && !JS_PATH.test(path)))
        throw new Error('Choose a VSU patch, JavaScript, VGM or VGZ file.');
      if (PATCH_PATH.test(path)) parsePatch(data, validatePatch);
    }
  }
  checkSize(entries);
}

async function validateVgmInputs(entries, activePath, onPlan) {
  let activePlan;
  for (const { path, data } of entries) {
    if (!VGM_PATH.test(path)) continue;
    try {
      const plan = await loadVsuVgm(data);
      if (path === activePath) activePlan = plan;
      if (onPlan) await onPlan(path, plan);
    } catch (error) {
      throw new Error(basename(path) + ': ' + error.message, { cause: error });
    }
  }
  return activePlan;
}

const foldedPath = path => path.normalize('NFC').toLowerCase();

function presetFolder(source, paths) {
  const cleaned = basename(source).replace(VGM_PATH, '').normalize('NFC')
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*\ud800-\udfff]/gu, '_').trim().replace(/^\.+/, '');
  const base = Array.from(cleaned).slice(0, 48).join('').replace(/[. ]+$/, '') || 'Untitled';
  const stem = /^(?:__proto__|con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(base.split('.')[0]) ? '_' + base : base;
  let index = 1, folder = join(PRESET_DIRECTORY, stem);
  while (paths.has(foldedPath(folder))) folder = join(PRESET_DIRECTORY, `${stem} (${++index})`);
  paths.add(foldedPath(folder));
  return folder;
}

function presetEntry(folder, { channel, patch }, index, validatePatch) {
  const tone = validatePatch(patch);
  const labels = { sweep: 'Sweep', modulation: 'Modulation' };
  const kind = channel === 5 ? 'Noise' : channel === 4 ? labels[tone.ch5.mode] ?? 'Wave' : 'Wave';
  const fileName = `${String(index + 1).padStart(3, '0')} ${kind} CH${channel + 1}.vsu.json`;
  return { path: userPath(join(folder, fileName)), data: JSON.stringify(tone, null, 2) + '\n' };
}

function base64(bytes) {
  let text = '';
  for (let offset = 0; offset < bytes.length; offset += 32768)
    text += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
  return btoa(text);
}

function validateLayer(layer, validatePatch) {
  if (!Array.isArray(layer?.files) || !Array.isArray(layer?.directories))
    throw new Error('Invalid VSU project file list.');
  for (const directory of layer.directories) if (directory !== '/') userPath(directory);
  validateEntries(layer.files, validatePatch);
}

function checkSelections(fs, view = {}) {
  view ??= {};
  const valid = (path, kind) => typeof path === 'string' && kind.test(path) && fs.has(path);
  const codePath = valid(view.codePath, JS_PATH) ? view.codePath :
    fs.list().find(file => JS_PATH.test(file.path))?.path ?? null;
  return {
    codePath,
    activePatch: valid(view.activePatch, PATCH_PATH) ? view.activePatch : null,
    activeVgm: valid(view.activeVgm, VGM_PATH) ? view.activeVgm : null,
    selected: typeof view.selected === 'string' && (fs.has(view.selected) || fs.listDirectories().includes(view.selected))
      ? view.selected : codePath,
    visible: view.visible === true,
  };
}

export function setupVsuFiles({ panel, toggle, getPatch, applyPatch, validatePatch, getCode, setCode, starterCode, setStatus,
  openVgm = async () => {}, onVgmFilesChanged = () => {}, onVgmError = () => {}, onVgmAvailability = () => {} }) {
  const doc = panel.ownerDocument, win = doc.defaultView;
  const starterFiles = [{ path: ENTRY_PATH, data: starterCode }];
  const workspace = createVirtualFileWorkspace(starterFiles, { autoSave: false });
  const fs = workspace.working;
  const codeProject = createSynthCodeProject({ fs });
  const store = createSynthProjectStore({
    indexedDB: win.indexedDB, name: STORAGE_NAME,
    readFallback: () => JSON.parse(win.localStorage.getItem(STORAGE_NAME), (_key, value) =>
      typeof value?.vsuBytes === 'string' ? Uint8Array.from(atob(value.vsuBytes), char => char.charCodeAt(0)) : value),
    writeFallback(snapshot) {
      win.localStorage.setItem(STORAGE_NAME, JSON.stringify(snapshot, (_key, value) =>
        value instanceof Uint8Array ? { vsuBytes: base64(value) } : value));
      return true;
    },
  });
  const expanded = new Map([['/patches', true], [PRESET_DIRECTORY, true], [VGM_DIRECTORY, true]]);
  let selected = ENTRY_PATH, codePath = ENTRY_PATH, activePatch = null, activeVgm = null;
  let vgmFiles = [];
  let loading = true, busy = false, draftTimer = null;
  let renderedEntries = '';
  const report = error => setStatus(error?.message || String(error));
  function reportVgm(error) {
    report(error);
    onVgmError(error);
  }

  function element(tag, properties = {}) {
    return Object.assign(doc.createElement(tag), properties);
  }

  function button(id, label, action) {
    const result = element('button', { id, type: 'button', textContent: label });
    result.addEventListener('click', () => void operation(action));
    return result;
  }

  const heading = element('div', { className: 'vsu-files-heading' });
  const actions = element('div', { className: 'vsu-files-actions' });
  const saveButton = button('vsuFileSave', 'Save', save);
  saveButton.title = 'Save the selected file (Ctrl/Cmd+S)';
  saveButton.setAttribute('aria-keyshortcuts', 'Control+S Meta+S');
  const newPatch = () => saveNewPatch('/patches');
  const patchButton = button('vsuFilePatch', '＋ Patch', newPatch);
  const codeButton = button('vsuFileNew', '＋ JS', newCode);
  const saveControls = element('div', { className: 'vsu-files-save-controls' });
  saveControls.setAttribute('role', 'group');
  saveControls.setAttribute('aria-label', 'File saving');
  saveControls.append(saveButton);
  actions.append(patchButton, codeButton);
  heading.append(element('h2', { textContent: 'FILES' }), actions);

  const menuActions = doc.getElementById('vsuFilesMenuActions');
  function menuSection(title, ...commands) {
    const section = element('section', { className: 'vsu-menu-section' });
    if (title) section.append(element('h2', { textContent: title }));
    for (const command of commands) command.setAttribute('data-close-synth-menu', '');
    section.append(...commands);
    menuActions.append(section);
  }
  const menuCassetteButton = button('vsuMenuNewCassette', 'Cassette · ZIP', newCassette);
  const menuSaveButton = button('vsuMenuSave', 'Save', save);
  const fileInput = element('input', { id: 'vsuFileImportInput', type: 'file', multiple: true, hidden: true });
  const vgmInput = element('input', { id: 'vsuVgmImportInput', type: 'file', multiple: true, hidden: true });
  vgmInput.accept = '.vgm,.vgz';
  fileInput.accept = '.vsu.json,.json,.js,.mjs,.zip,' + vgmInput.accept;
  const importButton = element('button', { id: 'vsuFileImport', type: 'button', textContent: 'Patch / JavaScript / Cassette…' });
  importButton.addEventListener('click', () => { fileInput.value = ''; fileInput.click(); });
  const vgmImportButton = element('button', { id: 'vsuFileImportVgm', type: 'button', textContent: 'VGM / VGZ…' });
  vgmImportButton.addEventListener('click', requestVgmImport);
  const exportButton = button('vsuFileExport', 'Cassette · ZIP', downloadCassette);
  exportButton.title = 'Export the files in this project as a Cassette';
  menuSection('New', menuCassetteButton);
  menuSection('Import', vgmImportButton, importButton);
  menuSection('Export', exportButton);
  menuSection(null, menuSaveButton);
  const tree = element('div', { id: 'vsuFilesTree' });
  panel.classList.add('panel', 'vsu-files');
  panel.append(heading, saveControls, tree, fileInput, vgmInput);
  setupSynthMenu({ document: doc, window: win });

  const dialog = element('dialog', { className: 'vsu-files-dialog' });
  const dialogForm = element('form', { method: 'dialog' });
  const dialogTitle = element('h2', { id: 'vsuFilesDialogTitle' });
  const name = element('input', { id: 'vsuFileName', type: 'text', required: true, maxLength: 128 });
  const nameLabel = element('label', { textContent: 'Name' });
  nameLabel.append(name);
  const dialogActions = element('div', { className: 'vsu-files-actions' });
  const cancel = element('button', { type: 'button', textContent: 'Cancel' });
  cancel.addEventListener('click', () => dialog.close());
  const confirm = element('button', { id: 'vsuFileConfirm', type: 'submit', value: 'ok', className: 'primary', textContent: 'OK' });
  dialogActions.append(cancel, confirm);
  dialogForm.append(dialogTitle, nameLabel, dialogActions);
  dialog.append(dialogForm);
  dialog.setAttribute('aria-labelledby', dialogTitle.id);
  doc.body.append(dialog);

  const cassetteDialog = element('dialog', { className: 'vsu-files-dialog', id: 'vsuNewCassetteDialog' });
  const cassetteForm = element('form', { method: 'dialog' });
  const cassetteTitle = element('h2', { id: 'vsuNewCassetteTitle', textContent: 'Create a new Cassette?' });
  const cassetteDescription = element('p', { id: 'vsuNewCassetteDescription',
    textContent: 'This replaces the current browser project and stops its performance. The new project starts with the default sound and starter Code. Export first to keep your current project.',
  });
  const cassetteActions = element('div', { className: 'vsu-files-actions' });
  const cassetteCancel = element('button', { type: 'submit', value: 'cancel', textContent: 'Cancel' });
  cassetteActions.append(cassetteCancel,
    element('button', { type: 'submit', value: 'export', textContent: 'Export current & create' }),
    element('button', { type: 'submit', value: 'new', textContent: 'Create without export' }));
  cassetteForm.append(cassetteTitle, cassetteDescription, cassetteActions);
  cassetteDialog.append(cassetteForm);
  cassetteDialog.setAttribute('aria-labelledby', cassetteTitle.id);
  cassetteDialog.setAttribute('aria-describedby', cassetteDescription.id);
  doc.body.append(cassetteDialog);

  function askName(title, suggestion) {
    dialogTitle.textContent = title;
    name.value = suggestion;
    dialog.returnValue = '';
    dialog.showModal();
    name.focus();
    name.select();
    return new Promise(resolve => {
      dialog.addEventListener('close', () => resolve(dialog.returnValue === 'ok' ? name.value : null), { once: true });
    });
  }

  function show(visible) {
    panel.hidden = !visible;
    toggle.setAttribute('aria-expanded', String(visible));
    toggle.setAttribute('aria-pressed', String(visible));
  }

  function snapshot() {
    return {
      format: PROJECT_FORMAT, version: 1, workspace: workspace.snapshot(),
      view: { codePath, activePatch, activeVgm, selected, visible: !panel.hidden },
    };
  }

  function persist() {
    clearTimeout(draftTimer);
    draftTimer = null;
    return store.write(snapshot());
  }

  function queueDraft() {
    if (loading) return;
    clearTimeout(draftTimer);
    draftTimer = win.setTimeout(() => void persist().catch(report), 180);
  }

  function refresh() {
    const directories = new Set(fs.listDirectories());
    const entries = [];
    for (const directory of directories) {
      if (directory !== '/') entries.push({ path: directory, type: 'directory' });
      for (const name of fs.readdir(directory)) {
        const path = join(directory, name);
        if (!directories.has(path)) entries.push({ path, type: 'file' });
      }
    }
    const structure = JSON.stringify(entries.map(({ path, type }) => [path, type]));
    if (structure !== renderedEntries) {
      renderFileTree(tree, entries, {
        selectedPath: selected, expanded,
        onOpen: path => void operation(() => open(path)),
        onImport: (files, directory) => void operation(() => importFiles(files, directory)),
        onTransfer: (from, to, copy) => void operation(() => transfer(from, to, copy)),
      });
      tree.querySelector('.file-tree-root').tabIndex = 0;
      renderedEntries = structure;
      const paths = entries.filter(entry => entry.type === 'file' && VGM_PATH.test(entry.path)).map(({ path }) => path);
      if (paths.length !== vgmFiles.length || paths.some((path, i) => path !== vgmFiles[i])) {
        vgmFiles = paths;
        onVgmFilesChanged(vgmFiles.slice());
      }
    }
    const dirty = new Set(workspace.getDirtyPaths());
    for (const row of tree.querySelectorAll('[data-file-path]')) {
      const path = row.getAttribute('data-file-path');
      row.setAttribute('aria-current', String(path === selected));
      row.toggleAttribute('data-modified', dirty.has(path));
      if (row.matches('summary') && expanded.has(path)) row.parentElement.open = expanded.get(path);
    }
    for (const command of [patchButton, codeButton, menuCassetteButton, importButton, vgmImportButton, exportButton])
      command.disabled = loading || busy;
    saveButton.disabled = menuSaveButton.disabled = loading || busy || !saveTarget();
    onVgmAvailability(!loading && !busy);
  }

  function select(path) {
    selected = path;
    for (let parent = dirname(path); parent !== '/'; parent = dirname(parent)) expanded.set(parent, true);
  }

  async function openCode(path, { show = true, stop = show } = {}) {
    await setCode(path ? fs.get(path).data : '', path ?? ENTRY_PATH, { show, stop });
    codePath = path;
  }

  async function openReference(path, { show = true, plan } = {}) {
    const file = path ? fs.get(path) : null;
    if (path && (!file || file.type !== 'binary' || !VGM_PATH.test(path)))
      throw new Error('Choose a VGM or VGZ in Files.');
    await openVgm(file?.data ?? null, path, { show, plan });
    activeVgm = path;
  }

  async function open(path, plan) {
    const file = fs.get(path);
    if (!file) return;
    if (PATCH_PATH.test(path)) {
      await applyPatch(parsePatch(file.data, validatePatch));
      activePatch = path;
    } else if (VGM_PATH.test(path)) await openReference(path, { plan });
    else await openCode(path);
    select(path);
    await persist();
  }

  function markCodeEdited() {
    if (loading) return false;
    const source = getCode();
    const path = codePath ?? ENTRY_PATH;
    if (fs.get(path)?.data === source) return true;
    try {
      checkSize([...fs.list().filter(file => file.path !== path), { data: source }]);
      fs.writeFile(userPath(path), source);
      codePath = path;
      refresh();
      queueDraft();
      return true;
    } catch (error) {
      report(error);
      return false;
    }
  }

  function occupied(path) {
    return [fs, workspace.saved].some(layer => layer.has(path) || layer.listDirectories().includes(path));
  }

  function requireNew(path) {
    if (occupied(path)) throw new Error(path + ' already exists.');
  }

  function updateFiles(action) {
    const next = createVirtualFileWorkspace();
    next.restore(workspace.snapshot());
    action(next.working, next);
    checkSize(next.working.list());
    checkSize(next.saved.list());
    workspace.restore(next.snapshot());
  }

  function writeAccepted(entries) {
    updateFiles((files, next) => {
      files.writeFiles(entries);
      next.saveMany(entries.map(({ path }) => path));
    });
  }

  async function saveSelectedPatch(path) {
    const data = JSON.stringify(validatePatch(getPatch()), null, 2) + '\n';
    writeAccepted([{ path, data }]);
    activePatch = path;
    select(path);
    await persist();
    setStatus('Saved ' + basename(path) + '.');
  }

  async function saveNewPatch(directory = '/') {
    const label = await askName('Save patch…', 'untitled');
    if (label === null) return;
    const path = namedPath(directory, label, '.vsu.json', PATCH_PATH);
    requireNew(path);
    await saveSelectedPatch(path);
  }

  async function newCode(directory = '/') {
    const label = await askName('New JavaScript file…', 'untitled');
    if (label === null) return;
    const path = namedPath(directory, label, '.js', JS_PATH);
    requireNew(path);
    writeAccepted([{ path, data: '' }]);
    select(path);
    await openCode(path);
    await persist();
    setStatus('Created ' + basename(path) + '.');
  }

  function saveTarget(preferCode) {
    if (preferCode) return codePath;
    if (PATCH_PATH.test(selected ?? '')) return selected === activePatch ? selected : null;
    if (VGM_PATH.test(selected ?? '')) return null;
    return JS_PATH.test(selected ?? '') ? selected : codePath;
  }

  async function save(preferCode = false) {
    const path = saveTarget(preferCode);
    if (!path) return;
    if (PATCH_PATH.test(path)) return saveSelectedPatch(path);
    if (path === codePath) markCodeEdited();
    updateFiles((_files, next) => next.save(path));
    await persist();
    setStatus('Saved ' + basename(path) + '.');
  }

  function renamedPath(path, from, to) {
    return isInside(path, from) ? to + path.slice(from.length) : path;
  }

  async function transfer(from, to, copy) {
    userPath(from);
    userPath(to);
    if (from === to) return;
    requireNew(to);
    // A copied working draft becomes a new accepted file. A move retains the
    // accepted older bytes at the new path so its pending edits remain marked.
    updateFiles((files, next) => {
      transferVirtualFiles(files, from, to, { copy });
      if (copy) { next.save(to); return; }
      const state = next.snapshot();
      const baseline = createVirtualFileWorkspace();
      baseline.working.restore(state.saved);
      if (baseline.working.has(from) || baseline.working.listDirectories().includes(from))
        transferVirtualFiles(baseline.working, from, to);
      next.restore({ ...state, saved: baseline.working.snapshot() });
    });
    if (!copy) {
      const movedCode = renamedPath(codePath, from, to);
      if (movedCode !== codePath) await openCode(movedCode, { show: false, stop: true });
      activePatch = renamedPath(activePatch, from, to);
      const movedVgm = renamedPath(activeVgm, from, to);
      if (movedVgm !== activeVgm) await openReference(movedVgm, { show: false });
    }
    select(to);
    await persist();
    setStatus((copy ? 'Duplicated ' : 'Moved ') + basename(from) + '.');
  }

  function targetDirectory(path) {
    return fs.listDirectories().includes(path) ? path : dirname(path);
  }

  async function rename(path) {
    const label = await askName('Rename…', basename(path));
    if (label === null) return;
    const extension = fs.has(path) ? path.match(FILE_SUFFIX)[0] : null;
    const kind = VGM_PATH.test(path) ? VGM_PATH : JS_PATH.test(path) ? JS_PATH : PATCH_PATH;
    const destination = namedPath(dirname(path), label, extension, kind);
    await transfer(path, destination, false);
  }

  async function duplicate(path) {
    const suffix = fs.has(path) ? path.match(FILE_SUFFIX)[0] : '';
    const original = basename(path).slice(0, basename(path).length - suffix.length);
    let name = original + ' copy' + suffix;
    const directory = dirname(path);
    for (let n = 2; occupied(join(directory, name)); n++) name = original + ' copy ' + n + suffix;
    await transfer(path, join(directory, name), true);
  }

  async function remove(path) {
    if (!win.confirm('Delete ' + basename(path) + '?')) return;
    fs.remove(path, { recursive: true });
    if (workspace.saved.has(path) || workspace.saved.listDirectories().includes(path)) workspace.save(path);
    if (isInside(codePath, path)) await openCode(checkSelections(fs).codePath, { show: false, stop: true });
    if (isInside(activePatch, path)) activePatch = null;
    if (isInside(activeVgm, path)) await openReference(null, { show: false });
    selected = codePath;
    await persist();
    setStatus('Deleted ' + basename(path) + '.');
  }

  async function newFolder(path) {
    const label = await askName('New folder…', 'untitled');
    if (label === null) return;
    const directory = namedPath(targetDirectory(path), label);
    requireNew(directory);
    fs.mkdir(directory);
    workspace.save(directory);
    select(directory);
    await persist();
    setStatus('Created ' + basename(directory) + '.');
  }

  function downloadCassette() {
    const bytes = createPlaygroundCassetteZip(fs.list(), {
      directories: fs.listDirectories(),
      metadata: { vsu: { format: PROJECT_FORMAT, version: 1, view: snapshot().view } },
    });
    const url = win.URL.createObjectURL(new win.Blob([bytes], { type: 'application/zip' }));
    element('a', { href: url, download: CASSETTE_NAME }).click();
    win.setTimeout(() => win.URL.revokeObjectURL(url), 1000);
    setStatus('Exported Cassette.');
  }

  async function newCassette() {
    cassetteDialog.returnValue = '';
    cassetteDialog.showModal();
    cassetteCancel.focus();
    const result = await new Promise(resolve => {
      cassetteDialog.addEventListener('close', () => resolve(cassetteDialog.returnValue), { once: true });
    });
    if (result !== 'new' && result !== 'export') return;

    if ((codePath || getCode()) && !markCodeEdited()) return;
    const previous = snapshot(), previousPatch = getPatch();
    const fresh = createVirtualFileWorkspace(starterFiles, { autoSave: false });
    const view = { codePath: ENTRY_PATH, selected: ENTRY_PATH, visible: true };
    const patch = { ...createDefaultVsuPatch(), preferredChannel: 0, preferredSource: 'wave' };
    const main = panel.closest('main');
    const wasInert = main.inert;
    let replacing = false;
    main.inert = true;
    try {
      if (result === 'export') downloadCassette();
      if (!await persist()) throw new Error('Local project storage is unavailable.');
      replacing = true;
      await restore({ ...previous, workspace: fresh.snapshot(), view }, { stop: true, patch });
      if (!await persist()) throw new Error('Local project storage is unavailable.');
    } catch (error) {
      if (replacing) await restore(previous, { stop: true, patch: previousPatch });
      throw new Error('Could not create Cassette. The previous project was kept. ' + error.message, { cause: error });
    } finally {
      main.inert = wasInert;
    }
    setStatus('New Cassette created. Starter Code is ready to edit.');
  }

  async function importFiles(files, directory = '/', { reference = false } = {}) {
    if (!files.length) return;
    if (files.reduce((sum, file) => sum + file.size, 0) > MAX_BYTES)
      throw new Error('Selected files exceed the 16 MiB limit.');
    if (reference && files.some(file => !VGM_PATH.test(file.name))) throw new Error('Choose VGM or VGZ files.');
    if (files.some(file => /\.zip$/i.test(file.name))) {
      if (files.length !== 1) throw new Error('Import one Cassette at a time.');
      await importCassette(files[0]);
      return;
    }
    const incoming = await Promise.all(files.map(async file => {
      const filename = PATCH_PATH.test(file.name) ? file.name : file.name.replace(/\.json$/i, '.vsu.json');
      const path = namedPath(directory || '/', filename);
      const bytes = new Uint8Array(await file.arrayBuffer());
      return { path, data: VGM_PATH.test(path) ? bytes : decoder.decode(bytes) };
    }));
    const paths = new Set();
    for (const entry of incoming) {
      requireNew(entry.path);
      if (paths.has(entry.path)) throw new Error('Choose one file named ' + basename(entry.path) + '.');
      paths.add(entry.path);
    }
    validateEntries(incoming, validatePatch);
    const firstSong = incoming.find(({ path }) => VGM_PATH.test(path));
    const activePath = firstSong?.path ?? incoming[0].path;
    let plan;
    const presets = [], folders = [];
    let capacityReached = false, extractionError = null;
    if (firstSong) {
      const working = fs.list(), saved = workspace.saved.list();
      let available = MAX_BYTES - fileBytes(incoming) - Math.max(fileBytes(working), fileBytes(saved));
      if (available < 0) throw new Error('Project files exceed the 16 MiB limit.');
      const occupied = new Set([...working.map(file => file.path), ...saved.map(file => file.path),
        ...fs.listDirectories(), ...workspace.saved.listDirectories(), ...paths].map(foldedPath));
      setStatus('Extracting VGM presets…');
      plan = await validateVgmInputs(incoming, activePath, async (path, parsed) => {
        if (available <= 0) { capacityReached = true; return; }
        try {
          const voices = await extractVsuVgmPresets(parsed);
          if (!voices.length) return;
          const folder = presetFolder(path, occupied);
          const files = voices.map((voice, index) => presetEntry(folder, voice, index, validatePatch));
          const start = presets.length;
          for (const entry of files) {
            const size = encoder.encode(entry.data).byteLength;
            if (size > available) { capacityReached = true; continue; }
            presets.push(entry);
            available -= size;
          }
          if (presets.length > start) folders.push(folder);
        } catch (error) {
          extractionError ??= basename(path) + ': ' + error.message;
        }
      });
    }
    writeAccepted([...incoming, ...presets]);
    if (folders.length) {
      expanded.set(PRESET_DIRECTORY, true);
      for (const folder of folders) expanded.set(folder, true);
    }
    show(true);
    await open(activePath, plan);
    const messages = ['Imported ' + incoming.length + (incoming.length === 1 ? ' file.' : ' files.')];
    if (presets.length) messages.push(`Saved ${presets.length} ${presets.length === 1 ? 'sound' : 'sounds'} in /presets.`);
    else if (firstSong && !capacityReached && !extractionError) messages.push('No playable VSU sounds found.');
    if (capacityReached) messages.push('Preset storage reached the 16 MiB project limit.');
    if (extractionError) messages.push('Preset extraction failed for ' + extractionError);
    setStatus(messages.join(' '));
  }

  async function importCassette(file) {
    const cassette = await loadPlaygroundCassette(await file.arrayBuffer());
    const metadata = cassette.metadata.vsu;
    if (metadata?.format !== PROJECT_FORMAT || metadata.version !== 1)
      throw new Error('Choose a Tetorica VSU Synth Cassette.');
    const entries = [...cassette.files].filter(([path]) => path !== 'metadata.json')
      .map(([path, data]) => ({ path: '/' + path, data: VGM_PATH.test(path) ? data : decoder.decode(data) }));
    validateEntries(entries, validatePatch);
    const plan = await validateVgmInputs(entries, metadata.view?.activeVgm);
    const fresh = createVirtualFileWorkspace([], { autoSave: false });
    fresh.working.replace(entries, cassette.directories);
    fresh.saveAll();
    if (!win.confirm('Replace the current project with this Cassette?')) return;
    await restore({ format: PROJECT_FORMAT, version: 1, workspace: fresh.snapshot(), view: metadata.view }, { stop: true, plan });
    show(true);
    await persist();
    setStatus('Imported Cassette.');
  }

  async function restore(state, { stop = false, plan, patch } = {}) {
    if (state.format !== PROJECT_FORMAT || state.version !== 1) throw new Error('Unsupported VSU project.');
    validateLayer(state.workspace?.working, validatePatch);
    validateLayer(state.workspace?.saved, validatePatch);
    const checked = createVirtualFileWorkspace();
    checked.restore(state.workspace);
    const savedView = checkSelections(checked.working, state.view);
    if (savedView.activeVgm && !plan) plan = await loadVsuVgm(checked.working.get(savedView.activeVgm).data);
    if (patch) await applyPatch(patch);
    else if (savedView.activePatch) await applyPatch(parsePatch(checked.working.get(savedView.activePatch).data, validatePatch));
    workspace.restore(checked.snapshot());
    activePatch = savedView.activePatch;
    await openCode(savedView.codePath, { show: false, stop });
    await openReference(savedView.activeVgm, { show: false, plan });
    if (savedView.selected) select(savedView.selected);
    else selected = null;
    show(savedView.visible);
  }

  async function operation(action, onError = report) {
    if (loading || busy) return;
    busy = true;
    refresh();
    try { await action(); }
    catch (error) { onError(error); }
    finally { busy = false; refresh(); }
  }

  const menuCommands = [
    { id: 'duplicate', label: 'Duplicate', action: duplicate },
    { id: 'rename', label: 'Rename…', action: rename },
    { id: 'delete', label: 'Delete', action: remove },
    { id: 'folder', label: 'New folder…', action: newFolder, root: true },
  ];
  const contextMenu = installSpuFileContextMenu({
    root: tree, document: doc, isBusy: () => busy || loading, onError: report,
    onTarget(path) { selected = path; refresh(); },
    getActions: path => menuCommands.map(({ id, label, root }) => ({ id, label, disabled: !root && path === '/' })),
    onAction: (id, path) => operation(() => menuCommands.find(command => command.id === id).action(path)),
  });
  contextMenu.element.id = 'vsuFileContextMenu';
  contextMenu.element.classList.add('vsu-file-context-menu');
  function requestVgmImport() {
    if (loading || busy) return;
    vgmInput.value = '';
    vgmInput.click();
  }
  const importVgm = files => operation(() => importFiles([...files], VGM_DIRECTORY, { reference: true }), reportVgm);
  vgmInput.addEventListener('change', () => void importVgm(vgmInput.files));
  fileInput.addEventListener('change', () => void operation(() => importFiles([...fileInput.files])));
  toggle.addEventListener('click', () => {
    show(panel.hidden);
    if (panel.hidden) contextMenu.close();
    queueDraft();
  });
  doc.addEventListener('keydown', event => {
    if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey || event.isComposing ||
        event.key.toLowerCase() !== 's' || loading || busy) return;
    if (panel.hidden && !event.target.closest('#codePanel')) return;
    event.preventDefault();
    void operation(() => save(Boolean(event.target.closest('#codePanel'))));
  });
  win.addEventListener('pagehide', () => {
    if (draftTimer !== null && !loading) void persist().catch(() => {});
  });

  refresh();
  const ready = store.read().then(state => state && restore(state))
    .catch(report).finally(() => { loading = false; refresh(); });
  return {
    ...codeProject, get codePath() { return codePath ?? ENTRY_PATH; }, markCodeEdited, ready,
    requestVgmImport, importVgm, listVgmFiles: () => vgmFiles.slice(),
    openVgm: path => operation(() => {
      path = userPath(path);
      if (!VGM_PATH.test(path) || !fs.has(path)) throw new Error('Choose a VGM or VGZ in Files.');
      return open(path);
    }, reportVgm),
  };
}

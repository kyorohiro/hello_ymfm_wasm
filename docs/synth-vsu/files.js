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

const ENTRY_PATH = '/index.js';
const PROJECT_FORMAT = 'tetorica-vsu-project';
const CASSETTE_NAME = 'tetorica-vsu.cassette.zip';
const STORAGE_NAME = 'tetorica-vsu-synth-project';
const MAX_BYTES = 16 * 1024 * 1024;
const JS_PATH = /\.m?js$/i;
const PATCH_PATH = /\.vsu\.json$/i;
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

function checkSize(entries) {
  let size = 0;
  for (const { data } of entries) {
    size += encoder.encode(data).byteLength;
    if (size > MAX_BYTES) throw new Error('Project files exceed the 16 MiB limit.');
  }
}

function validateEntries(entries, validatePatch) {
  for (const { path, data } of entries) {
    userPath(path);
    if (typeof data !== 'string' || (!PATCH_PATH.test(path) && !JS_PATH.test(path)))
      throw new Error('Choose a VSU patch or JavaScript file.');
    if (PATCH_PATH.test(path)) parsePatch(data, validatePatch);
  }
  checkSize(entries);
}

function validateLayer(layer, validatePatch) {
  if (!Array.isArray(layer?.files) || !Array.isArray(layer?.directories))
    throw new Error('Invalid VSU project file list.');
  for (const directory of layer.directories) if (directory !== '/') userPath(directory);
  validateEntries(layer.files, validatePatch);
}

function checkSelections(fs, view = {}) {
  const valid = (path, kind) => typeof path === 'string' && kind.test(path) && fs.has(path);
  const codePath = valid(view.codePath, JS_PATH) ? view.codePath :
    fs.list().find(file => JS_PATH.test(file.path))?.path ?? null;
  return {
    codePath,
    activePatch: valid(view.activePatch, PATCH_PATH) ? view.activePatch : null,
    selected: fs.has(view.selected ?? '/') || fs.listDirectories().includes(view.selected) ? view.selected : codePath,
    visible: view.visible === true,
  };
}

export function setupVsuFiles({ panel, toggle, getPatch, applyPatch, validatePatch, getCode, setCode, starterCode, setStatus }) {
  const doc = panel.ownerDocument, win = doc.defaultView;
  const workspace = createVirtualFileWorkspace([{ path: ENTRY_PATH, data: starterCode }], { autoSave: false });
  const fs = workspace.working;
  const codeProject = createSynthCodeProject({ fs });
  const store = createSynthProjectStore({
    indexedDB: win.indexedDB, name: STORAGE_NAME,
    readFallback: () => JSON.parse(win.localStorage.getItem(STORAGE_NAME)),
    writeFallback(snapshot) { win.localStorage.setItem(STORAGE_NAME, JSON.stringify(snapshot)); return true; },
  });
  const expanded = new Map([['/patches', true]]);
  let selected = ENTRY_PATH, codePath = ENTRY_PATH, activePatch = null;
  let loading = true, busy = false, draftTimer = null;
  let renderedEntries = '';
  const report = error => setStatus(error?.message || String(error));

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
  const patchButton = button('vsuFilePatch', '＋ Patch', () => saveNewPatch('/patches'));
  const codeButton = button('vsuFileNew', '＋ JS', () => newCode('/'));

  const menu = element('details', { id: 'synthMenu', className: 'vsu-file-menu' });
  const menuToggle = element('summary', { id: 'synthMenuButton', textContent: 'Menu' });
  menuToggle.setAttribute('aria-expanded', 'false');
  menuToggle.setAttribute('aria-controls', 'vsuFilesMenuActions');
  const menuActions = element('div', { id: 'vsuFilesMenuActions', className: 'synth-menu-panel' });
  const fileInput = element('input', { id: 'vsuFileImportInput', type: 'file', multiple: true, hidden: true });
  fileInput.accept = '.vsu.json,.json,.js,.mjs,.zip';
  const importButton = element('button', { id: 'vsuFileImport', type: 'button', textContent: 'Import…' });
  importButton.addEventListener('click', () => { fileInput.value = ''; fileInput.click(); });
  const exportButton = button('vsuFileExport', 'Export Cassette…', downloadCassette);
  exportButton.title = 'Export the files in this project as a Cassette';
  for (const command of [importButton, exportButton]) command.setAttribute('data-close-synth-menu', '');
  menuActions.append(importButton, exportButton);
  menu.append(menuToggle, menuActions);
  actions.append(patchButton, codeButton, saveButton, menu);
  heading.append(element('h2', { textContent: 'Files' }), actions);
  const tree = element('div', { id: 'vsuFilesTree' });
  panel.classList.add('panel', 'vsu-files');
  panel.append(heading, tree, fileInput);
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
      view: { codePath, activePatch, selected, visible: !panel.hidden },
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
    const entries = [...fs.list(), ...fs.listDirectories().filter(path => path !== '/')
      .map(path => ({ path, type: 'directory' }))];
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
    }
    const dirty = new Set(workspace.getDirtyPaths());
    for (const row of tree.querySelectorAll('[data-file-path]')) {
      const path = row.getAttribute('data-file-path');
      row.setAttribute('aria-current', String(path === selected));
      row.toggleAttribute('data-modified', dirty.has(path));
      if (row.matches('summary') && expanded.has(path)) row.parentElement.open = expanded.get(path);
    }
    for (const command of [patchButton, codeButton, importButton, exportButton]) command.disabled = loading || busy;
    saveButton.disabled = loading || busy || !saveTarget();
  }

  function select(path) {
    selected = path;
    for (let parent = dirname(path); parent !== '/'; parent = dirname(parent)) expanded.set(parent, true);
  }

  async function openCode(path, { show = true, stop = show } = {}) {
    await setCode(path ? fs.get(path).data : '', path ?? ENTRY_PATH, { show, stop });
    codePath = path;
  }

  async function open(path) {
    const file = fs.get(path);
    if (!file) return;
    if (PATCH_PATH.test(path)) {
      await applyPatch(parsePatch(file.data, validatePatch));
      activePatch = path;
    } else await openCode(path);
    select(path);
    await persist();
  }

  function markCodeEdited() {
    if (loading) return;
    const source = getCode();
    const path = codePath ?? ENTRY_PATH;
    if (fs.get(path)?.data === source) return;
    try {
      checkSize([...fs.list().filter(file => file.path !== path), { data: source }]);
      fs.writeFile(userPath(path), source);
      codePath = path;
      refresh();
      queueDraft();
    } catch (error) { report(error); }
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
    const extension = JS_PATH.test(path) ? path.match(JS_PATH)[0] : '.vsu.json';
    const kind = fs.has(path) ? JS_PATH.test(path) ? JS_PATH : PATCH_PATH : null;
    const destination = namedPath(dirname(path), label, kind ? extension : null, kind);
    await transfer(path, destination, false);
  }

  async function duplicate(path) {
    const suffix = fs.has(path) ? basename(path).match(JS_PATH)?.[0] ?? path.slice(-'.vsu.json'.length) : '';
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

  async function importFiles(files, directory = '') {
    if (!files.length) return;
    if (files.reduce((sum, file) => sum + file.size, 0) > MAX_BYTES)
      throw new Error('Selected files exceed the 16 MiB limit.');
    if (files.some(file => /\.zip$/i.test(file.name))) {
      if (files.length !== 1) throw new Error('Import one Cassette at a time.');
      await importCassette(files[0]);
      return;
    }
    const incoming = await Promise.all(files.map(async file => {
      const filename = PATCH_PATH.test(file.name) ? file.name : file.name.replace(/\.json$/i, '.vsu.json');
      return { path: userPath(directory + '/' + filename), data: decoder.decode(await file.arrayBuffer()) };
    }));
    const paths = new Set();
    for (const entry of incoming) {
      requireNew(entry.path);
      if (paths.has(entry.path)) throw new Error('Choose one file named ' + basename(entry.path) + '.');
      paths.add(entry.path);
    }
    validateEntries(incoming, validatePatch);
    writeAccepted(incoming);
    show(true);
    await open(incoming[0].path);
    setStatus('Imported ' + incoming.length + (incoming.length === 1 ? ' file.' : ' files.'));
  }

  async function importCassette(file) {
    const cassette = await loadPlaygroundCassette(await file.arrayBuffer());
    const metadata = cassette.metadata.vsu;
    if (metadata?.format !== PROJECT_FORMAT || metadata.version !== 1)
      throw new Error('Choose a Tetorica VSU Synth Cassette.');
    const entries = [...cassette.files].filter(([path]) => path !== 'metadata.json')
      .map(([path, data]) => ({ path: '/' + path, data: decoder.decode(data) }));
    validateEntries(entries, validatePatch);
    const fresh = createVirtualFileWorkspace([], { autoSave: false });
    fresh.working.replace(entries, cassette.directories);
    fresh.saveAll();
    if (!win.confirm('Replace the current project with this Cassette?')) return;
    await restore({ format: PROJECT_FORMAT, version: 1, workspace: fresh.snapshot(), view: metadata.view }, { stop: true });
    show(true);
    await persist();
    setStatus('Imported Cassette.');
  }

  async function restore(state, { stop = false } = {}) {
    if (state.format !== PROJECT_FORMAT || state.version !== 1) throw new Error('Unsupported VSU project.');
    validateLayer(state.workspace?.working, validatePatch);
    validateLayer(state.workspace?.saved, validatePatch);
    const checked = createVirtualFileWorkspace();
    checked.restore(state.workspace);
    const savedView = checkSelections(checked.working, state.view);
    if (savedView.activePatch) await applyPatch(parsePatch(checked.working.get(savedView.activePatch).data, validatePatch));
    workspace.restore(checked.snapshot());
    activePatch = savedView.activePatch;
    await openCode(savedView.codePath, { show: false, stop });
    if (savedView.selected) select(savedView.selected);
    else selected = null;
    show(savedView.visible);
  }

  async function operation(action) {
    if (loading || busy) return;
    busy = true;
    refresh();
    try { await action(); }
    catch (error) { report(error); }
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
  return { ...codeProject, get codePath() { return codePath ?? ENTRY_PATH; }, markCodeEdited, ready };
}

// SPDX-License-Identifier: BSD-3-Clause
import { isCheckpointPath, transferVirtualFiles } from '../js/tetorica_virtual_files/filesystem.js';
import { dirname, normalizeVirtualPath } from '../js/tetorica_virtual_files/path.js';
import { createVirtualFileWorkspace } from '../js/tetorica_virtual_files/workspace.js';
import { createPlaygroundCassetteZip, loadPlaygroundCassette } from '../playground/playground_cassette.js';
import { renderFileTree } from '../playground/playground_file_tree.js';
import { readFm2610Patch } from './fm_patch.js';
import { installSpuFileContextMenu } from '../synth-spu/file_context_menu.js';
import { createSynthCodeProject } from '../synth/synth_code_project.js';
import { createSynthProjectStore } from '../synth/synth_project_store.js';

const ENTRY = '/index.js';
const PATCHES = '/presets';
const SONGS = '/vgm';
const STORAGE = 'tetorica-fm2610-synth-project';
const MAX_BYTES = 16 * 1024 * 1024;
const CODE_PATH = /\.m?js$/i;
const PATCH_PATH = /\.fm\.json$/i;
const SONG_PATH = /\.vg[mz]$/i;
const FILE_SUFFIX = /\.(?:fm\.json|m?js|vg[mz])$/i;
const METADATA = new Set(['metadata.json', 'cassette.metadata.js']);
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const basename = path => path.slice(path.lastIndexOf('/') + 1);
const join = (directory, name) => (directory === '/' ? '' : directory) + '/' + name;
const inside = (path, directory) => path === directory || path?.startsWith(directory + '/');
const size = data => typeof data === 'string' ? encoder.encode(data).length : data.byteLength;

function checkPath(path) {
  if (normalizeVirtualPath(path) !== path || path === '/' || isCheckpointPath(path) ||
      METADATA.has(path.slice(1)) || path.split('/').includes('__proto__') ||
      /[\x00-\x1f\x7f<>:"|?*\\]/.test(path)) {
    throw new Error('Choose a valid project file or folder name.');
  }
  return path;
}

function namedPath(directory, text, extension = '') {
  const name = text.trim().normalize('NFC');
  if (!name || name === '.' || name === '..' || name.includes('/') || /[. ]$/.test(name)) {
    throw new Error('Enter a file or folder name.');
  }
  return checkPath(join(directory, name + extension));
}

function safeStem(value) {
  const cleaned = String(value ?? '').normalize('NFC')
    .replace(/[\x00-\x1f\x7f<>:"/\\|?*\ud800-\udfff]/gu, '_')
    .trim().replace(/^\.+|[. ]+$/g, '');
  const stem = Array.from(cleaned).slice(0, 50).join('').replace(/[. ]+$/g, '') || 'Untitled';
  return /^(?:__proto__|con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(stem.split('.')[0]) ? '_' + stem : stem;
}

function checkEntry({ path, data }) {
  checkPath(path);
  if (SONG_PATH.test(path)) {
    const vgm = [0x56, 0x67, 0x6d, 0x20];
    const isVgm = data instanceof Uint8Array &&
      ((data[0] === 31 && data[1] === 139) || vgm.every((byte, index) => data[index] === byte));
    if (!isVgm) throw new Error('Choose a VGM or VGZ file.');
    return;
  }
  if (typeof data !== 'string' || (!PATCH_PATH.test(path) && !CODE_PATH.test(path))) {
    throw new Error('Choose an FM patch, JavaScript, VGM or VGZ file.');
  }
  if (PATCH_PATH.test(path)) readFm2610Patch(JSON.parse(data));
}

function checkCapacity(entries) {
  if (entries.reduce((bytes, entry) => bytes + size(entry.data), 0) > MAX_BYTES) {
    throw new Error('Project files exceed the 16 MiB limit.');
  }
}

function describe(fs) {
  const directories = fs.listDirectories();
  const entries = directories.slice(1).map(path => ({ path, type: 'directory' }));
  for (const directory of directories) {
    for (const name of fs.readdir(directory)) {
      const path = join(directory, name);
      if (fs.has(path)) entries.push({ path, type: 'file' });
    }
  }
  return entries;
}

function encodeBytes(bytes) {
  let text = '';
  for (let offset = 0; offset < bytes.length; offset += 32768) {
    text += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
  }
  return btoa(text);
}

export function setupFm2610Files({
  panel, toggle, menuMount, getPatch, applyPatch, getCode, setCode, starterCode,
  setStatus, beforeReplace = () => {}, onVgmChange = () => {}, openVgm,
  importVgm,
}) {
  const doc = panel.ownerDocument;
  const win = doc.defaultView;
  const workspace = createVirtualFileWorkspace([], { autoSave: false });
  const fs = workspace.working;
  const codeProject = createSynthCodeProject({ fs });
  const store = createSynthProjectStore({
    indexedDB: win.indexedDB,
    name: STORAGE,
    readFallback: () => JSON.parse(win.localStorage.getItem(STORAGE), (_key, value) =>
      typeof value?.fm2610Bytes === 'string'
        ? Uint8Array.from(atob(value.fm2610Bytes), char => char.charCodeAt(0)) : value),
    writeFallback(snapshot) {
      win.localStorage.setItem(STORAGE, JSON.stringify(snapshot, (_key, value) =>
        value instanceof Uint8Array ? { fm2610Bytes: encodeBytes(value) } : value));
      return true;
    },
  });
  const expanded = new Map([[PATCHES, true], [SONGS, true]]);
  let codePath = ENTRY, activePatch = null, selected = ENTRY;
  let loading = true, busy = false, storageReady = false, draftTimer = null, lastStructure = '';
  let operationTail = Promise.resolve();
  const report = error => setStatus(error?.message ?? String(error), true);

  function freshWorkspace() {
    const text = typeof starterCode === 'function' ? starterCode() : starterCode;
    return createVirtualFileWorkspace([{ path: ENTRY, data: text ?? '' }], { autoSave: false });
  }
  workspace.restore(freshWorkspace().snapshot());

  function element(tag, properties) {
    return Object.assign(doc.createElement(tag), properties);
  }
  function drive(task) {
    void Promise.resolve().then(task).catch(report);
  }
  function button(id, textContent, task) {
    const node = element('button', { id, textContent, type: 'button' });
    node.addEventListener('click', () => drive(task));
    return node;
  }

  const heading = element('div', { className: 'fm2610-files-heading' });
  heading.append(element('h2', { textContent: 'Files' }));
  const actions = element('div', { className: 'fm2610-files-actions' });
  const saveButton = button('fm2610SaveFile', 'Save', () => save());
  saveButton.setAttribute('aria-keyshortcuts', 'Control+S Meta+S');
  const newCode = button('fm2610NewCode', '+ JS', () => operation(() => createCode('/')));
  const newPatch = button('fm2610SavePatch', 'Save FM patch…', () => operation(() => createPatch(PATCHES)));
  actions.append(newCode, newPatch, saveButton);

  const tree = element('div', { className: 'fm2610-files-tree', id: 'fm2610FilesTree' });
  tree.setAttribute('aria-label', 'Project files');
  const chooser = element('input', { type: 'file', multiple: true, hidden: true,
    accept: '.js,.mjs,.json,.zip,.vgm,.vgz' });
  const importButton = button('fm2610ImportFiles', 'Import files…', () => {
    chooser.value = '';
    chooser.click();
  });
  const newButton = button('fm2610NewCassette', 'New Cassette…', () => operation(newCassette));
  const exportButton = button('fm2610ExportCassette', 'Export Cassette · ZIP', () => operation(exportCassette));
  const projectActions = element('div', { className: 'fm2610-files-actions' });
  for (const [action, command] of [['new', newButton], ['import', importButton], ['export', exportButton]]) {
    const mount = menuMount?.[action] ?? (menuMount?.nodeType === 1 ? menuMount : null);
    if (mount) command.setAttribute('data-close-synth-menu', '');
    (mount ?? projectActions).append(command);
  }
  panel.classList.add('fm2610-files');
  panel.append(heading, actions, tree, chooser);
  if (projectActions.childElementCount) panel.append(projectActions);

  const dialog = element('dialog', { className: 'fm2610-files-dialog' });
  const form = element('form', { method: 'dialog' });
  const dialogTitle = element('h2', { id: 'fm2610FileDialogTitle' });
  const name = element('input', { id: 'fm2610FileName', type: 'text', required: true, maxLength: 128 });
  const label = element('label', { htmlFor: name.id, textContent: 'Name' });
  const dialogActions = element('div', { className: 'fm2610-files-actions' });
  const cancel = element('button', { type: 'submit', value: 'cancel', formNoValidate: true, textContent: 'Cancel' });
  const confirm = element('button', { type: 'submit', value: 'ok', textContent: 'OK' });
  dialogActions.append(cancel, confirm);
  form.append(dialogTitle, label, name, dialogActions);
  dialog.append(form);
  dialog.setAttribute('aria-labelledby', dialogTitle.id);
  doc.body.append(dialog);

  function askName(title, suggestion) {
    dialogTitle.textContent = title;
    name.value = suggestion;
    dialog.returnValue = '';
    return new Promise(resolve => {
      dialog.addEventListener('close', () => resolve(dialog.returnValue === 'ok' ? name.value : null), { once: true });
      dialog.showModal();
      name.focus();
      name.select();
    });
  }

  function snapshot() {
    return {
      version: 1,
      workspace: workspace.snapshot(),
      view: { codePath, activePatch, selected, visible: !panel.hidden },
    };
  }
  function persist() {
    win.clearTimeout(draftTimer);
    draftTimer = null;
    if (storageReady) return store.write(snapshot());
  }
  function queueDraft() {
    if (!storageReady) return;
    win.clearTimeout(draftTimer);
    draftTimer = win.setTimeout(() => drive(persist), 180);
  }

  function refresh() {
    const entries = describe(fs);
    const structure = JSON.stringify(entries);
    if (structure !== lastStructure) {
      renderFileTree(tree, entries, {
        selectedPath: selected, expanded,
        onOpen: path => drive(() => operation(() => open(path))),
        onImport: (incoming, directory) => drive(() => importFiles(incoming, directory || '/')),
        onTransfer: (from, to, copy) => drive(() => operation(() => transfer(from, to, copy))),
      });
      tree.querySelector('.file-tree-root').tabIndex = 0;
      lastStructure = structure;
    }
    const dirty = new Set(workspace.getDirtyPaths());
    for (const row of tree.querySelectorAll('[data-file-path]')) {
      const path = row.getAttribute('data-file-path');
      row.setAttribute('aria-current', String(path === selected));
      row.toggleAttribute('data-modified', dirty.has(path));
      if (row.matches('summary') && expanded.has(path)) row.parentElement.open = expanded.get(path);
    }
    for (const command of [newCode, newPatch, saveButton, importButton, newButton, exportButton]) {
      command.disabled = loading || busy;
    }
  }

  function select(path) {
    selected = path;
    for (let parent = dirname(path); parent !== '/'; parent = dirname(parent)) {
      expanded.set(parent, true);
    }
  }

  function show(visible = true) {
    panel.hidden = !visible;
    toggle?.setAttribute('aria-expanded', String(visible));
    toggle?.setAttribute('aria-pressed', String(visible));
    if (!visible) contextMenu.close();
    queueDraft();
  }

  function operation(task) {
    if (loading) return Promise.reject(new Error('Files are still loading.'));
    const running = operationTail.then(async () => {
      busy = true;
      refresh();
      try { return await task(); }
      finally { busy = false; refresh(); }
    });
    operationTail = running.catch(() => {});
    return running;
  }

  function markCodeEdited() {
    if (loading) return false;
    const data = getCode();
    if (data === fs.get(codePath)?.data || (!fs.has(codePath) && data === '')) return true;
    const bytes = describe(fs).reduce((sum, file) => sum + (file.path === codePath ? 0 : fs.stat(file.path).size), size(data));
    if (bytes > MAX_BYTES) {
      setStatus('Project files exceed the 16 MiB limit.', true);
      return false;
    }
    fs.writeText(codePath, data);
    refresh();
    queueDraft();
    return true;
  }

  function flushCode() {
    if (!markCodeEdited()) throw new Error('The current Code draft could not be saved.');
  }

  function occupied(path) {
    const folded = path.normalize('NFC').toLowerCase();
    return [fs, workspace.saved].some(layer => describe(layer).some(({ path: other }) =>
      other.normalize('NFC').toLowerCase() === folded));
  }

  function requireNew(path) {
    if (occupied(path)) throw new Error(path + ' already exists.');
  }

  function candidate() {
    const next = createVirtualFileWorkspace();
    next.restore(workspace.snapshot());
    return next;
  }

  function commit(next) {
    checkCapacity(next.working.list());
    checkCapacity(next.saved.list());
    workspace.restore(next.snapshot());
  }

  function writeAccepted(entries) {
    const next = candidate();
    entries.forEach(checkEntry);
    next.working.writeFiles(entries);
    next.saveMany(entries.map(({ path }) => path));
    commit(next);
  }

  async function open(path) {
    const file = fs.get(path);
    if (!file) return;
    flushCode();
    if (CODE_PATH.test(path)) {
      await setCode(file.data, path, { show: true });
      codePath = path;
    } else if (PATCH_PATH.test(path)) {
      await applyPatch(readFm2610Patch(JSON.parse(file.data)));
      activePatch = path;
    } else await openVgm?.(path);
    select(path);
    await persist();
  }

  async function save(preferCode = false) {
    return operation(async () => {
      flushCode();
      const path = !preferCode && PATCH_PATH.test(selected) ? selected : codePath;
      if (path === activePatch) {
        writeAccepted([{ path, data: JSON.stringify(readFm2610Patch(getPatch()), null, 2) + '\n' }]);
      } else if (CODE_PATH.test(path)) {
        if (!fs.has(path)) writeAccepted([{ path, data: getCode() }]);
        else workspace.save(path);
      } else {
        throw new Error('Open an FM patch before saving it.');
      }
      await persist();
      setStatus('Saved ' + basename(path) + '.');
    });
  }

  async function createCode(directory) {
    const value = await askName('New JavaScript file', 'untitled');
    if (value === null) return;
    const path = namedPath(directory, value, CODE_PATH.test(value.trim()) ? '' : '.js');
    requireNew(path);
    flushCode();
    writeAccepted([{ path, data: '' }]);
    await open(path);
    setStatus('Created ' + basename(path) + '.');
  }

  async function createPatch(directory) {
    const value = await askName('Save FM patch', 'untitled');
    if (value === null) return;
    const path = namedPath(directory, value, PATCH_PATH.test(value.trim()) ? '' : '.fm.json');
    requireNew(path);
    writeAccepted([{ path, data: JSON.stringify(readFm2610Patch(getPatch()), null, 2) + '\n' }]);
    activePatch = path;
    select(path);
    await persist();
    setStatus('Saved ' + basename(path) + '.');
  }

  function viewFor(layer, view = {}) {
    const types = { codePath: CODE_PATH, activePatch: PATCH_PATH };
    const matched = key => typeof view[key] === 'string' && types[key].test(view[key]) && layer.has(view[key]);
    const code = matched('codePath') ? view.codePath :
      describe(layer).find(entry => entry.type === 'file' && CODE_PATH.test(entry.path))?.path ?? ENTRY;
    const exists = typeof view.selected === 'string' &&
      (layer.has(view.selected) || layer.listDirectories().includes(view.selected));
    return { codePath: code, activePatch: matched('activePatch') ? view.activePatch : null,
      selected: exists ? view.selected : code, visible: view.visible === true };
  }

  async function restore(next, view, replace = false) {
    const target = viewFor(next.working, view);
    const patch = target.activePatch && readFm2610Patch(JSON.parse(next.working.get(target.activePatch).data));
    if (replace) await beforeReplace();
    if (patch) await applyPatch(patch);
    await setCode(next.working.get(target.codePath)?.data ?? '', target.codePath, { show: false });
    workspace.restore(next.snapshot());
    codePath = target.codePath;
    activePatch = target.activePatch;
    select(target.selected);
    show(target.visible);
    onVgmChange();
  }

  function download(bytes, filename, type) {
    const url = win.URL.createObjectURL(new win.Blob([bytes], { type }));
    element('a', { href: url, download: filename }).click();
    win.setTimeout(() => win.URL.revokeObjectURL(url), 1000);
  }

  function exportCassette() {
    flushCode();
    const { view } = snapshot();
    const drafts = workspace.getDirtyPaths().filter(path => CODE_PATH.test(path) && fs.has(path))
      .map(path => ({ path, data: fs.get(path).data }));
    download(createPlaygroundCassetteZip(workspace.saved.list(), {
      directories: workspace.saved.listDirectories(),
      metadata: { fm2610: { version: 1, view, drafts } },
    }), 'tetorica-fm2610.cassette.zip', 'application/zip');
    setStatus('Exported Cassette.');
  }

  async function newCassette() {
    if (!win.confirm('Create a new Cassette? Export first to keep the current project.')) return;
    await restore(freshWorkspace(), { visible: true }, true);
    await persist();
    setStatus('New Cassette created.');
  }

  async function importCassette(file) {
    const archive = await loadPlaygroundCassette(await file.arrayBuffer());
    const metadata = archive.metadata.fm2610;
    if (metadata?.version !== 1 || !Array.isArray(metadata.drafts)) {
      throw new Error('Choose a Tetorica FM2610 Synth Cassette.');
    }
    const entries = [...archive.files].filter(([path]) => !METADATA.has(path)).map(([name, data]) => {
      const path = '/' + name;
      return { path, data: SONG_PATH.test(path) ? data : decoder.decode(data) };
    });
    entries.forEach(checkEntry);
    for (const directory of archive.directories) checkPath(directory);
    const next = createVirtualFileWorkspace(entries, { autoSave: false });
    next.working.replace(entries, archive.directories);
    next.saveAll();
    for (const draft of metadata.drafts) {
      checkEntry(draft);
      if (!CODE_PATH.test(draft.path) || !next.saved.has(draft.path)) throw new Error('Invalid Cassette Code draft.');
    }
    next.working.writeFiles(metadata.drafts);
    checkCapacity(next.working.list());
    if (!win.confirm('Replace the current project with this Cassette?')) return;
    await restore(next, { ...metadata.view, visible: true }, true);
    await persist();
    setStatus('Imported Cassette.');
  }

  async function importFiles(incoming, directory = '/') {
    if (!incoming.length) return;
    if (incoming.some(file => SONG_PATH.test(file.name))) {
      if (!importVgm || incoming.length !== 1) throw new Error('Choose one VGM or VGZ at a time.');
      return importVgm(incoming[0]);
    }
    return operation(async () => {
      if (incoming.reduce((sum, file) => sum + file.size, 0) > MAX_BYTES) {
        throw new Error('Selected files exceed the 16 MiB limit.');
      }
      if (incoming.some(file => /\.zip$/i.test(file.name))) {
        if (incoming.length !== 1) throw new Error('Choose one Cassette at a time.');
        return importCassette(incoming[0]);
      }
      const entries = await Promise.all(incoming.map(async file => {
        const filename = PATCH_PATH.test(file.name) ? file.name : file.name.replace(/\.json$/i, '.fm.json');
        const path = namedPath(directory, filename);
        requireNew(path);
        return { path, data: decoder.decode(await file.arrayBuffer()) };
      }));
      flushCode();
      writeAccepted(entries);
      show();
      await open(entries[0].path);
      setStatus('Imported ' + entries.length + (entries.length === 1 ? ' file.' : ' files.'));
    });
  }

  async function transfer(from, to, copy = false) {
    checkPath(from);
    checkPath(to);
    if (from === to) return;
    requireNew(to);
    flushCode();
    const next = candidate();
    transferVirtualFiles(next.working, from, to, { copy });
    if (copy) next.save(to);
    else {
      // Move the accepted bytes separately so a Code draft stays unsaved.
      const state = next.snapshot();
      const baseline = createVirtualFileWorkspace();
      baseline.working.restore(state.saved);
      if (baseline.working.has(from) || baseline.working.listDirectories().includes(from)) {
        transferVirtualFiles(baseline.working, from, to);
      }
      next.restore({ ...state, saved: baseline.working.snapshot() });
    }
    commit(next);
    const moved = path => inside(path, from) ? to + path.slice(from.length) : path;
    if (!copy) {
      activePatch = moved(activePatch);
      if (moved(codePath) !== codePath) {
        codePath = moved(codePath);
        await setCode(fs.get(codePath).data, codePath, { show: false });
      }
    }
    select(to);
    onVgmChange();
    await persist();
    setStatus((copy ? 'Duplicated ' : 'Moved ') + basename(from) + '.');
  }

  async function rename(path) {
    const value = await askName('Rename', basename(path));
    if (value === null) return;
    const suffix = fs.has(path) ? path.match(FILE_SUFFIX)[0] : '';
    const extension = suffix && !value.trim().toLowerCase().endsWith(suffix.toLowerCase()) ? suffix : '';
    await transfer(path, namedPath(dirname(path), value, extension));
  }

  async function remove(path) {
    if (!win.confirm('Delete ' + basename(path) + '?')) return;
    flushCode();
    const next = candidate();
    next.working.remove(path, { recursive: true });
    next.save(path);
    if (inside(codePath, path)) {
      await beforeReplace();
      codePath = viewFor(next.working).codePath;
      await setCode(next.working.get(codePath)?.data ?? '', codePath, { show: false });
    }
    commit(next);
    if (inside(activePatch, path)) activePatch = null;
    select(codePath);
    onVgmChange();
    await persist();
    setStatus('Deleted ' + basename(path) + '.');
  }

  async function newFolder(path) {
    const directory = fs.listDirectories().includes(path) ? path : dirname(path);
    const value = await askName('New folder', 'untitled');
    if (value === null) return;
    const child = namedPath(directory, value);
    requireNew(child);
    fs.mkdir(child);
    workspace.save(child);
    select(child);
    await persist();
  }

  function listVgm() {
    return describe(fs).filter(({ path, type }) => type === 'file' && SONG_PATH.test(path))
      .map(({ path }) => ({ path, name: basename(path) }));
  }
  function readBinary(path) {
    const file = fs.get(path);
    if (file?.type !== 'binary') throw new Error('Song file not found.');
    return file.data;
  }
  async function addVgmFiles({ name: filename, bytes, presets = [], signal }) {
    await ready;
    return operation(async () => {
      signal?.throwIfAborted();
      const extension = String(filename ?? '').match(SONG_PATH)?.[0]?.toLowerCase();
      if (!extension) throw new Error('Choose a VGM or VGZ file.');
      const base = safeStem(basename(filename).slice(0, -extension.length));
      let stem = base, index = 1;
      while (occupied(join(SONGS, stem + '.vgm')) || occupied(join(SONGS, stem + '.vgz')) ||
          occupied(join(PATCHES, stem))) {
        stem = base + ' (' + ++index + ')';
      }
      const path = join(SONGS, stem + extension);
      const folder = join(PATCHES, stem);
      const used = new Set();
      const entries = presets.map(({ name, patch }) => {
        const base = safeStem(String(name ?? '').replace(PATCH_PATH, ''));
        let stem = base, index = 1;
        while (used.has(stem.toLowerCase())) stem = base + ' (' + ++index + ')';
        used.add(stem.toLowerCase());
        return { path: join(folder, stem + '.fm.json'), data: JSON.stringify(readFm2610Patch(patch), null, 2) + '\n' };
      });
      const data = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes;
      flushCode();
      writeAccepted([{ path, data }, ...entries]);
      onVgmChange();
      await persist();
      return { path, presetPaths: entries.map(entry => entry.path) };
    });
  }

  const commands = {
    rename: { label: 'Rename…', run: rename },
    delete: { label: 'Delete', run: remove },
    folder: { label: 'New folder…', run: newFolder },
    export: { label: 'Export file', run: path => download(fs.get(path).data, basename(path), 'application/octet-stream') },
  };
  const contextMenu = installSpuFileContextMenu({
    root: tree, document: doc, isBusy: () => loading || busy, onError: report,
    onTarget(path) { select(path); refresh(); },
    getActions: path => Object.entries(commands).map(([id, command]) =>
      ({ id, label: command.label, disabled: id === 'export' ? !fs.has(path) : id !== 'folder' && path === '/' })),
    onAction: (id, path) => operation(() => commands[id].run(path)),
  });
  contextMenu.element.id = 'fm2610FileContextMenu';
  contextMenu.element.classList.add('fm2610-file-context-menu');

  chooser.addEventListener('change', () => drive(() => importFiles([...chooser.files])));
  toggle?.addEventListener('click', () => show(panel.hidden));
  doc.addEventListener('keydown', event => {
    if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey || event.isComposing ||
        event.key.toLowerCase() !== 's' || busy || loading) return;
    const inCode = Boolean(event.target?.closest?.('#codePanel'));
    if (panel.hidden && !inCode) return;
    event.preventDefault();
    drive(() => save(inCode));
  });
  win.addEventListener('pagehide', () => {
    if (draftTimer !== null) drive(persist);
  });
  show(!panel.hidden);
  refresh();
  const ready = store.read().then(async state => {
    if (state) {
      if (state.version !== 1) throw new Error('Unsupported FM2610 project.');
      const next = createVirtualFileWorkspace();
      next.restore(state.workspace);
      for (const layer of [next.working, next.saved]) {
        const entries = layer.list();
        for (const directory of layer.listDirectories()) if (directory !== '/') checkPath(directory);
        entries.forEach(checkEntry);
        checkCapacity(entries);
      }
      await restore(next, state.view);
    }
    storageReady = true;
  }).catch(report).finally(() => {
    loading = false;
    refresh();
    onVgmChange();
  });

  return {
    ...codeProject, ready, markCodeEdited, save, show, addVgmFiles, listVgm, readBinary,
    getEntryPath: () => codePath,
    detachFmPatch() {
      activePatch = null;
      if (PATCH_PATH.test(selected)) select(codePath);
      refresh();
      queueDraft();
    },
  };
}

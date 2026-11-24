// SPDX-License-Identifier: BSD-3-Clause
import { isCheckpointPath, transferVirtualFiles } from '../js/tetorica_virtual_files/filesystem.js';
import { dirname, normalizeVirtualPath } from '../js/tetorica_virtual_files/path.js';
import { createVirtualFileWorkspace } from '../js/tetorica_virtual_files/workspace.js';
import { createTfiFromPreset, parseTfi } from '../js/tfi.js';
import { createVgiFromPreset, parseVgi } from '../js/vgi.js';
import { createPlaygroundCassetteZip, loadPlaygroundCassette } from '../playground/playground_cassette.js';
import { renderFileTree } from '../playground/playground_file_tree.js';
import { getFm2610CodeExamples, getFm2610CodeExampleUpdates } from './code_examples.js';
import { readFm2610Patch } from './fm_patch.js';
import { installSpuFileContextMenu } from '../synth-spu/file_context_menu.js';
import { createSynthCodeProject } from '../synth/synth_code_project.js';
import { createSynthProjectStore } from '../synth/synth_project_store.js';
import {
  ADPCM_A_KIT_SUFFIX, createDefaultAdpcmAKit, isAdpcmAKitPath, readAdpcmAKit, writeAdpcmAKit,
} from './adpcm_a_kit.js';
import {
  ADPCM_B_SAMPLE_SUFFIX, isAdpcmBSamplePath, readAdpcmBSample, writeAdpcmBSample,
} from './adpcm_b_sample_document.js';
import { createDefaultSsgPreset, isSsgPresetPath, readSsgPreset, SSG_PRESET_SUFFIX, writeSsgPreset } from './ssg_preset.js';

const ENTRY = '/index.js';
const EXAMPLES = '/examples';
const PATCHES = '/presets';
const KITS = '/kits';
const SAMPLES = '/samples';
const SONGS = '/vgm';
const STORAGE = 'tetorica-fm2610-synth-project';
const MAX_BYTES = 16 * 1024 * 1024;
const CODE_PATH = /\.m?js$/i;
const PATCH_PATH = /\.fm\.json$/i;
const PORTABLE_PATCH_PATH = /\.(?:tfi|vgi)$/i;
const SONG_PATH = /\.vg[mz]$/i;
const FILE_SUFFIX = /\.(?:(?:fm|ssg)\.json|m?js|vg[mz]|adpcm-a-kit\.zip|adpcm-b-sample\.zip)$/i;
const METADATA = new Set(['metadata.json', 'cassette.metadata.js']);
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const basename = path => path.slice(path.lastIndexOf('/') + 1);
const join = (directory, name) => (directory === '/' ? '' : directory) + '/' + name;
const inside = (path, directory) => path === directory || path?.startsWith(directory + '/');
const size = data => typeof data === 'string' ? encoder.encode(data).length : data.byteLength;
const isBinaryPath = path => SONG_PATH.test(path) || Boolean(audioDocumentReader(path));

function audioDocumentReader(path) {
  if (isAdpcmAKitPath(path)) return readAdpcmAKit;
  if (isAdpcmBSamplePath(path)) return readAdpcmBSample;
  return null;
}

function readPortablePatch(filename, bytes) {
  const parsed = /\.tfi$/i.test(filename) ? parseTfi(bytes) : parseVgi(bytes);
  return readFm2610Patch({...parsed, operators: Object.values(parsed.operators)});
}

function portablePatchOmissions(patch, format) {
  const omitted = [];
  if (format === 'tfi' && (!patch.pan.left || !patch.pan.right || patch.ams || patch.pms)) omitted.push('pan and AMS/PMS');
  if (patch.operators.some(operator => operator.am)) omitted.push('operator AM');
  if (patch.keyMask !== 15) omitted.push('operator key mask');
  if (patch.lfo?.enabled || patch.lfo?.frequency) omitted.push('LFO');
  if (patch.specialFrequencies) omitted.push('CH3 Special settings');
  return omitted;
}

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
  if (audioDocumentReader(path)) {
    if (!(data instanceof Uint8Array)) throw new Error('Choose a binary ADPCM kit or sample.');
    return;
  }
  if (SONG_PATH.test(path)) {
    const vgm = [0x56, 0x67, 0x6d, 0x20];
    const isVgm = data instanceof Uint8Array &&
      ((data[0] === 31 && data[1] === 139) || vgm.every((byte, index) => data[index] === byte));
    if (!isVgm) throw new Error('Choose a VGM or VGZ file.');
    return;
  }
  if (typeof data !== 'string' || (!PATCH_PATH.test(path) && !isSsgPresetPath(path) && !CODE_PATH.test(path))) {
    throw new Error('Choose an FM patch, SSG preset, ADPCM-A kit, ADPCM-B sample, JavaScript, VGM or VGZ file.');
  }
  if (PATCH_PATH.test(path)) readFm2610Patch(JSON.parse(data));
  if (isSsgPresetPath(path)) readSsgPreset(data);
}

async function checkAudioDocuments(entries, ...selectedPaths) {
  const selected = new Map();
  for (const {path, data} of entries) {
    const read = audioDocumentReader(path);
    if (!read) continue;
    const value = await read(data);
    if (selectedPaths.includes(path)) selected.set(path, value);
  }
  return selected;
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
  importVgm, getAdpcmAKit, applyAdpcmAKit = () => {}, getAdpcmBSample, applyAdpcmBSample = () => {},
  getSsgPreset, applySsgPreset = () => {},
}) {
  const doc = panel.ownerDocument;
  const win = doc.defaultView;
  const workspace = createVirtualFileWorkspace();
  const fs = workspace.working;
  const codeProject = createSynthCodeProject({ fs, savedFs: workspace.saved }, {version: 'saved'});
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
  const expanded = new Map([[EXAMPLES, true], [PATCHES, true], [KITS, true], [SAMPLES, true], [SONGS, true]]);
  let codePath = ENTRY, activePatch = null, activeSsg = null, activeKit = null, activeSample = null, selected = ENTRY;
  let loading = true, busy = false, storageReady = false, draftTimer = null, lastStructure = '';
  let autoApplyRequest = null;
  let operationTail = Promise.resolve();
  const report = error => setStatus(error?.message ?? String(error), true);
  const instrumentEdits = new Set();
  const instruments = {
    fm: {path: () => activePatch, detach: () => { activePatch = null; },
      encode: () => JSON.stringify(readFm2610Patch(getPatch()), null, 2) + '\n'},
    ssg: {path: () => activeSsg, detach: () => { activeSsg = null; },
      encode: () => writeSsgPreset(getSsgPreset())},
    'adpcm-a': {path: () => activeKit, detach: () => { activeKit = null; },
      encode: () => writeAdpcmAKit(getAdpcmAKit())},
    'adpcm-b': {path: () => activeSample, detach: () => { activeSample = null; },
      encode: () => writeAdpcmBSample(getAdpcmBSample())},
  };

  function freshWorkspace() {
    const text = typeof starterCode === 'function' ? starterCode() : starterCode;
    return createVirtualFileWorkspace([{ path: ENTRY, data: text ?? '' }, ...getFm2610CodeExamples()], {
      autoSave: workspace.autoSave,
    });
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
  const actions = element('div', { className: 'fm2610-file-save-controls' });
  actions.setAttribute('role', 'group');
  actions.setAttribute('aria-label', 'File saving');
  const saveButton = button('fm2610SaveFile', 'Save', () => save());
  saveButton.setAttribute('aria-keyshortcuts', 'Control+S Meta+S');
  const discardButton = button('fm2610DiscardFile', 'Discard', discard);
  discardButton.title = 'Discard unsaved changes to the selected file';
  const newCode = button('fm2610NewCode', '＋ JS', () => operation(() => createCode('/')));
  const newPatch = button('fm2610SavePatch', '＋ Instrument', () => operation(() => createPatch(PATCHES)));
  newPatch.title = 'Save the current FM sound as a new instrument';
  heading.append(element('h2', { textContent: 'FILES' }), newPatch, newCode);
  const autoApplyControl = element('input', {id: 'fm2610AutoApply', type: 'checkbox', checked: true});
  const autoApplyLabel = element('label', {title: 'Save changes automatically. JavaScript still uses Run / Apply.'});
  autoApplyLabel.append(autoApplyControl, 'Auto apply');
  actions.append(autoApplyLabel, saveButton, discardButton);

  const tree = element('div', { className: 'fm2610-files-tree', id: 'fm2610FilesTree' });
  tree.setAttribute('aria-label', 'Project files');
  const chooser = element('input', { type: 'file', multiple: true, hidden: true,
    accept: '.js,.mjs,.json,.tfi,.vgi,.zip,.vgm,.vgz' });
  const importButton = button('fm2610ImportFiles', 'Import files…', () => {
    chooser.value = '';
    chooser.click();
  });
  const newButton = button('fm2610NewCassette', 'New Cassette…', () => operation(newCassette));
  const examplesButton = button('fm2610AddCodeExamples', 'Code examples', () => operation(addCodeExamples));
  const exportButton = button('fm2610ExportCassette', 'Export Cassette · ZIP', () => operation(exportCassette));
  const exportTfi = button('fm2610ExportTfi', 'Selected FM · TFI', () => operation(() => exportPatch('tfi')));
  const exportVgi = button('fm2610ExportVgi', 'Selected FM · VGI', () => operation(() => exportPatch('vgi')));
  const projectActions = element('div', { className: 'fm2610-files-actions' });
  for (const [action, command] of [
    ['new', newButton], ['new', examplesButton], ['import', importButton],
    ['export', exportButton], ['export', exportTfi], ['export', exportVgi],
  ]) {
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
      version: 2,
      workspace: workspace.snapshot(),
      view: { codePath, activePatch, activeSsg, activeKit, activeSample, selected, visible: !panel.hidden },
    };
  }
  function persist() {
    win.clearTimeout(draftTimer);
    draftTimer = null;
    if (storageReady) {
      flushInstrumentEdits();
      return store.write(snapshot());
    }
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
    const dirty = new Set([...workspace.getDirtyPaths(),
      ...Array.from(instrumentEdits, kind => instruments[kind].path()).filter(Boolean)]);
    for (const row of tree.querySelectorAll('[data-file-path]')) {
      const path = row.getAttribute('data-file-path');
      row.setAttribute('aria-current', String(path === selected));
      row.toggleAttribute('data-modified', dirty.has(path));
      if (row.matches('summary') && expanded.has(path)) row.parentElement.open = expanded.get(path);
    }
    for (const command of [newCode, newPatch, saveButton, importButton, newButton, examplesButton, exportButton, exportTfi, exportVgi]) {
      command.disabled = loading || busy;
    }
    discardButton.disabled = loading || busy || !fs.has(selected) || !dirty.has(selected);
    autoApplyControl.checked = autoApplyRequest?.enabled ?? workspace.autoSave;
    autoApplyControl.disabled = loading || busy;
    if ((isSsgPresetPath(selected) && (selected !== activeSsg || typeof getSsgPreset !== 'function')) ||
        (isAdpcmAKitPath(selected) && (selected !== activeKit || typeof getAdpcmAKit !== 'function')) ||
        (isAdpcmBSamplePath(selected) && (selected !== activeSample || typeof getAdpcmBSample !== 'function'))) {
      saveButton.disabled = true;
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

  function flushInstrumentEdits(kinds = [...instrumentEdits]) {
    const entries = [];
    for (const kind of kinds) {
      const instrument = instruments[kind], path = instrument.path();
      if (path && instrumentEdits.has(kind)) entries.push({path, data: instrument.encode()});
    }
    if (entries.length) {
      entries.forEach(checkEntry);
      const total = describe(fs).reduce((bytes, entry) => bytes + fs.stat(entry.path).size, 0);
      const difference = entries.reduce((bytes, {path, data}) => bytes + size(data) - fs.stat(path).size, 0);
      if (total + difference > MAX_BYTES) throw new Error('Project files exceed the 16 MiB limit.');
      fs.writeFiles(entries);
    }
    for (const kind of kinds) instrumentEdits.delete(kind);
    if (entries.length) refresh();
  }

  function markInstrumentEdited(kind) {
    if (loading || !Object.hasOwn(instruments, kind) || !instruments[kind].path()) return false;
    const pending = instrumentEdits.has(kind);
    instrumentEdits.add(kind);
    if (kind === 'fm' || kind === 'ssg') {
      try { flushInstrumentEdits([kind]); }
      catch (error) {
        instrumentEdits.delete(kind);
        report(error);
        return false;
      }
    } else if (!pending) refresh();
    queueDraft();
    return true;
  }

  function flushProjectEdits() {
    flushCode();
    flushInstrumentEdits();
  }

  function detachInstrument(kind) {
    if (!Object.hasOwn(instruments, kind)) return;
    const instrument = instruments[kind], path = instrument.path();
    try { flushInstrumentEdits([kind]); }
    catch (error) {
      instrumentEdits.delete(kind);
      report(error);
    }
    instrument.detach();
    if (selected === path || (kind === 'fm' && PATCH_PATH.test(selected))) select(codePath);
    refresh();
    queueDraft();
  }

  function setAutoApply(enabled) {
    const request = autoApplyRequest = {enabled};
    return operation(async () => {
      if (workspace.autoSave === enabled) return;
      flushProjectEdits();
      workspace.setAutoSave(enabled);
      await persist();
      setStatus(enabled ? 'Auto apply on. File edits are saved automatically.' : 'Auto apply off. Save before using edits in Run / Apply.');
    }).finally(() => {
      if (autoApplyRequest !== request) return;
      autoApplyRequest = null;
      refresh();
    });
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

  async function applyFile(path, file, {show, audioDocument} = {}) {
    if (CODE_PATH.test(path)) {
      await setCode(file.data, path, {show});
      codePath = path;
    } else if (PATCH_PATH.test(path)) {
      await applyPatch(readFm2610Patch(JSON.parse(file.data)), {show});
      activePatch = path;
    } else if (isSsgPresetPath(path)) {
      await applySsgPreset(readSsgPreset(file.data), {show});
      activeSsg = path;
    } else if (isAdpcmAKitPath(path)) {
      await applyAdpcmAKit(audioDocument, {show});
      activeKit = path;
    } else if (isAdpcmBSamplePath(path)) {
      await applyAdpcmBSample(audioDocument, {show});
      activeSample = path;
    } else await openVgm?.(path);
  }

  async function open(path, validatedDocument) {
    flushProjectEdits();
    let file = fs.get(path);
    if (!file) return;
    const read = audioDocumentReader(path);
    let audioDocument = validatedDocument;
    if (read && !audioDocument) {
      while (file) {
        audioDocument = await read(file.data);
        // The previous instrument remains editable during ZIP decoding.
        flushProjectEdits();
        if (file.revision === fs.getRevision(path)) break;
        file = fs.get(path);
      }
      if (!file) return;
    }
    await applyFile(path, file, {show: true, audioDocument});
    select(path);
    await persist();
  }

  async function save(preferCode = false) {
    return operation(async () => {
      flushProjectEdits();
      const selectedInstrument = PATCH_PATH.test(selected) || isSsgPresetPath(selected) || audioDocumentReader(selected);
      const path = !preferCode && selectedInstrument ? selected : codePath;
      if (isSsgPresetPath(path)) {
        if (path !== activeSsg || typeof getSsgPreset !== 'function') throw new Error('Open an SSG preset before saving it.');
        writeAccepted([{ path, data: writeSsgPreset(getSsgPreset()) }]);
      } else if (isAdpcmAKitPath(path)) {
        if (path !== activeKit || typeof getAdpcmAKit !== 'function') {
          throw new Error('Open an ADPCM-A kit before saving it.');
        }
        writeAccepted([{ path, data: writeAdpcmAKit(await getAdpcmAKit()) }]);
      } else if (isAdpcmBSamplePath(path)) {
        if (path !== activeSample || typeof getAdpcmBSample !== 'function') {
          throw new Error('Open an ADPCM-B sample before saving it.');
        }
        writeAccepted([{ path, data: writeAdpcmBSample(await getAdpcmBSample()) }]);
      } else if (path === activePatch) {
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

  function discard() {
    return operation(async () => {
      const path = selected;
      const kind = Object.keys(instruments).find(key => instruments[key].path() === path);
      if (!fs.has(path) || (!workspace.isDirty(path) && !instrumentEdits.has(kind))) return;
      const saved = workspace.saved.get(path);
      if (kind && saved) {
        const read = audioDocumentReader(path);
        const audioDocument = read ? await read(saved.data) : undefined;
        await applyFile(path, saved, {show: false, audioDocument});
      }
      workspace.discard(path);
      if (kind) {
        instrumentEdits.delete(kind);
        if (!saved) instruments[kind].detach();
      }
      if (CODE_PATH.test(path)) {
        codePath = viewFor(fs, {codePath}).codePath;
        await setCode(fs.get(codePath)?.data ?? '', codePath, {show: false});
      }
      if (!fs.has(path)) select(codePath);
      await persist();
      setStatus('Discarded changes to ' + basename(path) + '.');
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
    flushInstrumentEdits(['fm']);
    writeAccepted([{ path, data: JSON.stringify(readFm2610Patch(getPatch()), null, 2) + '\n' }]);
    activePatch = path;
    select(path);
    await persist();
    setStatus('Saved ' + basename(path) + '.');
  }

  async function saveSsgPreset(preset) {
    const data = writeSsgPreset(preset);
    await ready;
    return operation(async () => {
      const suggestion = activeSsg ? basename(activeSsg).slice(0, -SSG_PRESET_SUFFIX.length) : 'Untitled SSG';
      const value = await askName('Save SSG preset', suggestion);
      if (value === null) return null;
      const extension = isSsgPresetPath(value.trim()) ? '' : SSG_PRESET_SUFFIX;
      const path = namedPath(activeSsg ? dirname(activeSsg) : PATCHES, value, extension);
      if (path !== activeSsg) requireNew(path);
      flushInstrumentEdits(['ssg']);
      writeAccepted([{ path, data }]);
      activeSsg = path;
      select(path);
      show();
      await persist();
      setStatus('Saved ' + basename(path) + '.');
      return path;
    });
  }

  async function saveAdpcmAKit(kit) {
    const data = writeAdpcmAKit(kit);
    await ready;
    return operation(async () => {
      const suggestion = activeKit ? basename(activeKit).slice(0, -ADPCM_A_KIT_SUFFIX.length) : 'Untitled kit';
      const value = await askName('Save ADPCM-A kit', suggestion);
      if (value === null) return null;
      const extension = isAdpcmAKitPath(value.trim()) ? '' : ADPCM_A_KIT_SUFFIX;
      const path = namedPath(activeKit ? dirname(activeKit) : KITS, value, extension);
      if (path !== activeKit) requireNew(path);
      flushInstrumentEdits(['adpcm-a']);
      writeAccepted([{ path, data }]);
      activeKit = path;
      select(path);
      show();
      await persist();
      setStatus('Saved ' + basename(path) + '.');
      return path;
    });
  }

  async function saveAdpcmBSample(sample) {
    const data = writeAdpcmBSample(sample);
    await ready;
    return operation(async () => {
      const suggestion = activeSample ? basename(activeSample).slice(0, -ADPCM_B_SAMPLE_SUFFIX.length)
        : safeStem(sample.name.replace(/\.[^.]+$/, ''));
      const value = await askName('Save ADPCM-B sample', suggestion);
      if (value === null) return null;
      const extension = isAdpcmBSamplePath(value.trim()) ? '' : ADPCM_B_SAMPLE_SUFFIX;
      const path = namedPath(activeSample ? dirname(activeSample) : SAMPLES, value, extension);
      if (path !== activeSample) requireNew(path);
      flushInstrumentEdits(['adpcm-b']);
      writeAccepted([{ path, data }]);
      activeSample = path;
      select(path);
      show();
      await persist();
      setStatus('Saved ' + basename(path) + '.');
      return path;
    });
  }

  function viewFor(layer, view = {}) {
    const types = { codePath: CODE_PATH, activePatch: PATCH_PATH };
    const matched = key => typeof view[key] === 'string' && types[key].test(view[key]) && layer.has(view[key]);
    const code = matched('codePath') ? view.codePath :
      describe(layer).find(entry => entry.type === 'file' && CODE_PATH.test(entry.path))?.path ?? ENTRY;
    const exists = typeof view.selected === 'string' &&
      (layer.has(view.selected) || layer.listDirectories().includes(view.selected));
    const ssg = isSsgPresetPath(view.activeSsg) && layer.has(view.activeSsg) ? view.activeSsg : null;
    const kit = typeof view.activeKit === 'string' && isAdpcmAKitPath(view.activeKit) && layer.has(view.activeKit)
      ? view.activeKit : null;
    const sample = isAdpcmBSamplePath(view.activeSample) && layer.has(view.activeSample) ? view.activeSample : null;
    return { codePath: code, activePatch: matched('activePatch') ? view.activePatch : null, activeSsg: ssg, activeKit: kit, activeSample: sample,
      selected: exists ? view.selected : code, visible: view.visible === true };
  }

  async function restore(next, view, { replace = false, validatedDocuments = new Map() } = {}) {
    const updates = getFm2610CodeExampleUpdates(next);
    const growth = updates.reduce((sum, {path, data}) => sum + size(data) - size(next.working.get(path).data), 0);
    const canUpdate = updates.length > 0 && [next.working, next.saved].every(layer =>
      layer.list().reduce((total, {data}) => total + size(data), growth) <= MAX_BYTES);
    if (canUpdate) {
      next.working.writeFiles(updates);
      next.saveMany(updates.map(({path}) => path));
    }
    const target = viewFor(next.working, view);
    const patch = target.activePatch && readFm2610Patch(JSON.parse(next.working.get(target.activePatch).data));
    const ssg = target.activeSsg ? readSsgPreset(next.working.get(target.activeSsg).data) : createDefaultSsgPreset();
    const kit = target.activeKit
      ? validatedDocuments.get(target.activeKit) ?? await readAdpcmAKit(next.working.get(target.activeKit).data)
      : createDefaultAdpcmAKit();
    const sample = target.activeSample
      ? validatedDocuments.get(target.activeSample) ?? await readAdpcmBSample(next.working.get(target.activeSample).data)
      : null;
    instrumentEdits.clear();
    if (replace) await beforeReplace();
    if (patch) await applyPatch(patch, {show: false});
    await applySsgPreset(ssg, {show: false});
    await applyAdpcmAKit(kit, { show: false });
    await applyAdpcmBSample(sample, { show: false });
    await setCode(next.working.get(target.codePath)?.data ?? '', target.codePath, { show: false });
    workspace.restore(next.snapshot());
    codePath = target.codePath;
    activePatch = target.activePatch;
    activeSsg = target.activeSsg;
    activeKit = target.activeKit;
    activeSample = target.activeSample;
    select(target.selected);
    show(target.visible);
    onVgmChange();
    return canUpdate;
  }

  function download(bytes, filename, type) {
    const url = win.URL.createObjectURL(new win.Blob([bytes], { type }));
    element('a', { href: url, download: filename }).click();
    win.setTimeout(() => win.URL.revokeObjectURL(url), 1000);
  }

  function exportPatch(format) {
    const patch = readFm2610Patch(getPatch());
    const operators = Object.fromEntries(patch.operators.map((operator, index) => [index + 1, operator]));
    const portable = {...patch, operators};
    const bytes = format === 'tfi' ? createTfiFromPreset(portable) : createVgiFromPreset(portable);
    const filename = `${activePatch ? basename(activePatch).replace(PATCH_PATH, '') : 'fm2610-voice'}.${format}`;
    const omitted = portablePatchOmissions(patch, format);
    download(bytes, filename, 'application/octet-stream');
    const notice = omitted.length ? ` Use .fm.json to keep ${omitted.join(', ')}.` : '';
    setStatus(`Exported ${filename}.${notice}`);
  }

  async function exportCassette() {
    flushProjectEdits();
    const { view } = snapshot();
    const drafts = workspace.getDirtyPaths().filter(path => fs.has(path) && workspace.saved.has(path))
      .map(path => {
        const {data} = fs.get(path);
        return typeof data === 'string' ? {path, data} : {path, base64: encodeBytes(data)};
      });
    const bytes = createPlaygroundCassetteZip(workspace.saved.list(), {
      directories: workspace.saved.listDirectories(),
      metadata: { fm2610: { version: 1, autoApply: workspace.autoSave, view, drafts } },
    });
    let storageError;
    try { await persist(); }
    catch (error) { storageError = error; }
    download(bytes, 'tetorica-fm2610.cassette.zip', 'application/zip');
    if (storageError) setStatus('Exported Cassette. Local project storage: ' + storageError.message, true);
    else setStatus('Exported Cassette.');
  }

  async function newCassette() {
    if (!win.confirm('Create a new Cassette? Export first to keep the current project.')) return;
    await restore(freshWorkspace(), { visible: true }, { replace: true });
    await persist();
    setStatus('New Cassette created.');
  }

  async function addCodeExamples() {
    const projectPaths = [...describe(fs), ...describe(workspace.saved)];
    const existing = projectPaths.find(({path}) => path.toLowerCase() === EXAMPLES);
    if (existing?.type === 'file') throw new Error('A project file is using the examples folder name.');
    const directory = existing?.path ?? EXAMPLES;
    const entries = getFm2610CodeExamples().map(({path, data}) => ({path: join(directory, basename(path)), data}))
      .filter(({path}) => !occupied(path));
    if (entries.length) {
      flushProjectEdits();
      writeAccepted(entries);
      await persist();
    }
    expanded.set(directory, true);
    show();
    setStatus(entries.length ? `Added ${entries.length} Code examples.` : 'Code examples are already in Files.');
  }

  async function importCassette(file) {
    const archive = await loadPlaygroundCassette(await file.arrayBuffer());
    const metadata = archive.metadata.fm2610;
    if (metadata?.version !== 1 || !Array.isArray(metadata.drafts) ||
        (metadata.autoApply !== undefined && typeof metadata.autoApply !== 'boolean')) {
      throw new Error('Choose a Tetorica FM2610 Synth Cassette.');
    }
    const entries = [...archive.files].filter(([path]) => !METADATA.has(path)).map(([name, data]) => {
      const path = '/' + name;
      return { path, data: isBinaryPath(path) ? data : decoder.decode(data) };
    });
    entries.forEach(checkEntry);
    for (const directory of archive.directories) checkPath(directory);
    const validatedDocuments = await checkAudioDocuments(entries, metadata.view?.activeKit, metadata.view?.activeSample);
    const next = createVirtualFileWorkspace(entries, { autoSave: false });
    next.working.replace(entries, archive.directories);
    next.saveAll();
    const drafts = metadata.drafts.map(({path, data, base64}) => {
      if ((!CODE_PATH.test(path) && !PATCH_PATH.test(path) && !isSsgPresetPath(path) && !audioDocumentReader(path)) || !next.saved.has(path)) {
        throw new Error('Invalid Cassette file draft.');
      }
      const entry = {path, data: typeof base64 === 'string' && data === undefined
        ? Uint8Array.from(atob(base64), character => character.charCodeAt(0)) : data};
      checkEntry(entry);
      return entry;
    });
    next.working.writeFiles(drafts);
    checkCapacity(next.working.list());
    if (metadata.autoApply === true && next.isDirty()) throw new Error('Auto apply Cassette versions must match.');
    next.setAutoSave(metadata.autoApply ?? !next.isDirty());
    const draftDocuments = await checkAudioDocuments(drafts, metadata.view?.activeKit, metadata.view?.activeSample);
    for (const [path, document] of draftDocuments) validatedDocuments.set(path, document);
    if (!win.confirm('Replace the current project with this Cassette?')) return;
    await restore(next, { ...metadata.view, visible: true }, { replace: true, validatedDocuments });
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
      if (incoming.some(file => /\.zip$/i.test(file.name) && !audioDocumentReader(file.name))) {
        if (incoming.length !== 1) throw new Error('Choose one Cassette at a time.');
        return importCassette(incoming[0]);
      }
      const entries = await Promise.all(incoming.map(async file => {
        if (audioDocumentReader(file.name)) {
          const path = namedPath(isAdpcmAKitPath(file.name) ? KITS : SAMPLES, file.name);
          requireNew(path);
          return { path, data: new Uint8Array(await file.arrayBuffer()) };
        }
        if (PORTABLE_PATCH_PATH.test(file.name)) {
          const path = namedPath(directory, file.name.replace(PORTABLE_PATCH_PATH, '.fm.json'));
          requireNew(path);
          const patch = readPortablePatch(file.name, new Uint8Array(await file.arrayBuffer()));
          return { path, data: JSON.stringify(patch, null, 2) + '\n' };
        }
        const filename = PATCH_PATH.test(file.name) || isSsgPresetPath(file.name)
          ? file.name : file.name.replace(/\.json$/i, '.fm.json');
        const path = namedPath(directory, filename);
        requireNew(path);
        return { path, data: decoder.decode(await file.arrayBuffer()) };
      }));
      const names = new Set(entries.map(({path}) => path.toLowerCase()));
      if (names.size !== entries.length) throw new Error('The selected files would use the same project path.');
      const validatedDocuments = await checkAudioDocuments(entries, entries[0].path);
      flushCode();
      writeAccepted(entries);
      show();
      await open(entries[0].path, validatedDocuments.get(entries[0].path));
      setStatus(incoming.length === 1 && PORTABLE_PATCH_PATH.test(incoming[0].name)
        ? `Imported ${incoming[0].name} as ${basename(entries[0].path)}.`
        : 'Imported ' + entries.length + (entries.length === 1 ? ' file.' : ' files.'));
    });
  }

  async function transfer(from, to, copy = false) {
    checkPath(from);
    checkPath(to);
    if (from === to) return;
    requireNew(to);
    flushProjectEdits();
    const next = candidate();
    transferVirtualFiles(next.working, from, to, { copy });
    if (copy) next.save(to);
    else if (!next.autoSave) {
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
      activeSsg = moved(activeSsg);
      activeKit = moved(activeKit);
      activeSample = moved(activeSample);
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
    flushProjectEdits();
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
    if (inside(activeSsg, path)) activeSsg = null;
    if (inside(activeKit, path)) activeKit = null;
    if (inside(activeSample, path)) activeSample = null;
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
  autoApplyControl.addEventListener('change', () => {
    const enabled = autoApplyControl.checked;
    drive(() => setAutoApply(enabled));
  });
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
    let upgraded = false;
    if (state) {
      if (state.version !== 1 && state.version !== 2) throw new Error('Unsupported FM2610 project.');
      const next = createVirtualFileWorkspace();
      next.restore(state.workspace);
      if (state.version === 1 && !next.isDirty()) next.setAutoSave(true);
      let validatedDocuments;
      for (const layer of [next.working, next.saved]) {
        const entries = layer.list();
        for (const directory of layer.listDirectories()) if (directory !== '/') checkPath(directory);
        entries.forEach(checkEntry);
        checkCapacity(entries);
        const documents = await checkAudioDocuments(entries, state.view?.activeKit, state.view?.activeSample);
        if (layer === next.working) validatedDocuments = documents;
      }
      upgraded = await restore(next, state.view, { validatedDocuments });
    }
    storageReady = true;
    if (upgraded) await persist();
  }).catch(report).finally(() => {
    loading = false;
    refresh();
    onVgmChange();
  });

  return {
    ...codeProject, ready, markCodeEdited, markInstrumentEdited, detachInstrument, setAutoApply,
    isAutoApply: () => workspace.autoSave,
    prepareSource(source, options) {
      flushProjectEdits();
      return codeProject.prepareSource(source, options);
    },
    save, show, addVgmFiles, listVgm, readBinary, saveSsgPreset, saveAdpcmAKit, saveAdpcmBSample,
    getEntryPath: () => codePath,
    listCodeFiles: () => describe(fs)
      .filter(entry => entry.type === 'file' && CODE_PATH.test(entry.path))
      .map(entry => fs.get(entry.path))
      .filter(entry => entry.type === 'text'),
    openCodeFile(path) {
      return operation(() => {
        if (CODE_PATH.test(path)) return open(path);
      });
    },
    detachFmPatch: () => detachInstrument('fm'),
  };
}

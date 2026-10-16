import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createVirtualFileSystem, CHECKPOINT_ROOT, isCheckpointVirtualPath} from './playground_virtual_files.js';
import {createTfiFromPreset, parseTfi} from '../js/tfi.js';
import {createVgiFromPreset, parseVgi} from '../js/vgi.js';
import {instrumentToEditorPreset} from './playground_tfi_editor.js';

const pageSource = readFileSync(new URL('./playground.js', import.meta.url), 'utf8');
const start = pageSource.indexOf('function getEditorValue()');
const end = pageSource.indexOf('function showVirtualFile(file)');
assert(start >= 0 && end > start);
const actionSource = pageSource.slice(start, end);
const code = 'const original = 1;';

function instrument(format, level = 20) {
  const preset = {algorithm: 7, feedback: 3, ams: 2, pms: 5, pan: {left: false, right: true},
    operators: {1: {tl: level}, 2: {tl: 40}, 3: {tl: 60}, 4: {tl: 80}}};
  return format === 'vgi' ? createVgiFromPreset(preset) : createTfiFromPreset(preset);
}

function setup({path = '/index.js', entries = [], autoCheckpoint = false, denyMonaco = false, editorText = code} = {}) {
  const fs = createVirtualFileSystem([{path: '/index.js', data: code}, {path: '/unrelated.js', data: 'keep me'}, ...entries], {autoCheckpoint});
  const timers = new Map(), statuses = [], operations = [], undo = [];
  const calls = {reads: 0, setValue: 0, replaceAll: 0, focus: 0};
  let sequence = 0, text = editorText, titleText = '';
  const title = {get textContent() { return titleText; }, set textContent(value) { titleText = value; operations.push(['title', value]); }};
  const button = () => ({dataset: {}, disabled: false, textContent: 'Sync'});
  const context = vm.createContext({
    virtualFiles: fs, Uint8Array, ArrayBuffer, CHECKPOINT_ROOT, instrumentToEditorPreset,
    activeVirtualPath: '/index.js', activeTfiFilePath: path === '/index.js' ? null : path,
    codeCheckpointCache: null, codeSyncFeedback: null, codeSyncFeedbackTimer: null,
    codePanel: {hidden: false, dataset: {}}, syncCodeButton: button(), revertCodeButton: button(),
    codeFileActions: {}, codeSyncAnnouncement: {}, tfiFileTitle: title,
    isSystemVirtualPath: value => value === '/sys' || value.startsWith('/sys/'),
    isHiddenVirtualPath: value => value === '/sys' || value.startsWith('/sys/') || isCheckpointVirtualPath(value),
    setStatus(message) { statuses.push(message); },
    window: {setTimeout(callback) { timers.set(++sequence, callback); return sequence; }, clearTimeout(id) { timers.delete(id); }},
    document: {getElementById(id) { if (id === 'tfiFileTitle') return title; throw Error('Unexpected element: ' + id); }},
    editorAdapter: {
      getValue() { calls.reads++; assert(!denyMonaco, 'binary actions must not read hidden Monaco'); return text; },
      setValue(value) { calls.setValue++; assert(!denyMonaco, 'binary actions must not reset hidden Monaco'); text = value; },
      replaceAll(value) { calls.replaceAll++; assert(!denyMonaco, 'binary actions must not edit hidden Monaco'); undo.push(text); text = value; },
      focus() { calls.focus++; assert(!denyMonaco, 'binary actions must not focus hidden Monaco'); },
    },
    registerVirtualInstrumentPreset(value) { operations.push(['register', value, fs.get(value).data]); },
    tfiFileEditor: {open(value, data) { operations.push(['open', value, new Uint8Array(data)]); title.textContent = value; }},
  });
  vm.runInContext(actionSource, context);
  fs.onDidChange(context.refreshCodeFileActions);
  context.refreshCodeFileActions();
  return {fs, context, calls, timers, statuses, operations, title,
    refresh: () => context.refreshCodeFileActions(),
    sync: () => context.syncActiveCodeFile(), revert: () => context.revertActiveCodeFile(),
    type(value) { text = value; context.refreshCodeFileActions(); },
    undo() { text = undo.pop(); context.syncActiveEditorFile(); },
    get text() { return text; },
  };
}

for (const [format, extension] of [['tfi', 'tfi'], ['vgi', 'vgi'], ['vgi', 'tfi']]) {
  test(`${format.toUpperCase()} in .${extension}: first edit, Sync and Revert preserve bytes and leave hidden code alone`, async () => {
    const path = '/presets/voice.' + extension;
    const original = instrument(format), edited = instrument(format, 35), later = instrument(format, 55);
    const f = setup({path, entries: [{path, data: original}], denyMonaco: true, editorText: 'unsaved hidden editor'});
    const {syncCodeButton, revertCodeButton} = f.context;
    assert.equal(syncCodeButton.disabled, false);
    assert.equal(revertCodeButton.disabled, true);
    assert.equal(f.fs.checkpoints.get(path), null);
    f.fs.writeBinary(path, edited);
    assert.equal(f.fs.checkpoints.get(path), null, 'ordinary Playground editing does not implicitly create a checkpoint');
    assert.equal(revertCodeButton.disabled, true);
    f.fs.writeBinary(path, later);
    assert.equal(f.fs.checkpoints.get(path), null, 'a first explicit Sync establishes the baseline');
    const codeRevision = f.fs.getRevision('/index.js');
    f.context.saveActiveVirtualFile();
    f.context.syncActiveEditorFile();
    assert.equal(f.calls.reads, 0, 'background editor flush hooks also ignore the hidden code buffer');
    await f.sync();
    assert.deepEqual(f.fs.checkpoints.get(path).data, later);
    assert.equal(revertCodeButton.disabled, true);
    assert.equal(syncCodeButton.dataset.feedback, 'success');
    assert.equal(f.fs.get('/index.js').data, code);
    assert.equal(f.fs.getRevision('/index.js'), codeRevision);
    assert.equal(f.fs.checkpoints.get('/index.js'), null);
    f.fs.writeBinary(path, edited);
    assert.equal(syncCodeButton.textContent, 'Sync', 'a binary edit invalidates Synced feedback');
    assert.equal(f.timers.size, 0);
    assert.equal(revertCodeButton.disabled, false);
    const baselineRevision = f.fs.getRevision(CHECKPOINT_ROOT + path);
    f.revert();
    assert.deepEqual(f.fs.get(path).data, later);
    assert.equal(f.fs.get(path).type, 'binary');
    assert.deepEqual(f.fs.checkpoints.get(path).data, later);
    assert.equal(f.fs.getRevision(CHECKPOINT_ROOT + path), baselineRevision);
    assert.equal(f.fs.get('/index.js').data, code);
    assert.equal(f.fs.get('/unrelated.js').data, 'keep me');
    assert.deepEqual(f.calls, {reads: 0, setValue: 0, replaceAll: 0, focus: 0});
    assert.equal(revertCodeButton.disabled, true);
    const register = f.operations.findIndex(entry => entry[0] === 'register');
    const reload = f.operations.findIndex(entry => entry[0] === 'open');
    assert(register >= 0 && reload > register, 'preset registration precedes reloading the restored editor');
    assert.deepEqual(f.operations[register].slice(1), [path, later]);
    assert.deepEqual(f.operations[reload].slice(1), [path, later]);
    assert.equal(f.operations.at(-1)[0], 'title', 'reloading the restored preview refreshes its file title');
    assert.match(f.title.textContent, /voice\./);
    const parsed = format === 'vgi' ? parseVgi(f.fs.get(path).data) : parseTfi(f.fs.get(path).data);
    assert.equal(parsed.operators[1].tl, 55);
    if (format === 'vgi') {
      assert.equal(f.fs.get(path).data.length, 43);
      assert.equal(parsed.ams, 2);
      assert.equal(parsed.pms, 5);
      assert.deepEqual(parsed.pan, {left: false, right: true});
    }
  });
}

test('binary checkpoint equality compares bytes rather than copied array identity', async () => {
  const path = '/presets/a.tfi', original = instrument('tfi');
  const f = setup({path, entries: [{path, data: original}], denyMonaco: true});
  await f.sync();
  f.fs.writeBinary(path, new Uint8Array(original));
  f.refresh();
  assert.equal(f.context.revertCodeButton.disabled, true);
  assert.equal(f.context.syncCodeButton.dataset.feedback, 'success');
  const modified = new Uint8Array(original); modified[5] ^= 1;
  f.fs.writeBinary(path, modified);
  assert.equal(f.context.revertCodeButton.disabled, false);
  assert.equal(f.context.syncCodeButton.dataset.feedback, undefined);
  f.fs.writeBinary(path, original.slice(0, -1));
  assert.equal(f.context.revertCodeButton.disabled, false, 'different byte lengths are modified');
});

test('text Sync flushes the current editor; Revert keeps Undo and typing invalidates feedback', async () => {
  const f = setup();
  f.type('const edited = 2;');
  assert.equal(f.fs.get('/index.js').data, code, 'typing can be newer than the VFS');
  await f.sync();
  assert.equal(f.fs.get('/index.js').data, f.text);
  assert.equal(f.fs.checkpoints.get('/index.js').data, f.text);
  assert.equal(f.context.syncCodeButton.dataset.feedback, 'success');
  f.type('const unsaved = 3;');
  assert.equal(f.context.syncCodeButton.dataset.feedback, undefined);
  assert.equal(f.context.revertCodeButton.disabled, false);
  f.revert();
  assert.equal(f.text, 'const edited = 2;');
  assert.equal(f.calls.replaceAll, 1);
  assert.equal(f.calls.setValue, 0, 'Monaco setValue would discard Undo');
  assert.equal(f.calls.focus, 1);
  f.undo();
  assert.equal(f.text, 'const unsaved = 3;');
  assert.equal(f.fs.get('/index.js').data, 'const unsaved = 3;');
  assert.equal(f.fs.checkpoints.get('/index.js').data, 'const edited = 2;');
  assert.equal(f.context.revertCodeButton.disabled, false);
});

test('a pending binary Sync cannot show success for later bytes or another selected file', async () => {
  const path = '/presets/a.tfi', original = instrument('tfi');
  const f = setup({path, entries: [{path, data: original}, {path: '/presets/b.tfi', data: original}], denyMonaco: true});
  const sync = f.fs.sync;
  let finish;
  f.fs.sync = async value => { const result = await sync(value); await new Promise(resolve => { finish = resolve; }); return result; };
  const pending = f.sync();
  await new Promise(setImmediate);
  f.fs.writeBinary(path, instrument('tfi', 50));
  finish(); await pending;
  assert.equal(f.context.syncCodeButton.dataset.feedback, undefined);
  assert.equal(f.context.revertCodeButton.disabled, false);
  const second = f.sync();
  await new Promise(setImmediate);
  f.context.activeTfiFilePath = '/presets/b.tfi'; f.refresh();
  finish(); await second;
  assert.equal(f.context.syncCodeButton.dataset.feedback, undefined);
  assert.equal(f.timers.size, 0);
});

test('checkpoint replacement and panel changes clear stale Sync feedback', async () => {
  const path = '/presets/a.vgi', original = instrument('vgi');
  const f = setup({path, entries: [{path, data: original}], denyMonaco: true});
  await f.sync();
  f.fs.writeBinary(CHECKPOINT_ROOT + path, instrument('vgi', 70));
  assert.equal(f.context.syncCodeButton.dataset.feedback, undefined);
  assert.equal(f.context.revertCodeButton.disabled, false);
  await f.sync();
  f.context.codePanel.hidden = true; f.refresh();
  assert.equal(f.context.syncCodeButton.disabled, true);
  assert.equal(f.context.revertCodeButton.disabled, true);
  assert.equal(f.context.syncCodeButton.dataset.feedback, undefined);
});

test('wrong-type checkpoints disable Revert and cannot mutate a binary preview or text buffer', () => {
  const path = '/presets/a.tfi', original = instrument('tfi');
  const f = setup({path, entries: [{path, data: original}, {path: CHECKPOINT_ROOT + path, data: 'not binary'}], denyMonaco: true});
  assert.equal(f.context.revertCodeButton.disabled, true);
  assert.match(f.context.revertCodeButton.title, /different file type/i);
  const before = f.fs.snapshot();
  f.revert();
  assert.deepEqual(f.fs.snapshot(), before);
  assert.deepEqual(f.operations, []);
  assert.equal(f.calls.reads, 0);
  assert.match(f.statuses.at(-1), /different file type/i);
  const text = setup({entries: [{path: CHECKPOINT_ROOT + '/index.js', data: original}], editorText: 'unsaved code'});
  assert.equal(text.context.revertCodeButton.disabled, true);
  text.revert();
  assert.equal(text.text, 'unsaved code');
  assert.equal(text.fs.get('/index.js').data, code);
  assert.equal(text.calls.replaceAll, 0);
});

for (const format of ['tfi', 'vgi']) {
  test(`invalid ${format.toUpperCase()} checkpoint bytes are rejected before changing the working file or preview`, () => {
    const path = '/presets/a.' + format, original = instrument(format);
    const f = setup({path, entries: [{path, data: original}, {path: CHECKPOINT_ROOT + path, data: new Uint8Array([1, 2, 3])}], denyMonaco: true});
    const before = f.fs.snapshot(), revision = f.fs.getRevision(path);
    f.revert();
    assert.deepEqual(f.fs.snapshot(), before);
    assert.equal(f.fs.getRevision(path), revision);
    assert.deepEqual(f.operations, []);
    assert.deepEqual(f.calls, {reads: 0, setValue: 0, replaceAll: 0, focus: 0});
    assert.match(f.statuses.at(-1), /Could not revert/);
  });
}

test('internal paths and a hidden primary editor cannot be synced or reverted', async () => {
  for (const path of ['/sys/a.tfi', '/.tet.ss/a.tfi', '/.git/a.tfi', '/project/.git/a.tfi']) {
    const f = setup({path, entries: [{path, data: instrument('tfi')}], denyMonaco: true});
    const before = f.fs.snapshot();
    assert.equal(f.context.syncCodeButton.disabled, true, path);
    assert.equal(f.context.revertCodeButton.disabled, true, path);
    await f.sync();
    f.revert();
    assert.deepEqual(f.fs.snapshot(), before, path);
    assert.equal(f.calls.reads, 0);
  }
  const f = setup({path: '/presets/a.vgi', entries: [{path: '/presets/a.vgi', data: instrument('vgi')}], denyMonaco: true});
  f.context.codePanel.hidden = true; f.refresh();
  const before = f.fs.snapshot();
  await f.sync(); f.revert();
  assert.deepEqual(f.fs.snapshot(), before);
  assert.equal(f.context.codeFileActions.hidden, true);
});

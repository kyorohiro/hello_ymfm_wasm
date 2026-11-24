// SPDX-License-Identifier: BSD-3-Clause
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {selectFm2610CodeDeclarations} from './code_declarations.js';
import {setupFm2610CodeEditor} from './code_editor.js';

test('FM2610 declarations expose the same nested APIs and distinct FM channel counts as Code', async () => {
  const shared = await readFile(new URL('../playground/tetorica-playground-globals.d.ts', import.meta.url), 'utf8');
  const declarations = selectFm2610CodeDeclarations(shared);
  assert.match(declarations, /ym2610: .*Fm2610CodeFm<0 \| 1 \| 2 \| 3>/);
  assert.match(declarations, /ym2610b: .*Fm2610BCodeFm/);
  assert.match(declarations, /readonly ssg: Fm2610CodeSsg;\s+readonly adpcmA: Fm2610CodeAdpcmA;\s+readonly adpcmB: Fm2610CodeAdpcmB;/);
  const [adpcmA, adpcmB] = ['A', 'B'].map(section =>
    new RegExp(`interface Fm2610CodeAdpcm${section} \\{[\\s\\S]*?\\n\\}`).exec(declarations)?.[0]);
  assert.match(adpcmA, /setVoice\(/);
  assert.doesNotMatch(adpcmA, /setDeltaN|setPlaybackRate/);
  assert.match(adpcmB, /setDeltaN\(/);
  assert.match(adpcmB, /setPlaybackRate\(/);
  assert.doesNotMatch(adpcmB, /loadSample|setVoice/);
  assert.match(declarations, /declare function liveLoop\(/);
  assert.match(declarations, /declare function liveFx<[^>]+>\(/);
  assert.match(declarations, /declare function atob\(data: string\): string;/);
  assert.match(declarations, /declare const fx\b/);
  assert.match(declarations, /schedule\(program: Fm2610OperationProgram/);
  assert.doesNotMatch(declarations, /declare (?:function|const) (?:play|createSoundChip)\b/);
});

test('Code editor loads lazily, mirrors drafts and preserves both shortcut paths', async () => {
  const listeners = new Map(), shortcuts = new Map(), runs = [], models = new Map();
  let edited = 0, initialized = 0, visible = false, path = '/index.js';
  let currentSource, changed, disposed = false, options;
  const textarea = {value: 'starter', ownerDocument: {},
    addEventListener: (name, callback) => listeners.set(name, callback),
    removeEventListener: name => listeners.delete(name)};
  const editorNote = {};
  const editor = setupFm2610CodeEditor({
    textarea, editorHost: {}, editorNote, getPath: () => path, whenReady: () => {},
    listFiles: () => [], openFile: () => {}, onEdit: () => edited++,
    run: apply => runs.push(apply), visible: () => visible,
    async initialize(value) {
      initialized++;
      options = value;
      currentSource = value.getEditorValue();
      value.setEditorAdapter({
        openVirtualFile(nextPath, source) {
          currentSource = models.get(nextPath) ?? source;
          changed();
        },
        syncVirtualFiles() {},
        getValue: () => currentSource,
        setValue(source) { currentSource = source; changed(); },
      });
      value.onMonacoEditorReady({
        monaco: {KeyMod: {CtrlCmd: 1, Shift: 2}, KeyCode: {Enter: 4}},
        monacoEditor: {
          updateOptions() {}, layout() {},
          onDidChangeModelContent: callback => { changed = callback; },
          addCommand: (key, callback) => shortcuts.set(key, callback),
          dispose: () => { disposed = true; },
        },
      });
    },
  });

  listeners.get('input')();
  assert.equal(edited, 1, 'the fallback textarea uses the same draft path');
  for (const shiftKey of [false, true]) {
    listeners.get('keydown')({key: 'Enter', ctrlKey: true, shiftKey, preventDefault() {}});
  }
  await editor.load();
  assert.equal(initialized, 0);
  visible = true;
  await Promise.all([editor.load(), editor.load()]);
  assert.equal(initialized, 1);
  assert.equal(options.requireJavaScriptWorker, true);
  assert.equal(options.playgroundHints, false);
  assert.equal(editorNote.hidden, true);
  currentSource = 'typed in Monaco';
  changed();
  assert.equal(textarea.value, 'typed in Monaco');
  assert.equal(edited, 2);
  path = '/modules/percussion.js';
  models.set(path, 'stale model');
  editor.setSource('new Cassette source', path);
  assert.equal(currentSource, 'new Cassette source');
  assert.equal(textarea.value, 'new Cassette source');
  assert.equal(edited, 2);
  shortcuts.get(5)();
  shortcuts.get(7)();
  assert.deepEqual(runs, [false, true, false, true]);
  editor.dispose();
  assert.ok(disposed);
  assert.equal(listeners.size, 0);
});

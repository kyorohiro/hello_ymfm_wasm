import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { tfiToEditorPreset } from './playground_tfi_editor.js';
import { createTfiFromPreset, parseTfi } from '../js/tfi.js';

const bytes = createTfiFromPreset({ algorithm: 4, feedback: 3,
  operators: { 1: { tl: 11 }, 2: { tl: 22 }, 3: { tl: 33 }, 4: { tl: 44 } } });

test('TFI editor preserves all four logical operators through loading and saving', () => {
  const preset = tfiToEditorPreset(bytes);
  assert.deepEqual(preset.operators.map(op => op.tl), [11, 22, 33, 44]);
  const editorState = { ...preset, operators: Object.fromEntries(preset.operators.map((op, i) => [i + 1, op])) };
  assert.deepEqual(createTfiFromPreset(editorState), bytes);
});

test('file editing saves to the opened path and preview audio starts only on audition', async () => {
  let operatorOptions, keyboardOptions, currentPreset;
  let starts = 0;
  const saves = [];
  const root = {};
  const title = {};
  const source = readFileSync(new URL('./playground_tfi_editor.js', import.meta.url), 'utf8')
    .replace(/^import .*;\n/gm, '').replaceAll('export function', 'function');
  const context = vm.createContext({ parseTfi, createTfiFromPreset,
    createPlaygroundOperatorTab(options) {
      operatorOptions = options;
      return {
        selectPreset() { currentPreset = options.presets.file; options.onEdit(); },
        getChannelPreset() { return { ...currentPreset, operators: Object.fromEntries(currentPreset.operators.map((op, i) => [i + 1, op])) }; },
        attachSynth() {},
      };
    },
    createPlaygroundOperatorKeyboard(options) {
      keyboardOptions = options;
      return { setView() {}, attachSynth() {}, dispose() {} };
    },
  });
  vm.runInContext(source, context);
  const editor = context.createTfiFileEditor({ root, title,
    createAudio: () => ({ async start() { starts++; }, async resume() {}, close() {}, setMasterVolume() {}, fm: {} }),
    onSave: (path, data) => saves.push({ path, data }),
  });
  editor.open('/presets/a.tfi', bytes);
  assert.equal(starts, 0);
  assert.equal(saves.length, 0);
  currentPreset.operators[2].tl = 60;
  operatorOptions.onEdit();
  assert.equal(saves[0].path, '/presets/a.tfi');
  assert.equal(parseTfi(saves[0].data).operators[3].tl, 60);
  editor.open('/presets/b.tfi', bytes);
  operatorOptions.onEdit();
  assert.equal(saves[1].path, '/presets/b.tfi');
  await keyboardOptions.ensureAudioReady();
  await keyboardOptions.ensureAudioReady();
  assert.equal(starts, 1);
  editor.setVisible(false);
  assert.equal(root.hidden, true);
  editor.dispose();
});

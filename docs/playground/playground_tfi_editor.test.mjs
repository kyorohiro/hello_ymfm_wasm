import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import {
  tfiToEditorPreset, instrumentToEditorPreset, createInstrumentFromEditorPreset,
} from './playground_tfi_editor.js';
import { createTfiFromPreset, parseTfi } from '../js/tfi.js';
import { createVgiFromPreset, parseVgi } from '../js/vgi.js';

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
  const context = vm.createContext({ parseTfi, createTfiFromPreset, parseVgi, createVgiFromPreset,
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

test('VGI editing keeps its format, logical operators, pan, AMS/PMS and uneditable B4 bit', () => {
  const vgi = createVgiFromPreset({
    algorithm: 5, feedback: 6, b4: 0xbD,
    operators: { 1: { tl: 11 }, 2: { tl: 22 }, 3: { tl: 33 }, 4: { tl: 44 } },
  });
  const preset = instrumentToEditorPreset('/presets/track/voice.VGI', vgi);
  assert.deepEqual(preset.operators.map(op => op.tl), [11, 22, 33, 44]);
  assert.equal(preset.ams, 3);
  assert.equal(preset.pms, 5);
  assert.deepEqual(preset.pan, { left: true, right: false });
  const state = {
    ...preset,
    operators: Object.fromEntries(preset.operators.map((op, i) => [i + 1, op])),
  };
  assert.deepEqual(createInstrumentFromEditorPreset('/presets/track/voice.VGI', state), vgi);
  state.ams = 1;
  state.pms = 2;
  state.pan = { left: false, right: true };
  state.operators[3].tl = 60;
  const edited = createInstrumentFromEditorPreset('/presets/track/voice.VGI', state);
  assert.equal(edited.length, 43);
  assert.equal(edited[2], 0x5a);
  assert.equal(parseVgi(edited).operators[3].tl, 60);
  assert.deepEqual(parseVgi(edited).pan, state.pan);
});

test('VGI file editor saves the changed instrument to the opened VGI path', () => {
  let operatorOptions, currentPreset;
  const saves = [];
  const source = readFileSync(new URL('./playground_tfi_editor.js', import.meta.url), 'utf8')
    .replace(/^import .*;\n/gm, '').replaceAll('export function', 'function');
  const context = vm.createContext({ parseTfi, createTfiFromPreset, parseVgi, createVgiFromPreset,
    createPlaygroundOperatorTab(options) {
      operatorOptions = options;
      return {
        selectPreset() { currentPreset = options.presets.file; options.onEdit(); },
        getChannelPreset() {
          return { ...currentPreset, operators: Object.fromEntries(currentPreset.operators.map((op, i) => [i + 1, op])) };
        },
      };
    },
    createPlaygroundOperatorKeyboard() { return { setView() {} }; },
  });
  vm.runInContext(source, context);
  const editor = context.createTfiFileEditor({ root: {}, title: {},
    onSave: (path, data) => saves.push({ path, data }),
  });
  const vgi = createVgiFromPreset({ algorithm: 3, feedback: 4, ams: 2, pms: 6, pan: { left: false, right: true } });
  editor.open('/presets/a/voice.vgi', vgi);
  assert.equal(saves.length, 0);
  currentPreset.operators[0].tl = 17;
  operatorOptions.onEdit();
  assert.equal(saves[0].path, '/presets/a/voice.vgi');
  assert.equal(saves[0].data.length, 43);
  const saved = parseVgi(saves[0].data);
  assert.equal(saved.operators[1].tl, 17);
  assert.equal(saved.ams, 2);
  assert.equal(saved.pms, 6);
  assert.deepEqual(saved.pan, { left: false, right: true });
  editor.open('/presets/a/renamed.tfi', vgi);
  operatorOptions.onEdit();
  assert.equal(saves[1].path, '/presets/a/renamed.tfi');
  assert.deepEqual(saves[1].data, vgi, 'A renamed VGI keeps its actual 43-byte format');
});

test('nested VGI assets register in the Playground preset list with unique virtual paths', () => {
  const source = readFileSync(new URL('./playground.js', import.meta.url), 'utf8');
  const registration = source.slice(source.indexOf('function registerVirtualInstrumentPreset(path)'),
    source.indexOf('function clearVirtualInstrumentPresets()'));
  const vgi = createVgiFromPreset({ algorithm: 2, feedback: 1, ams: 3, pms: 5 });
  const files = new Map([
    ['/presets/game-a/YM2612_CH1.vgi', { type: 'binary', data: vgi }],
    ['/presets/game-b/YM2612_CH1.vgi', { type: 'binary', data: vgi }],
    ['/presets/original.tfi', { type: 'binary', data: bytes }],
    ['/presets/README.md', { type: 'text', data: 'Notes' }],
    ['/outside.vgi', { type: 'binary', data: vgi }],
  ]);
  const options = [];
  const context = vm.createContext({
    instrumentToEditorPreset, virtualPresetIds: new Map(), playgroundPresets: {}, runtime: { presets: {} },
    virtualFiles: { get: path => files.get(path), list: () => [...files].map(([path, file]) => ({ path, ...file })) },
    operatorTab: { registerPresetOption: (id, label) => options.push([id, label]) },
  });
  vm.runInContext(registration, context);
  context.registerVirtualInstrumentPresets();
  assert.deepEqual(options.map(([, label]) => label), ['game-a/YM2612_CH1.vgi', 'game-b/YM2612_CH1.vgi', 'original.tfi']);
  assert.equal(context.virtualPresetIds.size, 3);
  assert.equal(context.runtime.presets['vfs:/presets/game-a/YM2612_CH1.vgi'].ams, 3);
  assert.equal(context.runtime.presets['vfs:/presets/game-b/YM2612_CH1.vgi'].pms, 5);
});

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
  const previewRuntime = {};
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
    createAudio: () => ({ audio: previewRuntime, async start() { starts++; }, async resume() {}, close() {}, setMasterVolume() {}, fm: {} }),
    onSave: (path, data) => saves.push({ path, data }),
  });
  editor.open('/presets/a.tfi', bytes);
  assert.equal(editor.getAudioRuntime(), null);
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
  assert.equal(editor.getAudioRuntime(), previewRuntime);
  editor.setVisible(false);
  assert.equal(root.hidden, true);
  editor.dispose();
  assert.equal(editor.getAudioRuntime(), null);
});

function auditionEditor({deferredStart = false, deferredResume = false, deferredSuspend = false} = {}) {
  const calls = {create: 0, start: 0, resume: 0, suspend: 0, close: 0, keyboardDispose: 0, volume: [], views: [], attachments: []};
  const previewRuntime = {audioContext: {state: 'running'}, masterOutputNode: {}};
  let finishStart, finishResume, finishSuspend;
  const startPromise = deferredStart ? new Promise(resolve => { finishStart = resolve; }) : Promise.resolve();
  const resumePromise = deferredResume ? new Promise(resolve => { finishResume = resolve; }) : Promise.resolve();
  const suspendReady = deferredSuspend ? new Promise(resolve => { finishSuspend = resolve; }) : Promise.resolve();
  const synth = {audio: previewRuntime, fm: {},
    async start() { calls.start++; await startPromise; previewRuntime.audioContext.state = 'running'; },
    async resume() { calls.resume++; await resumePromise; previewRuntime.audioContext.state = 'running'; },
    async suspend() { calls.suspend++; await suspendReady; previewRuntime.audioContext.state = 'suspended'; },
    close() { calls.close++; previewRuntime.audioContext.state = 'closed'; },
    setMasterVolume(volume) { calls.volume.push(volume); },
  };
  let keyboardOptions, currentPreset;
  const source = readFileSync(new URL('./playground_tfi_editor.js', import.meta.url), 'utf8')
    .replace(/^import .*;\n/gm, '').replaceAll('export function', 'function');
  const context = vm.createContext({parseTfi, createTfiFromPreset, parseVgi, createVgiFromPreset,
    createPlaygroundOperatorTab(options) {
      return {
        selectPreset() { currentPreset = options.presets.file; options.onEdit(); },
        getChannelPreset() { return {...currentPreset, operators: Object.fromEntries(currentPreset.operators.map((op, i) => [i + 1, op]))}; },
        attachSynth(fm) { calls.attachments.push(['operator', fm]); },
      };
    },
    createPlaygroundOperatorKeyboard(options) {
      keyboardOptions = options;
      return {
        setView(view) { calls.views.push(view); },
        attachSynth(fm) { calls.attachments.push(['keyboard', fm]); },
        dispose() { calls.keyboardDispose++; },
      };
    },
  });
  vm.runInContext(source, context);
  const root = {};
  const editor = context.createTfiFileEditor({root, title: {}, onSave() {},
    createAudio() { calls.create++; return synth; },
  });
  return {editor, root, calls, synth, previewRuntime,
    audition: () => keyboardOptions.ensureAudioReady(), finishStart, finishResume, finishSuspend};
}

async function until(predicate) {
  for (let i = 0; i < 100; i++) { if (predicate()) return; await Promise.resolve(); }
  assert.fail('Async boundary was not reached');
}

for (const format of ['tfi', 'vgi']) {
  test(`${format.toUpperCase()} preview runtime access is lazy, stable, and cleared by disposal`, async () => {
    const f = auditionEditor();
    const instrument = format === 'tfi' ? bytes : createVgiFromPreset({algorithm: 7, feedback: 0});
    assert.equal(f.editor.getAudioRuntime(), null);
    f.editor.open(`/presets/voice.${format}`, instrument);
    f.editor.setVisible(false);
    f.editor.setMasterVolume(2.5);
    for (let i = 0; i < 5; i++) assert.equal(f.editor.getAudioRuntime(), null);
    assert.equal(f.calls.create, 0);
    assert.equal(f.calls.start, 0);
    assert.equal(f.calls.resume, 0);
    f.editor.setVisible(true);
    await f.audition();
    assert.equal(f.editor.getAudioRuntime(), f.previewRuntime);
    assert.deepEqual(f.calls.attachments, [['operator', f.synth.fm], ['keyboard', f.synth.fm]]);
    assert.deepEqual(f.calls.volume, [2.5]);
    for (let i = 0; i < 20; i++) assert.equal(f.editor.getAudioRuntime(), f.previewRuntime);
    assert.equal(f.calls.create, 1);
    assert.equal(f.calls.start, 1);
    assert.equal(f.calls.resume, 1, 'monitor reads must not resume audio');
    f.editor.setVisible(false);
    await until(() => f.previewRuntime.audioContext.state === 'suspended');
    assert.equal(f.root.hidden, true);
    assert.equal(f.calls.views.at(-1), 'code', 'hiding still tells the keyboard to release its audition');
    assert.equal(f.editor.getAudioRuntime(), f.previewRuntime, 'visibility does not destroy the reusable runtime');
    assert.equal(f.calls.close, 0);
    assert.equal(f.calls.resume, 1);
    assert.equal(f.calls.suspend, 1, 'a hidden preview cannot keep its long release audible');
    f.editor.setVisible(true);
    f.editor.open(`/presets/another.${format}`, instrument);
    assert.equal(f.editor.getAudioRuntime(), f.previewRuntime);
    assert.equal(f.calls.start, 1);
    assert.equal(f.calls.resume, 1, 'showing or changing files must not create an audio gesture');
    await f.audition();
    assert.equal(f.calls.start, 1);
    assert.equal(f.calls.resume, 2);
    assert.equal(f.previewRuntime.audioContext.state, 'running');
    f.editor.dispose();
    f.editor.dispose();
    for (let i = 0; i < 5; i++) assert.equal(f.editor.getAudioRuntime(), null);
    assert.equal(f.calls.keyboardDispose, 1, 'disposal still releases the keyboard');
    assert.equal(f.calls.close, 1);
    assert.equal(f.calls.create, 1);
    assert.equal(f.calls.resume, 2);
  });
}

test('reading or hiding a preparing preview does not start another session or attach after disposal', async () => {
  const f = auditionEditor({deferredStart: true});
  f.editor.open('/presets/voice.tfi', bytes);
  const ready = f.audition();
  for (let i = 0; i < 10; i++) f.editor.getAudioRuntime();
  f.editor.setVisible(false);
  assert.equal(f.calls.views.at(-1), 'code');
  assert.equal(f.calls.create, 1);
  assert.equal(f.calls.start, 1);
  assert.equal(f.calls.resume, 0);
  f.editor.dispose();
  assert.equal(f.editor.getAudioRuntime(), null);
  f.finishStart();
  await ready;
  assert.equal(f.editor.getAudioRuntime(), null);
  assert.equal(f.calls.resume, 0);
  assert.deepEqual(f.calls.attachments, []);
  assert.equal(f.calls.close, 1);
});

test('hiding during preview initialization suspends its late completion without resuming it', async () => {
  const f = auditionEditor({deferredStart:true});
  f.editor.open('/presets/voice.tfi', bytes);
  const ready = f.audition();
  f.editor.setVisible(false);
  await until(() => f.calls.suspend === 1);
  f.finishStart();
  await ready;
  assert.equal(f.previewRuntime.audioContext.state,'suspended');
  assert.equal(f.calls.resume,0,'a hidden audition never explicitly resumes');
  f.editor.setVisible(true);
  assert.equal(f.previewRuntime.audioContext.state,'suspended','showing the file alone does not play its tail');
  await f.audition();
  assert.equal(f.calls.start,1,'the existing patch and runtime are reused');
  assert.equal(f.previewRuntime.audioContext.state,'running');
  f.editor.dispose();
});

test('a pending resume cannot leave a hidden preview running', async () => {
  const f = auditionEditor({deferredResume:true});
  f.editor.open('/presets/voice.tfi',bytes);
  const ready = f.audition();
  await until(() => f.calls.resume === 1);
  f.editor.setVisible(false);
  await until(() => f.previewRuntime.audioContext.state === 'suspended');
  f.finishResume();
  await ready;
  assert.equal(f.previewRuntime.audioContext.state,'suspended');
  assert.equal(f.calls.suspend,2,'the resumed hidden context is suspended again');
  f.editor.dispose();
});

test('a visible audition waits for an earlier hide suspension before resuming', async () => {
  const f = auditionEditor({deferredSuspend:true});
  f.editor.open('/presets/voice.tfi',bytes);
  await f.audition();
  f.editor.setVisible(false);
  await until(() => f.calls.suspend === 1);
  f.editor.setVisible(true);
  const ready = f.audition();
  await Promise.resolve();
  assert.equal(f.calls.resume,1,'resume must not race ahead of a pending suspend');
  f.finishSuspend();
  await ready;
  assert.equal(f.calls.resume,2);
  assert.equal(f.previewRuntime.audioContext.state,'running');
  f.editor.dispose();
});

test('disposal cancels a queued hide suspension and later auditions remain inactive', async () => {
  const f = auditionEditor();
  f.editor.open('/presets/voice.tfi',bytes);
  await f.audition();
  f.editor.setVisible(false);
  f.editor.dispose();
  await Promise.resolve(); await Promise.resolve();
  assert.equal(f.calls.suspend,0,'a closed preview receives no later suspension request');
  f.editor.setVisible(true);
  await f.audition();
  assert.equal(f.calls.resume,1);
  assert.equal(f.calls.close,1);
  assert.equal(f.previewRuntime.audioContext.state,'closed');
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
  const additionalOptions = [];
  const context = vm.createContext({
    instrumentToEditorPreset, virtualPresetIds: new Map(), playgroundPresets: {}, runtime: { presets: {} },
    virtualFiles: { get: path => files.get(path), list: () => [...files].map(([path, file]) => ({ path, ...file })) },
    operatorTab: { registerPresetOption: (id, label) => options.push([id, label]) },
    extraFmEditor: { registerPresetOption: (id, label) => additionalOptions.push([id, label]) },
  });
  vm.runInContext(registration, context);
  context.registerVirtualInstrumentPresets();
  assert.deepEqual(options.map(([, label]) => label), ['game-a/YM2612_CH1.vgi', 'game-b/YM2612_CH1.vgi', 'original.tfi']);
  assert.deepEqual(additionalOptions, options);
  assert.equal(context.virtualPresetIds.size, 3);
  assert.equal(context.runtime.presets['vfs:/presets/game-a/YM2612_CH1.vgi'].ams, 3);
  assert.equal(context.runtime.presets['vfs:/presets/game-b/YM2612_CH1.vgi'].pms, 5);
});

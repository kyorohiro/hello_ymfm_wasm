import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

test('TFI selection, edit download, independent audition volume, and tab visibility', () => {
  const elements = new Map();
  function element() { return {
    children: [], listeners: {}, value: '',
    appendChild(node) { this.children.push(node); },
    replaceChildren() { this.children = []; },
    addEventListener(name, fn) { this.listeners[name] = fn; },
    blur() {}, click() {},
    querySelector(name) { if (!elements.has(name)) elements.set(name, element()); return elements.get(name); },
  }; }
  const root = element();
  let editorOptions;
  const opened = [];
  const visibility = [];
  let volume;
  let blob;
  const source = readFileSync(new URL('./tfi_info.js', import.meta.url), 'utf8')
    .replace(/^import .*;\n/gm, '').replace('export function', 'function');
  const context = vm.createContext({
    document: { createElement: element },
    Blob: class { constructor(parts) { blob = parts[0]; } },
    URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} }, setTimeout() {},
    createVgmPresetFiles: () => [{ path: '/presets/song/ch1.tfi', data: new Uint8Array([1]) }],
    createTfiFileEditor(options) {
      editorOptions = options;
      return { open: (...args) => opened.push(args), setVisible: value => visibility.push(value),
        setMasterVolume: value => { volume = value; }, dispose() {} };
    },
  });
  vm.runInContext(source, context);
  const info = context.mountTfiInfo({ root, onStatus() {} });
  info.loadVgm(null, 'song.vgm');
  const select = root.querySelector('select');
  assert.equal(select.children[1].textContent, 'song/ch1.tfi');
  info.setVisible(true);
  assert.equal(visibility.at(-1), false);
  select.value = select.children[1].value;
  select.listeners.change();
  assert.equal(opened.length, 1);
  assert.equal(visibility.at(-1), true);
  const edited = new Uint8Array([2]);
  editorOptions.onSave(select.value, edited);
  root.querySelector('button').listeners.click();
  assert.equal(blob, edited);
  root.querySelector('.tfi-volume').value = '250';
  root.querySelector('.tfi-volume').listeners.input();
  assert.equal(volume, 2.5);
  assert.equal(blob, edited);
  info.setVisible(false);
  assert.equal(visibility.at(-1), false);
  info.loadVgm(null, 'next.vgm');
  assert.equal(root.querySelector('button').disabled, true);
});

test('TFI tab switching and first audition leave VGM playback running', () => {
  const source = readFileSync(new URL('./vgm_analyzer.js', import.meta.url), 'utf8');
  const nodes = new Map();
  const element = () => ({
    setAttribute() {}, addEventListener() {}, prepend() {},
    querySelector(selector) { if (!nodes.has(selector)) nodes.set(selector, element()); return nodes.get(selector); },
  });
  const panelSource = readFileSync(new URL('./tfi_info.js', import.meta.url), 'utf8')
    .replace(/^import .*;\n/gm, '').replace('export function', 'function');
  let editorOptions;
  const synths = [];
  let stopped = 0;
  const context = vm.createContext({
    document: { getElementById: element, createElement: element }, window: { addEventListener() {} },
    createTfiFileEditor(options) { editorOptions = options; return { setVisible() {}, dispose() {} }; },
    MegaSynth: class { constructor(options) { this.options = options; synths.push(this); } },
    mountOpmInfo() { return {setVisible() {},dispose() {}}; },
    mountYm2413Monitor() { return {}; },
    sheetMusicPanel:element(),sheetMusicTab:element(),musicSheet:null,currentBuffer:null,midiExportAvailable:false,
    setStatus() {}, currentChipKind: 'ym2612',
    player: { isPlaying: () => true, pause: () => stopped++, stop: () => stopped++ },
    pauseButton: { click: () => stopped++ },
    samplePanel: element(), sampleTab: element(), sampleExplorer: { stop() {} },
    operatorInfoTab: element(), parsedOutputTab: element(), noteishTab: element(),
    operatorInfoPanel: element(), parsedOutputPanel: element(), noteishPanel: element(),
    songTimeline: { active() {} }, noteishViewMode: 'song',
  });
  vm.runInContext(panelSource, context);
  vm.runInContext(source.slice(source.indexOf('const tfiInfoTab ='), source.indexOf('\noperatorInfoTab.addEventListener', source.indexOf('const tfiInfoTab ='))), context);
  context.setOutputTab('tfi-info');
  const audition = editorOptions.createAudio();
  assert.equal(synths.length, 1);
  assert.notEqual(audition, context.player);
  assert.equal(audition.options.audioContext, undefined); // Own context, not the VGM context.
  context.setOutputTab('operator-info');
  context.setOutputTab('tfi-info');
  assert.equal(stopped, 0);
});

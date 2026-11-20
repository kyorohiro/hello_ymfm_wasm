import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {setupSynthExpandedTabs} from '../synth/synth_expanded_tabs.js';
import {createYmCodeProject, YM_PROJECT_FILE_BYTES} from './code_project.js';
import {createDefaultPreset} from './preset.js';

class Element {
  constructor(doc, tagName = 'div') {
    this.ownerDocument = doc;
    this.tagName = tagName;
    this.children = [];
    this.parentNode = null;
    this.attributes = {};
    this.dataset = {};
    this.listeners = new Map();
    this.hidden = false;
    this.disabled = false;
    const classes = new Set();
    this.classList = {
      add: (...names) => names.forEach(name => classes.add(name)),
      remove: (...names) => names.forEach(name => classes.delete(name)),
      contains: name => classes.has(name),
      toggle: (name, on) => {
        if (on ?? !classes.has(name)) classes.add(name);
        else classes.delete(name);
      },
    };
  }
  append(...nodes) {
    for (const node of nodes) {
      node.remove();
      this.children.push(node);
      node.parentNode = this;
    }
  }
  insertBefore(node, before) {
    node.remove();
    const index = before ? this.children.indexOf(before) : -1;
    this.children.splice(index < 0 ? this.children.length : index, 0, node);
    node.parentNode = this;
  }
  remove() {
    if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(node => node !== this);
    this.parentNode = null;
  }
  get firstChild() { return this.children[0] ?? null; }
  get nextSibling() { return this.parentNode?.children[this.parentNode.children.indexOf(this) + 1] ?? null; }
  setAttribute(key, value) {
    this.attributes[key] = String(value);
    if (key === 'class') {
      this.className = String(value);
      this.classList.add(...value.split(/\s+/));
    }
    if (key === 'id') this.id = value;
    if (key === 'hidden') this.hidden = true;
    if (key === 'disabled') this.disabled = true;
    if (key === 'tabindex') this.tabIndex = Number(value);
    if (key.startsWith('data-')) this.dataset[key.slice(5).replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase())] = value;
  }
  getAttribute(key) { return this.attributes[key] ?? null; }
  removeAttribute(key) { delete this.attributes[key]; }
  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(fn);
  }
  removeEventListener(type, fn) { this.listeners.get(type)?.delete(fn); }
  closest(selector) {
    if (selector === '[role="tab"]' && this.getAttribute('role') === 'tab' || selector.startsWith('.') && this.classList.contains(selector.slice(1))) return this;
    return this.parentNode?.closest(selector) ?? null;
  }
  focus() { this.ownerDocument.activeElement = this; }
  fire(type, extra = {}) {
    const event = {
      target: this, key: '', prevented: false, stopped: false,
      preventDefault() { this.prevented = true; },
      stopPropagation() { this.stopped = true; },
      stopImmediatePropagation() { this.stopped = true; },
      ...extra,
    };
    for (const fn of this.listeners.get(type) ?? []) {
      fn(event);
      if (event.stopped) break;
    }
    return event;
  }
}

const walk = node => [node, ...node.children.flatMap(walk)];
const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const html = await readFile(new URL('./index.html', import.meta.url), 'utf8');
const hostSource = (await readFile(new URL('./code_host.js', import.meta.url), 'utf8'))
  .replace(/^import[\s\S]*?from\s*['"][^'"]+['"];\n/gm, '').replace(/^export /gm, '');

// Use the shipped element hierarchy, including hidden parents. A slot inside
// the hidden editor or a misplaced input heading must fail these tests.
function documentFromHtml() {
  const doc = {
    activeElement: null,
    createElement: tag => new Element(doc, tag),
    createComment: () => new Element(doc, '#comment'),
  };
  const root = new Element(doc, '#document'), stack = [root], ids = new Map();
  const voids = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
  for (const token of html.matchAll(/<!--[\s\S]*?-->|<![^>]*>|<\/?([a-z][a-z0-9-]*)\b([^>]*)>/gi)) {
    const name = token[1]?.toLowerCase();
    if (!name) continue;
    if (token[0].startsWith('</')) {
      assert.equal(stack.at(-1).tagName, name, 'balanced explicit YM2149 ST markup: ' + name);
      stack.pop();
      continue;
    }
    const element = new Element(doc, name);
    for (const attribute of token[2].matchAll(/([\w:-]+)(?:="([^"]*)")?/g)) element.setAttribute(attribute[1], attribute[2] ?? '');
    stack.at(-1).append(element);
    if (element.id) {
      assert(!ids.has(element.id), 'unique YM2149 ST id: ' + element.id);
      ids.set(element.id, element);
    }
    if (!voids.has(name) && !token[0].endsWith('/>')) stack.push(element);
  }
  assert.equal(stack.length, 1);
  doc.getElementById = id => ids.get(id) ?? null;
  doc.root = root;
  return doc;
}

function fixture(t) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document'), doc = documentFromHtml();
  globalThis.document = doc;
  const byId = id => {
    const node = doc.getElementById(id);
    assert(node, 'existing YM2149 ST mount: ' + id);
    return node;
  };
  const editor = byId('ymSynthEditor'), ym = byId('ymChipTab'), mixer = byId('ymMixerTab');
  const code = byId('synthInputCodeTab'), keyboard = byId('synthInputKeyboardTab');
  const section = byId('synthInputSection'), tabs = byId('ymChipTabs'), heading = code.parentNode.parentNode;
  const transport = byId('synthCodeRunButton').parentNode, master = byId('masterVolume').closest('.master-control');
  // Model the shared Code controls' existing transport and section anchors;
  // the real shared workspace helper performs every other DOM move.
  section.insertBefore(transport, byId('synthKeyboardPanel'));
  const home = doc.createComment();
  section.parentNode.insertBefore(home, section);
  const originals = new Map([master, tabs, code, keyboard, byId('synthCodeExpandButton'), transport].map(node => [node, node.parentNode]));
  const calls = {modes: [], expanded: [], chips: [], layouts: 0}, input = {mode: 'keyboard', expanded: false};
  let workspace;
  const controls = {
    isCodeMode: () => input.mode === 'code',
    isExpanded: () => input.expanded,
    layoutEditor: () => calls.layouts++,
    async setMode(mode, options) {
      calls.modes.push([mode, options]);
      input.mode = mode;
      byId('synthCodePanel').hidden = mode !== 'code';
      byId('synthKeyboardPanel').hidden = mode !== 'keyboard';
      code.setAttribute('aria-selected', String(mode === 'code'));
      keyboard.setAttribute('aria-selected', String(mode === 'keyboard'));
      workspace.showInput(mode);
      return true;
    },
    async setExpanded(value) {
      calls.expanded.push(value);
      input.expanded = Boolean(value);
      if (value) byId('synthExpandedCodeSlot').append(section);
      else home.parentNode.insertBefore(section, home.nextSibling);
      workspace.setExpanded(value);
      return value;
    },
  };
  const selectChip = tab => {
    assert([ym, mixer].includes(tab));
    calls.chips.push(tab);
    byId('ymChipPanel').hidden = tab !== ym;
    byId('ymMixerPanel').hidden = tab !== mixer;
    workspace.showChip(tab);
    return true;
  };
  workspace = setupSynthExpandedTabs({
    codeControls: controls, selectChip,
    elements: {editor, chipTabs: [ym, mixer], volume: master},
    getChipView: tab => tab.dataset.chipTab,
  });
  t.after(() => {
    workspace.dispose();
    home.remove();
    if (previous) Object.defineProperty(globalThis, 'document', previous);
    else delete globalThis.document;
  });
  return {doc, byId, editor, ym, mixer, code, keyboard, section, tabs, heading, transport, master, originals, calls, input, controls, workspace, selectChip};
}

const selected = tabs => tabs.filter(tab => tab.getAttribute('aria-selected') === 'true');

test('actual YM2149 ST markup creates one persistent Code / YM2149 / Mixer / Keyboard workspace', async t => {
  const f = fixture(t), all = [f.code, f.ym, f.mixer, f.keyboard], main = f.byId('ymSynthMain');
  assert(f.heading.classList.contains('ym-input-heading'));
  for (const id of ['synthExpandedTabsSlot', 'synthExpandedVolumeSlot', 'synthExpandedCodeSlot']) assert.equal(f.byId(id).parentNode, main, id + ' remains outside the hidden editor');
  assert.equal(f.editor.parentNode, main);
  assert.equal(f.section.parentNode, main);
  assert(main.children.indexOf(f.byId('synthExpandedCodeSlot')) > main.children.indexOf(f.section));
  for (const id of ['ymSongPanel', 'outputCanvas', 'envelopeCanvas', 'ymPresetSelect', 'presetName', 'ymChipPanel', 'ymMixerPanel']) assert(walk(f.editor).includes(f.byId(id)), id + ' belongs to the existing Synth editor');
  assert.equal(f.ym.dataset.chipTab, 'ym2149');
  assert.equal(f.mixer.dataset.chipTab, 'mixer');
  f.byId('synthWorkspaceCodeButton').fire('click');
  await settle();
  assert.deepEqual(f.tabs.children, all);
  assert.equal(f.tabs.getAttribute('aria-label'), 'Synth workspace');
  assert.equal(f.input.expanded, true);
  assert.deepEqual(selected(all), [f.code]);
  for (const [view, tab] of [['ym2149', f.ym], ['mixer', f.mixer], ['keyboard', f.keyboard], ['code', f.code]]) {
    if ([f.ym, f.mixer].includes(tab)) f.selectChip(tab);
    else await f.controls.setMode(view, {focusEditor: false});
    const chipView = view === 'ym2149' || view === 'mixer';
    assert.equal(f.input.expanded, true, 'selecting ' + view + ' retains the expanded layout');
    assert.equal(f.byId('synthExpandedTabsSlot').dataset.view, view);
    assert.equal(f.editor.hidden, !chipView);
    assert.equal(f.byId('synthExpandedCodeSlot').hidden, chipView);
    assert.equal(f.transport.parentNode, f.byId('synthExpandedTabsSlot'));
    assert.equal(f.master.parentNode, f.byId('synthExpandedVolumeSlot'));
    assert.equal(f.byId('synthExpandedVolumeSlot').hidden, false);
    assert.deepEqual(selected(all), [tab]);
    assert.deepEqual(all.filter(button => button.tabIndex === 0), [tab]);
    assert.equal(f.byId('synthWorkspaceCodeButton').getAttribute('aria-pressed'), 'true');
    assert.equal(f.byId('synthWorkspaceSynthButton').getAttribute('aria-pressed'), 'false');
    if (chipView) {
      assert.equal(f.byId('ymChipPanel').hidden, view !== 'ym2149');
      assert.equal(f.byId('ymMixerPanel').hidden, view !== 'mixer');
    }
  }
  assert.deepEqual(f.calls.expanded, [true], 'tab changes never re-expand or collapse the layout');
});

test('workspace reuses Master, transport, editor, Files and existing action listeners through repeated layout changes', async t => {
  const f = fixture(t), master = f.byId('masterVolume'), readout = f.byId('masterValue'), model = f.byId('synthCodeEditorHost');
  let changes = 0, runs = 0;
  master.value = '1.4';
  readout.textContent = '140%';
  master.addEventListener('input', () => changes++);
  f.byId('synthCodeRunButton').addEventListener('click', () => runs++);
  f.byId('synthCodeEditor').value = '/* working YM2149 ST code */';
  f.byId('ymFilesPanel').dataset.unsaved = 'true';
  const filesParent = f.byId('ymFilesPanel').parentNode;
  for (let round = 0; round < 3; round++) {
    f.byId('synthWorkspaceCodeButton').fire('click');
    await settle();
    f.selectChip(f.mixer);
    await f.controls.setMode('keyboard');
    assert.equal(f.byId('masterVolume'), master);
    assert.equal(f.byId('synthCodeEditorHost'), model);
    assert.equal(f.byId('synthCodeEditor').value, '/* working YM2149 ST code */');
    assert.equal(f.byId('ymFilesPanel').dataset.unsaved, 'true');
    assert.equal(f.byId('ymFilesPanel').parentNode, filesParent);
    for (const id of ['masterVolume', 'masterValue', 'synthCodeRunButton', 'synthCodeEditorHost', 'synthCodeEditor']) assert.equal(walk(f.doc.root).filter(node => node.id === id).length, 1, id + ' exists once');
    master.fire('input');
    f.byId('synthCodeRunButton').fire('click');
    f.byId('synthWorkspaceSynthButton').fire('click');
    await settle();
    for (const [node, parent] of f.originals) assert.equal(node.parentNode, parent, 'original parent for ' + node.id);
    assert.equal(f.section.parentNode, f.byId('ymSynthMain'));
    assert.equal(master.value, '1.4');
    assert.equal(readout.textContent, '140%');
    assert.equal(f.byId('synthExpandedVolumeSlot').hidden, true);
    assert.equal(f.editor.hidden, false);
  }
  assert.equal(changes, 3, 'the original Master listener survives each move once');
  assert.equal(runs, 3, 'the original Run action survives each move once');
});

test('combined tab navigation wraps in both directions and supports Home / End with one selected focusable tab', async t => {
  const f = fixture(t), all = [f.code, f.ym, f.mixer, f.keyboard];
  f.byId('synthWorkspaceCodeButton').fire('click');
  await settle();
  for (const [key, offset] of [['ArrowRight', 1], ['ArrowLeft', -1], ['ArrowDown', 1], ['ArrowUp', -1]]) {
    for (let index = 0; index < all.length; index++) {
      const event = f.tabs.fire('keydown', {key, target: all[index]});
      await settle();
      const next = all[(index + offset + all.length) % all.length];
      assert(event.prevented && event.stopped);
      assert.equal(f.doc.activeElement, next);
      assert.deepEqual(selected(all), [next]);
      assert.deepEqual(all.filter(tab => tab.tabIndex === 0), [next]);
      assert.equal(f.input.expanded, true);
    }
  }
  f.tabs.fire('keydown', {key: 'End', target: f.code});
  await settle();
  assert.equal(f.doc.activeElement, f.keyboard);
  f.tabs.fire('keydown', {key: 'Home', target: f.keyboard});
  await settle();
  assert.equal(f.doc.activeElement, f.code);
  assert.equal(f.calls.chips.length, 8, 'one original chip selection per arrow destination');
  assert(f.calls.modes.every(([, options]) => options?.focusEditor === false));
  const before = f.calls.chips.length + f.calls.modes.length;
  for (const modifier of ['ctrlKey', 'metaKey', 'altKey']) assert.equal(f.tabs.fire('keydown', {key: 'ArrowRight', target: f.code, [modifier]: true}).prevented, false);
  assert.equal(f.tabs.fire('keydown', {key: 'Enter', target: f.code}).prevented, false);
  assert.equal(f.calls.chips.length + f.calls.modes.length, before);
});

test('Synth restores the current input and chip selection, then disposal restores nodes and removes workspace listeners', async t => {
  const f = fixture(t), codeLayout = f.byId('synthWorkspaceCodeButton'), synthLayout = f.byId('synthWorkspaceSynthButton');
  const originalInputChildren = [...f.code.parentNode.children], originalHeadingHidden = f.heading.hidden;
  const oldLabel = f.tabs.getAttribute('aria-label');
  let originalChipClicks = 0;
  f.tabs.addEventListener('click', () => originalChipClicks++);
  codeLayout.fire('click');
  await settle();
  f.selectChip(f.mixer);
  await f.controls.setMode('keyboard');
  const modeChanges = f.calls.modes.length;
  synthLayout.fire('click');
  await settle();
  assert.equal(f.calls.modes.length, modeChanges, 'Synth changes the layout without replacing the input performance');
  assert.equal(f.input.expanded, false);
  assert.equal(f.doc.activeElement, synthLayout);
  assert.deepEqual(f.code.parentNode.children, originalInputChildren);
  assert.equal(f.heading.hidden, originalHeadingHidden);
  assert.equal(f.tabs.getAttribute('aria-label'), oldLabel);
  assert.deepEqual(selected([f.code, f.keyboard]), [f.keyboard]);
  assert.deepEqual(selected([f.ym, f.mixer]), [f.mixer]);
  assert.equal(codeLayout.getAttribute('aria-pressed'), 'false');
  assert.equal(synthLayout.getAttribute('aria-pressed'), 'true');
  codeLayout.fire('click');
  await settle();
  f.workspace.dispose();
  for (const [node, parent] of f.originals) assert.equal(node.parentNode, parent);
  assert.equal(f.tabs.listeners.get('keydown').size, 0);
  assert.equal(f.tabs.listeners.get('click').size, 1, 'the original chip click listener remains attached');
  for (const button of [codeLayout, synthLayout]) {
    assert.equal(button.listeners.get('click').size, 0);
    assert.equal(button.listeners.get('keydown').size, 0);
  }
  const expandedChanges = f.calls.expanded.length;
  codeLayout.fire('click');
  f.tabs.fire('click', {target: f.ym});
  await settle();
  assert.equal(f.calls.expanded.length, expandedChanges);
  assert.equal(originalChipClicks, 1);
});

test('YM host forwards persistent workspace callbacks without opening audio or stopping a running Code performance', async () => {
  const events = [], files = {ready: Promise.resolve(), markSoundDirty() {}};
  const owner = {context: {currentTime: 12}}, audio = {
    fx: {}, open: () => events.push('open'), prepare: async () => events.push('prepare'),
    beforeStop() {}, stop: async () => events.push('audio-stop'), dispose: async () => {},
  };
  let options, runtimeOptions, running = true;
  const context = vm.createContext({
    createYmCodeProject, YM_PROJECT_FILE_BYTES,
    createYmCodeAudio: () => audio,
    setupYmCodeFiles: () => files,
    setupSynthCodeControls: value => {
      options = value;
      return {ready: files.ready, isCodeMode: () => true, stop: async () => events.push('controls-stop'), dispose() {}, appendLog() {}};
    },
    createPlaygroundCodeRuntime: value => {
      runtimeOptions = value;
      return {getState: () => ({running}), stop: async () => events.push('runtime-stop')};
    },
    selectYmCodeDeclarations() {}, DOMException,
  });
  vm.runInContext(hostSource + '\nglobalThis.makeHost=setupYmCodeHost;', context);
  const onViewChange = mode => events.push(['view', mode]), onExpandedChange = value => events.push(['expanded', value]);
  const host = context.makeHost({
    getSettings: createDefaultPreset, getAudio: () => owner,
    ensureAudio: async () => events.push('ensure-audio'),
    prepareOutput: async (actualOwner, isCurrent) => {
      assert.equal(actualOwner, owner);
      assert.equal(isCurrent(), true);
      events.push('prepare-output');
    },
    stopKeyboard: async () => events.push('keyboard-stop'),
    stopSong: async () => events.push('song-stop'),
    beforeRun: async () => events.push('before-run'),
    applySettings: async () => {}, onViewChange, onExpandedChange,
  });
  await host.ready;
  assert.equal(options.persistentExpanded, true);
  assert.equal(options.keepRunningOnKeyboard, true);
  assert.equal(options.allowTextFiles, true);
  assert.equal(options.editorChip, 'atari-st');
  assert.equal(options.onViewChange, onViewChange);
  assert.equal(options.onExpandedChange, onExpandedChange);
  assert.deepEqual(events, [], 'workspace construction and Files readiness neither start audio nor run Code');
  options.getRuntime();
  await options.onModeChange('keyboard');
  options.onViewChange('keyboard');
  options.onExpandedChange(true);
  options.onViewChange('code');
  assert.deepEqual(events, [['view', 'keyboard'], ['expanded', true], ['view', 'code']]);
  assert.equal(host.isRunning(), true);
  assert.deepEqual(Array.from(runtimeOptions.supportedSoundChips), ['ay8910']);
  assert.equal(runtimeOptions.now(), 12);
  events.length = 0;
  await options.onBeforeRun();
  assert.deepEqual(events, ['song-stop', 'before-run'], 'Apply preserves running Code ownership and existing Song handoff');
  events.length = 0;
  running = false;
  await options.onModeChange('keyboard');
  assert.deepEqual(events, ['open'], 'idle Keyboard still opens the shared output gate');
  events.length = 0;
  await options.onBeforeRun();
  assert.deepEqual(events, ['song-stop', 'keyboard-stop', 'before-run'], 'fresh Run retains the existing Keyboard and Song handoff');
  events.length = 0;
  await runtimeOptions.ensureReady();
  assert.deepEqual(events, ['ensure-audio', 'prepare', 'prepare-output', 'open'], 'Run retains the existing single-output readiness order');
  assert.equal(host.isRunning(), false);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('./playground_operator_keyboard.js', import.meta.url), 'utf8')
  .replace(/import[\s\S]*?from "\.\.\/synth\/synth_keyboard.js";/, '')
  .replace('export function', 'function');

function setup(ensureAudioReady, keyboardOptions = {}) {
  const listeners = new Map();
  const elements = new Map();
  function element() {
    return { listeners: new Map(), dataset: {}, classList: { add() {}, remove() {} },
      appendChild() {}, addEventListener(name, fn) { this.listeners.set(name, fn); }, blur() {},
      querySelector(id) {
        if (!elements.has(id)) elements.set(id, element());
        return elements.get(id);
      } };
  }
  const root = element();
  const notes = [];
  const synth = { noteOn: (...args) => notes.push(['on', ...args]), noteOff: ch => notes.push(['off', ch]) };
  const entries = ['a', 's'].map(key => ({ key, noteName: key, pitch: { block: 4, fnum: 553 } }));
  let pointerHandlers;
  let selected = 2;
  const context = vm.createContext({
    document: { createElement: element }, CSS: { escape: value => value },
    window: { addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) },
    createFretboardState: () => ({}), createFretboardLayout: () => ({ entries }),
    buildKeyboard(options) { pointerHandlers = options; }, renderFretboardControls() {},
    findLayoutEntry: (entries, key) => entries.find(entry => entry.key === key),
  });
  vm.runInContext(source, context);
  const keyboard = context.createPlaygroundOperatorKeyboard({ root, getSelectedChannel: () => selected, onChannelChange: ch => { selected = ch; }, ensureAudioReady, ...keyboardOptions });
  const send = (name, key = 'a', extra = {}) => listeners.get(name)?.({ key, target: { tagName: 'BUTTON' }, preventDefault() {}, ...extra });
  return { keyboard, root, notes, synth, send, select: ch => { selected = ch; },
    pointerDown: (key = 'a') => pointerHandlers.onPointerDown({}, entries.find(entry => entry.key === key)),
    pointerUp: (key = 'a') => pointerHandlers.onPointerUp({}, entries.find(entry => entry.key === key)),
  };
}

test('Operator auditions its selected channel and releases the original channel', () => {
  const t = setup();
  t.keyboard.attachSynth(t.synth);
  t.keyboard.setView('operator');
  t.send('keydown');
  t.select(4);
  t.send('keyup');
  t.send('keydown', 's');
  t.keyboard.setView('code');
  t.send('keydown');
  assert.deepEqual(t.notes, [['on', 2, 4, 553], ['off', 2], ['on', 4, 4, 553], ['off', 4]]);
  assert.equal(t.root.hidden, true);
});

test('typing and shortcuts do not audition; range controls can audition; blur releases', () => {
  const t = setup();
  t.keyboard.attachSynth(t.synth);
  t.keyboard.setView('operator');
  for (const target of [{ tagName: 'INPUT', type: 'number' }, { tagName: 'TEXTAREA' }, { tagName: 'DIV', isContentEditable: true }]) t.send('keydown', 'a', { target });
  t.send('keydown', 'a', { ctrlKey: true });
  assert.equal(t.notes.length, 0);
  t.send('keydown', 'a', { target: { tagName: 'INPUT', type: 'range' } });
  t.send('blur');
  assert.deepEqual(t.notes, [['on', 2, 4, 553], ['off', 2]]);
});

test('release during audio preparation cancels a pending note', async () => {
  let ready;
  const t = setup(() => new Promise(resolve => { ready = resolve; }));
  t.keyboard.setView('operator');
  t.send('keydown');
  t.send('keyup');
  t.keyboard.attachSynth(t.synth);
  ready();
  await new Promise(setImmediate);
  assert.deepEqual(t.notes, []);
});

test('first held key plays after audio preparation', async () => {
  let ready;
  const t = setup(() => new Promise(resolve => { ready = resolve; }));
  t.keyboard.setView('operator');
  t.send('keydown');
  t.keyboard.attachSynth(t.synth);
  ready();
  await new Promise(setImmediate);
  t.send('keyup');
  assert.deepEqual(t.notes, [['on', 2, 4, 553], ['off', 2]]);
});

test('releasing a stolen key does not silence the current note', () => {
  const t = setup();
  t.keyboard.attachSynth(t.synth);
  t.keyboard.setView('keyboard');
  t.send('keydown', 'a');
  t.send('keydown', 's');
  t.send('keyup', 'a');
  assert.equal(t.notes.length, 2);
  t.send('keyup', 's');
  assert.deepEqual(t.notes.at(-1), ['off', 0]);
});

test('leaving Operator while audio is preparing cancels audition', async () => {
  let ready;
  const t = setup(() => new Promise(resolve => { ready = resolve; }));
  t.keyboard.setView('operator');
  t.send('keydown');
  t.keyboard.setView('code');
  t.keyboard.attachSynth(t.synth);
  ready();
  await new Promise(setImmediate);
  assert.deepEqual(t.notes, []);
});

test('tab selection updates both panel visibility and the shared keyboard', async () => {
  const { createPlaygroundUi } = await import('./playground_ui.js');
  const t = setup();
  const operatorPanel = {};
  const keyboardPanel = {};
  const codePanel = {};
  const ui = createPlaygroundUi({ operatorPanel, keyboardPanel, codePanel,
    onBottomTabChange: name => t.keyboard.setView(name) });
  ui.setBottomTab('operator');
  assert.equal(operatorPanel.hidden, false);
  assert.equal(keyboardPanel.hidden, false);
  assert.equal(t.root.hidden, false);
  ui.setBottomTab('keyboard');
  assert.equal(operatorPanel.hidden, true);
  assert.equal(t.root.hidden, false);
  ui.setBottomTab('code');
  assert.equal(codePanel.hidden, false);
  assert.equal(t.root.hidden, true);
});


test('Operator dock can choose a channel and switch to round robin', () => {
  const t = setup();
  t.keyboard.attachSynth(t.synth);
  t.keyboard.setView('operator');
  const mode = t.root.querySelector('#playgroundKeyboardChannelMode');
  const channel = t.root.querySelector('#playgroundKeyboardChannel');
  assert.equal(mode.disabled, false);
  assert.equal(channel.disabled, false);
  channel.value = '4';
  channel.listeners.get('change')();
  t.send('keydown');
  t.send('keyup');
  assert.deepEqual(t.notes, [['on', 4, 4, 553], ['off', 4]]);
  mode.value = 'roundRobin';
  mode.listeners.get('change')();
  assert.equal(channel.disabled, true);
  t.send('keydown', 'a');
  t.send('keydown', 's');
  assert.deepEqual(t.notes.slice(2), [['on', 0, 4, 553], ['on', 1, 4, 553]]);
  t.keyboard.setView('keyboard');
  t.keyboard.setView('operator');
  assert.equal(mode.value, 'roundRobin');
  mode.value = 'fixed';
  mode.listeners.get('change')();
  assert.equal(channel.disabled, false);
  t.send('keydown');
  assert.deepEqual(t.notes.at(-1), ['on', 4, 4, 553]);
});

test('an attached synth still resumes audio before audition in Keyboard and Operator views', async () => {
  for (const view of ['keyboard', 'operator']) {
    let resumed = false, resumes = 0;
    const t = setup(async () => { resumed = true; resumes++; });
    t.keyboard.attachSynth(t.synth);
    const original = t.synth.noteOn;
    t.synth.noteOn = (...args) => { assert.equal(resumed, true); original(...args); };
    t.keyboard.setView(view);
    t.send('keydown');
    await new Promise(setImmediate);
    t.send('keyup');
    resumed = false; // Stop fades the shared output to zero while retaining the synth.
    t.send('keydown', 's');
    await new Promise(setImmediate);
    t.send('keyup', 's');
    assert.equal(resumes, 2);
    assert.equal(t.notes.filter(note => note[0] === 'on').length, 2);
  }
});

test('releasing an attached synth key while output resumes prevents a late note', async () => {
  let ready;
  const t = setup(() => new Promise(resolve => { ready = resolve; }));
  t.keyboard.attachSynth(t.synth);
  t.keyboard.setView('keyboard');
  t.send('keydown'); t.send('keyup'); ready();
  await new Promise(setImmediate);
  assert.deepEqual(t.notes, []);
});

test('computer key ownership blocks new notes while permitting held-key release', () => {
  let ownsKeys = false;
  const t = setup(undefined, { canHandleComputerKeys: () => ownsKeys });
  t.keyboard.attachSynth(t.synth);
  t.keyboard.setView('keyboard');
  t.send('keydown');
  assert.deepEqual(t.notes, []);
  ownsKeys = true;
  t.send('keydown');
  assert.deepEqual(t.notes, [['on', 0, 4, 553]]);
  ownsKeys = false;
  t.send('keydown', 's');
  t.send('keyup');
  assert.deepEqual(t.notes, [['on', 0, 4, 553], ['off', 0]]);
});

test('computer key release still cancels pending audio after ownership changes', async () => {
  let ownsKeys = true;
  let ready;
  let preparations = 0;
  const t = setup(() => {
    preparations++;
    return new Promise(resolve => { ready = resolve; });
  }, { canHandleComputerKeys: () => ownsKeys });
  t.keyboard.attachSynth(t.synth);
  t.keyboard.setView('keyboard');
  t.send('keydown');
  ownsKeys = false;
  t.send('keydown', 's');
  t.send('keyup');
  ready();
  await new Promise(setImmediate);
  assert.equal(preparations, 1, 'the other key owner must not prepare a second audition');
  assert.deepEqual(t.notes, []);
});

test('a pending computer note cannot start after another editor takes keyboard ownership', async () => {
  let ownsKeys = true;
  let ready;
  const t = setup(() => new Promise(resolve => { ready = resolve; }), {
    canHandleComputerKeys: () => ownsKeys,
  });
  t.keyboard.attachSynth(t.synth);
  t.keyboard.setView('keyboard');
  t.send('keydown');
  ownsKeys = false;
  ready();
  await new Promise(setImmediate);
  assert.deepEqual(t.notes, []);
  ownsKeys = true;
  t.send('keydown');
  ready();
  await new Promise(setImmediate);
  assert.deepEqual(t.notes, [['on', 0, 4, 553]], 'cancelled preparation must not leave a held-key entry');
  t.send('keyup');
});

test('another editor owning computer keys does not disable pointer audition', () => {
  const t = setup(undefined, { canHandleComputerKeys: () => false });
  t.keyboard.attachSynth(t.synth);
  t.keyboard.setView('keyboard');
  t.pointerDown();
  t.pointerUp();
  assert.deepEqual(t.notes, [['on', 0, 4, 553], ['off', 0]]);
});

test('refreshing the same keyboard view preserves a held audition', () => {
  for (const view of ['operator','keyboard']) {
    const t = setup();
    t.keyboard.attachSynth(t.synth);
    t.keyboard.setView(view);
    t.send('keydown');
    t.keyboard.setView(view);
    t.keyboard.setView(view);
    assert.equal(t.notes.length,1, 'layout refresh must not release a key in an unchanged view');
    t.send('keyup');
    assert.equal(t.notes.filter(note => note[0] === 'off').length,1);
  }
});

test('refreshing Operator during audio preparation preserves the pending held key', async () => {
  let ready;
  const t = setup(() => new Promise(resolve => { ready = resolve; }));
  t.keyboard.setView('operator');
  t.send('keydown');
  t.keyboard.setView('operator');
  t.keyboard.attachSynth(t.synth);
  ready();
  await new Promise(setImmediate);
  assert.deepEqual(t.notes,[['on',2,4,553]]);
  t.send('keyup');
  assert.deepEqual(t.notes.at(-1),['off',2]);
});

async function dockedKeyboard() {
  const {createPlaygroundUi} = await import('./playground_ui.js');
  const t = setup();
  t.keyboard.attachSynth(t.synth);
  const panels = {codePanel:{}, operatorPanel:{}, keyboardPanel:{}, helpersPanel:{}, audioMonitorPanel:{}, shellPanel:{}};
  const ui = createPlaygroundUi({...panels, dockedPanels:true, initialDockOpen:true, initialBottomTab:'console',
    onBottomTabChange(_name, layout) {
      t.keyboard.setView(layout.dockOpen && layout.bottomTab === 'keyboard' ? 'keyboard' :
        layout.primaryTab === 'operator' ? 'operator' : 'code');
    },
  });
  return {...t, ui, panels};
}

test('Code with the lower Keyboard enables audition; Helper and a closed dock release it', async () => {
  const t = await dockedKeyboard();
  t.ui.setBottomTab('code');
  t.ui.setBottomTab('keyboard');
  assert.equal(t.panels.codePanel.hidden,false);
  t.send('keydown');
  assert.deepEqual(t.notes,[['on',0,4,553]]);
  t.ui.setBottomTab('helpers');
  assert.equal(t.panels.codePanel.hidden,false);
  t.send('keydown','s');
  assert.deepEqual(t.notes,[['on',0,4,553],['off',0]], 'Helper must not leave keyboard shortcuts active');
  t.ui.setBottomTab('keyboard');
  t.send('keydown','s');
  t.ui.setDockVisible(false);
  t.send('keydown');
  assert.deepEqual(t.notes.slice(-2),[['on',0,4,553],['off',0]], 'closing the lower keyboard ends its audition');
  assert.equal(t.root.hidden,true);
  t.ui.setDockVisible(true);
  t.send('keydown');
  assert.deepEqual(t.notes.at(-1),['on',0,4,553]);
  t.send('keyup');
});

test('unrelated lower tabs and dock visibility do not cut a held Operator audition', async () => {
  const t = await dockedKeyboard();
  t.ui.setBottomTab('operator');
  t.send('keydown');
  for (const lower of ['helpers','audio','shell']) t.ui.setBottomTab(lower);
  t.ui.setDockVisible(false);
  t.ui.setDockVisible(true);
  assert.equal(t.panels.operatorPanel.hidden,false);
  assert.equal(t.root.hidden,false);
  assert.deepEqual(t.notes,[['on',2,4,553]], 'the active audition view remains Operator throughout');
  t.send('keyup');
  assert.deepEqual(t.notes.at(-1),['off',2]);
  t.ui.setBottomTab('code');
  t.send('keydown');
  assert.equal(t.root.hidden,true);
  assert.equal(t.notes.length,2);
});

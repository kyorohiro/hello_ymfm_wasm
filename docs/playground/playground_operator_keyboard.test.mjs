import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('./playground_operator_keyboard.js', import.meta.url), 'utf8')
  .replace(/import[\s\S]*?from "\.\.\/synth\/synth_keyboard.js";/, '')
  .replace('export function', 'function');

function setup(ensureAudioReady) {
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
  let selected = 2;
  const context = vm.createContext({
    document: { createElement: element }, CSS: { escape: value => value },
    window: { addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) },
    createFretboardState: () => ({}), createFretboardLayout: () => ({ entries }),
    buildKeyboard() {}, renderFretboardControls() {},
    findLayoutEntry: (entries, key) => entries.find(entry => entry.key === key),
  });
  vm.runInContext(source, context);
  const keyboard = context.createPlaygroundOperatorKeyboard({ root, getSelectedChannel: () => selected, onChannelChange: ch => { selected = ch; }, ensureAudioReady });
  const send = (name, key = 'a', extra = {}) => listeners.get(name)?.({ key, target: { tagName: 'BUTTON' }, preventDefault() {}, ...extra });
  return { keyboard, root, notes, synth, send, select: ch => { selected = ch; } };
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

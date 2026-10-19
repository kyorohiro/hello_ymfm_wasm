import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('./playground_operator_keyboard.js', import.meta.url), 'utf8')
  .replace(/import[\s\S]*?from "\.\.\/synth\/synth_keyboard\.js(?:\?[^\"]*)?";/, '')
  .replace('export function', 'function');

function classList() {
  const classes = new Set();
  return {
    add(...names) { for (const name of names) classes.add(name); },
    remove(...names) { for (const name of names) classes.delete(name); },
    contains(name) { return classes.has(name); },
    toggle(name, force = !classes.has(name)) {
      if (force) classes.add(name); else classes.delete(name);
      return force;
    },
  };
}

function setup(ensureAudioReady, keyboardOptions = {}) {
  const listeners = new Map();
  const elements = new Map();
  function element() {
    const attributes = new Map();
    return { listeners: new Map(), dataset: {}, classList: classList(),
      setAttribute(name, value) { attributes.set(name, String(value)); },
      getAttribute(name) { return attributes.get(name) ?? null; },
      appendChild() {}, addEventListener(name, fn) { this.listeners.set(name, fn); }, blur() {},
      querySelector(id) {
        if (!elements.has(id)) {
          const child = element();
          if (id.startsWith('#')) child.id = id.slice(1);
          elements.set(id, child);
        }
        return elements.get(id);
      },
      querySelectorAll(selector) { return selector === '[id]' ? [...elements.values()].filter(child => child.id) : []; },
    };
  }
  const root = element();
  const notes = [];
  const synth = { noteOn: (...args) => notes.push(['on', ...args]), noteOff: ch => notes.push(['off', ch]) };
  const entries = ['a', 's'].map((key,index) => ({ key, midi:60 + index, noteName: key, pitch: { block: 4, fnum: 553 } }));
  let pointerHandlers, fretControls;
  let selected = 2;
  const context = vm.createContext({
    document: { createElement: element }, CSS: { escape: value => value },
    window: { addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) },
    createFretboardState: () => ({}), createFretboardLayout: () => ({ entries }),
    buildKeyboard(options) { pointerHandlers = options; }, renderFretboardControls(options) {fretControls = options;},
    setInstrument() {}, setFretPosition() {}, setStringWindowIndex() {},
    findLayoutEntry: (entries, key) => entries.find(entry => entry.key === key),
  });
  vm.runInContext(source, context);
  const options = typeof keyboardOptions === 'function' ? keyboardOptions(root) : keyboardOptions;
  const keyboard = context.createPlaygroundOperatorKeyboard({ root, getSelectedChannel: () => selected, onChannelChange: ch => { selected = ch; }, ensureAudioReady, ...options });
  const send = (name, key = 'a', extra = {}) => listeners.get(name)?.({ key, target: { tagName: 'BUTTON' }, preventDefault() {}, ...extra });
  const buttonFor = key => root.querySelector('#playgroundKeyboardKeys').querySelector(`[data-key="${key}"]`);
  return { keyboard, root, notes, synth, send, entries, buttonFor,
    pointerOptions: () => pointerHandlers, fretControls: () => fretControls,
    select: ch => { selected = ch; },
    pointerDown: (key = 'a',event = {}) => pointerHandlers.onPointerDown(event, entries.find(entry => entry.key === key),buttonFor(key)),
    pointerUp: (key = 'a',event = {}) => pointerHandlers.onPointerUp(event, entries.find(entry => entry.key === key)),
    pointerCancel: (key = 'a',event = {}) => pointerHandlers.onPointerCancel(event, entries.find(entry => entry.key === key)),
  };
}

function targetFixture(name = 'Sampler', noteOn) {
  const events = [];
  return {events,target:{name,
    noteOn(event) {events.push(['on',{...event}]);return noteOn?.(event);},
    noteOff(event) {events.push(['off',{...event}]);},
    allNotesOff() {events.push(['all']);},
  }};
}

test('a custom target uses shared MIDI notes and independent press IDs for equal pitches', () => {
  const t = setup(), custom = targetFixture();
  t.entries[1].midi = t.entries[0].midi;
  t.keyboard.attachSynth(t.synth);
  t.keyboard.attachNoteTarget(custom.target);
  t.keyboard.setView('keyboard');
  t.send('keydown','a'); t.send('keydown','s');
  const on = custom.events.filter(event => event[0] === 'on').map(event => event[1]);
  assert.equal(on.length,2); assert.equal(on[0].midi,60); assert.equal(on[1].midi,60);
  assert.equal(on[0].velocity,100); assert.equal(typeof on[0].id,'string'); assert.notEqual(on[0].id,on[1].id);
  t.send('keyup','a');
  assert.equal(custom.events.at(-1)[1].id,on[0].id);
  assert.equal(t.buttonFor('s').classList.contains('is-active'),true);
  t.send('keyup','s');
  assert.equal(custom.events.at(-1)[1].id,on[1].id);
  assert.deepEqual(t.notes,[],'custom notes must not also audition FM');
});

test('pointer and computer presses on the same key have separate identities and release ownership', () => {
  const t = setup(), custom = targetFixture();
  t.keyboard.attachNoteTarget(custom.target); t.keyboard.setView('keyboard');
  t.pointerDown('a',{pointerId:11}); t.send('keydown','a',{code:'KeyA'});
  assert.equal(custom.events.filter(event => event[0] === 'on').length,2);
  t.pointerUp('a',{pointerId:11});
  assert.equal(t.buttonFor('a').classList.contains('is-active'),true);
  t.send('keyup','A',{code:'KeyA',target:{tagName:'TEXTAREA'}});
  assert.equal(t.buttonFor('a').classList.contains('is-active'),false);
  const off = custom.events.filter(event => event[0] === 'off').map(event => event[1].id);
  assert.equal(new Set(off).size,2);
});

test('custom targets work without primary FM and hide its controls and key details', () => {
  const t = setup(undefined,{channelCount:0}), custom = targetFixture('Game Boy wave');
  t.keyboard.attachNoteTarget(custom.target); t.keyboard.setView('keyboard');
  assert.equal(t.root.querySelector('#playgroundKeyboardChannelTools').hidden,true);
  assert.equal(t.pointerOptions().showPitch,false);
  assert.match(t.root.querySelector('#playgroundKeyboardHint').textContent,/Game Boy wave/);
  t.send('keydown'); t.send('keyup');
  assert.deepEqual(custom.events.map(event => event[0]),['on','off']);
});

test('Operator keeps FM audition while Keyboard uses its explicit target; null restores FM', () => {
  const t = setup(), custom = targetFixture();
  t.keyboard.attachSynth(t.synth); t.keyboard.attachNoteTarget(custom.target);
  t.keyboard.setView('operator'); t.send('keydown'); t.send('keyup');
  assert.deepEqual(t.notes,[['on',2,4,553],['off',2]]);
  assert.equal(custom.events.filter(event => event[0] === 'on').length,0);
  assert.equal(t.pointerOptions().showPitch,true);
  assert.equal(t.root.querySelector('#playgroundKeyboardChannelTools').hidden,false);
  t.keyboard.setView('keyboard'); t.send('keydown'); t.send('keyup');
  assert.equal(custom.events.filter(event => event[0] === 'on').length,1);
  assert.equal(t.pointerOptions().showPitch,false);
  t.keyboard.attachNoteTarget(null); t.send('keydown'); t.send('keyup');
  assert.deepEqual(t.notes.slice(-2),[['on',0,4,553],['off',0]]);
  assert.equal(t.pointerOptions().showPitch,true);
});

test('custom target preparation survives initial FM attachment and cancels on release or target change', async () => {
  let ready;
  const t = setup(() => new Promise(resolve => {ready = resolve;})), custom = targetFixture(), replacement = targetFixture('Other');
  t.keyboard.attachNoteTarget(custom.target); t.keyboard.setView('keyboard');
  t.send('keydown'); t.keyboard.attachSynth(t.synth); ready();
  await new Promise(setImmediate);
  assert.equal(custom.events.filter(event => event[0] === 'on').length,1);
  t.send('keyup');
  t.send('keydown','s'); t.send('keyup','s'); ready();
  await new Promise(setImmediate);
  assert.equal(custom.events.filter(event => event[0] === 'on').length,1);
  t.send('keydown'); t.keyboard.attachNoteTarget(replacement.target); ready();
  await new Promise(setImmediate);
  assert.equal(custom.events.filter(event => event[0] === 'on').length,1);
  assert.equal(replacement.events.filter(event => event[0] === 'on').length,0);
});

test('a cancelled asynchronous noteOn receives a final matching off without touching its replacement', async () => {
  let finish;
  const t = setup(), old = targetFixture('Old',() => new Promise(resolve => {finish = resolve;})), next = targetFixture('New');
  t.keyboard.attachNoteTarget(old.target); t.keyboard.setView('keyboard'); t.send('keydown');
  const oldId = old.events[0][1].id;
  t.keyboard.attachNoteTarget(next.target); t.send('keydown','s'); finish();
  await new Promise(setImmediate);
  assert.deepEqual(old.events.filter(event => event[0] === 'off').map(event => event[1].id),[oldId,oldId]);
  assert.equal(next.events.filter(event => event[0] === 'on').length,1);
  assert.equal(next.events.filter(event => event[0] === 'off').length,0);
  t.send('keyup','s');
});

test('blur, fretboard rebuild and explicit releaseAll release the custom target', async () => {
  const t = setup(), custom = targetFixture();
  t.keyboard.attachNoteTarget(custom.target); t.keyboard.setView('keyboard');
  for (const release of [() => t.send('blur'),() => t.fretControls().onInstrumentChange('bass'),() => t.keyboard.releaseAll()]) {
    t.send('keydown'); release();
    assert.equal(t.buttonFor('a').classList.contains('is-active'),false);
  }
  await new Promise(setImmediate);
  assert.equal(custom.events.filter(event => event[0] === 'on').length,3);
  assert.equal(custom.events.filter(event => event[0] === 'off').length,3);
  assert.equal(custom.events.filter(event => event[0] === 'all').length,3);
});

test('same target attachment preserves notes and invalid targets do not replace it', () => {
  const t = setup(), custom = targetFixture();
  t.keyboard.attachNoteTarget(custom.target); t.keyboard.setView('keyboard'); t.send('keydown');
  t.keyboard.attachNoteTarget(custom.target);
  assert.equal(custom.events.length,1);
  assert.throws(() => t.keyboard.attachNoteTarget({name:'Invalid'}),/requires name/);
  t.send('keyup');
  assert.deepEqual(custom.events.map(event => event[0]),['on','off']);
});

test('rejected custom noteOn releases its ID and reports failure without retaining the key', async () => {
  const statuses = [], t = setup(undefined,{onStatus:message => statuses.push(message)});
  const custom = targetFixture('Rejected',() => Promise.reject(new Error('not ready')));
  t.keyboard.attachNoteTarget(custom.target); t.keyboard.setView('keyboard'); t.send('keydown');
  await new Promise(setImmediate);
  assert.equal(t.buttonFor('a').classList.contains('is-active'),false);
  assert.match(statuses.at(-1),/not ready/);
  assert.deepEqual(custom.events.map(event => event[0]),['on','off']);
});

test('dispose releases a custom target and prevents pointer input from reviving the controller', async () => {
  const t = setup(), custom = targetFixture();
  t.keyboard.attachNoteTarget(custom.target); t.keyboard.setView('keyboard'); t.pointerDown();
  t.keyboard.dispose(); t.keyboard.setView('keyboard'); t.pointerDown('s');
  await new Promise(setImmediate);
  assert.deepEqual(custom.events.map(event => event[0]),['on','off','all']);
});

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

function toggleControls(t, prefix = '') {
  const button = t.root.querySelector(`#${prefix}playgroundKeyboardMinimize`);
  button.listeners.get('click')({ preventDefault() {}, stopPropagation() {} });
  return button;
}

test('keyboard controls are minimizable only when the embedding opts in', () => {
  const regular = setup();
  assert(!regular.root.innerHTML.includes('id="playgroundKeyboardMinimize"'));
  const states = [];
  const host = { classList: classList() };
  const t = setup(undefined, { minimizeHost: host, onControlsMinimizedChange: state => states.push(state) });
  const button = t.root.querySelector('#playgroundKeyboardMinimize');
  assert(t.root.innerHTML.includes('id="playgroundKeyboardMinimize"'));
  assert.equal(host.classList.contains('is-keyboard-minimized'), false);
  assert.equal(button.textContent, '−');
  assert.equal(button.getAttribute('aria-expanded'), 'true');
  assert.equal(button.getAttribute('aria-label'), 'Minimize keyboard controls');
  assert.equal(button.title, 'Minimize keyboard controls');
  toggleControls(t);
  assert.equal(host.classList.contains('is-keyboard-minimized'), true);
  assert.equal(t.root.classList.contains('is-keyboard-minimized'), false, 'the class belongs on the selected host');
  assert.equal(button.textContent, 'Keys');
  assert.equal(button.getAttribute('aria-expanded'), 'false');
  assert.equal(button.getAttribute('aria-label'), 'Show keyboard controls');
  assert.equal(button.title, 'Show keyboard controls');
  toggleControls(t);
  assert.equal(host.classList.contains('is-keyboard-minimized'), false);
  assert.equal(button.textContent, '−');
  assert.equal(button.getAttribute('aria-expanded'), 'true');
  assert.deepEqual(states, [false, true, false]);
});

test('prefixed keyboard controls expose the correct accessible target IDs', () => {
  const t = setup(undefined, root => ({ minimizeHost: root, idPrefix: 'preview-' }));
  const button = t.root.querySelector('#preview-playgroundKeyboardMinimize');
  assert.deepEqual(button.getAttribute('aria-controls').split(/\s+/).sort(), [
    'preview-playgroundKeyboardChannelTools', 'preview-playgroundKeyboardFretTools',
  ].sort());
  toggleControls(t, 'preview-');
  assert.equal(t.root.classList.contains('is-keyboard-minimized'), true);
});

test('minimizing and restoring controls preserves a held note and channel settings', () => {
  const t = setup(undefined, root => ({ minimizeHost: root }));
  t.keyboard.attachSynth(t.synth);
  t.keyboard.setView('operator');
  const channel = t.root.querySelector('#playgroundKeyboardChannel');
  const mode = t.root.querySelector('#playgroundKeyboardChannelMode');
  channel.value = '4';
  channel.listeners.get('change')();
  t.send('keydown');
  toggleControls(t);
  t.keyboard.setView('operator');
  assert.deepEqual(t.notes, [['on', 4, 4, 553]]);
  assert.equal(channel.value, '4');
  assert.equal(mode.value, 'fixed');
  toggleControls(t);
  assert.deepEqual(t.notes, [['on', 4, 4, 553]], 'restoring controls must not retrigger or release the note');
  t.send('keyup');
  assert.deepEqual(t.notes, [['on', 4, 4, 553], ['off', 4]]);
  mode.value = 'roundRobin';
  mode.listeners.get('change')();
  toggleControls(t);
  t.keyboard.setView('code');
  t.keyboard.setView('keyboard');
  assert.equal(t.root.classList.contains('is-keyboard-minimized'), true, 'changing placement does not discard the session setting');
  assert.equal(mode.value, 'roundRobin');
  assert.equal(channel.disabled, true);
  toggleControls(t);
  t.send('keydown');
  t.send('keydown', 's');
  assert.deepEqual(t.notes.slice(-2), [['on', 0, 4, 553], ['on', 1, 4, 553]]);
});

test('minimizing controls while audio prepares neither cancels nor duplicates the held note', async () => {
  let ready;
  const t = setup(() => new Promise(resolve => { ready = resolve; }), root => ({ minimizeHost: root }));
  t.keyboard.setView('operator');
  t.send('keydown');
  toggleControls(t);
  toggleControls(t);
  t.keyboard.attachSynth(t.synth);
  ready();
  await new Promise(setImmediate);
  assert.deepEqual(t.notes, [['on', 2, 4, 553]]);
  t.send('keyup');
  assert.deepEqual(t.notes, [['on', 2, 4, 553], ['off', 2]]);
});

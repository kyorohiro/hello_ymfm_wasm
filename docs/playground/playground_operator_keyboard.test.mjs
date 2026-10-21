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
    return { listeners: new Map(), dataset: {}, classList: classList(), children: [],
      setAttribute(name, value) { attributes.set(name, String(value)); },
      getAttribute(name) { return attributes.get(name) ?? null; },
      appendChild(child) { this.children.push(child); },
      replaceChildren(...children) { this.children = children; },
      addEventListener(name, fn) { this.listeners.set(name, fn); }, blur() {},
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
  const document = { createElement: element, activeElement: null };
  const context = vm.createContext({
    document, CSS: { escape: value => value },
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
  return { keyboard, root, notes, synth, send, entries, buttonFor, document,
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

function routingFixture() {
  let state = {chips:[
    {id:'ym2612-1', label:'YM2612 #1', channels:[{id:'fm-1', label:'FM CH1'}, {id:'fm-2', label:'FM CH2'}]},
    {id:'psg-1', label:'Sega PSG #1', channels:[{id:'tone-1', label:'Tone CH1'}, {id:'tone-2', label:'Tone CH2'}]},
  ], chipId:'ym2612-1', channelId:'fm-1'};
  const listeners = new Set(), selections = [];
  const fixture = {
    selections, onChange:null,
    set(next) {
      state = {...state, ...next};
      fixture.onChange?.(state);
      for (const listener of listeners) listener();
    },
    routing:{
      getState:() => state,
      subscribe(listener) {listeners.add(listener); return () => listeners.delete(listener);},
      selectChip(id) {
        selections.push(['chip',id]);
        fixture.set({chipId:id, channelId:state.chips.find(chip => chip.id === id)?.channels?.[0]?.id ?? null});
      },
      selectChannel(id) {selections.push(['channel',id]); fixture.set({channelId:id});},
    },
    get listenerCount() {return listeners.size;},
  };
  return fixture;
}

function choose(t, selector, value) {
  const select = t.root.querySelector(selector);
  select.value = value;
  select.listeners.get('change')();
}

test('sound-chip editors use their own target while preserving the bottom Keyboard route', () => {
  const fixture = routingFixture(), t = setup(undefined,{routing:fixture.routing});
  const bottom = targetFixture('Script instrument'), editor = targetFixture('Game Boy · Wave');
  t.keyboard.attachSynth(t.synth); t.keyboard.attachNoteTarget(bottom.target); t.keyboard.attachEditorTarget(editor.target);
  t.keyboard.setView('gameboy');
  assert.equal(t.root.hidden,false);
  assert.equal(t.root.querySelector('#playgroundKeyboardRoutingTools').hidden,true);
  assert.equal(t.root.querySelector('#playgroundKeyboardChannelTools').hidden,true);
  assert.equal(t.root.querySelector('#playgroundKeyboardEditorTarget').hidden,false);
  assert.equal(t.root.querySelector('#playgroundKeyboardEditorTarget').textContent,'Game Boy · Wave');
  assert.equal(t.pointerOptions().showPitch,false);
  t.send('keydown'); t.send('keyup');
  assert.deepEqual(editor.events.map(event => event[0]),['on','off']);
  assert.deepEqual(bottom.events,[]);
  assert.deepEqual(t.notes,[]);
  assert.deepEqual(fixture.selections,[],'opening an editor does not change the bottom Keyboard selection');
  t.keyboard.setView('keyboard'); t.send('keydown'); t.send('keyup');
  assert.deepEqual(bottom.events.map(event => event[0]),['on','off']);
  assert.equal(t.root.querySelector('#playgroundKeyboardRoutingTools').hidden,false);
  assert.equal(t.root.querySelector('#playgroundKeyboardEditorTarget').hidden,true);
});

test('editor selection and tab changes release the old voice; repeated view and metadata updates preserve it', () => {
  const fixture = routingFixture(), t = setup(undefined,{routing:fixture.routing});
  const first = targetFixture('YM2151 · CH1'), second = targetFixture('YM2151 · CH2'), bottom = targetFixture('Other bottom route');
  t.keyboard.attachEditorTarget(first.target); t.keyboard.setView('ym2151');
  t.send('keydown','a',{code:'KeyA'});
  const firstId = first.events[0][1].id, layout = t.pointerOptions();
  t.keyboard.setView('ym2151'); t.keyboard.attachEditorTarget(first.target);
  t.keyboard.attachNoteTarget(bottom.target);
  fixture.set({chipId:'psg-1',channelId:'tone-2'});
  assert.deepEqual(first.events.map(event => event[0]),['on']);
  assert.equal(t.pointerOptions(),layout,'background route metadata does not rebuild the editor fretboard');
  t.keyboard.attachEditorTarget(second.target);
  assert.deepEqual(first.events.map(event => event[0]),['on','off','all']);
  assert.equal(first.events[1][1].id,firstId);
  assert.equal(t.buttonFor('a').classList.contains('is-active'),false);
  t.send('keydown','s',{code:'KeyS'}); t.send('keyup','a',{code:'KeyA'});
  assert.deepEqual(second.events.map(event => event[0]),['on']);
  t.keyboard.setView('huc6280');
  assert.deepEqual(second.events.map(event => event[0]),['on','off','all'],'changing between two enabled editor tabs releases the held note');
  t.send('keyup','s',{code:'KeyS'});
  assert.deepEqual(second.events.map(event => event[0]),['on','off','all']);
  assert.deepEqual(bottom.events,[]);
});

test('missing editor targets and unsupported tabs never fall back to FM or the bottom target', () => {
  let preparations = 0;
  const t = setup(() => {preparations++;}), bottom = targetFixture('Bottom Keyboard'), editor = targetFixture('Editor');
  t.keyboard.attachSynth(t.synth); t.keyboard.attachNoteTarget(bottom.target);
  t.keyboard.setView('nes'); t.send('keydown'); t.pointerDown();
  assert.match(t.root.querySelector('#playgroundKeyboardEditorTarget').textContent,/Select a sound chip and channel/);
  assert.equal(preparations,0);
  t.keyboard.attachEditorTarget(editor.target);
  for (const tab of ['pwm','code','console']) {
    t.keyboard.setView(tab); t.send('keydown'); t.pointerDown();
    assert.equal(t.root.hidden,true);
  }
  assert.equal(preparations,0);
  assert.deepEqual(editor.events,[]);
  assert.deepEqual(bottom.events,[]);
  assert.deepEqual(t.notes,[]);
});

test('all playable chip editor views accept computer and pointer audition', () => {
  const t = setup(undefined,{channelCount:0}), editor = targetFixture('Selected chip channel');
  t.keyboard.attachEditorTarget(editor.target);
  const tabs = ['segapsg','rf5c164','gameboy','nes','ym2151','okim6258','huc6280','dx7','ym3812','ym3526','y8950','ymf262','ym2413','ay8910'];
  for (const tab of tabs) {
    t.keyboard.setView(tab);
    t.send('keydown'); t.send('keyup'); t.pointerDown('s',{pointerId:1}); t.pointerUp('s',{pointerId:1});
    assert.equal(t.root.hidden,false,`${tab} enables Keyboard`);
  }
  assert.equal(editor.events.filter(event => event[0] === 'on').length,tabs.length * 2);
  assert.equal(editor.events.filter(event => event[0] === 'off').length,tabs.length * 2);
});

test('editor preparation survives unrelated route changes and cancellation never starts a replacement voice', async () => {
  let ready;
  const fixture = routingFixture(), t = setup(() => new Promise(resolve => {ready = resolve;}),{routing:fixture.routing});
  const editor = targetFixture('Prepared editor'), next = targetFixture('New channel'), bottom = targetFixture('Bottom Keyboard');
  t.keyboard.attachEditorTarget(editor.target); t.keyboard.setView('dx7'); t.send('keydown');
  t.keyboard.attachSynth(t.synth); t.keyboard.attachNoteTarget(bottom.target);
  fixture.set({chipId:'psg-1',channelId:'tone-2'}); ready();
  await new Promise(setImmediate);
  assert.deepEqual(editor.events.map(event => event[0]),['on']);
  t.send('keyup');
  t.send('keydown','s'); t.keyboard.attachEditorTarget(next.target); ready();
  await new Promise(setImmediate);
  assert.deepEqual(editor.events.map(event => event[0]),['on','off']);
  assert.deepEqual(next.events,[],'changing CH while preparing cancels the old press');
  assert.deepEqual(bottom.events,[]);
  assert.throws(() => t.keyboard.attachEditorTarget({name:'Broken'}),/Keyboard target/);
  t.send('keydown'); ready(); await new Promise(setImmediate); t.send('keyup');
  assert.deepEqual(next.events.map(event => event[0]),['on','off'],'an invalid attachment leaves the current target usable');
});

test('editor target updates remain independent from OPN audition and bottom Keyboard holds', () => {
  const t = setup(), editor = targetFixture('Editor'), replacement = targetFixture('Replacement'), bottom = targetFixture('Bottom Keyboard');
  t.keyboard.attachSynth(t.synth); t.keyboard.attachNoteTarget(bottom.target); t.keyboard.attachEditorTarget(editor.target);
  t.keyboard.setView('operator'); t.send('keydown');
  t.keyboard.attachEditorTarget(replacement.target); t.send('keyup');
  assert.deepEqual(t.notes,[['on',2,4,553],['off',2]]);
  t.keyboard.setView('keyboard'); t.send('keydown');
  t.keyboard.attachEditorTarget(null);
  assert.deepEqual(bottom.events.map(event => event[0]),['on'],'background editor changes preserve a bottom Keyboard note');
  t.send('keyup');
  assert.deepEqual(bottom.events.map(event => event[0]),['on','off']);
  assert.deepEqual(editor.events,[]); assert.deepEqual(replacement.events,[]);
});

test('routed Keyboard exposes actual Chip and CH choices without duplicate FM controls', () => {
  const fixture = routingFixture(), t = setup(undefined,{routing:fixture.routing});
  t.keyboard.setView('keyboard');
  const chip = t.root.querySelector('#playgroundKeyboardChip');
  const channel = t.root.querySelector('#playgroundKeyboardTargetChannel');
  assert.equal(t.root.querySelector('#playgroundKeyboardRoutingTools').hidden,false);
  assert.equal(t.root.querySelector('#playgroundKeyboardChannelTools').hidden,true);
  assert.equal(chip.value,'ym2612-1');
  assert.deepEqual(chip.children.map(option => option.textContent),['YM2612 #1','Sega PSG #1']);
  assert.deepEqual(channel.children.map(option => option.textContent),['FM CH1','FM CH2']);
  choose(t,'#playgroundKeyboardChip','psg-1');
  assert.equal(channel.value,'tone-1');
  assert.deepEqual(channel.children.map(option => option.textContent),['Tone CH1','Tone CH2']);
  choose(t,'#playgroundKeyboardTargetChannel','tone-2');
  assert.deepEqual(fixture.selections,[['chip','psg-1'],['channel','tone-2']]);
  assert.match(t.root.querySelector('#playgroundKeyboardHint').textContent,/Sega PSG #1 \/ Tone CH2/);
  assert.match(t.root.querySelector('#playgroundKeyboardStatus').textContent,/Sega PSG #1 \/ Tone CH2/);
  t.keyboard.setView('operator');
  assert.equal(t.root.querySelector('#playgroundKeyboardRoutingTools').hidden,true);
  assert.equal(t.root.querySelector('#playgroundKeyboardChannelTools').hidden,false,'compact Operator retains its own FM controls');
});

test('selecting Chip or CH while idle sends no note or panic commands', () => {
  const fixture = routingFixture(), t = setup(undefined,{routing:fixture.routing});
  const first = targetFixture('YM2612 #1 CH1'), second = targetFixture('YM2612 #1 CH2'), psg = targetFixture('PSG #1');
  fixture.onChange = state => t.keyboard.attachNoteTarget(state.chipId === 'psg-1' ? psg.target : second.target);
  t.keyboard.attachNoteTarget(first.target); t.keyboard.setView('keyboard');
  choose(t,'#playgroundKeyboardTargetChannel','fm-2');
  choose(t,'#playgroundKeyboardChip','psg-1');
  assert.deepEqual([...first.events,...second.events,...psg.events],[]);
  t.send('keydown'); t.send('keyup');
  assert.deepEqual(psg.events.map(event => event[0]),['on','off']);
});

test('changing a routed channel releases held notes and their old keyup cannot stop a replacement', () => {
  const fixture = routingFixture(), t = setup(undefined,{routing:fixture.routing});
  const first = targetFixture('CH1'), second = targetFixture('CH2');
  t.keyboard.attachNoteTarget(first.target); t.keyboard.setView('keyboard');
  fixture.onChange = () => t.keyboard.attachNoteTarget(second.target);
  t.send('keydown','a',{code:'KeyA'});
  const firstId = first.events[0][1].id;
  const layout = t.pointerOptions();
  choose(t,'#playgroundKeyboardTargetChannel','fm-2');
  assert.deepEqual(first.events.map(event => event[0]),['on','off','all']);
  assert.equal(first.events[1][1].id,firstId);
  assert.equal(t.buttonFor('a').classList.contains('is-active'),false);
  assert.equal(t.pointerOptions(),layout,'selecting a route preserves the fretboard DOM and focus');
  t.send('keydown','s',{code:'KeyS'}); t.send('keyup','a',{code:'KeyA'});
  assert.deepEqual(second.events.map(event => event[0]),['on']);
  t.send('keyup','s',{code:'KeyS'});
  assert.deepEqual(second.events.map(event => event[0]),['on','off']);
});

test('instance metadata additions and removals update choices without releasing an unchanged held route', () => {
  const fixture = routingFixture(), t = setup(undefined,{routing:fixture.routing}), current = targetFixture('CH1');
  t.keyboard.attachNoteTarget(current.target); t.keyboard.setView('keyboard'); t.send('keydown');
  const chip = t.root.querySelector('#playgroundKeyboardChip'), layout = t.pointerOptions();
  const originalChip = fixture.routing.getState().chips[0];
  fixture.set({chips:[originalChip,{id:'ym2612-2',label:'YM2612 #2',channels:[{id:'fm-1',label:'FM CH1'}]}]});
  assert.deepEqual(chip.children.map(option => option.value),['ym2612-1','ym2612-2']);
  assert.equal(t.pointerOptions(),layout);
  assert.deepEqual(current.events.map(event => event[0]),['on']);
  fixture.set({chips:[originalChip]});
  assert.deepEqual(chip.children.map(option => option.value),['ym2612-1']);
  assert.deepEqual(current.events.map(event => event[0]),['on']);
  t.send('keyup');
  assert.deepEqual(current.events.map(event => event[0]),['on','off']);
});

test('removing the selected instance releases its keys and cannot fall back to the primary FM synth', () => {
  const fixture = routingFixture(), t = setup(undefined,{routing:fixture.routing}), current = targetFixture('Removed chip');
  t.keyboard.attachSynth(t.synth); t.keyboard.attachNoteTarget(current.target); t.keyboard.setView('keyboard');
  t.send('keydown','a');
  fixture.set({chips:fixture.routing.getState().chips.filter(chip => chip.id !== 'ym2612-1')});
  assert.deepEqual(current.events.map(event => event[0]),['on','off','all']);
  t.send('keyup','a'); t.send('keydown','s'); t.pointerDown('a');
  assert.deepEqual(current.events.map(event => event[0]),['on','off','all']);
  assert.deepEqual(t.notes,[]);
});

test('metadata updates preserve an open native selector and apply its latest options after blur', () => {
  const fixture = routingFixture(), t = setup(undefined,{routing:fixture.routing});
  t.keyboard.setView('keyboard');
  const chip = t.root.querySelector('#playgroundKeyboardChip'), options = chip.children;
  t.document.activeElement = chip;
  chip.value = 'psg-1';
  fixture.set({chips:[...fixture.routing.getState().chips,{id:'dx7-1',label:'DX7 #1',channels:[{id:'poly',label:'Polyphonic'}]}]});
  assert.equal(chip.children,options,'a metadata notification must not replace a focused native picker');
  assert.equal(chip.value,'psg-1','an uncommitted native picker choice is preserved');
  t.document.activeElement = null;
  chip.listeners.get('blur')();
  assert.deepEqual(chip.children.map(option => option.value),['ym2612-1','psg-1','dx7-1']);
  assert.equal(chip.value,'ym2612-1','the committed routing selection remains authoritative');
});

test('unsupported routes stay selectable, explain the limitation and never prepare or fall back to FM', () => {
  let preparations = 0;
  const fixture = routingFixture();
  fixture.set({chips:[...fixture.routing.getState().chips,{id:'pwm-1',label:'32X PWM #1',channels:[],disabled:true,hint:'Load a sample to use this instrument.'}]});
  const t = setup(() => {preparations++;},{routing:fixture.routing}), custom = targetFixture('Previously selected');
  t.keyboard.attachSynth(t.synth); t.keyboard.attachNoteTarget(custom.target); t.keyboard.setView('keyboard');
  choose(t,'#playgroundKeyboardChip','pwm-1');
  const chip = t.root.querySelector('#playgroundKeyboardChip'), channel = t.root.querySelector('#playgroundKeyboardTargetChannel');
  assert.equal(chip.children.find(option => option.value === 'pwm-1').disabled,false);
  assert.equal(channel.disabled,true);
  assert.match(t.root.querySelector('#playgroundKeyboardHint').textContent,/Load a sample/);
  t.send('keydown'); t.pointerDown();
  assert.equal(preparations,0);
  assert.deepEqual(t.notes,[]);
  assert.deepEqual(custom.events,[]);
});

test('routing changes during preparation cancel the pending note, and disposal unsubscribes metadata', async () => {
  let ready;
  const fixture = routingFixture(), t = setup(() => new Promise(resolve => {ready = resolve;}),{routing:fixture.routing});
  const old = targetFixture('Old'), next = targetFixture('Next');
  fixture.onChange = () => t.keyboard.attachNoteTarget(next.target);
  t.keyboard.attachNoteTarget(old.target); t.keyboard.setView('keyboard'); t.send('keydown');
  choose(t,'#playgroundKeyboardTargetChannel','fm-2'); ready();
  await new Promise(setImmediate);
  assert.deepEqual(old.events,[],'a pending key must not send an idle panic during selection');
  assert.deepEqual(next.events,[],'the old held key must not move to the replacement channel');
  assert.equal(fixture.listenerCount,1);
  t.keyboard.dispose();
  assert.equal(fixture.listenerCount,0);
});

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

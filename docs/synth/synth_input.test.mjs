import test from 'node:test';
import assert from 'node:assert/strict';
import {createSynthInputController} from './synth_input.js';

test('native shortcuts pass through and output switching does not start new notes', async t => {
  const previousWindow=globalThis.window, handlers=new Map(), notes=[];
  globalThis.window={addEventListener:(type,handler)=>handlers.set(type,handler),removeEventListener:()=>{}};
  t.after(()=>{globalThis.window=previousWindow;});
  let enabled=true;
  const voice={channel:0,held:false,key:null}, heldKeys=new Set(), activeKeys=new Map();
  const controller=createSynthInputController({
    getKeyLayout:()=>[],findLayoutEntry:()=>({pitch:{block:4,fnum:553},noteName:'D4'}),hasLayoutKey:()=>true,
    heldKeys,activePointers:new Map(),activeKeys,voices:[voice],getAudioReadyPromise:()=>null,
    getSynth:()=>({noteOn:(...args)=>notes.push(args),noteOff:()=>{}}),
    ensureAudioReady:async()=>{},chooseVoice:()=>voice,isInputEnabled:()=>enabled,
    updateKeyboardVisuals:()=>{},setStatus:()=>{},stopAllNotes:()=>{},
  });
  controller.attachWindowInput();
  for (const modifier of ['metaKey','ctrlKey','altKey']) {
    handlers.get('keydown')({key:'q',[modifier]:true,preventDefault:()=>assert.fail('Host shortcut was intercepted')});
  }
  assert.equal(heldKeys.size,0);
  enabled=false;await controller.pressKey('a');assert.equal(notes.length,0);
  enabled=true;await controller.pressKey('a');
  assert.deepEqual(notes,[[0,4,553]]);
  controller.releaseKey('a');assert.equal(activeKeys.size,0);
});

function inputFixture(t, { ensureAudioReady = async () => {} } = {}) {
  const previousWindow = globalThis.window;
  const handlers = new Map();
  globalThis.window = {
    addEventListener(type, handler) { handlers.set(type, handler); },
    removeEventListener() {},
  };
  t.after(() => { globalThis.window = previousWindow; });
  const notes = [], releases = [], frets = [], strings = [];
  let recordingToggles = 0;
  const heldKeys = new Set(), activeKeys = new Map();
  const voice = { channel: 0, held: false, key: null };
  const controller = createSynthInputController({
    getKeyLayout: () => [],
    findLayoutEntry: (_, key) => key === 'a' ? { pitch: { block: 4, fnum: 553 }, noteName: 'D4' } : null,
    hasLayoutKey: (_, key) => key === 'a',
    heldKeys, activeKeys, activePointers: new Map(), voices: [voice],
    getAudioReadyPromise: () => null,
    getSynth: () => ({ noteOn: (...args) => notes.push(args), noteOff: channel => releases.push(channel) }),
    ensureAudioReady, chooseVoice: () => voice,
    updateKeyboardVisuals() {}, setStatus() {}, stopAllNotes() {},
    onShiftFret: offset => frets.push(offset),
    onShiftStringWindow: offset => strings.push(offset),
    onToggleRecord: () => recordingToggles++,
  });
  controller.attachWindowInput();
  return { handlers, controller, notes, releases, frets, strings, heldKeys, activeKeys, voice, get recordingToggles() { return recordingToggles; } };
}

// Each target may be a child of the editable surface (for example the body
// of a dialog), so ancestor containment matters as well as the element tag.
function targetWithin(selector) {
  const ancestor = {};
  return { closest(query) { return query.split(',').map(part => part.trim()).includes(selector) ? ancestor : null; } };
}

function keyEvent(key, target) {
  let prevented = 0;
  return {
    key, code: key === ' ' ? 'Space' : key,
    target, repeat: false,
    preventDefault() { prevented++; },
    get prevented() { return prevented; },
  };
}

test('typing in editable controls, open dialogs and the file menu does not play or intercept editing keys', async t => {
  const ui = inputFixture(t);
  for (const surface of ['input', 'textarea', 'select', '[contenteditable="true"]', 'dialog[open]', '#synthFileContextMenu']) {
    for (const key of ['a', ' ', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']) {
      const down = keyEvent(key, targetWithin(surface));
      const up = keyEvent(key, targetWithin(surface));
      ui.handlers.get('keydown')(down);
      ui.handlers.get('keyup')(up);
      assert.equal(down.prevented, 0, `${surface}: keydown ${key} stays available to the control`);
      assert.equal(up.prevented, 0, `${surface}: keyup ${key} stays available to the control`);
    }
  }
  await Promise.resolve();
  assert.deepEqual(ui.notes, []);
  assert.deepEqual(ui.releases, []);
  assert.deepEqual(ui.frets, []);
  assert.deepEqual(ui.strings, []);
  assert.equal(ui.recordingToggles, 0);
  assert.equal(ui.heldKeys.size, 0);
  assert.equal(ui.activeKeys.size, 0);
});

test('keyup in a name input releases an already held note without preventing text input', async t => {
  const ui = inputFixture(t);
  const down = keyEvent('a', targetWithin('button'));
  ui.handlers.get('keydown')(down);
  await Promise.resolve();
  assert.equal(down.prevented, 1);
  assert.deepEqual(ui.notes, [[0, 4, 553]]);
  assert.equal(ui.voice.held, true);

  const up = keyEvent('a', targetWithin('input'));
  ui.handlers.get('keyup')(up);
  assert.equal(up.prevented, 0);
  assert.deepEqual(ui.releases, [0]);
  assert.equal(ui.voice.held, false);
  assert.equal(ui.voice.key, null);
  assert.equal(ui.heldKeys.size, 0);
  assert.equal(ui.activeKeys.size, 0);
  ui.handlers.get('keyup')(keyEvent('a', targetWithin('input')));
  assert.deepEqual(ui.releases, [0], 'an unrelated subsequent keyup does not release the channel again');
});

test('releasing a key in a dialog while audio is preparing prevents a delayed note', async t => {
  let finishPreparation;
  const ui = inputFixture(t, { ensureAudioReady: () => new Promise(resolve => { finishPreparation = resolve; }) });
  ui.handlers.get('keydown')(keyEvent('a', targetWithin('button')));
  assert.equal(ui.heldKeys.has('a'), true);
  const up = keyEvent('a', targetWithin('dialog[open]'));
  ui.handlers.get('keyup')(up);
  assert.equal(up.prevented, 0);
  finishPreparation();
  await Promise.resolve();
  assert.deepEqual(ui.notes, []);
  assert.equal(ui.heldKeys.size, 0);
  assert.equal(ui.activeKeys.size, 0);
});

test('noneditable buttons retain performance letters and page shortcuts still work', async t => {
  const ui = inputFixture(t);
  const target = targetWithin('button');
  ui.handlers.get('keydown')(keyEvent('a', target));
  await Promise.resolve();
  assert.deepEqual(ui.notes, [[0, 4, 553]]);
  ui.handlers.get('keyup')(keyEvent('a', target));
  assert.deepEqual(ui.releases, [0]);
  const page = targetWithin('body');
  ui.handlers.get('keydown')(keyEvent('ArrowLeft', page));
  ui.handlers.get('keydown')(keyEvent('ArrowDown', page));
  ui.handlers.get('keydown')(keyEvent(' ', page));
  assert.deepEqual(ui.frets, [-1]);
  assert.deepEqual(ui.strings, [-1]);
  assert.equal(ui.recordingToggles, 1);
});

test('focused performance sliders keep musical letters and native navigation without page shortcuts', async t => {
  const ui=inputFixture(t);
  const range={
    closest(query){return query.split(',').some(part=>part.trim()==='input'||part.trim()==='input[type="range"]')?this:null;},
    matches(query){return query==='input[type="range"]';},
  };
  for(const key of ['ArrowLeft','ArrowUp','Home','End',' ']){
    const down=keyEvent(key,range),up=keyEvent(key,range);
    ui.handlers.get('keydown')(down);ui.handlers.get('keyup')(up);
    assert.equal(down.prevented,0);assert.equal(up.prevented,0);
  }
  assert.deepEqual(ui.frets,[]);assert.deepEqual(ui.strings,[]);assert.equal(ui.recordingToggles,0);
  ui.handlers.get('keydown')(keyEvent('a',range));await Promise.resolve();
  assert.deepEqual(ui.notes,[[0,4,553]]);
  ui.handlers.get('keyup')(keyEvent('a',range));assert.deepEqual(ui.releases,[0]);
});

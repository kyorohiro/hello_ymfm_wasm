import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createPlaygroundGameboyVoicePanel, gameboyFrequencyNote, gameboyNoteMidi, gameboyVoiceCode} from './playground_gameboy_voice_panel.js';

class Events {
  constructor() { this.listeners = new Map(); }
  addEventListener(name, callback) { if (!this.listeners.has(name)) this.listeners.set(name, new Set()); this.listeners.get(name).add(callback); }
  removeEventListener(name, callback) { this.listeners.get(name)?.delete(callback); }
  async fire(type, extra = {}) {
    await Promise.all([...this.listeners.get(type) ?? []].map(callback => callback({type, target: this, preventDefault() {}, ...extra})));
    await flush();
  }
}
class Element extends Events {
  constructor(doc, tag) { super(); this.ownerDocument = doc; this.tagName = tag; this.children = []; this.dataset = {}; this.attributes = {}; this.value = ''; this.textContent = ''; this.max = ''; this.hidden = false; this.checked = false; }
  appendChild(node) { this.children.push(node); node.parentNode = this; return node; }
  append(...nodes) { nodes.forEach(node => this.appendChild(node)); }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name]; }
  setCustomValidity(message) { this.validityMessage = message; }
  reportValidity() {}
  getContext() { return null; }
  getBoundingClientRect() { return {left: 0, top: 0, width: 640, height: 160}; }
  setPointerCapture() {}
}
const flush = () => new Promise(resolve => setImmediate(resolve));
const walk = root => [root, ...root.children.flatMap(walk)];
const control = (root, name) => walk(root).find(node => node.dataset.chipControl === name);
const action = (root, name) => walk(root).find(node => node.dataset.chipAction === name);
const channel = (root, index) => walk(root).find(node => node.dataset.chipChannel === String(index));
const state = () => ({
  kind: 'gameboy', clock: 4194304, sampleRate: 44100, powered: true,
  masterVolume: {left: 3, right: 3}, registers: Array(48).fill(0),
  channels: [
    {channel: 0, type: 'pulse', active: true, pan: {left: true, right: true}, frequency: 440, period: 1750, duty: 0.5, volume: 10, envelope: {direction: 'down', period: 2}, sweep: {direction: 'up', period: 0, shift: 0}, lengthEnabled: false, lengthCount: 0},
    {channel: 1, type: 'pulse', active: false, pan: {left: true, right: true}, frequency: 220, period: 1452, duty: 0.25, volume: 8, envelope: {direction: 'up', period: 1}, lengthEnabled: true, lengthCount: 32},
    {channel: 2, type: 'wave', active: false, pan: {left: true, right: false}, frequency: 220, period: 1750, level: 0.5, waveform: Array.from({length: 32}, (_, i) => i >> 1), lengthEnabled: true, lengthCount: 200},
    {channel: 3, type: 'noise', active: false, pan: {left: false, right: true}, volume: 12, envelope: {direction: 'down', period: 2}, divisor: 3, shift: 4, width: 15, lengthEnabled: false, lengthCount: 0},
  ],
});
function fixture(options = {}) {
  const win = new Events(); win.setTimeout = setTimeout; win.clearTimeout = clearTimeout;
  const doc = new Events(); doc.hidden = false; doc.activeElement = null; doc.defaultView = win; doc.createElement = tag => new Element(doc, tag);
  const root = new Element(doc, 'div'), calls = [], targets = [];
  const panel = createPlaygroundGameboyVoicePanel({root, invoke: async (...args) => {calls.push(args);}, onKeyboardTargetChange: target => targets.push(target), ...options});
  panel.setConnected(true); panel.update(state()); return {root, doc, win, calls, targets, panel};
}

test('Game Boy note helpers use standard MIDI names and reject invalid note input', () => {
  assert.equal(gameboyFrequencyNote(440), 'A4'); assert.equal(gameboyFrequencyNote(261.625565), 'C4');
  assert.equal(gameboyFrequencyNote(0), '—'); assert.equal(gameboyFrequencyNote(NaN), '—');
  assert.equal(gameboyNoteMidi('C4'), 60); assert.equal(gameboyNoteMidi('Bb3'), 58); assert.equal(gameboyNoteMidi('c#-1'), 1);
  assert.throws(() => gameboyNoteMidi('junk'), /note name/); assert.throws(() => gameboyNoteMidi('C20'), /MIDI/);
});

test('Game Boy updates render configured voices without writing, and preserve focused edits', () => {
  const {root, panel, calls, doc} = fixture();
  assert.equal(control(root, 'gb-frequency').value, '440'); assert.equal(control(root, 'gb-note').value, 'A4');
  assert.equal(control(root, 'gb-duty').value, '0.5'); assert.deepEqual(calls, []);
  const input = control(root, 'gb-frequency'); doc.activeElement = input; input.value = '123.456';
  const changed = state(); changed.channels[0].frequency = 880; panel.update(changed);
  assert.equal(input.value, '123.456'); assert.equal(control(root, 'gb-note').value, 'A5'); assert.deepEqual(calls, []);
  panel.dispose();
});

test('parameter controls send only the edited settings and keep note entry separate from triggering', async () => {
  const {root, panel, calls} = fixture();
  control(root, 'gb-duty').value = '0.125'; await control(root, 'gb-duty').fire('change');
  control(root, 'gb-envelope-period').value = '7'; await control(root, 'gb-envelope-period').fire('change');
  control(root, 'gb-note').value = 'A4'; await control(root, 'gb-note').fire('change');
  assert.deepEqual(calls, [['setVoice', [0, {duty: 0.125}]], ['setVoice', [0, {envelope: {period: 7}}]], ['setVoice', [0, {frequency: 440}]]]);
  control(root, 'gb-envelope-period').value = '8'; await control(root, 'gb-envelope-period').fire('change'); assert.equal(calls.length, 3);
  panel.dispose();
});

test('APU power is an explicit command and readback never restores a previous voice automatically', async () => {
  const {root, panel, calls} = fixture(), power = control(root, 'gb-power');
  assert.equal(power.checked, true); power.checked = false; await power.fire('change');
  assert.deepEqual(calls, [['setPower', [false]]]);
  const off = state(); off.powered = false; panel.update(off);
  assert.equal(power.checked, false); assert.equal(calls.length, 1);
  power.checked = true; await power.fire('change'); assert.deepEqual(calls[1], ['setPower', [true]]); assert.equal(calls.length, 2);
  panel.dispose();
});

test('holding audition releases on blur, release, channel change and disconnect', async () => {
  const {root, panel, calls, win} = fixture();
  await action(root, 'gb-hold').fire('pointerdown', {pointerId: 1, button: 0});
  assert.equal(calls[0][0], 'auditionOn'); assert.deepEqual(calls[0][1].slice(0, 2), [0, 69]);
  await win.fire('blur'); assert.deepEqual(calls[1], ['auditionOff', [0, calls[0][1][2]]]);
  await action(root, 'gb-hold').fire('pointerup', {pointerId: 1}); assert.equal(calls.length, 2);
  await action(root, 'gb-hold').fire('keydown', {key: ' ', repeat: false});
  await channel(root, 1).fire('click'); assert.deepEqual(calls.at(-1), ['auditionOff', [0, calls[2][1][2]]]);
  await action(root, 'gb-hold').fire('pointerdown', {pointerId: 2}); panel.setConnected(false);
  assert.deepEqual(calls.at(-1), ['auditionOff', [1, calls[4][1][2]]]);
  assert.equal(walk(root).find(node => node.tagName === 'fieldset').disabled, true); panel.dispose();
});

test('one-second preview has a bounded release and becomes inert after hiding', async t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  const {root, panel, calls} = fixture();
  await action(root, 'gb-play').fire('click'); assert.equal(calls[0][0], 'auditionOn');
  t.mock.timers.tick(999); assert.equal(calls.length, 1);
  t.mock.timers.tick(1); await flush(); assert.deepEqual(calls[1], ['auditionOff', [0, calls[0][1][2]]]);
  await action(root, 'gb-play').fire('click'); panel.setVisible(false);
  assert.deepEqual(calls.at(-1), ['auditionOff', [0, calls[2][1][2]]]);
  t.mock.timers.tick(1000); assert.equal(calls.length, 4); panel.dispose();
});

test('an older pointer release cannot silence a newer hold and secondary pointer buttons are ignored', async () => {
  const {root, panel, calls} = fixture(), hold = action(root, 'gb-hold');
  await hold.fire('pointerdown', {pointerId: 1, button: 2}); assert.equal(calls.length, 0);
  await hold.fire('pointerdown', {pointerId: 1, button: 0});
  await hold.fire('pointerdown', {pointerId: 2, button: 0}); assert.equal(calls.length, 3);
  await hold.fire('pointerup', {pointerId: 1}); assert.equal(calls.length, 3);
  await hold.fire('pointerup', {pointerId: 2}); assert.deepEqual(calls.at(-1), ['auditionOff', [0, calls[2][1][2]]]); panel.dispose();
});

test('Keyboard target remains playable when the voice tab hides, and stale releases cannot stop its next target', async () => {
  const {root, panel, calls, targets} = fixture();
  await action(root, 'gb-keyboard').fire('click'); const first = targets.at(-1);
  assert.equal(first.owner, 'gameboy-voice-panel'); panel.setVisible(false);
  first.noteOn({id: 'press1', midi: 60, velocity: 100}); await flush(); assert.deepEqual(calls[0][1].slice(0, 2), [0, 60]);
  await channel(root, 2).fire('click'); const second = targets.at(-1); assert.notEqual(first, second);
  second.noteOn({id: 'press1', midi: 67}); first.noteOff({id: 'press1'}); first.noteOn({id: 'late', midi: 60}); await flush();
  assert.deepEqual(calls.map(call => call[0]), ['auditionOn', 'auditionOff', 'auditionOn']); assert.equal(calls[2][1][0], 2);
  second.noteOff({id: 'press1'}); await flush(); assert.deepEqual(calls[3], ['auditionOff', [2, calls[2][1][2]]]);
  panel.setConnected(false); assert.equal(targets.at(-1), null); second.noteOn({id: 'disconnected', midi: 69}); await flush(); assert.equal(calls.length, 4);
  panel.dispose();
});

test('replacing the Keyboard binding retires panel input without claiming it again on channel changes', async () => {
  const {root, panel, calls, targets} = fixture();
  await action(root, 'gb-keyboard').fire('click'); const target = targets.at(-1);
  target.noteOn({id: 'press1', midi: 69}); panel.setKeyboardActive(false); await flush();
  assert.deepEqual(calls.map(call => call[0]), ['auditionOn', 'auditionOff']);
  await channel(root, 1).fire('click'); assert.equal(targets.length, 1);
  target.noteOn({id: 'stale', midi: 69}); await flush(); assert.equal(calls.length, 2); panel.dispose();
});

test('a disconnected instance cannot report a delayed command error in its replacement', async () => {
  let rejectCommand; const errors = [];
  const {root, panel} = fixture({invoke: () => new Promise((resolve, reject) => {rejectCommand = reject;}), onError: error => errors.push(error)});
  const controlNode = control(root, 'gb-duty'); controlNode.value = '0.25'; const changing = controlNode.fire('change');
  panel.setConnected(false); panel.setConnected(true); rejectCommand(new Error('Old chip disconnected')); await changing;
  assert.deepEqual(errors, []); panel.dispose();
});

test('Wave RAM drawing applies one complete 32-sample update on release and supports the 8-bit length register', async () => {
  const {root, panel, calls} = fixture(); await channel(root, 2).fire('click');
  const canvas = control(root, 'gb-waveform');
  await canvas.fire('pointerdown', {pointerId: 3, button: 0, clientX: 10, clientY: 160});
  await canvas.fire('pointermove', {pointerId: 3, clientX: 630, clientY: 0}); assert.deepEqual(calls, []);
  await canvas.fire('pointerup', {pointerId: 3});
  assert.equal(calls.length, 1); assert.equal(calls[0][0], 'setVoice'); assert.equal(calls[0][1][0], 2);
  const wave = calls[0][1][1].waveform; assert.equal(wave.length, 32); assert.equal(wave[0], 0); assert.equal(wave[31], 15); assert.ok(wave.every(value => Number.isInteger(value) && value >= 0 && value <= 15));
  control(root, 'gb-length-count').value = '240'; await control(root, 'gb-length-count').fire('change');
  assert.deepEqual(calls[1], ['setVoice', [2, {lengthCount: 240}]]);
  await canvas.fire('pointerdown', {pointerId: 4, button: 0, clientX: 20, clientY: 0}); await channel(root, 0).fire('click');
  await canvas.fire('pointerup', {pointerId: 4}); assert.equal(calls.length, 2); panel.dispose();
});

test('noise controls expose its own clock and envelope; JavaScript copies configured values', async () => {
  const {root, panel, calls} = fixture(); await channel(root, 3).fire('click');
  assert.equal(control(root, 'gb-frequency').parentNode.hidden, true); assert.equal(control(root, 'gb-duty').parentNode.hidden, true);
  assert.equal(walk(root).find(node => node.dataset.chipOutput === 'gb-noise-clock').textContent, '5461.33');
  control(root, 'gb-noise-width').value = '7'; await control(root, 'gb-noise-width').fire('change');
  assert.deepEqual(calls[0], ['setVoice', [3, {width: 7}]]);
  const code = gameboyVoiceCode(state(), 3); assert.match(code, /gameboy\.noise\.setVoice/); assert.match(code, /"volume":12/); assert.doesNotMatch(code, /setFrequency/);
  assert.match(gameboyVoiceCode(state(), 2), /stopAndSetWaveform/); assert.match(gameboyVoiceCode(state(), 1), /disables hardware length/);
  panel.dispose(); assert.equal([...root.ownerDocument.listeners.values()].reduce((sum, entries) => sum + entries.size, 0), 0);
});

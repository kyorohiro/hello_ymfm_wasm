import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createPlaygroundYm2151VoicePanel, ym2151FrequencyNote, ym2151NoteMidi, ym2151VoiceCode} from './playground_ym2151_voice_panel.js';

class Events {
  constructor() {this.listeners = new Map();}
  addEventListener(name, callback) {if (!this.listeners.has(name)) this.listeners.set(name, new Set()); this.listeners.get(name).add(callback);}
  removeEventListener(name, callback) {this.listeners.get(name)?.delete(callback);}
  async fire(type, extra = {}) {await Promise.all([...this.listeners.get(type) ?? []].map(callback => callback({type, target: this, preventDefault() {}, ...extra}))); await flush();}
}
class Element extends Events {
  constructor(doc, tag) {super(); this.ownerDocument = doc; this.tagName = tag; this.children = []; this.dataset = {}; this.attributes = {}; this.value = ''; this.textContent = ''; this.hidden = false; this.checked = false;}
  appendChild(node) {this.children.push(node); node.parentNode = this; return node;}
  setAttribute(name, value) {this.attributes[name] = String(value);}
  getAttribute(name) {return this.attributes[name];}
  setCustomValidity(message) {this.validityMessage = message;}
  reportValidity() {}
  getContext() {return null;}
  setPointerCapture() {}
}
const flush = () => new Promise(resolve => setImmediate(resolve));
const walk = root => [root, ...root.children.flatMap(walk)];
const control = (root, name) => walk(root).find(node => node.dataset.chipControl === `ym2151-${name}`);
const action = (root, name) => walk(root).find(node => node.dataset.chipAction === `ym2151-${name}`);
const channel = (root, index) => walk(root).find(node => node.dataset.chipChannel === String(index));
const state = () => ({
  kind: 'ym2151', clock: 4000000, sampleRate: 62500, activeSource: 'applied-register-gates', registers: Array(256).fill(0),
  channels: Array.from({length: 8}, (_, channel) => ({
    channel, type: 'fm', active: channel === 0, keyMask: channel === 0 ? 15 : 0, keyCode: 0x4a, keyFraction: 0, frequency: channel === 0 ? 440 : 220,
    midi: channel === 0 ? 69 : 57, algorithm: channel, feedback: 3, pan: {left: true, right: false}, ams: 2, pms: 4,
    operators: Array.from({length: 4}, (_, index) => ({dt1: index, dt2: index, mul: index + 1, tl: 16 * index, ks: index, ar: 31 - index, am: index === 1, d1r: 5, d2r: 3, d1l: 4, rr: 15})),
  })),
  lfo: {frequency: 200, amDepth: 37, pmDepth: 62, waveform: 2}, noise: {enabled: true, frequency: 20},
});
function fixture(options = {}) {
  const win = new Events(); win.setTimeout = setTimeout; win.clearTimeout = clearTimeout;
  const doc = new Events(); doc.defaultView = win; doc.activeElement = null; doc.hidden = false; doc.createElement = tag => new Element(doc, tag);
  const root = new Element(doc, 'div'), calls = [], targets = [];
  const panel = createPlaygroundYm2151VoicePanel({root, invoke: async (...args) => {calls.push(args);}, onKeyboardTargetChange: target => targets.push(target), ...options});
  panel.setConnected(true); panel.update(state()); return {root, doc, win, calls, targets, panel};
}

test('YM2151 note helpers use standard MIDI names, with no OPN octave offset', () => {
  assert.equal(ym2151FrequencyNote(440), 'A4'); assert.equal(ym2151FrequencyNote(261.625565), 'C4'); assert.equal(ym2151FrequencyNote(0), '—');
  assert.equal(ym2151NoteMidi('C4'), 60); assert.equal(ym2151NoteMidi('Bb3'), 58); assert.equal(ym2151NoteMidi('c#-1'), 1);
  assert.throws(() => ym2151NoteMidi('junk'), /note name/); assert.throws(() => ym2151NoteMidi('C20'), /MIDI/);
});

test('opening and updating applied settings never writes and polling preserves focused edits', () => {
  const {root, panel, calls, doc} = fixture();
  assert.equal(control(root, 'frequency').value, '440'); assert.equal(control(root, 'note').value, 'A4'); assert.equal(control(root, 'op-1-dt2').value, '1');
  assert.equal(control(root, 'pan-left').checked, true); assert.equal(control(root, 'pan-right').checked, false); assert.deepEqual(calls, []);
  const input = control(root, 'op-1-tl'); doc.activeElement = input; input.value = '123'; const next = state(); next.channels[0].operators[1].tl = 15; next.channels[0].frequency = 880; panel.update(next);
  assert.equal(input.value, '123'); assert.equal(control(root, 'note').value, 'A5'); assert.deepEqual(calls, []); panel.dispose();
});

test('OPM controls send only edited fields with logical operator indices and preserve unrelated routing', async () => {
  const {root, panel, calls} = fixture();
  for (const [name, value] of [['op-1-dt2', '3'], ['op-2-mul', '0'], ['algorithm', '6'], ['feedback', '5'], ['key-fraction', '63']]) {control(root, name).value = value; await control(root, name).fire('change');}
  control(root, 'op-0-am').checked = true; await control(root, 'op-0-am').fire('change');
  control(root, 'pan-right').checked = true; await control(root, 'pan-right').fire('change');
  assert.deepEqual(calls, [
    ['setOperator', [0, 1, {dt2: 3}]], ['setOperator', [0, 2, {mul: 0}]], ['setVoice', [0, {algorithm: 6}]], ['setVoice', [0, {feedback: 5}]],
    ['setVoice', [0, {keyFraction: 63}]], ['setOperator', [0, 0, {am: true}]], ['setVoice', [0, {pan: {right: true}}]],
  ]);
  control(root, 'op-1-dt2').value = '4'; await control(root, 'op-1-dt2').fire('change');
  control(root, 'feedback').value = '2.5'; await control(root, 'feedback').fire('change'); assert.equal(calls.length, 7); panel.dispose();
});

test('note and raw OPM pitch edits do not trigger, and global LFO/noise edits stay partial', async () => {
  const {root, panel, calls} = fixture();
  control(root, 'note').value = 'A4'; await control(root, 'note').fire('change');
  control(root, 'frequency').value = '432.5'; await control(root, 'frequency').fire('change');
  control(root, 'lfo-am-depth').value = '127'; await control(root, 'lfo-am-depth').fire('change');
  control(root, 'lfo-pm-depth').value = '0'; await control(root, 'lfo-pm-depth').fire('change');
  control(root, 'lfo-waveform').value = '3'; await control(root, 'lfo-waveform').fire('change');
  control(root, 'noise-enabled').checked = false; await control(root, 'noise-enabled').fire('change');
  control(root, 'noise-frequency').value = '31'; await control(root, 'noise-frequency').fire('change');
  assert.deepEqual(calls, [['setNote', [0, 69]], ['setFrequency', [0, 432.5]], ['setLFO', [{amDepth: 127}]], ['setLFO', [{pmDepth: 0}]], ['setLFO', [{waveform: 3}]], ['setNoise', [{enabled: false}]], ['setNoise', [{frequency: 31}]]]);
  panel.dispose();
});

test('Load basic voice is explicit, affects the selected channel, and mutes the three unused carriers', async () => {
  const {root, panel, calls} = fixture(); await channel(root, 5).fire('click'); assert.deepEqual(calls, []); await action(root, 'basic').fire('click');
  assert.equal(calls.length, 1); assert.equal(calls[0][0], 'setVoice'); assert.equal(calls[0][1][0], 5);
  const preset = calls[0][1][1]; assert.equal(preset.algorithm, 7); assert.deepEqual(preset.pan, {left: true, right: true}); assert.deepEqual(preset.operators.map(operator => operator.tl), [127, 127, 127, 32]);
  panel.dispose();
});

test('holding audition releases on blur, Release, channel change, disconnect and disposal', async () => {
  const {root, panel, calls, win} = fixture();
  await action(root, 'hold').fire('pointerdown', {pointerId: 1, button: 0}); assert.deepEqual(calls[0][1].slice(0, 2), [0, 69]);
  await win.fire('blur'); assert.deepEqual(calls[1], ['auditionOff', [0, calls[0][1][2]]]);
  await action(root, 'hold').fire('pointerup', {pointerId: 1}); assert.equal(calls.length, 2);
  await action(root, 'hold').fire('keydown', {key: ' ', repeat: false}); await action(root, 'release').fire('click'); assert.deepEqual(calls[3], ['auditionOff', [0, calls[2][1][2]]]);
  await action(root, 'hold').fire('pointerdown', {pointerId: 2, button: 0}); await channel(root, 7).fire('click'); assert.deepEqual(calls[5], ['auditionOff', [0, calls[4][1][2]]]);
  await action(root, 'hold').fire('pointerdown', {pointerId: 3, button: 0}); panel.setConnected(false); assert.deepEqual(calls[7], ['auditionOff', [7, calls[6][1][2]]]);
  assert.equal(walk(root).find(node => node.tagName === 'fieldset').disabled, true); panel.setConnected(true);
  await action(root, 'hold').fire('pointerdown', {pointerId: 4, button: 0}); panel.dispose(); assert.deepEqual(calls[9], ['auditionOff', [7, calls[8][1][2]]]);
});

test('one-second preview releases once, and hiding cancels preview and Hold without stopping Keyboard', async t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  const {root, panel, calls, targets} = fixture(); await action(root, 'play').fire('click'); t.mock.timers.tick(999); assert.equal(calls.length, 1);
  t.mock.timers.tick(1); await flush(); assert.deepEqual(calls[1], ['auditionOff', [0, calls[0][1][2]]]);
  await action(root, 'keyboard').fire('click'); const target = targets.at(-1); target.noteOn({id: 'keyboard', midi: 60});
  await action(root, 'play').fire('click'); panel.setVisible(false); await flush(); assert.equal(calls.at(-1)[0], 'auditionOff'); const length = calls.length;
  t.mock.timers.tick(1000); await flush(); assert.equal(calls.length, length); target.noteOff({id: 'keyboard'}); await flush(); assert.equal(calls.length, length + 1);
  await action(root, 'play').fire('click'); assert.equal(calls.length, length + 1); panel.dispose();
});

test('an old pointer release cannot end a newer hold and unrelated buttons do not audition', async () => {
  const {root, panel, calls} = fixture(), hold = action(root, 'hold');
  await hold.fire('pointerdown', {pointerId: 1, button: 2}); assert.equal(calls.length, 0);
  await hold.fire('pointerdown', {pointerId: 1, button: 0}); await hold.fire('pointerdown', {pointerId: 2, button: 0}); assert.equal(calls.length, 3);
  await hold.fire('pointerup', {pointerId: 1}); assert.equal(calls.length, 3);
  await hold.fire('pointerup', {pointerId: 2}); assert.deepEqual(calls[3], ['auditionOff', [0, calls[2][1][2]]]); panel.dispose();
});

test('Keyboard targets own unique notes, remain playable while hidden, and stale releases cannot mute a new target', async () => {
  const {root, panel, calls, targets} = fixture(); await action(root, 'keyboard').fire('click'); const first = targets.at(-1);
  assert.equal(first.owner, 'ym2151-voice-panel'); panel.setVisible(false); first.noteOn({id: 'same', midi: 60}); await flush();
  await channel(root, 1).fire('click'); const second = targets.at(-1); second.noteOn({id: 'same', midi: 67}); first.noteOff({id: 'same'}); first.allNotesOff(); first.noteOn({id: 'late', midi: 69}); await flush();
  assert.deepEqual(calls.map(call => call[0]), ['auditionOn', 'auditionOff', 'auditionOn']); assert.equal(calls[2][1][0], 1); assert.notEqual(calls[0][1][2], calls[2][1][2]);
  second.noteOff({id: 'same'}); await flush(); assert.deepEqual(calls[3], ['auditionOff', [1, calls[2][1][2]]]); panel.setConnected(false); assert.equal(targets.at(-1), null);
  second.noteOn({id: 'disconnected', midi: 69}); await flush(); assert.equal(calls.length, 4); panel.dispose();
});

test('replacing Keyboard ownership retires its old target without reclaiming it on channel changes', async () => {
  const {root, panel, calls, targets} = fixture(); await action(root, 'keyboard').fire('click'); const target = targets.at(-1);
  target.noteOn({id: 'press', midi: 69}); panel.setKeyboardActive(false); await flush(); assert.deepEqual(calls.map(call => call[0]), ['auditionOn', 'auditionOff']);
  await channel(root, 1).fire('click'); assert.equal(targets.length, 1); target.noteOn({id: 'stale', midi: 60}); await flush(); assert.equal(calls.length, 2); panel.dispose();
});

test('a late command rejection from a disconnected instance cannot replace new-instance status', async () => {
  let rejectCommand; const errors = [];
  const {root, panel} = fixture({invoke: () => new Promise((resolve, reject) => {rejectCommand = reject;}), onError: error => errors.push(error)});
  control(root, 'feedback').value = '4'; const changing = control(root, 'feedback').fire('change'); panel.setConnected(false); panel.setConnected(true);
  rejectCommand(new Error('Old chip disconnected')); await changing; assert.deepEqual(errors, []); panel.dispose();
});

test('voice JavaScript maps logical operators back to legacy register order, saves both LFO latches and CT pins', () => {
  const snapshot = state(); snapshot.registers[0x1b] = 0xc2; const code = ym2151VoiceCode(snapshot, 2);
  assert.match(code, /opm\.setOperator\(2, 0, .*"dt1":0/); assert.match(code, /opm\.setOperator\(2, 2, .*"dt1":1/); assert.match(code, /opm\.setOperator\(2, 1, .*"dt1":2/); assert.match(code, /opm\.setOperator\(2, 3, .*"dt1":3/);
  assert.match(code, /writeRegister\(0x19, 37\)/); assert.match(code, /writeRegister\(0x19, 190\)/); assert.match(code, /writeRegister\(0x1b, 194\)/);
  assert.match(code, /"am":1/); assert.doesNotMatch(code, /"ssg"|\.setLFO\(/);
});

test('disposing removes all panel DOM, window and visibility handlers', () => {
  const {root, panel, doc, win} = fixture(); panel.dispose(); panel.dispose();
  for (const node of [...walk(root), doc, win]) assert.equal([...node.listeners.values()].reduce((sum, entries) => sum + entries.size, 0), 0);
});

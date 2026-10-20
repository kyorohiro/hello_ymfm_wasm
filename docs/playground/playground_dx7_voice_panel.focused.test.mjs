import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createPlaygroundDx7VoicePanel, dx7OperatorTuning, dx7VoiceCode, dx7CarrierOperators} from './playground_dx7_voice_panel.js';
import {createInitVoice} from '../../web/msfa_dx7/src/sysex.js';
import {presetToVoice, voiceToPreset} from '../../web/msfa_dx7/src/preset.js';

class Events {
  constructor() {this.listeners = new Map();}
  addEventListener(type, callback) {if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(callback);}
  removeEventListener(type, callback) {this.listeners.get(type)?.delete(callback);}
  async fire(type, extra = {}) {await Promise.all([...this.listeners.get(type) ?? []].map(callback => callback({type, target: this, preventDefault() {}, ...extra}))); await flush();}
}
class Element extends Events {
  constructor(doc, tag) {super(); this.ownerDocument = doc; this.tagName = tag; this.children = []; this.dataset = {}; this.attributes = {}; this.value = ''; this.textContent = ''; this.checked = false;}
  appendChild(node) {this.children.push(node); node.parentNode = this; return node;}
  replaceChildren(...nodes) {this.children = []; for (const node of nodes) this.appendChild(node);}
  setAttribute(key, value) {this.attributes[key] = String(value);}
  getAttribute(key) {return this.attributes[key];}
  setCustomValidity(value) {this.validityMessage = value;}
  reportValidity() {}
  setPointerCapture() {}
}
const flush = () => new Promise(resolve => setImmediate(resolve));
const walk = root => [root, ...root.children.flatMap(walk)];
const control = (root, name) => walk(root).find(node => node.dataset.chipControl === `dx7-${name}`);
const action = (root, name) => walk(root).find(node => node.dataset.chipAction === `dx7-${name}`);
const operator = (root, number) => walk(root).find(node => node.dataset.chipOperator === String(number));
const output = (root, name) => walk(root).find(node => node.dataset.chipOutput === `dx7-${name}`);
const snapshot = () => ({kind: 'dx7', sampleRate: 48000, internalSampleRate: 44100, polyphony: 16,
  selectedVoice: 1, voices: [{index: 0, name: 'FIRST'}, {index: 1, name: 'SECOND'}],
  preset: voiceToPreset(presetToVoice({name: 'SECOND', algorithm: 0, feedback: 3, operators: {2: {coarse: 2, outputLevel: 64}}}, createInitVoice())),
  activeNotes: [{midi: 69, velocity: 100, manual: false}], auditions: [], logical: {pendingCommands: 0},
});
function fixture(options = {}) {
  const win = new Events(); win.setTimeout = setTimeout; win.clearTimeout = clearTimeout;
  const doc = new Events(); doc.defaultView = win; doc.activeElement = null; doc.hidden = false; doc.createElement = tag => new Element(doc, tag);
  const root = new Element(doc, 'div'), calls = [], targets = [];
  const panel = createPlaygroundDx7VoicePanel({root, invoke: async (...args) => {calls.push(args);}, onKeyboardTargetChange: target => targets.push(target), ...options});
  panel.setConnected(true); panel.update(snapshot()); return {root, doc, win, calls, targets, panel};
}
async function change(root, name, value) {const node = control(root, name); node.value = String(value); await node.fire('change');}

test('nominal ratio/fixed summaries follow DX7 coarse/fine semantics without OPN clock assumptions', () => {
  assert.equal(dx7OperatorTuning({mode: 'ratio', coarse: 0, fine: 0}), '×0.5');
  assert.equal(dx7OperatorTuning({mode: 'ratio', coarse: 2, fine: 50}), '×3');
  assert.equal(dx7OperatorTuning({mode: 'fixed', coarse: 2, fine: 0}), '100 Hz');
  assert.equal(dx7OperatorTuning({mode: 'fixed', coarse: 6, fine: 0}), '100 Hz');
  assert.equal(dx7OperatorTuning(null), '—');
});

test('carrier roles use public OP numbering for DX7 serial, paired and parallel algorithms', () => {
  assert.deepEqual(dx7CarrierOperators(0), [1, 3]);
  assert.deepEqual(dx7CarrierOperators(4), [1, 3, 5]);
  assert.deepEqual(dx7CarrierOperators(15), [1]);
  assert.deepEqual(dx7CarrierOperators(27), [1, 3, 6]);
  assert.deepEqual(dx7CarrierOperators(31), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(dx7CarrierOperators(32), []);
});

test('read/update is write-free, shows six public operators and preserves focused edits', async () => {
  const {root, panel, calls, doc} = fixture();
  assert.equal(control(root, 'voice').value, '1'); assert.equal(control(root, 'name').value, 'SECOND');
  assert.equal(control(root, 'algorithm').children.length, 32); assert.equal(control(root, 'algorithm').children[31].textContent, '32');
  assert.equal(walk(root).filter(node => node.dataset.chipOperator).length, 6);
  assert.equal(output(root, 'sample-rate').textContent, '48000 / 44100');
  await operator(root, 2).fire('click'); assert.equal(control(root, 'op-coarse').value, '2'); assert.deepEqual(calls, []);
  const field = control(root, 'op-output-level'); doc.activeElement = field; field.value = '77';
  const state = snapshot(); state.preset.operators[2].outputLevel = 30; state.preset.feedback = 6; panel.update(state);
  assert.equal(field.value, '77'); assert.equal(control(root, 'feedback').value, '6'); assert.deepEqual(calls, []); panel.dispose();
});

test('selected operator patches preserve public OP numbering and unrelated fields', async () => {
  const {root, panel, calls} = fixture(); await operator(root, 6).fire('click');
  for (const [name, value] of [['op-mode', 'fixed'], ['op-coarse', 3], ['op-fine', 99], ['op-detune', 14], ['op-output-level', 90], ['op-rate-scaling', 7], ['op-velocity-sensitivity', 4], ['op-amp-mod-sensitivity', 3]]) await change(root, name, value);
  assert.deepEqual(calls, [
    ['setOperator', [6, {mode: 'fixed'}]], ['setOperator', [6, {coarse: 3}]], ['setOperator', [6, {fine: 99}]], ['setOperator', [6, {detune: 14}]],
    ['setOperator', [6, {outputLevel: 90}]], ['setOperator', [6, {rateScaling: 7}]], ['setOperator', [6, {velocitySensitivity: 4}]], ['setOperator', [6, {ampModSensitivity: 3}]],
  ]); panel.dispose();
});

test('tuple edits replace one value, preserve the other three and never mutate snapshots', async () => {
  const {root, panel, calls} = fixture(), state = snapshot(), original = structuredClone(state); panel.update(state);
  await change(root, 'op-rate-2', 12); await change(root, 'op-level-4', 8); await change(root, 'pitch-rate-1', 42);
  assert.deepEqual(calls, [['setOperator', [1, {envelope: {rates: [99, 12, 99, 70]}}]], ['setOperator', [1, {envelope: {levels: [99, 99, 99, 8]}}]], ['setPreset', [{pitchEnvelope: {rates: [42, 99, 99, 99]}}]]]);
  assert.deepEqual(state, original); panel.dispose();
});

test('applied mutation acknowledgements refresh tuple source without pushing DOM before host refresh', async () => {
  const acknowledged = snapshot(); acknowledged.selectedVoice = 0; acknowledged.preset.pitchEnvelope.rates = [1, 2, 3, 4];
  const calls = [], {root, panel} = fixture({invoke: async (...args) => {calls.push(args); return acknowledged;}});
  await change(root, 'voice', 0); assert.equal(control(root, 'name').value, 'SECOND');
  await change(root, 'pitch-rate-2', 10);
  assert.deepEqual(calls[1], ['setPreset', [{pitchEnvelope: {rates: [1, 10, 3, 4]}}]]); panel.dispose();
});

test('voice, LFO, keyboard scaling and retained fields send only their own partial settings', async () => {
  const {root, panel, calls} = fixture();
  for (const [name, value] of [['name', 'NEW NAME'], ['algorithm', 31], ['feedback', 7], ['op-breakpoint', 60], ['op-left-depth', 50], ['op-left-curve', 2], ['lfo-speed', 90], ['lfo-waveform', 4], ['lfo-pitch-sensitivity', 7], ['transpose', 36]]) await change(root, name, value);
  control(root, 'lfo-sync').checked = true; await control(root, 'lfo-sync').fire('change');
  control(root, 'oscillator-sync').checked = false; await control(root, 'oscillator-sync').fire('change');
  assert.deepEqual(calls, [['setPreset', [{name: 'NEW NAME'}]], ['setPreset', [{algorithm: 31}]], ['setFeedback', [7]],
    ['setOperator', [1, {keyboardScaling: {breakpoint: 60}}]], ['setOperator', [1, {keyboardScaling: {leftDepth: 50}}]], ['setOperator', [1, {keyboardScaling: {leftCurve: 2}}]],
    ['setPreset', [{lfo: {speed: 90}}]], ['setPreset', [{lfo: {waveform: 4}}]], ['setPreset', [{lfo: {pitchModSensitivity: 7}}]], ['setPreset', [{transpose: 36}]], ['setPreset', [{lfo: {sync: true}}]], ['setPreset', [{oscillatorSync: false}]]]); panel.dispose();
});

test('invalid edits and invalid preview notes never write', async () => {
  const {root, panel, calls} = fixture();
  for (const [name, value] of [['op-output-level', 100], ['op-fine', -1], ['op-detune', 1.5], ['name', 'too long name'], ['name', '日本語'], ['audition-midi', 128]]) await change(root, name, value);
  await action(root, 'play').fire('click'); assert.deepEqual(calls, []); panel.dispose();
});

test('basic voice reset is explicit, complete and leaves other bank slots to the backend', async () => {
  const {root, panel, calls} = fixture(); await action(root, 'basic').fire('click');
  assert.equal(calls.length, 1); assert.equal(calls[0][0], 'setPreset');
  const preset = voiceToPreset(presetToVoice(calls[0][1][0]));
  assert.equal(preset.algorithm, 31); assert.equal(preset.name, 'INIT SINE'); assert.equal(preset.operators[1].outputLevel, 85);
  for (const op of [2, 3, 4, 5, 6]) assert.equal(preset.operators[op].outputLevel, 0); panel.dispose();
});

test('Hold owns a unique ID, passes velocity and ignores an older pointer release', async () => {
  const {root, panel, calls, win} = fixture(); const hold = action(root, 'hold');
  await change(root, 'audition-velocity', 93); await hold.fire('pointerdown', {pointerId: 1, button: 0});
  assert.deepEqual(calls[0][1].slice(0, 2), [0, 69]); assert.equal(calls[0][1][3], 93);
  await hold.fire('pointerdown', {pointerId: 2, button: 0}); assert.deepEqual(calls.map(call => call[0]), ['auditionOn', 'auditionOff', 'auditionOn']);
  await hold.fire('pointerup', {pointerId: 1}); assert.equal(calls.length, 3);
  await win.fire('blur'); assert.deepEqual(calls[3], ['auditionOff', [0, calls[2][1][2]]]);
  await hold.fire('pointerup', {pointerId: 2}); assert.equal(calls.length, 4); panel.dispose();
});

test('preview releases after one second; hiding stops manual previews while Keyboard stays usable', async t => {
  t.mock.timers.enable({apis: ['setTimeout']}); const {root, panel, calls, targets} = fixture();
  await action(root, 'play').fire('click'); t.mock.timers.tick(999); assert.equal(calls.length, 1);
  t.mock.timers.tick(1); await flush(); assert.equal(calls[1][0], 'auditionOff');
  await action(root, 'keyboard').fire('click'); const target = targets.at(-1);
  target.noteOn({id: 'one', midi: 60, velocity: 80}); await action(root, 'play').fire('click'); panel.setVisible(false); await flush();
  const count = calls.length; t.mock.timers.tick(1000); await flush(); assert.equal(calls.length, count);
  target.noteOn({id: 'two', midi: 64, velocity: 110}); target.noteOff({id: 'one'}); await flush();
  assert.equal(calls.at(-1)[0], 'auditionOff'); assert.equal(calls.at(-2)[1][3], 110);
  target.allNotesOff(); await flush(); panel.dispose();
});

test('Release, bank change, disconnection and Stop-style release retire their manual notes', async () => {
  const {root, panel, calls} = fixture(); const hold = action(root, 'hold');
  await hold.fire('keydown', {key: ' ', repeat: false}); await action(root, 'release').fire('click');
  assert.deepEqual(calls[1], ['auditionOff', [0, calls[0][1][2]]]);
  await hold.fire('pointerdown', {pointerId: 2, button: 0}); await change(root, 'voice', 0);
  assert.deepEqual(calls.slice(3).map(call => call[0]), ['auditionOff', 'selectVoice']);
  await hold.fire('pointerdown', {pointerId: 3, button: 0}); panel.setConnected(false); await flush(); assert.equal(calls.at(-1)[0], 'auditionOff');
  assert.equal(walk(root).find(node => node.tagName === 'fieldset').disabled, true); panel.dispose();
});

test('Keyboard replacement and reconnect fence stale targets and all-off callbacks', async () => {
  const {root, panel, calls, targets} = fixture(); await action(root, 'keyboard').fire('click'); const old = targets.at(-1);
  old.noteOn({id: 'same', midi: 60}); panel.setKeyboardActive(false); await flush();
  await action(root, 'keyboard').fire('click'); const current = targets.at(-1); current.noteOn({id: 'same', midi: 67});
  old.noteOff({id: 'same'}); old.allNotesOff(); old.noteOn({id: 'late', midi: 69}); await flush();
  assert.deepEqual(calls.map(call => call[0]), ['auditionOn', 'auditionOff', 'auditionOn']);
  assert.notEqual(calls[0][1][2], calls[2][1][2]); panel.setConnected(false); panel.setConnected(true);
  const count = calls.length; current.noteOn({id: 'late', midi: 72}); await flush(); assert.equal(calls.length, count); assert.equal(targets.at(-1), null); panel.dispose();
});

test('old connection errors cannot replace the current status or report an unrelated instance', async () => {
  let reject; const errors = [], {root, panel} = fixture({invoke: () => new Promise((resolve, fail) => {reject = fail;}), onError: error => errors.push(error)});
  await change(root, 'feedback', 4); panel.setConnected(false); panel.setConnected(true); reject(new Error('Old instance')); await flush();
  assert.deepEqual(errors, []); panel.dispose();
});

test('an old clipboard completion cannot replace a new instance status', async () => {
  const {root, panel, win} = fixture(); let resolve;
  win.navigator = {clipboard: {writeText: () => new Promise(done => {resolve = done;})}};
  const copying = action(root, 'copy').fire('click'); panel.setConnected(false); panel.setConnected(true);
  const status = walk(root).find(node => node.className === 'chip-editor-status'); status.textContent = 'New instance';
  resolve(); await copying; assert.equal(status.textContent, 'New instance'); panel.dispose();
});

test('voice JavaScript copies the complete applied patch, never the reserved future patch', () => {
  const state = snapshot(); state.logical.preset = {...state.preset, name: 'FUTURE'};
  const code = dx7VoiceCode(state); assert.match(code, /await dx7\.setPreset/); assert.match(code, /"name": "SECOND"/); assert.doesNotMatch(code, /FUTURE/);
  const text = code.slice(code.indexOf('(') + 1, code.lastIndexOf(');\n//'));
  assert.deepEqual(voiceToPreset(presetToVoice(JSON.parse(text))), state.preset);
});

test('disposal removes every DOM/window handler and cancels preview timers', async t => {
  t.mock.timers.enable({apis: ['setTimeout']}); const {root, panel, calls, win, doc} = fixture(); await action(root, 'play').fire('click'); panel.dispose(); panel.dispose();
  const count = calls.length; t.mock.timers.tick(1000); await flush(); assert.equal(calls.length, count);
  for (const node of [...walk(root), win, doc]) assert.equal([...node.listeners.values()].reduce((sum, list) => sum + list.size, 0), 0);
});

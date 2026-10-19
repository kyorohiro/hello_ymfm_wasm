import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createPlaygroundNesVoicePanel} from './playground_nes_voice_panel.js';

class Element {
  constructor(doc, tag) {this.ownerDocument = doc; this.tagName = tag.toUpperCase(); this.children = []; this.dataset = {}; this.listeners = {}; this.attributes = {}; this.value = ''; this.checked = false; this.textContent = '';}
  appendChild(node) {this.children.push(node); node.parentNode = this; return node;}
  append(...nodes) {nodes.forEach(node => this.appendChild(node));}
  setAttribute(name, value) {this.attributes[name] = value;}
  addEventListener(name, fn) {(this.listeners[name] ??= []).push(fn);}
  setCustomValidity(value) {this.validityMessage = value;}
  reportValidity() {}
  getContext() {return null;}
  getBoundingClientRect() {return {left: 0, top: 0, width: 640, height: 160};}
  setPointerCapture() {}
  async fire(name, args = {}) {for (const fn of this.listeners[name] ?? []) fn({target: this, preventDefault() {}, ...args}); await flush();}
}
const flush = () => new Promise(resolve => setImmediate(resolve));
const walk = node => [node, ...node.children.flatMap(walk)];
const find = (root, key, value) => walk(root).find(node => node.dataset[key] === value);
const control = (root, name) => find(root, 'nesControl', name);
function events() {const listeners = new Map(); return {addEventListener(name, fn) {if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn);}, removeEventListener(name, fn) {listeners.get(name)?.delete(fn);}, fire(name) {for (const fn of listeners.get(name) ?? []) fn();}, count(name) {return listeners.get(name)?.size ?? 0;}};}
function snapshot() {
  const registers = Array(144).fill(0); registers[0] = 0xb8; registers[3] = 0x2a; registers[0xc] = 0x38;
  return {kind: 'nes', clock: 1789773, fdsEnabled: true, registers,
    channels: [0, 1].map(channel => ({channel, type: 'pulse', enabled: true, active: channel === 0, frequency: 440, period: 253, duty: 0.5, volume: 8, constantVolume: true, lengthIndex: 5, envelope: {period: 8, loop: true}, sweep: {enabled: false, period: 2, shift: 3, negate: false}})).concat([
      {channel: 2, type: 'triangle', enabled: false, frequency: 220, period: 253, linearReload: 127, lengthHalt: true, lengthIndex: 1},
      {channel: 3, type: 'noise', enabled: false, period: 6, volume: 8, constantVolume: true, envelope: {period: 8, loop: true}, shortMode: false, lengthIndex: 1},
      {channel: 4, type: 'dmc', enabled: false}, {channel: 5, type: 'fds', active: false, frequency: 440, period: 1031},
    ]), dmc: {rate: 15, loop: false, level: 64, address: 0xc000, length: 17, loaded: false},
    fds: {wave: Array.from({length: 64}, (_, i) => i), gain: 32, master: 0, frequency: 440, modulation: {table: Array(32).fill(0), rate: 30, depth: 4, bias: 0, enabled: false}},
  };
}
function fixture() {
  const win = events(), doc = {...events(), defaultView: win, activeElement: null, hidden: false}; doc.createElement = tag => new Element(doc, tag);
  const root = new Element(doc, 'div'), calls = [], targets = [], errors = [];
  const panel = createPlaygroundNesVoicePanel({root, invoke: async (method, args) => {calls.push([method, args]);}, onKeyboardTargetChange: target => targets.push(target), onError: error => errors.push(error)});
  panel.setConnected(true); panel.setVisible(true); panel.update(snapshot());
  return {root, doc, win, calls, targets, errors, panel};
}

test('NES renders pulse, triangle, noise, DMC and FDS applied settings without writing audio', async () => {
  const {root, panel, calls} = fixture();
  assert.equal(control(root, 'pulse-0-frequency').value, '440'); assert.equal(control(root, 'pulse-0-duty').value, '0.5');
  assert.equal(control(root, 'triangle-linear').value, '127'); assert.equal(control(root, 'noise-period').value, '6');
  assert.equal(control(root, 'dmc-level').value, '64'); assert.equal(control(root, 'fds-mod-table').value.split(' ').length, 32);
  assert.ok(walk(root).some(node => node.textContent.includes('A4'))); assert.deepEqual(calls, []); panel.dispose();
});

test('NES polling preserves the focused number edit and unapplied modulation table after blur', async () => {
  const {root, doc, panel, calls} = fixture();
  const frequency = control(root, 'pulse-0-frequency'); doc.activeElement = frequency; frequency.value = '123.456'; panel.update(snapshot()); assert.equal(frequency.value, '123.456');
  await frequency.fire('change'); assert.deepEqual(calls, [['setFrequency', [0, 123.456]]]);
  const table = control(root, 'fds-mod-table'); table.value = Array(32).fill(1).join(' '); await table.fire('input'); doc.activeElement = null; panel.update(snapshot()); assert.equal(table.value, Array(32).fill(1).join(' '));
  panel.dispose();
});

test('pulse and noise edits send partial voice patches without rebuilding from a stale snapshot', async () => {
  const {root, panel, calls} = fixture();
  const duty = control(root, 'pulse-0-duty'); duty.value = '0.25'; await duty.fire('change');
  const loop = control(root, 'pulse-0-loop'); loop.checked = false; await loop.fire('change');
  const length = control(root, 'pulse-0-length'); length.value = '12'; await length.fire('change');
  const sweep = control(root, 'pulse-0-sweep-negate'); sweep.checked = true; await sweep.fire('change');
  const short = control(root, 'noise-short'); short.checked = true; await short.fire('change');
  assert.deepEqual(calls, [
    ['setPulseVoice', [0, {duty: 0.25}]], ['setPulseVoice', [0, {lengthHalt: false}]], ['setPulseVoice', [0, {lengthIndex: 12}]],
    ['setPulseVoice', [0, {sweep: {negate: true}}]], ['setNoiseVoice', [{shortMode: true}]],
  ]); panel.dispose();
});

test('Hold audition has one press ID and pointer cancellation releases exactly that voice', async () => {
  const {root, panel, calls} = fixture(); const play = find(root, 'nesAction', 'audition');
  control(root, 'audition-midi').value = '0';
  await play.fire('pointerdown', {pointerId: 12, button: 0}); await play.fire('pointerdown', {pointerId: 13, button: 0}); await play.fire('pointerup', {pointerId: 13}); assert.equal(calls.length, 1); await play.fire('pointercancel', {pointerId: 12});
  assert.equal(calls.length, 2); assert.equal(calls[0][0], 'auditionOn'); assert.equal(calls[0][1][1], 0);
  assert.deepEqual(calls[1], ['auditionOff', [0, calls[0][1][2]]]); assert.equal(play.attributes['aria-pressed'], 'false'); panel.dispose();
});

test('Keyboard binding survives hiding the panel, keeps press identity and retires on Run takeover', async () => {
  const {root, panel, calls, targets} = fixture(); await find(root, 'nesAction', 'keyboard').fire('click'); const target = targets.at(-1);
  await target.noteOn({id: 'guitar-a', midi: 60}); panel.setVisible(false); await target.noteOn({id: 'guitar-b', midi: 64}); await target.noteOff({id: 'guitar-a'});
  assert.deepEqual(calls, [['auditionOn', [0, 60, 'guitar-a']], ['auditionOn', [0, 64, 'guitar-b']], ['auditionOff', [0, 'guitar-a']]]);
  panel.setKeyboardActive(false); await flush(); await target.noteOn({id: 'late', midi: 72});
  assert.deepEqual(calls.at(-1), ['auditionOff', [0, 'guitar-b']]); assert.equal(targets.length, 1); assert.equal(find(root, 'nesAction', 'keyboard').attributes['aria-pressed'], 'false'); panel.dispose();
});

test('changing channel releases old IDs and an old Keyboard target cannot start on the new channel', async () => {
  const {root, panel, calls, targets} = fixture(); await find(root, 'nesAction', 'keyboard').fire('click'); const oldTarget = targets.at(-1);
  await oldTarget.noteOn({id: 'old', midi: 60}); await find(root, 'nesChannel', '5').fire('click'); const target = targets.at(-1);
  await oldTarget.noteOn({id: 'late', midi: 72}); await target.noteOn({id: 'fds', midi: 67}); await oldTarget.noteOff({id: 'old'});
  assert.deepEqual(calls, [['auditionOn', [0, 60, 'old']], ['auditionOff', [0, 'old']], ['auditionOn', [5, 67, 'fds']]]);
  assert.equal(target.name, 'NES / FDS · FDS'); panel.dispose();
});

test('blur, hidden document and disconnect silence held notes and dispose removes listeners', async () => {
  const {root, doc, win, panel, calls, targets} = fixture(); await find(root, 'nesAction', 'keyboard').fire('click'); const target = targets.at(-1);
  await target.noteOn({id: 'one', midi: 60}); win.fire('blur'); await flush(); await target.noteOn({id: 'two', midi: 61}); doc.hidden = true; doc.fire('visibilitychange'); await flush();
  await target.noteOn({id: 'three', midi: 62}); panel.setConnected(false); await flush(); await target.noteOn({id: 'late', midi: 63});
  assert.deepEqual(calls.filter(([method]) => method === 'auditionOff').map(([, args]) => args[1]), ['one', 'two', 'three']); assert.equal(targets.at(-1), null);
  panel.dispose(); assert.equal(win.count('blur'), 0); assert.equal(doc.count('visibilitychange'), 0);
});

test('FDS drawing commits one full 64-point wave on pointerup; cancelled strokes never write', async () => {
  const {root, panel, calls} = fixture(); await find(root, 'nesChannel', '5').fire('click'); const canvas = walk(root).find(node => node.tagName === 'CANVAS');
  await canvas.fire('pointerdown', {pointerId: 1, button: 0, clientX: 0, clientY: 160}); await canvas.fire('pointermove', {clientX: 630, clientY: 0}); assert.deepEqual(calls, []);
  await canvas.fire('pointerup', {clientX: 630, clientY: 0}); assert.equal(calls.length, 1); assert.equal(calls[0][0], 'setFdsWave'); assert.equal(calls[0][1][0].length, 64); assert.equal(calls[0][1][0][0], 0); assert.equal(calls[0][1][0][63], 63);
  await canvas.fire('pointerdown', {pointerId: 2, button: 0, clientX: 10, clientY: 50}); await canvas.fire('pointercancel'); assert.equal(calls.length, 1); panel.dispose();
});

test('DMC clearly reports missing memory and FDS availability follows the connected chip', async () => {
  const {root, panel, calls} = fixture(); await find(root, 'nesChannel', '4').fire('click');
  assert.equal(find(root, 'nesAction', 'audition').disabled, true); assert.ok(walk(root).some(node => node.textContent.startsWith('No DPCM memory loaded.')));
  const next = snapshot(); next.dmc.loaded = true; panel.update(next); assert.equal(find(root, 'nesAction', 'audition').disabled, false);
  next.fdsEnabled = false; panel.update(next); assert.equal(find(root, 'nesChannel', '5').disabled, true); await find(root, 'nesChannel', '5').fire('click'); assert.equal(find(root, 'nesChannel', '4').attributes['aria-pressed'], 'true'); assert.deepEqual(calls, []); panel.dispose();
});

test('modulation tables validate before sending and unavailable channels cannot start audition', async () => {
  const {root, panel, calls, errors} = fixture(); const table = control(root, 'fds-mod-table'); table.value = '0 1 2'; await find(root, 'nesAction', 'apply-modulation').fire('click'); assert.equal(errors.length, 1); assert.deepEqual(calls, []);
  table.value = Array(32).fill(7).join(','); await find(root, 'nesAction', 'apply-modulation').fire('click'); assert.deepEqual(calls, [['setFdsModulation', [{table: Array(32).fill(7)}]]]);
  panel.setConnected(false); await find(root, 'nesAction', 'audition').fire('pointerdown', {button: 0}); assert.equal(calls.length, 1); panel.dispose();
});

test('rapid independent sweep and FDS volume edits never resend values from the last readback', async () => {
  const {root, panel, calls} = fixture();
  const shift = control(root, 'pulse-0-sweep-shift'); shift.value = '5'; await shift.fire('change');
  const period = control(root, 'pulse-0-sweep-period'); period.value = '6'; await period.fire('change');
  const gain = control(root, 'fds-gain'); gain.value = '21'; await gain.fire('change');
  const master = control(root, 'fds-master'); master.value = '2'; await master.fire('change');
  assert.deepEqual(calls, [['setPulseVoice', [0, {sweep: {shift: 5}}]], ['setPulseVoice', [0, {sweep: {period: 6}}]], ['setFdsVolume', [{gain: 21}]], ['setFdsVolume', [{master: 2}]]]); panel.dispose();
});

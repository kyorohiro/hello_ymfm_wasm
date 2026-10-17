import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createPlaygroundChipTabs, frequencyNote, rfSamplePosition, pwmRoutingControl} from './playground_chip_tabs.js';

// Small DOM substitute for lifecycle tests. Rendering and input focus also receive browser coverage.
class Element {
  constructor(doc, tag) { this.ownerDocument = doc; this.tagName = tag; this.children = []; this.dataset = {}; this.listeners = {}; this.attributes = {}; this.value = ''; this.textContent = ''; this.classList = {add() {}}; }
  appendChild(node) { this.children.push(node); node.parentNode = this; return node; }
  append(...nodes) { nodes.forEach(node => this.appendChild(node)); }
  replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
  setAttribute(key, value) { this.attributes[key] = value; }
  addEventListener(name, callback) { (this.listeners[name] ??= []).push(callback); }
  async fire(name, extra = {}) { await Promise.all((this.listeners[name] ?? []).map(fn => fn({target: this, ...extra}))); await flush(); }
  setCustomValidity(value) { this.validityMessage = value; }
  reportValidity() {}
  getContext() { return null; }
}
const flush = () => new Promise(resolve => setImmediate(resolve));
const walk = node => [node, ...node.children.flatMap(walk)];
const control = (root, name) => walk(root).find(node => node.dataset.chipControl === name);
function fixture(inspector, options = {}) {
  const listeners = new Map();
  const doc = {activeElement: null, hidden: false, createElement: tag => new Element(doc, tag),
    addEventListener(name, callback) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(callback); },
    removeEventListener(name, callback) { listeners.get(name)?.delete(callback); },
    fire(name) { for (const callback of listeners.get(name) ?? []) callback(); },
    listenerCount(name) { return listeners.get(name)?.size ?? 0; },
  };
  const roots = Object.fromEntries(['segapsg', 'rf5c164', 'pwm'].map(kind => [kind, new Element(doc, 'div')]));
  const tabs = createPlaygroundChipTabs({roots, getInspector: () => inspector, pollMs: 100000, ...options});
  return {doc, roots, tabs};
}
const psgState = frequency => ({kind: 'segapsg', clock: 3579545, channels: [0, 1, 2].map(channel => ({channel, frequency, period: 254, attenuation: 4, active: true})), noise: {type: 'white', rate: 'tone3', attenuation: 7, active: true}});

test('pitch labels include standard A4 and negative octaves', () => {
  assert.equal(frequencyNote(440), 'A4'); assert.equal(frequencyNote(261.625565), 'C4');
  assert.equal(frequencyNote(8.175799), 'C-1'); assert.equal(frequencyNote(0), '—'); assert.equal(frequencyNote(NaN), '—');
});

test('RF sample marker editing aligns start but preserves exact loop samples', () => {
  const sample = {valid: true, address: 512, frames: 900};
  assert.equal(rfSamplePosition(sample, 389, {start: true}), 768);
  assert.equal(rfSamplePosition(sample, 389), 901);
  assert.equal(rfSamplePosition(sample, -9), 512);
  assert.equal(rfSamplePosition(sample, 9999), 1411);
  assert.throws(() => rfSamplePosition({...sample, valid: false}, 0), /unknown/);
  assert.throws(() => rfSamplePosition(sample, Infinity), /finite/);
});

test('PWM routing preserves unrelated interrupt and routing bits', () => {
  assert.equal(pwmRoutingControl(0x0a55, 'left', 2), 0x0a56);
  assert.equal(pwmRoutingControl(0x0a55, 'right', 2), 0x0a59);
  assert.throws(() => pwmRoutingControl(0, 'middle', 1), /routing/);
  assert.throws(() => pwmRoutingControl(0, 'left', 4), /routing/);
});

test('hidden tabs never read or create chips; hiding releases lifecycle subscription', async () => {
  let reads = 0, subscriptions = 0, unsubscribed = 0;
  const inspector = {list: () => [{id: 'segapsg', kind: 'segapsg', connected: true}], read: async () => { reads++; return psgState(440); }, subscribe() { subscriptions++; return () => unsubscribed++; }};
  const {tabs} = fixture(inspector);
  await flush(); assert.equal(reads, 0); assert.equal(subscriptions, 0);
  tabs.setVisible('segapsg'); await flush(); assert.equal(reads, 1); assert.equal(subscriptions, 1);
  tabs.setVisible(null); await tabs.refresh(); assert.equal(reads, 1); assert.equal(unsubscribed, 1);
  tabs.dispose();
});

test('background document stops reads and subscriptions, rejects late state, and resumes the selected editor', async t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  let reads = 0, subscriptions = 0, unsubscribed = 0, finishFirst;
  const inspector = {list: () => [{id: 'segapsg', kind: 'segapsg'}], read: () => {
    reads++; return reads === 1 ? new Promise(resolve => {finishFirst = resolve;}) : Promise.resolve(psgState(880));
  }, subscribe() { subscriptions++; return () => unsubscribed++; }};
  const {tabs, roots, doc} = fixture(inspector, {pollMs: 10});
  tabs.setVisible('segapsg'); assert.equal(reads, 1);
  doc.hidden = true; doc.fire('visibilitychange'); assert.equal(unsubscribed, 1);
  finishFirst(psgState(220)); await flush();
  assert.equal(control(roots.segapsg, 'tone-0-note').value, '');
  t.mock.timers.tick(1000); await tabs.refresh(); await flush(); assert.equal(reads, 1);
  doc.hidden = false; doc.fire('visibilitychange'); await flush();
  assert.equal(reads, 2); assert.equal(subscriptions, 2);
  assert.equal(control(roots.segapsg, 'tone-0-note').value, 'A5');
  t.mock.timers.tick(10); await flush(); assert.equal(reads, 3);
  tabs.dispose(); assert.equal(unsubscribed, 2); assert.equal(doc.listenerCount('visibilitychange'), 0);
  doc.hidden = true; doc.fire('visibilitychange'); doc.hidden = false; doc.fire('visibilitychange');
  t.mock.timers.tick(1000); await flush(); assert.equal(reads, 3);
});

test('PSG renders applied state without resending noise and preserves focused edits', async () => {
  const calls = [];
  const inspector = {list: () => [{id: 'psg-1', kind: 'segapsg'}], read: async () => psgState(440), invoke: async (...args) => calls.push(args)};
  const {tabs, roots, doc} = fixture(inspector); tabs.setVisible('segapsg'); await flush();
  assert.equal(control(roots.segapsg, 'tone-0-note').value, 'A4'); assert.deepEqual(calls, []);
  const input = control(roots.segapsg, 'tone-0-frequency'); input.value = '123.456'; doc.activeElement = input;
  await tabs.refresh(); assert.equal(input.value, '123.456');
  doc.activeElement = null; await input.fire('change');
  assert.deepEqual(calls[0], ['psg-1', 'setFrequency', [0, 123.456]]);
  const noise = control(roots.segapsg, 'noise-rate'); noise.value = 'low'; await noise.fire('change');
  assert.deepEqual(calls[1], ['psg-1', 'setNoise', [{type: 'white', rate: 'low'}]]);
  tabs.dispose();
});

test('late snapshot after changing instance cannot overwrite selected instance', async () => {
  let resolveFirst;
  const inspector = {list: () => [{id: 'a', kind: 'segapsg'}, {id: 'b', kind: 'segapsg'}], read: id => id === 'a' ? new Promise(resolve => { resolveFirst = resolve; }) : Promise.resolve(psgState(880))};
  const {tabs, roots} = fixture(inspector); tabs.setVisible('segapsg'); await flush();
  const instance = control(roots.segapsg, 'instance'); instance.value = 'b'; await instance.fire('change');
  assert.equal(control(roots.segapsg, 'tone-0-note').value, 'A5');
  resolveFirst(psgState(220)); await flush();
  assert.equal(control(roots.segapsg, 'tone-0-note').value, 'A5'); tabs.dispose();
});

test('RF loading passes file bytes to safe backend allocator and assigns the selected channel', async () => {
  const calls = [], loads = [];
  const sample = {valid: true, name: '/tone.wav', address: 512, end: 1415, frames: 900, loopStart: 1413, step: 2048, waveform: [0, 1, -1, 0]};
  const inspector = {
    list: () => [{id: 'rf', kind: 'rf5c164'}],
    read: async () => ({kind: 'rf5c164', clock: 12500000, channels: Array.from({length: 8}, (_, channel) => ({channel, start: 512, loopStart: 1413, step: 2048, volume: 255, pan: {left: 15, right: 15}, active: false})), samples: [sample]}),
    loadSample: async (...args) => { loads.push(args); return sample; }, invoke: async (...args) => calls.push(args),
  };
  const {tabs, roots} = fixture(inspector, {listFiles: () => [{path: '/tone.wav'}, {path: '/code.js'}], readFile: async () => ({data: new Uint8Array([1, 2, 3])})});
  tabs.setVisible('rf5c164'); await flush();
  const file = control(roots.rf5c164, 'rf-file'); assert.equal(file.children.length, 1); file.value = '/tone.wav';
  await walk(roots.rf5c164).find(node => node.textContent === 'Load audio file').fire('click');
  assert.equal(loads.length, 1); assert.equal(loads[0][0], 'rf'); assert.deepEqual(loads[0][2], {name: '/tone.wav'});
  assert.deepEqual(calls[0], ['rf', 'setChannel', [0, {start: 512, loopStart: 1413, step: 2048}]]);
  const assigned = control(roots.rf5c164, 'rf-sample'); assigned.value = '512'; await assigned.fire('change');
  assert.deepEqual(calls[1], ['rf', 'setChannel', [0, {start: 512, loopStart: 1413, step: 2048}]]);
  const start = control(roots.rf5c164, 'rf-start-offset'); start.value = '389'; await start.fire('change');
  assert.deepEqual(calls[2], ['rf', 'setChannel', [0, {start: 768}]]); tabs.dispose();
});

test('RF first load into address zero initializes an unconfigured channel for audible preview', async () => {
  const calls = [];
  const sample = {valid: true, address: 0, end: 903, frames: 900, step: 2048, loopStart: 901};
  const inspector = {list: () => [{id: 'rf', kind: 'rf5c164'}], read: async () => ({kind: 'rf5c164', channels: Array.from({length: 8}, (_, channel) => ({channel, start: 0, loopStart: 0, step: 0, volume: 0, pan: {left: 0, right: 0}})), samples: [sample]}), loadSample: async () => sample, invoke: async (...args) => calls.push(args)};
  const {tabs, roots} = fixture(inspector, {listFiles: () => ['/tone.wav'], readFile: () => new Uint8Array([1])});
  tabs.setVisible('rf5c164'); await flush();
  await walk(roots.rf5c164).find(node => node.textContent === 'Load audio file').fire('click');
  assert.deepEqual(calls, [['rf', 'setChannel', [0, {start: 0, loopStart: 901, step: 2048, volume: 255, pan: {left: 15, right: 15}}]]]);
  assert.ok(walk(roots.rf5c164).some(node => node.textContent === 'Sample loaded and assigned to CH1. Press On to preview.')); tabs.dispose();
});

test('RF selection changed during loading keeps material but does not assign another channel', async () => {
  const calls = []; let finishLoad;
  const sample = {valid: true, address: 0, end: 903, frames: 900, step: 2048, loopStart: 901};
  const inspector = {list: () => [{id: 'rf', kind: 'rf5c164'}], read: async () => ({kind: 'rf5c164', channels: Array.from({length: 8}, (_, channel) => ({channel, start: 0, loopStart: 0, step: 0, volume: 0, pan: {left: 0, right: 0}})), samples: []}), loadSample: () => new Promise(resolve => {finishLoad = resolve;}), invoke: async (...args) => calls.push(args)};
  const {tabs, roots} = fixture(inspector, {listFiles: () => ['/tone.wav'], readFile: () => new Uint8Array([1])});
  tabs.setVisible('rf5c164'); await flush();
  const loadButton = walk(roots.rf5c164).find(node => node.textContent === 'Load audio file');
  const loading = loadButton.fire('click'); await flush(); await tabs.refresh(); assert.equal(loadButton.disabled, true);
  await walk(roots.rf5c164).find(node => node.dataset.chipChannel === '1').fire('click');
  await walk(roots.rf5c164).find(node => node.dataset.chipChannel === '0').fire('click');
  finishLoad(sample); await loading;
  assert.deepEqual(calls, []);
  assert.ok(walk(roots.rf5c164).some(node => node.textContent.includes('Selection changed;'))); tabs.dispose();
});

test('PWM route editing preserves clock/interrupt controls and never submits samples', async () => {
  const calls = [];
  const inspector = {list: () => [{id: 'pwm', kind: 'pwm'}], read: async () => ({kind: 'pwm', control: 0xa55, cycle: 567, clock: 23011360, sampleRate: 44100, queuedWrites: 20, currentFrame: 70, fifo: {left: {empty: true, full: false}, right: {empty: false, full: true}}, registers: [0xa55, 567, 0x4000, 0x8000, 0]}), invoke: async (...args) => calls.push(args)};
  const {tabs, roots} = fixture(inspector); tabs.setVisible('pwm'); await flush();
  const route = control(roots.pwm, 'pwm-left-route'); route.value = '2'; await route.fire('change');
  assert.deepEqual(calls, [['pwm', 'writeRegister', [0, 0xa56]]]); tabs.dispose();
});

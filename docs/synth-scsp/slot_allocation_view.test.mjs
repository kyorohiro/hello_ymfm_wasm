// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import factory from '../generated/scsp_wasm.js';
import { Scsp } from '../js/scsp.js';
import { SynthInstrument } from './instrument.js';
import { describeScspSlotAllocation, setupScspSlotAllocationView } from './slot_allocation_view.js';

let module;
async function create(t) {
  module ??= factory({ wasmBinary: await readFile(new URL('../generated/scsp_wasm.wasm', import.meta.url)) });
  const owner = new SynthInstrument(await Scsp.create({ moduleFactory: () => module }));
  t.after(() => owner.dispose());
  return owner;
}
const describe = (owner, options) => describeScspSlotAllocation(owner.read(), options);

test('Auto follows the latest allocated group even after release; physical selection follows exact current ownership', async t => {
  const owner = await create(t);
  owner.setConfig({ mode: 'fm2', fm: { algorithm: 'chain' } });
  owner.noteOn('first', 60); owner.noteOn('latest', 69); owner.noteOff('latest');
  let model = describe(owner);
  assert.equal(model.focus.groupId, 'latest');
  assert.equal(model.focus.note, 'A4');
  assert.equal(model.focus.held, false);
  assert.match(model.focus.summary, /Keyboard.*Released · retained/);
  assert.deepEqual(model.members.map(({ name, slot }) => [name, slot]), [['A', 9], ['B', 8]]);
  assert.deepEqual(model.slots.filter(value => value.related).map(value => value.slot), [8, 9]);
  assert(model.slots.slice(8, 10).every(value => value.ownership === 'group' && value.held === false));
  model = describe(owner, { selected: 6 });
  assert.equal(model.focus.groupId, 'first');
  assert.equal(model.focus.selectedOperator, 1);
  assert.deepEqual(model.slots.filter(value => value.related).map(value => value.slot), [6, 7]);
  assert.deepEqual(model.connections.map(({ fromSlot, toSlot, input, timing }) => [fromSlot, toSlot, input, timing]), [[6, 7, 'X', 'current'], [6, 7, 'Y', 'current']]);
  assert(!JSON.stringify(model).includes('envelopePhase'));
});

test('reordered Custom 4/6 maps use saved operator identities, including an old Code group under another editor preset', async t => {
  const owner = await create(t), donor = await create(t);
  owner.setConfig({ mode: 'fm4', fm: { algorithm: 'custom', custom: { inputs: [[], [0], [1], [2]], outputs: [3] } } });
  owner.noteOn('four', 67);
  let model = describe(owner);
  assert.deepEqual(model.members.map(value => value.slot), [6, 7, 8, 9]);
  assert.deepEqual(model.connections.map(value => [value.from, value.to]), [[0, 1], [0, 1], [1, 2], [1, 2], [2, 3], [2, 3]]);
  owner.setConfig({ mode: 'fm6', fm: { algorithm: 'custom', custom: { inputs: [[3, 4], [0], [], [5], [2], []], outputs: [0, 1, 4] } } });
  const { session } = owner.beginCode(); owner.code(session, 'noteOn', [4, 64]);
  const before = owner.read().voiceGroups[0];
  donor.setConfig({ mode: 'fm2', fm: { algorithm: 'chain' } }); owner.loadPatch(donor.exportPatch());
  model = describe(owner, { operator: 5 });
  assert.deepEqual(model.members.map(value => value.slot), [10, 11, 8, 7, 9, 6]);
  assert.equal(model.focus.mode, 'fm6');
  assert.equal(model.focus.algorithm, 'custom');
  assert.deepEqual(model.focus.owner, { kind: 'code', channel: 4, session });
  assert.match(model.focus.summary, /Code CH5.*E4/);
  assert(!model.focus.summary.includes('session'));
  assert.deepEqual(owner.read().voiceGroups[0], before);
  assert.equal(model.operator, 5);
});

test('Self preserves two history taps and Cycle distinguishes A current to B from B history into A at depth zero', async t => {
  const owner = await create(t);
  owner.setConfig({ mode: 'fm2', fm: { algorithm: 'custom', custom: { inputs: [[0], []], outputs: [0] } } });
  owner.noteOn('self', 69);
  let model = describe(owner);
  assert.deepEqual(model.members[0].references.map(({ input, offset, sourceOperator, timing }) => [input, offset, sourceOperator, timing]), [['X', 32, 0, 'history 1'], ['Y', 0, 0, 'history 2']]);
  assert.equal(model.connections.length, 2);
  owner.setConfig({ mode: 'fm2', fm: { algorithm: 'cycle2', cycle2: { outputs: [1] }, depths: [0, 7, 0, 0, 0, 0] } });
  owner.noteOn('cycle', 69);
  model = describe(owner);
  assert.deepEqual(model.members.map(value => value.slot), [6, 7]);
  assert.deepEqual(model.connections.map(({ from, to, timing, enabled }) => [from, to, timing, enabled]), [[1, 0, 'history average', false], [1, 0, 'history average', false], [0, 1, 'current', true], [0, 1, 'current', true]]);
  assert.deepEqual(model.members[0].references.map(value => value.offset), [33, 1]);
  assert.deepEqual(model.members[1].references.map(value => value.offset), [63, 63]);
  assert.deepEqual(model.members.map(value => value.direct.level), [0, 7]);
});

test('physical modulation overrides keep group identities and show ordered raw references without false arrows', async t => {
  const owner = await create(t);
  owner.setConfig({ mode: 'fm2', fm: { algorithm: 'chain' } }); owner.noteOn('group', 69);
  owner.invokePhysical('setModulation', [7, { xOffset: 18, yOffset: 18, depth: 0 }]);
  let model = describe(owner, { selected: 7 });
  assert.equal(model.focus.groupId, 'group');
  assert.deepEqual(model.members.map(value => value.slot), [7, 6]);
  assert.equal(model.connections.length, 0);
  assert.deepEqual(model.members[0].references.map(value => [value.input, value.offset, value.sourceOperator]), [['X', 18, null], ['Y', 18, null]]);
  assert.equal(model.members[0].modulation.depth, 0);
  owner.invokePhysical('setModulation', [7, { xOffset: 63, yOffset: 63, depth: 9 }]);
  owner.invokePhysical('setModulation', [6, { writeInhibit: true }]);
  model = describe(owner);
  assert.equal(model.connections.length, 0, 'A changed producer must not be presented as a current-sample edge');
});

test('stealing, manual replacement and Code Stop remove former highlights despite stale Code lanes', async t => {
  const owner = await create(t);
  owner.setConfig({ mode: 'fm6', fm: { algorithm: 'chain' } });
  const { session } = owner.beginCode(); owner.code(session, 'noteOn', [0, 69]);
  for (let index = 0; index < 4; index++) owner.noteOn(`key${index}`, 60 + index);
  let state = owner.read(), model = describeScspSlotAllocation(state, { selected: 6 });
  assert.equal(model.focus.groupId, 'key3');
  assert(!model.slots.some(value => value.groupId === `code:${session}:0`));
  state.codeLanes[0] = { channel: 0, groupId: `code:${session}:0`, slots: [6, 7, 8, 9, 10, 11], midi: 69 };
  model = describeScspSlotAllocation(state, { selected: 6 });
  assert.equal(model.focus.groupId, 'key3', 'Code lane caches never grant physical ownership');
  owner.physicalNoteOn('physical', 8, 72); owner.physicalNoteOff('physical');
  model = describe(owner, { selected: 8 });
  assert.equal(model.focus.kind, 'manual');
  assert.equal(model.focus.held, false);
  assert.equal(model.focus.note, 'C5');
  assert.deepEqual(model.slots.filter(value => value.related).map(value => value.slot), [8]);
  assert.equal(describe(owner, { selected: 6 }).focus.kind, 'unowned');
  owner.code(session, 'noteOn', [1, 69]); owner.endCode(session);
  model = describe(owner, { selected: 6 });
  assert.equal(model.focus.kind, 'unowned');
  assert.equal(model.connections.length, 0);
});

test('physical Direct uses current settings and requested MIXS labels expose suppression and output policy', async t => {
  const owner = await create(t);
  owner.setConfig({ mode: 'fm2', fm: { algorithm: 'chain' } }); owner.setEffect({ enabled: true });
  const { session } = owner.beginCode(); owner.code(session, 'noteOn', [0, 69]);
  owner.invokePhysical('setMix', [7, { directLevel: 2, pan: 19 }]);
  let model = describe(owner), carrier = model.members[0], modulator = model.members[1];
  assert.deepEqual(carrier.direct, { level: 2, pan: 19 });
  assert.equal(carrier.dsp.policy, 'output default');
  assert.equal(modulator.dsp.policy, 'no default send');
  assert.equal(modulator.dsp.level, 7, 'Requested slot defaults are not claims of an actual send');
  owner.setDspSourceSend(1, { input: 1, level: 4 });
  model = describe(owner); modulator = model.members[1];
  assert.deepEqual([modulator.dsp.input, modulator.dsp.level, modulator.dsp.policy], [1, 4, 'explicit request']);
  owner.setDspSend(6, { input: 1, level: 3 }); owner.endCode(session);
  model = describe(owner, { selected: 6 });
  assert.deepEqual([model.members[0].dsp.input, model.members[0].dsp.level, model.members[0].dsp.policy], [1, 3, 'unowned · suppressed']);
  owner.physicalNoteOn('manual', 6, 60); owner.setEffect({ enabled: false });
  assert.equal(describe(owner, { selected: 6 }).members[0].dsp.policy, 'effect disabled');
});

test('models are detached and frozen; missing and conflicting records remain explicit', async t => {
  const owner = await create(t); owner.noteOn('group', 69);
  const state = owner.read(), before = structuredClone(state), model = describeScspSlotAllocation(state);
  assert.deepEqual(state, before);
  assert(Object.isFrozen(model) && Object.isFrozen(model.focus.owner) && Object.isFrozen(model.members[0].references));
  state.voiceGroups[0].owner.kind = 'changed'; state.slots[6].directLevel = 1;
  assert.equal(model.focus.owner.kind, 'keyboard'); assert.equal(model.members[0].direct.level, 7);
  const missing = describeScspSlotAllocation();
  assert.equal(missing.slots.length, 32); assert.equal(missing.focus.kind, 'unavailable'); assert(!missing.available);
  assert(missing.slots.every(value => value.ownership === 'unknown'));
  assert.equal(describeScspSlotAllocation({ slots: Array.from({ length: 32 }, () => ({})) }).focus.kind, 'source');
  for (const selected of [-1, 32, 1.5, '1']) assert(!describeScspSlotAllocation(before, { selected }).available);
  const broken = structuredClone(before); broken.voiceGroups[0].operatorSlots = [31];
  assert.equal(describeScspSlotAllocation(broken, { selected: 6 }).slots[6].ownership, 'unknown');
  const conflict = structuredClone(before); conflict.manualVoices.push({ slot: 6, held: true });
  assert.equal(describeScspSlotAllocation(conflict, { selected: 6 }).focus.kind, 'unavailable');
  owner.setConfig({ mode: 'fm2', fm: { algorithm: 'chain' } }); owner.noteOn('pair', 69);
  const overlappingMember = owner.read(); overlappingMember.manualVoices.push({ slot: 6, held: true });
  const incomplete = describeScspSlotAllocation(overlappingMember, { selected: 7 });
  assert.equal(incomplete.focus.kind, 'unavailable');
  assert.deepEqual(incomplete.slots.filter(value => value.related).map(value => value.slot), [7]);
  assert.equal(incomplete.connections.length, 0);
  assert(!incomplete.members[0].matchesRecipe);
  assert.match(incomplete.focus.summary, /group ownership incomplete/);
  const source = describeScspSlotAllocation(before, { selected: 0 });
  assert.equal(source.focus.kind, 'source'); assert.equal(source.slots[0].related, true);
  owner.physicalNoteOn('source-key', 0, 60);
  const manualSource = describe(owner, { selected: 0 });
  assert.equal(manualSource.focus.kind, 'manual'); assert.equal(manualSource.slots[0].role, 'source');
  assert.match(manualSource.focus.summary, /Source A/);
});

class Node extends EventTarget {
  constructor(doc, tag) { super(); this.ownerDocument = doc; this.tagName = tag.toUpperCase(); this.children = []; this.dataset = {}; this.attributes = new Map(); this.content = ''; this.open = false; this.hidden = false; this.disabled = false; this.blurCalls = 0; }
  set textContent(value) { this.content = value; this.children = []; this.ownerDocument.writes++; }
  get textContent() { return this.content + this.children.map(value => value.textContent).join(''); }
  append(...children) { children.forEach(child => { child.parentElement = this; }); this.children.push(...children); this.ownerDocument.writes++; }
  replaceChildren(...children) { this.content = ''; this.children = []; this.append(...children); }
  setAttribute(name, value) { this.attributes.set(name, value); this.ownerDocument.writes++; }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  closest(selector) { assert.equal(selector, '[hidden]'); return this.hidden ? this : this.parentElement?.closest(selector) ?? null; }
  focus() { this.ownerDocument.focusCalls++; this.ownerDocument.focused = this; }
  blur() { this.blurCalls++; if (this.ownerDocument.focused === this) { this.ownerDocument.focused = null; this.dispatchEvent(new Event('blur')); } }
  fire(type, properties = {}) { const event = new Event(type, { cancelable: true }); Object.assign(event, properties); this.dispatchEvent(event); return event; }
}
function fixture(options = {}) {
  const doc = { writes: 0, focusCalls: 0, focused: null, createElement: tag => new Node(doc, tag) };
  Object.defineProperty(doc, 'activeElement', { get() { throw Error('Passive view cannot inspect focus'); } });
  const root = new Node(doc, 'section'), walk = node => [node, ...node.children.flatMap(walk)], all = () => walk(root);
  return { doc, root, all, find: id => all().find(value => value.id === id), view: setupScspSlotAllocationView({ root, ...options }) };
}

test('passive DOM keeps all nodes, open help and focus while selection, release, routes and availability change', async t => {
  const owner = await create(t), { root, doc, all, find, view } = fixture();
  owner.setConfig({ mode: 'fm2', fm: { algorithm: 'cycle2' } }); owner.noteOn('cycle', 69);
  view.update(owner.read());
  assert.equal(root.dataset.kind, 'group'); assert.equal(root.dataset.groupId, 'cycle');
  assert.equal(find('scspSynthAllocationMapping').textContent, 'A → CH7 · B → CH8');
  assert.match(find('scspSynthAllocationConnections').children[0].textContent, /B \(CH8\) → A \(CH7\).*history average.*X\+Y/);
  assert.match(find('scspSynthAllocationConnections').children[1].textContent, /A \(CH7\) → B \(CH8\).*current.*X\+Y/);
  assert.equal(find('scspSynthAllocationOpA').dataset.slot, '6');
  assert.equal(find('scspSynthAllocationOpC').hidden, true);
  const nodes = all(), help = find('scspSynthAllocationHelp'); help.open = true;
  const writes = doc.writes; view.update(owner.read()); assert.equal(doc.writes, writes, 'Identical polling writes no text');
  owner.noteOff('cycle'); view.update(owner.read(), { selected: 7, operator: 3 });
  assert.equal(find('scspSynthAllocationBadge').textContent, 'Released · retained');
  assert.equal(find('scspSynthAllocationOpB').dataset.selected, 'true');
  owner.invokePhysical('setModulation', [6, { xOffset: 9 }]); view.update(owner.read(), { selected: 6 });
  assert.match(find('scspSynthAllocationOpA').children[1].textContent, /Requested X 9 \/ Y 1/);
  view.update(undefined); assert.equal(root.dataset.kind, 'unavailable');
  assert.deepEqual(all(), nodes); assert(help.open);
  assert(!all().some(value => ['INPUT', 'SELECT', 'TEXTAREA', 'METER', 'PROGRESS'].includes(value.tagName)));
  const buttons = all().filter(value => value.tagName === 'BUTTON');
  assert.equal(buttons.length, 6);
  assert(buttons.every((button, index) => button.id === `scspSynthAllocationEdit${'ABCDEF'[index]}` && button.getAttribute('type') === 'button' && button.disabled));
  assert.equal(buttons[0].getAttribute('aria-label'), 'Edit physical CH7 (operator A)');
  assert.match(help.children[1].textContent, /not native envelope phases.*retained slots are not free/);
  assert.match(help.children[1].textContent, /two distinct history taps.*Depth 0.*never identify.*Requested MIXS routes can be suppressed/);
  view.dispose(); const disposedWrites = doc.writes; view.update(owner.read()); assert.equal(doc.writes, disposedWrites);
  setupScspSlotAllocationView().update(owner.read());
});

const slotRegisters = owner => Array.from({ length: 32 * 16 }, (_, word) => owner.core.read(word * 2));
const pointerDown = (button, pointerType = 'mouse') => button.fire('pointerdown', { button: 0, pointerType });
const pointerClick = (button, pointerType = 'mouse') => button.fire('click', { detail: 1, pointerType });
const nativeKeyDown = (button, key, repeat = false) => button.fire('keydown', { key, repeat });
const nativeKeyUp = (button, key) => button.fire('keyup', { key });

test('native member buttons synchronously select the saved physical Custom Code mapping without musical writes', async t => {
  const owner = await create(t), donor = await create(t), calls = [];
  owner.setConfig({ mode: 'fm6', fm: { algorithm: 'custom', custom: { inputs: [[3, 4], [0], [], [5], [2], []], outputs: [0, 1, 4] } } });
  const { session } = owner.beginCode(); owner.code(session, 'noteOn', [4, 64]);
  donor.setConfig({ mode: 'fm2', fm: { algorithm: 'chain' } }); owner.loadPatch(donor.exportPatch());
  const before = owner.read(), registers = slotRegisters(owner);
  const { view, all, doc, find } = fixture({ onSelectSlot: slot => calls.push(slot) }); t.after(() => view.dispose());
  view.update(before, { operator: 5 });
  const nodes = all(), expected = [10, 11, 8, 7, 9, 6];
  for (const [index, slot] of expected.entries()) {
    const name = 'ABCDEF'[index], button = find(`scspSynthAllocationEdit${name}`), card = find(`scspSynthAllocationOp${name}`);
    assert.equal(button.tagName, 'BUTTON'); assert.equal(button.getAttribute('type'), 'button');
    assert.equal(button.textContent, `CH${slot + 1}`); assert.equal(button.dataset.allocationSlot, String(slot));
    assert.equal(button.getAttribute('aria-label'), `Edit physical CH${slot + 1} (operator ${name})`);
    assert.equal(card.dataset.operator, name); assert.equal(card.children[0].textContent, `${name} → CH${slot + 1}`);
    assert(!button.disabled); assert(!Object.hasOwn(button.dataset, 'operator'));
  }
  const a = find('scspSynthAllocationEditA'), b = find('scspSynthAllocationEditB'), c = find('scspSynthAllocationEditC');
  a.focus(); pointerDown(a); pointerClick(a);
  assert.deepEqual(calls, [10], 'selection callback runs in the native click turn');
  assert.equal(doc.focused, null); assert.equal(a.blurCalls, 1);
  b.fire('click', { detail: 0 }); // Accessibility/native click need not have pointerdown.
  pointerClick(c); // Click-only callers also resolve the current valid target.
  assert.deepEqual(calls, [10, 11, 8]); assert.equal(b.blurCalls, 0); assert.equal(c.blurCalls, 1);
  view.update(owner.read(), { operator: 5 });
  assert.deepEqual(all(), nodes); assert.deepEqual(owner.read(), before); assert.deepEqual(slotRegisters(owner), registers);
  assert.equal(owner.read().codeActive, true); assert.equal(owner.read().codeSession, session);
});

test('Enter and Space use native click activation, preserve keyboard focus, and tolerate release and value polling', async t => {
  const owner = await create(t), calls = [];
  owner.setConfig({ mode: 'fm2', fm: { algorithm: 'cycle2' } }); owner.noteOn('cycle', 69);
  const { view, doc, find, all } = fixture({ onSelectSlot: slot => calls.push(slot) }); t.after(() => view.dispose());
  view.update(owner.read());
  const a = find('scspSynthAllocationEditA'), b = find('scspSynthAllocationEditB'), nodes = all();
  a.focus(); const enter = nativeKeyDown(a, 'Enter');
  assert(!enter.defaultPrevented); assert.deepEqual(calls, [], 'keydown delegates activation to the native button');
  owner.noteOff('cycle'); view.update(owner.read());
  a.fire('click', { detail: 0 }); nativeKeyUp(a, 'Enter');
  assert.deepEqual(calls, [6]); assert.equal(doc.focused, a); assert.equal(a.blurCalls, 0);
  b.focus(); const space = nativeKeyDown(b, ' ');
  owner.invokePhysical('setMix', [7, { directLevel: 3, pan: 11 }]); view.update(owner.read());
  assert(!space.defaultPrevented); assert.deepEqual(calls, [6]);
  nativeKeyUp(b, ' '); b.fire('click', { detail: 0 });
  assert.deepEqual(calls, [6, 7]); assert.equal(doc.focused, b); assert.equal(b.blurCalls, 0);
  const writes = doc.writes, focusCalls = doc.focusCalls; view.update(owner.read());
  assert.equal(doc.writes, writes); assert.equal(doc.focusCalls, focusCalls); assert.equal(doc.focused, b); assert.deepEqual(all(), nodes);
  nativeKeyDown(b, 'Enter'); view.update(owner.read(), { operator: 1 });
  nativeKeyDown(b, 'Enter', true); b.fire('click', { detail: 0 }); nativeKeyUp(b, 'Enter');
  assert.deepEqual(calls, [6, 7, 7], 'source-operator polling does not change the physical CH address');
  nativeKeyDown(b, 'Enter'); b.fire('click', { detail: 0 }); nativeKeyUp(b, 'Enter');
  assert.deepEqual(calls, [6, 7, 7, 7]); assert.equal(doc.focused, b);
});

test('held pointer and Space reject changed targets even if an earlier mapping returns before click', async t => {
  const owner = await create(t), calls = [];
  owner.setConfig({ mode: 'fm2', fm: { algorithm: 'chain' } }); owner.noteOn('first', 60);
  const first = owner.read(), { view, find } = fixture({ onSelectSlot: slot => calls.push(slot) }); t.after(() => view.dispose());
  view.update(first); const a = find('scspSynthAllocationEditA'); pointerDown(a);
  owner.noteOn('second', 64); const second = owner.read(); view.update(second); pointerClick(a);
  assert.deepEqual(calls, [], 'a new Auto allocation cannot redirect an in-flight click');
  pointerDown(a); pointerClick(a); assert.deepEqual(calls, [9]);
  pointerDown(a); view.update(first); view.update(second); pointerClick(a);
  assert.deepEqual(calls, [9], 'a target changing back does not revive the old gesture');
  nativeKeyDown(a, ' '); view.update(first); nativeKeyUp(a, ' '); a.fire('click', { detail: 0 });
  assert.deepEqual(calls, [9]);
  nativeKeyDown(a, ' '); nativeKeyUp(a, ' '); a.fire('click', { detail: 0 });
  assert.deepEqual(calls, [9, 7]);
  pointerDown(a); const sameSlotNewOwner = structuredClone(first); sameSlotNewOwner.voiceGroups[0].id = 'replacement';
  view.update(sameSlotNewOwner); pointerClick(a); assert.deepEqual(calls, [9, 7, 7], 'ownership replacement preserves navigation to the unchanged physical slot');
});

test('cancellation, blur, hidden ancestors, disabled contexts and disposal guard navigation', async t => {
  const owner = await create(t), calls = [], { view, doc, root, find } = fixture({ onSelectSlot: slot => calls.push(slot) });
  owner.noteOn('voice', 60); view.update(owner.read()); const a = find('scspSynthAllocationEditA');
  pointerDown(a, 'touch'); a.fire('pointercancel'); pointerClick(a, 'touch'); assert.deepEqual(calls, []);
  a.focus(); pointerDown(a); a.blur(); pointerClick(a); assert.deepEqual(calls, []);
  a.fire('click', { detail: 0 }); assert.deepEqual(calls, [6], 'cancelled tokens are consumed and cannot taint the next native click');
  root.hidden = true; a.fire('click', { detail: 0 }); root.hidden = false;
  const ancestor = new Node(doc, 'section'); ancestor.append(root); ancestor.hidden = true;
  a.fire('click', { detail: 0 }); ancestor.hidden = false; assert.deepEqual(calls, [6]);
  pointerDown(a); view.setEnabled(false); assert(a.disabled); view.setEnabled(true); assert(!a.disabled); pointerClick(a);
  assert.deepEqual(calls, [6], 'switching away and back cancels a held gesture');
  a.focus(); nativeKeyDown(a, 'Enter'); a.blur(); a.fire('click', { detail: 0 });
  a.fire('click', { detail: 0 }); assert.deepEqual(calls, [6, 6], 'blur also clears a held Enter token after rejecting its stale click');
  nativeKeyDown(a, 'Enter'); view.setEnabled(false); view.setEnabled(true); a.fire('click', { detail: 0 });
  assert.deepEqual(calls, [6, 6], 'a hidden-and-restored keyboard gesture stays cancelled without keyup');
  view.update(owner.read(), { enabled: false }); a.fire('click', { detail: 0 }); assert(a.disabled);
  view.update(owner.read(), { enabled: true }); assert(!a.disabled); a.fire('click', { detail: 0 }); assert.deepEqual(calls, [6, 6, 6]);
  view.update(undefined); assert(a.disabled); a.fire('click', { detail: 0 });
  view.update(owner.read()); assert(find('scspSynthAllocationEditB').disabled); find('scspSynthAllocationEditB').fire('click', { detail: 0 });
  const conflict = owner.read(); conflict.manualVoices.push({ slot: 6, id: 'conflict', held: true });
  view.update(conflict, { selected: 6 }); assert(a.disabled); a.fire('click', { detail: 0 });
  view.update(owner.read()); pointerDown(a); view.dispose(); assert(a.disabled); pointerClick(a); view.setEnabled(true); assert(a.disabled);
  assert.deepEqual(calls, [6, 6, 6]);
});

test('source, unowned and manual members route exact slots; manual replacement and callback errors stay isolated', async t => {
  const owner = await create(t), calls = [], errors = [];
  let failure = null;
  const { view, find } = fixture({ onSelectSlot: slot => { calls.push(slot); if (failure === 'sync') throw Error('sync selection'); if (failure === 'async') return Promise.reject(Error('async selection')); }, onError: error => errors.push(error.message) });
  t.after(() => view.dispose());
  view.update(owner.read(), { operator: 4 }); const a = find('scspSynthAllocationEditA');
  assert.equal(a.dataset.allocationSlot, '4'); assert.equal(a.getAttribute('aria-label'), 'Edit physical CH5 (operator E)');
  assert.equal(find('scspSynthAllocationOpA').dataset.operator, 'E'); a.fire('click', { detail: 0 });
  view.update(owner.read(), { selected: 31 }); assert.equal(a.getAttribute('aria-label'), 'Edit physical CH32'); a.fire('click', { detail: 0 });
  owner.physicalNoteOn('manual', 8, 72); view.update(owner.read(), { selected: 8 });
  assert.equal(find('scspSynthAllocationOpA').children[0].textContent, 'CH9'); assert.equal(find('scspSynthAllocationOpA').dataset.operator, '');
  pointerDown(a); owner.physicalNoteOff('manual'); view.update(owner.read(), { selected: 8 }); pointerClick(a);
  assert.deepEqual(calls, [4, 31, 8], 'release retains the same manual target');
  pointerDown(a); owner.physicalNoteOn('replacement', 8, 74); view.update(owner.read(), { selected: 8 }); pointerClick(a);
  assert.deepEqual(calls, [4, 31, 8, 8], 'a new owner at the same physical slot does not cancel navigation');
  const before = owner.read(), registers = slotRegisters(owner);
  failure = 'sync'; a.fire('click', { detail: 0 }); assert.deepEqual(errors, ['sync selection']);
  failure = 'async'; a.fire('click', { detail: 0 }); await Promise.resolve();
  assert.deepEqual(errors, ['sync selection', 'async selection']); assert.deepEqual(owner.read(), before); assert.deepEqual(slotRegisters(owner), registers);
});

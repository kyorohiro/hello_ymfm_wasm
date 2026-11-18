// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {describeScspDspSignalFlow, setupScspDspSignalFlow} from './dsp_signal_flow.js';

function state() {
  return {
    config: {effect: {enabled: true, send: 7, returnLevel: 6}},
    slots: Array.from({length: 32}, () => ({directLevel: 7, pan: 0, gate: false})),
    routing: {outputs: [0]},
    dspRouting: {
      sources: Array.from({length: 6}, () => ({input: 0, level: 7})),
      slots: Array.from({length: 32}, () => ({input: 0, level: 7})),
    },
    dspReturns: [{level: 7, pan: 31}, {level: 7, pan: 15}],
  };
}

test('known two-input program tracks the selected bus without treating the other shared Return as silent', () => {
  const value = state(), before = structuredClone(value);
  let model = describeScspDspSignalFlow(value, {selected: 4, program: 'routing'});
  assert.equal(model.source, 'CH5');
  assert.equal(model.send.input, 0);
  assert.deepEqual(model.returns.map(output => output.route), ['selected', 'other-input']);
  assert.deepEqual(model.returns.map(output => output.state), ['enabled', 'enabled']);
  assert.deepEqual(model.returns[0].sides, {left: 'enabled', right: 'muted'});
  assert.deepEqual(model.returns[1].sides, {left: 'muted', right: 'enabled'});
  assert.deepEqual(value, before, 'describing paths never changes the authoring state');
  value.dspRouting.slots[4].input = 1;
  model = describeScspDspSignalFlow(value, {selected: 4, program: 'routing'});
  assert.deepEqual(model.returns.map(output => output.route), ['other-input', 'selected']);
  assert.match(model.notice, /other CHs and DSP history/);
});

test('zero send, muted Return and disabled shared outputs are distinct from direct output', () => {
  const value = state();
  value.dspRouting.slots[0].level = 0;
  value.dspReturns[1].level = 0;
  let model = describeScspDspSignalFlow(value, {selected: 0, program: 'routing'});
  assert.equal(model.send.state, 'muted');
  assert.equal(model.returns[0].state, 'enabled', 'other CHs/history may still feed the shared Return');
  assert.equal(model.returns[1].state, 'muted');
  assert.equal(model.direct.state, 'enabled');
  value.config.effect.enabled = false;
  model = describeScspDspSignalFlow(value, {selected: 0, program: 'routing'});
  assert(model.returns.every(output => output.state === 'disabled'));
  assert(model.returns.every(output => output.sides.left === 'disabled' && output.sides.right === 'disabled'));
  assert.equal(model.direct.state, 'enabled', 'DSP Return enable does not mute the direct path');
});

test('single-input programs mark unused paths, while custom programs do not invent connections', () => {
  const value = state();
  value.dspRouting.slots[7].input = 1;
  for (const program of ['delay', 'fir2', 'iir1']) {
    const model = describeScspDspSignalFlow(value, {selected: 7, program});
    assert.equal(model.program.route, 'unused');
    assert.match(model.program.detail, /MIXS1 unused/);
    assert.deepEqual(model.returns.map(output => output.route), ['other-input', 'unused']);
  }
  const custom = describeScspDspSignalFlow(value, {selected: 7, program: null});
  assert.equal(custom.program.family, 'custom');
  assert.equal(custom.program.route, 'program-defined');
  assert(custom.returns.every(output => output.route === 'program-defined'));
  assert.match(custom.program.detail, /program-defined/);
});

test('Pan endpoints and duplicate center codes describe routing without estimating gain', () => {
  const value = state();
  for (const pan of [0, 16]) {
    value.dspReturns[0].pan = pan;
    const output = describeScspDspSignalFlow(value).returns[0];
    assert.equal(output.panLabel, 'Center');
    assert.deepEqual(output.sides, {left: 'enabled', right: 'enabled'});
  }
  for (const [pan, label] of [[7, 'Right · code 7'], [23, 'Left · code 23']]) {
    value.dspReturns[0].pan = pan;
    const output = describeScspDspSignalFlow(value).returns[0];
    assert.equal(output.panLabel, label);
    assert.deepEqual(output.sides, {left: 'enabled', right: 'enabled'});
  }
});

test('Auto source output suppression and SSF context stay separate from physical routes and activity', () => {
  const value = state();
  value.dspRouting.sources[1] = {input: 1, level: 5};
  let model = describeScspDspSignalFlow(value, {operator: 1, program: 'routing', readOnly: true});
  assert.equal(model.source, 'Auto · source B');
  assert.deepEqual(model.send, {input: 1, level: 5, state: 'enabled'});
  assert.equal(model.direct.state, 'modulator');
  assert.equal(model.direct.level, 0);
  assert.match(model.notice, /SSF has a separate DSP/);
  model = describeScspDspSignalFlow(value, {selected: 1, program: 'routing'});
  assert.equal(model.direct.state, 'enabled');
  assert.equal(model.send.state, 'enabled', 'Gate Off is not a claim about current audio or configured paths');
});

class Node extends EventTarget {
  constructor(doc) {super(); this.ownerDocument = doc; this.children = []; this.dataset = {}; this.attributes = new Map(); this.value = '';}
  set textContent(value) {this.value = value; this.ownerDocument.writes++;}
  get textContent() {return this.value;}
  setAttribute(name, value) {this.attributes.set(name, value); this.ownerDocument.writes++;}
  getAttribute(name) {return this.attributes.get(name) ?? null;}
  append(...children) {this.children.push(...children); this.ownerDocument.writes++;}
  replaceChildren(...children) {this.children = children; this.ownerDocument.writes++;}
}
function fixture() {
  const doc = {writes: 0, createElement: () => new Node(doc)};
  const details = new Node(doc), body = new Node(doc), summary = new Node(doc);
  details.open = false;
  const nodes = {scspDspSignalFlow: details, scspDspSignalFlowBody: body, scspDspSignalFlowSummary: summary};
  doc.getElementById = name => nodes[name];
  Object.defineProperty(doc, 'activeElement', {get() {throw Error('Passive view must not inspect or change focus');}});
  const find = (node, property, value) => node.dataset[property] === value ? node
    : node.children.map(child => find(child, property, value)).find(Boolean);
  return {doc, details, body, summary, find, view: setupScspDspSignalFlow({root: doc})};
}

test('closed disclosure renders only its latest detached model when opened, without forcing focus or openness', () => {
  const {view, details, body, summary, find} = fixture(), value = state();
  view.update(value, {selected: 3, program: 'routing'});
  assert.equal(body.children.length, 0);
  value.dspRouting.slots[3] = {input: 1, level: 4};
  view.update(value, {selected: 3, program: 'routing'});
  assert.equal(summary.textContent, 'Signal flow · CH4 → MIXS1');
  assert.equal(details.open, false);
  value.dspRouting.slots[3].input = 0;
  details.open = true; details.dispatchEvent(new Event('toggle'));
  assert.equal(find(body, 'flow', 'send').dataset.input, '1', 'the recorded model is detached from later state mutations');
  assert.equal(find(body, 'flow', 'send').dataset.level, '4');
  assert.equal(body.children.length, 6);
  view.dispose();
});

test('unchanged polling does not rewrite the diagram and disposal stops all later updates', () => {
  const {view, doc, details, body, summary, find} = fixture(), value = state();
  details.open = true;
  view.update(value, {program: 'routing'});
  const writes = doc.writes;
  view.update(structuredClone(value), {program: 'routing'});
  assert.equal(doc.writes, writes);
  value.dspReturns[0].level = 0;
  view.update(value, {program: 'routing'});
  assert.equal(find(body, 'output', '0').dataset.state, 'muted');
  const label = summary.textContent, finalWrites = doc.writes;
  view.dispose();
  view.update(value, {selected: 7, readOnly: true});
  details.dispatchEvent(new Event('toggle'));
  assert.equal(doc.writes, finalWrites);
  assert.equal(summary.textContent, label);
});

test('older cached HTML without the passive diagram can still initialize', () => {
  const view = setupScspDspSignalFlow({root: {getElementById: () => null}});
  assert.doesNotThrow(() => {view.update(state()); view.dispose();});
});

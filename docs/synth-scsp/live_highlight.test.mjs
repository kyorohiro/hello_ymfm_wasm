import test from 'node:test';
import assert from 'node:assert/strict';
import { setupScspLiveHighlighter } from './live_highlight.js';

const className = 'is-live-changed';
const envelope = ['attackRate', 'decay1Rate', 'decay2Rate', 'decayLevel', 'releaseRate', 'keyRateScaling', 'loopLink'];
const lfo = ['frequencyCode', 'pitchWave', 'pitchDepth', 'amplitudeWave', 'amplitudeDepth', 'reset'];
const mix = ['totalLevel', 'directLevel', 'pan'];
const modulation = ['depth', 'xOffset', 'yOffset', 'writeInhibit'];
const auto = ['voiceMode', 'algorithm', 'fmDepth', 'fmRatio', 'pitch', 'operatorRatio', 'operatorDepth'];

function node(tagName = 'INPUT', parentElement = null, type = 'number') {
  let value = '0', checked = false, text = '0', hidden = false;
  const classes = new Set(), listeners = new Map();
  const result = {
    tagName, type, parentElement, classes, listeners, writes: [], scalarReads: 0, hiddenReads: 0,
    classList: {
      add(name) { result.writes.push(['add', name]); classes.add(name); },
      remove(name) { result.writes.push(['remove', name]); classes.delete(name); },
      contains: name => classes.has(name),
    },
    addEventListener(name, handler) { assert(!listeners.has(name)); listeners.set(name, handler); },
    removeEventListener(name, handler) { assert.equal(listeners.get(name), handler); listeners.delete(name); },
    dispatch(properties = {}) { listeners.get('animationend')?.({ target: result, animationName: 'synth-live-change', ...properties }); },
    closest(selector) {
      for (let current = result; current; current = current.parentElement)
        if (selector === 'label' ? current.tagName === 'LABEL' : current.classes.has(selector.slice(1))) return current;
      return null;
    },
    get value() { result.scalarReads++; return value; },
    set value(next) { value = String(next); },
    get checked() { result.scalarReads++; return checked; },
    set checked(next) { checked = next; },
    get textContent() { result.scalarReads++; return text; },
    set textContent(next) { text = String(next); },
    get hidden() { result.hiddenReads++; return hidden; },
    set hidden(next) { hidden = next; },
    get offsetWidth() { assert.fail('No layout reads'); },
    getBoundingClientRect() { assert.fail('No layout reads'); },
    animate() { assert.fail('CSS owns animations'); },
  };
  return result;
}

function fixture({ enabled = true, missing = [] } = {}) {
  const nodes = new Map(), targets = new Map(), ids = new Map(), selectors = new Map();
  const shell = node('MAIN'), scsp = node('SECTION', shell), voicePanel = node('DIV', scsp);
  const physical = node('SECTION', scsp), autoPanel = node('SECTION', scsp), ssfPanel = node('FIELDSET', voicePanel);
  const physicalMod = node('FIELDSET', voicePanel), env = node('FIELDSET', voicePanel);
  const lfoPanel = node('FIELDSET', voicePanel), mixPanel = node('FIELDSET', voicePanel);
  const containers = { shell, scsp, voicePanel, physical, autoPanel, ssfPanel, physicalMod, env, lfoPanel, mixPanel };
  const add = (name, parent, { select = false, checkbox = false, id = false, output = false } = {}) => {
    if (missing.includes(name)) return;
    const label = node('LABEL', parent), stepper = node('SPAN', label);
    stepper.classes.add('scsp-stepper');
    const input = node(output ? 'OUTPUT' : select ? 'SELECT' : 'INPUT', select || checkbox || output ? label : stepper, checkbox ? 'checkbox' : 'number');
    const target = checkbox || output ? label : select ? input : stepper;
    nodes.set(name, input); targets.set(name, target);
    if (id) ids.set(name, input); else selectors.set(`[data-chip-control="scsp-${name}"]`, input);
    return input;
  };
  add('scspPhysicalFrequency', physical, { id: true }); add('root', voicePanel);
  for (const name of envelope) add(name, env, { checkbox: name === 'loopLink' });
  for (const name of lfo) add(`lfo-${name}`, lfoPanel, { select: name !== 'reset', checkbox: name === 'reset' });
  for (const name of mix) add(name, mixPanel);
  for (const name of modulation) add(`modulation-${name}`, physicalMod, { checkbox: name === 'writeInhibit' });
  for (const name of auto) add(name, autoPanel, { id: true, select: name === 'voiceMode' || name === 'algorithm' });
  const outputs = modulation.map(name => add(`ssf-${name}`, ssfPanel, { output: true })).filter(Boolean);
  ssfPanel.querySelectorAll = selector => { assert.equal(selector, 'output'); return outputs; };
  selectors.set('.scsp-ssf-modulation', ssfPanel);
  for (const name of ['rate', 'loop', 'sample', 'bits', 'waveform', 'modulation-padding']) add(name, voicePanel);
  let queries = 0, forbidQueries = false;
  const doc = {
    activeElement: null,
    getElementById(id) { assert(!forbidQueries, 'No per-render ID discovery'); queries++; return ids.get(id); },
    querySelector(selector) { assert(!forbidQueries, 'No per-render selector discovery'); queries++; return selectors.get(selector); },
  };
  const highlighter = setupScspLiveHighlighter({ document: doc, enabled });
  forbidQueries = true;
  const codeVoice = () => ({ sample: { bankId: 'bank', id: 1 }, envelope: {}, lfo: {}, modulation: {} });
  const state = { slots: Array.from({ length: 32 }, codeVoice), codeSession: 1 };
  const context = { state, selected: 7, operator: 0, engine: {}, codeRunning: true, view: 'scsp' };
  const ssfSnapshot = { frame: 128, revision: 1, slots: Array.from({ length: 32 }, () => ({ sample: { startAddress: 1024, bits: 16, sourceMode: 0 }, voice: codeVoice() })) };
  const ssfContext = { ...context, codeRunning: false, ssfSnapshot, ssfVoice: ssfSnapshot.slots[7].voice, ssfSlot: 7, ssfSession: 1, following: true, playback: 'playing' };
  return { nodes, targets, containers, highlighter, context, ssfContext, doc, queries,
    value(name, value) { const input = nodes.get(name); if (input.type === 'checkbox') input.checked = value; else if (input.tagName === 'OUTPUT') input.textContent = value; else input.value = value; },
  };
}
const pulsed = (f, name) => f.targets.get(name)?.classList.contains(className);
const quiet = f => assert([...f.targets.values()].every(target => !target.classList.contains(className)));

test('physical Code uses cached wrappers, select controls and individual checkbox labels', () => {
  const f = fixture();
  const eligible = ['scspPhysicalFrequency', ...envelope, ...lfo.map(key => `lfo-${key}`), ...mix, ...modulation.map(key => `modulation-${key}`)];
  f.highlighter.update(f.context); quiet(f);
  for (const name of eligible) f.value(name, f.nodes.get(name).type === 'checkbox' ? true : 2);
  f.highlighter.update(f.context);
  assert(eligible.every(name => pulsed(f, name)));
  assert(!pulsed(f, 'root')); assert(auto.every(name => !pulsed(f, name)));
  assert(modulation.every(name => !pulsed(f, `ssf-${name}`)));
  assert(!f.containers.env.classList.contains(className));
  assert(!f.containers.lfoPanel.classList.contains(className));
  assert(!f.containers.physicalMod.classList.contains(className));
  for (const name of ['root', 'rate', 'loop', 'sample', 'bits', 'waveform', 'modulation-padding']) assert.equal(f.nodes.get(name).scalarReads, 0);
  f.highlighter.dispose(); quiet(f);
});

test('Auto Code compares source controls and visible configuration without physical or draft fields', () => {
  const f = fixture(), context = { ...f.context, selected: null, operator: 2 };
  f.highlighter.update(context); quiet(f);
  for (const name of auto) f.value(name, 3);
  f.value('attackRate', 4); f.value('scspPhysicalFrequency', 500); f.value('root', 700);
  f.value('modulation-depth', 8);
  f.highlighter.update(context);
  assert(auto.every(name => pulsed(f, name))); assert(pulsed(f, 'attackRate'));
  assert(!pulsed(f, 'scspPhysicalFrequency')); assert(!pulsed(f, 'root')); assert(!pulsed(f, 'modulation-depth'));
  f.highlighter.dispose();
});

test('SSF highlights rendered playback rate, edit overlay parameters and raw modulation outputs', () => {
  const f = fixture();
  f.highlighter.update(f.ssfContext); quiet(f);
  // The raw snapshot/revision can remain unchanged while an accepted edit
  // overlay changes the parameters already shown by liveView.getPCM().voice.
  f.ssfContext.ssfVoice = { ...f.ssfContext.ssfVoice, envelope: { attackRate: 19 } };
  f.value('attackRate', 19); f.value('root', 22050); f.value('lfo-pitchDepth', 4); f.value('loopLink', true);
  for (const key of modulation) f.value(`ssf-${key}`, key === 'writeInhibit' ? 'On' : '7');
  f.highlighter.update(f.ssfContext);
  for (const name of ['attackRate', 'root', 'lfo-pitchDepth', 'loopLink', ...modulation.map(key => `ssf-${key}`)]) assert(pulsed(f, name), name);
  assert(!pulsed(f, 'scspPhysicalFrequency')); assert(auto.every(name => !pulsed(f, name)));
  for (const name of ['scspPhysicalFrequency', ...auto, ...modulation.map(key => `modulation-${key}`)]) assert.equal(f.nodes.get(name).scalarReads, 0, name);
  f.highlighter.dispose();
});

test('source, CH, operator, engine, sessions, view and PCM changes establish silent baselines', () => {
  const f = fixture(); let context = f.context, value = 0;
  const baseline = next => {
    f.value('attackRate', ++value); f.highlighter.update(next); quiet(f);
    f.value('attackRate', ++value); f.highlighter.update(next); assert(pulsed(f, 'attackRate'));
    context = next;
  };
  baseline(context);
  baseline({ ...context, selected: 8 });
  baseline({ ...context, operator: 1 });
  baseline({ ...context, engine: {} });
  baseline({ ...context, state: { ...context.state, codeSession: 2 } });
  baseline({ ...context, codeSession: 3 });
  const state = { ...context.state, slots: context.state.slots.map(voice => ({ ...voice, sample: { ...voice.sample, bankId: 'replacement' } })) };
  baseline({ ...context, state });
  baseline({ ...context, state: { ...state, slots: state.slots.map(voice => ({ ...voice, sample: { ...voice.sample, id: 9 } })) } });
  f.highlighter.update({ ...context, view: 'dsp' }); quiet(f);
  baseline({ ...context, view: 'scsp' });
  baseline(f.ssfContext);
  baseline({ ...context, ssfSlot: 10 });
  baseline({ ...context, ssfSession: 2 });
  const ssfSnapshot = { ...context.ssfSnapshot, slots: context.ssfSnapshot.slots.map(slot => ({ ...slot, sample: { ...slot.sample, startAddress: 4096 } })) };
  baseline({ ...context, ssfSnapshot });
  baseline(f.context);
  f.highlighter.dispose();
});

test('Pause, Resume, seeking, Live Off, Stop and frame-zero initialization never synthesize edits', () => {
  const f = fixture(); let value = 0;
  const update = context => { f.value('attackRate', ++value); f.highlighter.update(context); };
  update(f.ssfContext); quiet(f); update(f.ssfContext); assert(pulsed(f, 'attackRate'));
  for (const patch of [{ playback: 'paused' }, { playback: 'seeking' }, { following: false }, { playback: 'stopped' }, { playback: 'starting' }, { ssfSnapshot: { ...f.ssfContext.ssfSnapshot, frame: 0 } }]) {
    update({ ...f.ssfContext, ...patch }); quiet(f);
    update(f.ssfContext); quiet(f);
    update(f.ssfContext); assert(pulsed(f, 'attackRate'));
  }
  update({ ...f.context, codeRunning: false, ssfVoice: null }); quiet(f);
  update(f.context); quiet(f); update(f.context); assert(pulsed(f, 'attackRate'));
  f.highlighter.clear(); quiet(f); update(f.context); quiet(f);
  f.highlighter.dispose();
});

test('focused and dragged controls compare displayed values and never overwrite or flash deferred model values', () => {
  const f = fixture();
  f.highlighter.update(f.context);
  f.doc.activeElement = f.nodes.get('attackRate');
  f.nodes.get('totalLevel').classList.add('is-dragging');
  f.context.state.slots[7].envelope.attackRate = 31;
  f.context.state.slots[7].totalLevel = 200;
  f.highlighter.update(f.context); quiet(f);
  assert.equal(f.nodes.get('attackRate').value, '0'); assert.equal(f.nodes.get('totalLevel').value, '0');
  // A manual change during playback is itself a displayed scalar change.
  f.value('attackRate', 9); f.highlighter.update(f.context); assert(pulsed(f, 'attackRate')); assert(!pulsed(f, 'totalLevel'));
  f.targets.get('attackRate').dispatch();
  f.doc.activeElement = null; f.nodes.get('totalLevel').classList.remove('is-dragging');
  f.value('attackRate', 31); f.value('totalLevel', 200);
  f.highlighter.update(f.context); assert(pulsed(f, 'attackRate')); assert(pulsed(f, 'totalLevel'));
  f.highlighter.dispose();
});

test('hidden control ancestry and newly shown panels silently rebase without layout or discovery', () => {
  const f = fixture();
  f.highlighter.update(f.context); f.value('attackRate', 2); f.highlighter.update(f.context); assert(pulsed(f, 'attackRate'));
  f.containers.env.hidden = true; f.highlighter.update(f.context); quiet(f);
  const reads = f.nodes.get('attackRate').scalarReads;
  f.value('attackRate', 8); f.highlighter.update(f.context); quiet(f);
  assert.equal(f.nodes.get('attackRate').scalarReads, reads);
  f.containers.env.hidden = false; f.highlighter.update(f.context); quiet(f);
  f.value('attackRate', 9); f.highlighter.update(f.context); assert(pulsed(f, 'attackRate'));
  f.containers.scsp.hidden = true; f.highlighter.update(f.context); quiet(f);
  f.value('attackRate', 10); f.highlighter.update(f.context); quiet(f);
  f.containers.scsp.hidden = false; f.highlighter.update(f.context); quiet(f);
  f.highlighter.dispose();
});

test('Off performs zero context, scalar or visibility reads and re-enabling starts cleanly', () => {
  const f = fixture({ enabled: false });
  const unreadable = new Proxy({}, { get() { assert.fail('Off must not inspect context'); } });
  const reads = () => [...f.nodes.values(), ...Object.values(f.containers)].map(node => [node.scalarReads, node.hiddenReads]);
  const initial = reads();
  for (let index = 0; index < 100; index++) f.highlighter.update(unreadable);
  assert.deepEqual(reads(), initial);
  f.highlighter.setEnabled(true); f.highlighter.update(f.context); quiet(f);
  f.value('attackRate', 4); f.highlighter.update(f.context); assert(pulsed(f, 'attackRate'));
  f.highlighter.setEnabled(false); quiet(f); const disabled = reads();
  for (let index = 0; index < 100; index++) f.highlighter.update(unreadable);
  assert.deepEqual(reads(), disabled);
  f.value('attackRate', 19); f.highlighter.setEnabled(true); f.highlighter.update(f.context); quiet(f);
  assert.throws(() => f.highlighter.setEnabled('false'), TypeError);
  f.highlighter.dispose();
});

test('rapid display changes share one bounded pulse and CSS animationend controls cleanup', () => {
  const f = fixture(), target = f.targets.get('attackRate');
  f.highlighter.update(f.context);
  for (let value = 1; value < 100; value++) { f.value('attackRate', value); f.highlighter.update(f.context); }
  assert.deepEqual(target.writes, [['add', className]]);
  target.dispatch({ animationName: 'unrelated' }); assert(pulsed(f, 'attackRate'));
  target.dispatch({ target: f.nodes.get('attackRate') }); assert(pulsed(f, 'attackRate'));
  target.dispatch(); assert(!pulsed(f, 'attackRate'));
  f.value('attackRate', 101); f.highlighter.update(f.context); assert(pulsed(f, 'attackRate'));
  f.highlighter.dispose(); quiet(f);
  for (const node of f.targets.values()) assert.equal(node.listeners.size, 0);
  const reads = f.nodes.get('attackRate').scalarReads, writes = target.writes.length;
  f.highlighter.update(new Proxy({}, { get() { assert.fail('Disposed must not inspect context'); } }));
  f.highlighter.setEnabled(false); f.highlighter.setEnabled(true); f.highlighter.dispose();
  assert.equal(f.nodes.get('attackRate').scalarReads, reads); assert.equal(target.writes.length, writes);
});

test('missing optional nodes, empty documents and absent contexts are safe', () => {
  const f = fixture({ missing: ['loopLink', 'root', 'fmDepth', 'lfo-reset', 'ssf-writeInhibit'] });
  f.highlighter.update(null); f.highlighter.update(f.context); f.value('attackRate', 3); f.highlighter.update(f.context); assert(pulsed(f, 'attackRate'));
  f.highlighter.update({ ...f.context, state: null }); quiet(f);
  f.highlighter.dispose();
  const empty = setupScspLiveHighlighter({ document: { querySelector: () => null, getElementById: () => null } });
  empty.update(f.context); empty.clear(); empty.dispose();
  assert.throws(() => setupScspLiveHighlighter({ document: {}, enabled: false }), TypeError);
});

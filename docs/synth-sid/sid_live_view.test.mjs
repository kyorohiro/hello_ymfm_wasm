import test from 'node:test';
import assert from 'node:assert/strict';
import {readSidLiveVoice, createSidLiveView} from './sid_live_view.js';

function playerState({model = '6581'} = {}) {
  const registers = new Uint8Array(32);
  for (let voice = 0; voice < 3; voice++) {
    const base = voice * 7, frequency = 7000 + voice * 1000;
    registers[base] = frequency & 255;
    registers[base + 1] = frequency >> 8;
    registers[base + 2] = 0x34 + voice;
    registers[base + 3] = 0x02;
    registers[base + 4] = 0x21;
    registers[base + 5] = 0x26;
    registers[base + 6] = 0xc5;
  }
  registers[21] = 4;
  registers[22] = 50;
  registers[23] = 0x41;
  registers[24] = 0x18;
  return {model, clockHz: 985248, positionFrames: 48000, sampleRate: 48000, registers,
    voices: [{envelope: 123}, {envelope: 200}, {envelope: 0}]};
}

test('live decoding retains all hardware flags and shared filter outputs without changing the Player state', () => {
  const state = playerState(), r = state.registers;
  r[0] = 255; r[1] = 255; r[2] = 255; r[3] = 255; r[4] = 255; r[5] = 0x83; r[6] = 0xa7;
  r[21] = 255; r[22] = 255; r[23] = 255; r[24] = 255;
  const before = structuredClone(state), value = readSidLiveVoice(state, 0);
  assert.equal(value.frequencyRegister, 65535);
  assert.equal(value.frequencyHz, 65535 * 985248 / 16777216);
  assert.equal(value.pulseWidth, 4095, 'only the low nibble of the pulse-width high byte is used');
  assert.equal(value.waveformMask, 0xf0);
  assert.deepEqual(value.waveforms, ['Triangle', 'Saw', 'Pulse', 'Noise']);
  for (const flag of ['gate', 'sync', 'ring', 'test']) assert.equal(value[flag], true);
  assert.deepEqual([value.attack, value.decay, value.sustain, value.release], [8, 3, 10, 7]);
  assert.equal(value.envelope, 123);
  assert.deepEqual(value.filter, {cutoff: 2047, resonance: 15, modeMask: 7, outputs: ['LP', 'BP', 'HP'],
    routed: true, routingMask: 7, volume: 15, voice3off: true});
  assert.equal(value.importable.available, false);
  assert.match(value.importable.reason, /TEST is held/);
  assert.deepEqual(state, before);
  assert(Object.isFrozen(value)); assert(Object.isFrozen(value.filter)); assert(Object.isFrozen(value.registers));
  r[0] = 0;
  assert.equal(value.registers[0], 255, 'decoded observations do not alias the live register array');
});

test('each selected CH reads its own registers and the physical preceding oscillator', () => {
  const state = playerState();
  const values = [0, 1, 2].map(voice => readSidLiveVoice(state, voice));
  assert.deepEqual(values.map(value => value.frequencyRegister), [7000, 8000, 9000]);
  assert.deepEqual(values.map(value => value.source.voice), [2, 0, 1]);
  assert.deepEqual(values.map(value => value.source.frequencyRegister), [9000, 7000, 8000]);
  assert.equal(values[1].source.ratio, 7000 / 8000);
  assert.deepEqual(values.map(value => value.filter.routed), [true, false, false]);
  assert.deepEqual(values.map(value => value.envelope), [123, 200, 0]);
  const frequency = Math.round(440 * 16777216 / state.clockHz);
  state.registers[0] = frequency & 255; state.registers[1] = frequency >> 8;
  const tuned = readSidLiveVoice(state, 0);
  assert.equal(tuned.note.name, 'A4'); assert.equal(tuned.note.midi, 69);
  assert(Math.abs(tuned.note.cents) < .2);
  state.registers[0] = 0; state.registers[1] = 0;
  const zero = readSidLiveVoice(state, 0);
  assert.equal(zero.frequencyHz, 0); assert.equal(zero.note, null); assert.equal(zero.source.ratio, null);
});

test('unobservable Envelope remains unavailable and unsupported silent/control settings remain observable', () => {
  const state = playerState({model: '8580'});
  state.voices = [{envelope: null}, {}, {envelope: 256}];
  for (let voice = 0; voice < 3; voice++) assert.equal(readSidLiveVoice(state, voice).envelope, null);
  state.registers[4] = 0;
  let value = readSidLiveVoice(state, 0);
  assert.deepEqual(value.waveforms, []); assert.equal(value.gate, false);
  assert.match(value.importable.reason, /No oscillator waveform/);
  state.registers[4] = 0x18;
  value = readSidLiveVoice(state, 0);
  assert.equal(value.test, true); assert.equal(value.gate, false); assert.deepEqual(value.waveforms, ['Triangle']);
  assert.match(value.importable.reason, /TEST/);
  state.registers[4] = 0x21; state.registers[24] = 8;
  value = readSidLiveVoice(state, 0);
  assert.equal(value.filter.routed, true); assert.equal(value.filter.modeMask, 0);
  assert.deepEqual(value.filter.outputs, []);
  assert.match(value.importable.reason, /filter with no enabled outputs/);
});

test('live decoder rejects malformed observations without coercing registers or voice indices', () => {
  const state = playerState();
  for (const voice of [-1, 3, .5, '1']) assert.throws(() => readSidLiveVoice(state, voice), /Live SID voice/);
  assert.throws(() => readSidLiveVoice({...state, registers: new Uint8Array(31)}, 0), /32 register bytes/);
  assert.throws(() => readSidLiveVoice({...state, registers: Array(32).fill(256)}, 0), /register/);
  assert.throws(() => readSidLiveVoice({...state, positionFrames: NaN}, 0), /position/);
  assert.throws(() => readSidLiveVoice({...state, sampleRate: 0}, 0), /sample rate/);
  assert.throws(() => readSidLiveVoice({...state, model: 'unknown'}, 0), /model/);
  assert.throws(() => readSidLiveVoice({...state, clockHz: 0}, 0), /clock/);
});

class Element {
  constructor(doc, tag = 'div') {
    this.ownerDocument = doc; this.tagName = tag; this.children = []; this.dataset = {}; this.attributes = {};
    this.textContent = ''; this.className = ''; this.listeners = new Map();
  }
  append(...nodes) { this.children.push(...nodes); }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  addEventListener(type, handler) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(handler);
  }
  removeEventListener(type, handler) { this.listeners.get(type)?.delete(handler); }
  focus() { this.ownerDocument.activeElement = this; }
  blur() { if (this.ownerDocument.activeElement === this) this.ownerDocument.activeElement = null; }
  fire(type, values = {}) {
    const event = {detail: 0, stopPropagation() { this.stopped = true; }, ...values};
    for (const handler of this.listeners.get(type) ?? []) handler(event);
    return event;
  }
}
const walk = root => [root, ...root.children.flatMap(walk)];
function fixture() {
  const doc = {activeElement: null, createElement: tag => new Element(doc, tag)}, root = new Element(doc);
  const view = createSidLiveView({root});
  return {root, doc, view, field: name => walk(root).find(node => node.dataset.liveField === name),
    status: () => walk(root).find(node => node.className === 'sid-live-state').textContent};
}

test('passive live DOM updates persist, CH changes reuse the same observation, and freezing retains its position', () => {
  const f = fixture(), raw = playerState(), field = f.field('frequencyRegister');
  const nodes = walk(f.root), before = structuredClone(raw);
  f.view.update({liveEnabled: true, liveActive: false, liveVoice: 0, liveState: null});
  assert.equal(f.root.dataset.state, 'idle'); assert.equal(field.dataset.value, '');
  const observed = f.view.update({liveEnabled: true, liveActive: true, liveVoice: 0, liveState: raw});
  assert.equal(f.root.dataset.liveActive, 'true'); assert.equal(f.root.dataset.liveFrames, '48000');
  assert.equal(f.root.dataset.liveModel, '6581'); assert.equal(field.dataset.value, '7000');
  assert.equal(f.field('gate').dataset.value, 'true'); assert.equal(f.field('envelope').dataset.value, '123');
  assert.deepEqual(observed, readSidLiveVoice(raw, 0), 'the common editor receives the full decoded observation');
  assert.equal(f.field('adsr'), undefined, 'normal editor controls are not duplicated in a live-only table');
  assert.equal(walk(f.root).filter(node => node.dataset.liveField).length, 8);
  assert.match(f.status(), /^Live/);
  f.view.update({liveEnabled: true, liveActive: true, liveVoice: 1, liveState: raw});
  assert.equal(field.dataset.value, '8000'); assert.equal(f.root.dataset.liveVoice, '1');
  assert.equal(f.field('envelope').dataset.value, '200'); assert.equal(field.dataset.changed, 'true');
  f.view.update({liveEnabled: false, liveActive: false, liveVoice: 1, liveState: raw});
  assert.equal(f.root.dataset.state, 'frozen'); assert.equal(f.root.dataset.liveActive, 'false');
  assert.equal(f.root.dataset.liveFrames, '48000'); assert.equal(field.dataset.value, '8000');
  assert.match(f.status(), /Frozen.*off/);
  assert.deepEqual(walk(f.root), nodes, 'updates preserve every mounted node');
  assert.equal(walk(f.root).some(node => ['button', 'input', 'select', 'textarea'].includes(node.tagName)), false);
  assert.equal(f.root.children[0].attributes['aria-live'], 'off');
  assert.deepEqual(raw, before, 'display does not write to its owned Player observation');
  f.view.dispose();
  f.view.update({liveEnabled: true, liveActive: true, liveVoice: 2, liveState: raw});
  assert.equal(field.dataset.value, '8000', 'disposed view ignores late updates');
});

test('combined settings reach the common editor unchanged and become importable, while malformed updates retain the previous display', () => {
  const f = fixture(), raw = playerState({model: '8580'});
  raw.registers[4] = 0x71; raw.voices = [];
  const observed = f.view.update({liveEnabled: true, liveActive: true, liveVoice: 0, liveState: raw});
  assert.equal(observed.waveformMask, 112);
  assert.deepEqual(observed.waveforms, ['Triangle', 'Saw', 'Pulse']);
  assert.equal(f.field('waveforms'), undefined, 'waveforms use the same buttons in the editor');
  assert.equal(f.field('envelope').dataset.value, 'unavailable');
  assert.match(f.field('envelope').textContent, /Unavailable/);
  assert.equal(observed.importable.available,true);assert.match(f.field('import').textContent, /Available/);
  f.view.update({liveEnabled: true, liveActive: true, liveVoice: 0, liveState: {...raw, registers: []}});
  assert.equal(f.root.dataset.state, 'error'); assert.equal(f.root.dataset.liveActive, 'false');
  assert.equal(f.root.dataset.liveFrames, '48000');
  assert.equal(f.field('frequencyRegister').dataset.value, '7000');
  assert.equal(f.field('envelope').dataset.value, 'unavailable');
  assert.match(f.status(), /Previous display kept/);
});

test('long observation help is closed by default, keeps its open state across polling and returns pointer focus', () => {
  const f = fixture(), raw = playerState();
  const help = walk(f.root).find(node => node.className === 'sid-live-help');
  const summary = help.children[0];
  assert.equal(help.tagName, 'details'); assert.equal(help.open, false);
  assert.equal(summary.tagName, 'summary'); assert.equal(summary.textContent, '?');
  assert.equal(summary.attributes['aria-label'], 'About Live CH observations');
  assert.match(help.children[1].textContent, /20 updates\/s.*Fast writes/);
  f.view.update({liveEnabled: true, liveActive: true, liveVoice: 0, liveState: raw});
  assert.equal(help.open, false, 'live updates never reveal the long explanation');
  help.open = true;
  summary.focus();
  f.view.update({liveEnabled: true, liveActive: true, liveVoice: 1, liveState: raw});
  assert.equal(help.open, true); assert.equal(f.doc.activeElement, summary, 'polling never changes focus');
  summary.fire('click', {detail: 1}); assert.equal(f.doc.activeElement, null);
  const event = summary.fire('keydown', {key: 'Enter'}); assert.equal(event.stopped, true);
  f.view.dispose();
  summary.focus(); summary.fire('click', {detail: 1});
  assert.equal(f.doc.activeElement, summary, 'disposal removes the help listeners');
});

test('a pending first observation identifies retained values as previous rather than the current playing SID', () => {
  const f = fixture(), raw = playerState();
  f.view.update({liveEnabled: true, liveActive: false, liveWaiting: true, liveVoice: 0,
    liveState: raw, liveSource: {name: 'Previous tune', subtune: 2, model: '6581'},
    selection: {name: 'New tune', model: '8580'}});
  assert.equal(f.root.dataset.state, 'waiting');
  assert.equal(f.root.dataset.liveWaiting, 'true');
  assert.equal(f.root.dataset.liveActive, 'false');
  assert.equal(f.root.dataset.liveFrames, '48000');
  assert.equal(f.root.dataset.liveModel, '6581');
  assert.equal(f.root.dataset.liveSourceName, 'Previous tune');
  assert.equal(f.root.dataset.liveSourceSubtune, '2');
  assert.match(f.status(), /^Waiting for current playback observation/);
  assert.match(f.status(), /Previous observation from Previous tune · subtune 2 remains shown/);
  assert.doesNotMatch(f.status(), /New tune|Frozen|stopped/);
  assert.match(walk(f.root).find(node => node.className === 'sid-live-heading').textContent, /last observed 6581/);
  const fresh = playerState({model: '8580'}); fresh.positionFrames = 960;
  f.view.update({liveEnabled: true, liveActive: true, liveWaiting: false, liveVoice: 0,
    liveState: fresh, liveSource: {name: 'New tune', subtune: 1, model: '8580'}});
  assert.equal(f.root.dataset.state, 'live'); assert.equal(f.root.dataset.liveWaiting, 'false');
  assert.equal(f.root.dataset.liveFrames, '960'); assert.equal(f.root.dataset.liveModel, '8580');
  assert.match(f.status(), /Live.*from New tune · subtune 1/);
  assert.doesNotMatch(f.status(), /Previous tune|last observed/);
});

test('Pause labels the held coherent frame and CH selection inspects it without changing its position', () => {
  const f=fixture(),raw=playerState(),before=structuredClone(raw);
  f.view.update({liveEnabled:true,liveActive:false,paused:true,liveVoice:0,liveState:raw,
    liveSource:{name:'Held tune',subtune:2,model:'6581'}});
  assert.equal(f.root.dataset.state,'paused');assert.equal(f.root.dataset.livePaused,'true');
  assert.equal(f.root.dataset.liveFrames,String(raw.positionFrames));assert.match(f.status(),/^Paused.*Held tune/);
  f.view.update({liveEnabled:true,liveActive:false,paused:true,liveVoice:1,liveState:raw});
  assert.equal(f.field('frequencyRegister').dataset.value,'8000');
  assert.equal(f.root.dataset.liveFrames,String(raw.positionFrames));assert.deepEqual(raw,before);
  f.view.update({liveEnabled:true,liveActive:false,paused:true,resuming:true,liveVoice:1,liveState:raw});
  assert.equal(f.root.dataset.state,'resuming');assert.equal(f.root.dataset.livePaused,'false');
  assert.match(f.status(),/^Resuming/);
});

test('Code observations use the same decoded hardware state without song-capture instructions', () => {
  const f=fixture(),raw=playerState(),before=structuredClone(raw);
  raw.registers[4]=0x71;raw.registers[23]=0x97;raw.registers[24]=0x78;
  const edited=structuredClone(raw);
  const observed=f.view.update({liveKind:'code',liveEnabled:true,liveActive:true,liveVoice:0,liveState:raw,
    liveSource:{name:'Previous song',subtune:2},paused:true,resuming:true});
  assert.equal(f.root.dataset.liveKind,'code');assert.equal(f.root.dataset.state,'live');assert.equal(f.root.dataset.livePaused,'false');
  assert.deepEqual(observed,readSidLiveVoice(raw,0));
  assert.deepEqual(observed.waveforms,['Triangle','Saw','Pulse']);
  assert.deepEqual(observed.filter.outputs,['LP','BP','HP']);assert.equal(observed.filter.resonance,9);
  assert.equal(f.field('frequencyRegister').dataset.value,'7000');assert.equal(f.field('envelope').dataset.value,'123');
  const importRow=walk(f.root).find(node=>node.children.includes(f.field('import')));
  assert.equal(importRow.hidden,true,'Code does not offer song capture as a way to replace the saved patch');
  assert.match(f.status(),/Live.*selected Code CH.*other channels keep running/);
  assert.doesNotMatch(f.status(),/song|Previous song|Capture|Resume/);
  assert.equal(f.root.dataset.liveSourceName,'');assert.equal(f.root.dataset.liveSourceSubtune,'');
  const heading=walk(f.root).find(node=>node.className==='sid-live-heading');assert.match(heading.textContent,/^Code · Live CH 1/);
  const help=walk(f.root).find(node=>node.className==='sid-live-help');
  assert.match(help.children[1].textContent,/Code observations.*20 updates\/s.*Fast writes/);
  assert.deepEqual(raw,edited,'rendering does not alter the observation');assert.notDeepEqual(raw,before,'the test changed actual hardware values');
});

test('Code channel changes and return to song keep nodes, focus and help while showing Off and unavailable 8580 values', () => {
  const f=fixture(),raw=playerState({model:'8580'});raw.voices=[];raw.registers[4]=0;raw.registers[11]=0x71;
  const nodes=walk(f.root),help=nodes.find(node=>node.className==='sid-live-help'),summary=help.children[0];
  help.open=true;summary.focus();
  let observed=f.view.update({liveKind:'code',liveEnabled:true,liveActive:true,liveVoice:0,liveState:raw});
  assert.deepEqual(observed.waveforms,[]);assert.equal(observed.gate,false);
  assert.equal(f.field('envelope').dataset.value,'unavailable');assert.match(f.field('envelope').textContent,/Unavailable/);
  observed=f.view.update({liveKind:'code',liveEnabled:true,liveActive:true,liveVoice:1,liveState:raw});
  assert.deepEqual(observed.waveforms,['Triangle','Saw','Pulse']);assert.equal(f.field('frequencyRegister').dataset.value,'8000');
  assert.equal(f.field('frequencyRegister').dataset.changed,'true');assert.equal(help.open,true);assert.equal(f.doc.activeElement,summary);
  f.view.update({liveEnabled:true,liveActive:true,liveVoice:1,liveState:raw,liveSource:{name:'Tune',subtune:1}});
  const importRow=walk(f.root).find(node=>node.children.includes(f.field('import')));
  assert.equal(importRow.hidden,false);assert.equal(f.root.dataset.liveKind,'song');assert.match(f.status(),/playing SID from Tune/);
  assert.match(help.children[1].textContent,/Read-only Player observations/);assert.doesNotMatch(help.children[1].textContent,/Code/);
  assert.deepEqual(walk(f.root),nodes);assert.equal(help.open,true);assert.equal(f.doc.activeElement,summary);
});

test('Code waiting, Live off and malformed samples retain contextual readouts without song commands', () => {
  const f=fixture(),raw=playerState(),state={liveKind:'code',liveEnabled:true,liveActive:false,liveVoice:2,liveState:raw};
  f.view.update({...state,liveWaiting:true});assert.equal(f.root.dataset.state,'waiting');
  assert.match(f.status(),/^Waiting for current Code observation.*Previous Code observation/);
  assert.doesNotMatch(f.status(),/playback|Capture|Resume|song/);
  f.view.update({...state,liveEnabled:false});assert.equal(f.root.dataset.state,'frozen');
  assert.match(f.status(),/Code Live off.*saved sound.*Code keeps running/);
  const value=f.field('frequencyRegister').dataset.value;
  f.view.update({...state,liveState:{...raw,registers:[]}});assert.equal(f.root.dataset.state,'error');
  assert.equal(f.field('frequencyRegister').dataset.value,value);assert.match(f.status(),/^Code Live display.*Previous display kept/);
  f.view.update({...state,liveState:null,liveError:true});assert.match(f.status(),/^Code Live observation failed/);
  f.view.update({...state,liveState:null});assert.match(f.status(),/^Run Code/);assert.equal(f.field('frequencyRegister').dataset.value,'');
});

import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createPlaygroundOki6258VoicePanel, oki6258PlaybackCode} from './playground_okim6258_voice_panel.js';

class Events {
  constructor() {this.listeners = new Map();}
  addEventListener(name, callback) {if (!this.listeners.has(name)) this.listeners.set(name, new Set()); this.listeners.get(name).add(callback);}
  removeEventListener(name, callback) {this.listeners.get(name)?.delete(callback);}
  async fire(type, extra = {}) {await Promise.all([...this.listeners.get(type) ?? []].map(callback => callback({type, target: this, preventDefault() {}, ...extra}))); await flush();}
}
class Element extends Events {
  constructor(doc, tag) {super(); this.ownerDocument = doc; this.tagName = tag; this.children = []; this.dataset = {}; this.attributes = {}; this.value = ''; this.textContent = ''; this.hidden = false; this.checked = false;}
  appendChild(node) {this.children.push(node); node.parentNode = this; return node;}
  removeChild(node) {this.children.splice(this.children.indexOf(node), 1); node.parentNode = null;}
  get firstChild() {return this.children[0];}
  setAttribute(name, value) {this.attributes[name] = String(value);}
  getAttribute(name) {return this.attributes[name];}
  setCustomValidity(message) {this.validityMessage = message;}
  reportValidity() {}
  getContext() {return null;}
  setPointerCapture() {}
}
const flush = () => new Promise(resolve => setImmediate(resolve));
const walk = root => [root, ...root.children.flatMap(walk)];
const control = (root, name) => walk(root).find(node => node.dataset.chipControl === `oki6258-${name}`);
const action = (root, name) => walk(root).find(node => node.dataset.chipAction === `oki6258-${name}`);
const output = (root, name) => walk(root).find(node => node.dataset.chipOutput === `oki6258-${name}`);
const snapshot = () => ({
  kind: 'okim6258', clock: 8000000, sampleRate: 48000, divider: 512, playbackRate: 15625,
  pan: {left: true, right: false}, playing: false, streaming: false, repeat: true, positionFrames: 0, fedBytes: 0,
  sample: {name: 'Snare', bytes: 8000, frames: 16000, sampleRate: 15625, durationSeconds: 1.024, waveform: [0, 0.5, -0.25, 0], source: 'raw'},
  channels: [{channel: 0, type: 'adpcm', active: false}],
});
function fixture(options = {}) {
  const win = new Events(); win.setTimeout = setTimeout; win.clearTimeout = clearTimeout;
  const doc = new Events(); doc.defaultView = win; doc.activeElement = null; doc.hidden = false; doc.createElement = tag => new Element(doc, tag);
  const root = new Element(doc, 'div'), calls = [], targets = [], errors = [], loads = [], reads = [];
  const panel = createPlaygroundOki6258VoicePanel({root, invoke: async (...args) => {calls.push(args);}, onKeyboardTargetChange: target => targets.push(target), onError: error => errors.push(error),
    listFiles: () => ['/samples/snare.wav'], readFile: async (...args) => {reads.push(args); return {data: new Uint8Array([1, 2, 3])};}, loadSample: async (...args) => {loads.push(args);}, ...options});
  panel.setConnected(true); panel.update(snapshot()); return {root, doc, win, calls, targets, errors, loads, reads, panel};
}

test('OKIM6258 snapshots show the single stream and three hardware rates without issuing writes', () => {
  const {root, calls, panel} = fixture();
  assert.equal(control(root, 'divider').value, '512'); assert.equal(control(root, 'clock').value, '8000000'); assert.equal(control(root, 'pan-left').checked, true); assert.equal(control(root, 'pan-right').checked, false);
  assert.equal(output(root, 'rate').textContent, '15,625'); assert.match(output(root, 'sample').textContent, /Snare.*8,000 bytes.*16,000 frames/); assert.equal(output(root, 'duration').textContent, '1.024 s');
  assert.deepEqual(control(root, 'divider').children.map(option => option.value), ['1024', '768', '512']); assert.match(control(root, 'divider').children[1].textContent, /10,416.67 Hz/);
  assert.deepEqual(calls, []); assert.ok(walk(root).some(node => node.textContent.includes('no hardware volume'))); panel.dispose();
});

test('missing sample disables manual playback and opening the panel never creates replacement audio', async () => {
  const {root, panel, calls, targets, loads} = fixture(); const empty = snapshot(); empty.sample = null; panel.update(empty);
  assert.equal(output(root, 'sample').textContent, 'No sample loaded'); for (const name of ['hold', 'play', 'keyboard']) assert.equal(action(root, name).disabled, true);
  await action(root, 'hold').fire('pointerdown', {pointerId: 1, button: 0}); await action(root, 'play').fire('click'); await action(root, 'keyboard').fire('click');
  assert.deepEqual(calls, []); assert.deepEqual(targets, []); assert.deepEqual(loads, []); panel.dispose();
});

test('readback preserves focused settings and updates actual playback position, rate and FIFO state', () => {
  const {root, panel, calls, doc} = fixture(); const clock = control(root, 'clock'); doc.activeElement = clock; clock.value = '9000000';
  const playing = snapshot(); playing.clock = 4000000; playing.playbackRate = 7812.5; playing.playing = playing.streaming = true; playing.positionFrames = 4000; panel.update(playing);
  assert.equal(clock.value, '9000000'); assert.equal(output(root, 'rate').textContent, '7,812.5'); assert.match(output(root, 'position').textContent, /^4,000 \/ 16,000/); assert.equal(output(root, 'duration').textContent, '2.048 s'); assert.equal(output(root, 'playback-state').textContent, 'Playing uploaded sample');
  playing.streaming = false; panel.update(playing); assert.equal(output(root, 'playback-state').textContent, 'Playing raw FIFO data'); assert.deepEqual(calls, []); panel.dispose();
});

test('divider, pan, repeat and clock edits send partial settings and validate before commands', async () => {
  const {root, panel, calls} = fixture();
  control(root, 'divider').value = '768'; await control(root, 'divider').fire('change'); control(root, 'pan-right').checked = true; await control(root, 'pan-right').fire('change'); control(root, 'repeat').checked = false; await control(root, 'repeat').fire('change');
  control(root, 'clock').value = '4000000'; await control(root, 'clock').fire('change');
  assert.deepEqual(calls, [['setVoice', [{divider: 768}]], ['setVoice', [{pan: {right: true}}]], ['setVoice', [{repeat: false}]], ['setClock', [4000000]]]);
  for (const value of ['', '99999', '100000001', '4000000.5']) {control(root, 'clock').value = value; await control(root, 'clock').fire('change');}
  control(root, 'divider').value = '123'; await control(root, 'divider').fire('change'); assert.equal(calls.length, 4); panel.dispose();
});

test('Hold releases the matching pointer on cancellation, blur, Release, disconnect and disposal', async () => {
  const {root, panel, calls, win} = fixture(), hold = action(root, 'hold');
  await hold.fire('pointerdown', {pointerId: 1, button: 0}); await hold.fire('pointerdown', {pointerId: 2, button: 0}); assert.equal(calls.length, 3);
  await hold.fire('pointerup', {pointerId: 1}); assert.equal(calls.length, 3); await hold.fire('pointercancel', {pointerId: 2}); assert.deepEqual(calls[3], ['auditionOff', [0, calls[2][1][2]]]);
  await hold.fire('keydown', {key: ' ', repeat: false}); await win.fire('blur'); assert.deepEqual(calls[5], ['auditionOff', [0, calls[4][1][2]]]);
  await hold.fire('pointerdown', {pointerId: 3, button: 0}); await action(root, 'release').fire('click'); assert.equal(calls.at(-1)[0], 'auditionOff');
  await hold.fire('pointerdown', {pointerId: 4, button: 0}); panel.setConnected(false); assert.equal(calls.at(-1)[0], 'auditionOff'); panel.setConnected(true);
  await hold.fire('pointerdown', {pointerId: 5, button: 0}); panel.dispose(); assert.equal(calls.at(-1)[0], 'auditionOff');
});

test('a bounded preview ends once and hiding cancels preview while the shared Keyboard remains usable', async t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  const {root, panel, calls, targets} = fixture(); await action(root, 'play').fire('click'); t.mock.timers.tick(999); assert.equal(calls.length, 1); t.mock.timers.tick(1); await flush(); assert.deepEqual(calls[1], ['auditionOff', [0, calls[0][1][2]]]);
  await action(root, 'keyboard').fire('click'); const target = targets.at(-1); await action(root, 'play').fire('click'); panel.setVisible(false); await flush(); assert.equal(calls[3][0], 'auditionOff');
  t.mock.timers.tick(1000); await flush(); assert.equal(calls.length, 4); target.noteOn({id: 'pad', midi: 12}); await flush(); assert.equal(calls[4][0], 'auditionOn');
  await action(root, 'play').fire('click'); assert.equal(calls.length, 5); panel.dispose();
});

test('Keyboard forwards unique press identity without retuning or changing chip settings', async () => {
  const {root, panel, calls, targets} = fixture(); await action(root, 'keyboard').fire('click'); const first = targets.at(-1); assert.equal(first.owner, 'okim6258-voice-panel');
  first.noteOn({id: 'a', midi: 36}); first.noteOn({id: 'b', midi: 84}); first.noteOff({id: 'a'}); await flush();
  assert.deepEqual(calls.map(([method]) => method), ['auditionOn', 'auditionOn', 'auditionOff']); assert.notEqual(calls[0][1][2], calls[1][1][2]); assert.deepEqual(calls[2], ['auditionOff', [0, calls[0][1][2]]]);
  panel.setKeyboardActive(false); await flush(); assert.deepEqual(calls[3], ['auditionOff', [0, calls[1][1][2]]]); await action(root, 'keyboard').fire('click'); const second = targets.at(-1);
  second.noteOn({id: 'b', midi: 60}); first.allNotesOff(); first.noteOff({id: 'b'}); first.noteOn({id: 'late', midi: 60}); await flush(); assert.equal(calls.length, 5);
  panel.setConnected(false); assert.equal(targets.at(-1), null); second.noteOn({id: 'disconnected', midi: 60}); await flush(); assert.equal(calls.length, 6); panel.dispose();
});

test('Cassette selector includes audio files only, preserves selection and never auto-loads', () => {
  let files = [{path: '/samples/a.wav'}, '/samples/b.flac', '/score.js', '/.tet.hidden.wav', '/samples/raw.adpcm'];
  const {root, panel, loads, reads} = fixture({listFiles: () => files}); const select = control(root, 'file');
  assert.deepEqual(select.children.map(option => option.value), ['/samples/a.wav', '/samples/b.flac']); select.value = '/samples/b.flac'; files = [...files, '/samples/c.mp3']; panel.update(snapshot());
  assert.equal(select.value, '/samples/b.flac'); assert.equal(select.children.length, 3); assert.deepEqual(loads, []); assert.deepEqual(reads, []); panel.dispose();
});

test('only explicit Load reads bytes and passes name/signal without a stale playback-rate override', async () => {
  const {root, panel, calls, loads, reads} = fixture(); await action(root, 'hold').fire('pointerdown', {pointerId: 1, button: 0}); await action(root, 'load').fire('click');
  assert.equal(calls.at(-1)[0], 'auditionOff'); assert.equal(reads.length, 1); assert.equal(reads[0][0], '/samples/snare.wav'); assert.equal(loads.length, 1); assert.deepEqual(Array.from(loads[0][0]), [1, 2, 3]);
  assert.equal(loads[0][1].name, '/samples/snare.wav'); assert(loads[0][1].signal instanceof AbortSignal); assert.equal(loads[0][1].sampleRate, undefined); assert.equal(loads[0][1].signal.aborted, false); panel.dispose();
});

test('Stop while a file read is pending cancels it before any audio is loaded', async () => {
  let resolveRead; const {root, panel, loads} = fixture({readFile: () => new Promise(resolve => {resolveRead = resolve;})});
  const loading = action(root, 'load').fire('click'); await flush(); assert.equal(walk(root).find(node => node.tagName === 'fieldset').disabled, true); panel.releaseAll(); resolveRead(new Uint8Array([1])); await loading;
  assert.deepEqual(loads, []); assert.equal(walk(root).find(node => node.tagName === 'fieldset').disabled, false); panel.dispose();
});

test('disconnecting during decode aborts loading and ignores a late old-instance completion or error', async () => {
  let rejectLoad, signal; const {root, panel, errors} = fixture({loadSample: (_bytes, options) => {signal = options.signal; return new Promise((resolve, reject) => {rejectLoad = reject;});}});
  const loading = action(root, 'load').fire('click'); await flush(); panel.setConnected(false); assert.equal(signal.aborted, true); panel.setConnected(true); panel.update(snapshot());
  rejectLoad(new Error('Old instance decode failed')); await loading; assert.deepEqual(errors, []); assert.equal(action(root, 'load').disabled, false); panel.dispose();
});

test('a delayed command failure from a retired instance is not shown in its replacement', async () => {
  let rejectCommand; const {root, panel, errors} = fixture({invoke: () => new Promise((resolve, reject) => {rejectCommand = reject;})});
  control(root, 'divider').value = '768'; const pending = control(root, 'divider').fire('change'); panel.setConnected(false); panel.setConnected(true); rejectCommand(new Error('Old chip disconnected')); await pending; assert.deepEqual(errors, []); panel.dispose();
});

test('playback JavaScript preserves actual clock/divider/pan and explains that sample data is separate', () => {
  const code = oki6258PlaybackCode(snapshot()); assert.match(code, /await adpcm\.setClock\(8000000\)/); assert.match(code, /adpcm\.setDivider\(512\)/); assert.match(code, /adpcm\.setPan\(true, false\)/); assert.match(code, /repeat: true/);
  assert.match(code, /already loaded/); assert.doesNotMatch(code, /setFrequency|setNote|setOperator|setVolume/);
});

test('waveform redraws only from supplied visible snapshots and all listeners disappear on disposal', () => {
  const {root, panel, doc, win, calls} = fixture(); let draws = 0; const canvas = control(root, 'waveform'); canvas.getContext = () => new Proxy({}, {get: (_target, key) => key === 'clearRect' ? () => {draws++;} : () => {}, set: () => true});
  panel.setVisible(true); assert.equal(draws, 1); panel.update(snapshot()); assert.equal(draws, 1);
  panel.setVisible(false); const next = snapshot(); next.positionFrames = 200; panel.update(next); assert.equal(draws, 1); panel.setVisible(true); assert.equal(draws, 2); assert.deepEqual(calls, []);
  panel.dispose(); panel.dispose(); for (const node of [...walk(root), doc, win]) assert.equal([...node.listeners.values()].reduce((sum, entries) => sum + entries.size, 0), 0);
});

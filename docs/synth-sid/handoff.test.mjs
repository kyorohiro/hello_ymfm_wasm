import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {createDefaultPreset, readPreset} from './preset.js';
import {prepareSidPresetHandoff, consumeSidPresetHandoff, stripSidPresetHandoffFragment,
  SID_PRESET_HANDOFF_TTL_MS, SID_PRESET_HANDOFF_MAX_BYTES} from './handoff.js';

const token = 'fixture_token_1234567890';
const now = 1_000_000;
function storageFixture() {
  const data = new Map(), calls = [];
  return {data, calls, getItem(key) {calls.push(['get', key]);return data.get(key) ?? null;},
    setItem(key, value) {calls.push(['set', key]);data.set(key, value);},
    removeItem(key) {calls.push(['remove', key]);data.delete(key);}};
}
function prepare(preset = createDefaultPreset(), options = {}) {
  const storage = storageFixture();
  storage.setItem('unrelated-key', 'untouched');
  const handle = prepareSidPresetHandoff(preset, {storage, now, token, ...options});
  const key = [...storage.data.keys()].find(value => value !== 'unrelated-key');
  return {storage, handle, key};
}

test('ordinary Synth visits do not read storage or accept a stored preset without an explicit token', () => {
  const storage = {getItem() {assert.fail('No storage access for an ordinary visit');}};
  for (const fragment of ['', '#', '#keyboard', '#section=filter', '#other=hello%20world']) {
    assert.equal(consumeSidPresetHandoff(fragment, {storage}), null);
  }
});

for (const model of ['6581', '8580']) test(`one-time ${model} transfer stores only a detached normalized preset and timestamp`, () => {
  const preset = createDefaultPreset({model});preset.filter = {enabled: true, mode: 'lowpass+bandpass', cutoff: 1100, resonance: 9, volume: 6};
  const expected = readPreset(preset), f = prepare(preset);
  assert.equal(f.handle.fragment, '#sid-voice=' + token);
  assert.deepEqual(Object.keys(JSON.parse(f.storage.data.get(f.key))).sort(), ['createdAt', 'format', 'preset', 'version']);
  preset.voice.attack = 15;
  const received = consumeSidPresetHandoff(f.handle.fragment, {storage: f.storage, now});
  assert.deepEqual(received, expected);assert.equal(received.model, model);
  assert.deepEqual([...f.storage.data], [['unrelated-key', 'untouched']]);
  assert.throws(() => consumeSidPresetHandoff(f.handle.fragment, {storage: f.storage, now}), /already used|unavailable/);
  f.handle.dispose();f.handle.dispose();assert.equal(f.storage.data.get('unrelated-key'), 'untouched');
});

test('legacy preset transfer migrates to v2/6581 without adding source-file data', () => {
  const legacy = createDefaultPreset();legacy.version = 1;delete legacy.model;legacy.filter.enabled = true;legacy.filter.mode = 'notch';
  const f = prepare(legacy), value = consumeSidPresetHandoff(f.handle.fragment, {storage: f.storage, now});
  assert.equal(value.version, 2);assert.equal(value.model, '6581');assert.equal(value.filter.mode, 'notch');
  assert.throws(() => prepareSidPresetHandoff({...legacy, songBytes: [1, 2, 3]}, {storage: f.storage, now, token}), /property/);
});

test('invalid and duplicate tokens never inspect or remove any storage key', () => {
  const f = prepare(), before = [...f.storage.data];f.storage.calls.length = 0;
  for (const fragment of ['#sid-voice=', '#sid-voice=short', '#sid-voice=../' + token,
    '#sid-voice=' + token + '&sid-voice=' + token, '#sid-voice=%00' + token,
    '#sid%2Dvoice=' + token + '&sid-voice=' + token]) {
    assert.throws(() => consumeSidPresetHandoff(fragment, {storage: f.storage, now}), /token/);
  }
  assert.deepEqual(f.storage.calls, []);assert.deepEqual([...f.storage.data], before);
});

test('expiry is bounded, future or invalid timestamps reject, and only the addressed entry is removed', () => {
  const boundary = prepare();
  assert(consumeSidPresetHandoff(boundary.handle.fragment, {storage: boundary.storage, now: now + SID_PRESET_HANDOFF_TTL_MS}));
  for (const createdAt of [now - SID_PRESET_HANDOFF_TTL_MS - 1, now + 1, -1, .5, '1000000', null]) {
    const f = prepare(), record = JSON.parse(f.storage.data.get(f.key));record.createdAt = createdAt;f.storage.data.set(f.key, JSON.stringify(record));
    assert.throws(() => consumeSidPresetHandoff(f.handle.fragment, {storage: f.storage, now}), /expired|timestamp/);
    assert.deepEqual([...f.storage.data], [['unrelated-key', 'untouched']]);
  }
});

test('malformed, extra-field and invalid-preset payloads are consumed without touching another pending transfer', () => {
  for (const alter of [() => '{bad', value => JSON.stringify({...value, song: 'not allowed'}), value => JSON.stringify({...value, version: 2}),
    value => JSON.stringify({...value, preset: {...value.preset, model: 'invalid'}}), () => 'null']) {
    const f = prepare();f.storage.setItem('another-transfer', 'keep');
    f.storage.data.set(f.key, alter(JSON.parse(f.storage.data.get(f.key))));
    assert.throws(() => consumeSidPresetHandoff(f.handle.fragment, {storage: f.storage, now}), /Invalid|property|model/);
    assert.deepEqual([...f.storage.data], [['unrelated-key', 'untouched'], ['another-transfer', 'keep']]);
  }
});

test('transfer size counts UTF-8 bytes and rejects oversized requested data before JSON parsing', () => {
  for (const value of ['x'.repeat(SID_PRESET_HANDOFF_MAX_BYTES + 1), 'あ'.repeat(23000)]) {
    const f = prepare();f.storage.data.set(f.key, value);
    assert.throws(() => consumeSidPresetHandoff(f.handle.fragment, {storage: f.storage, now}), /64 KiB/);
    assert.equal(f.storage.data.has(f.key), false);assert.equal(f.storage.data.get('unrelated-key'), 'untouched');
  }
});

test('denied storage produces an actionable fallback, including a throwing global storage getter', t => {
  for (const operation of ['getItem', 'setItem']) {
    const storage = storageFixture();storage[operation] = () => {throw new Error('denied');};
    assert.throws(() => prepareSidPresetHandoff(createDefaultPreset(), {storage, now, token}), /Save the preset.*Load preset/);
  }
  for (const operation of ['getItem', 'removeItem']) {
    const f = prepare();f.storage[operation] = () => {throw new Error('denied');};
    assert.throws(() => consumeSidPresetHandoff(f.handle.fragment, {storage: f.storage, now}), /Save the preset.*Load preset/);
  }
  const before = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {configurable: true, get() {throw new Error('SecurityError');}});
  t.after(() => {if (before) Object.defineProperty(globalThis, 'localStorage', before);else delete globalThis.localStorage;});
  assert.throws(() => prepareSidPresetHandoff(createDefaultPreset(), {now, token}), /Load preset/);
  assert.throws(() => consumeSidPresetHandoff('#sid-voice=' + token, {now}), /Load preset/);
  assert.equal(consumeSidPresetHandoff('#normal'), null);
});

test('tokens do not overwrite an existing transfer, and disposing cannot delete a changed entry', () => {
  const f = prepare(), before = f.storage.data.get(f.key);
  assert.throws(() => prepareSidPresetHandoff(createDefaultPreset({model: '8580'}), {storage: f.storage, now, token}), /already exists/);
  assert.equal(f.storage.data.get(f.key), before);
  f.storage.setItem(f.key, 'other owner');f.handle.dispose();assert.equal(f.storage.data.get(f.key), 'other owner');
  const removable = prepare();removable.handle.dispose();assert.deepEqual([...removable.storage.data], [['unrelated-key', 'untouched']]);
  for (const invalid of ['', '../bad', {toString: () => token}]) assert.throws(() => prepareSidPresetHandoff(createDefaultPreset(), {storage: f.storage, now, token: invalid}), /token/);
});

test('fragment cleanup preserves unrelated components and encoding exactly', () => {
  assert.equal(stripSidPresetHandoffFragment('#sid-voice=' + token), '');
  assert.equal(stripSidPresetHandoffFragment('#section=hello%20world&sid-voice=' + token + '&other=x%2Fy'), '#section=hello%20world&other=x%2Fy');
  assert.equal(stripSidPresetHandoffFragment('#section&&sid%2Dvoice=' + token + '&x=1+2'), '#section&&x=1+2');
  assert.equal(stripSidPresetHandoffFragment('#keyboard'), '#keyboard');
});

const source = await readFile(new URL('./synth.js', import.meta.url), 'utf8');
const receiver = source.match(/function receivePlayerSnapshot\(\)\{[\s\S]*?\n\}\nrenderKeyboard/)[0].replace(/\nrenderKeyboard$/, '');
function receiverFixture(fragment, storage, {historyFails = false} = {}) {
  const applied = [], statuses = [], history = [], context = vm.createContext({
    window: {location: {hash: fragment, pathname: '/synth-sid/index.html', search: '?view=keyboard'}, history: {state: {preserve: true}, replaceState(...args) {if (historyFails) throw new Error('unavailable');history.push(args);}}},
    URLSearchParams, consumeSidPresetHandoff: value => consumeSidPresetHandoff(value, {storage, now}), stripSidPresetHandoffFragment,
    applyPreset(value, options) {applied.push({preset: readPreset(value), options});return Promise.resolve();},
    status(...args) {statuses.push(args);}, report() {assert.fail('No asynchronous audio or preset failure');},
    ensureAudio() {assert.fail('A received preset cannot start audio');}, createAudio() {assert.fail('A received preset cannot allocate audio');},
  });
  vm.runInContext(receiver + '\nreceivePlayerSnapshot();', context);
  return {applied, statuses, history};
}

test('Synth startup receives only the requested preset, starts no audio and clears only its URL token', () => {
  const f = prepare(createDefaultPreset({model: '8580'}));
  const receiver = receiverFixture('#section=hello%20world&sid-voice=' + token + '&x=1', f.storage);
  assert.equal(receiver.applied.length, 1);assert.equal(receiver.applied[0].preset.model, '8580');assert.equal(receiver.applied[0].options.load, true);
  assert.match(receiver.applied[0].options.message, /snapshot loaded.*enable audio/);
  assert.equal(receiver.history.length, 1);assert.equal(receiver.history[0][2], '/synth-sid/index.html?view=keyboard#section=hello%20world&x=1');
  assert.equal(f.storage.data.has(f.key), false);assert.equal(f.storage.data.get('unrelated-key'), 'untouched');
  assert.equal(receiverFixture('#ordinary', f.storage).applied.length, 0);
});

test('missing or rejected handoffs retain the current Synth preset and URL, while history failure does not undo a valid import', () => {
  const invalid = prepare();invalid.storage.data.set(invalid.key, '{bad');
  const rejected = receiverFixture(invalid.handle.fragment, invalid.storage);
  assert.equal(rejected.applied.length, 0);assert.equal(rejected.history.length, 0);assert.match(rejected.statuses[0][0], /import failed.*Current preset kept/);assert.equal(rejected.statuses[0][1], true);
  const fresh = prepare(), accepted = receiverFixture(fresh.handle.fragment, fresh.storage, {historyFails: true});
  assert.equal(accepted.applied.length, 1);assert.equal(accepted.history.length, 0);assert.match(accepted.statuses[0][0], /snapshot loaded.*URL token/);
});

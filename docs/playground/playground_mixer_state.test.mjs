import test from 'node:test';
import assert from 'node:assert/strict';
import {SoundChipMixer} from '../../web/soundchip_mixer.js';
import {createVirtualFileSystem} from './playground_virtual_files.js';
import {createPlaygroundCassetteZip, loadPlaygroundCassette} from './playground_cassette.js';
import {
  createPlaygroundMixerState, MIXER_STATE_PATH, MIXER_DEFAULT_PRESET_PATH,
  MIXER_SYSTEM_PRESET_PATH, MIXER_DEFAULT_PRESET_JSON,
} from './playground_mixer_state.js';

const record = (id, settings, name = 'segapsg') => ({id, name, settings});
const preset = (entries = [], kinds = undefined) => ({version:1, ...(kinds ? {kinds} : {}), entries});
const file = (path, value) => ({path, data:typeof value === 'string' ? value : JSON.stringify(value)});
const current = f => JSON.parse(f.files.get(MIXER_STATE_PATH).data);
const mix = (volume = 1, pan = 0, muted = false, solo = false) => ({volume, pan, muted, solo});

function fixture({mixer = new SoundChipMixer(), files = createVirtualFileSystem([]), forbidList = false,legacyPrimaryTrims={}} = {}) {
  const timers = new Map(), delays = [], errors = [], writes = [];
  let sequence = 0;
  const stateFiles = forbidList ? {...files, list() {throw new Error('Mixer must not clone the asset list');}} : files;
  const state = createPlaygroundMixerState({mixer, files:stateFiles,legacyPrimaryTrims,
    setTimer(callback, delay) {delays.push(delay); timers.set(++sequence, callback); return sequence;},
    clearTimer(id) {timers.delete(id);},
    onWrite(path, change) {writes.push({path, ...change});},
    onError(error) {errors.push(error.message);},
  });
  return {state, mixer, files, timers, delays, errors, writes,
    runTimers() {for (const [id, callback] of [...timers]) {timers.delete(id); callback();}},
  };
}

test('authored changes coalesce for 250 ms and snapshot flush captures the latest mix', t => {
  const f = fixture(); t.after(() => f.state.dispose());
  f.mixer.register('lead', 'segapsg', () => {});
  for (let i = 1; i <= 10; i++) f.mixer.set('lead', {volume:i / 10});
  assert.equal(f.timers.size, 1); assert.equal(f.writes.length, 0);
  assert(f.delays.every(delay => delay === 250));
  f.runTimers();
  assert.deepEqual(current(f), preset([record('lead', {volume:1})]));
  assert.deepEqual(f.writes, [{path:MIXER_STATE_PATH, created:true, removed:false}]);
  f.mixer.set('lead', {volume:.35, pan:-.2});
  assert.equal(f.state.flush(), true); const snapshot = f.files.snapshot();
  assert.equal(f.timers.size, 0);
  assert.deepEqual(JSON.parse(snapshot.files.find(entry => entry.path === MIXER_STATE_PATH).data),
    preset([record('lead', {volume:.35, pan:-.2})]));
  assert.deepEqual(f.writes.at(-1), {path:MIXER_STATE_PATH, created:false, removed:false});
});

test('default.json loads initially but editing it waits until the preset is selected', t => {
  assert.deepEqual(JSON.parse(MIXER_DEFAULT_PRESET_JSON), preset());
  const files = createVirtualFileSystem([file(MIXER_DEFAULT_PRESET_PATH,
    preset([record('lead', {volume:.6})], [{name:'segapsg', pan:.2}]))]);
  const f = fixture({files}); t.after(() => f.state.dispose());
  f.mixer.register('lead', 'segapsg', () => {});
  assert.deepEqual(f.mixer.get('lead'), mix(.6, .2));
  assert.equal(files.has(MIXER_STATE_PATH), false);
  files.writeText(MIXER_DEFAULT_PRESET_PATH, JSON.stringify(preset([record('lead', {volume:.25, muted:true})])));
  assert.deepEqual(f.mixer.get('lead'), mix(.6, .2), 'editing a preset must not change the playing mix');
  f.state.selectPreset(MIXER_DEFAULT_PRESET_PATH);
  assert.deepEqual(f.mixer.get('lead'), mix(.25, 0, true));
  assert.deepEqual(f.mixer.exportDefaults(), {version:1, kinds:[]});
  f.runTimers(); f.state.flush();
  assert.equal(files.has(MIXER_STATE_PATH), false, 'selecting default.json must not create current.json');
  assert.deepEqual(f.writes, []);
});

test('selecting a named preset replaces kinds and all ID settings in one mixer notification', t => {
  const f = fixture(); t.after(() => f.state.dispose());
  f.mixer.register('lead', 'segapsg', () => {});
  f.mixer.register('other', 'segapsg', () => {});
  f.mixer.configureDefaults({version:1, kinds:[{name:'segapsg', volume:.9, pan:-.4}]});
  f.mixer.set('lead', {volume:.2, pan:.5, muted:true, solo:true});
  f.mixer.set('other', {muted:true});
  const authored = preset([record('lead', {volume:.2, pan:.5, muted:true, solo:true}), record('other', {muted:true})],
    [{name:'segapsg', volume:.9, pan:-.4}]);
  const selected = preset([record('lead', {volume:.7, muted:false, solo:false})], [{name:'segapsg', pan:.3}]);
  f.files.writeText('/mixer/stage.json', JSON.stringify(selected));
  assert.deepEqual(f.mixer.get('lead'), mix(.2, .5, true, true));
  const notifications = []; const release = f.mixer.subscribe(() => notifications.push(f.mixer.get('lead')));
  f.state.selectPreset('/mixer/stage.json'); release();
  assert.deepEqual(notifications, [mix(.7, .3)]);
  assert.deepEqual(f.mixer.get('other'), mix(1, .3));
  assert.deepEqual(current(f), authored, 'pending edits are saved before auditioning another preset');
  const savedText = f.files.get(MIXER_STATE_PATH).data;
  f.files.writeText('/mixer/without-kinds.json', JSON.stringify(preset([record('lead', {pan:-.1})])));
  f.state.selectPreset('/mixer/without-kinds.json');
  assert.deepEqual(f.mixer.exportDefaults(), {version:1, kinds:[]});
  assert.deepEqual(f.mixer.get('lead'), mix(1, -.1));
  assert.deepEqual(f.mixer.get('other'), mix());
  f.runTimers(); f.state.flush();
  assert.equal(f.files.get(MIXER_STATE_PATH).data, savedText, 'auditioning another preset must preserve current bytes');
  assert.equal(f.timers.size, 0);
});

test('invalid presets leave both ID settings and kind policy untouched atomically', t => {
  const f = fixture(); t.after(() => f.state.dispose());
  f.mixer.register('lead', 'segapsg', () => {});
  f.mixer.configureDefaults({version:1, kinds:[{name:'segapsg', volume:.8}]});
  f.mixer.set('lead', {pan:.4, muted:true}); f.state.flush();
  const before = {defaults:f.mixer.exportDefaults(), state:f.mixer.exportState(), text:f.files.get(MIXER_STATE_PATH).data};
  const invalid = [
    preset([record('lead', {volume:3})], [{name:'segapsg', volume:.2}]),
    preset([record('lead', {volume:.2})], [{name:'segapsg', pan:4}]),
    {version:1, kinds:null, entries:[]},
    {version:1, entries:[], unexpected:true},
    'not JSON',
  ];
  for (const value of invalid) {
    f.files.writeText('/mixer/bad.json', typeof value === 'string' ? value : JSON.stringify(value));
    assert.throws(() => f.state.selectPreset('/mixer/bad.json'));
    assert.deepEqual(f.mixer.exportDefaults(), before.defaults);
    assert.deepEqual(f.mixer.exportState(), before.state);
    assert.equal(f.files.get(MIXER_STATE_PATH).data, before.text);
  }
  assert.throws(() => f.state.selectPreset('/index.js'), /mixer\//);
});

test('invalid selection does not flush or discard pending real Mixer edits', t => {
  const f = fixture(); t.after(() => f.state.dispose());
  f.mixer.register('lead', 'segapsg', () => {});
  f.mixer.set('lead', {volume:.4}); f.state.flush();
  const savedText = f.files.get(MIXER_STATE_PATH).data, writes = f.writes.length;
  f.mixer.set('lead', {volume:.7, pan:.2});
  f.files.writeText('/mixer/bad.json', '{ invalid');
  assert.throws(() => f.state.selectPreset('/mixer/bad.json'));
  assert.equal(f.files.get(MIXER_STATE_PATH).data, savedText);
  assert.equal(f.writes.length, writes);
  assert.equal(f.timers.size, 1, 'the original debounce must remain pending');
  assert.deepEqual(f.mixer.get('lead'), mix(.7, .2));
  f.runTimers();
  assert.deepEqual(current(f), preset([record('lead', {volume:.7, pan:.2})]));
});

test('auditioning presets never creates current.json, including later connection, flush, and disposal', () => {
  const files = createVirtualFileSystem([
    file(MIXER_DEFAULT_PRESET_PATH, preset([record('lead', {volume:.3})])),
    file('/mixer/stage.json', preset([record('lead', {volume:.7, muted:true})], [{name:'segapsg', pan:-.2}])),
  ]);
  const f = fixture({files});
  for (const path of ['/mixer/stage.json', MIXER_SYSTEM_PRESET_PATH, MIXER_DEFAULT_PRESET_PATH]) {
    f.state.selectPreset(path); f.runTimers();
    assert.equal(f.state.flush(), true);
    assert.equal(files.has(MIXER_STATE_PATH), false);
    assert.equal(f.timers.size, 0);
  }
  const release = f.mixer.register('lead', 'segapsg', () => {});
  assert.deepEqual(f.mixer.get('lead'), mix(.3));
  release(); f.runTimers(); f.state.dispose();
  assert.equal(files.has(MIXER_STATE_PATH), false);
  assert.deepEqual(f.writes, []);
});

test('binding a preset entry without a chip name to a live source is not a Mixer edit', t => {
  const savedText = ' '+JSON.stringify(preset([{id:'lead', settings:{volume:.2}}]))+'\n';
  const files = createVirtualFileSystem([
    file(MIXER_STATE_PATH, savedText),
    file('/mixer/stage.json', preset([{id:'lead', settings:{volume:.7}}])),
  ]);
  const f = fixture({files}); t.after(() => f.state.dispose());
  const release = f.mixer.register('lead', 'segapsg', () => {});
  assert.equal(f.mixer.get('lead').volume, .2);
  release(); f.runTimers(); f.state.flush();
  assert.equal(files.get(MIXER_STATE_PATH).data, savedText);
  f.state.selectPreset('/mixer/stage.json');
  const reconnect = f.mixer.register('lead', 'segapsg', () => {});
  assert.equal(f.mixer.get('lead').volume, .7);
  f.runTimers(); f.state.flush();
  assert.equal(files.get(MIXER_STATE_PATH).data, savedText);
  assert.deepEqual(f.writes, []);
  f.mixer.set('lead', {pan:.3}); f.runTimers();
  assert.deepEqual(current(f), preset([record('lead', {volume:.7, pan:.3})]));
  reconnect();
});

test('an actual edit after auditioning saves the selected live mix without changing its preset', t => {
  const saved = preset([record('lead', {volume:.2})]);
  const stage = preset([record('lead', {volume:.7, muted:true})], [{name:'segapsg', pan:.3}]);
  const files = createVirtualFileSystem([file(MIXER_STATE_PATH, saved), file('/mixer/stage.json', stage)]);
  const f = fixture({files}); t.after(() => f.state.dispose());
  f.mixer.register('lead', 'segapsg', () => {});
  const savedText = files.get(MIXER_STATE_PATH).data, stageText = files.get('/mixer/stage.json').data;
  f.state.selectPreset('/mixer/stage.json');
  assert.deepEqual(f.mixer.get('lead'), mix(.7, .3, true));
  assert.equal(files.get(MIXER_STATE_PATH).data, savedText);
  f.mixer.set('lead', {pan:-.4});
  assert.equal(files.get(MIXER_STATE_PATH).data, savedText, 'the normal debounce still applies');
  f.runTimers();
  assert.deepEqual(current(f), preset([record('lead', {volume:.7, pan:-.4, muted:true})], [{name:'segapsg', pan:.3}]));
  assert.equal(files.get('/mixer/stage.json').data, stageText);
});

test('selecting System clears the live policy while preserving the last authored current mix', t => {
  const f = fixture(); t.after(() => f.state.dispose());
  f.mixer.register('lead', 'segapsg', () => {});
  f.mixer.configureDefaults({version:1, kinds:[{name:'segapsg', volume:.2, pan:.3}]});
  f.mixer.set('lead', {volume:.7, muted:true, solo:true});
  f.state.flush();
  const savedText = f.files.get(MIXER_STATE_PATH).data, writes = f.writes.length;
  f.state.selectPreset(MIXER_SYSTEM_PRESET_PATH);
  assert.deepEqual(f.mixer.get('lead'), mix());
  assert.deepEqual(f.mixer.exportDefaults(), {version:1, kinds:[]});
  assert.deepEqual(f.mixer.exportState(), preset());
  f.runTimers(); f.state.flush();
  assert.equal(f.files.get(MIXER_STATE_PATH).data, savedText);
  assert.equal(f.writes.length, writes);
  assert.equal(f.timers.size, 0);
  f.state.selectPreset(MIXER_STATE_PATH);
  assert.deepEqual(f.mixer.get('lead'), mix(.7, .3, true, true), 'current restores the earlier authored mix');
});

test('selecting current.json flushes pending slider edits before reading the preset', t => {
  const f = fixture(); t.after(() => f.state.dispose());
  f.mixer.register('lead', 'segapsg', () => {});
  f.mixer.set('lead', {volume:.3}); f.state.flush();
  f.mixer.set('lead', {volume:.8, solo:true});
  f.state.selectPreset(MIXER_STATE_PATH);
  assert.deepEqual(f.mixer.get('lead'), mix(.8, 0, false, true));
  assert.deepEqual(current(f), preset([record('lead', {volume:.8, solo:true})]));
  assert.equal(f.timers.size, 0);
});

test('Set default saves the latest full mix without applying policy or notifying audio outputs', t => {
  const f = fixture(); t.after(() => f.state.dispose());
  f.mixer.register('lead', 'segapsg', () => {});
  f.mixer.register('bass', 'segapsg', () => {});
  f.mixer.configureDefaults({version:1, kinds:[{name:'segapsg', volume:.6, pan:-.2}]});
  f.mixer.set('lead', {volume:.35, muted:true, solo:true});
  f.mixer.set('bass', {pan:.4});
  assert.equal(f.timers.size, 1);
  const expected = preset([record('bass', {pan:.4}), record('lead', {volume:.35, muted:true, solo:true})],
    [{name:'segapsg', volume:.6, pan:-.2}]);
  const before = {lead:f.mixer.get('lead'), bass:f.mixer.get('bass'),
    defaults:f.mixer.exportDefaults(), state:f.mixer.exportState()};
  const notifications = []; const release = f.mixer.subscribe(() => notifications.push('audio'));
  f.state.saveDefault(); release();
  assert.equal(f.timers.size, 0, 'pending current changes must be flushed before saving a preset');
  assert.deepEqual(current(f), expected);
  assert.deepEqual(JSON.parse(f.files.get(MIXER_DEFAULT_PRESET_PATH).data), expected);
  assert.deepEqual(f.writes.map(entry => entry.path), [MIXER_STATE_PATH, MIXER_DEFAULT_PRESET_PATH]);
  assert.deepEqual(notifications, [], 'saving must not reset or otherwise reapply the mix');
  assert.deepEqual({lead:f.mixer.get('lead'), bass:f.mixer.get('bass'),
    defaults:f.mixer.exportDefaults(), state:f.mixer.exportState()}, before);
  f.mixer.set('lead', {volume:.8}); f.runTimers();
  assert.equal(current(f).entries.find(entry => entry.id === 'lead').settings.volume, .8);
  assert.equal(JSON.parse(f.files.get(MIXER_DEFAULT_PRESET_PATH).data).entries
    .find(entry => entry.id === 'lead').settings.volume, .35, 'later edits only change current.json');
  f.state.saveDefault();
  assert.equal(JSON.parse(f.files.get(MIXER_DEFAULT_PRESET_PATH).data).entries
    .find(entry => entry.id === 'lead').settings.volume, .8, 'Set default explicitly replaces the previous preset');
});

test('Set default and Save snapshot the auditioned mix without modifying current.json', t => {
  const saved = preset([record('lead', {volume:.2})]);
  const selected = preset([record('lead', {volume:.75, solo:true})], [{name:'segapsg', pan:.3}]);
  for (const currentText of [null, '  '+JSON.stringify(saved)+'\n\n']) {
    const files = createVirtualFileSystem([
      ...(currentText === null ? [] : [file(MIXER_STATE_PATH, currentText)]),
      file('/mixer/stage.json', selected),
    ]);
    const f = fixture({files}); t.after(() => f.state.dispose());
    f.mixer.register('lead', 'segapsg', () => {});
    f.state.selectPreset('/mixer/stage.json');
    f.state.saveDefault(); const path = f.state.savePreset('Auditioned mix');
    assert.deepEqual(JSON.parse(files.get(MIXER_DEFAULT_PRESET_PATH).data), selected);
    assert.deepEqual(JSON.parse(files.get(path).data), selected);
    f.runTimers(); f.state.flush();
    assert.equal(files.get(MIXER_STATE_PATH)?.data ?? null, currentText);
    assert.deepEqual(f.writes.map(entry => entry.path), [MIXER_DEFAULT_PRESET_PATH, path]);
    if (currentText !== null) {
      f.state.selectPreset(MIXER_STATE_PATH);
      assert.deepEqual(f.mixer.get('lead'), mix(.2));
    }
  }
});

test('Save names a latest snapshot without changing the live mix or replacing defaults', t => {
  const defaultsText = ' '+JSON.stringify(preset([record('lead', {volume:.9})]))+'\n';
  const f = fixture({files:createVirtualFileSystem([file(MIXER_DEFAULT_PRESET_PATH, defaultsText)])});
  t.after(() => f.state.dispose());
  f.mixer.register('lead', 'segapsg', () => {});
  f.mixer.configureDefaults({version:1, kinds:[{name:'segapsg', pan:.3}]});
  f.mixer.set('lead', {volume:.45, muted:true});
  const before = f.mixer.get('lead'), notifications = [];
  const release = f.mixer.subscribe(() => notifications.push('audio'));
  const path = f.state.savePreset('  Stage mix.json  '); release();
  assert.equal(path, '/mixer/Stage mix.json');
  assert.equal(f.timers.size, 0);
  assert.deepEqual(JSON.parse(f.files.get(path).data), current(f));
  assert.deepEqual(current(f), preset([record('lead', {volume:.45, muted:true})], [{name:'segapsg', pan:.3}]));
  assert.deepEqual(f.mixer.get('lead'), before); assert.deepEqual(notifications, []);
  assert.equal(f.files.get(MIXER_DEFAULT_PRESET_PATH).data, defaultsText);
  assert.equal(f.state.savePreset('Without extension'), '/mixer/Without extension.json');
  assert.equal(f.state.savePreset('a'.repeat(115)+'.json'), '/mixer/'+'a'.repeat(115)+'.json');
  assert(f.state.listPresets().some(entry => entry.path === path));
  f.mixer.set('lead', {volume:.2}); f.runTimers();
  assert.equal(JSON.parse(f.files.get(path).data).entries[0].settings.volume, .45);
  f.state.selectPreset(path); assert.equal(f.mixer.get('lead').volume, .45);
});

test('Save rejects unsafe, reserved, overlong, or occupied names without overwriting files', t => {
  const f = fixture(); t.after(() => f.state.dispose());
  f.mixer.register('lead', 'segapsg', () => {}); f.mixer.set('lead', {volume:.4}); f.state.flush();
  f.files.writeText('/mixer/stage.json', 'original bytes');
  f.files.mkdir('/mixer/folder.json');
  const before = f.files.snapshot(), beforeMix = f.mixer.get('lead');
  const invalid = ['', '   ', '.json', '.', '..', '../escape', 'one/two', 'one\\two',
    'control\u0000name', 'line\nname', 'delete\u007fname', 'current', 'current.json', 'default', 'default.json',
    'a'.repeat(121), 'a'.repeat(121)+'.json', 'stage', 'folder.json'];
  for (const name of invalid) {
    assert.throws(() => f.state.savePreset(name), undefined, `invalid name ${JSON.stringify(name)} must fail`);
    assert.deepEqual(f.files.snapshot(), before, `invalid name ${JSON.stringify(name)} must preserve files`);
    assert.deepEqual(f.mixer.get('lead'), beforeMix);
  }
});

test('saving presets never creates or updates the read-only System preset', t => {
  const f = fixture(); t.after(() => f.state.dispose());
  f.mixer.register('lead', 'segapsg', () => {});
  f.files.writeText('/mixer/stage.json', JSON.stringify(preset([record('lead', {volume:.2})])));
  const stageText = f.files.get('/mixer/stage.json').data;
  f.state.selectPreset('/mixer/stage.json');
  f.state.selectPreset(MIXER_SYSTEM_PRESET_PATH);
  f.mixer.set('lead', {volume:.5, pan:-.3}); f.state.flush();
  assert.deepEqual(current(f), preset([record('lead', {volume:.5, pan:-.3})]));
  assert.equal(f.files.has(MIXER_SYSTEM_PRESET_PATH), false);
  assert.equal(f.files.get('/mixer/stage.json').data, stageText);
  assert.equal(f.files.has(MIXER_DEFAULT_PRESET_PATH), false);
  f.state.saveDefault(); f.state.savePreset('New mix');
  assert.equal(f.files.has(MIXER_SYSTEM_PRESET_PATH), false);
  assert.equal(f.files.get('/mixer/stage.json').data, stageText);
});

test('Set default and Save reject blocked current.json without claiming success or replacing presets', t => {
  const defaultsText = JSON.stringify(preset([record('lead', {volume:.4})]));
  const f = fixture({files:createVirtualFileSystem([file(MIXER_DEFAULT_PRESET_PATH, defaultsText)])});
  t.after(() => f.state.dispose());
  f.mixer.register('lead', 'segapsg', () => {}); f.mixer.set('lead', {volume:.6}); f.state.flush();
  f.files.writeText(MIXER_STATE_PATH, '{ broken');
  assert.throws(() => f.state.saveDefault(), undefined, 'a blocked file is protected even without pending changes');
  assert.throws(() => f.state.savePreset('No pending changes'));
  f.mixer.set('lead', {volume:.8});
  assert.throws(() => f.state.saveDefault());
  assert.throws(() => f.state.savePreset('Should not exist'));
  assert.equal(f.files.get(MIXER_STATE_PATH).data, '{ broken');
  assert.equal(f.files.get(MIXER_DEFAULT_PRESET_PATH).data, defaultsText);
  assert.equal(f.files.has('/mixer/No pending changes.json'), false);
  assert.equal(f.files.has('/mixer/Should not exist.json'), false);
  assert.equal(f.mixer.get('lead').volume, .8);
});

test('preset write failures preserve existing presets and report failure after current has been flushed', t => {
  const defaultsText = JSON.stringify(preset([record('lead', {volume:.4})]));
  const files = createVirtualFileSystem([file(MIXER_DEFAULT_PRESET_PATH, defaultsText)]);
  const f = fixture({files:{...files, writeText(path, text) {
    if (path !== MIXER_STATE_PATH) throw new Error('Preset write denied');
    files.writeText(path, text);
  }}});
  t.after(() => f.state.dispose());
  f.mixer.register('lead', 'segapsg', () => {}); f.mixer.set('lead', {volume:.7});
  assert.throws(() => f.state.saveDefault(), /Preset write denied/);
  assert.deepEqual(current(f), preset([record('lead', {volume:.7})]));
  assert.equal(files.get(MIXER_DEFAULT_PRESET_PATH).data, defaultsText);
  assert.throws(() => f.state.savePreset('New preset'), /Preset write denied/);
  assert.equal(files.has('/mixer/New preset.json'), false);
  assert.equal(f.mixer.get('lead').volume, .7);
  assert.deepEqual(f.writes.map(entry => entry.path), [MIXER_STATE_PATH], 'failed preset writes must not notify success');
});

test('preset options notify only on membership changes without cloning binary asset lists', t => {
  const files = createVirtualFileSystem([file(MIXER_DEFAULT_PRESET_PATH, MIXER_DEFAULT_PRESET_JSON),
    {path:'/samples/large.wav', data:new Uint8Array(1024)}]);
  const f = fixture({files, forbidList:true}); t.after(() => f.state.dispose());
  assert.deepEqual(f.state.listPresets().map(item => item.path), [MIXER_SYSTEM_PRESET_PATH, MIXER_DEFAULT_PRESET_PATH]);
  let changes = 0; const release = f.state.subscribePresets(change => {if (!change?.source) changes++;});
  files.writeText('/mixer/stage.json', JSON.stringify(preset())); assert.equal(changes, 1);
  files.writeText('/mixer/stage.json', JSON.stringify(preset([record('lead', {volume:.4})]))); assert.equal(changes, 1);
  files.writeText('/index.js', '// Code edit'); assert.equal(changes, 1);
  files.writeText('/mixer/notes.txt', 'notes'); assert.equal(changes, 1);
  files.mkdir('/mixer/folder.json'); assert.equal(changes, 1, 'directories are not selectable presets');
  const copy = f.state.listPresets(); copy[0].path = '/bad'; copy.pop();
  assert.equal(f.state.listPresets()[0].path, MIXER_SYSTEM_PRESET_PATH);
  files.delete('/mixer/stage.json'); assert.equal(changes, 2);
  f.mixer.register('lead', 'segapsg', () => {}); f.mixer.set('lead', {volume:.6}); f.state.flush();
  assert.equal(changes, 3, 'the first current.json save adds one option');
  f.mixer.set('lead', {volume:.7}); f.state.flush(); assert.equal(changes, 3);
  assert.deepEqual(f.errors, []); release();
  files.writeText('/mixer/after-unsubscribe.json', JSON.stringify(preset())); assert.equal(changes, 3);
});

test('malformed current JSON survives preset selection and remains protected until manually corrected', t => {
  const f = fixture(); t.after(() => f.state.dispose());
  f.mixer.register('lead', 'segapsg', () => {}); f.mixer.set('lead', {volume:.4}); f.state.flush();
  f.files.writeText(MIXER_STATE_PATH, '{ invalid');
  assert.equal(f.mixer.get('lead').volume, .4);
  f.mixer.set('lead', {volume:.8}); assert.equal(f.state.flush(), false);
  assert.equal(f.files.get(MIXER_STATE_PATH).data, '{ invalid');
  assert(f.errors.some(error => error.includes('fix the file')));
  f.files.writeText(MIXER_STATE_PATH, JSON.stringify(preset([record('lead', {volume:.5})])));
  assert.equal(f.mixer.get('lead').volume, .5);
  f.files.writeText(MIXER_STATE_PATH, 'still broken');
  f.state.selectPreset(MIXER_SYSTEM_PRESET_PATH);
  assert.deepEqual(f.mixer.get('lead'), mix());
  f.runTimers(); assert.equal(f.state.flush(), true);
  assert.equal(f.files.get(MIXER_STATE_PATH).data, 'still broken');
  f.mixer.set('lead', {volume:.2});
  assert.equal(f.state.flush(), false, 'selecting System must not authorize overwriting a broken current file');
  assert.equal(f.files.get(MIXER_STATE_PATH).data, 'still broken');
  f.files.writeText(MIXER_STATE_PATH, JSON.stringify(preset([record('lead', {volume:.6})])));
  assert.equal(f.mixer.get('lead').volume, .6);
  f.mixer.set('lead', {volume:.7}); f.runTimers();
  assert.deepEqual(current(f), preset([record('lead', {volume:.7})]));
});

test('binary current files and directories allow preset auditioning but cannot be overwritten', t => {
  const files = createVirtualFileSystem([{path:MIXER_STATE_PATH, data:new Uint8Array([1, 2, 3])}]);
  const f = fixture({files}); t.after(() => f.state.dispose());
  f.mixer.register('lead', 'segapsg', () => {});
  assert.deepEqual(files.get(MIXER_STATE_PATH).data, new Uint8Array([1, 2, 3]));
  f.state.selectPreset(MIXER_SYSTEM_PRESET_PATH);
  assert.deepEqual(f.mixer.get('lead'), mix());
  f.runTimers(); assert.equal(f.state.flush(), true);
  assert.deepEqual(files.get(MIXER_STATE_PATH).data, new Uint8Array([1, 2, 3]));
  f.mixer.set('lead', {volume:.2}); assert.equal(f.state.flush(), false);
  assert.throws(() => f.state.selectPreset(MIXER_SYSTEM_PRESET_PATH), /edits could not be saved/);
  assert.equal(f.mixer.get('lead').volume, .2, 'unsaved edits must not be silently discarded');
  assert.deepEqual(files.get(MIXER_STATE_PATH).data, new Uint8Array([1, 2, 3]));
  f.state.replaceProject(() => files.replace([], [MIXER_STATE_PATH]));
  f.state.selectPreset(MIXER_SYSTEM_PRESET_PATH);
  assert.deepEqual(f.mixer.get('lead'), mix());
  assert.equal(files.has(MIXER_STATE_PATH), false);
  assert(files.listDirectories().includes(MIXER_STATE_PATH));
  f.mixer.set('lead', {volume:.5}); assert.equal(f.state.flush(), false);
  assert.throws(() => f.state.selectPreset(MIXER_SYSTEM_PRESET_PATH), /edits could not be saved/);
  assert.equal(f.mixer.get('lead').volume, .5);
  assert(files.listDirectories().includes(MIXER_STATE_PATH));
});

test('legacy state.json stays a read-only fallback until an actual edit creates current.json', t => {
  const legacy = '  '+JSON.stringify(preset([record('lead', {volume:.35})]))+'\n\n';
  const files = createVirtualFileSystem([file('/mixer/state.json', legacy),
    file(MIXER_DEFAULT_PRESET_PATH, preset([record('lead', {volume:.9})]))]);
  const f = fixture({files}); t.after(() => f.state.dispose());
  f.mixer.register('lead', 'segapsg', () => {});
  assert.equal(f.mixer.get('lead').volume, .35); assert.equal(f.timers.size, 0);
  f.runTimers(); assert.equal(files.get('/mixer/state.json').data, legacy);
  assert.equal(files.has(MIXER_STATE_PATH), false);
  assert.deepEqual(f.writes, []);
  f.mixer.set('lead', {pan:.2}); f.runTimers();
  assert.deepEqual(current(f), preset([record('lead', {volume:.35, pan:.2})]));
  assert.equal(files.get('/mixer/state.json').data, legacy);
  files.writeText('/mixer/state.json', JSON.stringify(preset([record('lead', {volume:.1})])));
  assert.equal(f.mixer.get('lead').volume, .35, 'migrated legacy data no longer drives the mix');
});

test('an occupied current.json prevents legacy fallback even when current is invalid', t => {
  const files = createVirtualFileSystem([file('/mixer/state.json', preset([record('lead', {volume:.2})])),
    file(MIXER_STATE_PATH, 'broken current')]);
  const f = fixture({files}); t.after(() => f.state.dispose());
  f.mixer.register('lead', 'segapsg', () => {});
  assert.deepEqual(f.mixer.get('lead'), mix()); assert.equal(f.timers.size, 0);
  assert.equal(files.get(MIXER_STATE_PATH).data, 'broken current'); assert(f.errors.length > 0);
});

test('project replacement cancels dirty timers and invalid incoming state cannot retain old mix', t => {
  const f = fixture(); t.after(() => f.state.dispose());
  f.mixer.register('lead', 'segapsg', () => {}); f.mixer.set('lead', {volume:.2});
  f.state.replaceProject(() => f.files.replace([file(MIXER_DEFAULT_PRESET_PATH, preset([record('lead', {volume:.6})]))]));
  f.runTimers(); assert.equal(f.timers.size, 0); assert.equal(f.mixer.get('lead').volume, .6);
  assert.equal(f.files.has(MIXER_STATE_PATH), false);
  f.mixer.set('lead', {volume:.3});
  f.state.replaceProject(() => f.files.replace([file(MIXER_STATE_PATH, 'invalid incoming')]));
  f.runTimers(); assert.equal(f.timers.size, 0); assert.deepEqual(f.mixer.get('lead'), mix());
  assert.equal(f.files.get(MIXER_STATE_PATH).data, 'invalid incoming');
});

test('failed project replacement preserves pending mix and its delayed save', t => {
  const f = fixture(); t.after(() => f.state.dispose());
  f.mixer.register('lead', 'segapsg', () => {}); f.mixer.set('lead', {volume:.2});
  assert.throws(() => f.state.replaceProject(() => {throw new Error('Invalid project');}), /Invalid project/);
  assert.equal(f.mixer.get('lead').volume, .2); assert.equal(f.timers.size, 1);
  f.runTimers(); assert.deepEqual(current(f), preset([record('lead', {volume:.2})]));
});

test('Cassette round-trip preserves editable default/current JSON without external storage', async t => {
  const defaultsText = ' '+JSON.stringify(preset([record('lead', {volume:.25})], [{name:'segapsg', pan:-.2}]))+'\n';
  const files = createVirtualFileSystem([file(MIXER_DEFAULT_PRESET_PATH, defaultsText), file('/index.js', '// Cassette')]);
  const f = fixture({files}); t.after(() => f.state.dispose());
  const release = f.mixer.register('lead', 'segapsg', () => {});
  f.mixer.set('lead', {volume:.7, muted:true, solo:true}); f.state.flush(); release();
  const currentText = files.get(MIXER_STATE_PATH).data;
  const cassette = await loadPlaygroundCassette(createPlaygroundCassetteZip(files.list()));
  const restoredFiles = createVirtualFileSystem([...cassette.files]
    .filter(([path]) => path === 'mixer/default.json' || path === 'mixer/current.json')
    .map(([path, data]) => ({path, data:new TextDecoder().decode(data)})));
  const restored = fixture({files:restoredFiles}); t.after(() => restored.state.dispose());
  assert.equal(restoredFiles.get(MIXER_DEFAULT_PRESET_PATH).data, defaultsText);
  assert.equal(restoredFiles.get(MIXER_STATE_PATH).data, currentText);
  const cleanup = restored.mixer.register('lead', 'segapsg', () => {});
  assert.deepEqual(restored.mixer.get('lead'), mix(.7, -.2, true, true));
  restored.state.selectPreset(MIXER_DEFAULT_PRESET_PATH);
  assert.deepEqual(restored.mixer.get('lead'), mix(.25, -.2));
  cleanup(); assert.deepEqual(restored.mixer.list(), [], 'policy restore preserves output cleanup identity');
});

test('transient IDs never enter current.json while explicit disconnected IDs remain', t => {
  const f = fixture(); t.after(() => f.state.dispose());
  const reservation = f.mixer.reserveId('segapsg');
  const releaseTransient = f.mixer.register(reservation.id, 'segapsg', () => {}); reservation.release();
  f.mixer.set(reservation.id, {volume:.2, pan:.4, muted:true});
  assert.equal(f.timers.size, 0); f.state.flush(); assert.equal(f.files.has(MIXER_STATE_PATH), false);
  const releaseStable = f.mixer.register('lead', 'segapsg', () => {}); f.mixer.set('lead', {volume:.6});
  releaseStable(); f.runTimers();
  assert.deepEqual(current(f), preset([record('lead', {volume:.6})]));
  releaseTransient(); assert.deepEqual(current(f), preset([record('lead', {volume:.6})]));
});

test('registering and disconnecting sources alone does not create current.json', t => {
  const f = fixture(); t.after(() => f.state.dispose());
  const release = f.mixer.register('lead', 'segapsg', () => {});
  release(); f.runTimers(); assert.equal(f.state.flush(), true);
  assert.equal(f.files.has(MIXER_STATE_PATH), false); assert.equal(f.writes.length, 0);
});

test('System uses application factory balance without persisting it or replacing authored preset numbers', t => {
  const mixer = new SoundChipMixer({factoryDefaults:{version:1,kinds:[{name:'segapsg',volume:.25}]},
    factoryEntries:{version:1,entries:[record('segapsg',{volume:.65})]}});
  const currentText = '  '+JSON.stringify(preset([record('segapsg',{volume:.8,pan:-.2})],
    [{name:'segapsg',volume:.6}]))+'\n\n';
  const defaultText = JSON.stringify(preset([record('segapsg',{volume:.9})]));
  const namedText = JSON.stringify(preset([record('segapsg',{pan:.3})],[{name:'segapsg',volume:.4}]));
  const files = createVirtualFileSystem([file(MIXER_STATE_PATH,currentText),
    file(MIXER_DEFAULT_PRESET_PATH,defaultText),file('/mixer/authored.json',namedText)]);
  const f = fixture({mixer,files}); t.after(()=>f.state.dispose());
  mixer.register('segapsg','segapsg',()=>{}); mixer.register('extra','segapsg',()=>{});
  assert.deepEqual(mixer.get('segapsg'),mix(.8,-.2)); assert.deepEqual(mixer.get('extra'),mix(.6));
  f.state.selectPreset(MIXER_SYSTEM_PRESET_PATH);
  assert.deepEqual(mixer.get('segapsg'),mix(.65)); assert.deepEqual(mixer.get('extra'),mix(.25));
  assert.deepEqual(mixer.exportState(),preset()); assert.deepEqual(mixer.exportDefaults(),{version:1,kinds:[]});
  f.state.selectPreset(MIXER_DEFAULT_PRESET_PATH); assert.deepEqual(mixer.get('segapsg'),mix(.9));
  f.state.selectPreset('/mixer/authored.json'); assert.deepEqual(mixer.get('segapsg'),mix(.4,.3));
  f.state.selectPreset(MIXER_STATE_PATH); assert.deepEqual(mixer.get('segapsg'),mix(.8,-.2));
  f.runTimers();
  assert.equal(files.get(MIXER_STATE_PATH).data,currentText);
  assert.equal(files.get(MIXER_DEFAULT_PRESET_PATH).data,defaultText);
  assert.equal(files.get('/mixer/authored.json').data,namedText);
  assert.equal(f.timers.size,0); assert.deepEqual(f.writes,[]);
});

test('editing calibrated System writes only actual edits and new projects keep factory policy beneath defaults', t => {
  const mixer = new SoundChipMixer({factoryDefaults:{version:1,kinds:[{name:'segapsg',volume:.25}]},
    factoryEntries:{version:1,entries:[record('segapsg',{volume:.65})]}});
  const f = fixture({mixer}); t.after(()=>f.state.dispose());
  mixer.register('segapsg','segapsg',()=>{}); mixer.register('extra','segapsg',()=>{});
  assert.equal(f.files.has(MIXER_STATE_PATH),false);
  mixer.set('segapsg',{pan:.2}); f.runTimers();
  assert.deepEqual(current(f),preset([record('segapsg',{pan:.2})]));
  assert.deepEqual(mixer.get('segapsg'),mix(.65,.2));
  f.state.saveDefault();
  const defaults = f.files.get(MIXER_DEFAULT_PRESET_PATH).data;
  assert.deepEqual(JSON.parse(defaults),preset([record('segapsg',{pan:.2})]));
  f.state.replaceProject(()=>f.files.replace([file(MIXER_DEFAULT_PRESET_PATH,defaults)]));
  assert.deepEqual(mixer.get('segapsg'),mix(.65,.2)); assert.deepEqual(mixer.get('extra'),mix(.25));
  assert.equal(f.files.has(MIXER_STATE_PATH),false,'loading the inherited default never creates current.json');
  f.state.selectPreset(MIXER_SYSTEM_PRESET_PATH);
  assert.deepEqual(mixer.get('segapsg'),mix(.65));
  assert.equal(f.files.get(MIXER_DEFAULT_PRESET_PATH).data,defaults);
});

test('dispose flushes once, cancels timers, and releases all subscriptions', () => {
  const f = fixture(); f.mixer.register('lead', 'segapsg', () => {});
  let changes = 0; f.state.subscribePresets(change => {if (!change?.source) changes++;});
  f.mixer.set('lead', {volume:.4}); f.state.dispose();
  assert.equal(f.writes.length, 1); assert.equal(f.timers.size, 0); assert.equal(changes, 1);
  f.state.dispose(); f.mixer.set('lead', {volume:.8});
  f.files.replace([file('/mixer/later.json', preset([record('lead', {volume:.1})]))]); f.runTimers();
  assert.equal(f.writes.length, 1); assert.equal(changes, 1); assert.equal(f.timers.size, 0);
  assert.equal(f.mixer.get('lead').volume, .8); assert.equal(f.files.has(MIXER_STATE_PATH), false);
  assert.throws(() => f.state.selectPreset(MIXER_SYSTEM_PRESET_PATH), /disposed/);
});

test('maximum valid schema survives escaped identifiers and current.json serialization', t => {
  const name = '\u0001'.repeat(255)+'x';
  const value = preset(Array.from({length:512}, (_, index) => record('\u0001'.repeat(250)+index, {volume:.4}, name)));
  const f = fixture({files:createVirtualFileSystem([file(MIXER_STATE_PATH, value)])});
  t.after(() => f.state.dispose()); assert.deepEqual(f.errors, []);
  f.mixer.set(value.entries[0].id, {volume:.6}); assert.equal(f.state.flush(), true);
  const text = f.files.get(MIXER_STATE_PATH).data;
  assert(new TextEncoder().encode(text).byteLength < 2 * 1024 * 1024);
  const restored = fixture({files:createVirtualFileSystem([file(MIXER_STATE_PATH, text)])});
  t.after(() => restored.state.dispose()); assert.deepEqual(restored.errors, []);
  assert.equal(restored.mixer.exportState().entries.length, 512);
  assert.equal(restored.mixer.get(value.entries[0].id).volume, .6);
});

test('source-unit presets migrate legacy primary gains once without rewriting files or changing extra outputs',t=>{
  const mixer=new SoundChipMixer({gainUnits:'source',factoryDefaults:{version:1,kinds:[{name:'segapsg',volume:.35},{name:'ym2612',volume:.775938}]}});
  const legacy=preset([record('segapsg',{volume:1.3,muted:true}),record('ym2612',{pan:.2},'ym2612')],
    [{name:'segapsg',volume:.6},{name:'ym2612',volume:.8}]);
  const files=createVirtualFileSystem([file(MIXER_STATE_PATH,legacy)]);
  const f=fixture({mixer,files,legacyPrimaryTrims:{segapsg:.35,ym2612:.9}});t.after(()=>f.state.dispose());
  for(const [id,name] of [['segapsg','segapsg'],['ym2612','ym2612'],['extra','segapsg']])mixer.register(id,name,()=>{});
  assert.equal(mixer.get('segapsg').volume,1.3*.35);
  assert.equal(mixer.get('ym2612').volume,.8*.9);
  assert.equal(mixer.get('extra').volume,.6,'standalone common gain stays in source units');
  assert.equal(f.writes.length,0);assert.deepEqual(JSON.parse(files.get(MIXER_STATE_PATH).data),legacy);
  mixer.set('segapsg',{pan:-.2});f.runTimers();
  const saved=current(f);assert.equal(saved.gainUnits,'source');
  assert.equal(saved.entries.find(entry=>entry.id==='segapsg').settings.volume,1.3*.35);
  f.state.selectPreset(MIXER_STATE_PATH);f.state.selectPreset(MIXER_STATE_PATH);
  assert.equal(mixer.get('segapsg').volume,1.3*.35,'canonical values are never converted twice');
  f.state.selectPreset(MIXER_SYSTEM_PRESET_PATH);
  assert.equal(mixer.get('segapsg').volume,.35);assert.equal(mixer.get('ym2612').volume,.775938);
  assert.deepEqual(current(f),saved,'selecting System does not replace current.json');
});

test('legacy kind-only presets preserve the primary/extra difference and source presets need no conversion',t=>{
  const mixer=new SoundChipMixer({gainUnits:'source'});
  const files=createVirtualFileSystem([file('/mixer/old.json',preset([],[{name:'segapsg',volume:.7}])),
    file('/mixer/new.json',{...preset([record('segapsg',{volume:.35})]),gainUnits:'source'})]);
  const f=fixture({mixer,files,legacyPrimaryTrims:{segapsg:.35}});t.after(()=>f.state.dispose());
  mixer.register('segapsg','segapsg',()=>{});mixer.register('extra','segapsg',()=>{});
  f.state.selectPreset('/mixer/old.json');
  assert.equal(mixer.get('segapsg').volume,.7*.35);assert.equal(mixer.get('extra').volume,.7);
  f.state.selectPreset('/mixer/new.json');assert.equal(mixer.get('segapsg').volume,.35);
  assert.equal(files.has(MIXER_STATE_PATH),false);
});

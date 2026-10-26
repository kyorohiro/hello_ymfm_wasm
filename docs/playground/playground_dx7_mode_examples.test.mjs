import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {presetToVoice, voiceToPreset, validateOperator, validateOperators} from '../../web/msfa_dx7/src/preset.js';
import {MODE_STARTERS, selectModeExamples} from './playground_mode_examples.js';

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
async function evaluate(path) {
  const source = await readFile(new URL(path, import.meta.url), 'utf8');
  const notes = [], releases = [], loops = [], presets = [], mixes = [], bindings = [];
  let allNotesOff = 0;
  const dx7 = {
    id: 'dx7',
    async setPreset(preset) { presets.push(voiceToPreset(presetToVoice(preset))); },
    async setOperator(operator, patch) { validateOperator(operator, patch); },
    async setOperators(entries) { validateOperators(entries); },
    noteOn(note, velocity = 100) {
      assert.ok(Number.isInteger(note) && note >= 0 && note <= 127);
      assert.ok(Number.isInteger(velocity) && velocity >= 0 && velocity <= 127);
      notes.push({note, velocity});
    },
    noteOff(note) { releases.push(note); },
    allNotesOff() { allNotesOff++; },
  };
  const api = {
    dx7,
    async useSoundChip(name) { assert.equal(name, 'dx7'); return dx7; },
    mixer: {async set(id, settings) { assert.equal(id, 'dx7'); mixes.push(settings); }},
    setBpm(bpm) { assert.ok(bpm > 0); },
    liveLoop(name, run) { loops.push({name, run}); },
    async beat(beats) { assert.ok(beats > 0); },
    async tween(_duration, update) { for (const value of [0, 0.5, 1]) await update(value); },
    choose: values => values[0],
    keyboard: {bind(name, handlers) { bindings.push({name, handlers}); }},
    log() {},
  };
  await new AsyncFunction(...Object.keys(api), source)(...Object.values(api));
  return {notes, releases, loops, presets, mixes, bindings, get allNotesOff() { return allNotesOff; }};
}

test('DX7 starter configures an original playable voice without file or OPN dependencies', async () => {
  const result = await evaluate('./defaults/dx7/index.js');
  assert.equal(result.presets.length, 1);
  const voice = result.presets[0];
  assert.equal(voice.name, 'MODE KEYS');
  assert.equal(voice.algorithm, 31);
  assert.equal(voice.operators[1].outputLevel, 99);
  assert.deepEqual(voice.operators[1].envelope.levels, [99, 99, 99, 0]);
  for (const operator of [2, 3, 4, 5, 6]) assert.equal(voice.operators[operator].outputLevel, 0);
  assert.deepEqual(result.mixes, [], 'the starter preserves the selected Mixer preset');
  assert.equal(result.loops.length, 1);
  await result.loops[0].run();
  assert.deepEqual(result.notes.map(({note}) => note), [60, 64, 67, 71, 72, 67, 64, 62]);
  assert.deepEqual(result.releases, result.notes.map(({note}) => note));
});

test('DX7 mode selects three runnable examples and retains the independent Genesis examples', async () => {
  const paths = MODE_STARTERS.dx7.examples;
  assert.deepEqual(paths, [
    '/examples/dx7/dx7-object-preset.js',
    '/examples/dx7/dx7-live-parameters.js',
    '/examples/dx7/dx7-keyboard.js',
  ]);
  const files = paths.map(path => ({path}));
  assert.deepEqual(selectModeExamples(files, 'dx7'), files);
  assert.deepEqual(selectModeExamples(files, 'genesis'), files);
  for (const path of paths) {
    const result = await evaluate('.' + path);
    assert.equal(result.presets.length, 1, path);
    assert.deepEqual(result.mixes, [], `${path} preserves Mixer settings`);
    for (const loop of result.loops) await loop.run();
    assert.ok(result.notes.length > 0 || result.bindings.length === 1, path);
  }
});

test('DX7 Keyboard uses MIDI velocity and protects a newer same-note press from an older release', async () => {
  const result = await evaluate('./examples/dx7/dx7-keyboard.js');
  assert.equal(result.bindings.length, 1);
  const {handlers} = result.bindings[0];
  handlers.noteOn({id: 'older', midi: 60, velocity: 90});
  handlers.noteOn({id: 'newer', midi: 60, velocity: 110});
  handlers.noteOn({id: 'other-note', midi: 64, velocity: 80});
  handlers.noteOff({id: 'older', midi: 60, velocity: 90});
  assert.deepEqual(result.releases, []);
  handlers.noteOff({id: 'other-note', midi: 64, velocity: 80});
  assert.deepEqual(result.releases, [64]);
  handlers.noteOff({id: 'newer', midi: 60, velocity: 110});
  assert.deepEqual(result.releases, [64, 60]);
  assert.deepEqual(result.notes, [{note: 60, velocity: 90}, {note: 60, velocity: 110}, {note: 64, velocity: 80}]);
  handlers.noteOn({id: 'cleanup', midi: 67, velocity: 100});
  handlers.allNotesOff();
  assert.equal(result.allNotesOff, 1);
  handlers.noteOff({id: 'cleanup', midi: 67, velocity: 100});
  assert.deepEqual(result.releases, [64, 60], 'cleanup retires press ownership');
});

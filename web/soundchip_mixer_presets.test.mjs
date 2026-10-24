import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {SOUNDCHIP_MIXER_PRESETS} from './soundchip_mixer_presets.js';
import {SOUNDCHIP_MIXER_PRESETS as rootPresets, createSoundChip} from './soundchip.js';
import {SoundChipMixer, chipMixGains, soundChipMixDefaults} from './soundchip_mixer.js';
import {buildPlaygroundMixerDefaults, PLAYGROUND_CALIBRATION_KINDS} from '../scripts/generate_playground_mixer_defaults.mjs';
import {Ym2612} from './ym2612.js';
import {YM2612Synth, YM2612DirectTransport} from './ym2612synth.js';
import {FM_PRESETS} from './megasynth-fm-presets.js';
import moduleFactory from '../docs/generated/ym2612_wasm.js';

const report = JSON.parse(await readFile(new URL('../docs/issues/playground_chip_levels_01.json', import.meta.url), 'utf8'));
const measured = buildPlaygroundMixerDefaults(report);
const preset = SOUNDCHIP_MIXER_PRESETS.calibrated;
const kinds = records => ({version: 1, kinds: records});
const state = entries => ({version: 1, entries});

test('calibrated export contains exactly the measured additional kinds and engine, without machine-specific gains', () => {
  assert.equal(rootPresets, SOUNDCHIP_MIXER_PRESETS);
  assert.deepEqual(Object.keys(SOUNDCHIP_MIXER_PRESETS), ['calibrated']);
  assert.deepEqual(preset, {factoryDefaults: measured.factoryDefaults, factoryEngines: measured.factoryEngines});
  assert.deepEqual(new Set(preset.factoryDefaults.kinds.map(record => record.name)), new Set(PLAYGROUND_CALIBRATION_KINDS));
  assert.equal(preset.factoryDefaults.kinds.length, 22);
  assert.deepEqual(preset.factoryEngines.engines, [{name: 'ym2612', engine: 'nuked', volume: 0.493869}]);
  assert.equal(Object.hasOwn(preset, 'factoryEntries'), false);
});

test('importing the optional preset leaves generic Mixer defaults unchanged', () => {
  const legacy = new SoundChipMixer(), calibrated = new SoundChipMixer(preset);
  for (const {name, volume} of preset.factoryDefaults.kinds) {
    legacy.register(`legacy:${name}`, name, () => {});
    calibrated.register(`calibrated:${name}`, name, () => {});
    assert.equal(legacy.get(`legacy:${name}`).volume, name === 'gameboy' ? 0.28 : 1);
    assert.equal(calibrated.get(`calibrated:${name}`).volume, volume);
  }
  assert.deepEqual(soundChipMixDefaults('gameboy'), {volume: 0.28, pan: 0, muted: false});
  assert.deepEqual(soundChipMixDefaults('rf5c164'), {volume: 1, pan: 0, muted: false});
  assert.deepEqual(calibrated.exportDefaults(), kinds([]));
  assert.deepEqual(calibrated.exportState(), state([]), 'Factory calibration is not an authored project override');
});

test('calibration remains an output policy and does not trim legacy direct-chip PCM', async () => {
  const chips = await Promise.all([
    createSoundChip('ym2612'),
    Ym2612.create({moduleFactory, moduleOptions: {
      wasmBinary: await readFile(new URL('../docs/generated/ym2612_wasm.wasm', import.meta.url)),
    }}),
  ]);
  try {
    const mixer = new SoundChipMixer(preset);
    mixer.register(chips[0].id, 'ym2612', () => {});
    assert.equal(mixer.get(chips[0].id).volume, 0.775938);
    assert.equal(chips[0].mixer, undefined, 'A direct chip does not acquire an output mixer');
    for (const chip of chips) {
      const synth = new YM2612Synth({transport: new YM2612DirectTransport(chip)});
      synth.setPreset(0, FM_PRESETS.sine);
      synth.noteOn(0, 4, 553);
    }
    const actual = chips[0].generateStereo(4096), raw = chips[1].generateStereo(4096);
    assert.ok(actual.left.every(Number.isFinite) && actual.left.some(value => Math.abs(value) > 0.001));
    assert.deepEqual(actual, raw, 'No-mixer factory output stays byte-for-byte equal to the low-level wrapper');
  } finally {
    for (const chip of chips) chip.dispose();
  }
});

test('Nuked replaces the YM2612 kind fallback, and common/project volumes replace calibration absolutely', () => {
  const mixer = new SoundChipMixer(preset), output = {};
  mixer.register('ymfm', 'ym2612', value => {output.ymfm = chipMixGains(value);}, undefined, {engine: 'ymfm'});
  mixer.register('nuked', 'ym2612', value => {output.nuked = chipMixGains(value);}, undefined, {engine: 'nuked'});
  assert.deepEqual(output, {ymfm: [0.775938, 0.775938], nuked: [0.493869, 0.493869]});
  mixer.configureDefaults(kinds([{name: 'ym2612', volume: 0.6}]));
  assert.deepEqual(output, {ymfm: [0.6, 0.6], nuked: [0.6, 0.6]});
  mixer.set('nuked', {volume: 0.8});
  const saved = mixer.exportState(), defaults = mixer.exportDefaults();
  for (let index = 0; index < 3; index++) mixer.restoreState(saved, defaults);
  assert.deepEqual(output, {ymfm: [0.6, 0.6], nuked: [0.8, 0.8]});
  assert.deepEqual(saved, state([{id: 'nuked', name: 'ym2612', settings: {volume: 0.8}}]));
  mixer.restoreState(state([]), kinds([]));
  assert.deepEqual(output, {ymfm: [0.775938, 0.775938], nuked: [0.493869, 0.493869]});
});

test('RF5C164 calibration is applied once for every instance and authored values survive repeated restore', () => {
  const mixer = new SoundChipMixer(preset), applied = {};
  for (const id of ['rf5c164', 'rf5c164:33']) {
    mixer.register(id, 'rf5c164', value => {applied[id] = chipMixGains(value);});
    assert.deepEqual(applied[id], [0.280286, 0.280286]);
  }
  mixer.setKindDefault('rf5c164', {volume: 0.7});
  mixer.set('rf5c164:33', {volume: 0.9});
  const saved = mixer.exportState(), defaults = mixer.exportDefaults();
  for (let index = 0; index < 3; index++) mixer.restoreState(saved, defaults);
  assert.deepEqual(applied.rf5c164, [0.7, 0.7]);
  assert.deepEqual(applied['rf5c164:33'], [0.9, 0.9]);
  mixer.restoreState(state([]), kinds([]));
  assert.deepEqual(applied.rf5c164, [0.280286, 0.280286]);
  assert.deepEqual(applied['rf5c164:33'], [0.280286, 0.280286]);
});

test('unmeasured chip names and engines retain existing fallbacks rather than borrowing another calibration', () => {
  const mixer = new SoundChipMixer(preset);
  for (const name of ['ym3438', 'ymf276', 'ymf278b', 'ymf288', 'segapcm', 'k051649', 'msm5205', 'okim6295']) {
    mixer.register(name, name, () => {}, undefined, {engine: 'nuked'});
    assert.deepEqual(mixer.getKindDefault(name, 'nuked'), {volume: 1, pan: 0});
    assert.equal(mixer.get(name).volume, 1);
  }
  assert.deepEqual(mixer.getKindDefault('gameBoyDmg'), {volume: 0.28, pan: 0}, 'Existing alias fallback remains generic');
  assert.deepEqual(mixer.getKindDefault('ym2612', 'unknown'), {volume: 0.775938, pan: 0});
});

test('preset trees are deeply frozen, constructors copy them, and per-Mixer changes stay isolated', () => {
  function assertFrozen(value) {
    if (!value || typeof value !== 'object') return;
    assert.ok(Object.isFrozen(value));
    for (const child of Object.values(value)) assertFrozen(child);
  }
  assertFrozen(SOUNDCHIP_MIXER_PRESETS);
  assert.throws(() => {preset.factoryDefaults.kinds[0].volume = 2;}, TypeError);
  assert.throws(() => {preset.factoryDefaults.kinds.push({name: 'extra', volume: 1});}, TypeError);
  assert.throws(() => {preset.factoryEngines.engines[0].volume = 2;}, TypeError);
  const cloned = structuredClone(preset), first = new SoundChipMixer(cloned), second = new SoundChipMixer(preset);
  cloned.factoryDefaults.kinds.find(record => record.name === 'rf5c164').volume = 2;
  cloned.factoryEngines.engines[0].volume = 2;
  assert.equal(first.getKindDefault('rf5c164').volume, 0.280286, 'Constructor copies kind records before caller mutation');
  assert.equal(first.getKindDefault('ym2612', 'nuked').volume, 0.493869, 'Constructor copies engine records before caller mutation');
  first.setKindDefault('rf5c164', {volume: 0.4});
  first.setKindDefault('ym2612', {volume: 0.7});
  assert.equal(second.getKindDefault('rf5c164').volume, 0.280286);
  assert.equal(second.getKindDefault('ym2612', 'nuked').volume, 0.493869);
  assert.equal(new SoundChipMixer(preset).getKindDefault('rf5c164').volume, 0.280286);
  assert.equal(measured.factoryDefaults.kinds.find(record => record.name === 'rf5c164').volume, 0.280286);
});

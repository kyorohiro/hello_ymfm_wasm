import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {
  restoreMixerCalibrationSegaTimedRevision as restoreSega, createSegaTimedRevisionReadContext as createSegaContext,
  SEGA_TIMED_REVISION_BASE_COMMIT as base, SEGA_TIMED_REVISION_PATHS as paths,
  SEGA_TIMED_REVISION_RECEIPT as receiptPath, SEGA_TIMED_REVISION_PIN as pin,
  SEGA_TIMED_REVISION_REPORTS as reports,
} from './mixer_calibration_sega_timed_revision.mjs';
import {assertMixerCalibrationSourceFreshness as fresh} from './mixer_calibration_sources.mjs';
import {createGameboyTimedRevisionReadContext} from './mixer_calibration_gameboy_timed_revision.mjs';

// This historical audit still checks its original bytes. Remove the separately
// authenticated later DMG promotion before exercising its own strict guards.
const gameboyContext=createGameboyTimedRevisionReadContext();
const read = name => gameboyContext.readSource(new URL('../' + name, import.meta.url));
const restore=(path,bytes,options={})=>restoreSega(path,bytes,{read,...options});
const createSegaTimedRevisionReadContext=()=>createSegaContext(gameboyContext.readSource);
const sha = value => createHash('sha256').update(value).digest('hex');
const receipt = JSON.parse(read(receiptPath));

test('shared Sega revision restores only exact complete fixed-Git predecessor bodies', () => {
  assert.equal(sha(JSON.stringify(receipt)), pin);
  assert.equal(receipt.baseCommit, base);
  for (const path of paths) {
    const current = read(path), entry = receipt.sources[path], before = restore(path, current);
    assert.equal(before.length, entry.before.bytes);
    assert.equal(sha(before), entry.before.sha256);
    assert.deepEqual(before, execFileSync('git', ['show', base + ':' + path], {maxBuffer:4 * 1024 * 1024}), path);
    assert.deepEqual(restore(path, before), before);
    assert.equal(fresh({path, bytes:current, record:entry.before}), 'sega-shared-timed-api');
  }
});

test('future bytes and unrelated sources receive no source-hash exemption', () => {
  for (const path of paths) {
    const changed = Buffer.concat([read(path), Buffer.from('\n// future edit\n')]);
    assert.equal(restore(path, changed), changed);
    assert.throws(() => fresh({path, bytes:changed, record:receipt.sources[path].before}), /remeasure|dependency changed/, path);
  }
  const other = Buffer.from('other chip');
  assert.equal(restore('js/other.js', other), other);
});

test('every fresh raw and policy verification matrix remains required', () => {
  for (const target of reports) {
    assert.throws(() => restore(paths[0], read(paths[0]), {read:name => name === target ? Buffer.from('{}') : read(name)}), /remeasure/, target);
    const report = JSON.parse(read(target)), previous = JSON.parse(read(target.replace('_sega_timed_', '_ws_timed_').replace('_verify_', '_')));
    assert.equal(report.physicalOutputMuted, true); assert.equal(report.listeningPerformed, false);
    assert.equal(report.pcmContinuous, true); assert.equal(report.completeCoverage, true);
    if (report.verify) assert.deepEqual(report.calibration, previous.calibration, 'retained existing gain policy');
  }
});

test('proof, renderer, API, Native, type, navigation and package dependencies cannot drift', () => {
  const selected = [
    'docs/issues/sega_timed_default_pcm_01.json', 'scripts/check_sega_timed_default_pcm.mjs',
    'tetorica_src/runtime/segapsg_operations.js', 'docs/js/ym2413_timed_processor.js',
    'tetorica_src/runtime/segapsgsynth.js', 'tetorica_src/runtime/ym2413synth.js',
    'docs/generated/segapsg_wasm.wasm', 'docs/generated/ym2413_wasm.wasm',
    'docs/js/soundchip_mixer_presets.js', 'docs/playground/playground_mixer_defaults.js',
    'docs/issues/scsp_ym2413_state_chip_levels_01.json', 'packages/fm2612/package.json',
    'scripts/check_fm2612_sega_timed_package.mjs', 'docs/playground/playground_monaco_definitions.test.mjs',
    'test/runtime/segapsg_ym2413_timed_client.test.mjs',
  ];
  for (const target of selected) {
    assert(receipt.dependencies[target], 'explicit dependency: ' + target);
    assert.throws(() => restore(paths[0], read(paths[0]), {read:name => {
      const value = read(name); return name === target ? Buffer.concat([value, Buffer.from(' ')]) : value;
    }}), /remeasure/, target);
  }
  for (const target of paths) assert.throws(() => restore(paths[0], read(paths[0]), {read:name => {
    const value = read(name); return name === target ? Buffer.concat([value, Buffer.from(' ')]) : value;
  }}), /remeasure/, target);
});

test('pinned receipt cannot be changed to approve another source or omit a dependency', () => {
  for (const change of [
    value => {value.sources[paths[0]].after.sha256 = '0'.repeat(64);},
    value => {delete value.dependencies['docs/issues/sega_timed_default_pcm_01.json'];},
    value => {value.baseCommit = '0'.repeat(40);},
  ]) {
    const changed = structuredClone(receipt); change(changed);
    assert.throws(() => restore(paths[0], read(paths[0]), {read:name => name === receiptPath ? Buffer.from(JSON.stringify(changed)) : read(name)}), /remeasure/);
  }
});

test('nested historical reads use an isolated authenticated predecessor snapshot', () => {
  const context = createSegaTimedRevisionReadContext(), path = 'docs/js/playground_performance_sender.js';
  const actual = read(path), before = context.restore('js/playground_performance_sender.js', actual);
  assert.deepEqual(context.readSource(new URL('../' + path, import.meta.url)), before);
  assert.equal(sha(read(path)), receipt.sources[path].after.sha256, 'live file stays unchanged');
  const previous = JSON.parse(read('docs/issues/ps1_ym2413_state_chip_levels_01.json'));
  for (const name of Object.keys(previous.sources).filter(name => /playground_(?:segapsg|ym2413|performance_sender)\.js$/.test(name))) {
    assert.doesNotThrow(() => fresh({path:name, bytes:read('docs/' + name), record:previous.sources[name], report:previous}), name);
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {copyFile, cp, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {getRuntimeArtifactManifest, listRuntimeArtifactFiles, checkRuntimeArtifacts,
  syncRuntimeArtifacts, copyRuntimeArtifacts} from '../scripts/runtime_artifacts.mjs';
import {parseRuntimeArtifactArguments} from '../scripts/sync_runtime_artifacts.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = await getRuntimeArtifactManifest({root});
const outputNames = source.inventory.builds.flatMap(artifact => artifact.outputs);
const canonical = (fixture, name) => path.join(fixture.root, 'web/generated', name);
const deployed = (fixture, name) => path.join(fixture.root, 'docs/generated', name);

async function fixture(t, {initialized = false} = {}) {
  const temporary = await mkdtemp(path.join(tmpdir(), 'tetorica-runtime-artifacts-test-'));
  t.after(() => rm(temporary, {recursive: true, force: true}));
  const result = {root: path.join(temporary, 'repository'), temporary};
  await mkdir(path.join(result.root, 'third_party'), {recursive: true});
  await cp(path.join(root, 'third_party/tetorica-soundchip-native'),
    path.join(result.root, 'third_party/tetorica-soundchip-native'), {recursive: true});
  await copyFile(path.join(root, 'third_party/soundchip-sdk.json'), path.join(result.root, 'third_party/soundchip-sdk.json'));
  for (const name of [...outputNames, 'build-info.json', 'ps1_spu_build.json']) {
    await mkdir(path.dirname(deployed(result, name)), {recursive: true});
    await copyFile(path.join(root, 'docs/generated', name), deployed(result, name));
  }
  for (const name of ['web/native_audio_effect.wasm', 'docs/js/native_audio_effect.wasm', 'docs/native_audio_effect/gain.wasm',
    'web/msfa_dx7/wasm/msfa.wasm', 'docs/js/msfa_dx7/wasm/msfa.wasm']) {
    const target = path.join(result.root, name);
    await mkdir(path.dirname(target), {recursive: true});
    await copyFile(path.join(root, name), target);
  }
  if (initialized) await syncRuntimeArtifacts({...result, importExisting: true});
  return result;
}

test('one immutable inventory covers 33 SDK builds, NativeFX, metadata and license references', async () => {
  assert.equal(source.artifacts.length, 34);
  assert.equal(source.artifacts.flatMap(artifact => artifact.files).length, 66);
  assert(source.artifacts.every(artifact => artifact.licenseFiles.length > 0));
  const dx7 = source.artifacts.find(artifact => artifact.id === 'dx7');
  assert.deepEqual(dx7.files[0].mirrors,
    ['docs/generated/msfa.wasm', 'web/msfa_dx7/wasm/msfa.wasm', 'docs/js/msfa_dx7/wasm/msfa.wasm']);
  const fx = source.artifacts.find(artifact => artifact.id === 'native_audio_effect');
  assert.equal(fx.files[0].canonical, 'web/generated/effects/gain.wasm');
  assert.throws(() => dx7.files[0].mirrors.push('another-path'), TypeError);
  const listed = await listRuntimeArtifactFiles({root, ids: ['ps1_spu']});
  assert.deepEqual(listed.map(entry => entry.path),
    ['ps1_spu_wasm.js', 'ps1_spu_wasm.wasm', 'build-info.json', 'ps1_spu_build.json', 'runtime-artifacts.json']);
  assert(listed.every(entry => entry.source.startsWith(path.join(root, 'web/generated'))));
  assert.deepEqual((await listRuntimeArtifactFiles({root, ids: ['msfa'], includeMetadata: false})).map(entry => entry.path), ['msfa.wasm']);
});

test('explicit bootstrap validates old outputs then creates the complete canonical set without changing runtime bytes', async t => {
  const local = await fixture(t);
  // The old checkout contains several complete pairs, but never the full set.
  await mkdir(canonical(local, ''), {recursive: true});
  for (const name of ['cdda_wasm.js', 'cdda_wasm.wasm']) await copyFile(deployed(local, name), canonical(local, name));
  const result = await syncRuntimeArtifacts({...local, importExisting: true});
  assert.equal(result.imported, true);
  const checked = await checkRuntimeArtifacts(local);
  assert.equal(checked.sdkBuildCount, 33); assert.equal(checked.outputCount, 66);
  for (const name of outputNames) assert.deepEqual(await readFile(canonical(local, name)), await readFile(deployed(local, name)));
  const catalog = JSON.parse(await readFile(canonical(local, 'runtime-artifacts.json')));
  assert.equal(catalog.artifacts.length, 34); assert.equal(catalog.sdk.manifestSha256, source.inventory.pin.manifestSha256);
  assert(catalog.artifacts.every(artifact => artifact.files.every(file => /^[a-f0-9]{64}$/.test(file.sha256))));
  assert.deepEqual((await syncRuntimeArtifacts(local)).changed, []);
});

test('normal check and sync never fall back to an otherwise valid docs/generated directory', async t => {
  const local = await fixture(t);
  const previous = await readFile(deployed(local, 'build-info.json'));
  await assert.rejects(checkRuntimeArtifacts(local), /ENOENT/);
  await assert.rejects(syncRuntimeArtifacts(local), /ENOENT/);
  assert.deepEqual(await readFile(deployed(local, 'build-info.json')), previous);
  await assert.rejects(readdir(canonical(local, '')), /ENOENT/);
});

test('bootstrap rejects a partial canonical pair before publishing any generated files', async t => {
  const local = await fixture(t);
  await mkdir(canonical(local, ''), {recursive: true});
  await copyFile(deployed(local, 'ym2612_wasm.js'), canonical(local, 'ym2612_wasm.js'));
  await assert.rejects(syncRuntimeArtifacts({...local, importExisting: true}), /pair is incomplete: ym2612/);
  assert.deepEqual(await readdir(canonical(local, '')), ['ym2612_wasm.js']);
});

test('bootstrap rejects divergent canonical outputs without overwriting either version', async t => {
  const local = await fixture(t);
  await mkdir(canonical(local, ''), {recursive: true});
  for (const name of ['ym2612_wasm.js', 'ym2612_wasm.wasm']) await copyFile(deployed(local, name), canonical(local, name));
  await writeFile(canonical(local, 'ym2612_wasm.js'), 'local generated variant');
  const previous = await readFile(deployed(local, 'ym2612_wasm.js'));
  await assert.rejects(syncRuntimeArtifacts({...local, importExisting: true}), /canonical differs: web\/generated\/ym2612_wasm.js/);
  assert.equal(await readFile(canonical(local, 'ym2612_wasm.js'), 'utf8'), 'local generated variant');
  assert.deepEqual(await readFile(deployed(local, 'ym2612_wasm.js')), previous);
  assert.equal((await readdir(canonical(local, ''))).length, 2);
});

test('bootstrap requires agreeing NativeFX copies and authentic complete SDK outputs', async t => {
  const local = await fixture(t);
  await writeFile(path.join(local.root, 'docs/js/native_audio_effect.wasm'), 'different');
  await assert.rejects(syncRuntimeArtifacts({...local, importExisting: true}), /mirror differs: docs\/js\/native_audio_effect.wasm/);
  await assert.rejects(readdir(canonical(local, '')), /ENOENT/);
  await copyFile(path.join(root, 'docs/js/native_audio_effect.wasm'), path.join(local.root, 'docs/js/native_audio_effect.wasm'));
  await rm(deployed(local, 'ym2612_wasm.wasm'));
  await assert.rejects(syncRuntimeArtifacts({...local, importExisting: true}), /missing or extra/);
  await assert.rejects(readdir(canonical(local, '')), /ENOENT/);
});

test('bootstrap rejects unreceipted and invalid WASM bytes rather than importing generated JS', async t => {
  const local = await fixture(t);
  await writeFile(deployed(local, 'ym2612_wasm.js'), 'throw new Error("should never execute");');
  await assert.rejects(syncRuntimeArtifacts({...local, importExisting: true}), /Output hash\/size mismatch/);
  await assert.rejects(readdir(canonical(local, '')), /ENOENT/);
});

test('selected sync repairs only its mirrors while check still authenticates the entire canonical set', async t => {
  const local = await fixture(t, {initialized: true});
  await writeFile(deployed(local, 'ym2612_wasm.js'), 'stale selected mirror');
  await writeFile(deployed(local, 'ay8910_wasm.js'), 'stale unselected mirror');
  await assert.rejects(checkRuntimeArtifacts({...local, ids: ['ym2612']}), /mirror differs.*ym2612/);
  const result = await syncRuntimeArtifacts({...local, ids: ['ym2612']});
  assert.deepEqual(result.changed, ['docs/generated/ym2612_wasm.js']);
  await checkRuntimeArtifacts({...local, ids: ['ym2612']});
  assert.equal(await readFile(deployed(local, 'ay8910_wasm.js'), 'utf8'), 'stale unselected mirror');
  await assert.rejects(checkRuntimeArtifacts(local), /mirror differs.*ay8910/);
  await writeFile(canonical(local, 'ay8910_wasm.js'), 'changed canonical source');
  await assert.rejects(syncRuntimeArtifacts({...local, ids: ['ym2612']}), /Output hash\/size mismatch/);
});

test('DX7 sync repairs all legacy aliases from web/generated/msfa.wasm', async t => {
  const local = await fixture(t, {initialized: true});
  await writeFile(path.join(local.root, 'docs/js/msfa_dx7/wasm/msfa.wasm'), 'stale');
  await assert.rejects(checkRuntimeArtifacts({...local, ids: ['dx7']}), /mirror differs.*msfa/);
  const result = await syncRuntimeArtifacts({...local, ids: ['dx7']});
  assert.deepEqual(result.changed, ['docs/js/msfa_dx7/wasm/msfa.wasm']);
  await checkRuntimeArtifacts(local);
});

test('NativeFX ABI and catalog hashes detect changed canonical bytes; deliberate effect sync refreshes all aliases', async t => {
  const local = await fixture(t, {initialized: true});
  const original = await readFile(canonical(local, 'effects/gain.wasm'));
  // A valid custom section keeps ABI unchanged but changes the output hash.
  const changed = Buffer.concat([original, Buffer.from([0, 2, 1, 120])]);
  await writeFile(canonical(local, 'effects/gain.wasm'), changed);
  await assert.rejects(checkRuntimeArtifacts(local), /canonical differs: web\/generated\/runtime-artifacts.json/);
  const result = await syncRuntimeArtifacts({...local, ids: ['native_audio_effect']});
  assert.equal(result.changed.length, 5);
  await checkRuntimeArtifacts(local);
  assert.deepEqual(await readFile(path.join(local.root, 'web/native_audio_effect.wasm')), changed);
  await writeFile(canonical(local, 'effects/gain.wasm'), await readFile(canonical(local, 'msfa.wasm')));
  await assert.rejects(syncRuntimeArtifacts({...local, ids: ['native_audio_effect']}), /no application effect ABI/);
  assert.deepEqual(await readFile(path.join(local.root, 'web/native_audio_effect.wasm')), changed);
});

test('PS1 supplemental receipt must match the current fixed SDK and actual outputs', async t => {
  const local = await fixture(t, {initialized: true});
  const report = JSON.parse(await readFile(canonical(local, 'ps1_spu_build.json')));
  report.outputs['ps1_spu_wasm.wasm'].sha256 = '0'.repeat(64);
  await writeFile(canonical(local, 'ps1_spu_build.json'), JSON.stringify(report));
  await assert.rejects(syncRuntimeArtifacts({...local, ids: ['ps1_spu']}), /PS1 SPU receipt output hash\/size mismatch/);
});

test('packaging copies only verified canonical bytes and can select a generated-only subset', async t => {
  const local = await fixture(t, {initialized: true});
  await writeFile(deployed(local, 'ym2612_wasm.js'), 'stale public mirror is not an input');
  const destination = path.join(local.temporary, 'package/generated');
  const result = await copyRuntimeArtifacts({...local, destination, ids: ['ym2612'], includeMetadata: false});
  assert.deepEqual(result.files, ['ym2612_wasm.js', 'ym2612_wasm.wasm']);
  assert.deepEqual(await readFile(path.join(destination, 'ym2612_wasm.js')), await readFile(canonical(local, 'ym2612_wasm.js')));
  assert.equal(await readFile(deployed(local, 'ym2612_wasm.js'), 'utf8'), 'stale public mirror is not an input');
  await assert.rejects(copyRuntimeArtifacts({...local, destination: canonical(local, '')}), /overlaps/);
  await assert.rejects(copyRuntimeArtifacts({...local, destination: path.join(local.root, 'third_party')}), /overlaps/);
});

test('sync rejects escaping or symlinked destination paths before any mirror writes', async t => {
  const local = await fixture(t, {initialized: true});
  const outside = path.join(local.temporary, 'outside.js');
  await writeFile(outside, 'keep');
  await rm(deployed(local, 'ym2612_wasm.js'));
  await symlink(outside, deployed(local, 'ym2612_wasm.js'));
  await assert.rejects(syncRuntimeArtifacts({...local, ids: ['ym2612']}), /symlink runtime destination/);
  assert.equal(await readFile(outside, 'utf8'), 'keep');
});

test('unknown selections and malformed CLI options never broaden the copy scope', async () => {
  for (const ids of [['unknown'], [], ['dx7', 'msfa'], ['ym2612', 'ym2612']])
    await assert.rejects(listRuntimeArtifactFiles({root, ids}), /IDs|ID|nonempty/);
  assert.deepEqual(parseRuntimeArtifactArguments(['--check', '--only', 'ym2612', '--only', 'native_audio_effect']),
    {mode: 'check', ids: ['ym2612', 'native_audio_effect']});
  for (const args of [['--check', '--import-existing'], ['--only'], ['--import-existing', '--only', 'ym2612'],
    ['--help', '--check'], ['--root', '.','--root', '.'], ['--unknown']])
    assert.throws(() => parseRuntimeArtifactArguments(args));
});

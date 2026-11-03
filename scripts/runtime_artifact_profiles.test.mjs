import test from 'node:test';
import assert from 'node:assert/strict';
import {cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {getRuntimeArtifactManifest, listRuntimeArtifactFiles} from './runtime_artifacts.mjs';
import {copyRuntimeArtifactProfile, runtimeArtifactProfiles} from './runtime_artifact_profiles.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
async function temporary(t) {
  const directory = await mkdtemp(join(tmpdir(), 'tetorica-runtime-profile-'));
  t.after(() => rm(directory, {recursive: true, force: true}));
  return directory;
}
async function absent(path) {
  await assert.rejects(readFile(path), {code: 'ENOENT'});
}

test('full profile includes every runtime; application subsets retain their previous chip coverage', async () => {
  const {artifacts} = await getRuntimeArtifactManifest({root});
  const available = artifacts.map(artifact => artifact.id).sort();
  assert.deepEqual([...runtimeArtifactProfiles.full].sort(), available);
  for (const selected of Object.values(runtimeArtifactProfiles)) {
    assert.equal(new Set(selected).size, selected.length);
    assert(selected.every(id => available.includes(id)));
  }
  assert.equal(runtimeArtifactProfiles.full.length, 34);
  assert.equal(runtimeArtifactProfiles.playground.length, 28);
  assert.equal(runtimeArtifactProfiles.analyzer.length, 26);
  assert.equal(runtimeArtifactProfiles.synth.length, 9);
  for (const id of ['cdda', 'msm5205', 'ps1_spu', 'scsp', 'dx7'])
    assert(runtimeArtifactProfiles.playground.includes(id), id);
  for (const id of ['ps1_spu', 'scsp', 'dx7'])
    assert(!runtimeArtifactProfiles.analyzer.includes(id), id);
});

for (const layout of ['flat', 'js']) {
  test(`full ${layout} staging keeps legacy asset URLs and exact canonical bytes`, async t => {
    const directory = await temporary(t);
    const stage = join(directory, 'stage');
    const {artifacts} = await getRuntimeArtifactManifest({root});
    await copyRuntimeArtifactProfile('full', stage, {root, layout});
    const js = layout === 'flat' ? stage : join(stage, 'js');
    for (const artifact of artifacts) for (const file of artifact.files) {
      const target = artifact.id === 'native_audio_effect'
        ? join(js, 'native_audio_effect.wasm')
        : artifact.id === 'dx7'
          ? join(js, 'msfa_dx7/wasm/msfa.wasm')
          : join(stage, 'generated', file.path);
      assert.deepEqual(await readFile(target), await readFile(join(root, file.canonical)), target);
    }
    assert.deepEqual(await readFile(join(stage, 'generated/ps1_spu_build.json')),
      await readFile(join(root, 'tetorica_src/runtime/generated/ps1_spu_build.json')));
    for (const name of ['LICENSE', 'THIRD_PARTY_NOTICES.md', 'README.vendor.md', 'src/index.js', 'src/dx7-worklet.js'])
      assert.deepEqual(await readFile(join(js, 'msfa_dx7', name)), await readFile(join(root, 'tetorica_src/runtime/msfa_dx7', name)));
    await absent(join(stage, 'generated/effects/gain.wasm'));
    await absent(join(stage, 'generated/msfa.wasm'));
    await absent(join(stage, 'generated/build-info.json'));
    await absent(join(stage, 'generated/runtime-artifacts.json'));
  });
}

for (const profile of ['playground', 'analyzer', 'synth']) {
  test(`${profile} staging contains exactly its selected generated files and required receipts`, async t => {
    const directory = await temporary(t);
    const stage = join(directory, profile);
    const {artifacts} = await getRuntimeArtifactManifest({root});
    await copyRuntimeArtifactProfile(profile, stage, {root});
    const selected = new Set(runtimeArtifactProfiles[profile]);
    const expected = artifacts.filter(artifact => selected.has(artifact.id)
      && !['dx7', 'native_audio_effect'].includes(artifact.id)).flatMap(artifact => artifact.files.map(file => file.path));
    if (selected.has('ps1_spu')) expected.push('ps1_spu_build.json');
    if (profile === 'playground') expected.push('build-info.json');
    assert.deepEqual((await readdir(join(stage, 'generated'))).sort(), expected.sort());
    for (const name of expected)
      assert.deepEqual(await readFile(join(stage, 'generated', name)), await readFile(join(root, 'tetorica_src/runtime/generated', name)));
    assert.deepEqual(await readFile(join(stage, 'js/native_audio_effect.wasm')),
      await readFile(join(root, 'tetorica_src/runtime/generated/effects/gain.wasm')));
    if (selected.has('dx7'))
      assert.deepEqual(await readFile(join(stage, 'js/msfa_dx7/wasm/msfa.wasm')),
        await readFile(join(root, 'tetorica_src/runtime/generated/msfa.wasm')));
    else await absent(join(stage, 'js/msfa_dx7/wasm/msfa.wasm'));
  });
}

test('invalid profiles or layouts cannot create a package stage', async t => {
  const directory = await temporary(t);
  const stage = join(directory, 'untouched');
  await assert.rejects(copyRuntimeArtifactProfile('../outside', stage), /Unknown runtime artifact profile/);
  await assert.rejects(copyRuntimeArtifactProfile('full', stage, {layout: '../outside'}), /Unknown runtime layout/);
  await assert.rejects(readdir(stage), {code: 'ENOENT'});
});

test('packaging rejects stale public mirrors or missing canonical outputs without repairing or staging', async t => {
  const directory = await temporary(t);
  const checkout = join(directory, 'checkout');
  await mkdir(join(checkout, 'third_party'), {recursive: true});
  await cp(join(root, 'third_party/tetorica-soundchip-native'), join(checkout, 'third_party/tetorica-soundchip-native'), {recursive: true});
  await cp(join(root, 'third_party/soundchip-sdk.json'), join(checkout, 'third_party/soundchip-sdk.json'));
  await cp(join(root, 'tetorica_src/runtime/generated'), join(checkout, 'tetorica_src/runtime/generated'), {recursive: true});
  for (const file of await listRuntimeArtifactFiles({root, ids: runtimeArtifactProfiles.synth})) {
    for (const mirror of file.mirrors) {
      const target = join(checkout, mirror);
      await mkdir(dirname(target), {recursive: true});
      await cp(file.source, target);
    }
  }
  const original = await readFile(join(checkout, 'tetorica_src/runtime/generated/ym2612_wasm.wasm'));
  const mirror = join(checkout, 'docs/generated/ym2612_wasm.wasm');
  const stale = Buffer.concat([original, Buffer.from('stale public output')]);
  await writeFile(mirror, stale);
  const stage = join(directory, 'untouched');
  await assert.rejects(copyRuntimeArtifactProfile('synth', stage, {root: checkout}), /mirror differs: docs\/generated\/ym2612_wasm.wasm/);
  assert.deepEqual(await readFile(mirror), stale, 'Packaging must not silently synchronize public outputs');
  assert.deepEqual(await readFile(join(checkout, 'tetorica_src/runtime/generated/ym2612_wasm.wasm')), original);
  await assert.rejects(readdir(stage), {code: 'ENOENT'});
  await writeFile(mirror, original);
  await rm(join(checkout, 'tetorica_src/runtime/generated/ym2612_wasm.wasm'));
  await assert.rejects(copyRuntimeArtifactProfile('synth', stage, {root: checkout}), /missing or extra JS\/WASM files|ENOENT/);
  assert.deepEqual(await readFile(mirror), original, 'Public output is never used as a canonical fallback');
  await assert.rejects(readdir(stage), {code: 'ENOENT'});
});

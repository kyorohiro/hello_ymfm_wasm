import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, readFile, writeFile, copyFile, rm, symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {WASM_SDK_ARTIFACT_IDS, loadWasmSdkInventory, verifyWasmBuildDirectory} from '../scripts/wasm_sdk_inventory.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const deployed = path.join(root, 'docs/generated');
const sdk = path.join(root, 'third_party/tetorica-soundchip-native');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const inventory = await loadWasmSdkInventory({root});
const original = JSON.parse(await readFile(path.join(deployed, 'build-info.json'), 'utf8'));

async function temporary(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'tetorica-wasm-inventory-'));
  t.after(() => rm(directory, {recursive: true, force: true}));
  return directory;
}

async function outputFixture(t) {
  const base = await temporary(t);
  const directory = path.join(base, 'outputs');
  await mkdir(directory);
  await Promise.all(inventory.builds.flatMap(artifact => artifact.outputs).map(name =>
    copyFile(path.join(deployed, name), path.join(directory, name))));
  const receipt = structuredClone(original);
  const save = () => writeFile(path.join(directory, 'build-info.json'), JSON.stringify(receipt));
  await save();
  return {base, directory, receipt, save};
}

async function sdkFixture(t, {sources = false} = {}) {
  const base = await temporary(t);
  const sdkRoot = path.join(base, 'third_party/tetorica-soundchip-native');
  await mkdir(sdkRoot, {recursive: true});
  await copyFile(path.join(root, 'third_party/soundchip-sdk.json'), path.join(base, 'third_party/soundchip-sdk.json'));
  const names = new Set(['RELEASE-MANIFEST.json', 'catalog/source_inventory.json']);
  if (sources) for (const artifact of inventory.builds) for (const name of artifact.sourcePaths) names.add(name);
  await Promise.all([...names].map(async name => {
    const target = path.join(sdkRoot, name);
    await mkdir(path.dirname(target), {recursive: true});
    await copyFile(path.join(sdk, name), target);
  }));
  // Re-signing test metadata exercises catalog validation; production checks use
  // the repository's fixed pin and never rewrite it.
  const editCatalog = async edit => {
    const catalogPath = path.join(sdkRoot, 'catalog/source_inventory.json');
    const catalog = JSON.parse(await readFile(catalogPath, 'utf8'));
    edit(catalog);
    const bytes = Buffer.from(JSON.stringify(catalog));
    await writeFile(catalogPath, bytes);
    const manifestPath = path.join(sdkRoot, 'RELEASE-MANIFEST.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    manifest.files['catalog/source_inventory.json'] = {sha256: sha256(bytes), size: bytes.length};
    const manifestBytes = Buffer.from(JSON.stringify(manifest));
    await writeFile(manifestPath, manifestBytes);
    const pinPath = path.join(base, 'third_party/soundchip-sdk.json');
    const pin = JSON.parse(await readFile(pinPath, 'utf8'));
    pin.manifestSha256 = sha256(manifestBytes);
    await writeFile(pinPath, JSON.stringify(pin));
  };
  return {root: base, sdkRoot, editCatalog};
}

test('loads the fixed 29-artifact inventory and freezes the validated recipe set', () => {
  assert.equal(inventory.artifacts.length, 29);
  assert.deepEqual(inventory.instruments.map(a=>a.id),['ps1_spu','scsp']);
  assert.equal(inventory.builds.length,33);
  assert.deepEqual(inventory.artifacts.map(artifact => artifact.id), WASM_SDK_ARTIFACT_IDS);
  assert.equal(inventory.artifacts.flatMap(artifact => artifact.outputs).length, 57);
  assert.deepEqual(inventory.artifacts.find(artifact => artifact.id === 'dx7').outputs, ['msfa.wasm']);
  assert.equal(inventory.artifacts.find(artifact => artifact.id === 'nuked_opn2').compilerCommand, 'emcc');
  assert.throws(() => inventory.artifacts[0].sourcePaths.push('forged.cpp'), TypeError);
});

test('validates all actual receipts, pinned sources and WASM ABI descriptors without Emscripten', async () => {
  const summary = await verifyWasmBuildDirectory({root, directory: deployed, inventory, allowApplicationAudio: true});
  assert.equal(summary.artifactCount, 29);
  assert.equal(summary.outputCount, 57);
  assert.equal(summary.verifiedSourceCount, new Set(inventory.builds.flatMap(artifact => artifact.sourcePaths)).size);
  assert.equal(summary.sourcesVerified, true);
  assert.equal(summary.applicationAudioCount, 2);
  assert.equal(summary.applicationAudioOutputCount, 4);
  assert.equal(summary.instrumentCount,2);assert.equal(summary.instrumentOutputCount,4);
  assert.deepEqual(summary.instruments.map(a=>a.id),['ps1_spu','scsp']);
  const dx7 = summary.artifacts.find(artifact => artifact.id === 'dx7');
  assert.deepEqual(dx7.wasm.imports, []);
  assert.ok(dx7.wasm.exports.some(entry => entry.name === 'dx7_render' && entry.kind === 'function'));
  const fm = summary.artifacts.find(artifact => artifact.id === 'ym2612');
  assert.ok(fm.wasm.exports.some(entry => entry.name === 'ym2612_generate' && entry.kind === 'function'));
  assert.ok(fm.wasm.imports.every(entry => typeof entry.module === 'string' && typeof entry.name === 'string'));
});

test('accepts an isolated copied build directory and explicitly skipped source I/O', async t => {
  const fixture = await outputFixture(t);
  const summary = await verifyWasmBuildDirectory({...fixture, inventory, verifySources: false});
  assert.equal(summary.outputCount, 57);
  assert.equal(summary.verifiedSourceCount, 0);
  assert.equal(summary.sourcesVerified, false);
  assert.equal(summary.applicationAudioCount, inventory.applicationAudio.length);
  assert.equal(summary.applicationAudioOutputCount, inventory.applicationAudio.length * 2);
  assert.deepEqual(summary.applicationAudio.map(a => a.id), inventory.applicationAudio.map(a => a.id));
});

async function applicationFixture(t, ids = ['cdda', 'msm5205']) {
  const fixture = await outputFixture(t);
  const oldSDK = await sdkFixture(t);
  await oldSDK.editCatalog(catalog => { delete catalog.applicationAudio; });
  const historicalInventory = await loadWasmSdkInventory(oldSDK);
  fixture.receipt.artifacts = fixture.receipt.artifacts.filter(a => !['cdda', 'msm5205'].includes(a.id));
  for (const id of ['cdda', 'msm5205']) for (const ext of ['js', 'wasm'])
    await rm(path.join(fixture.directory, `${id}_wasm.${ext}`), {force: true});
  await fixture.save();
  for (const id of ids) for (const ext of ['js', 'wasm']) {
    const name = `${id}_wasm.${ext}`;
    await copyFile(path.join(deployed, name), path.join(fixture.directory, name));
  }
  return {...fixture, inventory: historicalInventory};
}

test('historical SDK validation rejects unpinned application pairs without explicit opt-in', async t => {
  const fixture = await applicationFixture(t);
  await assert.rejects(verifyWasmBuildDirectory({...fixture, verifySources: false}), /missing or extra/);
});

test('explicit application opt-in reports the two known devices separately with actual byte hashes and ABI', async t => {
  const fixture = await applicationFixture(t);
  const summary = await verifyWasmBuildDirectory({...fixture, inventory: fixture.inventory, verifySources: false, allowApplicationAudio: true});
  assert.equal(summary.artifactCount, 29); assert.equal(summary.outputCount, 57);
  assert.equal(summary.applicationAudioCount, 2); assert.equal(summary.applicationAudioOutputCount, 4);
  assert.deepEqual(summary.applicationAudio.map(a => a.id), ['cdda', 'msm5205']);
  for (const artifact of summary.applicationAudio) {
    assert.deepEqual(artifact.wasm.imports, []);
    assert(artifact.wasm.exports.some(entry => entry.name === `${artifact.id}_wasm_render`));
    for (const output of artifact.outputs) {
      const bytes = await readFile(path.join(fixture.directory, output.path));
      assert.deepEqual(output, {path: output.path, size: bytes.length, sha256: sha256(bytes)});
    }
  }
  assert(!summary.artifacts.some(a => a.id === 'cdda' || a.id === 'msm5205'));
});

test('application opt-in permits a complete known pair but never imports its JavaScript', async t => {
  const fixture = await applicationFixture(t, ['cdda']);
  await writeFile(path.join(fixture.directory, 'cdda_wasm.js'), 'throw new Error("metadata validation must not execute generated JS");');
  const summary = await verifyWasmBuildDirectory({...fixture, inventory: fixture.inventory, verifySources: false, allowApplicationAudio: true});
  assert.equal(summary.applicationAudioCount, 1); assert.equal(summary.applicationAudioOutputCount, 2);
  assert.deepEqual(summary.applicationAudio.map(a => a.id), ['cdda']);
});

test('application opt-in rejects each partial known pair', async t => {
  for (const id of ['cdda', 'msm5205']) for (const ext of ['js', 'wasm']) {
    const fixture = await applicationFixture(t, [id]);
    await rm(path.join(fixture.directory, `${id}_wasm.${ext}`));
    await assert.rejects(verifyWasmBuildDirectory({...fixture, inventory: fixture.inventory, verifySources: false, allowApplicationAudio: true}),
      /Application audio output pair is incomplete/);
  }
});

test('application opt-in still rejects unknown extra JS/WASM outputs', async t => {
  const fixture = await applicationFixture(t);
  await writeFile(path.join(fixture.directory, 'another_audio_wasm.js'), 'throw new Error("never execute");');
  await assert.rejects(verifyWasmBuildDirectory({...fixture, inventory: fixture.inventory, verifySources: false, allowApplicationAudio: true}), /missing or extra/);
});

test('application opt-in rejects internal and external symbolic links for either output', async t => {
  for (const outside of [false, true]) for (const ext of ['js', 'wasm']) {
    const fixture = await applicationFixture(t, ['cdda']);
    const name = `cdda_wasm.${ext}`, target = path.join(outside ? fixture.base : fixture.directory, 'source.txt');
    await copyFile(path.join(fixture.directory, name), target);
    await rm(path.join(fixture.directory, name));
    await symlink(target, path.join(fixture.directory, name));
    await assert.rejects(verifyWasmBuildDirectory({...fixture, inventory: fixture.inventory, verifySources: false, allowApplicationAudio: true}),
      /Application audio output must be a regular file, not a symlink/);
  }
});

test('application opt-in rejects malformed and substituted application WASM despite recording fresh hashes', async t => {
  for (const bytes of [Buffer.from('not WASM'), await readFile(path.join(deployed, 'msm5205_wasm.wasm'))]) {
    const fixture = await applicationFixture(t, ['cdda']);
    await writeFile(path.join(fixture.directory, 'cdda_wasm.wasm'), bytes);
    await assert.rejects(verifyWasmBuildDirectory({...fixture, inventory: fixture.inventory, verifySources: false, allowApplicationAudio: true}),
      /Invalid application audio WASM|no standalone cdda ABI/);
  }
});

test('rejects non-boolean application audio opt-ins', async () => {
  await assert.rejects(verifyWasmBuildDirectory({directory: deployed, inventory, allowApplicationAudio: 'true'}),
    /allowApplicationAudio must be boolean/);
});

test('accepts EMXX/EMCC wrapper paths while preserving compiler metadata', async t => {
  const fixture = await outputFixture(t);
  fixture.receipt.artifacts[0].compiler = {command: '/opt/custom/emxx-wrapper', version: 'custom wrapper 1.0'};
  await fixture.save();
  const summary = await verifyWasmBuildDirectory({...fixture, inventory, verifySources: false});
  assert.equal(summary.artifacts[0].compiler.command, '/opt/custom/emxx-wrapper');
});

test('requires WonderSwan in the central SDK receipt even if an old standalone receipt is present', async t => {
  const fixture = await outputFixture(t);
  const record = fixture.receipt.artifacts.find(artifact => artifact.id === 'wonderswan');
  fixture.receipt.artifacts = fixture.receipt.artifacts.filter(artifact => artifact.id !== 'wonderswan');
  await fixture.save();
  await writeFile(path.join(fixture.directory, 'wonderswan_build-info.json'), JSON.stringify({
    schemaVersion: 1, artifact: 'wonderswan',
    outputs: record.outputs.map(({path, size, sha256}) => ({path, bytes: size, sha256})),
  }));
  await assert.rejects(verifyWasmBuildDirectory({...fixture, inventory}), new RegExp(`exactly ${inventory.builds.length} artifacts`));
});

test('requires both WonderSwan output files in every SDK build', async t => {
  for (const name of ['wonderswan_wasm.js', 'wonderswan_wasm.wasm']) {
    const fixture = await outputFixture(t);
    await rm(path.join(fixture.directory, name));
    await assert.rejects(verifyWasmBuildDirectory({...fixture, inventory}), /missing or extra/);
  }
});

test('requires both POKEY output files in every SDK build', async t => {
  for (const name of ['pokey_wasm.js', 'pokey_wasm.wasm']) {
    const fixture = await outputFixture(t);
    await rm(path.join(fixture.directory, name));
    await assert.rejects(verifyWasmBuildDirectory({...fixture, inventory}), /missing or extra/);
  }
});

test('rejects another sound-chip ABI substituted for POKEY despite matching output hashes', async t => {
  const fixture = await outputFixture(t);
  const bytes = await readFile(path.join(fixture.directory, 'ay8910_wasm.wasm'));
  await writeFile(path.join(fixture.directory, 'pokey_wasm.wasm'), bytes);
  Object.assign(fixture.receipt.artifacts.find(artifact => artifact.id === 'pokey').outputs.find(output => output.path === 'pokey_wasm.wasm'),
    {size: bytes.length, sha256: sha256(bytes)});
  await fixture.save();
  await assert.rejects(verifyWasmBuildDirectory({...fixture, inventory}), /WASM output has no POKEY ABI/);
});

test('rejects WonderSwan output byte changes with unchanged size', async t => {
  const fixture = await outputFixture(t);
  const target = path.join(fixture.directory, 'wonderswan_wasm.wasm');
  const bytes = await readFile(target);
  bytes[bytes.length - 1] ^= 1;
  await writeFile(target, bytes);
  await assert.rejects(verifyWasmBuildDirectory({...fixture, inventory}),
    /Output hash\/size mismatch: wonderswan_wasm.wasm/);
});

test('rejects another valid sound-chip WASM substituted for WonderSwan despite matching output metadata', async t => {
  const fixture = await outputFixture(t);
  const bytes = await readFile(path.join(fixture.directory, 'ay8910_wasm.wasm'));
  await writeFile(path.join(fixture.directory, 'wonderswan_wasm.wasm'), bytes);
  Object.assign(fixture.receipt.artifacts.find(artifact => artifact.id === 'wonderswan').outputs.find(output => output.path === 'wonderswan_wasm.wasm'),
    {size: bytes.length, sha256: sha256(bytes)});
  await fixture.save();
  await assert.rejects(verifyWasmBuildDirectory({...fixture, inventory}),
    /WASM output has no WonderSwan ABI: wonderswan_wasm.wasm/);
});

test('rejects WonderSwan output symlinked outside the verified directory', async t => {
  const fixture = await outputFixture(t);
  const name = 'wonderswan_wasm.wasm';
  const outside = path.join(fixture.base, name);
  await copyFile(path.join(fixture.directory, name), outside);
  await rm(path.join(fixture.directory, name));
  await symlink(outside, path.join(fixture.directory, name));
  await assert.rejects(verifyWasmBuildDirectory({...fixture, inventory}), /escapes its directory/);
});

const receiptMutations = [
  ['wrong schema', receipt => { receipt.schemaVersion = 2; }, /schema 1/],
  ['missing artifact', receipt => { receipt.artifacts.pop(); }, new RegExp(`exactly ${inventory.builds.length}`)],
  ['extra artifact', receipt => { receipt.artifacts.push(structuredClone(receipt.artifacts[0])); }, new RegExp(`exactly ${inventory.builds.length}`)],
  ['duplicate artifact', receipt => { receipt.artifacts[1] = structuredClone(receipt.artifacts[0]); }, /exactly once/],
  ['unknown artifact', receipt => { receipt.artifacts[0].id = 'unknown'; }, /exactly once/],
  ['wrong format', receipt => { receipt.artifacts[0].format = 'standalone-wasm'; }, /format mismatch/],
  ['missing output', receipt => { receipt.artifacts[0].outputs.pop(); }, /output list/],
  ['extra output', receipt => { receipt.artifacts[0].outputs.push(structuredClone(receipt.artifacts[0].outputs[0])); }, /output list/],
  ['duplicate output', receipt => { receipt.artifacts[0].outputs[1] = structuredClone(receipt.artifacts[0].outputs[0]); }, /Unexpected receipt output/],
  ['reordered outputs', receipt => { receipt.artifacts[0].outputs.reverse(); }, /Unexpected receipt output/],
  ['standalone loader injection', receipt => { receipt.artifacts.find(a => a.id === 'dx7').outputs.push({path: 'msfa.js', sha256: '0'.repeat(64), size: 1}); }, /output list/],
  ['output traversal', receipt => { receipt.artifacts[0].outputs[0].path = '../outside.js'; }, /Unsafe output path/],
  ['output absolute path', receipt => { receipt.artifacts[0].outputs[0].path = '/outside.js'; }, /Unsafe output path/],
  ['output Windows path', receipt => { receipt.artifacts[0].outputs[0].path = 'C:\\outside.js'; }, /Unsafe output path/],
  ['output forged size', receipt => { receipt.artifacts[0].outputs[0].size++; }, /Output hash\/size mismatch/],
  ['output forged digest', receipt => { receipt.artifacts[0].outputs[0].sha256 = '0'.repeat(64); }, /Output hash\/size mismatch/],
  ['oversized output declaration', receipt => { receipt.artifacts[0].outputs[0].size = Number.MAX_SAFE_INTEGER; }, /Invalid .* output record/],
  ['unexpected output field', receipt => { receipt.artifacts[0].outputs[0].url = 'https://example.invalid/'; }, /Unexpected receipt output/],
  ['missing source', receipt => { receipt.artifacts[0].sourceFiles.pop(); }, /differ from pinned/],
  ['duplicate source', receipt => { receipt.artifacts[0].sourceFiles[1] = structuredClone(receipt.artifacts[0].sourceFiles[0]); }, /differ from pinned/],
  ['reordered source', receipt => { receipt.artifacts[0].sourceFiles.reverse(); }, /differ from pinned/],
  ['source traversal', receipt => { receipt.artifacts[0].sourceFiles[0].path = '../escape.cpp'; }, /Unsafe source path/],
  ['source null byte', receipt => { receipt.artifacts[0].sourceFiles[0].path = 'vendor/evil\0.cpp'; }, /Unsafe source path/],
  ['unexpected source field', receipt => { receipt.artifacts[0].sourceFiles[0].source = 'elsewhere'; }, /Unexpected source fields/],
  ['forged source and matching fingerprint', receipt => {
    receipt.artifacts[0].sourceFiles[0].sha256 = '0'.repeat(64);
    receipt.artifacts[0].sourceFingerprint = sha256(JSON.stringify(receipt.artifacts[0].sourceFiles));
  }, /differ from pinned/],
  ['forged fingerprint', receipt => { receipt.artifacts[0].sourceFingerprint = '0'.repeat(64); }, /Source fingerprint mismatch/],
  ['absent compiler', receipt => { delete receipt.artifacts[0].compiler; }, /Invalid compiler metadata/],
  ['blank compiler command', receipt => { receipt.artifacts[0].compiler.command = '  '; }, /Invalid compiler metadata/],
  ['blank compiler version', receipt => { receipt.artifacts[0].compiler.version = ''; }, /Invalid compiler metadata/],
];

for (const [name, mutate, expected] of receiptMutations) {
  test(`rejects receipt ${name}`, async t => {
    const fixture = await outputFixture(t);
    mutate(fixture.receipt);
    await fixture.save();
    await assert.rejects(verifyWasmBuildDirectory({...fixture, inventory, verifySources: false}), expected);
  });
}

test('rejects missing actual outputs before using receipt claims', async t => {
  const fixture = await outputFixture(t);
  await rm(path.join(fixture.directory, 'ym2612_wasm.wasm'));
  await assert.rejects(verifyWasmBuildDirectory({...fixture, inventory}), /missing or extra/);
});

test('rejects extra actual JS/WASM files not described by the catalog', async t => {
  const fixture = await outputFixture(t);
  await writeFile(path.join(fixture.directory, 'rogue.js'), 'throw new Error("must not execute");');
  await assert.rejects(verifyWasmBuildDirectory({...fixture, inventory}), /missing or extra/);
});

test('rejects tampered output bytes even when declared size is unchanged', async t => {
  const fixture = await outputFixture(t);
  const target = path.join(fixture.directory, 'ym2612_wasm.wasm');
  const bytes = await readFile(target);
  bytes[bytes.length - 1] ^= 1;
  await writeFile(target, bytes);
  await assert.rejects(verifyWasmBuildDirectory({...fixture, inventory}), /Output hash\/size mismatch/);
});

test('rejects invalid WASM even with a self-consistent forged output receipt', async t => {
  const fixture = await outputFixture(t);
  const output = fixture.receipt.artifacts[0].outputs.find(entry => entry.path.endsWith('.wasm'));
  const bytes = Buffer.from('this is not WASM');
  await writeFile(path.join(fixture.directory, output.path), bytes);
  Object.assign(output, {size: bytes.length, sha256: sha256(bytes)});
  await fixture.save();
  await assert.rejects(verifyWasmBuildDirectory({...fixture, inventory, verifySources: false}), /Invalid WASM output/);
});

test('rejects empty valid WASM with no sound-chip ABI despite a matching receipt', async t => {
  const fixture = await outputFixture(t);
  const output = fixture.receipt.artifacts[0].outputs.find(entry => entry.path.endsWith('.wasm'));
  const bytes = Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]);
  await writeFile(path.join(fixture.directory, output.path), bytes);
  Object.assign(output, {size: bytes.length, sha256: sha256(bytes)});
  await fixture.save();
  await assert.rejects(verifyWasmBuildDirectory({...fixture, inventory, verifySources: false}), /no sound-chip ABI/);
});

test('rejects output symlinks escaping the verified output directory', async t => {
  const fixture = await outputFixture(t);
  const name = 'ay8910_wasm.js';
  const outside = path.join(fixture.base, name);
  await copyFile(path.join(deployed, name), outside);
  await rm(path.join(fixture.directory, name));
  await symlink(outside, path.join(fixture.directory, name));
  await assert.rejects(verifyWasmBuildDirectory({...fixture, inventory}), /escapes its directory/);
});

test('rejects a receipt symlink escaping the output directory', async t => {
  const fixture = await outputFixture(t);
  const outside = path.join(fixture.base, 'receipt.json');
  await writeFile(outside, JSON.stringify(fixture.receipt));
  await rm(path.join(fixture.directory, 'build-info.json'));
  await symlink(outside, path.join(fixture.directory, 'build-info.json'));
  await assert.rejects(verifyWasmBuildDirectory({...fixture, inventory}), /escapes its directory/);
});

test('verifies source bytes against the pinned snapshot and can explicitly skip only that I/O', async t => {
  const fixture = await sdkFixture(t, {sources: true});
  const local = await loadWasmSdkInventory(fixture);
  const target = path.join(fixture.sdkRoot, 'scripts/build-wasm.sh');
  await writeFile(target, '# tampered SDK source\n');
  await assert.rejects(verifyWasmBuildDirectory({directory: deployed, inventory: local, allowApplicationAudio: true}), /SDK source hash\/size mismatch/);
  const skipped = await verifyWasmBuildDirectory({directory: deployed, inventory: local, verifySources: false, allowApplicationAudio: true});
  assert.equal(skipped.sourcesVerified, false);
});

test('rejects source symlinks escaping the SDK even if external bytes have the pinned hash', async t => {
  const fixture = await sdkFixture(t, {sources: true});
  const local = await loadWasmSdkInventory(fixture);
  const name = 'scripts/build-wasm.sh';
  const outside = path.join(fixture.root, 'outside-build.sh');
  await copyFile(path.join(sdk, name), outside);
  await rm(path.join(fixture.sdkRoot, name));
  await symlink(outside, path.join(fixture.sdkRoot, name));
  await assert.rejects(verifyWasmBuildDirectory({directory: deployed, inventory: local, allowApplicationAudio: true}), /escapes its directory/);
});

test('rejects a source catalog that differs from the manifest', async t => {
  const fixture = await sdkFixture(t);
  await writeFile(path.join(fixture.sdkRoot, 'catalog/source_inventory.json'), '{}');
  await assert.rejects(loadWasmSdkInventory(fixture), /catalog differs from the fixed manifest/);
});

test('rejects a manifest that differs from the pin', async t => {
  const fixture = await sdkFixture(t);
  await writeFile(path.join(fixture.sdkRoot, 'RELEASE-MANIFEST.json'), '{}');
  await assert.rejects(loadWasmSdkInventory(fixture), /manifest differs from the fixed pin/);
});

const catalogMutations = [
  ['missing build', catalog => catalog.artifacts.pop(), new RegExp(`exactly ${inventory.artifacts.length}`)],
  ['duplicate build', catalog => { catalog.artifacts[0] = structuredClone(catalog.artifacts[1]); }, /supported 29/],
  ['unknown build', catalog => { catalog.artifacts[0].id = 'unexpected'; }, /supported 29/],
  ['unsafe build script', catalog => { catalog.artifacts[0].buildScript = '../build.sh'; }, /Unexpected build script/],
  ['wrong standalone format', catalog => { catalog.artifacts.find(a => a.id === 'dx7').format = 'emscripten-es-module'; }, /Unexpected artifact format/],
  ['unsafe source path', catalog => { catalog.artifacts[0].sourceFiles[0] = '../outside.cpp'; }, /Unsafe .* source files/],
  ['source absent from manifest', catalog => { catalog.artifacts[0].sourceFiles[0] = 'vendor/absent.cpp'; }, /absent from manifest/],
  ['missing build closure', catalog => { catalog.artifacts[0].buildFiles = [catalog.artifacts[0].buildScript]; }, /Incomplete build files/],
  ['unsafe imported output', catalog => { catalog.artifacts[0].importedFiles[0].path = '../outside.js'; }, /Unexpected imported output/],
];

for (const [name, mutate, expected] of catalogMutations) {
  test(`rejects catalog ${name}`, async t => {
    const fixture = await sdkFixture(t);
    await fixture.editCatalog(mutate);
    await assert.rejects(loadWasmSdkInventory(fixture), expected);
  });
}

test('rejects caller-forged inventory objects', async () => {
  await assert.rejects(verifyWasmBuildDirectory({directory: deployed, inventory: structuredClone(inventory)}),
    /must be returned by loadWasmSdkInventory/);
});

test('rejects non-boolean source verification switches', async () => {
  await assert.rejects(verifyWasmBuildDirectory({directory: deployed, inventory, verifySources: 'false'}),
    /verifySources must be boolean/);
});


test('PS1 instrument is separate from generic chip IDs and requires the full source/ABI closure', async t=>{
  for(const edit of [
    catalog=>catalog.instruments.push(structuredClone(catalog.instruments[0])),
    catalog=>catalog.instruments[0].chipIds.push('ps1'),
    catalog=>catalog.instruments[0].sourceFiles.pop(),
    catalog=>catalog.instruments[0].licenseFiles=[],
    catalog=>catalog.instruments[0].role='sound-chip',
  ]) {
    const fixture=await sdkFixture(t);await fixture.editCatalog(edit);
    await assert.rejects(loadWasmSdkInventory(fixture),/instrument|license files/i);
  }
  const fixture=await outputFixture(t);
  const record=fixture.receipt.artifacts.find(a=>a.id==='ps1_spu');
  const bytes=await readFile(path.join(deployed,'wonderswan_wasm.wasm'));
  await writeFile(path.join(fixture.directory,'ps1_spu_wasm.wasm'),bytes);
  Object.assign(record.outputs.find(a=>a.path==='ps1_spu_wasm.wasm'),{size:bytes.length,sha256:sha256(bytes)});
  await fixture.save();
  await assert.rejects(verifyWasmBuildDirectory({...fixture,inventory,verifySources:false}),/PS1|ps1_spu|instrument/i);
});

test('SCSP requires complete instrument sources, license and its own actual WASM exports',async t=>{
  for(const edit of [
    item=>item.sourceFiles.pop(),item=>item.licenseFiles=[],item=>item.chipIds.push('scsp'),
    item=>item.kind='generic PCM',item=>item.role='sound-chip',
  ]) {
    const fixture=await sdkFixture(t);await fixture.editCatalog(catalog=>edit(catalog.instruments.find(a=>a.id==='scsp')));
    await assert.rejects(loadWasmSdkInventory(fixture),/instrument|license files/i);
  }
  const fixture=await outputFixture(t),record=fixture.receipt.artifacts.find(a=>a.id==='scsp');
  const bytes=await readFile(path.join(deployed,'wonderswan_wasm.wasm'));
  await writeFile(path.join(fixture.directory,'scsp_wasm.wasm'),bytes);
  Object.assign(record.outputs.find(o=>o.path==='scsp_wasm.wasm'),{size:bytes.length,sha256:sha256(bytes)});
  await fixture.save();
  await assert.rejects(verifyWasmBuildDirectory({...fixture,inventory,verifySources:false}),/SCSP ABI/);
});

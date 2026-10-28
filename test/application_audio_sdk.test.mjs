// Receipt/security checks against real deployed audio binaries. Fixture signing
// deliberately models a new pinned source release without importing a candidate
// into the checkout or depending on a sibling SDK repository.
import test from 'node:test';
import assert from 'node:assert/strict';
import {copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadWasmSdkInventory, verifyWasmBuildDirectory} from '../scripts/wasm_sdk_inventory.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const installed = await loadWasmSdkInventory({root});
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => Buffer.from(JSON.stringify(value));
const ids = ['cdda', 'msm5205'];

async function fixture(t, {sources = false} = {}) {
  const base = await mkdtemp(join(tmpdir(), 'tetorica-application-sdk-'));
  t.after(() => rm(base, {recursive: true, force: true}));
  const sdkRoot = join(base, 'third_party/tetorica-soundchip-native'), directory = join(base, 'outputs');
  await mkdir(sdkRoot, {recursive: true}); await mkdir(directory);
  const catalog = JSON.parse(await readFile(join(installed.sdkRoot, 'catalog/source_inventory.json')));
  const manifest = JSON.parse(await readFile(join(installed.sdkRoot, 'RELEASE-MANIFEST.json')));
  const pin = structuredClone(installed.pin);
  const put = async (name, bytes) => {
    const target = join(sdkRoot, name); await mkdir(dirname(target), {recursive: true});
    await writeFile(target, bytes); manifest.files[name] = {size: bytes.length, sha256: sha(bytes)};
  };
  if (sources) for (const name of new Set(installed.builds.flatMap(a => a.sourcePaths)))
    await put(name, await readFile(join(installed.sdkRoot, name)));
  catalog.applicationAudio = [];
  for (const id of ids) {
    const artifact = {id, role: 'application-audio', kind: id === 'cdda' ? 'pcm-device' : 'adpcm-device',
      chipIds: [], format: 'standalone-audio-wasm',
      sourceFiles: [`vendor/tetorica-${id}/${id}_pcm.c`, `vendor/tetorica-${id}/${id}_pcm.h`, `wasm/${id}_wasm.c`],
      buildScript: `scripts/build_${id}_wasm.sh`, buildFiles: [`scripts/build_${id}_wasm.sh`],
      licenseFiles: [`vendor/tetorica-${id}/LICENSE`, `vendor/tetorica-${id}/NOTICE.md`],
      memoryBytes: 131072, hostImports: 0};
    catalog.applicationAudio.push(artifact);
    for (const name of [...artifact.sourceFiles, ...artifact.buildFiles, ...artifact.licenseFiles]) {
      await put(name, await readFile(join(installed.sdkRoot, name)));
    }
  }
  const saveCatalog = async () => {
    await put('catalog/source_inventory.json', json(catalog));
    const bytes = json(manifest); await writeFile(join(sdkRoot, 'RELEASE-MANIFEST.json'), bytes);
    pin.manifestSha256 = sha(bytes); pin.fileCount = Object.keys(manifest.files).length + 1;
    await writeFile(join(base, 'third_party/soundchip-sdk.json'), json(pin));
  };
  await saveCatalog();
  const receipt = JSON.parse(await readFile(join(root, 'docs/generated/build-info.json')));
  receipt.artifacts = receipt.artifacts.filter(a => !ids.includes(a.id));
  for (const artifact of catalog.applicationAudio) {
    const sourceFiles = [...new Set([...artifact.sourceFiles, ...artifact.buildFiles])].sort()
      .map(path => ({path, sha256: manifest.files[path].sha256, size: manifest.files[path].size}));
    const outputs = [];
    for (const ext of ['js', 'wasm']) {
      const path = `${artifact.id}_wasm.${ext}`, bytes = await readFile(join(root, 'docs/generated', path));
      outputs.push({path, size: bytes.length, sha256: sha(bytes)});
    }
    receipt.artifacts.push({id: artifact.id, format: artifact.format, sourceFiles,
      sourceFingerprint: sha(JSON.stringify(sourceFiles)), outputs,
      compiler: {command: 'emcc', version: 'fixture metadata; deployed real WASM is unchanged'}});
  }
  receipt.artifacts.sort((a, b) => a.id.localeCompare(b.id));
  for (const artifact of receipt.artifacts) for (const output of artifact.outputs)
    await copyFile(join(root, 'docs/generated', output.path), join(directory, output.path));
  const save = () => writeFile(join(directory, 'build-info.json'), json(receipt));
  await save();
  return {root: base, sdkRoot, directory, catalog, manifest, receipt, put, saveCatalog, save};
}

const verify = async (f, options = {}) => verifyWasmBuildDirectory({directory: f.directory,
  inventory: await loadWasmSdkInventory({root: f.root}), verifySources: false, ...options});

test('new SDK requires all 32 receipts, pins audio and PS1 sources and keeps chip IDs separate', async t => {
  const f = await fixture(t, {sources: true}), inventory = await loadWasmSdkInventory({root: f.root});
  assert.equal(inventory.artifacts.length, 29); assert.equal(inventory.builds.length, 32);
  assert.deepEqual(inventory.applicationAudio.map(a => a.id), ids);
  assert.deepEqual(inventory.instruments.map(a => a.id), ['ps1_spu']);
  assert.deepEqual(inventory.instruments[0].chipIds, []);
  assert(!inventory.artifacts.some(a => a.id === 'ps1_spu'));
  assert(inventory.applicationAudio.every(a => a.compilerCommand === 'emcc'));
  const summary = await verify(f, {verifySources: true});
  assert.equal(summary.artifactCount, 29); assert.equal(summary.buildCount, 32);
  assert.equal(summary.outputCount, 57); assert.equal(summary.buildOutputCount, 63);
  assert.equal(summary.sdkApplicationAudioCount, 2); assert.equal(summary.applicationAudioCount, 2);
  assert.equal(summary.applicationAudioOutputCount, 4);
  assert.equal(summary.instrumentCount, 1); assert.equal(summary.instrumentOutputCount, 2);
  assert.deepEqual(summary.instruments.map(a => a.id), ['ps1_spu']);
  assert.equal(summary.verifiedSourceCount, new Set(inventory.builds.flatMap(a => a.sourcePaths)).size);
  for (const a of summary.applicationAudio) {
    assert.equal(a.format, 'standalone-audio-wasm'); assert.equal(a.sourceFiles.length, 4);
    assert.deepEqual(a.wasm.imports, []); assert.equal(a.sourceFingerprint.length, 64);
  }
});

test('new SDK does not make its audio receipts optional even with historical opt-in', async t => {
  for (const id of ids) {
    const f = await fixture(t); f.receipt.artifacts = f.receipt.artifacts.filter(a => a.id !== id); await f.save();
    await assert.rejects(verify(f, {allowApplicationAudio: true}), /exactly 32 artifacts/);
  }
});

test('new SDK rejects a missing audio output and unpinned extra modules', async t => {
  for (const id of ids) for (const ext of ['js', 'wasm']) {
    const f = await fixture(t); await rm(join(f.directory, `${id}_wasm.${ext}`));
    await assert.rejects(verify(f), /missing or extra/);
  }
  const f = await fixture(t); await writeFile(join(f.directory, 'other_audio.wasm'), Buffer.from([]));
  await assert.rejects(verify(f), /missing or extra/);
});

test('new SDK verifies audio output hashes but never executes generated JavaScript', async t => {
  const f = await fixture(t), name = 'cdda_wasm.js';
  const bytes = Buffer.from('throw new Error("untrusted generated loader must not execute");');
  await writeFile(join(f.directory, name), bytes);
  await assert.rejects(verify(f), /Output hash\/size mismatch/);
  const output = f.receipt.artifacts.find(a => a.id === 'cdda').outputs.find(a => a.path === name);
  Object.assign(output, {size: bytes.length, sha256: sha(bytes)}); await f.save();
  assert.equal((await verify(f)).applicationAudioCount, 2);
});

test('new SDK rejects forged audio source hashes even when their fingerprint is recomputed', async t => {
  const f = await fixture(t), a = f.receipt.artifacts.find(a => a.id === 'msm5205');
  a.sourceFiles[0].sha256 = '0'.repeat(64); a.sourceFingerprint = sha(JSON.stringify(a.sourceFiles)); await f.save();
  await assert.rejects(verify(f), /differ from pinned SDK inputs/);
});

test('new SDK reads and verifies the actual fixed audio source bytes', async t => {
  const f = await fixture(t, {sources: true});
  await writeFile(join(f.sdkRoot, 'vendor/tetorica-cdda/cdda_pcm.c'), '// modified\n');
  await assert.rejects(verify(f, {verifySources: true}), /SDK source hash\/size mismatch/);
});

test('new SDK rejects internal symbolic links for audio loaders and binaries', async t => {
  for (const ext of ['js', 'wasm']) {
    const f = await fixture(t), name = `msm5205_wasm.${ext}`, copy = join(f.directory, 'borrowed.txt');
    await copyFile(join(f.directory, name), copy); await rm(join(f.directory, name));
    await symlink(copy, join(f.directory, name));
    await assert.rejects(verify(f), /regular file, not a symlink/);
  }
});

test('new SDK rejects another valid audio ABI despite a matching forged binary receipt', async t => {
  const f = await fixture(t), bytes = await readFile(join(f.directory, 'msm5205_wasm.wasm'));
  await writeFile(join(f.directory, 'cdda_wasm.wasm'), bytes);
  Object.assign(f.receipt.artifacts.find(a => a.id === 'cdda').outputs[1], {size: bytes.length, sha256: sha(bytes)});
  await f.save(); await assert.rejects(verify(f), /no standalone cdda ABI/);
});

test('new SDK requires the full audio control ABI, including pause rather than just init/render', async t => {
  const f = await fixture(t), name = 'cdda_wasm.wasm';
  const bytes = Buffer.from(await readFile(join(f.directory, name)));
  const at = bytes.indexOf(Buffer.from('cdda_wasm_pause'));
  assert(at >= 0); bytes[at] = 'x'.charCodeAt(0);
  assert(new WebAssembly.Module(bytes));
  await writeFile(join(f.directory, name), bytes);
  Object.assign(f.receipt.artifacts.find(a => a.id === 'cdda').outputs[1], {size: bytes.length, sha256: sha(bytes)});
  await f.save(); await assert.rejects(verify(f), /no standalone cdda ABI/);
});

test('new SDK rejects host-imported memory despite the complete exported audio ABI', async t => {
  const f = await fixture(t), name = 'msm5205_wasm.wasm';
  const original = await readFile(join(f.directory, name)), sections = [original.subarray(0, 8)];
  const unsigned = start => { let at = start, value = 0, shift = 0, byte;
    do { byte = original[at++]; value += (byte & 127) * 2 ** shift; shift += 7; } while (byte & 128);
    return {value, next: at}; };
  // Replace the actual module's defined memory with an equivalent host import.
  // Function indices and the full control ABI remain valid and unchanged.
  let at = 8;
  while (at < original.length) {
    const start = at, section = original[at++], size = unsigned(at), end = size.next + size.value;
    if (section !== 5) sections.push(original.subarray(start, end));
    if (section === 1) {
      const payload = Buffer.from([1, 4, ...Buffer.from('host'), 6, ...Buffer.from('memory'), 2, 1, 2, 2]);
      sections.push(Buffer.concat([Buffer.from([2, payload.length]), payload]));
    }
    at = end;
  }
  const bytes = Buffer.concat(sections), module = new WebAssembly.Module(bytes);
  assert.deepEqual(WebAssembly.Module.imports(module), [{module: 'host', name: 'memory', kind: 'memory'}]);
  await writeFile(join(f.directory, name), bytes);
  Object.assign(f.receipt.artifacts.find(a => a.id === 'msm5205').outputs[1], {size: bytes.length, sha256: sha(bytes)});
  await f.save(); await assert.rejects(verify(f), /no standalone msm5205 ABI/);
});

function changeMemory(bytes, {minimum, maximum}) {
  bytes = Buffer.from(bytes);
  const leb = at => { let value = 0, shift = 0, b; do { b = bytes[at++]; value |= (b & 127) << shift; shift += 7; } while (b & 128); return [value, at]; };
  let at = 8;
  while (at < bytes.length) {
    const section = bytes[at++], [length, start] = leb(at); at = start + length;
    if (section !== 5) continue;
    const [count, countEnd] = leb(start), [flags, flagEnd] = leb(countEnd), [, minEnd] = leb(flagEnd);
    assert.equal(count, 1); assert.equal(flags, 1); assert.equal(minEnd, flagEnd + 1);
    if (minimum !== undefined) bytes[flagEnd] = minimum;
    if (maximum !== undefined) bytes[minEnd] = maximum;
    return bytes;
  }
  throw new Error('Fixture module has no memory section.');
}

for (const [label, memory, pattern] of [
  ['larger initial memory', {minimum: 3, maximum: 3}, /memory size differs/],
  ['growable memory', {maximum: 3}, /memory must be fixed/],
]) test(`new SDK rejects ${label} despite valid ABI and a matching binary receipt`, async t => {
  const f = await fixture(t), name = 'msm5205_wasm.wasm';
  const bytes = changeMemory(await readFile(join(f.directory, name)), memory);
  assert(new WebAssembly.Module(bytes));
  await writeFile(join(f.directory, name), bytes);
  Object.assign(f.receipt.artifacts.find(a => a.id === 'msm5205').outputs[1], {size: bytes.length, sha256: sha(bytes)});
  await f.save(); await assert.rejects(verify(f), pattern);
});

for (const [label, mutate, pattern] of [
  ['missing module', c => c.applicationAudio.pop(), /must contain cdda and msm5205 exactly once/],
  ['duplicate module', c => { c.applicationAudio[1] = structuredClone(c.applicationAudio[0]); }, /exactly once/],
  ['invented chip ID', c => { c.applicationAudio[0].chipIds = ['cdda']; }, /Invalid application audio metadata/],
  ['wrong format', c => { c.applicationAudio[0].format = 'emscripten-es-module'; }, /Unexpected artifact format/],
  ['larger declared memory', c => { c.applicationAudio[0].memoryBytes = 262144; }, /Invalid application audio metadata/],
  ['host imports permitted', c => { c.applicationAudio[0].hostImports = 1; }, /Invalid application audio metadata/],
  ['missing license', c => { c.applicationAudio[0].licenseFiles.pop(); }, /Incomplete application audio sources\/licenses/],
  ['borrowed source location', c => { c.applicationAudio[0].sourceFiles[0] = 'vendor/ymfm/ymfm.h'; }, /Incomplete application audio sources\/licenses/],
]) test(`new SDK rejects catalog ${label}`, async t => {
  const f = await fixture(t); mutate(f.catalog); await f.saveCatalog();
  await assert.rejects(loadWasmSdkInventory({root: f.root}), pattern);
});

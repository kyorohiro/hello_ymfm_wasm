// The application runtime has one generated source: tetorica_src/runtime/generated. Public
// docs paths and historical import paths are byte-for-byte mirrors, not inputs.
import {createHash, randomUUID} from 'node:crypto';
import {lstat, mkdir, readFile, readdir, realpath, rename, rm, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {loadWasmSdkInventory, verifyWasmBuildDirectory} from './wasm_sdk_inventory.mjs';
import {checkSidBuild, SID_BUILD_INPUTS} from './sid_artifacts.mjs';

const DEFAULT_ROOT = fileURLToPath(new URL('../', import.meta.url));
const CATALOG = 'runtime-artifacts.json';
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const requireValue = (condition, message) => { if (!condition) throw new Error(message); };
const serialize = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const within = (directory, target) => {
  const relative = path.relative(directory, target);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
};
const freeze = value => {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
};

function file(pathname, mirrors) {
  return {path: pathname, canonical: `tetorica_src/runtime/generated/${pathname}`, mirrors};
}

/** Describe every SDK build and application effect, without reading generated JS. */
export async function getRuntimeArtifactManifest({root = DEFAULT_ROOT} = {}) {
  root = await realpath(root);
  const inventory = await loadWasmSdkInventory({root});
  const artifacts = inventory.builds.map(artifact => ({
    id: artifact.id,
    kind: artifact.role ?? 'sound-chip',
    format: artifact.format,
    files: artifact.outputs.map(name => file(name, [
      `docs/generated/${name}`,
      ...(artifact.id === 'dx7' ? ['tetorica_src/runtime/msfa_dx7/wasm/msfa.wasm', 'docs/js/msfa_dx7/wasm/msfa.wasm'] : []),
    ])),
    sourceFiles: artifact.sourcePaths.map(name => `third_party/tetorica-soundchip-native/${name}`),
    licenseFiles: artifact.licenseFiles.map(name => `third_party/tetorica-soundchip-native/${name}`),
  }));
  artifacts.push({
    id: 'sid', kind: 'application-instrument', format: 'standalone-wasm',
    files: ['sid/sid.wasm', 'sid/sid-build.json'].map(name => file(name, [`docs/generated/${name}`])),
    sourceFiles: [...SID_BUILD_INPUTS], licenseFiles: ['LICENSE', 'third_party/chips-m6581/LICENSE'],
  });
  artifacts.push({
    id: 'native_audio_effect', kind: 'application-effect', format: 'standalone-wasm',
    files: [file('effects/gain.wasm', [
      'tetorica_src/runtime/native_audio_effect.wasm', 'docs/js/native_audio_effect.wasm', 'docs/native_audio_effect/gain.wasm',
    ])],
    sourceFiles: ['tetorica_src/native/audio_effect/', 'scripts/build_native_audio_effect.sh'], licenseFiles: ['LICENSE'],
  });
  return freeze({schemaVersion: 1, root, canonicalDirectory: path.join(root, 'tetorica_src/runtime/generated'), inventory,
    artifacts, metadata: ['build-info.json', 'ps1_spu_build.json', CATALOG]
      .map(name => file(name, [`docs/generated/${name}`]))});
}

function selectedArtifacts(manifest, ids) {
  if (ids === undefined) return manifest.artifacts;
  requireValue(Array.isArray(ids) && ids.length > 0, 'ids must be a nonempty array');
  const normalized = ids.map(id => id === 'msfa' ? 'dx7' : id);
  requireValue(normalized.every(id => typeof id === 'string') && new Set(normalized).size === normalized.length,
    'Duplicate or invalid runtime artifact IDs');
  for (const id of normalized) requireValue(manifest.artifacts.some(artifact => artifact.id === id),
    `Unknown runtime artifact ID: ${id}`);
  return manifest.artifacts.filter(artifact => normalized.includes(artifact.id));
}

function selectedFiles(manifest, ids, includeMetadata = true) {
  const artifacts = selectedArtifacts(manifest, ids);
  const files = artifacts.flatMap(artifact => artifact.files.map(entry => ({id: artifact.id, ...entry})));
  if (includeMetadata) files.push(...manifest.metadata
    .filter(entry => entry.path !== 'ps1_spu_build.json' || artifacts.some(artifact => artifact.id === 'ps1_spu'))
    .map(entry => ({id: 'metadata', ...entry})));
  return files;
}

/** List canonical copy inputs. This describes paths; call check/copy to verify bytes. */
export async function listRuntimeArtifactFiles({root = DEFAULT_ROOT, ids, includeMetadata = true} = {}) {
  requireValue(typeof includeMetadata === 'boolean', 'includeMetadata must be boolean');
  const manifest = await getRuntimeArtifactManifest({root});
  return selectedFiles(manifest, ids, includeMetadata).map(entry => ({...entry,
    source: path.join(manifest.root, entry.canonical)}));
}

async function bytesAt(root, name, optional = false) {
  const absolute = path.join(root, name);
  let info;
  try { info = await lstat(absolute); }
  catch (error) { if (optional && error.code === 'ENOENT') return null; throw error; }
  requireValue(info.isFile() && info.size <= 64 * 1024 * 1024, `Runtime artifact must be a regular file: ${name}`);
  requireValue(within(root, await realpath(absolute)), `Runtime artifact escapes its root: ${name}`);
  const bytes = await readFile(absolute);
  requireValue(bytes.length === info.size, `Runtime artifact changed while reading: ${name}`);
  return bytes;
}

async function verifyEffect(bytes) {
  let module;
  try { module = await WebAssembly.compile(bytes); }
  catch (error) { throw new Error('Invalid NativeFX WASM: effects/gain.wasm', {cause: error}); }
  const exports = WebAssembly.Module.exports(module);
  const imports = WebAssembly.Module.imports(module);
  requireValue(exports.some(entry => entry.name === 'memory' && entry.kind === 'memory')
    && ['gain_capacity', 'gain_input', 'gain_output', 'gain_reset', 'gain_set', 'gain_process',
      'graph_begin', 'graph_add', 'graph_append', 'graph_commit', 'graph_reset', 'graph_clear', 'graph_process',
      'reverb_reset', 'reverb_set', 'compressor_reset', 'compressor_set', 'gate_reset', 'gate_set',
      'eq_reset', 'eq_set', 'sample_allocate', 'sample_play', 'sample_mix', 'noise_create', 'noise_mix', 'extra_set']
      .every(name => exports.some(entry => entry.name === name && entry.kind === 'function')),
  'NativeFX WASM has no application effect ABI: effects/gain.wasm');
  requireValue(imports.every(entry => entry.module === 'env' && entry.name === 'emscripten_notify_memory_growth'
    && entry.kind === 'function'), 'NativeFX WASM has unexpected host imports');
  return {imports, exports};
}

async function verifySpuReceipt(manifest, bytes, outputBytes) {
  const report = JSON.parse(bytes.toString('utf8'));
  requireValue(report.schemaVersion === 1 && report.component === 'ps1-spu' && report.fixedSdkArtifact === true
    && report.sampleRate === 44100 && report.voices === 24 && report.ramBytes === 524288
    && isDeepStrictEqual(report.sdk, manifest.inventory.pin), 'PS1 SPU receipt differs from the fixed SDK');
  const sourceManifest = JSON.parse(await bytesAt(manifest.root,
    'third_party/tetorica-soundchip-native/RELEASE-MANIFEST.json'));
  const expectedInputs = [...Object.keys(sourceManifest.files).filter(name => name.startsWith('vendor/mame-ps1-spu/')),
    'LICENSE', 'sdk.json', 'catalog/source_inventory.json', 'native/include/tetorica/ps1_spu.h',
    'scripts/build_ps1_spu_wasm.sh', 'scripts/build-wasm.sh', 'scripts/record_wasm_build.mjs'].sort();
  requireValue(report.inputs && isDeepStrictEqual(Object.keys(report.inputs).sort(), expectedInputs),
    'PS1 SPU receipt has missing or extra source inputs');
  for (const name of expectedInputs) {
    const record = report.inputs[name], expected = sourceManifest.files[name];
    requireValue(record && expected && record.bytes === expected.size && record.sha256 === expected.sha256,
      `PS1 SPU receipt source mismatch: ${name}`);
    const source = await bytesAt(manifest.root, `third_party/tetorica-soundchip-native/${name}`);
    requireValue(source.length === record.bytes && sha256(source) === record.sha256,
      `PS1 SPU source hash/size mismatch: ${name}`);
  }
  const names = manifest.artifacts.find(artifact => artifact.id === 'ps1_spu').files.map(entry => entry.path);
  requireValue(report.outputs && isDeepStrictEqual(Object.keys(report.outputs).sort(), [...names].sort()),
    'PS1 SPU receipt has missing or extra outputs');
  for (const name of names) {
    const output = outputBytes.get(name), record = report.outputs[name];
    requireValue(record && record.bytes === output.length && record.sha256 === sha256(output),
      `PS1 SPU receipt output hash/size mismatch: ${name}`);
  }
}

function generatedCatalog(manifest, bytes) {
  const record = entry => ({path: entry.path, canonical: entry.canonical, mirrors: entry.mirrors,
    size: bytes.get(entry.path).length, sha256: sha256(bytes.get(entry.path))});
  return {schemaVersion: 1, generatedBy: 'scripts/sync_runtime_artifacts.mjs',
    canonicalDirectory: 'tetorica_src/runtime/generated', sdk: manifest.inventory.pin,
    artifacts: manifest.artifacts.map(artifact => ({id: artifact.id, kind: artifact.kind, format: artifact.format,
      files: artifact.files.map(record), sourceFiles: artifact.sourceFiles, licenseFiles: artifact.licenseFiles})),
    metadata: manifest.metadata.filter(entry => entry.path !== CATALOG).map(record)};
}

async function validatedBytes(manifest, {importExisting = false} = {}) {
  const directory = path.join(manifest.root, importExisting ? 'docs/generated' : 'tetorica_src/runtime/generated');
  const receiptBefore = await bytesAt(manifest.root, path.relative(manifest.root, path.join(directory, 'build-info.json')));
  const sdk = await verifyWasmBuildDirectory({root: manifest.root, directory, inventory: manifest.inventory});
  const bytes = new Map();
  for (const artifact of manifest.artifacts) for (const entry of artifact.files) {
    if (artifact.id === 'native_audio_effect') {
      const source = importExisting ? 'docs/native_audio_effect/gain.wasm' : entry.canonical;
      bytes.set(entry.path, await bytesAt(manifest.root, source));
    } else bytes.set(entry.path, await bytesAt(manifest.root,
      importExisting ? `docs/generated/${entry.path}` : entry.canonical));
  }
  for (const entry of manifest.metadata.filter(entry => entry.path !== CATALOG))
    bytes.set(entry.path, await bytesAt(manifest.root,
      importExisting ? `docs/generated/${entry.path}` : entry.canonical));
  requireValue(bytes.get('build-info.json').equals(receiptBefore), 'SDK build receipt changed during runtime validation');
  for (const artifact of [...sdk.artifacts, ...sdk.applicationAudio, ...sdk.instruments]) for (const output of artifact.outputs) {
    const actual = bytes.get(output.path);
    requireValue(actual && actual.length === output.size && sha256(actual) === output.sha256,
      `Runtime output changed during validation: ${output.path}`);
  }
  const effect = await verifyEffect(bytes.get('effects/gain.wasm'));
  const sidReceipt = await checkSidBuild({root: manifest.root, directory: path.join(directory, 'sid')});
  requireValue(sidReceipt.output.sha256 === sha256(bytes.get('sid/sid.wasm'))
    && serialize(sidReceipt).equals(bytes.get('sid/sid-build.json')), 'SID output changed during runtime validation');
  await verifySpuReceipt(manifest, bytes.get('ps1_spu_build.json'), bytes);
  bytes.set(CATALOG, serialize(generatedCatalog(manifest, bytes)));
  return {bytes, sdk, effect};
}

async function checkCopies(manifest, bytes, files, {optional = false, canonical = false} = {}) {
  let checked = 0;
  for (const entry of files) for (const name of canonical ? [entry.canonical] : entry.mirrors) {
    const actual = await bytesAt(manifest.root, name, optional);
    if (actual === null) continue;
    requireValue(actual.equals(bytes.get(entry.path)), `Runtime artifact ${canonical ? 'canonical' : 'mirror'} differs: ${name}`);
    checked++;
  }
  return checked;
}

/** Verify complete canonical receipts, WASM, catalog hashes and selected mirrors. */
export async function checkRuntimeArtifacts({root = DEFAULT_ROOT, ids, mirrors = true} = {}) {
  requireValue(typeof mirrors === 'boolean', 'mirrors must be boolean');
  const manifest = await getRuntimeArtifactManifest({root});
  const files = selectedFiles(manifest, ids);
  const {bytes, sdk, effect} = await validatedBytes(manifest);
  // The catalog also pins the application effect, which has no SDK build receipt.
  await checkCopies(manifest, bytes, manifest.metadata.filter(entry => entry.path === CATALOG), {canonical: true});
  const mirrorCount = mirrors ? await checkCopies(manifest, bytes, files) : 0;
  return {schemaVersion: 1, canonicalDirectory: manifest.canonicalDirectory,
    artifactCount: manifest.artifacts.length, sdkBuildCount: sdk.buildCount,
    outputCount: manifest.artifacts.reduce((sum, artifact) => sum + artifact.files.length, 0),
    mirrorCount, ids: selectedArtifacts(manifest, ids).map(artifact => artifact.id), sdk, effect};
}

async function safeTarget(root, name) {
  const parts = name.split('/');
  for (let index = 1; index <= parts.length; index++) {
    const partial = path.join(root, ...parts.slice(0, index));
    let info;
    try { info = await lstat(partial); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    requireValue(!info.isSymbolicLink(), `Refusing a symlink runtime destination: ${partial}`);
    requireValue(index === parts.length ? info.isFile() : info.isDirectory(), `Invalid runtime destination: ${partial}`);
  }
}

// All input validation and destination preflight precede any publication. Each
// changed file is then renamed atomically; an interrupted run can be rechecked.
async function publish(root, entries) {
  const unique = new Map(entries.map(entry => [entry.name, entry.bytes]));
  for (const name of unique.keys()) await safeTarget(root, name);
  const changed = [];
  for (const [name, bytes] of unique) {
    const previous = await bytesAt(root, name, true);
    if (previous?.equals(bytes)) continue;
    const target = path.join(root, name);
    await mkdir(path.dirname(target), {recursive: true});
    const temporary = `${target}.${randomUUID()}.tmp`;
    try { await writeFile(temporary, bytes, {flag: 'wx'}); await rename(temporary, target); }
    finally { await rm(temporary, {force: true}); }
    changed.push(name);
  }
  return changed;
}

async function checkBootstrap(manifest, bytes) {
  const files = selectedFiles(manifest);
  const canonicalEntries = await readdir(manifest.canonicalDirectory, {withFileTypes: true}).catch(error => {
    if (error.code === 'ENOENT') return []; throw error;
  });
  const known = new Set(manifest.inventory.builds.flatMap(artifact => artifact.outputs));
  for (const entry of canonicalEntries.filter(entry => /\.(?:js|wasm)$/.test(entry.name)))
    requireValue(known.has(entry.name), `Unknown existing canonical runtime output: ${entry.name}`);
  for (const artifact of manifest.artifacts) {
    const present = await Promise.all(artifact.files.map(entry => bytesAt(manifest.root, entry.canonical, true)));
    requireValue(present.every(Boolean) || present.every(value => value === null),
      `Existing canonical output pair is incomplete: ${artifact.id}`);
  }
  await checkCopies(manifest, bytes, files, {canonical: true, optional: true});
  // Existing special aliases must agree too. No divergent runtime is selected
  // merely because one copy happens to occupy the preferred historical path.
  await checkCopies(manifest, bytes, files, {optional: true});
  const effect = manifest.artifacts.find(artifact => artifact.id === 'native_audio_effect').files[0];
  await checkCopies(manifest, bytes, [effect]);
}

/** Validate canonical outputs, refresh their catalog and update public mirrors. */
export async function syncRuntimeArtifacts({root = DEFAULT_ROOT, ids, importExisting = false} = {}) {
  requireValue(typeof importExisting === 'boolean', 'importExisting must be boolean');
  requireValue(!importExisting || ids === undefined, '--import-existing requires the complete artifact set');
  const manifest = await getRuntimeArtifactManifest({root});
  const files = selectedFiles(manifest, ids);
  const {bytes} = await validatedBytes(manifest, {importExisting});
  if (importExisting) await checkBootstrap(manifest, bytes);
  const entries = [];
  if (importExisting) for (const entry of selectedFiles(manifest))
    entries.push({name: entry.canonical, bytes: bytes.get(entry.path)});
  else entries.push({name: `tetorica_src/runtime/generated/${CATALOG}`, bytes: bytes.get(CATALOG)});
  for (const entry of files) for (const name of entry.mirrors)
    entries.push({name, bytes: bytes.get(entry.path)});
  const changed = await publish(manifest.root, entries);
  return {schemaVersion: 1, imported: importExisting, ids: selectedArtifacts(manifest, ids).map(artifact => artifact.id), changed};
}

async function resolvedLocation(location) {
  try { return await realpath(location); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return path.join(await resolvedLocation(path.dirname(location)), path.basename(location));
  }
}

/** Copy verified canonical files into a generated directory for packaging. */
export async function copyRuntimeArtifacts({root = DEFAULT_ROOT, destination, ids, includeMetadata = true} = {}) {
  requireValue(typeof destination === 'string' && destination.length > 0, 'destination is required');
  requireValue(typeof includeMetadata === 'boolean', 'includeMetadata must be boolean');
  const manifest = await getRuntimeArtifactManifest({root});
  const files = selectedFiles(manifest, ids, includeMetadata);
  const {bytes} = await validatedBytes(manifest);
  await checkCopies(manifest, bytes, manifest.metadata.filter(entry => entry.path === CATALOG), {canonical: true});
  destination = await resolvedLocation(path.resolve(destination));
  requireValue(!within(destination, manifest.canonicalDirectory) && !within(manifest.canonicalDirectory, destination)
    && !within(destination, manifest.inventory.sdkRoot) && !within(manifest.inventory.sdkRoot, destination),
  'Runtime copy destination overlaps canonical outputs or the fixed SDK');
  await mkdir(destination, {recursive: true});
  const changed = await publish(await realpath(destination), files.map(entry => ({name: entry.path, bytes: bytes.get(entry.path)})));
  return {destination, files: files.map(entry => entry.path), changed};
}

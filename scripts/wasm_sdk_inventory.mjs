// Shared, offline validation for the fixed SDK's complete WASM build set.
// This module reads metadata and compiles WASM; it never imports generated JS.
import {readFile, realpath, stat, readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const WASM_SDK_ARTIFACT_IDS = Object.freeze([
  'ay8910', 'dx7', 'gameboy_apu', 'huc6280', 'k051649', 'nesapu',
  'nuked_opn2', 'okim6258', 'pokey', 'pwm32x', 'rf5c164', 'segapcm', 'segapsg',
  'spc', 'wonderswan', 'y8950', 'ym2151', 'ym2203', 'ym2413', 'ym2608', 'ym2610b',
  'ym2612', 'ym3438', 'ym3526', 'ym3812', 'ymf262', 'ymf276', 'ymf278b', 'ymf288',
]);

const DEFAULT_ROOT = fileURLToPath(new URL('../', import.meta.url));
const NAME = 'tetorica-soundchip-native';
const MANIFEST = 'RELEASE-MANIFEST.json';
// Application-audio modules remain separate from sound-chip IDs. Historical
// SDK snapshots may lack them; new snapshots pin their complete build inputs.
export const WASM_SDK_APPLICATION_AUDIO_IDS = Object.freeze(['cdda', 'msm5205']);
const APPLICATION_AUDIO = WASM_SDK_APPLICATION_AUDIO_IDS;
const inventories = new WeakMap();
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const requireValue = (condition, message) => { if (!condition) throw new Error(message); };
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const isSize = value => Number.isSafeInteger(value) && value >= 0 && value <= 64 * 1024 * 1024;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function relativeName(value, label) {
  requireValue(typeof value === 'string' && value.length > 0 && value.length <= 512
    && !/[\\:\x00-\x20\x7f]/.test(value) && !path.posix.isAbsolute(value)
    && value.split('/').every(part => part && part !== '.' && part !== '..'),
  `Unsafe ${label}: ${String(value)}`);
  return value;
}

function stringPaths(value, label) {
  requireValue(Array.isArray(value) && value.length > 0 && value.length <= 256, `Invalid ${label}`);
  const result = value.map(name => relativeName(name, label));
  requireValue(new Set(result).size === result.length, `Duplicate ${label}`);
  return result;
}

function within(directory, target) {
  const relative = path.relative(directory, target);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

async function containedFile(directory, name, maxSize = 64 * 1024 * 1024) {
  relativeName(name, 'file path');
  const target = await realpath(path.join(directory, ...name.split('/')));
  requireValue(within(directory, target), `File escapes its directory: ${name}`);
  const info = await stat(target);
  requireValue(info.isFile() && info.size <= maxSize, `Invalid or oversized file: ${name}`);
  const bytes = await readFile(target);
  requireValue(bytes.length === info.size, `File changed while reading: ${name}`);
  return bytes;
}

async function jsonFile(directory, name) {
  return JSON.parse((await containedFile(directory, name, 4 * 1024 * 1024)).toString('utf8'));
}

function fileRecord(record, label) {
  requireValue(isObject(record) && isHash(record.sha256) && isSize(record.size), `Invalid ${label} record`);
}

function freeze(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

// The module was already compiled for structural validation. Inspect its
// defined memory limits directly, without running a possibly untrusted WASM
// start function merely to verify a receipt. These modules use one wasm32
// memory with explicit equal initial/maximum limits, no shared/imported memory.
function applicationMemory(bytes) {
  const unsigned = start => {
    let value = 0, shift = 0, at = start;
    for (let count = 0; count < 5 && at < bytes.length; ++count) {
      const byte = bytes[at++]; value += (byte & 127) * 2 ** shift;
      if (!(byte & 128)) return {value, next: at};
      shift += 7;
    }
    throw new Error('Invalid application audio memory declaration');
  };
  let at = 8;
  while (at < bytes.length) {
    const section = bytes[at++], size = unsigned(at), end = size.next + size.value;
    requireValue(end <= bytes.length, 'Invalid application audio memory declaration');
    if (section === 5) {
      const count = unsigned(size.next), flags = unsigned(count.next), minimum = unsigned(flags.next);
      const maximum = flags.value & 1 ? unsigned(minimum.next).value : null;
      return {count: count.value, flags: flags.value, minimum: minimum.value, maximum};
    }
    at = end;
  }
  throw new Error('Application audio WASM has no defined memory');
}

/** Load the pinned SDK catalog, independent of any sibling checkout or compiler. */
export async function loadWasmSdkInventory({root = DEFAULT_ROOT} = {}) {
  root = await realpath(root);
  const pin = await jsonFile(root, 'third_party/soundchip-sdk.json');
  requireValue(isObject(pin) && pin.schemaVersion === 1 && pin.name === NAME
    && typeof pin.version === 'string' && pin.version.length > 0
    && typeof pin.sourceCommit === 'string' && /^[a-f0-9]{40}$/.test(pin.sourceCommit)
    && isHash(pin.archiveSha256) && isHash(pin.manifestSha256)
    && Number.isSafeInteger(pin.fileCount) && pin.fileCount > 0 && pin.fileCount <= 4096,
  'Invalid fixed SDK pin');
  const sdkRoot = await realpath(path.join(root, 'third_party', NAME));
  requireValue(within(root, sdkRoot), 'SDK directory escapes the repository');
  const manifestBytes = await containedFile(sdkRoot, MANIFEST, 4 * 1024 * 1024);
  requireValue(sha256(manifestBytes) === pin.manifestSha256, 'SDK manifest differs from the fixed pin');
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  requireValue(isObject(manifest) && manifest.schemaVersion === 1 && manifest.kind === 'source'
    && manifest.name === NAME && manifest.version === pin.version && isObject(manifest.files)
    && Object.keys(manifest.files).length + 1 === pin.fileCount, 'Invalid SDK source manifest');
  for (const [name, record] of Object.entries(manifest.files)) {
    relativeName(name, 'manifest path');
    requireValue(name !== MANIFEST, 'SDK manifest must not list itself');
    fileRecord(record, name);
  }
  if (pin.localCandidate !== undefined) {
    const candidate = pin.localCandidate;
    requireValue(isObject(candidate) && same(Object.keys(candidate).sort(), ['baseCommit', 'changedPaths'])
      && candidate.baseCommit === pin.sourceCommit
      && Array.isArray(candidate.changedPaths) && candidate.changedPaths.length > 0
      && candidate.changedPaths.every(name => typeof name === 'string')
      && same(candidate.changedPaths, [...new Set(candidate.changedPaths)].sort()),
    'Invalid local SDK candidate provenance');
    for (const name of candidate.changedPaths) {
      relativeName(name, 'local candidate path');
      requireValue(manifest.files[name], `Local candidate path absent from source manifest: ${name}`);
    }
  }
  const catalogPath = 'catalog/source_inventory.json';
  const catalogBytes = await containedFile(sdkRoot, catalogPath, 4 * 1024 * 1024);
  const catalogRecord = manifest.files[catalogPath];
  requireValue(catalogRecord && catalogBytes.length === catalogRecord.size
    && sha256(catalogBytes) === catalogRecord.sha256, 'SDK catalog differs from the fixed manifest');
  const catalog = JSON.parse(catalogBytes.toString('utf8'));
  requireValue(isObject(catalog) && catalog.schemaVersion === 1 && Array.isArray(catalog.artifacts)
    && catalog.artifacts.length === WASM_SDK_ARTIFACT_IDS.length, `Expected exactly ${WASM_SDK_ARTIFACT_IDS.length} SDK artifacts`);
  const ids = catalog.artifacts.map(artifact => artifact?.id).sort();
  requireValue(same(ids, WASM_SDK_ARTIFACT_IDS), `SDK artifact IDs differ from the supported ${WASM_SDK_ARTIFACT_IDS.length} builds`);
  const expectedSources = new Map();
  const normalizeArtifact = (artifact, applicationAudio = false) => {
    const {id} = artifact;
    requireValue(artifact.format === (applicationAudio ? 'standalone-audio-wasm' : id === 'dx7' ? 'standalone-wasm' : 'emscripten-es-module'),
      `Unexpected artifact format: ${id}`);
    requireValue(artifact.buildScript === `scripts/build_${id}_wasm.sh`, `Unexpected build script: ${id}`);
    const sources = stringPaths(artifact.sourceFiles, `${id} source files`);
    const builds = stringPaths(artifact.buildFiles, `${id} build files`);
    requireValue(builds.includes(artifact.buildScript) && (applicationAudio || (builds.includes('scripts/build-wasm.sh')
      && builds.includes('scripts/record_wasm_build.mjs'))), `Incomplete build files: ${id}`);
    const licenses = stringPaths(artifact.licenseFiles, `${id} license files`);
    if (applicationAudio) {
      requireValue(artifact.role === 'application-audio' && artifact.kind === (id === 'cdda' ? 'pcm-device' : 'adpcm-device')
        && same(artifact.chipIds, []) && artifact.memoryBytes === 131072 && artifact.hostImports === 0,
      `Invalid application audio metadata: ${id}`);
      requireValue(same(sources.toSorted(), [`vendor/tetorica-${id}/${id}_pcm.c`,
        `vendor/tetorica-${id}/${id}_pcm.h`, `wasm/${id}_wasm.c`].sort())
        && licenses.includes(`vendor/tetorica-${id}/LICENSE`) && licenses.includes(`vendor/tetorica-${id}/NOTICE.md`)
        && licenses.every(name => manifest.files[name]), `Incomplete application audio sources/licenses: ${id}`);
    }
    const sourcePaths = [...new Set([...sources, ...builds])].sort();
    const sourceRecords = sourcePaths.map(name => {
      const record = manifest.files[name];
      requireValue(record, `SDK source absent from manifest: ${name}`);
      return {path: name, sha256: record.sha256, size: record.size};
    });
    const outputs = id === 'dx7' ? ['msfa.wasm'] : [`${id}_wasm.js`, `${id}_wasm.wasm`];
    // POKEY is the first SDK-owned addition, rather than a binary imported
    // from the application. Its freshly built outputs are pinned by receipts.
    const importedCount = id === 'pokey' || applicationAudio ? 0 : outputs.length;
    requireValue((applicationAudio && artifact.importedFiles === undefined)
      || (Array.isArray(artifact.importedFiles) && artifact.importedFiles.length === importedCount),
      `Invalid imported output list: ${id}`);
    for (let index = 0; index < importedCount; index++) {
      const imported = artifact.importedFiles[index];
      requireValue(isObject(imported) && imported.path === `dist/wasm/${outputs[index]}`
        && isHash(imported.sha256), `Unexpected imported output: ${id}`);
      relativeName(imported.originPath, `${id} imported origin`);
    }
    expectedSources.set(id, sourceRecords);
    return {...artifact, sourcePaths, outputs, compilerCommand: id === 'nuked_opn2' || applicationAudio ? 'emcc' : 'em++'};
  };
  const artifacts = catalog.artifacts.map(artifact => normalizeArtifact(artifact)).sort((a, b) => a.id.localeCompare(b.id));
  requireValue(catalog.applicationAudio === undefined || (Array.isArray(catalog.applicationAudio)
    && same(catalog.applicationAudio.map(artifact => artifact?.id).sort(), APPLICATION_AUDIO)),
  'SDK application audio IDs must contain cdda and msm5205 exactly once');
  const applicationAudio = (catalog.applicationAudio ?? []).map(artifact => normalizeArtifact(artifact, true))
    .sort((a, b) => a.id.localeCompare(b.id));
  const builds = [...artifacts, ...applicationAudio].sort((a, b) => a.id.localeCompare(b.id));
  const result = freeze({root, sdkRoot, pin, artifacts, applicationAudio, builds});
  inventories.set(result, expectedSources);
  return result;
}

/** Verify complete receipts, pinned inputs and actual outputs before running JS. */
export async function verifyWasmBuildDirectory({root = DEFAULT_ROOT, directory, inventory,
  verifySources = true, allowApplicationAudio = false} = {}) {
  requireValue(typeof verifySources === 'boolean', 'verifySources must be boolean');
  requireValue(typeof allowApplicationAudio === 'boolean', 'allowApplicationAudio must be boolean');
  inventory ??= await loadWasmSdkInventory({root});
  const expectedSources = inventories.get(inventory);
  requireValue(expectedSources, 'inventory must be returned by loadWasmSdkInventory');
  const absolute = await realpath(directory);
  const receipt = await jsonFile(absolute, 'build-info.json');
  const builds = inventory.builds;
  const expectedIDs = builds.map(artifact => artifact.id).sort();
  requireValue(isObject(receipt) && receipt.schemaVersion === 1 && Array.isArray(receipt.artifacts)
    && receipt.artifacts.length === builds.length, `Expected a schema 1 receipt with exactly ${builds.length} artifacts`);
  requireValue(same(receipt.artifacts.map(record => record?.id).sort(), expectedIDs),
    `Receipt artifact IDs must contain each of the ${builds.length} builds exactly once`);
  const expectedOutputs = builds.flatMap(artifact => artifact.outputs).sort();
  const entries = await readdir(absolute, {withFileTypes: true});
  requireValue(entries.length <= 4096, 'Too many files in WASM output directory');
  const wasmOutputs = entries.filter(entry => /\.(?:js|wasm)$/.test(entry.name)).map(entry => entry.name).sort();
  const applicationAudio = [];
  const applicationOutputs = [];
  if (allowApplicationAudio && inventory.applicationAudio.length === 0) {
    for (const id of APPLICATION_AUDIO) {
      const names = [`${id}_wasm.js`, `${id}_wasm.wasm`];
      const present = names.filter(name => wasmOutputs.includes(name));
      requireValue(!present.length || present.length === names.length,
        `Application audio output pair is incomplete: ${id}`);
      if (!present.length) continue;
      const outputs = [];
      let wasm;
      for (const name of names) {
        // Reject even an internal symlink: these are explicit repository
        // reference files, not an extensible alias/search-path mechanism.
        requireValue(entries.find(entry => entry.name === name)?.isFile(),
          `Application audio output must be a regular file, not a symlink: ${name}`);
        const bytes = await containedFile(absolute, name);
        outputs.push({path: name, size: bytes.length, sha256: sha256(bytes)});
        if (name.endsWith('.wasm')) {
          let compiled;
          try { compiled = await WebAssembly.compile(bytes); }
          catch (error) { throw new Error(`Invalid application audio WASM output: ${name}`, {cause: error}); }
          const imports = WebAssembly.Module.imports(compiled);
          const exports = WebAssembly.Module.exports(compiled);
          requireValue(imports.length === 0 && exports.some(entry => entry.name === 'memory' && entry.kind === 'memory')
            && ['init', 'render'].every(suffix => exports.some(entry => entry.name === `${id}_wasm_${suffix}` && entry.kind === 'function')),
          `Application audio output has no standalone ${id} ABI: ${name}`);
          wasm = {path: name, imports, exports};
        }
      }
      applicationAudio.push({id, outputs, wasm});
      applicationOutputs.push(...names);
    }
  }
  requireValue(same(wasmOutputs, [...expectedOutputs, ...applicationOutputs].sort()),
    'WASM output directory has missing or extra JS/WASM files');
  const sourceCache = new Map();
  const artifacts = [];
  for (const artifact of builds) {
    const record = receipt.artifacts.find(record => record.id === artifact.id);
    requireValue(record.format === artifact.format, `Receipt format mismatch: ${artifact.id}`);
    requireValue(Array.isArray(record.sourceFiles) && record.sourceFiles.length <= 256,
      `Invalid receipt source files: ${artifact.id}`);
    for (const source of record.sourceFiles) {
      fileRecord(source, `${artifact.id} source`);
      relativeName(source.path, 'source path');
      requireValue(same(Object.keys(source).sort(), ['path', 'sha256', 'size']), `Unexpected source fields: ${artifact.id}`);
    }
    requireValue(same(record.sourceFiles, expectedSources.get(artifact.id)),
      `Receipt source files differ from pinned SDK inputs: ${artifact.id}`);
    requireValue(isHash(record.sourceFingerprint) && sha256(JSON.stringify(record.sourceFiles)) === record.sourceFingerprint,
      `Source fingerprint mismatch: ${artifact.id}`);
    if (verifySources) {
      for (const source of record.sourceFiles) {
        let bytes = sourceCache.get(source.path);
        if (!bytes) {
          bytes = await containedFile(inventory.sdkRoot, source.path);
          sourceCache.set(source.path, bytes);
        }
        requireValue(bytes.length === source.size && sha256(bytes) === source.sha256,
          `SDK source hash/size mismatch: ${source.path}`);
      }
    }
    const compiler = record.compiler;
    requireValue(isObject(compiler) && typeof compiler.command === 'string' && compiler.command.trim().length > 0
      && compiler.command.length <= 4096 && !/[\x00-\x1f\x7f]/.test(compiler.command)
      && typeof compiler.version === 'string' && compiler.version.trim().length > 0 && compiler.version.length <= 65536,
    `Invalid compiler metadata: ${artifact.id}`);
    requireValue(Array.isArray(record.outputs) && record.outputs.length === artifact.outputs.length,
      `Invalid receipt output list: ${artifact.id}`);
    let wasm;
    for (let index = 0; index < record.outputs.length; index++) {
      const output = record.outputs[index];
      fileRecord(output, `${artifact.id} output`);
      relativeName(output.path, 'output path');
      requireValue(same(Object.keys(output).sort(), ['path', 'sha256', 'size'])
        && output.path === artifact.outputs[index], `Unexpected receipt output: ${artifact.id}`);
      if (artifact.format === 'standalone-audio-wasm') requireValue(
        entries.find(entry => entry.name === output.path)?.isFile(),
        `Application audio output must be a regular file, not a symlink: ${output.path}`);
      const bytes = await containedFile(absolute, output.path);
      requireValue(bytes.length === output.size && sha256(bytes) === output.sha256,
        `Output hash/size mismatch: ${output.path}`);
      if (output.path.endsWith('.wasm')) {
        let compiled;
        try { compiled = await WebAssembly.compile(bytes); }
        catch (error) { throw new Error(`Invalid WASM output: ${output.path}`, {cause: error}); }
        const imports = WebAssembly.Module.imports(compiled);
        const exports = WebAssembly.Module.exports(compiled);
        requireValue(exports.some(entry => entry.name === 'memory' && entry.kind === 'memory')
          && exports.some(entry => entry.kind === 'function'), `WASM output has no sound-chip ABI: ${output.path}`);
        if (artifact.id === 'wonderswan') requireValue(exports.some(entry => entry.name === 'wonderswan_generate' && entry.kind === 'function'),
          `WASM output has no WonderSwan ABI: ${output.path}`);
        if (artifact.id === 'pokey') requireValue(exports.some(entry => entry.name === 'pokey_generate' && entry.kind === 'function'),
          `WASM output has no POKEY ABI: ${output.path}`);
        if (artifact.id === 'dx7') requireValue(imports.length === 0, 'Standalone DX7 WASM must not have imports');
        if (artifact.format === 'standalone-audio-wasm') {
          requireValue(imports.length === 0 && ['init', 'input', 'left', 'right', 'prepare', 'play', 'stop',
            'gain', 'mute', 'render', ...(artifact.id === 'cdda'
              ? ['window', 'pause', 'resume', 'seek', 'state', 'frame', 'phase', 'output_frames', 'get_gain', 'muted']
              : ['reset', 'write', 'read'])].every(suffix => exports.some(entry =>
                entry.name === `${artifact.id}_wasm_${suffix}` && entry.kind === 'function')),
          `WASM output has no standalone ${artifact.id} ABI: ${output.path}`);
          const memory = applicationMemory(bytes);
          requireValue(memory.count === 1 && memory.minimum * 65536 === artifact.memoryBytes,
            `Application audio memory size differs: ${artifact.id}`);
          requireValue(memory.flags === 1 && memory.maximum === memory.minimum,
            `Application audio memory must be fixed: ${artifact.id}`);
        }
        wasm = {path: output.path, imports, exports};
      }
    }
    const validated = {id: artifact.id, format: record.format, sourceFingerprint: record.sourceFingerprint,
      sourceFiles: record.sourceFiles, outputs: record.outputs, compiler: record.compiler, wasm};
    if (artifact.format === 'standalone-audio-wasm') applicationAudio.push(validated);
    else artifacts.push(validated);
  }
  return {schemaVersion: 1, directory: absolute, artifactCount: artifacts.length,
    outputCount: inventory.artifacts.flatMap(artifact => artifact.outputs).length,
    buildCount: builds.length, buildOutputCount: expectedOutputs.length + applicationOutputs.length, verifiedSourceCount: verifySources ? sourceCache.size : 0,
    sourcesVerified: verifySources, artifacts, applicationAudioCount: applicationAudio.length,
    applicationAudioOutputCount: applicationAudio.reduce((count, artifact) => count + artifact.outputs.length, 0),
    sdkApplicationAudioCount: inventory.applicationAudio.length, applicationAudio};
}

#!/usr/bin/env node
// SPDX-License-Identifier: BSD-3-Clause
import { createHash } from 'node:crypto';
import { readFile, realpath, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const defaultOutput = 'docs/generated/scsp-ssf';
const sdk = 'third_party/tetorica-soundchip-native';
const sdkPinPath = 'third_party/soundchip-sdk.json';
const sdkManifestPath = sdk + '/RELEASE-MANIFEST.json';
const scsp = 'vendor/mame-scsp';
const scspFiles = [
  'LICENSE', 'scsp.cpp', 'scsp.h', 'scsp_instrument.cpp', 'scsp_instrument.h',
  'scspdsp.cpp', 'scspdsp.h', 'standalone_support.h', 'upstream/REVISION',
].map(name => scsp + '/' + name);
const atari = 'third_party/atari-audio';
const atariManifestPath = atari + '/upstream.json';
const musashi = 'src/external/Musashi';
const atariFiles = [
  'LICENSE',
  ...[
    'history.txt', 'm68k.cpp', 'm68k.h', 'm68k_func.inc', 'm68kconf.h',
    'm68kcpu.cpp', 'm68kcpu.h', 'm68kops.cpp', 'm68kops.h', 'readme.txt',
  ].map(name => musashi + '/' + name),
];
const atariOrigin = {
  repository: 'https://github.com/arnaud-carre/AtariAudio',
  revision: '1dd9fca810a4f00b4b5e6a5348872ac0a21d88fb',
  version: '1.31',
  license: 'MIT',
};
const mameRevision = 'a64a5d6602b19f67e091a4491f0c851a9dacf79d';
const digest = bytes => ({ bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });

export const SCSP_SSF_BUILD_INPUTS = Object.freeze([
  'LICENSE',
  'scripts/build_scsp_ssf_wasm.sh', 'scripts/scsp_ssf_artifacts.mjs',
  'tetorica_src/native/scsp_ssf/scsp_ssf.cpp', 'tetorica_src/native/scsp_ssf/scsp_ssf.h',
  sdkPinPath, sdkManifestPath,
  ...scspFiles.map(name => sdk + '/' + name),
  atariManifestPath,
  ...atariFiles.map(name => atari + '/' + name),
].sort());

async function loadBuildInputs(root) {
  const bytes = new Map(await Promise.all(SCSP_SSF_BUILD_INPUTS.map(async path =>
    [path, await readFile(join(root, path))])));
  const inputs = Object.fromEntries([...bytes].map(([path, data]) => [path, digest(data)]));
  const sdkPin = JSON.parse(bytes.get(sdkPinPath));
  if (inputs[sdkManifestPath].sha256 !== sdkPin.manifestSha256)
    throw new Error('SCSP SDK manifest differs from its fixed pin');
  const sdkManifest = JSON.parse(bytes.get(sdkManifestPath));
  for (const name of scspFiles) {
    const actual = inputs[sdk + '/' + name];
    const expected = sdkManifest.files[name];
    if (!expected || actual.sha256 !== expected.sha256 || actual.bytes !== expected.size)
      throw new Error('SCSP SDK source differs from its fixed manifest: ' + name);
  }
  if (bytes.get(sdk + '/' + scsp + '/upstream/REVISION').toString().trim() !== mameRevision)
    throw new Error('SCSP upstream revision differs');

  const atariManifest = JSON.parse(bytes.get(atariManifestPath));
  if (!Object.entries(atariOrigin).every(([key, value]) => atariManifest[key] === value))
    throw new Error('AtariAudio Musashi upstream pin differs');
  for (const name of atariFiles) {
    const expected = atariManifest.files.find(file => file.path === name);
    const actual = inputs[atari + '/' + name].sha256;
    if (!expected || actual !== expected.sha256 || actual !== expected.upstreamSha256)
      throw new Error('AtariAudio Musashi source differs from upstream: ' + name);
  }

  const musashiHeader = bytes.get(atari + '/' + musashi + '/m68k.h').toString();
  const musashiNotice = musashiHeader.match(/Copyright Karl Stenerud\.[\s\S]+?(?=\n \*\/)/)?.[0]
    .replace(/^ \* ?/gm, '');
  if (!musashiNotice) throw new Error('Musashi license notice is missing');
  const notices = Buffer.from([
    'Tetorica SCSP SSF / MiniSSF renderer',
    'Saturn sound board · BSD-3-Clause\n' + bytes.get('LICENSE').toString().trim(),
    'MAME-derived standalone SCSP · BSD-3-Clause\n' + bytes.get(sdk + '/' + scsp + '/LICENSE').toString().trim(),
    'AtariAudio Musashi adaptation · MIT\n' + bytes.get(atari + '/LICENSE').toString().trim(),
    'Musashi Motorola 68000 CPU\n' + musashiNotice,
  ].join('\n\n') + '\n');
  return {
    inputs,
    notices,
    upstream: {
      scsp: { mameRevision, sdkVersion: sdkPin.version, sdkSourceCommit: sdkPin.sourceCommit, license: 'BSD-3-Clause' },
      musashi: atariOrigin,
    },
  };
}

async function createReceipt(root, wasm, compiler) {
  if (typeof compiler !== 'string' || !compiler.startsWith('emcc '))
    throw new Error('The SCSP SSF receipt requires an Emscripten compiler identity');
  const compiled = await WebAssembly.compile(wasm);
  const imports = WebAssembly.Module.imports(compiled);
  if (!isDeepStrictEqual(imports, [
    { module: 'env', name: 'emscripten_notify_memory_growth', kind: 'function' },
  ])) throw new Error('The SCSP SSF WASM has unexpected host imports');
  const exported = new Map(WebAssembly.Module.exports(compiled).map(({ name, kind }) => [name, kind]));
  for (const name of ['_initialize', 'malloc', 'free', 'scsp_ssf_create',
    'scsp_ssf_destroy', 'scsp_ssf_key_on_mask', 'scsp_ssf_render', 'scsp_ssf_fault_address']) {
    if (exported.get(name) !== 'function') throw new Error('The SCSP SSF WASM is missing ' + name);
  }
  if (exported.get('memory') !== 'memory') throw new Error('The SCSP SSF WASM is missing exported memory');
  const source = await loadBuildInputs(root);
  return {
    notices: source.notices,
    receipt: {
      schemaVersion: 1,
      component: 'scsp-ssf',
      compiler,
      upstream: source.upstream,
      sampleRate: 44100,
      channels: 2,
      soundRamBytes: 512 * 1024,
      maximumWasmMemoryBytes: 64 * 1024 * 1024,
      inputs: source.inputs,
      output: digest(wasm),
      notices: digest(source.notices),
    },
  };
}

export async function checkScspSsfBuild({ root = repositoryRoot, directory = join(root, defaultOutput) } = {}) {
  const [record, wasm, notices] = await Promise.all([
    readFile(join(directory, 'scsp-ssf-build.json'), 'utf8').then(JSON.parse),
    readFile(join(directory, 'scsp-ssf.wasm')),
    readFile(join(directory, 'scsp-ssf-notices.txt')),
  ]);
  const expected = await createReceipt(root, wasm, record.compiler);
  if (!isDeepStrictEqual(record, expected.receipt) || !notices.equals(expected.notices))
    throw new Error('SCSP SSF source/WASM receipt differs. Run sh scripts/build_scsp_ssf_wasm.sh');
  return record;
}

const cliPath = process.argv[1] && await realpath(process.argv[1]).catch(() => '');
if (cliPath && cliPath === await realpath(fileURLToPath(import.meta.url))) {
  const [action, directory, compiler, ...extra] = process.argv.slice(2);
  if (action === '--record' && directory && compiler && !extra.length) {
    const wasm = await readFile(join(directory, 'scsp-ssf.wasm'));
    const { receipt, notices } = await createReceipt(repositoryRoot, wasm, compiler);
    await Promise.all([
      writeFile(join(directory, 'scsp-ssf-build.json'), JSON.stringify(receipt, null, 2) + '\n'),
      writeFile(join(directory, 'scsp-ssf-notices.txt'), notices),
    ]);
  } else if (action === '--check-source' && !directory) {
    await loadBuildInputs(repositoryRoot);
  } else if (action === '--check' && !compiler) {
    await checkScspSsfBuild(directory ? { directory: resolve(directory) } : undefined);
  } else {
    throw new Error('Usage: scsp_ssf_artifacts.mjs --record DIRECTORY COMPILER | --check-source | --check [DIRECTORY]');
  }
  process.stdout.write('SCSP SSF source and artifact verification passed.\n');
}

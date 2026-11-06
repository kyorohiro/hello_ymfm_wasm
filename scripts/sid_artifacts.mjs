#!/usr/bin/env node
// Checked, application-local SID prototype assets. Fixed SDK stays untouched.
import {createHash} from 'node:crypto';
import {readFile, writeFile, mkdir, copyFile} from 'node:fs/promises';
import {dirname, resolve, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
const root = fileURLToPath(new URL('../', import.meta.url));
const canonical = join(root, 'tetorica_src/runtime/generated/sid');
const digest = bytes => ({bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex')});
const runtime = ['sid.js', 'sid_test_instrument.js'];
const sourcePaths = [
  'LICENSE', 'third_party/chips-m6581/LICENSE', 'third_party/chips-m6581/README.md',
  'third_party/chips-m6581/PATCHES.md', 'third_party/chips-m6581/upstream/m6581.h',
  'third_party/chips-m6581/m6581.h', 'tetorica_src/wasm/sid_core.h', 'tetorica_src/wasm/sid_wasm.cpp',
  'scripts/build_sid_wasm.sh', 'scripts/prepare_sid_core.py', 'scripts/sid_artifacts.mjs',
  'test/helpers/sid_reference.cpp', 'scripts/check_sid_native.mjs',
];
const upstream = {revision: '9e88298ce56319953ac7a43213a1120359f7a3a6',
  headerSha256: 'a793225ee69b91e0ea8c91b221d06ee024e45e6c8179176980abfa95d5a54cdf',
  licenseSha256: '0c692ece632a8ec6d2a566c9234fdabda655644e6abc70027da9ff7c35e48634'};
const sourceReadme = `# Tetorica SID source kit\n\nExperimental 6581, zlib chip core with a BSD-3-Clause host.\n\nOriginal pinned header, marked adaptation, license, Native host and WASM bridge\nare included with their original relative paths. See\n[component README](third_party/chips-m6581/README.md) and\n[patches](third_party/chips-m6581/PATCHES.md). No C64 ROM or game data is included.\n\nWith Node.js, Python 3 and Emscripten installed, from this directory:\n\n\x60\x60\x60sh\npython3 scripts/prepare_sid_core.py --check\nsh scripts/build_sid_wasm.sh /tmp/tetorica-sid-rebuild\n\x60\x60\x60\n\nThe explicit directory build records matching input hashes without modifying\npublic copies. Browser API source is in tetorica_src/runtime/. This prototype\nis separate from the fixed tetorica-soundchip-native SDK and its catalog.\n`;
async function inputs() {
  const files = Object.fromEntries(await Promise.all(sourcePaths.map(async name => [name, digest(await readFile(join(root, name)))])));
  if (files['third_party/chips-m6581/upstream/m6581.h'].sha256 !== upstream.headerSha256
    || files['third_party/chips-m6581/LICENSE'].sha256 !== upstream.licenseSha256) throw new Error('SID pristine upstream hash differs');
  return files;
}
export async function recordSidBuild(directory) {
  const wasm = await readFile(join(directory, 'sid.wasm'));
  await WebAssembly.compile(wasm);
  const receipt = {schemaVersion: 1, component: 'sid-lab', model: '6581', fixedSdkArtifact: false,
    upstream, inputs: await inputs(), output: digest(wasm)};
  await writeFile(join(directory, 'sid-build.json'), JSON.stringify(receipt, null, 2) + '\n');
  return receipt;
}
export async function checkSidBuild() {
  const receipt = JSON.parse(await readFile(join(canonical, 'sid-build.json'), 'utf8'));
  if (!isDeepStrictEqual(receipt, {schemaVersion: 1, component: 'sid-lab', model: '6581', fixedSdkArtifact: false,
    upstream, inputs: await inputs(), output: digest(await readFile(join(canonical, 'sid.wasm')))})) throw new Error('SID source / WASM receipt differs; rebuild with sh scripts/build_sid_wasm.sh');
  return receipt;
}
async function copies() {
  return [
    ...runtime.map(name => [`tetorica_src/runtime/${name}`, `docs/js/${name}`]),
    ...['sid.wasm', 'sid-build.json'].map(name => [`tetorica_src/runtime/generated/sid/${name}`, `docs/generated/sid/${name}`]),
    ...[...sourcePaths, ...runtime.map(name => `tetorica_src/runtime/${name}`)]
      .map(name => [name, `docs/sources/sid/${name}`]),
  ];
}
export async function syncSidArtifacts({check = false} = {}) {
  await checkSidBuild();
  for (const [source, target] of await copies()) {
    if (check) {
      if (!(await readFile(join(root, source))).equals(await readFile(join(root, target)))) throw new Error(`SID public copy differs: ${target}`);
    } else {
      await mkdir(dirname(join(root, target)), {recursive: true});
      await copyFile(join(root, source), join(root, target));
    }
  }
  const target = join(root, 'docs/sources/sid/README.md');
  if (check) { if (await readFile(target, 'utf8') !== sourceReadme) throw new Error('SID source kit README differs'); }
  else await writeFile(target, sourceReadme);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [action, directory] = process.argv.slice(2);
  if (action === '--record' && directory) await recordSidBuild(resolve(directory));
  else if (action === '--sync' && !directory) await syncSidArtifacts();
  else if (action === '--check' && !directory) await syncSidArtifacts({check: true});
  else throw new Error('Usage: sid_artifacts.mjs <--record DIRECTORY|--sync|--check>');
  process.stdout.write('SID prototype artifacts verified.\n');
}

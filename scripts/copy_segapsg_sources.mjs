// Original Sega PSG source and notices for runtime distributions.
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const annotation = Buffer.from('// SPDX-License-Identifier: BSD-3-Clause\n// Copyright (c) 2026, kyorohiro\n// See LICENSE and README.md in this directory.\n\n');
const coreBody = bytes => bytes.subarray(bytes.subarray(0, annotation.length).equals(annotation) ? annotation.length : 0);

export async function copySegaPsgSources(stage) {
  const sdk = join(root, 'third_party/tetorica-soundchip-native');
  const sha = bytes => createHash('sha256').update(bytes).digest('hex');
  const pin = JSON.parse(await readFile(join(root, 'third_party/soundchip-sdk.json'), 'utf8'));
  const manifestBytes = await readFile(join(sdk, 'RELEASE-MANIFEST.json'));
  if (sha(manifestBytes) !== pin.manifestSha256) throw new Error('Sega PSG SDK manifest hash mismatch');
  const manifest = JSON.parse(manifestBytes);
  // Existing immutable releases use the historical ymfm directory. A future
  // source release may use the separated directory without duplicating headers.
  const corePath = manifest.files['vendor/tetorica_sega_psg/segapsg.cpp'] ? 'vendor/tetorica_sega_psg' : 'vendor/ymfm';
  const names = ['wasm/segapsg_wasm.cpp', 'scripts/build_segapsg_wasm.sh',
    'vendor/ymfm/chip_state.h', 'LICENSE', `${corePath}/segapsg.cpp`, `${corePath}/segapsg.h`];
  const inputs = new Map(await Promise.all(names.map(async name => {
    const bytes = await readFile(join(sdk, name)), expected = manifest.files[name];
    if (!expected || sha(bytes) !== expected.sha256 || bytes.length !== expected.size) throw new Error(`Sega PSG SDK source hash mismatch: ${name}`);
    return [name, bytes];
  })));
  const component = 'third_party/tetorica_sega_psg';
  const ownFiles = new Map(await Promise.all(['segapsg.cpp', 'segapsg.h', 'LICENSE', 'README.md'].map(async name =>
    [name, await readFile(join(root, component, name))])));
  for (const name of ['segapsg.cpp', 'segapsg.h']) {
    if (!coreBody(ownFiles.get(name)).equals(coreBody(inputs.get(`${corePath}/${name}`)))) throw new Error(`Sega PSG source body differs from the pinned runtime: ${name}`);
  }
  if (!ownFiles.get('LICENSE').equals(inputs.get('LICENSE'))) throw new Error('Sega PSG BSD notice differs from the pinned Tetorica license');
  let recipe = inputs.get('scripts/build_segapsg_wasm.sh').toString('utf8');
  const include = corePath === 'vendor/ymfm' ? '-Ivendor/ymfm' : '-Ivendor/tetorica_sega_psg -Ivendor/ymfm';
  if (recipe.split(include).length !== 2 || recipe.split(`${corePath}/segapsg.cpp`).length !== 2) throw new Error('Unexpected Sega PSG standalone recipe source paths');
  recipe = recipe.replace(include, '-Ithird_party/tetorica_sega_psg -Isrc').replace(`${corePath}/segapsg.cpp`, 'third_party/tetorica_sega_psg/segapsg.cpp');
  const payload = new Map([
    ['sources/wasm/segapsg_wasm.cpp', inputs.get('wasm/segapsg_wasm.cpp')],
    ['sources/src/chip_state.h', inputs.get('vendor/ymfm/chip_state.h')],
    ['sources/scripts/build_segapsg_wasm.sh', recipe],
    ['sources/LICENSE', inputs.get('LICENSE')],
  ]);
  for (const [name, bytes] of ownFiles) payload.set(`sources/${component}/${name}`, bytes);
  for (const name of ['LICENSE', 'README.md']) payload.set(`licenses/tetorica_sega_psg/${name}`, ownFiles.get(name));
  // Keep source/helper links local in the source bundle; the repository-only
  // review remains an external provenance link. Notice copies have another base.
  const sourceReadme = ownFiles.get('README.md').toString('utf8').replace(
    '](../../docs/issues/segapsg_provenance_layout_01.md)',
    '](https://github.com/kyorohiro/hello_ymfm_wasm/blob/main/docs/issues/segapsg_provenance_layout_01.md)');
  payload.set(`sources/${component}/README.md`, sourceReadme);
  payload.set('licenses/tetorica_sega_psg/README.md', sourceReadme
    .replace('](../../src/chip_state.h)', '](../../sources/src/chip_state.h)')
    .replace('](../../wasm/segapsg_wasm.cpp)', '](../../sources/wasm/segapsg_wasm.cpp)'));
  for (const [name, bytes] of payload) {
    const target = join(stage, name);
    await mkdir(join(target, '..'), {recursive: true});
    await writeFile(target, bytes);
  }
  await writeFile(join(stage, 'sources/SegaPSG.md'), `# Tetorica Sega PSG source

This original Tetorica C++ implementation uses BSD-3-Clause, copyright 2026 kyorohiro. See third_party/tetorica_sega_psg/LICENSE and README.md for the notice and credit to Maxim and the SMS Power! SN76489 documentation contributors.

From this sources directory, run \`sh scripts/build_segapsg_wasm.sh ../generated\` with Emscripten installed. This standalone recipe requires no SDK checkout, importer or network access. Its default output is dist/wasm; an explicit output argument selects another directory.

The wrapper, shared serialization helper and compiler recipe are verified against the fixed SDK release ${pin.version}. The separated core's complete body is also checked against that release; only the explicit copyright/SPDX comment may differ. The recipe's source and include paths are relocated for this self-contained bundle, while compiler flags and exports are retained. This does not change the application's fixed SDK pin or its prebuilt runtime.

The source is in third_party/tetorica_sega_psg, its shared Tetorica helper is src/chip_state.h, and its bridge is wasm/segapsg_wasm.cpp. Sega PSG is separate from the upstream ymfm implementation.
`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) throw new Error('Usage: node scripts/copy_segapsg_sources.mjs <stage>');
  await copySegaPsgSources(resolve(process.argv[2]));
}

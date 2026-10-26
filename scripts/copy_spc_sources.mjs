import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
/** Ship the complete modified LGPL library, wrapper and standalone WASM recipe. */
export async function copySpcSources(destination) {
  const sdk = join(root, 'third_party/tetorica-soundchip-native');
  const sha = bytes => createHash('sha256').update(bytes).digest('hex');
  const pin = JSON.parse(await readFile(join(root, 'third_party/soundchip-sdk.json'), 'utf8'));
  const manifestBytes = await readFile(join(sdk, 'RELEASE-MANIFEST.json'));
  if (sha(manifestBytes) !== pin.manifestSha256) throw new Error('SPC SDK manifest hash mismatch');
  const manifest = JSON.parse(manifestBytes);
  const names = ['wasm/spc_wasm.cpp', 'scripts/build_spc_wasm.sh',
    ...Object.keys(manifest.files).filter(name => name.startsWith('vendor/snes-spc/'))];
  // Validate the complete selected library before creating any distribution file.
  const files = await Promise.all(names.map(async name => {
    const expected = manifest.files[name], bytes = await readFile(join(sdk, name));
    if (!expected || bytes.length !== expected.size || sha(bytes) !== expected.sha256) {
      throw new Error(`SPC SDK source hash mismatch: ${name}`);
    }
    return {name, bytes};
  }));
  const recipe = files.find(file => file.name === 'scripts/build_spc_wasm.sh');
  const text = recipe.bytes.toString('utf8');
  if (text.split('vendor/snes-spc').length !== 6) throw new Error('Unexpected SPC standalone recipe source paths');
  const standaloneRecipe = text.replaceAll('vendor/snes-spc', 'third_party/snes-spc');
  const sources = join(destination, 'sources');
  for (const {name, bytes} of files) {
    const target = join(sources, name.replace(/^vendor\/snes-spc\//, 'third_party/snes-spc/'));
    await mkdir(join(target, '..'), {recursive:true});
    await writeFile(target, name === recipe.name ? standaloneRecipe : bytes);
  }
  const notices = join(destination, 'licenses/snes-spc');
  await mkdir(notices, {recursive:true});
  for (const name of ['LICENSE', 'README.md']) {
    await writeFile(join(notices, name), files.find(file => file.name === 'vendor/snes-spc/' + name).bytes);
  }
  await writeFile(join(sources, 'SNES-SPC.md'), '# SNES SPC source\n\nsnes_spc 0.9.0, LGPL-2.1-or-later; see third_party/snes-spc/LICENSE and README.md for the pinned revision and changes. The complete modified library, upstream documentation and notices are included from the pinned SDK source release.\n\nFrom this sources directory, rebuild with Emscripten: `sh scripts/build_spc_wasm.sh docs/generated`. The explicit argument writes the loader/binary under `docs/generated/`; the standalone recipe default is `dist/wasm/`. Only its five `vendor/snes-spc` paths are relocated to the existing `third_party/snes-spc` bundle layout. Compiler flags, assertions, accurate DSP selection and Perl cleanup are retained. No SDK checkout, Python importer or network access is required.\n\nAssertion error strings embed the source layout, so a relocated build can have a different binary hash from the SDK-layout WASM while producing the same PCM.\n\nNo Nintendo IPL ROM or game music/sample files are included.\n');
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (!process.argv[2]) throw new Error('Pass the package directory');
  await copySpcSources(process.argv[2]);
}

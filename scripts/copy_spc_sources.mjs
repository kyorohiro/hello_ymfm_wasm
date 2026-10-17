import {cp, mkdir, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
/** Ship the modified LGPL library and the exact wrapper/build recipe with WASM. */
export async function copySpcSources(destination) {
  const sources = join(destination, 'sources');
  for (const name of ['third_party/snes-spc', 'wasm/spc_wasm.cpp', 'scripts/build_spc_wasm.sh']) {
    const target = join(sources, name);
    await mkdir(join(target, '..'), {recursive:true});
    await cp(join(root, name), target, {recursive:true});
  }
  const notices = join(destination, 'licenses/snes-spc');
  await mkdir(notices, {recursive:true});
  for (const name of ['LICENSE', 'README.md']) await cp(join(root, 'third_party/snes-spc', name), join(notices, name));
  await writeFile(join(sources, 'SNES-SPC.md'), '# SNES SPC source\n\nsnes_spc 0.9.0, LGPL-2.1-or-later; see third_party/snes-spc/LICENSE and README.md for the pinned revision and changes.\nRebuild the included wrapper with Emscripten: `sh scripts/build_spc_wasm.sh` from this sources directory.\nNo Nintendo IPL ROM or game music/sample files are included.\n');
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (!process.argv[2]) throw new Error('Pass the package directory');
  await copySpcSources(process.argv[2]);
}

// Corresponding Nuked LGPL source and WASM rebuild recipe for web distributions.
import {cp, mkdir, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
export async function copyNukedSources(destination) {
  for(const name of ['third_party/nuked-opn2','wasm/nuked_opn2_wasm.c','scripts/build_nuked_opn2_wasm.sh']) {
    const target=join(destination,'sources',name);
    await mkdir(join(target,'..'),{recursive:true});
    await cp(join(root,name),target,{recursive:true});
  }
  const notices=join(destination,'licenses/nuked-opn2');
  await mkdir(notices,{recursive:true});
  for(const name of ['LICENSE','README.md'])await cp(join(root,'third_party/nuked-opn2',name),join(notices,name));
  await writeFile(join(destination,'sources/Nuked-OPN2.md'),`# Nuked OPN2 WASM source

Nuked OPN2 is LGPL-2.1-or-later. The exact core, wrapper, upstream provenance,
copyright notices and license used by this distribution are included here.
See third_party/nuked-opn2/README.md and LICENSE.

Install Emscripten, enter this sources directory, and run:

\`sh scripts/build_nuked_opn2_wasm.sh ../generated\`

This rebuilds generated/nuked_opn2_wasm.js and generated/nuked_opn2_wasm.wasm
beside the deployed runtime. The application loads this separate module using
the unchanged exported API, so an interface-compatible modified build can
replace both generated files. Keep the corresponding source and license when
redistributing a modified library.
`);
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  if(!process.argv[2])throw new Error('Usage: node scripts/copy_nuked_sources.mjs <stage>');
  await copyNukedSources(resolve(process.argv[2]));
}

// Corresponding Nuked LGPL source and standalone WASM recipe for web distributions.
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
export async function copyNukedSources(destination) {
  const sdk=join(root,'third_party/tetorica-soundchip-native');
  const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
  const pin=JSON.parse(await readFile(join(root,'third_party/soundchip-sdk.json'),'utf8'));
  const manifestBytes=await readFile(join(sdk,'RELEASE-MANIFEST.json'));
  if(sha(manifestBytes)!==pin.manifestSha256)throw new Error('Nuked SDK manifest hash mismatch');
  const manifest=JSON.parse(manifestBytes);
  const names=['LICENSE','wasm/nuked_opn2_wasm.c','scripts/build_nuked_opn2_wasm.sh',
    ...Object.keys(manifest.files).filter(name=>name.startsWith('vendor/nuked-opn2/'))];
  // Verify the complete selected library before writing any distribution file.
  const files=await Promise.all(names.map(async name=>{
    const expected=manifest.files[name],bytes=await readFile(join(sdk,name));
    if(!expected||bytes.length!==expected.size||sha(bytes)!==expected.sha256)
      throw new Error(`Nuked SDK source hash mismatch: ${name}`);
    return {name,bytes};
  }));
  const recipe=files.find(file=>file.name==='scripts/build_nuked_opn2_wasm.sh');
  const text=recipe.bytes.toString('utf8');
  if(text.split('vendor/nuked-opn2').length!==3)throw new Error('Unexpected Nuked standalone recipe source paths');
  const standalone=text.replaceAll('vendor/nuked-opn2','third_party/nuked-opn2');
  for(const {name,bytes} of files) {
    const relative=name==='LICENSE'?'LICENSE.tetorica':name.replace(/^vendor\/nuked-opn2\//,'third_party/nuked-opn2/');
    const target=join(destination,'sources',relative);
    await mkdir(join(target,'..'),{recursive:true});
    await writeFile(target,name===recipe.name?standalone:bytes);
  }
  const notices=join(destination,'licenses/nuked-opn2');
  await mkdir(notices,{recursive:true});
  for(const name of ['LICENSE','README.md'])
    await writeFile(join(notices,name),files.find(file=>file.name==='vendor/nuked-opn2/'+name).bytes);
  await writeFile(join(destination,'sources/Nuked-OPN2.md'),`# Nuked OPN2 WASM source

Nuked OPN2 is LGPL-2.1-or-later. The complete modified core, wrapper, upstream provenance,
copyright notices and license used by this distribution come from the pinned SDK source release.
See third_party/nuked-opn2/README.md and LICENSE. Original version comments are retained.
The original Tetorica wrapper and build recipe use BSD-3-Clause; their notice
is included as LICENSE.tetorica. The Nuked core retains its separate LGPL terms.

Install Emscripten, enter this sources directory, and run:

\`sh scripts/build_nuked_opn2_wasm.sh ../generated\`

The explicit argument rebuilds the loader/binary beside the deployed runtime;
the standalone recipe default is dist/wasm/. Its two vendor/nuked-opn2 paths
are relocated to this bundle's third_party/nuked-opn2 layout. C11, O2,
assertions, exports and runtime options are unchanged. No SDK checkout,
Python importer or network access is required to build this bundle.

The application loads this separate module using the unchanged exported API,
so an interface-compatible modified build can replace both generated files.
Keep the corresponding source and license when redistributing a modified library.
`);
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  if(!process.argv[2])throw new Error('Usage: node scripts/copy_nuked_sources.mjs <stage>');
  await copyNukedSources(resolve(process.argv[2]));
}

// Self-contained POKEY sources and original BSD notices for runtime packages.
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');

export async function copyPokeySources(stage) {
  const sdk=join(root,'third_party/tetorica-soundchip-native');
  const pin=JSON.parse(await readFile(join(root,'third_party/soundchip-sdk.json'),'utf8'));
  const manifestBytes=await readFile(join(sdk,'RELEASE-MANIFEST.json'));
  if(sha(manifestBytes)!==pin.manifestSha256)throw new Error('POKEY SDK manifest hash mismatch');
  const manifest=JSON.parse(manifestBytes),inputs=new Map();
  const component='vendor/libvgm-pokey';
  for(const name of ['LICENSE','wasm/pokey_wasm.cpp','scripts/build_pokey_wasm.sh',
    ...['pokey.cpp','pokey.h','LICENSE','README.md','upstream/pokey.c','upstream/snapshot-manifest.json'].map(file=>component+'/'+file)]) {
    const bytes=await readFile(join(sdk,name)),record=manifest.files[name];
    if(!record||bytes.length!==record.size||sha(bytes)!==record.sha256)throw new Error('POKEY SDK source hash mismatch: '+name);
    inputs.set(name,bytes);
  }
  const payload=new Map();
  for(const [name,bytes] of inputs) {
    if(name.startsWith(component+'/'))payload.set('sources/third_party/libvgm-pokey/'+name.slice(component.length+1),bytes);
  }
  for(const file of ['LICENSE','README.md'])payload.set('licenses/libvgm-pokey/'+file,inputs.get(component+'/'+file));
  let recipe=inputs.get('scripts/build_pokey_wasm.sh').toString('utf8');
  if(recipe.split('-Ivendor/libvgm-pokey').length!==2||recipe.split('vendor/libvgm-pokey/pokey.cpp').length!==2)throw new Error('Unexpected POKEY standalone source paths');
  recipe=recipe.replace('-Ivendor/libvgm-pokey','-Ithird_party/libvgm-pokey').replace('vendor/libvgm-pokey/pokey.cpp','third_party/libvgm-pokey/pokey.cpp');
  payload.set('sources/scripts/build_pokey_wasm.sh',recipe);
  payload.set('sources/wasm/pokey_wasm.cpp',inputs.get('wasm/pokey_wasm.cpp'));
  payload.set('sources/LICENSE',inputs.get('LICENSE'));
  payload.set('sources/POKEY-SDK.json',JSON.stringify({schemaVersion:1,sdk:pin,
    inputs:[...inputs].map(([path,bytes])=>({path,size:bytes.length,sha256:sha(bytes)})),
    modifications:['Only standalone recipe include/source paths relocate vendor/libvgm-pokey to third_party/libvgm-pokey. Core, bridge and upstream bytes are unchanged.']},null,2)+'\n');
  payload.set('sources/POKEY.md',`# POKEY source and rebuilding

This bundle contains the BSD-3-Clause standalone POKEY adaptation, exact explicitly licensed upstream libvgm pokey.c, component notice and snapshot manifest. See third_party/libvgm-pokey/README.md and LICENSE for authorship, the pinned revision, documented changes and deliberately omitted unmarked framework files.

From this sources directory, run \`sh scripts/build_pokey_wasm.sh ../generated\` with Emscripten installed. No SDK checkout, importer, network, CPU, ROM or external sample is needed. The source and build inputs are checked against fixed SDK ${pin.version}; POKEY-SDK.json preserves its archive hash and provenance, including whether this is an unpublished local source candidate.

Only include/source paths in the standalone recipe are relocated. Compiler flags, exports, adaptation, bridge and upstream source bytes are retained. Each core handle owns one mono four-channel POKEY. Two independent handles provide dual POKEY; routing and speaker DC correction belong to the host.
`);
  for(const [name,bytes]of payload){const target=join(stage,name);await mkdir(join(target,'..'),{recursive:true});await writeFile(target,bytes);}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(!process.argv[2])throw new Error('Usage: node scripts/copy_pokey_sources.mjs <stage>');
  await copyPokeySources(resolve(process.argv[2]));
}

// Shared NES/FDS WASM licenses and reproducible source for runtime distributions.
import {cp, mkdir, readFile, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
export async function copyNesSources(stage) {
  // Export standalone inputs rather than the checkout's SDK dispatcher shim.
  // Validate every selected SDK file before writing any source or notice.
  const sdk=join(root,'third_party/tetorica-soundchip-native');
  const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
  const pin=JSON.parse(await readFile(join(root,'third_party/soundchip-sdk.json'),'utf8'));
  const manifestBytes=await readFile(join(sdk,'RELEASE-MANIFEST.json'));
  if(sha(manifestBytes)!==pin.manifestSha256)throw new Error('NES SDK manifest hash mismatch');
  const manifest=JSON.parse(manifestBytes);
  const names=['wasm/nesapu_wasm.cpp','scripts/build_nesapu_wasm.sh',
    ...Object.keys(manifest.files).filter(name=>name.startsWith('vendor/tetorica-nes/'))];
  const files=await Promise.all(names.map(async name=>{
    const expected=manifest.files[name],bytes=await readFile(join(sdk,name));
    if(!expected||sha(bytes)!==expected.sha256||bytes.length!==expected.size)throw new Error(`NES SDK source hash mismatch: ${name}`);
    return {name,bytes};
  }));
  const recipe=files.find(file=>file.name==='scripts/build_nesapu_wasm.sh');
  const recipeText=recipe.bytes.toString('utf8');
  if(recipeText.split('vendor/tetorica-nes').length!==3)throw new Error('Unexpected NES standalone recipe source paths');
  const standaloneRecipe=recipeText.replaceAll('vendor/tetorica-nes','third_party/tetorica-nes');
  for(const {name,bytes} of files) {
    const relative=name.replace(/^vendor\/tetorica-nes\//,'third_party/tetorica-nes/');
    const target=join(stage,'sources',relative);
    await mkdir(join(target,'..'),{recursive:true});
    await writeFile(target,name===recipe.name?standaloneRecipe:bytes);
  }
  for(const name of ['jsnes','fixnes-fds']) {
    const target=join(stage,'licenses',name);
    await mkdir(target,{recursive:true});
    for(const file of ['LICENSE','README.md',...(name==='jsnes'?['AUTHORS.md']:[])])await cp(join(root,'third_party',name,file),join(target,file));
  }
  const notice=join(stage,'licenses/tetorica-nes');
  await mkdir(notice,{recursive:true});
  for(const file of ['LICENSE-JSNES','LICENSE-FDS','AUTHORS-JSNES.md','UPSTREAM-JSNES.md','UPSTREAM-FDS.md','README.md']) {
    const source=files.find(source=>source.name==='vendor/tetorica-nes/'+file);
    await writeFile(join(notice,file),source.bytes);
  }
  await writeFile(join(stage,'sources/NES-FDS.md'),`# NES + FDS WASM source\n\nThe default NES/FDS renderer is a C++ port of the deployed JSNES APU and fixNES FDS adaptation. It shares the core used by Native NES.\n\nFrom this sources directory, run \`sh scripts/build_nesapu_wasm.sh docs/generated\` with Emscripten installed. The explicit output argument writes the loader and binary under \`docs/generated/\`; the standalone recipe default is \`dist/wasm/\`. The core, wrapper, recipe and provenance come from the pinned SDK source release. Only the recipe's two \`vendor/tetorica-nes\` paths are relocated to the existing \`third_party/tetorica-nes\` bundle layout. Compiler flags and source contents are retained. No SDK checkout, Python importer or network access is needed to rebuild this bundle.\n\nJSNES portions use Apache-2.0; FDS portions use MIT. See \`third_party/tetorica-nes/README.md\`, its two license files and the original JSNES authors in \`../licenses/jsnes/AUTHORS.md\`. The preserved JavaScript renderer is a compatibility/reference path. No instrument ROM, game ROM or third-party voice bank is bundled.\n`);
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  if(!process.argv[2])throw new Error('Usage: node scripts/copy_nes_sources.mjs <stage>');
  await copyNesSources(resolve(process.argv[2]));
}

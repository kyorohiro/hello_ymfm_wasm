// Shared NES/FDS WASM licenses and reproducible source for runtime distributions.
import {cp, mkdir, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
export async function copyNesSources(stage) {
  for(const name of ['third_party/tetorica-nes','wasm/nesapu_wasm.cpp','scripts/build_nesapu_wasm.sh']) {
    const target=join(stage,'sources',name);
    await mkdir(join(target,'..'),{recursive:true});
    await cp(join(root,name),target,{recursive:true});
  }
  for(const name of ['jsnes','fixnes-fds']) {
    const target=join(stage,'licenses',name);
    await mkdir(target,{recursive:true});
    for(const file of ['LICENSE','README.md',...(name==='jsnes'?['AUTHORS.md']:[])])await cp(join(root,'third_party',name,file),join(target,file));
  }
  const notice=join(stage,'licenses/tetorica-nes');
  await mkdir(notice,{recursive:true});
  for(const file of ['LICENSE-JSNES','LICENSE-FDS','AUTHORS-JSNES.md','UPSTREAM-JSNES.md','UPSTREAM-FDS.md','README.md'])await cp(join(root,'third_party/tetorica-nes',file),join(notice,file));
  await writeFile(join(stage,'sources/NES-FDS.md'),`# NES + FDS WASM source\n\nThe default NES/FDS renderer is a C++ port of the deployed JSNES APU and fixNES FDS adaptation. It shares the core used by Native NES.\n\nFrom this sources directory, run \`sh scripts/build_nesapu_wasm.sh\` with Emscripten installed. The canonical C++ core, wrapper and build script are included at their original relative paths. The generated loader and binary are written under \`docs/generated/\`.\n\nJSNES portions use Apache-2.0; FDS portions use MIT. See \`third_party/tetorica-nes/README.md\`, its two license files and the original JSNES authors in \`../licenses/jsnes/AUTHORS.md\`. The preserved JavaScript renderer is a compatibility/reference path. No instrument ROM, game ROM or third-party voice bank is bundled.\n`);
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  if(!process.argv[2])throw new Error('Usage: node scripts/copy_nes_sources.mjs <stage>');
  await copyNesSources(resolve(process.argv[2]));
}

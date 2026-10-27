// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026, kyorohiro.
// Standalone application-module sources; this does not change the fixed SDK.
import {cp,mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
export async function copyMsm5205Sources(stage){
  const files=['native/msm5205/msm5205_pcm.c','native/msm5205/msm5205_pcm.h',
    'native/msm5205/msm5205_wasm.c','native/msm5205/LICENSE','native/msm5205/NOTICE.md','native/msm5205/README.md',
    'scripts/build_msm5205_wasm.sh'];
  const records=[];
  for(const file of files){
    const bytes=await readFile(join(root,file));
    const target=join(stage,'sources',file);await mkdir(join(target,'..'),{recursive:true});
    await writeFile(target,bytes);
    records.push({path:file,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
  }
  await mkdir(join(stage,'generated'),{recursive:true});
  for(const ext of ['js','wasm'])await cp(join(root,'web/generated',`msm5205_wasm.${ext}`),join(stage,'generated',`msm5205_wasm.${ext}`));
  await mkdir(join(stage,'licenses/tetorica-msm5205'),{recursive:true});
  await cp(join(root,'native/msm5205/LICENSE'),join(stage,'licenses/tetorica-msm5205/LICENSE'));
  await cp(join(root,'native/msm5205/NOTICE.md'),join(stage,'licenses/tetorica-msm5205/README.md'));
  await writeFile(join(stage,'sources/MSM5205.json'),JSON.stringify({schemaVersion:1,
    origin:'Tetorica application module (not a published fixed SDK release)',files:records},null,2)+'\n');
  await writeFile(join(stage,'sources/MSM5205.md'),`# MSM5205 source and rebuilding

This bundle includes the complete C11 raw ADPCM/FIFO renderer, PC Engine packed-RAM playback helper and fixed-memory WASM bridge. The BSD-3-Clause copyright holders and provenance are retained in native/msm5205/LICENSE and NOTICE.md. This application module does not replace the Analyzer's JavaScript VGM renderer or claim a new fixed Native SDK release.

From this sources directory, run \`sh scripts/build_msm5205_wasm.sh ../generated\` with Emscripten installed. No network, ROM, game disc or external SDK checkout is required. Native hosts compile native/msm5205/msm5205_pcm.c and include its header; they retain immutable source storage until replacement/destruction and queue controls on the audio clock. The raw ADPCM mode and PC Engine RAM driver are deliberately separate.

MSM5205.json records every rebuild source byte and SHA-256. The WASM has no host imports, a fixed 128 KiB memory and 128-frame planar output scratch. Its packed sample RAM is bounded to 64 KiB. Browser hosts import msm5205_pcm.js, whose generated loader is included beside this WASM.
`);
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(!process.argv[2])throw new Error('Usage: node scripts/copy_msm5205_sources.mjs <stage>');
  await copyMsm5205Sources(resolve(process.argv[2]));
}

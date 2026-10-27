// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026, kyorohiro.
// Self-contained application-audio sources from the verified fixed SDK.
import {cp, mkdir, readFile, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const descriptions={
  cdda:{title:'CD-DA PCM',label:'CDDA',contract:'The input is raw little-endian interleaved stereo PCM16 at 44,100 Hz, without a WAV header. The caller retains immutable source storage until replacement or destruction. Output rates are 8,000–384,000 Hz. Controls and rendering share one audio clock. Pause freezes the source cursor; mute preserves playback progression; EOF produces exact silence. Native hosts compile native/cdda/cdda_pcm.c and include cdda_pcm.h. The fixed-memory WASM uses a 4 KiB borrowed source window and at most 128 planar stereo frames per call. File decoding, track lists, scheduling and mixing belong to the host.'},
  msm5205:{title:'MSM5205',label:'MSM5205',contract:'The C11 core retains separate raw ADPCM/register/FIFO and PC Engine packed-RAM playback modes. Source storage is immutable and caller-owned until replacement or destruction. PC Engine RAM is limited to 64 KiB, decodes the high nibble first and addresses offsets/lengths in nibbles. Rate 0–15 selects clock / (48 * (16 - rate)). Controls and rendering share one audio clock; mute preserves decoder progression. Native hosts compile native/msm5205/msm5205_pcm.c and include msm5205_pcm.h. The fixed-memory WASM holds 64 KiB source RAM and at most 128 planar stereo frames per call. The Analyzer JavaScript decoder remains a separate behavioral reference; sample encoding, files, scheduling and mixing belong to the host.'},
};

export async function copyApplicationAudioSources(stage,id){
  const description=descriptions[id];
  if(!description)throw new Error('Unknown application-audio module: '+id);
  const sdk=join(root,'third_party/tetorica-soundchip-native');
  const pin=JSON.parse(await readFile(join(root,'third_party/soundchip-sdk.json'),'utf8'));
  const manifestBytes=await readFile(join(sdk,'RELEASE-MANIFEST.json'));
  if(sha(manifestBytes)!==pin.manifestSha256)throw new Error(id+' SDK manifest hash mismatch');
  const manifest=JSON.parse(manifestBytes),component='vendor/tetorica-'+id;
  const recipePath=`scripts/build_${id}_wasm.sh`;
  const names=[`${component}/${id}_pcm.c`,`${component}/${id}_pcm.h`,
    `${component}/LICENSE`,`${component}/NOTICE.md`,`wasm/${id}_wasm.c`,recipePath];
  // Verify every input before writing a distribution file. No local-core fallback.
  const inputs=new Map(await Promise.all(names.map(async path=>{
    const bytes=await readFile(join(sdk,path)),record=manifest.files[path];
    if(!record||bytes.length!==record.size||sha(bytes)!==record.sha256)
      throw new Error(id+' SDK source hash mismatch: '+path);
    return [path,bytes];
  })));
  let recipe=inputs.get(recipePath).toString('utf8');
  if(recipe.split(component).length!==3||recipe.split(`wasm/${id}_wasm.c`).length!==2)
    throw new Error('Unexpected '+id+' standalone recipe source paths');
  recipe=recipe.replaceAll(component,'native/'+id).replace(`wasm/${id}_wasm.c`,`native/${id}/${id}_wasm.c`);
  const payload=new Map();
  for(const file of [`${id}_pcm.c`,`${id}_pcm.h`,'LICENSE','NOTICE.md'])
    payload.set(`sources/native/${id}/${file}`,inputs.get(component+'/'+file));
  payload.set(`sources/native/${id}/${id}_wasm.c`,inputs.get(`wasm/${id}_wasm.c`));
  payload.set('sources/'+recipePath,Buffer.from(recipe));
  payload.set(`sources/native/${id}/README.md`,Buffer.from(`# ${description.title} standalone source\n\nThis BSD-3-Clause component and its WASM bridge come from fixed tetorica-soundchip-native ${pin.version}. See [LICENSE](LICENSE) and [NOTICE.md](NOTICE.md) for terms and origin. The SDK's original source and bridge bytes are unchanged; only the standalone recipe's source/include paths are relocated.\n\n${description.contract}\n\nFrom the containing sources directory, run \`sh scripts/build_${id}_wasm.sh ../generated\` with Emscripten installed. No SDK checkout, importer, network, ROM or game disc is required. The output is ${id}_wasm.js plus ${id}_wasm.wasm. The ES module is an ABI/URL descriptor, not an Emscripten factory. The WASM has no host imports, fixed 128 KiB memory and no memory growth.\n\nThe [source receipt](../../${description.label}.json) records the fixed SDK archive/manifest, original input hashes and bundled-file hashes. The [bundle guide](../../${description.label}.md) describes rebuilding. This application-audio module remains separate from the SDK's generic sound-chip factory IDs.\n`));
  for(const file of ['LICENSE','NOTICE.md'])payload.set(`licenses/tetorica-${id}/${file}`,inputs.get(component+'/'+file));
  // Retain the legacy MSM5205 notice location used by existing packages.
  if(id==='msm5205')payload.set('licenses/tetorica-msm5205/README.md',inputs.get(component+'/NOTICE.md'));
  payload.set(`sources/${description.label}.md`,Buffer.from(`# ${description.title} source and rebuilding\n\nThe complete C11 renderer, header, fixed-memory WASM bridge and BSD-3-Clause notices are included under [native/${id}](native/${id}/README.md). These are application-audio modules distributed by the fixed sound-chip SDK, separately from generic chip IDs.\n\nFrom this sources directory, run:\n\n\`sh scripts/build_${id}_wasm.sh ../generated\`\n\nEmscripten is required. No SDK checkout, Python importer, network, ROM or external sample is needed. The generated descriptor and WASM preserve the existing ABI and may replace the pair beside the host JavaScript modules. Compiler flags, exported functions, core, header and bridge are unchanged. Only three source/include paths in the standalone recipe move to this bundle's native/${id} layout.\n\n[${description.label}.json](${description.label}.json) records the fixed SDK ${pin.version} pin, source archive/manifest hashes, original inputs and bundled files. A local-candidate marker, when present in the pin, is retained rather than claiming a published SDK release. JavaScript parsing, scheduling, Mixer routing and audio-device output remain host responsibilities.\n`));
  const sourceFiles=[...payload].filter(([path])=>path.startsWith('sources/')).map(([path,bytes])=>({path:path.slice(8),bytes:bytes.length,sha256:sha(bytes)}));
  payload.set(`sources/${description.label}.json`,Buffer.from(JSON.stringify({schemaVersion:1,
    origin:'Fixed tetorica-soundchip-native application-audio module',sdk:pin,
    inputs:[...inputs].map(([path,bytes])=>({path,size:bytes.length,sha256:sha(bytes)})),
    files:sourceFiles,modifications:[`Only source/include paths in ${recipePath} relocate ${component} and wasm/${id}_wasm.c to native/${id}. Core, header, bridge, license and notice bytes are unchanged. Bundle README/guide and this receipt are generated.`]},null,2)+'\n'));
  for(const [path,bytes]of payload){const target=join(stage,path);await mkdir(join(target,'..'),{recursive:true});await writeFile(target,bytes);}
  await mkdir(join(stage,'generated'),{recursive:true});
  for(const ext of ['js','wasm'])await cp(join(root,'web/generated',`${id}_wasm.${ext}`),join(stage,'generated',`${id}_wasm.${ext}`));
}

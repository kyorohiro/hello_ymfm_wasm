#!/usr/bin/env node
// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 kyorohiro.
import {readFile,mkdir,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import path from 'node:path';
export const PSF_SPU_TAP_INPUT_SHA256='057ae5d52a2509d1c0efa6b1435802897ae7cb10eb75148d27fa975330970661';
/** Read-only build instrumentation. The pinned SDK file is never overwritten.
 * No voice-generation, PMON, Noise, envelope, mixing or reverb arithmetic is
 * replaced: one callback copies the already-computed per-voice sample/volume.
 */
export function createPsfSpuTapSource(input) {
  if(!(input instanceof Uint8Array))throw new TypeError('SPU tap source must be bytes');
  const bytes=Buffer.from(input.buffer,input.byteOffset,input.byteLength),source=bytes.toString('utf8');
  const sampleAnchor='\t\tconst int16_t sample=interpolated*vi->env_level*vi->audition_gain;';
  const includeAnchor='#include <stdexcept>';
  for(const anchor of [sampleAnchor,includeAnchor])
    if(source.split(anchor).length!==2)throw new Error('PSF SPU tap requires each pinned insertion anchor exactly once');
  if(createHash('sha256').update(bytes).digest('hex')!==PSF_SPU_TAP_INPUT_SHA256)
    throw new Error('Fixed SPU source hash changed; review the passive PSF tap before rebuilding');
  const declaration='\n\n// Generated build-only PSF dry-voice observation; fixed SDK source stays unchanged.\n'+
    'extern "C" void psf_spu_voice_tap(const void*,unsigned int,unsigned int,int,int,int) noexcept;';
  const tap='\n\t\tpsf_spu_voice_tap(this,v,frame,sample,vol[0],vol[1]);';
  return source.replace(includeAnchor,includeAnchor+declaration).replace(sampleAnchor,sampleAnchor+tap);
}

async function main() {
const root=fileURLToPath(new URL('../',import.meta.url));
const vendor=path.join(root,'third_party/play-psf');
const spu=path.join(root,'third_party/tetorica-soundchip-native/vendor/mame-ps1-spu');
const sources=JSON.parse(await readFile(path.join(vendor,'sources.json'),'utf8'));
const outputArg=process.argv.slice(2).find(arg=>arg.startsWith('--out-dir='));
if(process.argv.slice(2).some(arg=>!arg.startsWith('--out-dir=')))throw new Error('Usage: node scripts/build_psf_player.mjs [--out-dir=/absolute/output]');
const out=outputArg?path.resolve(outputArg.slice('--out-dir='.length)):path.join(root,'docs/generated/psf-player');
await mkdir(out,{recursive:true});
// Preserve ordinary loader hooks and the explicit numerical-test WASM input.
const incoming=['ENVIRONMENT','arguments','canvas','dynamicLibraries','elementPointerLock','instantiateWasm','locateFile','monitorRunDependencies','noExitRuntime','noInitialRun','onAbort','onExit','onRuntimeInitialized','postRun','preInit','preRun','print','printErr','setStatus','statusMessage','stderr','stdin','stdout','thisProgram','wasm','websocket','wasmBinary'];
const exports=['_malloc','_free','_psf_create','_psf_render','_psf_render_stems','_psf_destroy','_psf_last_error','_psf_abi_version','_psf_spu_model','_psf_spu_read','_psf_spu_read_ram','_psf_cpu_read_ram','_psf_spu_frames','_psf_spu_key_gates','_psf_spu_active_mask','_psf_trace_start','_psf_trace_count','_psf_trace_read','_psf_trace_overflow','_EmptyBlockHandler','_MemoryUtils_GetByteProxy','_MemoryUtils_GetHalfProxy','_MemoryUtils_GetWordProxy','_MemoryUtils_SetByteProxy','_MemoryUtils_SetHalfProxy','_MemoryUtils_SetWordProxy','_LWL_Proxy','_LWR_Proxy','_SWL_Proxy','_SWR_Proxy'];
const overlay=createPsfSpuTapSource(await readFile(path.join(spu,'spu.cpp')));
const temporary=await mkdtemp(path.join(tmpdir(),'tetorica-psf-spu-tap-'));
try {
const instrumented=path.join(temporary,'spu_psf_voice_tap.cpp');
await writeFile(instrumented,overlay);
const args=[...sources.map(f=>path.join(vendor,f)),instrumented,...['spu_tables.cpp','spureverb.cpp'].map(f=>path.join(spu,f)),path.join(root,'tetorica_src/wasm/psf_player/psf_player.cpp'),'-I'+spu,'-I'+path.join(vendor,'Source'),'-I'+path.join(vendor,'Source/app_shared'),'-I'+path.join(vendor,'deps/Framework/include'),'-I'+path.join(vendor,'deps/CodeGen/include'),'-std=c++17','-O2','-g2','-fwrapv','-fno-strict-aliasing','-ffp-contract=off','-fexceptions','-DNDEBUG','-DLOGGING_ENABLED=0','-sDISABLE_EXCEPTION_CATCHING=0','-sMODULARIZE=1','-sEXPORT_ES6=1','-sEXPORT_NAME=createPsfPlayerModule','-sENVIRONMENT=web,worker,node','-sALLOW_MEMORY_GROWTH=1','-sINITIAL_MEMORY=33554432','-sMAXIMUM_MEMORY=134217728','-sALLOW_TABLE_GROWTH=1','-sINCOMING_MODULE_JS_API='+JSON.stringify(incoming),'-sEXPORTED_FUNCTIONS='+JSON.stringify(exports),'-sEXPORTED_RUNTIME_METHODS='+JSON.stringify(['UTF8ToString','HEAPU8','HEAPF32']),'--bind','-o',path.join(out,'psf_player.js')];
const result=spawnSync(process.env.EMXX||'em++',args,{stdio:'inherit',cwd:root});
process.exitCode=result.status??1;

} finally {await rm(temporary,{recursive:true,force:true});}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)await main();

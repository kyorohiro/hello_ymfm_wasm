// SPDX-License-Identifier: BSD-3-Clause
// Re-run the independent PCM proof before recording this exact source review.
import {readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {GAMEBOY_TIMED_REVISION_BASE_COMMIT as base,GAMEBOY_TIMED_REVISION_RECEIPT as out,GAMEBOY_TIMED_PCM_REPORT as proofPath} from './mixer_calibration_gameboy_timed_revision.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex'),record=bytes=>({bytes:bytes.length,sha256:sha(bytes)});
const functional=new Set(['gameboy_runtime_synth.js','playground_gameboy.js','playground_gameboy_worklet.js','playground_performance_processor.js'].flatMap(name=>['tetorica_src/runtime/'+name,'docs/js/'+name]));
const ui=new Set(['docs/playground/playground_monaco_definitions.js','docs/playground/tetorica-playground-globals.d.ts']);
const tools=new Set(['packages/fm2612/README.md','scripts/fm2612_type_sources.mjs','scripts/package_itch_playground.sh','scripts/sync_web_js_to_docs.sh']);
const names=execFileSync('git',['diff','--name-only',base],{cwd:root,encoding:'utf8'}).trim().split('\n').filter(name=>tools.has(name)||/^(?:docs\/(?:js|playground)\/|tetorica_src\/runtime\/)/.test(name));
const sources={};
for(const name of names){
 const before=execFileSync('git',['show',`${base}:${name}`],{cwd:root,maxBuffer:8*1024*1024}),after=readFileSync(new URL('../'+name,import.meta.url));
 const normalize=bytes=>bytes.toString().replace(/\?v=[A-Za-z0-9._+-]+/g,'');
 if(!functional.has(name)&&!ui.has(name)&&!tools.has(name)&&normalize(before)!==normalize(after))throw Error('Unreviewed non-cache change '+name);
 // Byte prefix/suffix yields one exact replacement, including insertions.
 let prefix=0,suffix=0;while(prefix<Math.min(before.length,after.length)&&before[prefix]===after[prefix])prefix++;
 while(suffix<Math.min(before.length,after.length)-prefix&&before[before.length-1-suffix]===after[after.length-1-suffix])suffix++;
 sources[name]={kind:functional.has(name)?'gameboy-timed-default-path':ui.has(name)?'editor-declarations':tools.has(name)?'non-renderer-api-docs-tools':'import-cache-only',before:record(before),after:record(after),hunks:[{afterOffset:prefix,afterBytes:after.length-prefix-suffix,beforeBase64:before.subarray(prefix,before.length-suffix).toString('base64')}]};
}
const dependencies={};
for(const name of [
 'scripts/check_gameboy_timed_default_pcm.mjs',
 ...['gameboysynth.js','gameboyapu.js','playground_chip_clock.js','playground_native_voice_inspector.js','playground_performance_queue.js','playground_chip_inspector_state.js',
  'gameboy_operations.js','gameboy_timed_state.js','gameboy_timed_client.js','gameboy_timed_processor.js',
  'generated/gameboy_apu_wasm.js','generated/gameboy_apu_wasm.wasm'].map(name=>'tetorica_src/runtime/'+name),
 'tetorica_src/runtime/soundchip_mixer_presets.js','docs/playground/playground_mixer_defaults.js',
])dependencies[name]=record(readFileSync(new URL('../'+name,import.meta.url)));
const receipt={schemaVersion:1,scope:'gameboy-timed-api-default-pcm-parity',baseCommit:base,
 reason:'Only Game Boy client/Worklet timed dispatch and dormant operation resolution are added. The shared processor changes only the explicit timed-operation branch for gameboy; other changed renderer bodies differ solely in exact import cache tokens. Editor declaration/navigation edits do not render audio. No calibration gain or measured statistics are changed.',
 limitations:['New scheduled operations intentionally change sound and are validated separately; default parity is measured without using them.','Offline exact PCM comparison does not claim listening, physical output, Native scheduling or cycle-level hardware validation.'],
 sources,dependencies,proof:record(readFileSync(new URL('../'+proofPath,import.meta.url)))};
writeFileSync(new URL('../'+out,import.meta.url),JSON.stringify(receipt,null,2)+'\n');
console.log(`Recorded ${names.length} exact source pairs; pin ${sha(JSON.stringify(receipt))}`);

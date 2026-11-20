// SPDX-License-Identifier: BSD-3-Clause
// Run the independent PCM comparison before recording this frozen source review.
import {readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {SID_TIMED_REVISION_BASE_COMMIT as base,SID_TIMED_REVISION_RECEIPT as out,SID_TIMED_PCM_REPORT as proofPath} from './mixer_calibration_sid_timed_revision.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex'),record=bytes=>({bytes:bytes.length,sha256:sha(bytes)});
const functional=new Set(['playground_sid.js','playground_sid_worklet.js','playground_runtime.js','playground_performance_processor.js','playground_performance_sender.js'].flatMap(name=>['tetorica_src/runtime/'+name,'docs/js/'+name]));
const ui=new Set(['docs/playground/playground_monaco_definitions.js','docs/playground/tetorica-playground-globals.d.ts','tetorica_src/runtime/playground_sid.d.ts','docs/js/playground_sid.d.ts']);
const tools=new Set(['packages/fm2612/README.md','scripts/fm2612_type_sources.mjs','scripts/package_itch_playground.sh','scripts/check_playground_package.mjs','scripts/sync_web_js_to_docs.sh','scripts/version_playground_runtime.mjs','test/runtime/playground_independent_performance.test.mjs']);
const names=execFileSync('git',['diff','--name-only','--diff-filter=M',base],{cwd:root,encoding:'utf8'}).trim().split('\n').filter(name=>tools.has(name)||/^(?:docs\/(?:js|playground)\/|tetorica_src\/runtime\/)/.test(name));
const sources={};
for(const name of names){
 const before=execFileSync('git',['show',`${base}:${name}`],{cwd:root,maxBuffer:8*1024*1024}),after=readFileSync(new URL('../'+name,import.meta.url));
 const normalize=bytes=>bytes.toString().replace(/\?v=[A-Za-z0-9._+-]+/g,'');
 if(!functional.has(name)&&!ui.has(name)&&!tools.has(name)&&normalize(before)!==normalize(after))throw Error('Unreviewed non-cache change '+name);
 let prefix=0,suffix=0;while(prefix<Math.min(before.length,after.length)&&before[prefix]===after[prefix])prefix++;
 while(suffix<Math.min(before.length,after.length)-prefix&&before[before.length-1-suffix]===after[after.length-1-suffix])suffix++;
 sources[name]={kind:functional.has(name)?'sid-timed-default-path':ui.has(name)?'editor-declarations':tools.has(name)?'non-renderer-api-docs-tools':'import-cache-only',before:record(before),after:record(after),hunks:[{afterOffset:prefix,afterBytes:after.length-prefix-suffix,beforeBase64:before.subarray(prefix,before.length-suffix).toString('base64')}]};
}
const dependencies={};
for(const name of [
 'scripts/check_sid_timed_default_pcm.mjs',
 ...['sidsynth.js','sid.js','sid8580.js','sid_waveforms.js','soundchip_pitch.js','playground_chip_clock.js','playground_sid_inspector.js','playground_performance_queue.js','playground_chip_inspector_state.js','playground_opn_worklet.js',
  'sid_operations.js','sid_timed_state.js','sid_timed_client.js','sid_timed_processor.js',
  'ym2612.js','ym2612synth.js','ym2612_timed_processor.js','generated/ym2612_wasm.js','generated/ym2612_wasm.wasm','generated/nuked_opn2_wasm.js','generated/nuked_opn2_wasm.wasm','generated/sid/sid.wasm'].map(name=>'tetorica_src/runtime/'+name),
 'docs/generated/sid8580-machine/sid8580-endpoint.wasm',
 'tetorica_src/runtime/soundchip_mixer_presets.js','docs/playground/playground_mixer_defaults.js',
])dependencies[name]=record(readFileSync(new URL('../'+name,import.meta.url)));
const receipt={schemaVersion:1,scope:'sid-timed-api-default-pcm-parity',baseCommit:base,
 reason:'Only SID client/Worklet timed dispatch, packed parameter intent and operation resolution are added. The shared processor changes only three explicit SID ownership/timed branches, with one SID RPC name added to the shared sender; other renderer changes differ solely in exact import cache tokens. Existing default SID and primary YM2612 Worklet PCM is bit-identical with the added timed API inactive. Editor declaration/navigation and package tooling edits do not render audio. No calibration gain or measured statistics are changed.',
 limitations:['Scheduled operations intentionally alter sound and have separate timing/ownership/browser tests.','This exact offline comparison does not claim listening, physical output, Native scheduling or cycle-level hardware accuracy.'],
 sources,dependencies,proof:record(readFileSync(new URL('../'+proofPath,import.meta.url)))};
writeFileSync(new URL('../'+out,import.meta.url),JSON.stringify(receipt,null,2)+'\n');
console.log(`Recorded ${names.length} exact source pairs; pin ${sha(JSON.stringify(receipt))}`);

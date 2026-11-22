// Test-only archived inputs for immutable historical proof tests. These bytes
// never participate in production freshness approval or generated policies.
// Freeze unchanged-at-cut dependencies too: later queue, Synth CSS,
// WonderSwan, PS1 timed API, YM2413 state ABI, shared Sega timed APIs and example
// edits must not leak into historical proofs. Later additions use individually
// pinned Git cuts without replacing any earlier archived body.
// The fixture integrity test compares every complete body to its fixed Git revision.
import {readFileSync as readLive} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {relative,resolve} from 'node:path';
import {createHistoricalFm2612ApplicationReader} from './historical_fm2612_application_source_fixture.mjs';
import {createHistoricalYm2608SourceMixReader} from './historical_ym2608_source_mix_fixture.mjs';
import {createHistoricalGitReader} from './historical_calibration_git_reader.mjs';
import {createCodeApiConsistencyRevisionReadContext} from '../../scripts/mixer_calibration_code_api_consistency_revision.mjs';
export const HUC_HISTORY_PIN='d5a45dfd85decc9f9c4d2605709727803b7bd86f52ba056f3bc123ad1b7a6fa0';
export const HUC_HISTORY_PATH='test/fixtures/pre-huc-timed-calibration-inputs.json';
const root=fileURLToPath(new URL('../../',import.meta.url));
const snapshot=JSON.parse(readLive(new URL('../../'+HUC_HISTORY_PATH,import.meta.url))),sha=b=>createHash('sha256').update(b).digest('hex');
if(sha(JSON.stringify(snapshot))!==HUC_HISTORY_PIN||snapshot.scope!=='test-only-pre-huc6280-timed-inputs')throw Error('Invalid historical HuC6280 test input archive');
const decoded=new Map();
const readHistoricalScspInput=createHistoricalGitReader('68caf4b8aedfe8b4913aebc8076606e1f631d744');
const readYm2612TimedInput=createHistoricalGitReader('0ea54fd359d6443207f4d8b1b64d1af26ee67c22');
const readAyTimedInput=createHistoricalGitReader('2e67ed9294eee111cc00083d8307c4e10d4b6b0d');
const codeApiPredecessor=createCodeApiConsistencyRevisionReadContext(readLive);
// Later FM and Code changes touched these unchanged-at-SCSP-cut dependencies.
// The reviewed YM2612 timed receipt still authenticates every exact body.
const ym2612TimedHistoricalDependencies=new Set([
 'tetorica_src/runtime/megasynth.js',
 'tetorica_src/runtime/playground_opn_inspector.js',
 'tetorica_src/runtime/playground_worker_chip.js',
 'tetorica_src/runtime/ym2612_operation_state.js',
 ...[
  'megasynth.js','native_genesis_extra_ym2612.js','native_genesis_synth.js',
  'playground_opn.js','playground_opn_inspector.js','playground_opn_worklet.js','playground_worker_chip.js',
  'soundchip-output-worklet.js','ym2612-worklet.js','ym2612-worklet-nuked.js',
  'ym2612synth.js','ym2612_operation_state.js','ym2612_operations.js',
  'ym2612_timed_state.js','ym2612_timed_client.js','ym2612_timed_processor.js',
 ].map(name=>'docs/js/'+name),
 'test/helpers/historical_ym2612_timed_source_fixture.mjs',
 'test/helpers/historical_ym2612_timed_synth.mjs',
]);
const scspHistoricalDependencies=new Set([
 'docs/js/native_genesis_scsp.js',
 'docs/js/scspsynth.js',
 'docs/js/playground_scsp.js',
 'docs/js/playground_scsp_audio.js',
 'docs/js/playground_scsp_worklet.js',
 'docs/playground/index.html',
 'docs/playground/playground.js',
 'docs/playground/playground_mode.js',
 'docs/playground/playground_mode_starters.test.mjs',
 'docs/playground/playground_monaco.js',
 'docs/playground/wonderswan_vgm_import.js',
]);

export function readCodeApiPredecessorFileSync(location,options){
 const url=location instanceof URL?location:new URL('file://'+resolve(String(location)));
 const bytes=codeApiPredecessor.readSource(url),encoding=typeof options==='string'?options:options?.encoding;
 return encoding?bytes.toString(encoding):bytes;
}
export function readPreHucTimedInput(location){
 const url=location instanceof URL?location:new URL('file://'+resolve(String(location)));
 const name=relative(root,fileURLToPath(url)).replaceAll('\\','/'),entry=snapshot.sources[name];
 if(scspHistoricalDependencies.has(name))return readHistoricalScspInput(url);
 if(ym2612TimedHistoricalDependencies.has(name))return readYm2612TimedInput(url);
 if(name==='docs/js/native_runtime_synth.js'||name==='docs/js/playground_ay8910_worklet.js')return readAyTimedInput(url);
 if(!entry){
  // Receipts for the original SCSP application can still check their inputs
  // after SSF removal. Git supplies bytes for hashing without loading a player.
  if(/^(?:docs\/(?:synth-scsp|generated\/ssf-player)\/|tetorica_src\/wasm\/ssf_player\/|third_party\/ssfplay\/|scripts\/(?:check_scsp_.*_browser\.cjs|build_ssf_player\.mjs|record_scsp_ssf_dsp_passive_parity\.mjs|package_itch_scsp_synth(?:\.test)?\.mjs)$)/.test(name))
   return readHistoricalScspInput(url);
  return codeApiPredecessor.readSource(url);
 }
 if(!decoded.has(name)){
  const bytes=gunzipSync(Buffer.from(entry.gzipBase64,'base64'),{maxOutputLength:2*1024*1024});
  if(bytes.length!==entry.bytes||sha(bytes)!==entry.sha256)throw Error('Historical HuC6280 source mismatch: '+name);
  decoded.set(name,bytes);
 }
 return Buffer.from(decoded.get(name));
}
const postSourceMix=createHistoricalFm2612ApplicationReader(readPreHucTimedInput);
const reviewed=createHistoricalYm2608SourceMixReader(postSourceMix);
export function readPostSourceMixFileSync(location,options){
 const url=location instanceof URL?location:new URL('file://'+resolve(String(location))),bytes=postSourceMix(url);
 const encoding=typeof options==='string'?options:options?.encoding;
 return encoding?bytes.toString(encoding):bytes;
}
export function readFileSync(location,options){
 const url=location instanceof URL?location:new URL('file://'+resolve(String(location))),bytes=reviewed(url);
 const encoding=typeof options==='string'?options:options?.encoding;
 return encoding?bytes.toString(encoding):bytes;
}

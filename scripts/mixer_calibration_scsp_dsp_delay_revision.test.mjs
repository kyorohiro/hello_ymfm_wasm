import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {restoreMixerCalibrationScspDspDelayRevision as restore,
  createScspDspDelayRevisionReader,createScspDspDelayRevisionReadContext,
  SCSP_DSP_DELAY_REVISION_BASE_COMMIT as baseCommit,
  SCSP_DSP_DELAY_REVISION_RECEIPT_PATH as receiptPath,
  SCSP_DSP_DELAY_REVISION_RECEIPT_OBJECT_SHA256 as receiptSha,
  SCSP_DSP_DELAY_REVISION_SOURCE_PATHS as paths,
  SCSP_DSP_DELAY_REVISION_RELATED_PATHS as related,
  SCSP_DSP_DELAY_REVISION_REPORT_PATHS as reports} from './mixer_calibration_scsp_dsp_delay_revision.mjs';
import {createScspDspExecutionRevisionReader} from './mixer_calibration_scsp_dsp_execution_revision.mjs';
import {createScspDspRoutingRevisionReadContext} from './mixer_calibration_scsp_dsp_routing_revision.mjs';
import {restoreMixerCalibrationVabApiRevision} from './mixer_calibration_vab_api_revision.mjs';

const url=path=>new URL('../'+path,import.meta.url),read=path=>createScspDspRoutingRevisionReadContext().readSource(url(path));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const receipt=JSON.parse(read(receiptPath));
const match=(bytes,record)=>{assert.equal(bytes.length,record.bytes);assert.equal(sha(bytes),record.sha256);};

test('managed Delay source pairs retain complete pinned predecessors and default audio evidence',()=>{
  assert.equal(sha(JSON.stringify(receipt)),receiptSha);assert.equal(receipt.baseCommit,baseCommit);
  assert.equal(read(receiptPath).toString(),JSON.stringify(receipt,null,2)+'\n');
  assert.deepEqual(Object.keys(receipt.sources),[...paths]);
  assert.deepEqual(Object.keys(receipt.relatedSources),[...related]);
  assert.deepEqual(Object.keys(receipt.reports),[...reports]);
  for(const path of paths){const bytes=read(path);match(bytes,receipt.sources[path].after);const before=restore(path,bytes);match(before,receipt.sources[path].before);assert.equal(restore(path,before),before);}
  for(const path of [...related,...reports])match(read(path),receipt.relatedSources[path]??receipt.reports[path]);
});

test('source aliases and older nested proofs receive the exact pre-Delay source',()=>{
  for(const[alias,canonical]of [['web/scspsynth.js','tetorica_src/runtime/scspsynth.js'],['js/playground_scsp_worklet.js','docs/js/playground_scsp_worklet.js'],['playground/playground.js','docs/playground/playground.js']])
    assert.deepEqual(restore(alias,read(canonical)),restore(canonical,read(canonical)));
  const prior=JSON.parse(read('docs/issues/playground_scsp_dsp_execution_source_revision_01.json'));
  const current=JSON.parse(read('docs/issues/ym2612_timed_operations_source_revision_01.json'));
  const runtime='docs/js/playground_runtime.js';
  match(createScspDspDelayRevisionReader()(url(runtime)),receipt.sources[runtime].before);
  match(createScspDspExecutionRevisionReader()(url(runtime)),prior.sources[runtime].before);
  match(restoreMixerCalibrationVabApiRevision(runtime,read(runtime)),current.sources[runtime].before);
});

test('future edits and unrelated paths receive no source reconstruction',()=>{
  for(const path of paths){const bytes=read(path);for(const modified of [Buffer.concat([bytes,Buffer.from('\n')]),Buffer.from(bytes).fill(0,bytes.length-1)])assert.equal(restore(path,modified),modified);}
  const bytes=read(paths[0]);for(const path of ['docs/js/not-listed.js','../'+paths[0],'docs/generated/scsp_wasm.wasm'])assert.equal(restore(path,bytes),bytes);
});

test('all runtime, profile, codec, example, audio and measurement dependencies are independently pinned',()=>{
  const target=paths[0],bytes=read(target);
  for(const dependency of [...paths,...related,...reports])assert.throws(()=>restore(target,bytes,{readSource(location){const current=readFileSync(location);return location.href===url(dependency).href?Buffer.concat([current,Buffer.from('\n')]):current;}}),/pinned source\/report dependency changed/,dependency);
  assert.throws(()=>restore(target,bytes,{readSource(location){if(location.href!==url(receiptPath).href)return readFileSync(location);const forged=structuredClone(receipt);forged.sources[target].before.sha256='0'.repeat(64);return Buffer.from(JSON.stringify(forged));}}),/independently pinned receipt/);
});

test('one proof owns reads while retained ordinary readers and subsequent proofs revalidate',()=>{
  let changed=false;const counts=new Map(),target=paths[0],codec=url('tetorica_src/runtime/scsp_dsp.js').href;
  const source=location=>{counts.set(location.href,(counts.get(location.href)??0)+1);const bytes=readFileSync(location);return changed&&location.href===codec?Buffer.concat([bytes,Buffer.from('\n')]):bytes;};
  const proof=createScspDspDelayRevisionReadContext(source);match(proof.restore(target,read(target)),receipt.sources[target].before);
  for(const path of paths){match(proof.readSource(url(path)),receipt.sources[path].before);match(proof.readSource(url(path)),receipt.sources[path].before);}
  assert([...counts.values()].every(count=>count===1));
  const reader=createScspDspDelayRevisionReader(source);match(reader(url(target)),receipt.sources[target].before);changed=true;
  assert.throws(()=>reader(url(target)),/pinned source\/report dependency changed/);
  assert.throws(()=>createScspDspDelayRevisionReadContext(source).restore(target,read(target)),/pinned source\/report dependency changed/);
});

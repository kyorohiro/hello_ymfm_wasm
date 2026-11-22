import {historicalCalibrationModule} from '../test/helpers/historical_calibration_modules.mjs';
import {createHistoricalGitReader} from '../test/helpers/historical_calibration_git_reader.mjs';
// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
// The audit must use the complete source and dependency tree reviewed by the receipt.
const sourceCommit = '39c8f1e024dd8727c75bb764d2630605092e5677';
const readFileSync = createHistoricalGitReader(sourceCommit);
const {assertMixerCalibrationSourceFreshness}=await historicalCalibrationModule('mixer_calibration_sources.mjs',{sourceCommit});
const {
  AY_SINGLE_OUTPUT_UI_CACHE_RECEIPT_PATH:receiptPath,
  AY_SINGLE_OUTPUT_UI_CACHE_RECEIPT_OBJECT_SHA256:pin,
  AY_SINGLE_OUTPUT_UI_CACHE_SOURCE_PATHS:paths,
  AY_SINGLE_OUTPUT_UI_CACHE_REPORT_PATHS:reports,
  restoreMixerCalibrationAySingleOutputUiCacheRevision:restore,
}=await historicalCalibrationModule('mixer_calibration_ay_single_output_ui_cache_revision.mjs',{sourceCommit});

const read=path=>readFileSync(new URL('../'+path,import.meta.url));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const receipt=JSON.parse(read(receiptPath));
const measuredReports=reports.map(path=>JSON.parse(read(path)));

test('two restored passive UI cache keys preserve all six immutable AY measurement reports',()=>{
  assert.equal(sha(JSON.stringify(receipt)),pin);
  assert.deepEqual(Object.keys(receipt.sources),paths);assert.deepEqual(Object.keys(receipt.reports),reports);
  for(const report of measuredReports)for(const path of paths){
    const bytes=read('docs/'+path),entry=receipt.sources[path],record=report.sources[path];
    assert.equal(bytes.toString(),entry.servedText);
    const measured=restore(path,bytes,{report,record});
    assert.notEqual(measured,bytes);assert.equal(measured.toString(),entry.measuredText);
    assert.equal(measured.length,record.bytes);assert.equal(sha(measured),record.sha256);
    assert.equal(assertMixerCalibrationSourceFreshness({path,bytes,record,report}),'ui-ay-single-output-cache-restoration');
  }
  for(const path of reports){const bytes=read(path);assert.equal(bytes.length,receipt.reports[path].bytes);assert.equal(sha(bytes),receipt.reports[path].sha256);}
});

test('the cache proof changes exactly one reviewed import at each complete source body',()=>{
  const replacements=[
    ["./playground_monaco_definitions.js?v=ps1-vab-api-1","./playground_monaco_definitions.js?v=sdsp-code-review-1"],
    ["../js/wonderswan_timeline.js?v=pokey-prepare-1","../js/wonderswan_timeline.js"],
  ];
  for(let index=0;index<paths.length;index++){
    const entry=receipt.sources[paths[index]],[before,after]=replacements[index];
    assert.equal(entry.measuredText.split(before).length,2);
    assert.equal(entry.measuredText.replace(before,after),entry.servedText);
  }
});

test('future source/cache/import edits, detached records and prior or edited reports receive no equivalence',()=>{
  const report=measuredReports[0];
  for(const path of paths){
    const bytes=read('docs/'+path),record=report.sources[path],changed=Buffer.from(bytes);changed[changed.length-2]^=1;
    for(const future of [changed,Buffer.concat([bytes,Buffer.from('\n')]),Buffer.from(bytes.toString().replace('.js?', '.js?next-'))])
      if(!future.equals(bytes))assert.equal(restore(path,future,{report,record}),future);
    const detached={...record,sha256:'0'.repeat(64)};assert.equal(restore(path,bytes,{report,record:detached}),bytes);
    const edited=structuredClone(report);edited.rows[0].frequencyHz++;
    assert.equal(restore(path,bytes,{report:edited,record}),bytes);
    const prior=JSON.parse(read('docs/issues/ps1_spc_voice_edit_chip_levels_01.json'));
    assert.equal(restore(path,bytes,{report:prior,record}),bytes);
    assert.equal(restore(path,bytes,{record}),bytes);
  }
  const bytes=read('docs/'+paths[0]),record=report.sources[paths[0]];
  for(const path of ['js/ay8910.js','generated/ay8910_wasm.wasm','playground/playground.js','__proto__'])
    assert.equal(restore(path,bytes,{report,record}),bytes);
});

test('every report raw hash and the independently pinned receipt remain mandatory',()=>{
  const path=paths[0],bytes=read('docs/'+path),report=measuredReports[0],record=report.sources[path];
  for(const target of reports)assert.throws(()=>restore(path,bytes,{report,record,readSource(url){
    const original=readFileSync(url);return url.pathname.endsWith('/'+target)?Buffer.concat([original,Buffer.from('\n')]):original;
  }}),/immutable measurement changed/);
  assert.throws(()=>restore(path,bytes,{report,record,readSource(url){
    const original=readFileSync(url);if(!url.pathname.endsWith('/'+receiptPath))return original;
    const edited=JSON.parse(original);edited.scope+='-future';return Buffer.from(JSON.stringify(edited));
  }}),/independent receipt pin changed/);
  for(const target of ['docs/playground/playground_monaco_definitions.js','docs/js/wonderswan_timeline.js'])
    assert.throws(()=>restore(path,bytes,{report,record,readSource(url){
      const original=readFileSync(url);return url.pathname.endsWith('/'+target)?Buffer.concat([original,Buffer.from('\n')]):original;
    }}),/import target changed/);
});

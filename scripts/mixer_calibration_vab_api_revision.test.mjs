import {historicalCalibrationModule} from '../test/helpers/historical_calibration_modules.mjs';
const {restoreMixerCalibrationSynthSourceNavigationRevision:restoreNavigation}=await historicalCalibrationModule('mixer_calibration_synth_source_navigation_revision.mjs');
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readHistoricalAyTimedFileSync as readFileSync} from '../test/helpers/historical_ay_timed_source_fixture.mjs';
const {
  VAB_API_REVISION_BASE_COMMIT,VAB_API_REVISION_RECEIPT_PATH,VAB_API_REVISION_RECEIPT_OBJECT_SHA256,
  VAB_API_REVISION_SOURCE_PATHS,VAB_API_REVISION_RELATED_PATHS,VAB_API_REVISION_REPORT_PATHS,
  VAB_API_PRIOR_EXPORT_PATHS,restoreMixerCalibrationVabApiRevision,
}=await historicalCalibrationModule('mixer_calibration_vab_api_revision.mjs');
import {isSoundChipPsgSourceLayoutRevision} from './generate_soundchip_mixer_presets.mjs';
const {restoreMixerCalibrationHuc6280UiRevision}=await historicalCalibrationModule('mixer_calibration_huc6280_ui_revision.mjs');

const url=path=>new URL('../'+path,import.meta.url);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const evidence=JSON.parse(readFileSync(url(VAB_API_REVISION_RECEIPT_PATH),'utf8'));

test('VAB receipt is independently pinned, deterministic and retains untouched original measurement bytes without requiring Git history',()=>{
  assert.equal(sha(JSON.stringify(evidence)),VAB_API_REVISION_RECEIPT_OBJECT_SHA256);
  assert.equal(evidence.baseCommit,VAB_API_REVISION_BASE_COMMIT);
  assert.equal(readFileSync(url(VAB_API_REVISION_RECEIPT_PATH),'utf8'),JSON.stringify(evidence,null,2)+'\n');
  assert.deepEqual(Object.keys(evidence.sources).sort(),[...VAB_API_REVISION_SOURCE_PATHS].sort());
  assert.deepEqual(Object.keys(evidence.relatedSources).sort(),[...VAB_API_REVISION_RELATED_PATHS].sort());
  for(const path of VAB_API_REVISION_REPORT_PATHS) {
    const bytes=readFileSync(url(path));assert.equal(bytes.length,evidence.reports[path].bytes);assert.equal(sha(bytes),evidence.reports[path].sha256);
  }
  for(const path of VAB_API_REVISION_RELATED_PATHS.filter(path=>path.includes('/generated/')||path.endsWith('/soundchip_mixer_presets.js')))
    assert.deepEqual(evidence.relatedSources[path].after,evidence.relatedSources[path].before,'measured WASM and gains remain byte-exact');
  const forged=structuredClone(evidence);forged.sources[VAB_API_REVISION_SOURCE_PATHS[0]].before.sha256='0'.repeat(64);
  assert.notEqual(sha(JSON.stringify(forged)),VAB_API_REVISION_RECEIPT_OBJECT_SHA256,'editing evidence cannot retain the independent pin');
});

test('the historical VAB export receipt cannot approve current sources after the AY native output revision',()=>{
  for(const path of VAB_API_REVISION_SOURCE_PATHS) {
    const bytes=readFileSync(url(path)),current=restoreMixerCalibrationHuc6280UiRevision(path.replace(/^docs\//,''),restoreNavigation(path.replace(/^docs\//,''),bytes));
    const known=[evidence.sources[path],evidence.priorSourceExport.sources[path]].some(entry=>entry&&current.length===entry.after.bytes&&sha(current)===entry.after.sha256);
    if(!known) {
      assert.equal(restoreMixerCalibrationVabApiRevision(path,current),current,'An unlisted later source body is outside this exact VAB source pair');
    }else assert.throws(()=>restoreMixerCalibrationVabApiRevision(path,current),/pinned report\/helper\/cache dependency changed: docs\/generated\/ay8910_wasm\.wasm/,
      'Actual AY WASM changes require new measurements; an export-only receipt cannot authorize them');
  }
});

test('unknown paths, additional edits, same-length changes and changed source imports receive no normalization or exemption',()=>{
  for(const path of VAB_API_REVISION_SOURCE_PATHS) {
    const current=readFileSync(url(path)),sameLength=Buffer.from(current);sameLength[sameLength.length-1]^=1;
    for(const changed of [sameLength,Buffer.concat([current,Buffer.from('\n// unreviewed edit\n')])])
      assert.equal(restoreMixerCalibrationVabApiRevision(path,changed),changed,path);
  }
  const body=readFileSync(url(VAB_API_REVISION_SOURCE_PATHS[0]));
  for(const path of ['js/another_runtime.js','playground/other.js','../'+VAB_API_REVISION_SOURCE_PATHS[0]])
    assert.equal(restoreMixerCalibrationVabApiRevision(path,body),body);
});

test('every added helper, cache, declaration, example and measured dependency is pinned before accepting a known source pair',()=>{
  const path=VAB_API_REVISION_SOURCE_PATHS[0],bytes=readFileSync(url(path));
  for(const dependency of [...VAB_API_REVISION_RELATED_PATHS,...VAB_API_REVISION_REPORT_PATHS]) {
    const target=url(dependency).href;
    assert.throws(()=>restoreMixerCalibrationVabApiRevision(path,bytes,{readSource(location){
      const original=readFileSync(location);return location.href===target?Buffer.concat([original,Buffer.from([0])]):original;
    }}),/pinned report\/helper\/cache dependency changed/,dependency);
  }
});

test('the canonical PSG factory requires fresh PSG06 evidence after the AY WASM addition',()=>{
  const path='tetorica_src/runtime/soundchip.js',current=readFileSync(url(path));
  const historical=JSON.parse(readFileSync(url('docs/issues/soundchip_psg_levels_05.json'),'utf8'));
  assert.notEqual(sha(current),historical.sources[path]);
  assert.throws(()=>restoreMixerCalibrationVabApiRevision(path,current),/pinned report\/helper\/cache dependency changed: docs\/generated\/ay8910_wasm\.wasm/);
  const measured=JSON.parse(readFileSync(url('docs/issues/soundchip_psg_levels_06.json'),'utf8'));
  assert.equal(sha(current),measured.sources[path]);
  assert.equal(sha(readFileSync(url('docs/generated/ay8910_wasm.wasm'))),measured.sources['docs/generated/ay8910_wasm.wasm']);
  const changed=Buffer.concat([current,Buffer.from('\n')]);assert.equal(restoreMixerCalibrationVabApiRevision(path,changed),changed);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {
  VAB_API_REVISION_BASE_COMMIT,VAB_API_REVISION_RECEIPT_PATH,VAB_API_REVISION_RECEIPT_OBJECT_SHA256,
  VAB_API_REVISION_SOURCE_PATHS,VAB_API_REVISION_RELATED_PATHS,VAB_API_REVISION_REPORT_PATHS,
  VAB_API_PRIOR_EXPORT_PATHS,restoreMixerCalibrationVabApiRevision,
} from './mixer_calibration_vab_api_revision.mjs';
import {isSoundChipPsgSourceLayoutRevision} from './generate_soundchip_mixer_presets.mjs';
import {restoreMixerCalibrationHuc6280UiRevision} from './mixer_calibration_huc6280_ui_revision.mjs';

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

test('each complete current source reconstructs its exact predecessor, including the separately named earlier raw VAB export',()=>{
  for(const path of VAB_API_REVISION_SOURCE_PATHS) {
    const bytes=readFileSync(url(path)),current=restoreMixerCalibrationHuc6280UiRevision(path.replace(/^docs\//,''),bytes),restored=restoreMixerCalibrationVabApiRevision(path,current);
    const expected=VAB_API_PRIOR_EXPORT_PATHS.includes(path)?evidence.priorSourceExport.sources[path].before:evidence.sources[path].before;
    assert.equal(restored.length,expected.bytes,path);assert.equal(sha(restored),expected.sha256,path);
    if(path.startsWith('docs/'))assert.deepEqual(restoreMixerCalibrationVabApiRevision(path.slice(5),current),restored,'served source names use the same fixed inventory');
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

test('the canonical PSG factory guard accepts only the pinned additive VAB exports and still requires the historical layout hash',()=>{
  const path='tetorica_src/runtime/soundchip.js',current=readFileSync(url(path));
  const report=JSON.parse(readFileSync(url('docs/issues/soundchip_psg_levels_05.json'),'utf8')),expected=report.sources[path];
  const accepted=bytes=>sha(bytes)===expected||isSoundChipPsgSourceLayoutRevision(path,bytes,expected);
  assert.equal(typeof expected,'string');assert.equal(accepted(current),false);
  const restored=restoreMixerCalibrationVabApiRevision(path,current);
  assert.equal(accepted(restored),true);
  const changed=Buffer.concat([current,Buffer.from('\n')]);
  assert.equal(accepted(restoreMixerCalibrationVabApiRevision(path,changed)),false);
});

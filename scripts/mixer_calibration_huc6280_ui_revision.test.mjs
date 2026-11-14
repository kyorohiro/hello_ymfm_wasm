// Passive source provenance and navigation only: no AudioContext or output.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {
  HUC6280_UI_REVISION_RECEIPT_PATH as receiptPath,HUC6280_UI_REVISION_RECEIPT_OBJECT_SHA256 as pin,
  HUC6280_UI_REVISION_SOURCE_PATHS as paths,HUC6280_UI_REVISION_REPORT_PATHS as reports,
  restoreMixerCalibrationHuc6280UiRevision as restore,
} from './mixer_calibration_huc6280_ui_revision.mjs';
import {assertMixerCalibrationSourceFreshness as fresh} from './mixer_calibration_sources.mjs';
import {definitionSource,runtimeSourceUrl} from '../docs/playground/playground_monaco_definitions.js';
const read=path=>readFileSync(new URL('../'+path,import.meta.url));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const receipt=JSON.parse(read(receiptPath));

test('the independently pinned passive revision reconstructs exact VAB predecessors and preserves all measured reports',()=>{
  assert.equal(sha(JSON.stringify(receipt)),pin);
  assert.equal(read(receiptPath).toString(),JSON.stringify(receipt,null,2)+'\n');
  const prior=JSON.parse(read('docs/issues/ps1_vab_public_api_source_revision_01.json'));
  for(const path of paths) {
    const current=read('docs/'+path),original=restore(path,current),entry=receipt.sources[path];
    assert.notEqual(original,current);assert.equal(original.length,entry.before.bytes);assert.equal(sha(original),entry.before.sha256);
    assert.deepEqual(entry.before,prior.sources['docs/'+path].after,'predecessor connects to the previously reviewed exact body');
    assert.equal(fresh({path,bytes:current,record:entry.before}),'ui-huc6280-definitions');
    assert.equal(fresh({path,bytes:current,record:entry.after}),'raw','later exact measurements need no exception');
    assert.equal(restore(path,original),original);
    for(const reportPath of reports) {
      const bytes=read(reportPath),report=JSON.parse(bytes),identity=receipt.reports[reportPath];
      assert.equal(bytes.length,identity.bytes);assert.equal(sha(bytes),identity.sha256);
      assert.doesNotThrow(()=>fresh({path,bytes:current,record:report.sources[path],report}));
      assert.deepEqual(read(reportPath),bytes,'validation never rewrites source fingerprints or measured levels');
    }
  }
});

test('one-byte, extra-byte, cache-token, import and future viewer edits remain stale',()=>{
  for(const path of paths) {
    const current=read('docs/'+path),entry=receipt.sources[path],oneByte=Buffer.from(current);oneByte[Math.floor(oneByte.length/2)]^=1;
    const changes=[oneByte,Buffer.concat([current,Buffer.from('\n')]),Buffer.from("import './different-dsp.js';\n"+current),
      Buffer.from(current.toString().replace('huc-cdrom2-1','huc-cdrom2-2')),
      Buffer.from(current.toString().replace('msm5205_player.js','msm5205_future.js')),
      Buffer.from(current.toString().replace('readOnly:true','readOnly:false'))];
    for(const changed of changes.filter(changed=>!changed.equals(current))) {
      assert.equal(restore(path,changed),changed);
      assert.throws(()=>fresh({path,bytes:changed,record:entry.before}),/remeasure/);
    }
    for(const other of ['__proto__','docs/'+path,'js/other.js','generated/huc6280_wasm.wasm','js/soundchip_mixer_presets.js']) {
      assert.equal(restore(other,current),current);
      assert.throws(()=>fresh({path:other,bytes:current,record:entry.before}));
    }
    assert.throws(()=>fresh({path,bytes:current,record:{...entry.before,sha256:'0'.repeat(64)}}),/remeasure/);
    for(const target of reports)assert.throws(()=>restore(path,current,{readSource(url){const bytes=readFileSync(url);return url.pathname.endsWith('/'+target)?Buffer.concat([bytes,Buffer.from([0])]):bytes;}}),/original measurement changed/);
  }
});

test('new source mappings are passive and existing oscillator, SID and FM definitions retain their targets',async()=>{
  const path='playground/playground_monaco_definitions.js',original=restore(path,read('docs/'+path));
  const before=await import('data:text/javascript;base64,'+original.toString('base64'));
  for(const owner of ['PlaygroundPrimaryYm2612','PlaygroundPrimaryPs1','SpuCodeClient','PlaygroundSid','PlaygroundGameboy','PlaygroundNes']) {
    const code=`interface ${owner} {\n  noteOn(): Promise<void>;\n}`;
    assert.deepEqual(definitionSource(code,{lineNumber:2,column:3}),before.definitionSource(code,{lineNumber:2,column:3}));
  }
  for(const [owner,file]of [['PlaygroundMsm5205API','msm5205_player.js'],['PlaygroundCddaAPI','cdda_player.js']]) {
    for(const symbol of ['load','play','stop','seek','pause','resume']) {
      const code=`interface ${owner} {\n  ${symbol}(): Promise<void>;\n}`;
      assert.deepEqual(definitionSource(code,{lineNumber:2,column:3}),{file,symbol});
      assert.deepEqual(definitionSource(code,{lineNumber:2,column:3},'huc6280',{runtimeFile:'playground_code_runtime.js'}),{file,symbol});
    }
  }
  const base='https://example.test/playground/playground_monaco_definitions.js';
  assert.equal(runtimeSourceUrl('msm5205_player.js',base).href,'https://example.test/js/msm5205_player.js');
  assert.equal(runtimeSourceUrl('synth-huc6280/cdrom2_audio.js',base).href,'https://example.test/synth-huc6280/cdrom2_audio.js');
  for(const invalid of ['../other.js','/other.js','other.js?run=1','https://evil.test/other.js','synth-huc6280/../other.js'])assert.throws(()=>runtimeSourceUrl(invalid,base),/Invalid implementation source path/);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {
  assertMixerCalibrationSourceFreshness,createMixerCalibrationUiReceipt,
  mixerCalibrationReceiptObjectSha256,mixerCalibrationUiCanonicalSha256,
} from './mixer_calibration_sources.mjs';
import {PS1_CALIBRATION_UI_RECEIPT_OBJECT_SHA256} from './ps1_mixer_calibration.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const js='playground/playground.js',html='playground/index.html';
const imports={
  [js]:"import {createPlaygroundSoundChipMixer,playgroundLegacyMixerTrims} from './playground_mixer_defaults.js?v=original-1';",
  [html]:"      import('./playground.js?v=original-1').catch(error => window.__playgroundStartup.fail(error));",
};
function fixture(){
  const sources=Object.fromEntries(Object.entries(imports).map(([path,text])=>[path,Buffer.from(text+'\n// exact surrounding bytes\n')]));
  const report={schemaVersion:1,passed:true,verify:false,sources:Object.fromEntries(Object.entries(sources).map(([path,bytes])=>[path,{bytes:bytes.length,sha256:sha(bytes)}]))};
  const reportBytes=Buffer.from(JSON.stringify(report,null,2)+'\n');
  const receipt=createMixerCalibrationUiReceipt({reportPath:'docs/issues/synthetic-test.json',reportBytes,sources});
  return {sources,report,reportBytes,receipt,reportSha256:sha(reportBytes),receiptObjectSha256:mixerCalibrationReceiptObjectSha256(receipt)};
}
function check(f,path,bytes,extra={}){
  return assertMixerCalibrationSourceFreshness({path,bytes,record:f.report.sources[path],report:f.report,
    reportSha256:f.reportSha256,receipt:f.receipt,receiptObjectSha256:f.receiptObjectSha256,...extra});
}

test('original raw bytes pass without any cache receipt, for UI and DSP sources',()=>{
  const f=fixture();
  for(const path of [js,html])assert.equal(assertMixerCalibrationSourceFreshness({path,bytes:f.sources[path],record:f.report.sources[path]}),'raw');
  const bytes=Buffer.from([0,97,115,109]);
  assert.equal(assertMixerCalibrationSourceFreshness({path:'generated/sound.wasm',bytes,record:{bytes:bytes.length,sha256:sha(bytes)}}),'raw');
});
test('each exact UI import permits a different-length version token without changing original evidence',()=>{
  const f=fixture(),before=JSON.stringify(f.receipt);
  for(const path of [js,html]){
    const bytes=Buffer.from(f.sources[path].toString().replace('original-1','future-calibration-234+test'));
    assert.equal(check(f,path,bytes),'ui-cache-token');
    assert.equal(mixerCalibrationUiCanonicalSha256(path,bytes),f.receipt.sources[path].canonicalSha256);
    assert.equal(f.receipt.sources[path].sha256,sha(f.sources[path]));
  }
  assert.equal(JSON.stringify(f.receipt),before,'receipt remains immutable evidence');
});
const codeMutations=[
  ['executable body',text=>text+'\nglobalThis.volume=2;\n'],
  ['surrounding comment byte',text=>text.replace('surrounding','surrounding-changed')],
  ['changed target module',text=>text.replace('.js?v=', '-other.js?v=')],
  ['additional query key',text=>text.replace('original-1','original-1&gain=2')],
  ['duplicate version key',text=>text.replace('original-1','original-1&v=next')],
  ['query fragment',text=>text.replace('original-1','original-1#next')],
  ['empty version',text=>text.replace('original-1','')],
  ['removed version query',text=>text.replace('?v=original-1','')],
  ['duplicate import',text=>text+text],
  ['second target mention',text=>text+'\n// '+text.match(/playground(?:_mixer_defaults)?\.js/)[0]+'\n'],
  ['unsupported quotation',text=>text.replaceAll("'",'"')],
];
for(const [name,mutate]of codeMutations)test('rejects '+name+' in both UI assets',()=>{
  const f=fixture();for(const path of [js,html])assert.throws(()=>check(f,path,Buffer.from(mutate(f.sources[path].toString()))),/source changed|source receipt/);
});
test('a UI receipt never permits another UI file, DSP, transport or WASM change',()=>{
  const f=fixture(),original=Buffer.from('original'),bytes=Buffer.from('changed');
  for(const path of ['playground/other.js','js/playground_runtime.js','js/chip_worklet_transport.js','generated/ps1_spu_wasm.wasm']){
    assert.throws(()=>check(f,path,bytes,{record:{bytes:original.length,sha256:sha(original)}}),/source changed/);
  }
});
test('cache aliases require the independently pinned receipt and original report identities',()=>{
  const f=fixture(),bytes=Buffer.from(f.sources[js].toString().replace('original-1','next-1'));
  assert.throws(()=>check(f,js,bytes,{receipt:undefined}),/source changed/);
  assert.throws(()=>check(f,js,bytes,{receiptObjectSha256:undefined}),/independently pinned SHA/);
  assert.throws(()=>check(f,js,bytes,{receiptObjectSha256:'0'.repeat(64)}),/independently pinned SHA/);
  assert.throws(()=>check(f,js,bytes,{reportSha256:'0'.repeat(64)}),/report identity/);
  assert.throws(()=>check(f,js,bytes,{report:{...f.report,extra:'edited'}}),/report identity/);
  assert.throws(()=>check(f,js,bytes,{record:{...f.report.sources[js],bytes:1}}),/detached from original receipt/);
  const forged=structuredClone(f.receipt);forged.sources[js].canonicalSha256=sha('forged code');
  assert.throws(()=>check(f,js,bytes,{receipt:forged}),/independently pinned SHA/);
});
test('even a trusted malformed receipt cannot widen scope or detach original assets',()=>{
  const f=fixture(),bytes=Buffer.from(f.sources[js].toString().replace('original-1','next-1'));
  const mutations=[r=>r.schemaVersion=2,r=>r.scope='all-ui',r=>delete r.sources[html],r=>r.sources['another.js']=r.sources[js],
    r=>r.sources[js].bytes++,r=>r.sources[js].sha256='0'.repeat(64),r=>r.sources[html].normalizer='generic-normalization'];
  for(const mutate of mutations){const receipt=structuredClone(f.receipt);mutate(receipt);
    assert.throws(()=>check(f,js,bytes,{receipt,receiptObjectSha256:mixerCalibrationReceiptObjectSha256(receipt)}),/identity or scope|original asset record/);
  }
});
test('receipt preparation rejects changed original bytes, including only a cache version change',()=>{
  const f=fixture();
  for(const path of [js,html]){
    const sources={...f.sources,[path]:Buffer.from(f.sources[path].toString().replace('original-1','next-1'))};
    assert.throws(()=>createMixerCalibrationUiReceipt({reportPath:'test.json',reportBytes:f.reportBytes,sources}),/original UI asset no longer matches/);
  }
  assert.throws(()=>createMixerCalibrationUiReceipt({reportPath:'test.json',reportBytes:Buffer.from(JSON.stringify({...f.report,verify:true})),sources:f.sources}),/successful original measurement/);
});
test('committed PS1 receipt links the untouched report and accepts the current UI cache tokens',async()=>{
  const reportBytes=await readFile(new URL('../docs/issues/ps1_chip_levels_01.json',import.meta.url));
  const report=JSON.parse(reportBytes),receipt=JSON.parse(await readFile(new URL('../docs/issues/ps1_chip_levels_ui_receipt_01.json',import.meta.url),'utf8'));
  assert.equal(mixerCalibrationReceiptObjectSha256(receipt),PS1_CALIBRATION_UI_RECEIPT_OBJECT_SHA256);
  assert.equal(receipt.report.path,'docs/issues/ps1_chip_levels_01.json');
  assert.equal(receipt.report.sha256,sha(reportBytes));assert.equal(receipt.report.objectSha256,sha(JSON.stringify(report)));
  for(const path of [js,html]){
    const bytes=await readFile(new URL('../docs/'+path,import.meta.url));
    assert(['raw','ui-cache-token'].includes(assertMixerCalibrationSourceFreshness({path,bytes,record:report.sources[path],report,
      reportSha256:sha(reportBytes),receipt,receiptObjectSha256:PS1_CALIBRATION_UI_RECEIPT_OBJECT_SHA256})));
  }
});

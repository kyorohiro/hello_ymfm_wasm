import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {
  assertMixerCalibrationSourceFreshness,createMixerCalibrationUiReceipt,
  assertMixerCalibrationPs1AdsrUiFreshness,
  mixerCalibrationReceiptObjectSha256,mixerCalibrationUiCanonicalSha256,
} from './mixer_calibration_sources.mjs';
import {PS1_CALIBRATION_UI_RECEIPT_OBJECT_SHA256} from './ps1_mixer_calibration.mjs';
import {WONDERSWAN_CALIBRATION_UI_RECEIPT_OBJECT_SHA256} from './wonderswan_mixer_calibration.mjs';
import {POKEY_CALIBRATION_UI_RECEIPT_OBJECT_SHA256} from './pokey_mixer_calibration.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const js='playground/playground.js',html='playground/index.html';
const imports={
  [js]:[
    "import {createPlaygroundSoundChipMixer,playgroundLegacyMixerTrims} from './playground_mixer_defaults.js?v=original-1';",
    "import {installPlaygroundWorkbench} from './playground_workbench.js?v=original-1';",
    "import {createPlaygroundChipTabs,createPlaygroundAdditionalChipTabAvailability} from './playground_chip_tabs.js?v=original-1';",
    'import { createPlaygroundUi, applyPlaygroundLayout } from "./playground_ui.js?v=original-1";',
  ].join('\n'),
  [html]:[
    "      import('./playground.js?v=original-1').catch(error => window.__playgroundStartup.fail(error));",
    '    <link rel="stylesheet" href="./playground_chip_tabs.css?v=original-1">',
  ].join('\n'),
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

const ps1AdsrUiPaths=[
  'playground/playground_chip_tabs.css','playground/playground_chip_tabs.js','playground/playground_ps1_voice_panel.js',
];
const ps1AdsrHelper='playground/playground_ps1_envelope.js';
function ps1AdsrFixture(){
  const before=Object.fromEntries(ps1AdsrUiPaths.map(path=>[path,Buffer.from('original '+path+'\n')]));
  const after=Object.fromEntries(ps1AdsrUiPaths.map(path=>[path,Buffer.from('reviewed draggable graph '+path+'\n')]));
  const relatedSources={[ps1AdsrHelper]:Buffer.from('export const reviewedEnvelopeHelper=true;\n')};
  const record=bytes=>({bytes:bytes.length,sha256:sha(bytes)});
  const report={schemaVersion:1,passed:true,verify:false,sources:Object.fromEntries(ps1AdsrUiPaths.map(path=>[path,record(before[path])]))};
  const reportBytes=Buffer.from(JSON.stringify(report,null,2)+'\n');
  const receipt={schemaVersion:1,scope:'ps1-adsr-graph-ui-revision',feature:'PS1 live draggable ADSR graph',
    reports:Object.fromEntries(['ps1','wonderswan','pokey'].map(kind=>['docs/issues/'+kind+'_chip_levels_01.json',
      {sha256:sha(reportBytes),objectSha256:sha(JSON.stringify(report))}])),
    sources:Object.fromEntries(ps1AdsrUiPaths.map(path=>[path,{before:record(before[path]),after:record(after[path])}])),
    relatedSources:{[ps1AdsrHelper]:record(relatedSources[ps1AdsrHelper])}};
  return {before,after,report,receipt,relatedSources,reportSha256:sha(reportBytes),receiptObjectSha256:mixerCalibrationReceiptObjectSha256(receipt)};
}
function checkPs1Adsr(f,path=ps1AdsrUiPaths[0],extra={}){
  return assertMixerCalibrationPs1AdsrUiFreshness({path,bytes:f.after[path],record:f.report.sources[path],report:f.report,
    reportSha256:f.reportSha256,receipt:f.receipt,receiptObjectSha256:f.receiptObjectSha256,relatedSources:f.relatedSources,...extra});
}
test('PS1 ADSR receipt accepts every exact reviewed UI revision and its exact helper',()=>{
  const f=ps1AdsrFixture(),evidence=JSON.stringify(f.receipt);
  for(const path of ps1AdsrUiPaths)assert.equal(checkPs1Adsr(f,path),'ps1-adsr-ui-revision');
  assert.equal(JSON.stringify(f.receipt),evidence,'reviewed evidence stays immutable');
});
test('PS1 ADSR receipt rejects any changed reviewed UI byte, including same-length edits',()=>{
  const f=ps1AdsrFixture();
  for(const path of ps1AdsrUiPaths){
    assert.throws(()=>checkPs1Adsr(f,path,{bytes:Buffer.from(f.after[path].toString().replace('reviewed','modified'))}),/revision changed/);
    assert.throws(()=>checkPs1Adsr(f,path,{bytes:Buffer.concat([f.after[path],Buffer.from('\n')])}),/revision changed/);
    assert.throws(()=>checkPs1Adsr(f,path,{bytes:f.before[path]}),/revision changed/);
  }
});
test('PS1 ADSR revision requires the independent pin and both report identities',()=>{
  const f=ps1AdsrFixture();
  for(const receiptObjectSha256 of [undefined,'0'.repeat(64)])assert.throws(()=>checkPs1Adsr(f,undefined,{receiptObjectSha256}),/independently pinned SHA/);
  assert.throws(()=>checkPs1Adsr(f,undefined,{reportSha256:'0'.repeat(64)}),/report identity/);
  assert.throws(()=>checkPs1Adsr(f,undefined,{report:{...f.report,extra:'modified'}}),/report identity/);
  const receipt=structuredClone(f.receipt);receipt.sources[ps1AdsrUiPaths[0]].after.sha256='0'.repeat(64);
  assert.throws(()=>checkPs1Adsr(f,undefined,{receipt}),/independently pinned SHA/);
});
test('even a pinned PS1 ADSR receipt cannot detach before records or widen its scope',()=>{
  const f=ps1AdsrFixture();
  const mutations=[
    r=>r.scope='all-ui',r=>r.feature='all draggable controls',r=>r.schemaVersion=2,
    r=>delete r.reports['docs/issues/pokey_chip_levels_01.json'],
    r=>r.reports['docs/issues/other_chip_levels_01.json']=r.reports['docs/issues/ps1_chip_levels_01.json'],
    r=>r.sources[ps1AdsrUiPaths[0]].before.bytes++,r=>r.sources[ps1AdsrUiPaths[1]].before.sha256='0'.repeat(64),
    r=>delete r.sources[ps1AdsrUiPaths[2]],r=>r.sources['playground/other.js']=r.sources[ps1AdsrUiPaths[0]],
    r=>delete r.relatedSources[ps1AdsrHelper],r=>r.relatedSources['playground/other_helper.js']=r.relatedSources[ps1AdsrHelper],
  ];
  for(const mutate of mutations){
    const receipt=structuredClone(f.receipt);mutate(receipt);
    assert.throws(()=>checkPs1Adsr(f,undefined,{receipt,receiptObjectSha256:mixerCalibrationReceiptObjectSha256(receipt)}),/scope mismatch|original asset record mismatch/);
  }
  assert.throws(()=>checkPs1Adsr(f,undefined,{record:{...f.report.sources[ps1AdsrUiPaths[0]],bytes:1}}),/detached from original receipt/);
});
test('PS1 ADSR revision receipt never authorizes an unlisted UI, DSP, transport or WASM path',()=>{
  const f=ps1AdsrFixture();
  for(const path of ['playground/other.js',ps1AdsrHelper,'js/playground_runtime.js','js/chip_worklet_transport.js','generated/ps1_spu_wasm.wasm']){
    assert.throws(()=>checkPs1Adsr(f,path,{bytes:Buffer.from('changed')}),/unsupported PS1 ADSR UI revision path/);
  }
});
test('PS1 ADSR revision requires the complete exact helper inventory and bytes',()=>{
  const f=ps1AdsrFixture();
  for(const relatedSources of [undefined,{}, {...f.relatedSources,'playground/other_helper.js':Buffer.from('extra')}]){
    assert.throws(()=>checkPs1Adsr(f,undefined,{relatedSources}),/related source inventory mismatch/);
  }
  assert.throws(()=>checkPs1Adsr(f,undefined,{relatedSources:{[ps1AdsrHelper]:Buffer.from(f.relatedSources[ps1AdsrHelper].toString().replace('true','null'))}}),/related source changed/);
});
test('all six exact UI imports permit different-length version tokens without changing original evidence',()=>{
  const f=fixture(),before=JSON.stringify(f.receipt);
  for(const path of [js,html]){
    const bytes=Buffer.from(f.sources[path].toString().replaceAll('original-1','future-calibration-234+test'));
    assert.equal(check(f,path,bytes),'ui-cache-token');
    assert.equal(mixerCalibrationUiCanonicalSha256(path,bytes),f.receipt.sources[path].canonicalSha256);
    assert.equal(f.receipt.sources[path].sha256,sha(f.sources[path]));
  }
  assert.equal(JSON.stringify(f.receipt),before,'receipt remains immutable evidence');
});
test('each token site is independently bounded by its exact resource path and surrounding code',()=>{
  const f=fixture();
  for(const path of [js,html])for(const line of imports[path].split('\n')){
    const original=f.sources[path].toString(),next=line.replace('original-1','ps1-envelope-drag-1');
    assert.equal(check(f,path,Buffer.from(original.replace(line,next))),'ui-cache-token');
    for(const changed of [
      line.replace('original-1','original-1&gain=2'),line.replace('original-1','original-1&v=next'),
      line.replace('original-1','original-1#fragment'),line.replace('original-1',''),line.replace('?v=original-1',''),
      line.replace('./playground','./other_playground'),line+'\n'+line,
      line.replace('import','import /* changed */'),line.replace('stylesheet','preload'),
    ])if(changed!==line)assert.throws(()=>check(f,path,Buffer.from(original.replace(line,changed))),/source changed|source receipt/);
  }
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
for(const [kind,receiptObjectSha256]of [
  ['ps1',PS1_CALIBRATION_UI_RECEIPT_OBJECT_SHA256],['wonderswan',WONDERSWAN_CALIBRATION_UI_RECEIPT_OBJECT_SHA256],['pokey',POKEY_CALIBRATION_UI_RECEIPT_OBJECT_SHA256],
])test('committed '+kind+' receipt links immutable history and rejects the revised UI and DSP bytes',async()=>{
  const reportBytes=await readFile(new URL('../docs/issues/'+kind+'_chip_levels_01.json',import.meta.url));
  const report=JSON.parse(reportBytes),receipt=JSON.parse(await readFile(new URL('../docs/issues/'+kind+'_chip_levels_ui_receipt_01.json',import.meta.url),'utf8'));
  assert.equal(mixerCalibrationReceiptObjectSha256(receipt),receiptObjectSha256);
  assert.equal(receipt.report.path,'docs/issues/'+kind+'_chip_levels_01.json');
  assert.equal(receipt.report.sha256,sha(reportBytes));assert.equal(receipt.report.objectSha256,sha(JSON.stringify(report)));
  for(const path of [js,html]){
    const bytes=await readFile(new URL('../docs/'+path,import.meta.url));
    const options={path,bytes,record:report.sources[path],report,reportSha256:sha(reportBytes),receipt,receiptObjectSha256};
    // Both shipped UI bodies now include feature changes. The old token-only
    // receipt must authorize neither; current reports cover their new hashes.
    assert.throws(()=>assertMixerCalibrationSourceFreshness(options),/served DSP\/WASM source changed/);
  }
  const dspPath='js/ps1synth.js',dspBytes=await readFile(new URL('../docs/'+dspPath,import.meta.url));
  assert.throws(()=>assertMixerCalibrationSourceFreshness({path:dspPath,bytes:dspBytes,record:report.sources[dspPath],report,
    reportSha256:sha(reportBytes),receipt,receiptObjectSha256}),/served DSP\/WASM source changed/,
  'a still-applicable UI cache receipt cannot authorize changed synthesis bytes');
});

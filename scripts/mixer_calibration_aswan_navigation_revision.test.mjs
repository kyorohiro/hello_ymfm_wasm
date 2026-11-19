import {historicalCalibrationModule} from '../test/helpers/historical_calibration_modules.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readHistoricalAyTimedFileSync as readFileSync} from '../test/helpers/historical_ay_timed_source_fixture.mjs';
const {ASWAN_NAVIGATION_REVISION_PATH:path,ASWAN_NAVIGATION_REVISION_RECEIPT_PATH:receiptPath,
  ASWAN_NAVIGATION_REVISION_RECEIPT_OBJECT_SHA256:pin,ASWAN_NAVIGATION_REVISION_INSERTIONS:insertions,
  ASWAN_NAVIGATION_PREDECESSOR_RECEIPT_PATH:predecessorPath,
  restoreMixerCalibrationAswanNavigationRevision:restore}=await historicalCalibrationModule('mixer_calibration_aswan_navigation_revision.mjs');
const {MEASURED_POLICY_REVISION_RECEIPT_PATH}=await historicalCalibrationModule('mixer_calibration_measured_policy_revision.mjs');
const {restoreMixerCalibrationScspNavigationRevision}=await historicalCalibrationModule('mixer_calibration_scsp_navigation_revision.mjs');
const {restoreMixerCalibrationFm2608NavigationRevision}=await historicalCalibrationModule('mixer_calibration_fm2608_navigation_revision.mjs');
const {assertMixerCalibrationSourceFreshness:fresh}=await historicalCalibrationModule('mixer_calibration_sources.mjs');
import {definitionSource,runtimeSourceUrl} from '../docs/playground/playground_monaco_definitions.js';

const read=name=>readFileSync(new URL('../'+name,import.meta.url));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const receipt=JSON.parse(read(receiptPath));

test('complete ASWAN source reconstructs its pinned SCSP predecessor and measured report chain',()=>{
  assert.equal(sha(JSON.stringify(receipt)),pin);
  assert.equal(read(receiptPath).toString(),JSON.stringify(receipt,null,2)+'\n');
  assert.deepEqual(receipt.before,JSON.parse(read(predecessorPath)).after);
  const current=read('docs/'+path),before=restore(path,current);
  assert.equal(before.length,receipt.before.bytes);
  assert.equal(sha(before),receipt.before.sha256);
  assert.equal(restore(path,before),before);
  assert.deepEqual(receipt.insertions.map(value=>value.removedText),insertions);
  assert.equal(current.length-before.length,335);
  assert.notDeepEqual(restoreMixerCalibrationScspNavigationRevision(path,current),before);
  assert.equal(fresh({path,bytes:current,record:receipt.before}),'ui-aswan-shared-client-source-navigation');
  const measured=restoreMixerCalibrationFm2608NavigationRevision(path,current);
  for(const name of Object.keys(receipt.reports)){
    const bytes=read(name),report=JSON.parse(bytes);
    assert.equal(bytes.length,receipt.reports[name].bytes);
    assert.equal(sha(bytes),receipt.reports[name].sha256);
    assert.equal(measured.length,report.sources[path].bytes);
    assert.equal(sha(measured),report.sources[path].sha256);
    assert.equal(fresh({path,bytes:current,record:report.sources[path],report}),'ui-fm2608-hardware-source-navigation');
  }
});

test('ASWAN host methods and WonderSwan hardware methods resolve to their authored source',async()=>{
  const predecessor=await import('data:text/javascript;base64,'+restore(path,read('docs/'+path)).toString('base64'));
  function target(owner,symbol){
    const text=`interface ${owner} {\n  ${symbol}():void;\n}`;
    return definitionSource(text,{lineNumber:2,column:3},'wonderswan');
  }
  for(const symbol of ['getState','noteOff','dispose'])
    assert.deepEqual(target('AswanCodeClient',symbol),{file:'synth-aswan/code_endpoint.js',symbol:'createAswanCodeClient'});
  for(const owner of ['PlaygroundWonderSwan','PlaygroundPrimaryWonderSwan','PlaygroundWonderSwanTimelineBuilder'])
    for(const symbol of ['setNoise','setSweep','setWaveform'])
      assert.deepEqual(target(owner,symbol),{file:'wonderswansynth.js',symbol});
  for(const [owner,symbol,chip]of [['ScspCodeClient','noteOn','scsp'],['NesCodeClient','noteOn','nes'],['Fm2608CodeClient','setCsm','ym2608'],['PlaygroundGameboy','setDuty','gameboy'],['PlaygroundPrimaryPs1','keyOn','ps1']]){
    const text=`interface ${owner} {\n  ${symbol}():void;\n}`,position={lineNumber:2,column:3};
    assert.deepEqual(definitionSource(text,position,chip),predecessor.definitionSource(text,position,chip));
  }
  assert.equal(runtimeSourceUrl('synth-aswan/code_endpoint.js','https://example.test/playground/playground_monaco_definitions.js').href,
    'https://example.test/synth-aswan/code_endpoint.js');
  assert.equal(runtimeSourceUrl('wonderswansynth.js','https://example.test/playground/playground_monaco_definitions.js').href,
    'https://example.test/js/wonderswansynth.js');
});

test('source mutations, unknown paths and detached hashes remain stale',()=>{
  const current=read('docs/'+path),changed=Buffer.from(current);
  changed[Math.floor(changed.length/2)]^=1;
  for(const bytes of [changed,Buffer.concat([current,Buffer.from('\n')]),Buffer.from("import './future-audio.js';\n"+current)]){
    assert.equal(restore(path,bytes),bytes);
    assert.throws(()=>fresh({path,bytes,record:receipt.before}),/remeasure/);
  }
  for(const other of ['docs/'+path,'__proto__','playground/other.js','js/wonderswansynth.js','generated/wonderswan_wasm.wasm']){
    assert.equal(restore(other,current),current);
    assert.throws(()=>fresh({path:other,bytes:current,record:receipt.before}));
  }
  for(const record of [undefined,{}, {...receipt.before,bytes:1},{...receipt.before,sha256:'0'.repeat(64)}])
    assert.throws(()=>fresh({path,bytes:current,record}));
});

test('edited receipt, predecessor and historical measurements cannot authorize current source',()=>{
  const current=read('docs/'+path);
  for(const target of [receiptPath,predecessorPath,MEASURED_POLICY_REVISION_RECEIPT_PATH])
    assert.throws(()=>restore(path,current,{readSource(url){
      const bytes=readFileSync(url);
      if(!url.pathname.endsWith('/'+target))return bytes;
      const edited=JSON.parse(bytes);
      edited.scope='changed';
      return Buffer.from(JSON.stringify(edited));
    }}),/receipt pin mismatch/);
  for(const target of Object.keys(receipt.reports))
    assert.throws(()=>restore(path,current,{readSource(url){
      const bytes=readFileSync(url);
      return url.pathname.endsWith('/'+target)?Buffer.concat([bytes,Buffer.from([0])]):bytes;
    }}),/original measurement changed/);
});

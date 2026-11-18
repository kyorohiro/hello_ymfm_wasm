import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {restoreMixerCalibrationScspSsfDspRevision as restore,
  createScspSsfDspRevisionReader,createScspSsfDspRevisionReadContext,
  SCSP_SSF_DSP_REVISION_BASE_COMMIT as base,
  SCSP_SSF_DSP_REVISION_RECEIPT_PATH as receiptPath,
  SCSP_SSF_DSP_REVISION_RECEIPT_OBJECT_SHA256 as receiptPin,
  SCSP_SSF_DSP_REVISION_SOURCE_PATHS as sources,
  SCSP_SSF_DSP_REVISION_ASSET_PATHS as assets,
  SCSP_SSF_DSP_REVISION_RELATED_PATHS as related,
  SCSP_SSF_DSP_REVISION_REPORT_PATHS as reports,
} from './mixer_calibration_scsp_ssf_dsp_revision.mjs';
import {createScspFmDepthRevisionReader} from './mixer_calibration_scsp_fm_depth_revision.mjs';
const url=name=>new URL('../'+name,import.meta.url),read=name=>readFileSync(url(name));
const sha=value=>createHash('sha256').update(value).digest('hex');
const receipt=JSON.parse(read(receiptPath));
const match=(bytes,expected)=>{assert.equal(bytes.length,expected.bytes);assert.equal(sha(bytes),expected.sha256);};

test('the read-only SSF DSP revision pins complete reviewed source and unchanged legacy audio evidence',()=>{
  assert.equal(receipt.baseCommit,base);assert.equal(sha(JSON.stringify(receipt)),receiptPin);
  assert.equal(read(receiptPath).toString(),JSON.stringify(receipt,null,2)+'\n');
  assert.deepEqual(Object.keys(receipt.sources),[...sources]);
  assert.deepEqual(Object.keys(receipt.relatedSources),[...related]);
  assert.deepEqual(Object.keys(receipt.reports),[...reports]);
  for(const name of sources){const current=read(name);match(current,receipt.sources[name].after);const previous=restore(name,current);match(previous,receipt.sources[name].before);assert.deepEqual(restore(name,previous),previous);}
  for(const name of [...related,...reports])match(read(name),receipt.relatedSources[name]??receipt.reports[name]);
  assert.deepEqual(Object.keys(receipt.assets),[...assets]);
  for(const name of assets){
    assert(!Object.hasOwn(receipt.sources,name),'Separate SSF binary/loader must not enter old-body restoration');
    assert.deepEqual(Object.keys(receipt.assets[name]),['before','after']);
    match(read(name),receipt.assets[name].after);
    assert.equal(restore(name,read(name)).equals(read(name)),true,'SSF assets are pinned, never reconstructed');
  }
});
test('the SSF DSP reader supplies the exact earlier Synth and composes with the prior per-operator-depth proof',()=>{
  const reader=createScspSsfDspRevisionReader();
  for(const name of sources)match(reader(url(name)),receipt.sources[name].before);
  const previous=JSON.parse(read('docs/issues/scsp_fm_depth_source_revision_01.json'));
  const earlier=createScspFmDepthRevisionReader();
  match(earlier(url('docs/synth-scsp/index.html')),previous.sources['docs/synth-scsp/index.html'].before);
  match(earlier(url('docs/synth-scsp/routing.js')),previous.sources['docs/synth-scsp/routing.js'].before);
});
test('unknown, old or future source bodies receive no reconstruction exemption',()=>{
  for(const name of sources){
    const current=read(name),edited=Buffer.concat([current,Buffer.from('\n')]);
    assert.equal(restore(name,edited),edited);
    if(name.startsWith('docs/synth-scsp/'))
      assert.deepEqual(restore('synth-scsp/'+name.split('/').at(-1),current),restore(name,current));
  }
  const bytes=read(sources[0]);
  for(const name of ['../'+sources[0],'docs/synth-scsp/not-reviewed.js','docs/generated/scsp_wasm.wasm'])assert.equal(restore(name,bytes),bytes);
});
test('every application, codec, owner, test and historical report dependency must match',()=>{
  const target=sources[0],current=read(target);
  for(const name of [...sources,...related,...reports])
    assert.throws(()=>restore(target,current,{readSource(location){const bytes=readFileSync(location);return location.href===url(name).href?Buffer.concat([bytes,Buffer.from('\n')]):bytes;}}),/pinned source\/report dependency changed/,name);
  assert.throws(()=>restore(target,current,{readSource(location){
    if(location.href!==url(receiptPath).href)return readFileSync(location);
    const forged=structuredClone(receipt);forged.sources[target].before.sha256='0'.repeat(64);return Buffer.from(JSON.stringify(forged));
  }}),/independently pinned receipt/);
});
test('owned proof reads are immutable while ordinary readers and later proofs revalidate',()=>{
  let modified=false;const counts=new Map(),dependency=related[0],target=sources[0];
  const source=location=>{counts.set(location.href,(counts.get(location.href)??0)+1);const bytes=readFileSync(location);return modified&&location.href===url(dependency).href?Buffer.concat([bytes,Buffer.from('\n')]):bytes;};
  const proof=createScspSsfDspRevisionReadContext(source);
  for(const name of sources){match(proof.restore(name,read(name)),receipt.sources[name].before);match(proof.readSource(url(name)),receipt.sources[name].before);}
  assert([...counts.values()].every(value=>value===1));
  const reader=createScspSsfDspRevisionReader(source);match(reader(url(target)),receipt.sources[target].before);modified=true;
  assert.throws(()=>reader(url(target)),/pinned source\/report dependency changed/);
  assert.throws(()=>createScspSsfDspRevisionReadContext(source).restore(target,read(target)),/pinned source\/report dependency changed/);
  match(proof.readSource(url(target)),receipt.sources[target].before);
});

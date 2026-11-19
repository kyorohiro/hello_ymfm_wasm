// Offline source fixtures preserve history without granting current approval.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readPreHucTimedInput as readFileSync} from '../test/helpers/historical_huc_timed_calibration_inputs.mjs';
import {createHash} from 'node:crypto';
import {createHistoricalYm2608SourceMixReader,readHistoricalYm2608SourceMixFile,
 YM2608_SOURCE_MIX_HISTORY_PATH as path,YM2608_SOURCE_MIX_HISTORY_PIN as pin} from '../test/helpers/historical_ym2608_source_mix_fixture.mjs';
const root=new URL('../',import.meta.url),url=name=>new URL(name,root),read=name=>readFileSync(url(name));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const receipt=JSON.parse(read(path));

test('the test-only history fixture pins twelve full predecessors and the complete exact unity PCM witness',async()=>{
 assert.equal(sha(JSON.stringify(receipt)),pin);assert.equal(Object.keys(receipt.sources).length,12);
 const history=createHistoricalYm2608SourceMixReader();
 for(const [name,entry]of Object.entries(receipt.sources)){
  const current=read(name),previous=history(url(name));
  assert.equal(current.length,entry.after.bytes,name);assert.equal(sha(current),entry.after.sha256,name);
  assert.equal(previous.length,entry.before.bytes,name);assert.equal(sha(previous),entry.before.sha256,name);
  assert.deepEqual(previous,Buffer.from(entry.beforeBase64,'base64'));
  assert.deepEqual(await readHistoricalYm2608SourceMixFile(url(name)),previous);
  assert.deepEqual(read(name),current,'Reading history must not modify a live source');
 }
 const proof=JSON.parse(read(receipt.proof.path));assert.equal(proof.cases.length,586);
 assert.equal(proof.totalOutputStereoFrames,7264744);assert.equal(proof.maximumDifference,0);assert.equal(proof.deviceOpened,false);
});
test('unknown paths and future edits are never normalized, and each proof authenticates the complete graph',()=>{
 const names=Object.keys(receipt.sources),target=names[0],other=names[1],bytes=read(target);
 const changed=Buffer.concat([bytes,Buffer.from('\n')]);
 const future=createHistoricalYm2608SourceMixReader(location=>location.href===url(target).href?changed:readFileSync(location));
 assert.equal(future(url(target)),changed);
 const unrelated=createHistoricalYm2608SourceMixReader();
 assert.deepEqual(unrelated(url('docs/js/soundchip_mixer.js')),read('docs/js/soundchip_mixer.js'));
 for(const name of [other,path,receipt.proof.path]){
  const modified=createHistoricalYm2608SourceMixReader(location=>location.href===url(name).href?
   name===path?Buffer.from(JSON.stringify({...receipt,scope:'future'})):
    Buffer.concat([readFileSync(location),Buffer.from('\n')]):readFileSync(location));
  assert.throws(()=>modified(url(target)),/changed|JSON/,name);
 }
});

// SPDX-License-Identifier: BSD-3-Clause
// Historical test inputs only. No AudioContext, renderer or device is opened.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createHistoricalFm2612ApplicationReader,FM2612_APPLICATION_HISTORY_PATH as path,
  FM2612_APPLICATION_HISTORY_PIN as pin} from '../test/helpers/historical_fm2612_application_source_fixture.mjs';
import {createScspOutputLevelNewCassetteRevisionReadContext} from './mixer_calibration_scsp_output_level_new_cassette_revision.mjs';
import {assertMixerCalibrationSourceFreshness} from './mixer_calibration_sources.mjs';
const url=name=>new URL('../'+name,import.meta.url),read=name=>readFileSync(url(name));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const fixture=JSON.parse(read(path)),names=Object.keys(fixture.sources);
const matches=(bytes,expected)=>{assert.equal(bytes.length,expected.bytes);assert.equal(sha(bytes),expected.sha256);};

test('test-only FM dependencies restore complete actual-Git predecessors, linked to unchanged historical receipts',()=>{
  assert.equal(sha(JSON.stringify(fixture)),pin);assert.equal(names.length,5);
  const history=createHistoricalFm2612ApplicationReader();
  for(const name of names){
    const entry=fixture.sources[name],current=read(name),previous=history(url(name));
    matches(current,entry.after);matches(previous,entry.before);
    assert.deepEqual(previous,execFileSync('git',['show',(entry.beforeCommit??fixture.baseCommit)+':'+name],{maxBuffer:4*1024*1024}),name);
    assert.deepEqual(read(name),current,'reading history never edits the current file');
  }
  for(const [name,identity]of Object.entries(fixture.historicalReceipts))matches(read(name),identity);
  const original=createScspOutputLevelNewCassetteRevisionReadContext(history);
  const receipt=JSON.parse(read('docs/issues/scsp_output_level_new_cassette_source_revision_01.json'));
  for(const [name,entry]of Object.entries(receipt.sources))matches(original.readSource(url(name)),entry.before);
});

test('unknown paths, changed current bodies and already historical bodies are never normalized',()=>{
  const history=createHistoricalFm2612ApplicationReader(),other='docs/synth/synth_live_highlight.js';
  assert.deepEqual(history(url(other)),read(other));
  for(const name of names){
    const current=read(name),changed=Buffer.from(current);changed[Math.floor(changed.length/2)]^=1;
    for(const bytes of [changed,Buffer.concat([current,Buffer.from('\n')]),history(url(name))]){
      const future=createHistoricalFm2612ApplicationReader(location=>location.href===url(name).href?bytes:readFileSync(location));
      assert.deepEqual(future(url(name)),bytes,name);
    }
  }
});

test('changed companions, fixture and receipt identities cannot authorize a partial predecessor graph',()=>{
  const target=names[0];
  for(const name of [...names.slice(1),path,...Object.keys(fixture.historicalReceipts)]){
    const bad=createHistoricalFm2612ApplicationReader(location=>{
      const bytes=readFileSync(location);if(location.href!==url(name).href)return bytes;
      if(name===path){const forged=structuredClone(fixture);forged.sources[target].before.sha256='0'.repeat(64);return Buffer.from(JSON.stringify(forged));}
      return Buffer.concat([bytes,Buffer.from('\n')]);
    });
    assert.throws(()=>bad(url(target)),/changed|mismatch/,name);
  }
});

test('owned snapshots read each dependency once and caller buffers cannot mutate cached history',()=>{
  const counts=new Map();let changed=false;
  const history=createHistoricalFm2612ApplicationReader(location=>{
    counts.set(location.href,(counts.get(location.href)??0)+1);
    const bytes=readFileSync(location);return changed?Buffer.concat([bytes,Buffer.from('\n')]):bytes;
  });
  const previous=history(url(names[0])),expected=Buffer.from(previous);previous.fill(0);changed=true;
  assert.deepEqual(history(url(names[0])),expected);assert([...counts.values()].every(count=>count===1));
  const fresh=createHistoricalFm2612ApplicationReader(location=>Buffer.concat([readFileSync(location),Buffer.from('\n')]));
  assert.deepEqual(fresh(url(names[0])),Buffer.concat([read(names[0]),Buffer.from('\n')]));
});

test('test history grants no production freshness approval to the newer FM application',()=>{
  const target='docs/synth/synth.js',current=read(target);
  assert.throws(()=>assertMixerCalibrationSourceFreshness({path:'synth/synth.js',bytes:current,record:fixture.sources[target].before}),/remeasure|dependency changed/);
  // Isolate the application mismatch from the test files whose reader wiring
  // also changed here: only their archived bodies enter this test seam.
  const history=createHistoricalFm2612ApplicationReader();
  const testsOnly=location=>names.slice(3).some(name=>location.href===url(name).href)?history(location):readFileSync(location);
  assert.throws(()=>createScspOutputLevelNewCassetteRevisionReadContext(testsOnly).readSource(url('docs/synth-scsp/audio.js')),/pinned source\/report dependency changed: docs\/synth\/synth\.js/);
});

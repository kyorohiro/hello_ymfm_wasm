// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {assembleScspDsp} from './dsp_assembler.js';
import {delayProgram} from './dsp.js';
import {createScspDspDelayListing} from './dsp_program_view.js';

test('the read-only listing and exported source describe the unchanged built-in Delay image',()=>{
  const legacy=delayProgram(),listing=createScspDspDelayListing();
  assert.equal(listing.stepCount,6);
  assert.equal(listing.imageSteps,128);
  assert.equal(listing.filename,'tetorica-scsp-delay.scspasm');
  assert.deepEqual(listing.rows.map(row=>row.step),[0,1,2,3,4,5]);
  assert.deepEqual(assembleScspDsp(listing.source),legacy,
    'copy and download source must recover all 512 words, including zero-filled positions');
  assert.match(listing.source,/Synth|built.in/i,'the fixed Synth source must be identifiable outside this UI');
  for(const row of listing.rows){
    assert.equal(typeof row.instruction,'string');
    assert.equal(typeof row.title,'string');assert(row.title.length>0);
    assert.equal(typeof row.detail,'string');assert(row.detail.length>0);
    const rowWords=assembleScspDsp(`${row.step}: ${row.instruction}`);
    assert.deepEqual(rowWords.slice(row.step*4,row.step*4+4),legacy.slice(row.step*4,row.step*4+4));
    assert(listing.source.includes(row.title),'exported comments retain the readable step role');
  }
  assert(legacy.slice(24).every(word=>word===0),'the remaining image slots are still zero');
});

test('the six explanations follow the Delay pipeline rather than a serial pseudo-instruction story',()=>{
  const listing=createScspDspDelayListing(),text=row=>`${row.title} ${row.detail}`,
    words=assembleScspDsp(listing.source);
  // Independently check the controls that make these role labels true. If the
  // fixed program changes while retaining six steps, stale prose must fail.
  assert.equal(words[0*4+2]&2,2,'the first computation has a zero B input');
  assert.equal(words[1*4+2]&0x2000,0x2000,'the odd read step requests MRD');
  assert.equal(words[2*4+1]&0x20,0x20,'the following step latches IWT');
  assert.equal(words[3*4+2]&0x1000,0x1000,'the output step selects EWT');
  assert.equal((words[3*4+3]>>9)&63,1,'the parallel feedback product selects COEF1');
  assert.equal((words[4*4+1]>>6)&63,0x20,'incoming audio is selected from MIXS0');
  assert.equal(words[4*4+2]&3,1,'BSEL keeps the previous feedback accumulator');
  assert.equal(words[5*4+2]&0x4000,0x4000,'the final odd step requests MWT');
  assert.match(text(listing.rows[0]),/accumul|prepare/i);
  assert.match(text(listing.rows[1]),/read/i);
  assert.match(text(listing.rows[2]),/latch/i);
  assert.match(text(listing.rows[3]),/output|emit/i);
  assert.match(text(listing.rows[3]),/feedback/i);
  assert.match(text(listing.rows[4]),/input|incoming|MIXS/i);
  assert.match(text(listing.rows[5]),/write/i);
  assert.match(listing.rows.map(text).join('\n'),/previous|preceding/i,
    'at least one role makes the retained accumulator/read latency visible');
});

test('callers cannot change later listings or the underlying Delay through a returned model',()=>{
  const first=createScspDspDelayListing(),before=structuredClone(first),words=delayProgram();
  for(const mutation of [()=>{first.source='000: EWT=0';},()=>{first.rows[0].instruction='EWT=0';},
    ()=>{first.rows.push({step:6,instruction:'',title:'extra',detail:'extra'});}]){
    try{mutation();}catch(error){assert(error instanceof TypeError);}
  }
  assert.deepEqual(createScspDspDelayListing(),before);
  assert.deepEqual(delayProgram(),words);
});

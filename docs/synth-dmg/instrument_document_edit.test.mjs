import test from 'node:test';
import assert from 'node:assert/strict';
import {createDefaultPreset} from './preset.js';
import {applyGameboyDocumentChanges} from './instrument_document_edit.js';

test('accepting one document field preserves unrelated physical-channel edits',()=>{
  const previous=createDefaultPreset(),current=structuredClone(previous),next=structuredClone(previous);
  current.pulse.volume=4;current.noise.width=7;current.pan.left=false;
  next.pulse.duty=.25;
  const result=applyGameboyDocumentChanges(current,previous,next);
  assert.equal(result.pulse.duty,.25);assert.equal(result.pulse.volume,4);
  assert.equal(result.noise.width,7);assert.equal(result.pan.left,false);
  assert.equal(current.pulse.duty,previous.pulse.duty);
});
test('Wave bytes and nested Envelope edits apply without sharing their arrays',()=>{
  const previous=createDefaultPreset(),next=structuredClone(previous),current=structuredClone(previous);
  next.wave.samples[0]=15;next.pulse.envelope.period=3;next.source='wave';
  current.pulse.envelope.direction='up';
  const result=applyGameboyDocumentChanges(current,previous,next);
  assert.equal(result.wave.samples[0],15);assert.equal(result.pulse.envelope.period,3);
  assert.equal(result.pulse.envelope.direction,'up');assert.equal(result.source,'wave');
  result.wave.samples[0]=0;assert.equal(next.wave.samples[0],15);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectSample,playableSamples} from './sample-view.js';

test('sample preview includes both nibble endpoints and follows the OKI decoder',()=>{
  const rom = Uint8Array.of(0,0,8,0,0,9,0,0,0x17,0x17);
  assert.deepEqual(playableSamples(rom),[0]);
  const preview = inspectSample(rom,0,2);
  assert.match(preview.message,/ROM start 0x00008 · end 0x00009 .*2 bytes/);
  assert.deepEqual([...preview.min],[6/2048,48/2048]);
  assert.deepEqual([...preview.max],[36/2048,104/2048]);
  assert.match(inspectSample(rom,1).message,/No sample table/);
  rom[5]=11;
  assert.deepEqual(playableSamples(rom),[]);
  assert.match(inspectSample(rom,0).message,/beyond loaded ROM/);
  rom[5]=0;
  assert.match(inspectSample(rom,0).message,/reversed range/);
});

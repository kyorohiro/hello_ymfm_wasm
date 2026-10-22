import test from 'node:test';
import assert from 'node:assert/strict';
import {createNativeGenesisMsxAudio} from './native_genesis_msx_audio.js';

test('Native MSX Audio constructs precisely three passive clients with existing public globals',()=>{
  const commands=[],synth={clock:{sampleRate:48000},enqueue:c=>commands.push(c),isReady:()=>false};
  const endpoints=createNativeGenesisMsxAudio(synth);
  assert.deepEqual(Object.keys(endpoints),['y8950','ym2413','ay8910']);assert.deepEqual(Object.values(endpoints).map(e=>e.client.id),['y8950','ym2413','ay8910']);
  assert.deepEqual(Object.values(endpoints).map(e=>e.client.clock),[3579545,3579545,1789773]);assert.equal(commands.length,0);
  assert.equal(endpoints.y8950.client.channels,9);assert.equal(typeof endpoints.y8950.client.loadMemory,'undefined');assert.equal(typeof endpoints.y8950.client.loadSample,'undefined');
  for(const endpoint of Object.values(endpoints))assert.throws(()=>{endpoint.client.clock=4000000;},TypeError);
});

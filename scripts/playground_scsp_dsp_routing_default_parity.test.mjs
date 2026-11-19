import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {historicalCalibrationModule} from '../test/helpers/historical_calibration_modules.mjs';
const {measureScspDspRoutingDefaultParity,reconstructScspDspRoutingParityPredecessor,
  SCSP_DSP_ROUTING_PARITY_BASE_COMMIT,SCSP_DSP_ROUTING_PARITY_RECEIPT,SCSP_DSP_ROUTING_PARITY_REPORT}=await historicalCalibrationModule('record_playground_scsp_dsp_routing_default_parity.mjs');

const root=new URL('../',import.meta.url);
test('real SCSP default local/Main/Worker audio and legacy Worker packets match the exact npm 0.2.44 sources',async()=>{
  const actual=await measureScspDspRoutingDefaultParity();
  assert.equal(actual.deviceOpened,false);assert.equal(actual.baseCommit,SCSP_DSP_ROUTING_PARITY_BASE_COMMIT);
  assert.equal(actual.cases.length,36);assert.equal(actual.transportCases.length,15);
  for(const value of actual.cases)assert(value.exactPcmEqual&&value.exactEffectiveWriteTraceEqual&&value.exactRamEqual&&value.legacyStateEqual);
  for(const value of actual.transportCases)assert(value.exactPacketsEqual);
  assert.deepEqual(actual,JSON.parse(await readFile(new URL(SCSP_DSP_ROUTING_PARITY_REPORT,root),'utf8')));
});
test('two-bus routing predecessor reconstruction refuses edits and forged predecessor bytes without requiring git',async()=>{
  const receipt=JSON.parse(await readFile(new URL(SCSP_DSP_ROUTING_PARITY_RECEIPT,root),'utf8'));
  const name='tetorica_src/runtime/scspsynth.js',current=await readFile(new URL(name,root));
  assert(reconstructScspDspRoutingParityPredecessor(name,current,receipt).includes('class ScspSynth'));
  assert.throws(()=>reconstructScspDspRoutingParityPredecessor(name,Buffer.concat([current,Buffer.from('\n')]),receipt));
  const forged=structuredClone(receipt);
  forged.sources[name].reverseHunks[0].beforeText+='// not the reviewed source\n';
  assert.throws(()=>reconstructScspDspRoutingParityPredecessor(name,current,forged));
  assert.throws(()=>reconstructScspDspRoutingParityPredecessor('docs/js/scspsynth.js',current,receipt),/independently pinned/);
});

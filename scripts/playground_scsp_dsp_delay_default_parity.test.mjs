import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {measureScspDspDelayDefaultParity,reconstructScspDspDelayParityPredecessor,
  SCSP_DSP_DELAY_PARITY_BASE_COMMIT,SCSP_DSP_DELAY_PARITY_RECEIPT,SCSP_DSP_DELAY_PARITY_REPORT} from './record_playground_scsp_dsp_delay_default_parity.mjs';

const root=new URL('../',import.meta.url);
test('real SCSP default local/Main/Worker audio and legacy Worker packets match the exact npm 0.2.43 sources',async()=>{
  const actual=await measureScspDspDelayDefaultParity();
  assert.equal(actual.deviceOpened,false);assert.equal(actual.baseCommit,SCSP_DSP_DELAY_PARITY_BASE_COMMIT);
  assert.equal(actual.cases.length,36);assert.equal(actual.transportCases.length,15);
  for(const value of actual.cases)assert(value.exactPcmEqual&&value.exactEffectiveWriteTraceEqual&&value.exactRamEqual&&value.legacyStateEqual);
  for(const value of actual.transportCases)assert(value.exactPacketsEqual);
  assert.deepEqual(actual,JSON.parse(await readFile(new URL(SCSP_DSP_DELAY_PARITY_REPORT,root),'utf8')));
});
test('managed Delay predecessor reconstruction refuses edits and forged predecessor bytes without requiring git',async()=>{
  const receipt=JSON.parse(await readFile(new URL(SCSP_DSP_DELAY_PARITY_RECEIPT,root),'utf8'));
  const name='tetorica_src/runtime/scspsynth.js',current=await readFile(new URL(name,root));
  assert(reconstructScspDspDelayParityPredecessor(name,current,receipt).includes('class ScspSynth'));
  assert.throws(()=>reconstructScspDspDelayParityPredecessor(name,Buffer.concat([current,Buffer.from('\n')]),receipt));
  const forged=structuredClone(receipt);
  forged.sources[name].reverseHunks[0].beforeText+='// not the reviewed source\n';
  assert.throws(()=>reconstructScspDspDelayParityPredecessor(name,current,forged));
  assert.throws(()=>reconstructScspDspDelayParityPredecessor('docs/js/scspsynth.js',current,receipt),/independently pinned/);
});

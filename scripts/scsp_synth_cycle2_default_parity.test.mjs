import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createScspCycle2PresetsRevisionReadContext} from './mixer_calibration_scsp_cycle2_presets_revision.mjs';
import {measureScspSynthCycle2DefaultParity,reconstructScspSynthCycle2ParityPredecessor,
  SCSP_SYNTH_CYCLE2_PARITY_BASE_COMMIT as base,SCSP_SYNTH_CYCLE2_PARITY_RECEIPT as receiptPath,
  SCSP_SYNTH_CYCLE2_PARITY_REPORT as reportPath} from './record_scsp_synth_cycle2_default_parity.mjs';
const url=name=>new URL('../'+name,import.meta.url);
test('real prior default/DAG/Self/multiple-Self PCM and complete state match the exact pre-Cycle2 owner at both output rates',async()=>{
  const report=await measureScspSynthCycle2DefaultParity();
  assert.equal(report.baseCommit,base);assert.equal(report.deviceOpened,false);assert.equal(report.cases.length,166);
  const counts={pcm:24,fm:18,custom2:24,self2:32,'custom-multi':12,'single-self-multi':40,'multiple-self-multi':16};
  for(const [kind,count]of Object.entries(counts))assert.equal(report.cases.filter(row=>row.kind===kind).length,count,kind);
  for(const row of report.cases)assert(row.exactPcmEqual&&row.exactRamEqual&&row.legacyStateEqual&&row.exactRegistersEqual&&row.exactEffectiveWriteTraceEqual&&row.exactPresetEqual&&row.exactRegisterSnapshotsEqual&&row.exactRawStackEqual&&row.exactStateSnapshotsEqual);
  assert.deepEqual(report,JSON.parse(await readFile(url(reportPath),'utf8')));
});
test('independently pinned pre-Cycle2 reconstruction rejects future or forged bodies and unreviewed paths',async()=>{
  const receipt=JSON.parse(await readFile(url(receiptPath),'utf8')),name='docs/synth-scsp/instrument.js',current=createScspCycle2PresetsRevisionReadContext().readSource(url(name));
  assert(reconstructScspSynthCycle2ParityPredecessor(name,current,receipt).includes('class SynthInstrument'));
  assert.throws(()=>reconstructScspSynthCycle2ParityPredecessor(name,Buffer.concat([current,Buffer.from('\n')]),receipt));
  const forged=structuredClone(receipt);forged.sources[name].reverseHunks[0].beforeText+='// forged predecessor\n';
  assert.throws(()=>reconstructScspSynthCycle2ParityPredecessor(name,current,forged));
  assert.throws(()=>reconstructScspSynthCycle2ParityPredecessor('docs/js/scspsynth.js',current,receipt),/independently pinned/);
});

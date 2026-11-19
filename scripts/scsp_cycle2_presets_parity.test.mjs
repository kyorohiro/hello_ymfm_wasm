import {historicalCalibrationModule} from '../test/helpers/historical_calibration_modules.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const {measureScspCycle2PresetsParity,reconstructScspCycle2PresetsParityPredecessor,
  SCSP_CYCLE2_PRESETS_PARITY_BASE_COMMIT:base,SCSP_CYCLE2_PRESETS_PARITY_RECEIPT:receiptPath,
  SCSP_CYCLE2_PRESETS_PARITY_REPORT:reportPath}=await historicalCalibrationModule('record_scsp_cycle2_presets_parity.mjs');
const url=name=>new URL('../'+name,import.meta.url);
test('real prior default/DAG/Self/multiple-Self/Cycle PCM and complete state match the exact pre-v11 owner at both output rates',async()=>{
  const report=await measureScspCycle2PresetsParity();
  assert.equal(report.baseCommit,base);assert.equal(report.deviceOpened,false);assert.equal(report.cases.length,206);
  const counts={pcm:24,fm:18,custom2:24,self2:32,'custom-multi':12,'single-self-multi':40,'multiple-self-multi':16,cycle2:40};
  for(const [kind,count]of Object.entries(counts))assert.equal(report.cases.filter(row=>row.kind===kind).length,count,kind);
  for(const row of report.cases)assert(row.exactPcmEqual&&row.exactRamEqual&&row.legacyStateEqual&&row.exactRegistersEqual&&row.exactEffectiveWriteTraceEqual&&(row.kind==='cycle2'?row.cyclePresetVersion===11&&row.portableExportDidNotWrite:row.exactPresetEqual)&&row.exactRegisterSnapshotsEqual&&row.exactRawStackEqual&&row.exactStateSnapshotsEqual);
  assert.deepEqual(report,JSON.parse(await readFile(url(reportPath),'utf8')));
});
test('independently pinned pre-v11 reconstruction rejects future or forged bodies and unreviewed paths',async()=>{
  const receipt=JSON.parse(await readFile(url(receiptPath),'utf8')),name='docs/synth-scsp/instrument.js',current=await readFile(url(name));
  assert(reconstructScspCycle2PresetsParityPredecessor(name,current,receipt).includes('class SynthInstrument'));
  assert.throws(()=>reconstructScspCycle2PresetsParityPredecessor(name,Buffer.concat([current,Buffer.from('\n')]),receipt));
  const forged=structuredClone(receipt);forged.sources[name].reverseHunks[0].beforeText+='// forged predecessor\n';
  assert.throws(()=>reconstructScspCycle2PresetsParityPredecessor(name,current,forged));
  assert.throws(()=>reconstructScspCycle2PresetsParityPredecessor('docs/js/scspsynth.js',current,receipt),/independently pinned/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {measureScspFmMultipleSelfDefaultParity,reconstructScspFmMultipleSelfParityPredecessor,
  SCSP_FM_MULTIPLE_SELF_PARITY_BASE_COMMIT as base,SCSP_FM_MULTIPLE_SELF_PARITY_RECEIPT as receiptPath,
  SCSP_FM_MULTIPLE_SELF_PARITY_REPORT as reportPath} from './record_scsp_fm_multiple_self_default_parity.mjs';
const url=name=>new URL('../'+name,import.meta.url);
test('real Synth default PCM, ring and registers match the exact pre-multiple-self owner at 44.1/48 kHz',async()=>{
  const report=await measureScspFmMultipleSelfDefaultParity();
  assert.equal(report.baseCommit,base);assert.equal(report.deviceOpened,false);assert.equal(report.cases.length,150);
  for(const value of report.cases)assert(value.exactPcmEqual&&value.exactRamEqual&&value.legacyStateEqual&&value.exactRegistersEqual&&value.exactEffectiveWriteTraceEqual&&value.exactPresetEqual);
  assert.equal(report.cases.filter(value=>value.kind==='custom2').length,24);
  assert.equal(report.cases.filter(value=>value.kind==='self2').length,32);
  assert.equal(report.cases.filter(value=>value.kind==='custom-multi').length,12);
  assert.equal(report.cases.filter(value=>value.kind==='single-self-multi').length,40);
  for(const value of report.cases)assert(value.exactRegisterSnapshotsEqual&&value.exactRawStackEqual&&value.exactStateSnapshotsEqual);
  assert.deepEqual(report,JSON.parse(await readFile(url(reportPath),'utf8')));
});
test('Synth predecessor reconstruction rejects source edits, forged old bodies and other paths',async()=>{
  const receipt=JSON.parse(await readFile(url(receiptPath),'utf8'));
  const name='docs/synth-scsp/instrument.js',current=await readFile(url(name));
  assert(reconstructScspFmMultipleSelfParityPredecessor(name,current,receipt).includes('class SynthInstrument'));
  assert.throws(()=>reconstructScspFmMultipleSelfParityPredecessor(name,Buffer.concat([current,Buffer.from('\n')]),receipt));
  const forged=structuredClone(receipt);forged.sources[name].reverseHunks[0].beforeText+='// forged predecessor\n';
  assert.throws(()=>reconstructScspFmMultipleSelfParityPredecessor(name,current,forged));
  assert.throws(()=>reconstructScspFmMultipleSelfParityPredecessor('docs/js/scspsynth.js',current,receipt),/independently pinned/);
});

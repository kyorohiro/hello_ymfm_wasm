import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {measureScspFmMultiDefaultParity,reconstructScspFmMultiParityPredecessor,
  SCSP_FM_MULTI_PARITY_BASE_COMMIT as base,SCSP_FM_MULTI_PARITY_RECEIPT as receiptPath,
  SCSP_FM_MULTI_PARITY_REPORT as reportPath} from './record_scsp_fm_multi_default_parity.mjs';
const url=name=>new URL('../'+name,import.meta.url);
test('real Synth default PCM, ring and registers match the exact pre-multi owner at 44.1/48 kHz',async()=>{
  const report=await measureScspFmMultiDefaultParity();
  assert.equal(report.baseCommit,base);assert.equal(report.deviceOpened,false);assert.equal(report.cases.length,66);
  for(const value of report.cases)assert(value.exactPcmEqual&&value.exactRamEqual&&value.legacyStateEqual&&value.exactRegistersEqual&&value.exactEffectiveWriteTraceEqual&&value.exactPresetEqual);
  assert.equal(report.cases.filter(value=>value.kind==='custom2').length,24);
  assert.deepEqual(report,JSON.parse(await readFile(url(reportPath),'utf8')));
});
test('Synth predecessor reconstruction rejects source edits, forged old bodies and other paths',async()=>{
  const receipt=JSON.parse(await readFile(url(receiptPath),'utf8'));
  const name='docs/synth-scsp/instrument.js',current=await readFile(url(name));
  assert(reconstructScspFmMultiParityPredecessor(name,current,receipt).includes('class SynthInstrument'));
  assert.throws(()=>reconstructScspFmMultiParityPredecessor(name,Buffer.concat([current,Buffer.from('\n')]),receipt));
  const forged=structuredClone(receipt);forged.sources[name].reverseHunks[0].beforeText+='// forged predecessor\n';
  assert.throws(()=>reconstructScspFmMultiParityPredecessor(name,current,forged));
  assert.throws(()=>reconstructScspFmMultiParityPredecessor('docs/js/scspsynth.js',current,receipt),/independently pinned/);
});

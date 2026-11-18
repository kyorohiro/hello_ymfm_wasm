import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {measureScspFmCustom2DefaultParity,reconstructScspFmCustom2ParityPredecessor,
  SCSP_FM_CUSTOM2_PARITY_BASE_COMMIT as base,SCSP_FM_CUSTOM2_PARITY_RECEIPT as receiptPath,
  SCSP_FM_CUSTOM2_PARITY_REPORT as reportPath} from './record_scsp_fm_custom2_default_parity.mjs';
const url=name=>new URL('../'+name,import.meta.url);
test('real Synth default PCM, ring and registers match the exact pre-custom owner at 44.1/48 kHz',async()=>{
  const report=await measureScspFmCustom2DefaultParity();
  assert.equal(report.baseCommit,base);assert.equal(report.deviceOpened,false);assert.equal(report.cases.length,42);
  for(const value of report.cases)assert(value.exactPcmEqual&&value.exactRamEqual&&value.legacyStateEqual&&value.exactRegistersEqual&&value.exactEffectiveWriteTraceEqual&&value.exactPresetEqual);
  assert.deepEqual(report,JSON.parse(await readFile(url(reportPath),'utf8')));
});
test('Synth predecessor reconstruction rejects source edits, forged old bodies and other paths',async()=>{
  const receipt=JSON.parse(await readFile(url(receiptPath),'utf8'));
  const name='docs/synth-scsp/instrument.js',current=await readFile(url(name));
  assert(reconstructScspFmCustom2ParityPredecessor(name,current,receipt).includes('class SynthInstrument'));
  assert.throws(()=>reconstructScspFmCustom2ParityPredecessor(name,Buffer.concat([current,Buffer.from('\n')]),receipt));
  const forged=structuredClone(receipt);forged.sources[name].reverseHunks[0].beforeText+='// forged predecessor\n';
  assert.throws(()=>reconstructScspFmCustom2ParityPredecessor(name,current,forged));
  assert.throws(()=>reconstructScspFmCustom2ParityPredecessor('docs/js/scspsynth.js',current,receipt),/independently pinned/);
});

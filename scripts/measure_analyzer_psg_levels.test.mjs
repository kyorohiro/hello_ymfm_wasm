import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {measureAnalyzerPsgLevelReference} from './measure_analyzer_psg_levels.mjs';

test('source-unit unity PCM is the raw PSG reference, without dividing by the former Genesis balance',async()=>{
  const historical=JSON.parse(await readFile(new URL('../docs/issues/analyzer_psg_levels_01.json',import.meta.url),'utf8'));
  for(const id of ['psg','ay8910','nesApu']) {
    const actual=await measureAnalyzerPsgLevelReference(id,440);
    const before=historical.rows.find(row=>row.id===id&&row.frequencyHz===440&&row.canonical);
    assert.equal(actual.gainUnits,'source');
    assert.equal(actual.downstreamTrim,1);
    assert.equal(actual.rawAcRms,actual.unity.acRms);
    assert.equal(actual.amplitude,actual.unity.amplitude);
    assert(Math.abs(actual.rawAcRms/before.rawAcRms-1)<1e-6,id+' standalone output scale is retained');
    assert.equal(actual.referenceSha256,before.referenceSha256,id+' original register program is retained');
  }
});

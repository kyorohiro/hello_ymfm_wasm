import test from 'node:test';
import assert from 'node:assert/strict';
import {buildAnalyzerPsgDefaults} from './generate_analyzer_mixer_defaults.mjs';

const anchor=1.03357;
function fixture() {
  const reference={id:'ym2608',gain:anchor,unityAcRms:.1,targetAcRms:.1*anchor};
  const raw={psg:.2,ay8910:.1,nesApu:.08};
  return {schemaVersion:1,passed:true,sampleRate:44100,referenceFrequencyHz:440,reference,
    defaults:Object.fromEntries(Object.entries(raw).map(([id,value])=>[id,Number((reference.targetAcRms/value).toFixed(6))])),
    rows:Object.entries(raw).flatMap(([id,rawAcRms])=>[220,440,880].map(frequencyHz=>
      ({id,rawAcRms,frequencyHz,sampleRate:44100,canonical:true})))};
}

test('PSG balance derives exactly three default gains from the retained FM anchor',()=>{
  const report=fixture();
  assert.deepEqual(buildAnalyzerPsgDefaults(report,anchor),{psg:.516785,ay8910:1.03357,nesApu:1.291963});
  // A variant with another output model cannot silently replace the canonical capture.
  report.rows.push({id:'ay8910',frequencyHz:440,sampleRate:44100,canonical:false,rawAcRms:.04});
  assert.equal(buildAnalyzerPsgDefaults(report,anchor).ay8910,1.03357);
});

test('PSG balance rejects missing, duplicate or noncanonical frequency coverage',()=>{
  for(const mutate of [
    report=>report.rows.pop(),
    report=>report.rows.push({...report.rows[0]}),
    report=>{report.rows[0].canonical=false;},
    report=>{report.rows[0].sampleRate=48000;},
    report=>{report.rows[0].rawAcRms=0;},
  ]){
    const report=fixture();mutate(report);
    assert.throws(()=>buildAnalyzerPsgDefaults(report,anchor),/Missing Analyzer PSG reference/);
  }
});

test('PSG balance rejects changed anchors, edited gains and silent range clamping',()=>{
  for(const mutate of [
    report=>{report.reference.gain=1;},
    report=>{report.reference.targetAcRms*=.8;},
    report=>{report.reference.unityAcRms=NaN;},
    report=>{report.defaults.psg=.5;},
    report=>{report.defaults.ym2608=1;},
    report=>{report.rows.find(row=>row.id==='psg'&&row.frequencyHz===440).rawAcRms=.01;report.defaults.psg=2;},
  ]){
    const report=fixture();mutate(report);
    assert.throws(()=>buildAnalyzerPsgDefaults(report,anchor));
  }
});

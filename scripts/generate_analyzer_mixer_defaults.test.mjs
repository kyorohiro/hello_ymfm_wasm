import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {buildAnalyzerPsgDefaults,generateAnalyzerMixerDefaults,verifyAnalyzerCalibrationSources,isAnalyzerSourceLayoutRevision} from './generate_analyzer_mixer_defaults.mjs';
import {ANALYZER_MIXER_DEFAULTS} from '../docs/vgm_analyzer/mixer_calibration_data.js';

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

test('packaging calibration check covers the current measured renderer and generated defaults',async()=>{
  assert.deepEqual(await generateAnalyzerMixerDefaults({check:true}),ANALYZER_MIXER_DEFAULTS);
});

test('measurement source hashes stay mandatory and reject a changed renderer',async()=>{
  const bytes=new TextEncoder().encode('measured renderer');
  const sha256=createHash('sha256').update(bytes).digest('hex');
  const reports=[{sources:[{path:'renderer.js',sha256}]},{sources:{'renderer.js':sha256}},
    {sources:{'renderer.js':{sha256,size:bytes.length}}}];
  await verifyAnalyzerCalibrationSources(reports,async path=>{assert.equal(path,'renderer.js');return bytes;});
  for(const report of reports)await assert.rejects(verifyAnalyzerCalibrationSources([report],async()=>new TextEncoder().encode('changed renderer')),
    /Analyzer calibration source changed; remeasure: renderer.js/);
  for(const report of [{},{sources:[]},{sources:{}}])await assert.rejects(verifyAnalyzerCalibrationSources([report]),/Missing Analyzer calibration sources/);
});

test('source-folder migration preserves historical hashes and rejects any additional renderer or measurement edit',async()=>{
  const root=new URL('../',import.meta.url);
  const reports=await Promise.all(['analyzer_nes_levels_01','analyzer_extra_levels_06','analyzer_psg_levels_07']
    .map(async name=>JSON.parse(await readFile(new URL(`docs/issues/${name}.json`,root),'utf8'))));
  const expected=new Map(reports.flatMap(report=>Array.isArray(report.sources)?report.sources.map(record=>[record.path,record.sha256]):
    Object.entries(report.sources).map(([path,record])=>[path,typeof record==='string'?record:record.sha256])));
  for(const [path,location]of [
    ['scripts/measure_analyzer_nes_levels.mjs','scripts/measure_analyzer_nes_levels.mjs'],
    ['scripts/calibrate_analyzer_extra_levels.mjs','scripts/calibrate_analyzer_extra_levels.mjs'],
    ['scripts/measure_analyzer_psg_levels.mjs','scripts/measure_analyzer_psg_levels.mjs'],
    ['scripts/measure_analyzer_psg_balance.mjs','scripts/measure_analyzer_psg_balance.mjs'],
    ['cli/render.js','tetorica_src/cli/render.js'],
  ]){
    const bytes=await readFile(new URL(location,root)),hash=expected.get(path);
    assert(isAnalyzerSourceLayoutRevision(path,bytes,hash),path);
    assert.equal(isAnalyzerSourceLayoutRevision(path,Buffer.concat([bytes,Buffer.from('\n// changed audio or probe\n')]),hash),false,path);
    assert.equal(isAnalyzerSourceLayoutRevision('unrelated.js',bytes,hash),false,path);
    const original=JSON.stringify(reports);
    await verifyAnalyzerCalibrationSources([{sources:{[path]:hash}}],async()=>bytes);
    await assert.rejects(verifyAnalyzerCalibrationSources([{sources:{[path]:hash}}],async()=>Buffer.concat([bytes,Buffer.from('\n// mutation\n')])),/remeasure/);
    assert.equal(JSON.stringify(reports),original,'Captured reports and hash records remain untouched');
  }
});

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

test('the new YM2608 output-gain build retains every remeasured Analyzer PSG sample statistic and default',async()=>{
  const read=async name => JSON.parse(await readFile(new URL('../docs/issues/'+name,import.meta.url),'utf8'));
  const before=await read('analyzer_psg_levels_07.json'),after=await read('analyzer_psg_levels_08.json');
  assert.deepEqual(after.defaults,before.defaults);
  assert.deepEqual(after.reference,before.reference);
  assert.deepEqual(after.rows,before.rows);
  assert.notEqual(after.sources['docs/generated/ym2608_wasm.wasm'],before.sources['docs/generated/ym2608_wasm.wasm']);
  await assert.rejects(verifyAnalyzerCalibrationSources([before]),/source changed; remeasure:/,'The dormant Playground review cannot authorize the old measured YM2608 anchor');
});

test('AY Single Output refresh preserves canonical Analyzer statistics and rejects stale or changed renderer evidence',async()=>{
  const root=new URL('../',import.meta.url);
  const before=JSON.parse(await readFile(new URL('docs/issues/analyzer_psg_levels_08.json',root),'utf8'));
  const after=JSON.parse(await readFile(new URL('docs/issues/analyzer_psg_levels_09.json',root),'utf8'));
  assert.deepEqual(after.defaults,before.defaults);
  assert.deepEqual(after.reference,before.reference);
  assert.deepEqual(after.rows,before.rows);
  const changed=Object.keys(after.sources).filter(path=>after.sources[path]!==before.sources[path]);
  assert.deepEqual(changed.sort(),['docs/generated/ay8910_wasm.wasm','docs/js/ay8910.js']);
  // Preserve this historical AY transition without treating its older OPNA
  // renderer as evidence for the current independent-source implementation.
  await verifyAnalyzerCalibrationSources([{sources:Object.fromEntries(changed.map(path=>[path,after.sources[path]]))}]);
  await assert.rejects(verifyAnalyzerCalibrationSources([after]),/source changed; remeasure:/);
  await assert.rejects(verifyAnalyzerCalibrationSources([before]),/source changed; remeasure:/,
    'The old AY build cannot stand in for a real current-renderer measurement');
  for(const changedPath of changed) {
    await assert.rejects(verifyAnalyzerCalibrationSources([{sources:Object.fromEntries(changed.map(path=>[path,after.sources[path]]))}],async path=>{
      const bytes=await readFile(new URL(path,root));
      return path===changedPath?Buffer.concat([bytes,Buffer.from('\nmutation')]):bytes;
    }),/source changed; remeasure:/,changedPath);
  }
});

test('dual-chip routing retains every unit-gain sample and binds the current Analyzer graph',async()=>{
  const root=new URL('../',import.meta.url);
  for(const [beforeName,afterName] of [['analyzer_extra_levels_10','analyzer_extra_levels_11'],['analyzer_psg_levels_13','analyzer_psg_levels_14']]) {
    const read=async name=>JSON.parse(await readFile(new URL('docs/issues/'+name+'.json',root),'utf8'));
    const before=await read(beforeName),after=await read(afterName);
    assert.deepEqual(after.defaults,before.defaults);
    assert.deepEqual(after.rows,before.rows);
    assert.deepEqual(after.reference,before.reference);
    await verifyAnalyzerCalibrationSources([after]);
    await assert.rejects(verifyAnalyzerCalibrationSources([before]),/source changed; remeasure:/);
    for(const changedPath of ['docs/js/soundchip_mixer.js','docs/vgm_analyzer/ym2608_source_mix.js','docs/vgm_analyzer/playback_mixer.js']) {
      assert(Object.hasOwn(after.sources,changedPath));
      await assert.rejects(verifyAnalyzerCalibrationSources([after],async path=>{
        const bytes=await readFile(new URL(path,root));
        return path===changedPath?Buffer.concat([bytes,Buffer.from('\n// unrelated future change')]):bytes;
      }),/source changed; remeasure:/,changedPath);
    }
  }
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

test('only the reviewed cache query changes retain the measured Analyzer source hashes',async()=>{
  const root=new URL('../',import.meta.url);
  const report=JSON.parse(await readFile(new URL('docs/issues/analyzer_psg_levels_10.json',root),'utf8'));
  for(const [path,query] of [
    ['docs/js/ym2608audioengine.js','./ym2608.js?v=audio-stability-2'],
  ]){
    const measuredHash=report.sources[path],bytes=await readFile(new URL(path,root));
    const sources={[path]:measuredHash};
    assert.notEqual(createHash('sha256').update(bytes).digest('hex'),measuredHash);
    await verifyAnalyzerCalibrationSources([{sources}],async()=>bytes);
    for(const modified of [
      Buffer.from(bytes.toString('utf8').replace(query,query+'-future')),
      Buffer.concat([bytes,Buffer.from('\n// changed renderer\n')]),
    ]){
      assert.notDeepEqual(modified,bytes);
      await assert.rejects(verifyAnalyzerCalibrationSources([{sources}],async()=>modified),/remeasure:/,path);
    }
    await assert.rejects(verifyAnalyzerCalibrationSources([{sources:{[path]:'0'.repeat(64)}}],async()=>bytes),
      /remeasure:/,path);
    await assert.rejects(verifyAnalyzerCalibrationSources([{sources:{'unrelated.js':measuredHash}}],async()=>bytes),
      /remeasure:/,path);
  }
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

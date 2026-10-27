import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {buildSoundChipMixerPresets,generateSoundChipMixerPresets,renderSoundChipMixerPresets} from './generate_soundchip_mixer_presets.mjs';

const baselineUrl = new URL('../docs/issues/playground_chip_levels_01.json',import.meta.url);
const psgUrl = new URL('../docs/issues/soundchip_psg_levels_04.json',import.meta.url);

test('the npm preset reproduces from the shared measured baseline; checks reject edited output without overwriting it',async t=>{
  const directory = await mkdtemp(join(tmpdir(),'soundchip-presets-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const reportPath = join(directory,'baseline.json'), psgReportPath = join(directory,'psg.json'), outPath = join(directory,'nested/presets.js');
  const source = await readFile(baselineUrl,'utf8');
  await writeFile(reportPath,source);
  await writeFile(psgReportPath,await readFile(psgUrl,'utf8'));
  await generateSoundChipMixerPresets({reportPath,psgReportPath,outPath});
  const generated = await readFile(outPath,'utf8');
  assert.equal(generated,await readFile(new URL('../web/soundchip_mixer_presets.js',import.meta.url),'utf8'));
  await generateSoundChipMixerPresets({reportPath,psgReportPath,outPath,check:true});
  const changed = generated.replace('"volume": 0.280286','"volume": 0.56');
  assert.notEqual(changed,generated,'fixture changes the measured RF5C164 fallback');
  await writeFile(outPath,changed);
  await assert.rejects(generateSoundChipMixerPresets({reportPath,psgReportPath,outPath,check:true}),/stale/);
  assert.equal(await readFile(outPath,'utf8'),changed,'check never repairs an unreviewed change');
  const script = fileURLToPath(new URL('./generate_soundchip_mixer_presets.mjs',import.meta.url));
  const result = spawnSync(process.execPath,[script,`--report=${reportPath}`,`--psg-report=${psgReportPath}`,`--out=${outPath}`,'--check'],{encoding:'utf8'});
  assert.notEqual(result.status,0);
  assert.match(result.stderr,/stale/);
  assert.equal(await readFile(outPath,'utf8'),changed);
});

test('partial or verification-only reports cannot replace the public preset',async t=>{
  const directory = await mkdtemp(join(tmpdir(),'soundchip-presets-invalid-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const reportPath = join(directory,'baseline.json'), outPath = join(directory,'presets.js');
  const baseline = JSON.parse(await readFile(baselineUrl,'utf8'));
  const psgReport = JSON.parse(await readFile(psgUrl,'utf8'));
  const valid = renderSoundChipMixerPresets(baseline,psgReport);
  await writeFile(outPath,valid);
  for(const change of [report=>{report.verify=true;}, report=>{report.rows.pop();},
    report=>{report.calibration.routes.find(route=>route.role==='extra'&&route.kind==='rf5c164').volume*=2;}]) {
    const report = structuredClone(baseline);change(report);
    await writeFile(reportPath,JSON.stringify(report));
    await assert.rejects(generateSoundChipMixerPresets({reportPath,outPath}),/Invalid Playground Mixer calibration/);
    assert.equal(await readFile(outPath,'utf8'),valid);
  }
});

test('both measured reports are required and building presets does not mutate either input',async()=>{
  const baseline=JSON.parse(await readFile(baselineUrl,'utf8')),psg=JSON.parse(await readFile(psgUrl,'utf8'));
  const before=structuredClone({baseline,psg});
  assert.throws(()=>buildSoundChipMixerPresets(baseline),/PSG.*report/);
  assert.throws(()=>renderSoundChipMixerPresets(baseline),/PSG.*report/);
  const presets=buildSoundChipMixerPresets(baseline,psg);
  assert.deepEqual({baseline,psg},before);
  assert.equal(presets.calibrated.factoryDefaults.kinds.length,22);
  assert.deepEqual(presets.calibrated.factoryEngines,{version:1,engines:[{name:'ym2612',engine:'nuked',volume:.493869}]});
});

test('incomplete, wrong-backend and invalid PSG gains cannot overwrite the public preset',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'soundchip-presets-psg-invalid-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const reportPath=join(directory,'baseline.json'),psgReportPath=join(directory,'psg.json'),outPath=join(directory,'presets.js');
  const baseline=JSON.parse(await readFile(baselineUrl,'utf8')),psg=JSON.parse(await readFile(psgUrl,'utf8'));
  await writeFile(reportPath,JSON.stringify(baseline));
  const valid=renderSoundChipMixerPresets(baseline,psg);await writeFile(outPath,valid);
  const canonical=report=>report.rows.find(row=>row.kind==='nes'&&row.frequencyHz===440&&row.canonical);
  const cases=[
    ['failed report',report=>{report.passed=false;}],
    ['wrong canonical rate',report=>{report.sampleRate=48000;}],
    ['changed OPNA anchor',report=>{report.reference.gain=1;}],
    ['changed target',report=>{report.reference.targetAcRms*=.5;}],
    ['missing kind',report=>{delete report.defaults.nes;}],
    ['unexpected kind',report=>{report.defaults.ym2608=.5;}],
    ['Analyzer JS NES gain',report=>{report.defaults.nes=1.512236;}],
    ['boosted PSG',report=>{report.defaults.segapsg=2;}],
    ['missing capture',report=>{report.rows=report.rows.filter(row=>!(row.kind==='nes'&&row.frequencyHz===880&&row.canonical));}],
    ['duplicate capture',report=>{report.rows.push(structuredClone(canonical(report)));}],
    ['wrong backend',report=>{canonical(report).backend='javascript';}],
    ['invalid AC RMS',report=>{canonical(report).rawAcRms=0;}],
  ];
  for(const [label,change] of cases){
    const invalid=structuredClone(psg);change(invalid);
    await writeFile(psgReportPath,JSON.stringify(invalid));
    await assert.rejects(generateSoundChipMixerPresets({reportPath,psgReportPath,outPath}),/sound-chip PSG/i,label);
    assert.equal(await readFile(outPath,'utf8'),valid,label+' leaves the last valid artifact intact');
  }
});

test('missing or changed source hashes fail before replacing an otherwise valid generated file',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'soundchip-presets-source-invalid-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const reportPath=join(directory,'baseline.json'),psgReportPath=join(directory,'psg.json'),outPath=join(directory,'presets.js');
  const baseline=JSON.parse(await readFile(baselineUrl,'utf8')),psg=JSON.parse(await readFile(psgUrl,'utf8'));
  await writeFile(reportPath,JSON.stringify(baseline));
  const valid=renderSoundChipMixerPresets(baseline,psg);await writeFile(outPath,valid);
  const invalid=structuredClone(psg);invalid.sources[Object.keys(invalid.sources)[0]]='0'.repeat(64);
  await writeFile(psgReportPath,JSON.stringify(invalid));
  await assert.rejects(generateSoundChipMixerPresets({reportPath,psgReportPath,outPath}),/source changed; remeasure/);
  assert.equal(await readFile(outPath,'utf8'),valid);
  invalid.sources={};await writeFile(psgReportPath,JSON.stringify(invalid));
  await assert.rejects(generateSoundChipMixerPresets({reportPath,psgReportPath,outPath}),/Missing.*source hashes/);
  assert.equal(await readFile(outPath,'utf8'),valid);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {buildSoundChipMixerPresets,generateSoundChipMixerPresets,renderSoundChipMixerPresets} from './generate_soundchip_mixer_presets.mjs';
import {createPs1MixerCalibrationFixture} from '../test/helpers/ps1_mixer_calibration_fixture.mjs';
import {validatePs1MixerCalibration} from './ps1_mixer_calibration.mjs';
import {createWonderSwanMixerCalibrationFixture} from '../test/helpers/wonderswan_mixer_calibration_fixture.mjs';
import {validateWonderSwanMixerCalibration} from './wonderswan_mixer_calibration.mjs';
import {validatePokeyMixerCalibration} from './pokey_mixer_calibration.mjs';
import {createPokeyMixerCalibrationFixture} from '../test/helpers/pokey_mixer_calibration_fixture.mjs';

const baselineUrl = new URL('../docs/issues/playground_chip_levels_01.json',import.meta.url);
const psgUrl = new URL('../docs/issues/soundchip_psg_levels_04.json',import.meta.url);
const ps1ReportPath=fileURLToPath(new URL('../docs/issues/ps1_chip_levels_live_release_01.json',import.meta.url));
const wonderswanReportPath=fileURLToPath(new URL('../docs/issues/wonderswan_chip_levels_live_release_01.json',import.meta.url));
const pokeyReportPath=fileURLToPath(new URL('../docs/issues/pokey_chip_levels_live_release_01.json',import.meta.url));

test('the npm preset reproduces from the shared measured baseline; checks reject edited output without overwriting it',async t=>{
  const directory = await mkdtemp(join(tmpdir(),'soundchip-presets-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const reportPath = join(directory,'baseline.json'), psgReportPath = join(directory,'psg.json'), outPath = join(directory,'nested/presets.js');
  const source = await readFile(baselineUrl,'utf8');
  await writeFile(reportPath,source);
  await writeFile(psgReportPath,await readFile(psgUrl,'utf8'));
  await generateSoundChipMixerPresets({reportPath,psgReportPath,ps1ReportPath,wonderswanReportPath,pokeyReportPath,outPath});
  const generated = await readFile(outPath,'utf8');
  assert.equal(generated,await readFile(new URL('../web/soundchip_mixer_presets.js',import.meta.url),'utf8'));
  await generateSoundChipMixerPresets({reportPath,psgReportPath,ps1ReportPath,wonderswanReportPath,pokeyReportPath,outPath,check:true});
  const changed = generated.replace('"volume": 0.280286','"volume": 0.56');
  assert.notEqual(changed,generated,'fixture changes the measured RF5C164 fallback');
  await writeFile(outPath,changed);
  await assert.rejects(generateSoundChipMixerPresets({reportPath,psgReportPath,ps1ReportPath,wonderswanReportPath,pokeyReportPath,outPath,check:true}),/stale/);
  assert.equal(await readFile(outPath,'utf8'),changed,'check never repairs an unreviewed change');
  const script = fileURLToPath(new URL('./generate_soundchip_mixer_presets.mjs',import.meta.url));
  const result = spawnSync(process.execPath,[script,`--report=${reportPath}`,`--psg-report=${psgReportPath}`,`--out=${outPath}`,'--check'],{encoding:'utf8'});
  assert.notEqual(result.status,0);
  assert.match(result.stderr,/stale/);
  assert.equal(await readFile(outPath,'utf8'),changed);
});

test('PS1 calibration extends only the optional measured kind list and leaves historical presets intact',async()=>{
  const {historical,ps1Report}=await createPs1MixerCalibrationFixture(),psg=JSON.parse(await readFile(psgUrl,'utf8'));
  const before=structuredClone({historical,ps1Report,psg}),legacy=buildSoundChipMixerPresets(historical,psg);
  const extended=buildSoundChipMixerPresets(historical,psg,ps1Report),ps1=validatePs1MixerCalibration(historical,ps1Report);
  assert.deepEqual({historical,ps1Report,psg},before);
  assert.equal(legacy.calibrated.factoryDefaults.kinds.length,22);
  assert.equal(extended.calibrated.factoryDefaults.kinds.length,23);
  assert.deepEqual(extended.calibrated.factoryDefaults.kinds.filter(entry=>entry.name!=='ps1'),legacy.calibrated.factoryDefaults.kinds);
  assert.deepEqual(extended.calibrated.factoryDefaults.kinds.at(-1),{name:'ps1',volume:ps1.extraVolume});
  assert.deepEqual(extended.calibrated.factoryEngines,legacy.calibrated.factoryEngines);
  assert.equal(Object.hasOwn(extended.calibrated,'factoryEntries'),false,'Playground primary IDs do not enter npm factory policy');
  for(const invalid of [null,{...ps1Report,passed:false},{...ps1Report,verify:true}]) {
    assert.throws(()=>buildSoundChipMixerPresets(historical,psg,invalid),/PS1/i);
  }
});

test('PS1 preset generation validates source provenance before writing and supports explicit historical-only CLI output',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'soundchip-presets-ps1-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const reportPath=join(directory,'historical.json'),extensionPath=join(directory,'ps1.json'),outPath=join(directory,'presets.js');
  const {historical,ps1Report}=await createPs1MixerCalibrationFixture(),psg=JSON.parse(await readFile(psgUrl,'utf8'));
  await writeFile(reportPath,await readFile(baselineUrl));await writeFile(extensionPath,JSON.stringify(ps1Report));
  const options={reportPath,ps1ReportPath:extensionPath,outPath};
  await generateSoundChipMixerPresets(options);
  const valid=renderSoundChipMixerPresets(historical,psg,ps1Report);
  assert.equal(await readFile(outPath,'utf8'),valid);await generateSoundChipMixerPresets({...options,check:true});
  const script=fileURLToPath(new URL('./generate_soundchip_mixer_presets.mjs',import.meta.url));
  let result=spawnSync(process.execPath,[script,'--no-pokey','--no-wonderswan',`--report=${reportPath}`,`--ps1-report=${extensionPath}`,`--out=${outPath}`,'--check'],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  result=spawnSync(process.execPath,[script,'--no-pokey',`--ps1-report=${extensionPath}`,'--no-ps1',`--out=${outPath}`],{encoding:'utf8'});
  assert.notEqual(result.status,0);assert.match(result.stderr,/cannot be combined/);
  for(const change of [report=>{report.passed=false;},report=>{report.rows.pop();},report=>{report.calibration.targetAmplitude*=.9;},report=>{report.sources[Object.keys(report.sources)[0]].sha256='0'.repeat(64);}]) {
    const invalid=structuredClone(ps1Report);change(invalid);await writeFile(extensionPath,JSON.stringify(invalid));
    await assert.rejects(generateSoundChipMixerPresets(options),/PS1|Mixer calibration source receipt/i);
    assert.equal(await readFile(outPath,'utf8'),valid,'a rejected extension leaves the prior artifact untouched');
  }
  result=spawnSync(process.execPath,[script,'--no-pokey',`--report=${reportPath}`,'--no-ps1','--no-wonderswan',`--out=${outPath}`],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  assert.equal(await readFile(outPath,'utf8'),renderSoundChipMixerPresets(historical,psg));
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

test('WonderSwan extends only its optional npm kind while PS1 and all existing gains remain exact',async()=>{
  const {historical,wsReport}=await createWonderSwanMixerCalibrationFixture(),{ps1Report}=await createPs1MixerCalibrationFixture();
  const psg=JSON.parse(await readFile(psgUrl,'utf8')),before=structuredClone({historical,wsReport,ps1Report,psg});
  const legacy=buildSoundChipMixerPresets(historical,psg),ps1=buildSoundChipMixerPresets(historical,psg,ps1Report);
  const combined=buildSoundChipMixerPresets(historical,psg,ps1Report,wsReport),ws=validateWonderSwanMixerCalibration(historical,wsReport);
  const wsOnly=buildSoundChipMixerPresets(historical,psg,undefined,wsReport);
  assert.equal(legacy.calibrated.factoryDefaults.kinds.length,22);assert.equal(ps1.calibrated.factoryDefaults.kinds.length,23);
  assert.equal(wsOnly.calibrated.factoryDefaults.kinds.length,23);assert.equal(combined.calibrated.factoryDefaults.kinds.length,24);
  assert.deepEqual(combined.calibrated.factoryDefaults.kinds.filter(entry=>entry.name!=='wonderswan'),ps1.calibrated.factoryDefaults.kinds);
  assert.deepEqual(wsOnly.calibrated.factoryDefaults.kinds.filter(entry=>entry.name!=='wonderswan'),legacy.calibrated.factoryDefaults.kinds);
  assert.deepEqual(combined.calibrated.factoryDefaults.kinds.at(-1),{name:'wonderswan',volume:ws.extraVolume});
  assert.deepEqual(combined.calibrated.factoryEngines,legacy.calibrated.factoryEngines);
  assert.equal(Object.hasOwn(combined.calibrated,'factoryEntries'),false);
  assert.deepEqual({historical,wsReport,ps1Report,psg},before);
  for(const invalid of [null,{...wsReport,passed:false},{...wsReport,verify:true}])assert.throws(()=>buildSoundChipMixerPresets(historical,psg,ps1Report,invalid),/WonderSwan/i);
});

test('WonderSwan npm generation checks full measurement and source identity before writing and has independent CLI controls',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'soundchip-presets-wonderswan-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const reportPath=join(directory,'historical.json'),extensionPath=join(directory,'wonderswan.json'),outPath=join(directory,'presets.js');
  const {historical,wsReport}=await createWonderSwanMixerCalibrationFixture(),psg=JSON.parse(await readFile(psgUrl,'utf8'));
  await writeFile(reportPath,await readFile(baselineUrl));await writeFile(extensionPath,JSON.stringify(wsReport));
  const options={reportPath,wonderswanReportPath:extensionPath,outPath};
  await generateSoundChipMixerPresets(options);
  const valid=renderSoundChipMixerPresets(historical,psg,undefined,wsReport);
  assert.equal(await readFile(outPath,'utf8'),valid);await generateSoundChipMixerPresets({...options,check:true});
  const script=fileURLToPath(new URL('./generate_soundchip_mixer_presets.mjs',import.meta.url));
  let result=spawnSync(process.execPath,[script,'--no-pokey','--no-ps1',`--report=${reportPath}`,`--wonderswan-report=${extensionPath}`,`--out=${outPath}`,'--check'],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  result=spawnSync(process.execPath,[script,'--no-pokey','--no-ps1',`--wonderswan-report=${extensionPath}`,'--no-wonderswan',`--out=${outPath}`],{encoding:'utf8'});
  assert.notEqual(result.status,0);assert.match(result.stderr,/cannot be combined/);
  for(const change of [report=>{report.passed=false;},report=>{report.rows.pop();},report=>{report.calibration.targetAmplitude*=.9;},report=>{report.sources[Object.keys(report.sources)[0]].sha256='0'.repeat(64);}]){
    const invalid=structuredClone(wsReport);change(invalid);await writeFile(extensionPath,JSON.stringify(invalid));
    await assert.rejects(generateSoundChipMixerPresets(options),/WonderSwan|Mixer calibration source receipt/i);
    assert.equal(await readFile(outPath,'utf8'),valid,'rejected measurement leaves the previous public artifact intact');
  }
});

test('POKEY adds only its optional npm kind without changing PS1, WonderSwan or the historical 22',async()=>{
  const {historical,ps1Report}=await createPs1MixerCalibrationFixture(),{wsReport}=await createWonderSwanMixerCalibrationFixture();
  const {pokeyReport}=await createPokeyMixerCalibrationFixture(),psg=JSON.parse(await readFile(psgUrl,'utf8'));
  const before=structuredClone({historical,ps1Report,wsReport,pokeyReport,psg});
  const legacy=buildSoundChipMixerPresets(historical,psg),previous=buildSoundChipMixerPresets(historical,psg,ps1Report,wsReport);
  const combined=buildSoundChipMixerPresets(historical,psg,ps1Report,wsReport,pokeyReport),pokey=validatePokeyMixerCalibration(historical,pokeyReport);
  const independent=buildSoundChipMixerPresets(historical,psg,undefined,undefined,pokeyReport);
  assert.equal(legacy.calibrated.factoryDefaults.kinds.length,22);assert.equal(previous.calibrated.factoryDefaults.kinds.length,24);
  assert.equal(independent.calibrated.factoryDefaults.kinds.length,23);assert.equal(combined.calibrated.factoryDefaults.kinds.length,25);
  assert.deepEqual(combined.calibrated.factoryDefaults.kinds.filter(entry=>entry.name!=='pokey'),previous.calibrated.factoryDefaults.kinds);
  assert.deepEqual(independent.calibrated.factoryDefaults.kinds.filter(entry=>entry.name!=='pokey'),legacy.calibrated.factoryDefaults.kinds);
  assert.deepEqual(combined.calibrated.factoryDefaults.kinds.at(-1),{name:'pokey',volume:pokey.extraVolume});
  assert.deepEqual(combined.calibrated.factoryEngines,legacy.calibrated.factoryEngines);
  assert.equal(Object.hasOwn(combined.calibrated,'factoryEntries'),false,'machine-specific dual IDs stay in Playground');
  assert.deepEqual({historical,ps1Report,wsReport,pokeyReport,psg},before);
  for(const invalid of [null,{...pokeyReport,passed:false},{...pokeyReport,verify:true}])assert.throws(()=>buildSoundChipMixerPresets(historical,psg,ps1Report,wsReport,invalid),/POKEY/i);
});

test('POKEY npm generation checks complete evidence and freshness before replacing output with independent CLI opt-out',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'soundchip-presets-pokey-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const reportPath=join(directory,'historical.json'),extensionPath=join(directory,'pokey.json'),outPath=join(directory,'presets.js');
  const historicalBytes=await readFile(baselineUrl),historical=JSON.parse(historicalBytes),psg=JSON.parse(await readFile(psgUrl,'utf8'));
  const {pokeyReport}=await createPokeyMixerCalibrationFixture();
  await writeFile(reportPath,historicalBytes);await writeFile(extensionPath,JSON.stringify(pokeyReport));
  const options={reportPath,pokeyReportPath:extensionPath,outPath},valid=renderSoundChipMixerPresets(historical,psg,undefined,undefined,pokeyReport);
  await generateSoundChipMixerPresets(options);
  assert.equal(await readFile(outPath,'utf8'),valid);await generateSoundChipMixerPresets({...options,check:true});
  const script=fileURLToPath(new URL('./generate_soundchip_mixer_presets.mjs',import.meta.url));
  for(const flags of [['--pokey-report',extensionPath],[`--pokey-report=${extensionPath}`]]){
    const result=spawnSync(process.execPath,[script,'--no-ps1','--no-wonderswan',`--report=${reportPath}`,...flags,`--out=${outPath}`,'--check'],{encoding:'utf8'});
    assert.equal(result.status,0,result.stderr);
  }
  for(const flags of [['--no-pokey',`--pokey-report=${extensionPath}`],[`--pokey-report=${extensionPath}`,'--no-pokey']]){
    const result=spawnSync(process.execPath,[script,'--no-ps1','--no-wonderswan',`--report=${reportPath}`,...flags,`--out=${outPath}`],{encoding:'utf8'});
    assert.notEqual(result.status,0);assert.match(result.stderr,/cannot be combined/);assert.equal(await readFile(outPath,'utf8'),valid);
  }
  for(const change of [report=>{report.passed=false;},report=>{report.rows.pop();},report=>{report.calibration.routes[0].volume*=.5;},report=>{report.sources['generated/pokey_wasm.wasm'].sha256='0'.repeat(64);}]){
    const invalid=structuredClone(pokeyReport);change(invalid);await writeFile(extensionPath,JSON.stringify(invalid));
    await assert.rejects(generateSoundChipMixerPresets(options),/POKEY|served DSP\/WASM source changed/i);
    assert.equal(await readFile(outPath,'utf8'),valid,'a rejected extension preserves the prior public artifact');
  }
  const result=spawnSync(process.execPath,[script,'--no-ps1','--no-wonderswan','--no-pokey',`--report=${reportPath}`,`--out=${outPath}`],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);assert.equal(await readFile(outPath,'utf8'),renderSoundChipMixerPresets(historical,psg));
});

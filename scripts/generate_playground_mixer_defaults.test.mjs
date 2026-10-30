import test from 'node:test';
import assert from 'node:assert/strict';
import {copyFile,mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createPs1MixerCalibrationFixture} from '../test/helpers/ps1_mixer_calibration_fixture.mjs';
import {validatePs1MixerCalibration} from './ps1_mixer_calibration.mjs';
import {createWonderSwanMixerCalibrationFixture} from '../test/helpers/wonderswan_mixer_calibration_fixture.mjs';
import {validateWonderSwanMixerCalibration} from './wonderswan_mixer_calibration.mjs';
import {validatePokeyMixerCalibration} from './pokey_mixer_calibration.mjs';
import {createPokeyMixerCalibrationFixture} from '../test/helpers/pokey_mixer_calibration_fixture.mjs';
import {
  PLAYGROUND_CALIBRATION_KINDS,PLAYGROUND_CALIBRATION_PRIMARIES,PLAYGROUND_CALIBRATION_ENGINES,
  buildPlaygroundMixerDefaults,buildPlaygroundMixerPolicy,playgroundLegacyMixerTrims,renderPlaygroundMixerDefaults,generatePlaygroundMixerDefaults,
} from './generate_playground_mixer_defaults.mjs';

function fixture() {
  const routes = [
    ...PLAYGROUND_CALIBRATION_KINDS.map(kind=>({kind,role:'extra',mode:'genesis',name:'calibration-source'})),
    ...PLAYGROUND_CALIBRATION_ENGINES.map(route=>({...route,role:'extra',mode:'genesis',name:'calibration-source'})),
    ...PLAYGROUND_CALIBRATION_PRIMARIES.map(([mode,kind,name=kind])=>({kind,role:'primary',mode,name})),
  ].map((route,index)=>({...route,amplitude:route.kind==='spc'?.02:.1+index*.002}));
  const referenceAmplitude = routes.find(route=>route.role==='primary'&&route.mode==='genesis'&&route.kind==='ym2612').amplitude;
  const targetAmplitude = Math.min(referenceAmplitude,...routes.map(route=>route.amplitude*2));
  return {schemaVersion:1,passed:true,verify:false,engine:'chromium',frequencies:[220,440,880],
    rows:routes.flatMap(({name,...route})=>[220,440,880].map(frequencyHz=>({...route,frequencyHz,
      amplitude:route.amplitude*(frequencyHz===440?1:frequencyHz===220?1.01:.98),defaultCalibration:true,
      measuredAmplitude:route.amplitude*(route.kind==='spc'||route.kind==='snes'?.875:1),
      referencePeak:route.kind==='spc'||route.kind==='snes'?.875:1,
      mixer:{id:name,...(route.chipEngine?{engine:route.chipEngine}:{}),settings:{volume:1,pan:0,muted:false,solo:true}}}))),
    calibration:{referenceAmplitude,targetAmplitude,maxGain:2,targetReduced:targetAmplitude<referenceAmplitude,
      routes:routes.map(route=>({...route,volume:Number((targetAmplitude/route.amplitude).toFixed(6))}))},
  };
}
const row = (report,role,mode,kind) => report.calibration.routes.find(route=>route.role===role&&route.mode===mode&&route.kind===kind);
const entry = (profile,mode,id) => profile.factoryModes[mode].entries.find(entry=>entry.id===id);

test('listening policy covers PSG and wavetable primaries and extras while retaining measurements and FM output level',async()=>{
  const report=JSON.parse(await readFile(new URL('../docs/issues/playground_chip_levels_01.json',import.meta.url),'utf8'));
  const before=structuredClone(report),raw=buildPlaygroundMixerDefaults(report);
  const policy=buildPlaygroundMixerPolicy(report);
  const levels={segapsg:.35,ay8910:.85,nes:1.16,gameboy:.36,huc6280:.44};
  const expected=structuredClone(raw);
  for(const [name,volume] of Object.entries(levels))expected.factoryDefaults.kinds.find(entry=>entry.name===name).volume=volume;
  for(const mode of ['genesis','mega-cd','genesis-full','genesis-full-nuked','genesis-nuked']) {
    entry(expected,mode,'segapsg').settings.volume=.35;
    entry(expected,mode,'ym2612').settings.volume=Number((entry(raw,mode,'ym2612').settings.volume*.9).toFixed(6));
  }
  for(const mode of ['master-system','game-gear'])entry(expected,mode,'segapsg').settings.volume=.35;
  for(const mode of ['msx','msx-audio','atari-st'])entry(expected,mode,'ay8910').settings.volume=.85;
  entry(expected,'nes','nes').settings.volume=1.16;
  entry(expected,'gameboy','gameboy').settings.volume=.36;
  entry(expected,'pc-engine','huc6280').settings.volume=.44;
  entry(expected,'pc-engine-cd','huc6280').settings.volume=.44;
  expected.factoryDefaults.kinds.push({name:'wonderswan',volume:1});
  expected.factoryModes.wonderswan={version:1,entries:[{id:'wonderswan',name:'wonderswan',settings:{volume:1}}]};
  expected.factoryDefaults.kinds.push({name:'pokey',volume:1});
  expected.factoryModes.pokey={version:1,entries:[{id:'pokey',name:'pokey',settings:{volume:1}}]};
  expected.factoryModes['pokey-dual']={version:1,entries:[{id:'pokey',name:'pokey',settings:{volume:1}},{id:'pokey:2',name:'pokey',settings:{volume:1}}]};
  expected.factoryDefaults.kinds.push({name:'ps1',volume:1});
  expected.factoryModes.ps1={version:1,entries:[{id:'ps1',name:'ps1',settings:{volume:1}}]};
  expected.calibration.unmeasuredKinds=['wonderswan','pokey','ps1'];
  assert.deepEqual(policy,expected);
  assert.deepEqual(report,before);
});

test('new source-unit captures never receive the legacy Genesis trim conversion again',()=>{
  const report=fixture();report.gainUnits='source';
  for(const capture of report.rows)if(capture.role==='primary') {
    const trim=playgroundLegacyMixerTrims(capture.mode)[capture.kind]??1;
    capture.amplitude/=trim;capture.measuredAmplitude/=trim;
  }
  for(const route of report.calibration.routes) {
    route.amplitude=report.rows.find(capture=>capture.role===route.role&&capture.mode===route.mode&&
      capture.kind===route.kind&&capture.chipEngine===route.chipEngine&&capture.frequencyHz===440).amplitude;
    route.volume=Number((report.calibration.targetAmplitude/route.amplitude).toFixed(6));
  }
  report.calibration.referenceAmplitude=row(report,'primary','genesis','ym2612').amplitude;
  const raw=buildPlaygroundMixerDefaults(report),policy=buildPlaygroundMixerPolicy(report);
  for(const mode of ['genesis','mega-cd','genesis-full','genesis-full-nuked','genesis-nuked']) {
    assert.equal(entry(policy,mode,'ym2612').settings.volume,entry(raw,mode,'ym2612').settings.volume);
    assert.equal(entry(policy,mode,'segapsg').settings.volume,.35);
  }
});

test('a complete 153-capture baseline produces deterministic 440 Hz defaults including SPC',()=>{
  const report = fixture(), before = structuredClone(report), profile = buildPlaygroundMixerDefaults(report);
  assert.equal(report.rows.length,153); assert.equal(report.calibration.routes.length,51);
  assert.equal(profile.factoryDefaults.kinds.length,22);
  assert.equal(profile.factoryDefaults.kinds.find(kind=>kind.name==='spc').volume,2,'known SPC DSP reference contributes to System');
  assert.equal(profile.calibration.referenceFrequencyHz,440);
  assert.equal(profile.calibration.targetAmplitude,.04);
  assert.equal(profile.calibration.measuredExtraRoutes,22); assert.equal(profile.calibration.measuredPrimaryRoutes,28);
  assert.equal(profile.calibration.measuredEngineRoutes,1);
  assert.deepEqual(profile.factoryEngines,{version:1,engines:[{name:'ym2612',engine:'nuked',
    volume:report.calibration.routes.find(route=>route.chipEngine==='nuked').volume}]});
  for(const kind of profile.factoryDefaults.kinds)assert.equal(kind.volume,row(report,'extra','genesis',kind.name).volume);
  const reordered = structuredClone(report);
  reordered.rows.reverse(); reordered.calibration.routes.reverse(); reordered.frequencies.reverse();
  assert.deepEqual(buildPlaygroundMixerDefaults(reordered),profile);
  assert.equal(renderPlaygroundMixerDefaults(reordered),renderPlaygroundMixerDefaults(report));
  assert.deepEqual(report,before,'generation does not mutate measurement data');
});

test('other frequencies remain required validation captures while gains use the 440 Hz unit-amplitude routes verbatim',()=>{
  const report = fixture(), output = renderPlaygroundMixerDefaults(report);
  for(const capture of report.rows)if(capture.frequencyHz!==440)capture.amplitude*=3;
  assert.equal(renderPlaygroundMixerDefaults(report),output);
  const brr = report.rows.find(capture=>capture.kind==='snes'&&capture.role==='extra'&&capture.frequencyHz===440);
  assert.notEqual(brr.measuredAmplitude,brr.amplitude);
  const profile = buildPlaygroundMixerDefaults(report);
  assert.equal(profile.factoryDefaults.kinds.find(kind=>kind.name==='snes').volume,row(report,'extra','genesis','snes').volume,
    'the generator does not apply codecHeadroom a second time');
});

test('composite and legacy modes copy measured constituent gains without nominal primary trim compensation',()=>{
  const report = fixture(), profile = buildPlaygroundMixerDefaults(report);
  for(const mode of ['mega-cd','genesis-full'])for(const id of ['ym2612','segapsg']) {
    assert.deepEqual(entry(profile,mode,id),entry(profile,'genesis',id));
  }
  assert.deepEqual(entry(profile,'genesis-full','rf5c164'),entry(profile,'mega-cd','rf5c164'));
  for(const id of ['rf5c164','pwm'])assert.deepEqual(entry(profile,'genesis-full-nuked',id),entry(profile,'genesis-full',id));
  for(const id of ['ym2612','segapsg'])assert.deepEqual(entry(profile,'genesis-nuked',id),entry(profile,'genesis-full-nuked',id));
  assert.notEqual(entry(profile,'genesis-full-nuked','ym2612').settings.volume,entry(profile,'genesis','ym2612').settings.volume,
    'measured Nuked values remain distinct');
  assert.equal(entry(profile,'genesis','segapsg').settings.volume,row(report,'primary','genesis','segapsg').volume,
    'no nominal .35 correction is applied');
  assert.deepEqual(entry(profile,'neogeo-b','ym2610b'),{id:'ym2610b',name:'ym2610b',
    settings:{volume:row(report,'primary','neogeo-b','ym2610').volume}});
  assert.equal(profile.factoryModes['genesis-nuked'].entries.length,2);
  for(const entries of Object.values(profile.factoryModes))for(const record of entries.entries) {
    assert(record.settings.volume>0&&record.settings.volume<=2);
  }
});

test('Atari ST inherits only the AY default without claiming another calibrated route',()=>{
  const report=fixture(),before=structuredClone(report),profile=buildPlaygroundMixerDefaults(report);
  assert.deepEqual(profile.factoryModes['atari-st'],{version:1,entries:[entry(profile,'msx','ay8910')]});
  assert.notEqual(profile.factoryModes['atari-st'].entries[0],entry(profile,'msx','ay8910'));
  assert.equal(profile.calibration.measuredPrimaryRoutes,28);
  assert.equal(report.calibration.routes.some(route=>route.mode==='atari-st'),false);
  assert.equal(entry(buildPlaygroundMixerPolicy(report),'atari-st','ay8910').settings.volume,.85);
  assert.deepEqual(report,before);
});

test('partial, verification, duplicate, silent and incorrectly identified measurements cannot replace System',()=>{
  const changes = [
    report=>{report.passed=false;}, report=>{report.verify=true;}, report=>{delete report.verify;},
    report=>{report.schemaVersion=2;}, report=>{report.gainUnits='invalid';}, report=>{report.frequencies=[440];},
    report=>{report.rows.pop();}, report=>{report.rows[0]=structuredClone(report.rows[1]);},
    report=>{report.rows[0].frequencyHz=110;}, report=>{report.rows[0].kind='unknown';},
    report=>{report.rows[0].mixer.id='wrong-id';}, report=>{report.rows[0].amplitude=0;},
    report=>{report.rows[0].amplitude=Infinity;}, report=>{report.rows[0].defaultCalibration=false;},
    report=>{report.calibration.routes.pop();}, report=>{report.calibration.routes[0]=structuredClone(report.calibration.routes[1]);},
    report=>{report.calibration.routes[0].name='wrong-id';}, report=>{report.calibration.routes[0].amplitude*=2;},
  ];
  for(const change of changes) {const report=fixture();change(report);assert.throws(()=>buildPlaygroundMixerDefaults(report),/Invalid Playground Mixer calibration/);}
});

test('inconsistent targets, edited gains and gains outside the existing Mixer limit are rejected instead of clamped',()=>{
  const changes = [
    report=>{report.calibration.maxGain=2.1;},report=>{report.calibration.maxGain=0;},
    report=>{report.calibration.targetAmplitude=0;},report=>{report.calibration.targetAmplitude=NaN;},
    report=>{report.calibration.referenceAmplitude*=2;},report=>{report.calibration.routes[0].volume=0;},
    report=>{report.calibration.routes[0].volume=2.01;},report=>{report.calibration.routes[0].volume+=.000001;},
    report=>{report.calibration.targetAmplitude*=.9;for(const route of report.calibration.routes)route.volume=Number((report.calibration.targetAmplitude/route.amplitude).toFixed(6));},
  ];
  for(const change of changes) {const report=fixture();change(report);assert.throws(()=>buildPlaygroundMixerDefaults(report),/Invalid Playground Mixer calibration/);}
});

test('cached additional sources cannot masquerade as primary Genesis PSG, OPNA or PWM captures',()=>{
  for(const [mode,kind] of [['genesis','segapsg'],['pc98','ym2608'],['genesis-full','pwm']]) {
    const report = fixture();
    for(const capture of report.rows)if(capture.role==='primary'&&capture.mode===mode&&capture.kind===kind) {
      capture.mixer.id=kind+':shared';
    }
    row(report,'primary',mode,kind).name=kind+':shared';
    assert.throws(()=>buildPlaygroundMixerDefaults(report),/invalid measured capture/);
    for(const capture of report.rows)if(capture.role==='primary'&&capture.mode===mode&&capture.kind===kind)capture.mixer.id=kind;
    assert.throws(()=>buildPlaygroundMixerDefaults(report),/incorrectly named calibrated route/);
  }
});

test('every reference capture must use a unity, centered, unmuted and solo Mixer strip',()=>{
  for(const settings of [undefined,{volume:.5,pan:0,muted:false,solo:true},
    {volume:1,pan:1,muted:false,solo:true},{volume:1,pan:0,muted:true,solo:true},
    {volume:1,pan:0,muted:false,solo:false}]) {
    const report = fixture(); report.rows[0].mixer.settings=settings;
    assert.throws(()=>buildPlaygroundMixerDefaults(report),/unity, centered, unmuted, solo/);
  }
});

test('generated module constructs independent application mixers and preserves saved numbers under factory policies',async t=>{
  const directory = await mkdtemp(join(tmpdir(),'playground-mixer-generator-')); t.after(()=>rm(directory,{recursive:true,force:true}));
  await mkdir(join(directory,'playground')); await mkdir(join(directory,'js'));
  await copyFile(new URL('../web/soundchip_mixer.js',import.meta.url),join(directory,'js','soundchip_mixer.js'));
  const modulePath = join(directory,'playground','defaults.mjs'), report = fixture(), profile = buildPlaygroundMixerPolicy(report);
  await writeFile(modulePath,renderPlaygroundMixerDefaults(report));
  const generated = await import(pathToFileURL(modulePath));
  assert.equal(generated.createPlaygroundSoundChipMixer().gainUnits,'source');
  assert.deepEqual(generated.playgroundLegacyMixerTrims('genesis'),{ym2612:.9,segapsg:.35});
  assert.deepEqual(generated.playgroundLegacyMixerTrims('master-system'),{});
  assert.equal(generated.PLAYGROUND_MIXER_CALIBRATION.targetAmplitude,.04);
  assert(Object.isFrozen(generated.PLAYGROUND_MIXER_CALIBRATION.frequencies));
  const first = generated.createPlaygroundSoundChipMixer('genesis'), second = generated.createPlaygroundSoundChipMixer('genesis');
  first.register('segapsg','segapsg',()=>{}); first.register('extra','segapsg',()=>{});
  assert.equal(first.get('segapsg').volume,entry(profile,'genesis','segapsg').settings.volume);
  assert.equal(first.get('extra').volume,.35);
  first.set('segapsg',{volume:.1234567});
  assert.equal(first.get('segapsg').volume,.1234567);
  assert.equal(second.get('segapsg').volume,entry(profile,'genesis','segapsg').settings.volume);
  assert.deepEqual(first.exportDefaults(),{version:1,kinds:[]});
  assert.deepEqual(first.exportState(),{version:1,entries:[{id:'segapsg',name:'segapsg',settings:{volume:.1234567}}]});
  const gameboy=generated.createPlaygroundSoundChipMixer('gameboy');
  gameboy.register('gameboy','gameboy',()=>{});gameboy.register('extra','gameboy',()=>{});
  assert.equal(gameboy.get('gameboy').volume,entry(profile,'gameboy','gameboy').settings.volume);assert.equal(gameboy.get('extra').volume,.36);
  gameboy.restoreState({version:1,entries:[{id:'gameboy',name:'gameboy',settings:{volume:1}}]},{version:1,kinds:[]});
  assert.equal(gameboy.get('gameboy').volume,1,'saved absolute volume is retained');
  assert.equal(gameboy.get('extra').volume,.36,'unmodified extra uses the listening fallback');
  gameboy.restoreState({version:1,entries:[]},{version:1,kinds:[]});
  assert.equal(gameboy.get('gameboy').volume,entry(profile,'gameboy','gameboy').settings.volume,'System fallback is applied once');
  const atari=generated.createPlaygroundSoundChipMixer('atari-st');
  atari.register('ay8910','ay8910',()=>{});
  assert.equal(atari.get('ay8910').volume,.85,'Atari ST can start with the shared AY listening default');
  atari.restoreState({version:1,entries:[{id:'ay8910',name:'ay8910',settings:{volume:.6}}]},{version:1,kinds:[]});
  assert.equal(atari.get('ay8910').volume,.6,'Atari ST preserves a saved Mixer adjustment');
  first.restoreState({version:1,entries:[]},{version:1,kinds:[]});
  assert.equal(first.get('segapsg').volume,entry(profile,'genesis','segapsg').settings.volume);
  assert.throws(()=>generated.createPlaygroundSoundChipMixer('missing-mode'),/No Playground Mixer calibration/);
  assert.throws(()=>generated.createPlaygroundSoundChipMixer('__proto__'),/No Playground Mixer calibration/);
});

test('CLI generation and --check are reproducible and reject invalid input without overwriting existing output',async t=>{
  const directory = await mkdtemp(join(tmpdir(),'playground mixer cli ')); t.after(()=>rm(directory,{recursive:true,force:true}));
  const reportPath = join(directory,'baseline report.json'), outPath = join(directory,'generated module.js');
  const report = fixture(); await writeFile(reportPath,JSON.stringify(report));
  const script = fileURLToPath(new URL('./generate_playground_mixer_defaults.mjs',import.meta.url));
  let result = spawnSync(process.execPath,[script,'--no-scsp','--no-pokey','--no-ps1','--no-wonderswan','--report',reportPath,`--out=${outPath}`],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr); const expected = renderPlaygroundMixerDefaults(report);
  assert.equal(await readFile(outPath,'utf8'),expected);
  result=spawnSync(process.execPath,[script,'--no-scsp','--no-pokey','--no-ps1','--no-wonderswan',`--report=${reportPath}`,'--out',outPath,'--check'],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  await writeFile(outPath,'keep this authored file');
  result=spawnSync(process.execPath,[script,'--no-scsp','--no-pokey','--no-ps1','--no-wonderswan',`--report=${reportPath}`,`--out=${outPath}`,'--check'],{encoding:'utf8'});
  assert.notEqual(result.status,0);assert.match(result.stderr,/stale/);
  report.passed=false;await writeFile(reportPath,JSON.stringify(report));
  await assert.rejects(generatePlaygroundMixerDefaults({reportPath,outPath}),/successful, non-verification/);
  result=spawnSync(process.execPath,[script,'--no-scsp','--no-pokey','--no-ps1','--no-wonderswan',`--report=${reportPath}`,`--out=${outPath}`],{encoding:'utf8'});
  assert.notEqual(result.status,0);assert.equal(await readFile(outPath,'utf8'),'keep this authored file');
  result=spawnSync(process.execPath,[script,'--no-scsp','--no-pokey',`--out=${outPath}`],{encoding:'utf8'});
  assert.notEqual(result.status,0);assert.match(result.stderr,/--report is required/);
});

test('--check ignores only the synchronized Mixer import cache version and preserves every other exact check',async t=>{
  const directory = await mkdtemp(join(tmpdir(),'playground-mixer-cache-')); t.after(()=>rm(directory,{recursive:true,force:true}));
  const reportPath = join(directory,'baseline.json'), outPath = join(directory,'generated.js'), report = fixture();
  await writeFile(reportPath,JSON.stringify(report));
  const output = renderPlaygroundMixerDefaults(report), options = {reportPath,outPath,check:true};
  const synchronized = output.replace("../js/soundchip_mixer.js'","../js/soundchip_mixer.js?v=native-extra-levels-1'");
  await writeFile(outPath,synchronized);
  await generatePlaygroundMixerDefaults(options);
  assert.equal(await readFile(outPath,'utf8'),synchronized,'checking never strips the live cache version from disk');
  const script = fileURLToPath(new URL('./generate_playground_mixer_defaults.mjs',import.meta.url));
  const result = spawnSync(process.execPath,[script,'--no-scsp','--no-pokey','--no-ps1','--no-wonderswan',`--report=${reportPath}`,`--out=${outPath}`,'--check'],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  for(const changed of [
    synchronized.replace('"targetAmplitude": 0.04','"targetAmplitude": 0.05'),
    synchronized.replace('"volume": 2','"volume": 1.9'),
    synchronized.replace("../js/soundchip_mixer.js?v=native-extra-levels-1","../js/other_mixer.js?v=native-extra-levels-1"),
    synchronized.replace('?v=native-extra-levels-1','?v=native-extra-levels-1&other=1'),
    synchronized.replace('?v=native-extra-levels-1','?other=1&v=native-extra-levels-1'),
    synchronized.replace('return new SoundChipMixer','return SoundChipMixer'),
    synchronized+'\n',
  ]) {
    assert.notEqual(changed,synchronized,'fixture must change the generated module');
    await writeFile(outPath,changed);
    await assert.rejects(generatePlaygroundMixerDefaults(options),/stale/);
    assert.equal(await readFile(outPath,'utf8'),changed);
  }
  await generatePlaygroundMixerDefaults({reportPath,outPath});
  assert.equal(await readFile(outPath,'utf8'),output,'normal generation remains query-free');
});

test('a separately validated PS1 extension preserves all historical captures, gains and listening levels',async()=>{
  const {historical,ps1Report}=await createPs1MixerCalibrationFixture();
  const before=structuredClone({historical,ps1Report});
  const historicalPolicy=buildPlaygroundMixerPolicy(historical),policy=buildPlaygroundMixerPolicy(historical,ps1Report);
  const ps1=validatePs1MixerCalibration(historical,ps1Report);
  assert.deepEqual({historical,ps1Report},before);
  assert.equal(policy.factoryDefaults.kinds.find(entry=>entry.name==='ps1').volume,ps1.extraVolume);
  assert.equal(entry(policy,'ps1','ps1').settings.volume,ps1.primaryVolume);
  assert.deepEqual(policy.calibration.unmeasuredKinds,['wonderswan','pokey']);
  assert.deepEqual(policy.calibration.extensions,{ps1:ps1.metadata});
  assert.equal(policy.calibration.measuredExtraRoutes,22);
  assert.equal(policy.calibration.measuredPrimaryRoutes,28);
  assert.equal(policy.calibration.targetAmplitude,historicalPolicy.calibration.targetAmplitude);
  assert.deepEqual(policy.factoryDefaults.kinds.filter(entry=>entry.name!=='ps1'),historicalPolicy.factoryDefaults.kinds.filter(entry=>entry.name!=='ps1'));
  for(const [mode,settings]of Object.entries(historicalPolicy.factoryModes))if(mode!=='ps1')assert.deepEqual(policy.factoryModes[mode],settings,mode);
  assert.equal(buildPlaygroundMixerDefaults(historical).factoryDefaults.kinds.length,22,'historical measurements remain fixed');
  const omitted=buildPlaygroundMixerPolicy(historical);
  assert.equal(entry(omitted,'ps1','ps1').settings.volume,1);
  assert.equal(omitted.factoryDefaults.kinds.find(entry=>entry.name==='ps1').volume,1);
  assert.deepEqual(omitted.calibration.unmeasuredKinds,['wonderswan','pokey','ps1']);
  assert.equal(Object.hasOwn(omitted.calibration,'extensions'),false);
});

test('the shipped Playground System policy reproduces from all separately measured extensions and hashed sources',async()=>{
  const reportPath=fileURLToPath(new URL('../docs/issues/playground_chip_levels_01.json',import.meta.url));
  const ps1ReportPath=fileURLToPath(new URL('../docs/issues/ps1_scsp_chip_levels_01.json',import.meta.url));
  const wonderswanReportPath=fileURLToPath(new URL('../docs/issues/wonderswan_scsp_chip_levels_01.json',import.meta.url));
  const pokeyReportPath=fileURLToPath(new URL('../docs/issues/pokey_scsp_chip_levels_01.json',import.meta.url));
const scspReportPath=fileURLToPath(new URL('../docs/issues/scsp_chip_levels_01.json',import.meta.url));
  const moduleUrl=new URL('../docs/playground/playground_mixer_defaults.js',import.meta.url),outPath=fileURLToPath(moduleUrl);
  const historicalText=await readFile(reportPath,'utf8'),ps1Text=await readFile(ps1ReportPath,'utf8'),wonderswanText=await readFile(wonderswanReportPath,'utf8'),pokeyText=await readFile(pokeyReportPath,'utf8'),output=await readFile(outPath,'utf8');
  const historical=JSON.parse(historicalText),ps1Report=JSON.parse(ps1Text);
  const calibration=await generatePlaygroundMixerDefaults({reportPath,ps1ReportPath,wonderswanReportPath,pokeyReportPath,scspReportPath,outPath,check:true});
  const generated=await import(moduleUrl),mixer=generated.createPlaygroundSoundChipMixer('ps1');
  const canonical=role=>ps1Report.rows.find(row=>row.role===role&&row.engine==='chromium'&&row.requestedSampleRate===48000&&row.execution==='main'&&row.frequencyHz===440);
  mixer.register('ps1','ps1',()=>{});mixer.register('ps1:2','ps1',()=>{});
  assert.equal(mixer.get('ps1').volume,Number((historical.calibration.targetAmplitude/canonical('primary').amplitude).toFixed(6)));
  assert.equal(mixer.get('ps1:2').volume,Number((historical.calibration.targetAmplitude/canonical('extra').amplitude).toFixed(6)));
  assert.deepEqual(generated.PLAYGROUND_MIXER_CALIBRATION,calibration);
  assert.equal(calibration.extensions.ps1.measuredPs1Captures,48);
  assert.equal(calibration.extensions.ps1.measuredAnchorCaptures,8);
  const wsReport=JSON.parse(wonderswanText),wonderswan=validateWonderSwanMixerCalibration(historical,wsReport);
  const wsMixer=generated.createPlaygroundSoundChipMixer('wonderswan');wsMixer.register('wonderswan','wonderswan',()=>{});wsMixer.register('wonderswan:2','wonderswan',()=>{});
  assert.equal(wsMixer.get('wonderswan').volume,wonderswan.primaryVolume);assert.equal(wsMixer.get('wonderswan:2').volume,wonderswan.extraVolume);
  assert.deepEqual(calibration.extensions.wonderswan,wonderswan.metadata);
  const pokeyReport=JSON.parse(pokeyText),pokey=validatePokeyMixerCalibration(historical,pokeyReport);
  for(const [mode,ids]of [['pokey',[['pokey',pokey.primaryVolume],['extra',pokey.extraVolume]]],['pokey-dual',[['pokey',pokey.dualFirstVolume],['pokey:2',pokey.dualSecondVolume],['extra',pokey.extraVolume]]]]){
    const pokeyMixer=generated.createPlaygroundSoundChipMixer(mode);
    for(const [id,volume]of ids){pokeyMixer.register(id,'pokey',()=>{});assert.equal(pokeyMixer.get(id).volume,volume);}
  }
  assert.deepEqual(calibration.extensions.pokey,pokey.metadata);
  assert.deepEqual(calibration.unmeasuredKinds,[]);
  assert.equal(await readFile(reportPath,'utf8'),historicalText,'checking leaves the historical baseline unchanged');
  assert.equal(await readFile(ps1ReportPath,'utf8'),ps1Text,'checking leaves the independent measurement unchanged');
  assert.equal(await readFile(wonderswanReportPath,'utf8'),wonderswanText,'checking leaves the WonderSwan measurement unchanged');
  assert.equal(await readFile(pokeyReportPath,'utf8'),pokeyText,'checking leaves the POKEY measurement unchanged');
  assert.equal(await readFile(outPath,'utf8'),output,'check does not rewrite the shipped policy or its cache version');
});

test('generated PS1 System defaults apply measured primary and extra gains once while retaining authored settings',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'ps1-playground-defaults-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  await mkdir(join(directory,'playground'));await mkdir(join(directory,'js'));
  await copyFile(new URL('../web/soundchip_mixer.js',import.meta.url),join(directory,'js','soundchip_mixer.js'));
  const {historical,ps1Report}=await createPs1MixerCalibrationFixture();
  const modulePath=join(directory,'playground','defaults.mjs');
  await writeFile(modulePath,renderPlaygroundMixerDefaults(historical,ps1Report));
  const generated=await import(pathToFileURL(modulePath)),ps1=validatePs1MixerCalibration(historical,ps1Report);
  const mixer=generated.createPlaygroundSoundChipMixer('ps1');
  mixer.register('ps1','ps1',()=>{});mixer.register('ps1:2','ps1',()=>{});
  assert.equal(mixer.get('ps1').volume,ps1.primaryVolume);
  assert.equal(mixer.get('ps1:2').volume,ps1.extraVolume);
  assert(Object.isFrozen(generated.PLAYGROUND_MIXER_CALIBRATION.extensions.ps1.canonical));
  mixer.setKindDefault('ps1',{volume:.7});mixer.set('ps1:2',{volume:.9});
  const saved=mixer.exportState(),defaults=mixer.exportDefaults();
  for(let index=0;index<3;index++)mixer.restoreState(saved,defaults);
  assert.equal(mixer.get('ps1').volume,.7);assert.equal(mixer.get('ps1:2').volume,.9);
  for(let index=0;index<3;index++)mixer.restoreState({version:1,entries:[]},{version:1,kinds:[]});
  assert.equal(mixer.get('ps1').volume,ps1.primaryVolume);assert.equal(mixer.get('ps1:2').volume,ps1.extraVolume);
  assert.deepEqual(mixer.exportState(),{version:1,entries:[]});
});

test('PS1 extension generation and CLI check preserve output on failed reports or changed sources',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'ps1-playground-generator-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const reportPath=join(directory,'historical.json'),ps1ReportPath=join(directory,'ps1.json'),outPath=join(directory,'defaults.js');
  const {historical,ps1Report}=await createPs1MixerCalibrationFixture();
  await writeFile(reportPath,await readFile(new URL('../docs/issues/playground_chip_levels_01.json',import.meta.url)));
  await writeFile(ps1ReportPath,JSON.stringify(ps1Report));
  const options={reportPath,ps1ReportPath,outPath};
  const calibration=await generatePlaygroundMixerDefaults(options),valid=renderPlaygroundMixerDefaults(historical,ps1Report);
  assert.deepEqual(calibration,buildPlaygroundMixerPolicy(historical,ps1Report).calibration);
  assert.equal(await readFile(outPath,'utf8'),valid);
  await generatePlaygroundMixerDefaults({...options,check:true});
  const script=fileURLToPath(new URL('./generate_playground_mixer_defaults.mjs',import.meta.url));
  let result=spawnSync(process.execPath,[script,'--no-scsp','--no-pokey','--no-wonderswan',`--report=${reportPath}`,'--ps1-report',ps1ReportPath,`--out=${outPath}`,'--check'],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  result=spawnSync(process.execPath,[script,'--no-scsp','--no-pokey',`--report=${reportPath}`,`--ps1-report=${ps1ReportPath}`,'--no-ps1',`--out=${outPath}`],{encoding:'utf8'});
  assert.notEqual(result.status,0);assert.match(result.stderr,/cannot be combined/);
  for(const change of [report=>{report.passed=false;},report=>{report.rows.pop();},report=>{report.calibration.targetAmplitude*=.9;},report=>{report.sources[Object.keys(report.sources)[0]].sha256='0'.repeat(64);}]) {
    const invalid=structuredClone(ps1Report);change(invalid);await writeFile(ps1ReportPath,JSON.stringify(invalid));
    await assert.rejects(generatePlaygroundMixerDefaults(options),/PS1|Mixer calibration source receipt/i);
    assert.equal(await readFile(outPath,'utf8'),valid,'invalid extension must not replace the last valid System output');
  }
});

test('WonderSwan is an independent measured extension that preserves PS1 and all historical gains',async()=>{
  const {historical,wsReport}=await createWonderSwanMixerCalibrationFixture();
  const {ps1Report}=await createPs1MixerCalibrationFixture();
  const before=structuredClone({historical,wsReport,ps1Report});
  const legacy=buildPlaygroundMixerPolicy(historical,ps1Report),policy=buildPlaygroundMixerPolicy(historical,ps1Report,wsReport);
  const ws=validateWonderSwanMixerCalibration(historical,wsReport);
  assert.equal(policy.factoryDefaults.kinds.find(entry=>entry.name==='wonderswan').volume,ws.extraVolume);
  assert.equal(entry(policy,'wonderswan','wonderswan').settings.volume,ws.primaryVolume);
  assert.deepEqual(policy.calibration.extensions.ps1,legacy.calibration.extensions.ps1);
  assert.deepEqual(policy.calibration.extensions.wonderswan,ws.metadata);
  assert.deepEqual(policy.calibration.unmeasuredKinds,['pokey']);
  assert.deepEqual(policy.factoryDefaults.kinds.filter(entry=>entry.name!=='wonderswan'),legacy.factoryDefaults.kinds.filter(entry=>entry.name!=='wonderswan'));
  assert.deepEqual(Object.fromEntries(Object.entries(policy.factoryModes).filter(([name])=>name!=='wonderswan')),Object.fromEntries(Object.entries(legacy.factoryModes).filter(([name])=>name!=='wonderswan')));
  assert.deepEqual(policy.factoryEngines,legacy.factoryEngines);
  assert.equal(policy.calibration.targetAmplitude,legacy.calibration.targetAmplitude);
  const standalone=buildPlaygroundMixerPolicy(historical,undefined,wsReport);
  assert.deepEqual(standalone.calibration.unmeasuredKinds,['pokey','ps1']);
  assert.deepEqual(Object.keys(standalone.calibration.extensions),['wonderswan']);
  assert.equal(entry(standalone,'ps1','ps1').settings.volume,1,'omitting PS1 remains independent');
  assert.deepEqual({historical,wsReport,ps1Report},before,'neither measurement is mutated');
});

test('generated WonderSwan primary and extra gains apply once and authored common/per-ID settings remain absolute',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'wonderswan-playground-defaults-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  await mkdir(join(directory,'playground'));await mkdir(join(directory,'js'));
  await copyFile(new URL('../web/soundchip_mixer.js',import.meta.url),join(directory,'js','soundchip_mixer.js'));
  const {historical,wsReport}=await createWonderSwanMixerCalibrationFixture();
  const modulePath=join(directory,'playground','defaults.mjs');
  await writeFile(modulePath,renderPlaygroundMixerDefaults(historical,undefined,wsReport));
  const generated=await import(pathToFileURL(modulePath)),ws=validateWonderSwanMixerCalibration(historical,wsReport);
  const mixer=generated.createPlaygroundSoundChipMixer('wonderswan'),applied={};
  mixer.register('wonderswan','wonderswan',settings=>{applied.primary=settings.volume;});
  mixer.register('wonderswan:2','wonderswan',settings=>{applied.extra=settings.volume;});
  assert.equal(mixer.get('wonderswan').volume,ws.primaryVolume);assert.equal(mixer.get('wonderswan:2').volume,ws.extraVolume);
  assert.deepEqual(applied,{primary:ws.primaryVolume,extra:ws.extraVolume},'endpoint receives exactly the measured absolute gain');
  assert(Object.isFrozen(generated.PLAYGROUND_MIXER_CALIBRATION.extensions.wonderswan.canonical));
  mixer.setKindDefault('wonderswan',{volume:.6});mixer.set('wonderswan:2',{volume:.8});
  const state=mixer.exportState(),defaults=mixer.exportDefaults();
  for(let index=0;index<3;index++)mixer.restoreState(state,defaults);
  assert.equal(mixer.get('wonderswan').volume,.6);assert.equal(mixer.get('wonderswan:2').volume,.8);
  assert.deepEqual(applied,{primary:.6,extra:.8},'authoring replaces the measured policy instead of multiplying it');
  for(let index=0;index<3;index++)mixer.restoreState({version:1,entries:[]},{version:1,kinds:[]});
  assert.deepEqual(applied,{primary:ws.primaryVolume,extra:ws.extraVolume});
  assert.deepEqual(mixer.exportState(),{version:1,entries:[]});assert.deepEqual(mixer.exportDefaults(),{version:1,kinds:[]});
});

test('WonderSwan Playground generation rejects partial measurements and stale sources before overwriting output',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'wonderswan-playground-generator-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const reportPath=join(directory,'historical.json'),wonderswanReportPath=join(directory,'wonderswan.json'),outPath=join(directory,'defaults.js');
  const {historical,wsReport}=await createWonderSwanMixerCalibrationFixture();
  await writeFile(reportPath,await readFile(new URL('../docs/issues/playground_chip_levels_01.json',import.meta.url)));
  await writeFile(wonderswanReportPath,JSON.stringify(wsReport));
  const options={reportPath,wonderswanReportPath,outPath},valid=renderPlaygroundMixerDefaults(historical,undefined,wsReport);
  const calibration=await generatePlaygroundMixerDefaults(options);
  assert.deepEqual(calibration,buildPlaygroundMixerPolicy(historical,undefined,wsReport).calibration);
  assert.equal(await readFile(outPath,'utf8'),valid);await generatePlaygroundMixerDefaults({...options,check:true});
  const script=fileURLToPath(new URL('./generate_playground_mixer_defaults.mjs',import.meta.url));
  let result=spawnSync(process.execPath,[script,'--no-scsp','--no-pokey','--no-ps1',`--report=${reportPath}`,'--wonderswan-report',wonderswanReportPath,`--out=${outPath}`,'--check'],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  result=spawnSync(process.execPath,[script,'--no-scsp','--no-pokey','--no-ps1',`--report=${reportPath}`,`--wonderswan-report=${wonderswanReportPath}`,'--no-wonderswan',`--out=${outPath}`],{encoding:'utf8'});
  assert.notEqual(result.status,0);assert.match(result.stderr,/cannot be combined/);
  for(const change of [report=>{report.passed=false;},report=>{report.rows.pop();},report=>{report.calibration.targetAmplitude*=.9;},report=>{report.sources[Object.keys(report.sources)[0]].sha256='0'.repeat(64);}]){
    const invalid=structuredClone(wsReport);change(invalid);await writeFile(wonderswanReportPath,JSON.stringify(invalid));
    await assert.rejects(generatePlaygroundMixerDefaults(options),/WonderSwan|Mixer calibration source receipt/i);
    assert.equal(await readFile(outPath,'utf8'),valid,'rejected extension preserves the last valid System artifact');
  }
});

test('POKEY extends only its four measured routes while PS1, WonderSwan and historical gains remain exact',async()=>{
  const {historical,ps1Report}=await createPs1MixerCalibrationFixture(),{wsReport}=await createWonderSwanMixerCalibrationFixture();
  const {pokeyReport}=await createPokeyMixerCalibrationFixture();
  const before=structuredClone({historical,ps1Report,wsReport,pokeyReport});
  const legacy=buildPlaygroundMixerPolicy(historical,ps1Report,wsReport),policy=buildPlaygroundMixerPolicy(historical,ps1Report,wsReport,pokeyReport);
  const pokey=validatePokeyMixerCalibration(historical,pokeyReport);
  assert.equal(new Set([pokey.primaryVolume,pokey.extraVolume,pokey.dualFirstVolume,pokey.dualSecondVolume]).size,4,'fixture independently identifies all four role gains');
  assert.equal(policy.factoryDefaults.kinds.find(record=>record.name==='pokey').volume,pokey.extraVolume);
  assert.equal(entry(policy,'pokey','pokey').settings.volume,pokey.primaryVolume);
  assert.equal(entry(policy,'pokey-dual','pokey').settings.volume,pokey.dualFirstVolume);
  assert.equal(entry(policy,'pokey-dual','pokey:2').settings.volume,pokey.dualSecondVolume);
  assert.deepEqual(policy.calibration.extensions,{...legacy.calibration.extensions,pokey:pokey.metadata});
  assert.deepEqual(policy.calibration.unmeasuredKinds,[]);
  assert.deepEqual(policy.factoryDefaults.kinds.filter(record=>record.name!=='pokey'),legacy.factoryDefaults.kinds.filter(record=>record.name!=='pokey'));
  for(const [mode,settings]of Object.entries(legacy.factoryModes))if(!['pokey','pokey-dual'].includes(mode))assert.deepEqual(policy.factoryModes[mode],settings,mode);
  assert.deepEqual(policy.factoryEngines,legacy.factoryEngines);
  assert.equal(policy.calibration.targetAmplitude,legacy.calibration.targetAmplitude);
  assert.equal(policy.calibration.measuredExtraRoutes,22);assert.equal(policy.calibration.measuredPrimaryRoutes,28);
  assert.equal(buildPlaygroundMixerDefaults(historical).factoryDefaults.kinds.length,22);
  const independent=buildPlaygroundMixerPolicy(historical,undefined,undefined,pokeyReport);
  assert.deepEqual(independent.calibration.unmeasuredKinds,['wonderswan','ps1']);
  assert.deepEqual(Object.keys(independent.calibration.extensions),['pokey']);
  assert.equal(entry(independent,'ps1','ps1').settings.volume,1);assert.equal(entry(independent,'wonderswan','wonderswan').settings.volume,1);
  assert.deepEqual({historical,ps1Report,wsReport,pokeyReport},before,'independent measurements remain unchanged');
  for(const invalid of [null,{...pokeyReport,passed:false},{...pokeyReport,verify:true}])assert.throws(()=>buildPlaygroundMixerPolicy(historical,ps1Report,wsReport,invalid),/POKEY/i);
});

test('generated POKEY single, dual and additional-source gains apply once while authored numbers remain absolute',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'pokey-playground-defaults-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  await mkdir(join(directory,'playground'));await mkdir(join(directory,'js'));
  await copyFile(new URL('../web/soundchip_mixer.js',import.meta.url),join(directory,'js','soundchip_mixer.js'));
  const {historical,pokeyReport}=await createPokeyMixerCalibrationFixture();
  const modulePath=join(directory,'playground','defaults.mjs');
  await writeFile(modulePath,renderPlaygroundMixerDefaults(historical,undefined,undefined,pokeyReport));
  const generated=await import(pathToFileURL(modulePath)),pokey=validatePokeyMixerCalibration(historical,pokeyReport);
  assert(Object.isFrozen(generated.PLAYGROUND_MIXER_CALIBRATION.extensions.pokey));
  for(const [mode,firstVolume,secondVolume]of [['pokey',pokey.primaryVolume,pokey.extraVolume],['pokey-dual',pokey.dualFirstVolume,pokey.dualSecondVolume]]){
    const mixer=generated.createPlaygroundSoundChipMixer(mode),applied={};
    for(const id of ['pokey','pokey:2','additional'])mixer.register(id,'pokey',settings=>{applied[id]=settings.volume;});
    const measured={pokey:firstVolume,'pokey:2':secondVolume,additional:pokey.extraVolume};
    assert.deepEqual(applied,measured,'each endpoint receives its own measured absolute gain');
    assert.deepEqual(mixer.exportState(),{version:1,entries:[]});assert.deepEqual(mixer.exportDefaults(),{version:1,kinds:[]});
    mixer.setKindDefault('pokey',{volume:.6});mixer.set('pokey:2',{volume:.8});
    const state=mixer.exportState(),defaults=mixer.exportDefaults();
    for(let index=0;index<3;index++)mixer.restoreState(state,defaults);
    assert.deepEqual(applied,{pokey:.6,'pokey:2':.8,additional:.6},'common and per-ID authoring replaces the factory gain instead of multiplying it');
    for(let index=0;index<3;index++)mixer.restoreState({version:1,entries:[]},{version:1,kinds:[]});
    assert.deepEqual(applied,measured,'System restoration never applies calibration a second time');
    assert.deepEqual(mixer.exportState(),{version:1,entries:[]});assert.deepEqual(mixer.exportDefaults(),{version:1,kinds:[]});
  }
});

test('POKEY Playground generation validates complete source evidence before writing and has independent CLI controls',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'pokey-playground-generator-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const reportPath=join(directory,'historical.json'),pokeyReportPath=join(directory,'pokey.json'),outPath=join(directory,'defaults.js');
  const historicalBytes=await readFile(new URL('../docs/issues/playground_chip_levels_01.json',import.meta.url)),historical=JSON.parse(historicalBytes);
  const {pokeyReport}=await createPokeyMixerCalibrationFixture();
  await writeFile(reportPath,historicalBytes);await writeFile(pokeyReportPath,JSON.stringify(pokeyReport));
  const options={reportPath,pokeyReportPath,outPath},valid=renderPlaygroundMixerDefaults(historical,undefined,undefined,pokeyReport);
  const calibration=await generatePlaygroundMixerDefaults(options);
  assert.deepEqual(calibration,buildPlaygroundMixerPolicy(historical,undefined,undefined,pokeyReport).calibration);
  assert.equal(await readFile(outPath,'utf8'),valid);await generatePlaygroundMixerDefaults({...options,check:true});
  const script=fileURLToPath(new URL('./generate_playground_mixer_defaults.mjs',import.meta.url));
  for(const flags of [['--pokey-report',pokeyReportPath],[`--pokey-report=${pokeyReportPath}`]]){
    const result=spawnSync(process.execPath,[script,'--no-scsp','--no-ps1','--no-wonderswan',`--report=${reportPath}`,...flags,`--out=${outPath}`,'--check'],{encoding:'utf8'});
    assert.equal(result.status,0,result.stderr);
  }
  for(const flags of [['--no-pokey',`--pokey-report=${pokeyReportPath}`],[`--pokey-report=${pokeyReportPath}`,'--no-pokey']]){
    const result=spawnSync(process.execPath,[script,'--no-scsp','--no-ps1','--no-wonderswan',`--report=${reportPath}`,...flags,`--out=${outPath}`],{encoding:'utf8'});
    assert.notEqual(result.status,0);assert.match(result.stderr,/cannot be combined/);assert.equal(await readFile(outPath,'utf8'),valid);
  }
  for(const change of [report=>{report.passed=false;},report=>{report.rows.pop();},report=>{report.calibration.routes[0].volume*=.5;},report=>{report.sources['generated/pokey_wasm.wasm'].sha256='0'.repeat(64);}]){
    const invalid=structuredClone(pokeyReport);change(invalid);await writeFile(pokeyReportPath,JSON.stringify(invalid));
    await assert.rejects(generatePlaygroundMixerDefaults(options),/POKEY|served DSP\/WASM source changed/i);
    assert.equal(await readFile(outPath,'utf8'),valid,'rejected measurement preserves the valid System artifact');
  }
  const result=spawnSync(process.execPath,[script,'--no-scsp','--no-ps1','--no-wonderswan','--no-pokey',`--report=${reportPath}`,`--out=${outPath}`],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);assert.equal(await readFile(outPath,'utf8'),renderPlaygroundMixerDefaults(historical));
});

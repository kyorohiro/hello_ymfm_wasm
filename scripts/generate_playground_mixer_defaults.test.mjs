import test from 'node:test';
import assert from 'node:assert/strict';
import {copyFile,mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {
  PLAYGROUND_CALIBRATION_KINDS,PLAYGROUND_CALIBRATION_PRIMARIES,
  buildPlaygroundMixerDefaults,renderPlaygroundMixerDefaults,generatePlaygroundMixerDefaults,
} from './generate_playground_mixer_defaults.mjs';

function fixture() {
  const routes = [
    ...PLAYGROUND_CALIBRATION_KINDS.map(kind=>({kind,role:'extra',mode:'genesis',name:'calibration-source'})),
    ...PLAYGROUND_CALIBRATION_PRIMARIES.map(([mode,kind,name=kind])=>({kind,role:'primary',mode,name})),
  ].map((route,index)=>({...route,amplitude:route.kind==='spc'?.02:.1+index*.002}));
  const referenceAmplitude = routes.find(route=>route.role==='primary'&&route.mode==='genesis'&&route.kind==='ym2612').amplitude;
  const targetAmplitude = Math.min(referenceAmplitude,...routes.map(route=>route.amplitude*2));
  return {schemaVersion:1,passed:true,verify:false,engine:'chromium',frequencies:[220,440,880],
    rows:routes.flatMap(({name,...route})=>[220,440,880].map(frequencyHz=>({...route,frequencyHz,
      amplitude:route.amplitude*(frequencyHz===440?1:frequencyHz===220?1.01:.98),defaultCalibration:true,
      measuredAmplitude:route.amplitude*(route.kind==='spc'||route.kind==='snes'?.875:1),
      referencePeak:route.kind==='spc'||route.kind==='snes'?.875:1,
      mixer:{id:name,settings:{volume:1,pan:0,muted:false,solo:true}}}))),
    calibration:{referenceAmplitude,targetAmplitude,maxGain:2,targetReduced:targetAmplitude<referenceAmplitude,
      routes:routes.map(route=>({...route,volume:Number((targetAmplitude/route.amplitude).toFixed(6))}))},
  };
}
const row = (report,role,mode,kind) => report.calibration.routes.find(route=>route.role===role&&route.mode===mode&&route.kind===kind);
const entry = (profile,mode,id) => profile.factoryModes[mode].entries.find(entry=>entry.id===id);

test('a complete 147-capture baseline produces deterministic 440 Hz defaults including SPC',()=>{
  const report = fixture(), before = structuredClone(report), profile = buildPlaygroundMixerDefaults(report);
  assert.equal(report.rows.length,147); assert.equal(report.calibration.routes.length,49);
  assert.equal(profile.factoryDefaults.kinds.length,21);
  assert.equal(profile.factoryDefaults.kinds.find(kind=>kind.name==='spc').volume,2,'known SPC DSP reference contributes to System');
  assert.equal(profile.calibration.referenceFrequencyHz,440);
  assert.equal(profile.calibration.targetAmplitude,.04);
  assert.equal(profile.calibration.measuredExtraRoutes,21); assert.equal(profile.calibration.measuredPrimaryRoutes,28);
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

test('partial, verification, duplicate, silent and incorrectly identified measurements cannot replace System',()=>{
  const changes = [
    report=>{report.passed=false;}, report=>{report.verify=true;}, report=>{delete report.verify;},
    report=>{report.schemaVersion=2;}, report=>{report.frequencies=[440];},
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
  const modulePath = join(directory,'playground','defaults.mjs'), report = fixture(), profile = buildPlaygroundMixerDefaults(report);
  await writeFile(modulePath,renderPlaygroundMixerDefaults(report));
  const generated = await import(pathToFileURL(modulePath));
  assert.equal(generated.PLAYGROUND_MIXER_CALIBRATION.targetAmplitude,.04);
  assert(Object.isFrozen(generated.PLAYGROUND_MIXER_CALIBRATION.frequencies));
  const first = generated.createPlaygroundSoundChipMixer('genesis'), second = generated.createPlaygroundSoundChipMixer('genesis');
  first.register('segapsg','segapsg',()=>{}); first.register('extra','segapsg',()=>{});
  assert.equal(first.get('segapsg').volume,entry(profile,'genesis','segapsg').settings.volume);
  assert.equal(first.get('extra').volume,row(report,'extra','genesis','segapsg').volume);
  first.set('segapsg',{volume:.1234567});
  assert.equal(first.get('segapsg').volume,.1234567);
  assert.equal(second.get('segapsg').volume,entry(profile,'genesis','segapsg').settings.volume);
  assert.deepEqual(first.exportDefaults(),{version:1,kinds:[]});
  assert.deepEqual(first.exportState(),{version:1,entries:[{id:'segapsg',name:'segapsg',settings:{volume:.1234567}}]});
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
  let result = spawnSync(process.execPath,[script,'--report',reportPath,`--out=${outPath}`],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr); const expected = renderPlaygroundMixerDefaults(report);
  assert.equal(await readFile(outPath,'utf8'),expected);
  result=spawnSync(process.execPath,[script,`--report=${reportPath}`,'--out',outPath,'--check'],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  await writeFile(outPath,'keep this authored file');
  result=spawnSync(process.execPath,[script,`--report=${reportPath}`,`--out=${outPath}`,'--check'],{encoding:'utf8'});
  assert.notEqual(result.status,0);assert.match(result.stderr,/stale/);
  report.passed=false;await writeFile(reportPath,JSON.stringify(report));
  await assert.rejects(generatePlaygroundMixerDefaults({reportPath,outPath}),/successful, non-verification/);
  result=spawnSync(process.execPath,[script,`--report=${reportPath}`,`--out=${outPath}`],{encoding:'utf8'});
  assert.notEqual(result.status,0);assert.equal(await readFile(outPath,'utf8'),'keep this authored file');
  result=spawnSync(process.execPath,[script,`--out=${outPath}`],{encoding:'utf8'});
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
  const result = spawnSync(process.execPath,[script,`--report=${reportPath}`,`--out=${outPath}`,'--check'],{encoding:'utf8'});
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

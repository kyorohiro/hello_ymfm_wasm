import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {buildScspCalibrationReference} from './soundchip_calibration_scsp.mjs';
import {validateScspMixerCalibration,validateScspMixerCalibrationSources} from './scsp_mixer_calibration.mjs';
import {buildPlaygroundMixerPolicy,generatePlaygroundMixerDefaults} from './generate_playground_mixer_defaults.mjs';
import {buildSoundChipMixerPresets,generateSoundChipMixerPresets} from './generate_soundchip_mixer_presets.mjs';
import {SoundChipMixer} from '../web/soundchip_mixer.js';
const read=async path=>JSON.parse(await readFile(new URL('../'+path,import.meta.url),'utf8'));
const historical=await read('docs/issues/playground_chip_levels_01.json'),report=await read('docs/issues/scsp_chip_levels_01.json'),psg=await read('docs/issues/soundchip_psg_levels_04.json');
const reportPath=fileURLToPath(new URL('../docs/issues/playground_chip_levels_01.json',import.meta.url));
const scspReportPath=fileURLToPath(new URL('../docs/issues/scsp_chip_levels_01.json',import.meta.url));

test('SCSP reference declares full-scale signed PCM16, exact symmetry, physical route and quantized tuning',()=>{
 for(const role of ['primary','extra'])for(const hz of [220,440,880]){
  const r=buildScspCalibrationReference(hz,{role}),d=r.decodedReference;
  assert.equal(d.decodedMean,0);assert.equal(d.codecHeadroom,1);assert.equal(d.pcm.length,256);assert.equal(Math.max(...d.pcm),32767);assert.equal(Math.min(...d.pcm),-32767);
  assert(Math.abs(r.effectiveFrequencyHz/hz-1)<.001);assert(r.setup.includes(role==='primary'?"useSoundChip('scsp')":"createSoundChip('scsp'"));assert(r.setup.includes('totalLevel:0,directLevel:7,pan:0'));assert(r.setup.includes('keyOn(0)'));
 }
 assert.throws(()=>buildScspCalibrationReference(0));assert.throws(()=>buildScspCalibrationReference(440,{role:'unknown'}));
});

test('48 SCSP and eight anchor captures derive only the two canonical gains without changing history',async()=>{
 const before=JSON.stringify({historical,report}),result=await validateScspMixerCalibrationSources({reportPath,scspReport:report});
 assert.equal(result.primaryVolume,.128825);assert.equal(result.extraVolume,.128825);assert.equal(result.metadata.measuredSCSPCaptures,48);assert.equal(result.metadata.measuredAnchorCaptures,8);
 assert.equal(JSON.stringify({historical,report}),before);
 const legacy=buildPlaygroundMixerPolicy(historical),extended=buildPlaygroundMixerPolicy(historical,undefined,undefined,undefined,report);
 assert.deepEqual(extended.factoryDefaults.kinds.filter(x=>x.name!=='scsp'),legacy.factoryDefaults.kinds);
 const {scsp,...others}=extended.factoryModes;assert.deepEqual(others,legacy.factoryModes);assert.equal(scsp.entries[0].settings.volume,result.primaryVolume);
 const mixer=new SoundChipMixer({gainUnits:'source',factoryDefaults:extended.factoryDefaults,factoryEntries:scsp});mixer.register('scsp','scsp',()=>{});mixer.register('extra','scsp',()=>{});
 assert.equal(mixer.get('scsp').volume,result.primaryVolume);assert.equal(mixer.get('extra').volume,result.extraVolume);
 mixer.set('scsp',{volume:.37});assert.equal(mixer.get('scsp').volume,.37,'authored gain is absolute');
 const oldNpm=buildSoundChipMixerPresets(historical,psg),newNpm=buildSoundChipMixerPresets(historical,psg,undefined,undefined,undefined,report);
 assert.deepEqual(newNpm.calibrated.factoryDefaults.kinds.filter(x=>x.name!=='scsp'),oldNpm.calibrated.factoryDefaults.kinds);
 assert.equal(newNpm.calibrated.factoryDefaults.kinds.find(x=>x.name==='scsp').volume,result.extraVolume);
});

test('partial, mistuned, clipped, reordered, normalized and edited-gain reports fail closed',()=>{
 for(const mutate of [r=>r.rows.pop(),r=>r.anchors.pop(),r=>r.rows[1]=r.rows[0],r=>r.verify=true,r=>r.calibration.targetChanged=true,
  r=>r.rows[0].referencePeak=.25,r=>r.rows[0].expectedFrequencyHz=1,r=>r.rows[0].pcm.channels[0].overrange=1,
  r=>r.rows[0].pcm.pilot.continuous=false,r=>r.rows[0].stopped.channels[0].nonzero=1,r=>r.rows[0].mixer.settings.volume=.5,
  r=>r.calibration.routes[0].volume=2,r=>r.rows[0].sourceSha256='0'.repeat(64),r=>delete r.sources['generated/scsp_wasm.wasm']]){
  const bad=structuredClone(report);mutate(bad);assert.throws(()=>validateScspMixerCalibration(historical,bad),/SCSP Mixer calibration/);
 }
});

test('both generators check SCSP source provenance before writing; CLI opt-out and flag conflicts are independent',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'scsp-policy-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const extension=join(directory,'report.json'),outPath=join(directory,'out.js');
 for(const [name,generate]of [['generate_playground_mixer_defaults.mjs',generatePlaygroundMixerDefaults],['generate_soundchip_mixer_presets.mjs',generateSoundChipMixerPresets]]){
  const options={reportPath,scspReportPath:extension,outPath};await writeFile(extension,JSON.stringify(report));await generate(options);const good=await readFile(outPath,'utf8');await generate({...options,check:true});
  for(const mutate of [r=>r.sources['generated/scsp_wasm.wasm'].sha256='0'.repeat(64),r=>r.scripts['scripts/soundchip_calibration_scsp.mjs']='0'.repeat(64),r=>r.rows.pop()]){
   const bad=structuredClone(report);mutate(bad);await writeFile(extension,JSON.stringify(bad));await assert.rejects(generate(options),/SCSP Mixer calibration/);assert.equal(await readFile(outPath,'utf8'),good);
  }
  const script=fileURLToPath(new URL('./'+name,import.meta.url)),flags=['--no-ps1','--no-wonderswan','--no-pokey',`--report=${reportPath}`,`--out=${outPath}`];
  await writeFile(extension,JSON.stringify(report));let run=spawnSync(process.execPath,[script,...flags,`--scsp-report=${extension}`,'--check'],{encoding:'utf8'});assert.equal(run.status,0,run.stderr);
  run=spawnSync(process.execPath,[script,...flags,'--no-scsp',`--scsp-report=${extension}`],{encoding:'utf8'});assert.notEqual(run.status,0);assert.match(run.stderr,/cannot be combined/);assert.equal(await readFile(outPath,'utf8'),good);
  run=spawnSync(process.execPath,[script,...flags,'--no-scsp'],{encoding:'utf8'});assert.equal(run.status,0,run.stderr);assert.notEqual(await readFile(outPath,'utf8'),good);
 }
});

test('generated SCSP gains pass an independent complete 48-route policy verification with unchanged anchors and silence after Stop',async()=>{
 const verify=await read('docs/issues/scsp_chip_levels_verify_01.json');
 assert.equal(verify.passed,true);assert.equal(verify.verify,true);assert.equal(verify.completeCoverage,true);assert.equal(verify.rows.length,48);assert.equal(verify.anchors.length,8);
 assert.deepEqual(verify.baseline,report.baseline);assert.deepEqual(verify.scripts,report.scripts);assert.deepEqual(verify.sources,report.sources);assert.deepEqual(verify.calibration,report.calibration);
 assert.equal(verify.physicalOutputMuted,true);assert.equal(verify.listeningPerformed,false);assert.equal(verify.pcmContinuous,true);
 for(const row of verify.rows){
  const raw=report.rows.find(r=>['engine','requestedSampleRate','execution','role','frequencyHz'].every(k=>r[k]===row[k]));assert(raw);
  const volume=report.calibration.routes.find(r=>r.role===row.role).volume;assert.equal(row.mixer.settings.volume,volume);
  assert(Math.abs(row.amplitude/(raw.amplitude*volume)-1)<.025);assert(row.channelRmsRelativeErrors.every(e=>e<.025));
  assert(row.pcm.pilot.continuous&&row.stopped.pilot.continuous);assert(row.stopped.channels.every(c=>c.nonzero===0));
 }
});

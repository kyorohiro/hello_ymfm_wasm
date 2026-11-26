import {historicalCalibrationModule} from '../test/helpers/historical_calibration_modules.mjs';
import {createHistoricalGitReader} from '../test/helpers/historical_calibration_git_reader.mjs';
import {renderPlaygroundMixerDefaults} from './generate_playground_mixer_defaults.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp, mkdir, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import vm from 'node:vm';
// Historical source pairs and their mutations use their full reviewed tree.
const sourceCommit = '03ef198984e4a5bdf4e19c65b72244a218474f70';
const readFileSync = createHistoricalGitReader(sourceCommit);
const {restoreMixerCalibrationSidRevision,SID_PLAYGROUND_REVISION_BASE_COMMIT:commit,SID_PLAYGROUND_REVISION_RECEIPT_PATH:receiptPath,SID_PLAYGROUND_REVISION_RECEIPT_OBJECT_SHA256:pin,SID_PLAYGROUND_REVISION_SOURCE_PATHS:paths,SID_PLAYGROUND_REVISION_REPORT_PATHS:reports}=await historicalCalibrationModule('mixer_calibration_sid_revision.mjs',{sourceCommit});
const {assertMixerCalibrationSourceFreshness}=await historicalCalibrationModule('mixer_calibration_sources.mjs',{sourceCommit});
const aySpcCommit = '39c8f1e024dd8727c75bb764d2630605092e5677';
const {validatePs1MixerCalibrationSources}=await historicalCalibrationModule('ps1_mixer_calibration.mjs',{sourceCommit:aySpcCommit});
const {validateWonderSwanMixerCalibrationSources}=await historicalCalibrationModule('wonderswan_mixer_calibration.mjs',{sourceCommit:aySpcCommit});
const {validatePokeyMixerCalibrationSources}=await historicalCalibrationModule('pokey_mixer_calibration.mjs',{sourceCommit:aySpcCommit});
const {validateScspMixerCalibrationSources}=await historicalCalibrationModule('scsp_mixer_calibration.mjs',{sourceCommit:aySpcCommit});

const root=fileURLToPath(new URL('../',import.meta.url));
const read=async path=>readFileSync(join(root,path));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const receipt=JSON.parse(await read(receiptPath));
// Independent object hash of the pre-SID policy generated at the fixed base commit.
const PRE_SID_POLICY_OBJECT_SHA256='779a3c0106e5c4b9e1e9921601eb759f1f680b38bd1a719c33edfc9cf9d55453';

test('SID 8580 revision preserves the first receipt, all pre-SID source bodies and the four measurements',async()=>{
  const previous=JSON.parse(await read('docs/issues/sid_playground_source_revision_01.json'));
  assert.equal(sha(JSON.stringify(previous)),'2d4cbe13e301e1629f6cce281b0013f40235432ebf8080ae5d8166ed370256db');
  assert.deepEqual(receipt.reports,previous.reports);assert.equal(receipt.baseCommit,previous.baseCommit);
  const changed=[];
  for(const path of paths){
    assert.deepEqual(receipt.sources[path].before,previous.sources[path].before,path);
    if(JSON.stringify(receipt.sources[path].after)!==JSON.stringify(previous.sources[path].after))changed.push(path);
    else assert.deepEqual(receipt.sources[path],previous.sources[path],path);
  }
  assert.deepEqual(changed,['js/playground_runtime.js','js/playground_soundchip_options.js']);
});

test('SID receipt authenticates all 20 complete source pairs and reconstructs the pinned pre-SID commit',async()=>{
  assert.equal(sha(JSON.stringify(receipt)),pin);assert.equal(receipt.baseCommit,commit);
  assert.deepEqual(Object.keys(receipt.sources).sort(),[...paths].sort());
  for(const path of paths){
    const entry=receipt.sources[path],bytes=await read('docs/'+path);
    assert.equal(bytes.length,entry.after.bytes,path);assert.equal(sha(bytes),entry.after.sha256,path);
    const restored=restoreMixerCalibrationSidRevision(path,bytes);
    assert.equal(restored.length,entry.before.bytes,path);assert.equal(sha(restored),entry.before.sha256,path);
    assert.equal(assertMixerCalibrationSourceFreshness({path,bytes,record:entry.before}),'sid-playground-routing',path);
    assert.equal(assertMixerCalibrationSourceFreshness({path,bytes,record:entry.after}),'raw','a future exact measurement needs no historical exception');
    assert.equal(restoreMixerCalibrationSidRevision(path,restored),restored,'already pre-SID bytes need no exception');
  }
});

test('same-length one-byte and appended edits cannot use the SID exception',async()=>{
  for(const path of paths){
    const bytes=await read('docs/'+path),first=Buffer.from(bytes),middle=Buffer.from(bytes);first[0]^=1;middle[Math.floor(middle.length/2)]^=1;
    for(const changed of [first,middle,Buffer.concat([bytes,Buffer.from('\n')])]){
      assert.equal(restoreMixerCalibrationSidRevision(path,changed),changed,path);
      assert.throws(()=>assertMixerCalibrationSourceFreshness({path,bytes:changed,record:receipt.sources[path].before}),/source changed; remeasure/,path);
    }
  }
});

test('gain policy, renderers, codecs and WASM cannot borrow a SID routing source pair',async()=>{
  const bytes=await read('docs/js/playground_runtime.js'),record=receipt.sources['js/playground_runtime.js'].before;
  for(const path of ['js/soundchip_mixer.js','js/soundchip_mixer_presets.js','playground/playground_mixer_defaults.js',
    'js/ps1synth.js','js/scspsynth.js','js/wonderswanaudioengine.js','js/pokeyaudioengine.js','js/ym2612-worklet.js',
    'generated/ps1_spu_wasm.wasm','generated/scsp_wasm.wasm','generated/sid/sid.wasm']){
    assert.equal(restoreMixerCalibrationSidRevision(path,bytes),bytes,path);
    assert.throws(()=>assertMixerCalibrationSourceFreshness({path,bytes,record}),/source changed; remeasure/,path);
  }
});

test('changing the receipt cannot authorize a new after body without changing the independent helper pin',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'tetorica-sid-receipt-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const helper=join(directory,'scripts/mixer_calibration_sid_revision.mjs'),json=join(directory,receiptPath);
  await mkdir(dirname(helper),{recursive:true});await mkdir(dirname(json),{recursive:true});
  await writeFile(helper,await read('scripts/mixer_calibration_sid_revision.mjs'));
  const changed=structuredClone(receipt);changed.sources[paths[0]].after.sha256='0'.repeat(64);await writeFile(json,JSON.stringify(changed));
  const isolated=await import(pathToFileURL(helper));
  assert.throws(()=>isolated.restoreMixerCalibrationSidRevision(paths[0],Buffer.alloc(1)),/independently pinned SHA/);
});

test('all four historical reports retain their gains and require fresh evidence after AY output and SPC voice editing',async()=>{
  const baselinePath=join(root,'docs/issues/playground_chip_levels_01.json');
  assert.equal(sha(readFileSync(baselinePath)),'9c5129ad176aa4895ff14da345dc0f3ac49588f5255062fa76329b21f28ea234');
  const validators=[['ps1Report',validatePs1MixerCalibrationSources],['wsReport',validateWonderSwanMixerCalibrationSources],['pokeyReport',validatePokeyMixerCalibrationSources],['scspReport',validateScspMixerCalibrationSources]];
  for(let index=0;index<reports.length;index++){
    const path=reports[index],bytes=await read(path),report=JSON.parse(bytes),original=JSON.stringify(report),[parameter,validate]=validators[index];
    assert.equal(bytes.length,receipt.reports[path].bytes);assert.equal(sha(bytes),receipt.reports[path].sha256);
    await assert.rejects(validate({reportPath:baselinePath,[parameter]:report}),/source changed; remeasure: (?:docs\/)?js\/(?:ay8910|playground_spc_audio)\.js/);
    assert(report.calibration.routes.every(route=>route.volume>0));
    assert.equal(JSON.stringify(report),original);assert.deepEqual(await read(path),bytes);
  }
});

function policy(source){
  const code=source.toString().replace(/^import .*;\n/gm,'').replace(/^export /gm,'');
  return JSON.parse(vm.runInNewContext(code+'\nJSON.stringify({factoryDefaults,factoryEngines,factoryModes,calibration:PLAYGROUND_MIXER_CALIBRATION,listening:PLAYGROUND_MIXER_LISTENING_LEVELS});'));
}
test('the historical SID policy reproduces every earlier source/listening gain and adds only unmeasured SID unity',async()=>{
  const historical=JSON.parse(await read('docs/issues/playground_chip_levels_01.json'));
  const measurements=await Promise.all(reports.map(async path=>JSON.parse(await read(path))));
  const after=policy(Buffer.from(renderPlaygroundMixerDefaults(historical,...measurements)));
  assert.deepEqual(after.factoryDefaults.kinds.find(entry=>entry.name==='sid'),{name:'sid',volume:1});
  after.factoryDefaults.kinds=after.factoryDefaults.kinds.filter(entry=>entry.name!=='sid');
  assert.deepEqual(after.factoryModes.c64,{version:1,entries:[{id:'sid',name:'sid',settings:{volume:1}}]});
  delete after.factoryModes.c64;
  assert(after.calibration.unmeasuredKinds.includes('sid'));after.calibration.unmeasuredKinds=after.calibration.unmeasuredKinds.filter(name=>name!=='sid');
  // Reconstruct the pre-SID policy, which predates the DX7 listening boost.
  assert.equal(after.listening.dx7,2.2);
  delete after.listening.dx7;
  for(const [role,settings] of [
    ['extra',after.factoryDefaults.kinds.find(entry=>entry.name==='dx7')],
    ['primary',after.factoryModes.dx7.entries[0].settings],
  ]) {
    assert.equal(settings.volume,2.2);
    settings.volume=historical.calibration.routes.find(route=>route.kind==='dx7'&&route.role===role).volume;
  }
  assert.equal(sha(JSON.stringify(after)),PRE_SID_POLICY_OBJECT_SHA256,'all earlier targets, source/listening gains, engine gains and routes must remain exact');
});

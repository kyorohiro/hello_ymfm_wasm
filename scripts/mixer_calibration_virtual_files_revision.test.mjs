import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {assertMixerCalibrationSourceFreshness,isMixerCalibrationVirtualFilesRevision} from './mixer_calibration_sources.mjs';
import {validatePs1MixerCalibrationSources} from './ps1_mixer_calibration.mjs';
import {validateWonderSwanMixerCalibrationSources} from './wonderswan_mixer_calibration.mjs';
import {validatePokeyMixerCalibrationSources} from './pokey_mixer_calibration.mjs';
import {validateScspMixerCalibrationSources} from './scsp_mixer_calibration.mjs';

const root=new URL('../',import.meta.url),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const read=path=>readFile(new URL(path,root));
const sources={
  'js/tetorica_virtual_files/git.bundle.js':{
    bytes:298711,sha256:'48bf6973ab36ecb1824c4b52c9e958d1d626b6796a47c0cf4d9b9e5f34ef89d1',
  },
  'js/tetorica_virtual_files/shell.js':{
    bytes:11716,sha256:'a542bdeffd9853d43b28a453fcd973963f96c3c078079437383ef6c1565633ed',
  },
};
const reports=[
  ['docs/issues/ps1_loop_fm_chip_levels_01.json','b6f09a1776d093387b1acfcf993802bf24b100f5cd680230ed6f3a4d03b16485','ps1Report',validatePs1MixerCalibrationSources],
  ['docs/issues/wonderswan_scsp_fm_chip_levels_01.json','cf278b1bbdb2d467350940febf3d5e30c6894415c99292a369df696c1d15fa13','wsReport',validateWonderSwanMixerCalibrationSources],
  ['docs/issues/pokey_scsp_fm_chip_levels_01.json','39694895de4b51c1f784be7e4263e99848d25a2e1c14bd1ef0721ecbed718ede','pokeyReport',validatePokeyMixerCalibrationSources],
  ['docs/issues/scsp_fm_chip_levels_01.json','c123f6cd0c1d1aa4019fd86d4d3e561ea63853534c0bd1aa326d37a514e9e9af','scspReport',validateScspMixerCalibrationSources],
];
const immutable={
  'docs/issues/playground_chip_levels_01.json':'9c5129ad176aa4895ff14da345dc0f3ac49588f5255062fa76329b21f28ea234',
  ...Object.fromEntries(reports.map(([path,hash])=>[path,hash])),
  'docs/playground/playground_mixer_defaults.js':'1cc57e78a582ea9010a7ca5fda86d9f24344d5786c99a6ba1e6ebc164b19453a',
  'docs/js/soundchip_mixer_presets.js':'acd83313d9488212e1f69cf0fcc0701cd0b644f5cefbd39c36994f3d23f08a56',
  'tetorica_src/runtime/soundchip_mixer_presets.js':'57ce08eda7e67938dc3301d8259b9f1c3ab38faa66dd989227d5af64064d371f',
};

test('the exact reviewed Git and Shell revisions preserve all four complete measurements and generated gain bytes',async()=>{
  for(const [path,expected]of Object.entries(immutable))assert.equal(sha(await read(path)),expected,path);
  for(const [reportPath,,parameter,validate]of reports){
    const report=JSON.parse(await read(reportPath)),original=JSON.stringify(report);
    for(const [path,record]of Object.entries(sources)){
      assert.deepEqual(report.sources[path],record,path);
      const bytes=await read('docs/'+path);
      assert.equal(isMixerCalibrationVirtualFilesRevision(path,bytes,record),true,path);
      assert.equal(assertMixerCalibrationSourceFreshness({path,bytes,record,report}),'ui-virtual-files',path);
    }
    await validate({reportPath:new URL('docs/issues/playground_chip_levels_01.json',root),[parameter]:report});
    assert.equal(JSON.stringify(report),original,'Validation must retain every captured result and original source hash');
  }
  for(const [path,expected]of Object.entries(immutable))assert.equal(sha(await read(path)),expected,'Validation must not rewrite '+path);
});

test('a one-byte, same-length or appended Git/Shell edit cannot use the reviewed exception',async()=>{
  for(const [path,record]of Object.entries(sources)){
    const bytes=await read('docs/'+path),firstByte=Buffer.from(bytes),middleByte=Buffer.from(bytes);
    firstByte[0]^=1;middleByte[Math.floor(middleByte.length/2)]^=1;
    for(const changed of [firstByte,middleByte,Buffer.concat([bytes,Buffer.from('\n')])]){
      assert.equal(isMixerCalibrationVirtualFilesRevision(path,changed,record),false,path);
      assert.throws(()=>assertMixerCalibrationSourceFreshness({path,bytes:changed,record}),/source changed; remeasure/);
    }
  }
});

test('the reviewed Git/Shell bytes require their exact measured before records',async()=>{
  for(const [path,record]of Object.entries(sources)){
    const bytes=await read('docs/'+path);
    for(const changed of [undefined,{}, {...record,bytes:record.bytes+1},{...record,sha256:'0'.repeat(64)}]){
      assert.equal(isMixerCalibrationVirtualFilesRevision(path,bytes,changed),false,path);
      assert.throws(()=>assertMixerCalibrationSourceFreshness({path,bytes,record:changed}),/source changed; remeasure/);
    }
  }
});

test('the Git/Shell exception cannot authorize another UI, transport, DSP or WASM source',async()=>{
  const [source,record]=Object.entries(sources)[0],bytes=await read('docs/'+source);
  for(const path of ['js/tetorica_virtual_files/git.js','playground/playground.js','js/playground_performance_processor.js','js/ps1synth.js','generated/ps1_spu_wasm.js','generated/ps1_spu_wasm.wasm','generated/scsp_wasm.wasm']){
    assert.equal(isMixerCalibrationVirtualFilesRevision(path,bytes,record),false,path);
    assert.throws(()=>assertMixerCalibrationSourceFreshness({path,bytes,record}),/source changed; remeasure/);
  }
});

import {historicalCalibrationModule} from '../test/helpers/historical_calibration_modules.mjs';
import {createHistoricalGitReader} from '../test/helpers/historical_calibration_git_reader.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
// Historical source pairs and their mutations use their full reviewed tree.
const sourceCommit = 'b0830d6b0c3a9f5fed3d3f07b4570ba33ec9e4ea';
const readFileSync = createHistoricalGitReader(sourceCommit);
const {isMixerCalibrationVirtualFilesWorkspaceRevision:accepts,VIRTUAL_FILES_WORKSPACE_RECEIPT:receiptPath,VIRTUAL_FILES_WORKSPACE_PIN:pin}=await historicalCalibrationModule('mixer_calibration_virtual_files_workspace_revision.mjs',{sourceCommit});
const {assertMixerCalibrationSourceFreshness:fresh}=await historicalCalibrationModule('mixer_calibration_sources.mjs',{sourceCommit});
const {validatePs1MixerCalibrationSources}=await historicalCalibrationModule('ps1_mixer_calibration.mjs',{sourceCommit});
const {validateWonderSwanMixerCalibrationSources}=await historicalCalibrationModule('wonderswan_mixer_calibration.mjs',{sourceCommit});
const {validatePokeyMixerCalibrationSources}=await historicalCalibrationModule('pokey_mixer_calibration.mjs',{sourceCommit});
const {validateScspMixerCalibrationSources}=await historicalCalibrationModule('scsp_mixer_calibration.mjs',{sourceCommit});
import {createVirtualFileSystem} from '../docs/js/tetorica_virtual_files/filesystem.js';
const url=p=>new URL('../'+p,import.meta.url),read=p=>readFileSync(url(p)),sha=b=>createHash('sha256').update(b).digest('hex');
const receipt=JSON.parse(read(receiptPath));

test('exact non-audio workspace transition preserves all four complete calibration reports',async()=>{
  assert.equal(sha(JSON.stringify(receipt)),pin);
  for(const [path,entry]of Object.entries(receipt.sources)){
    const bytes=read('docs/'+path);assert(accepts(path,bytes,entry.before));
    assert.equal(fresh({path,bytes,record:entry.before}),'ui-virtual-files-workspace');
    const old=execFileSync('git',['show',receipt.reviewedCommit+'^:docs/'+path],{maxBuffer:1024*1024});
    assert.equal(old.length,entry.before.bytes);assert.equal(sha(old),entry.before.sha256);
  }
  for(const [kind,key,validate]of [['ps1','ps1Report',validatePs1MixerCalibrationSources],['wonderswan','wsReport',validateWonderSwanMixerCalibrationSources],['pokey','pokeyReport',validatePokeyMixerCalibrationSources],['scsp','scspReport',validateScspMixerCalibrationSources]]){
    const name=`docs/issues/${kind}_ym2608_source_mix_chip_levels_01.json`,bytes=read(name),report=JSON.parse(bytes);
    await validate({reportPath:url('docs/issues/playground_chip_levels_01.json'),[key]:report});
    assert.equal(sha(read(name)),sha(bytes),'validation never rewrites measurement evidence');
  }
});

test('future bodies, altered measured records and unrelated sources receive no workspace exemption',()=>{
  for(const [path,entry]of Object.entries(receipt.sources)){
    const bytes=read('docs/'+path),changed=Buffer.from(bytes);changed[Math.floor(bytes.length/2)]^=1;
    for(const value of [changed,Buffer.concat([bytes,Buffer.from('\n')])])assert(!accepts(path,value,entry.before));
    for(const record of [undefined,{}, {...entry.before,bytes:entry.before.bytes+1},{...entry.before,sha256:'0'.repeat(64)}])assert(!accepts(path,bytes,record));
    for(const other of ['js/ps1synth.js','generated/ps1_spu_wasm.wasm','playground/playground.js','__proto__'])assert(!accepts(other,bytes,entry.before));
  }
});

test('every reviewed dependency and historical report is authenticated, including newly imported workspace modules',()=>{
  const [target,entry]=Object.entries(receipt.sources)[0],bytes=read('docs/'+target);
  for(const path of [...Object.keys(receipt.dependencies),...Object.keys(receipt.reports),receiptPath]){
    assert.throws(()=>accepts(target,bytes,entry.before,{readSource(location){
      const original=readFileSync(location);if(location.href!==url(path).href)return original;
      if(path===receiptPath){const forged=structuredClone(receipt);delete forged.dependencies['docs/js/tetorica_virtual_files/workspace.js'];return Buffer.from(JSON.stringify(forged));}
      return Buffer.concat([original,Buffer.from('\n')]);
    }}),/pin changed|dependency changed/,path);
  }
});

test('existing filesystem operations retain exact snapshot, revision and notification behavior against the actual predecessor',async()=>{
  const name='docs/js/tetorica_virtual_files/filesystem.js';
  const old=execFileSync('git',['show',receipt.reviewedCommit+'^:'+name],{maxBuffer:1024*1024}).toString()
    .replace(/from '(\.\/[^']+)'/g,(_all,path)=>`from '${new URL(path,url(name)).href}'`);
  const previous=(await import('data:text/javascript;base64,'+Buffer.from(old).toString('base64'))).createVirtualFileSystem;
  for(const autoCheckpoint of [false,true]){
    const a=previous([],{autoCheckpoint}),b=createVirtualFileSystem([],{autoCheckpoint});let eventsA=0,eventsB=0;
    a.onDidChange(()=>eventsA++);b.onDidChange(()=>eventsB++);
    for(let i=0;i<80;i++){
      for(const fs of [a,b]){const path='/file'+i%7+'.js';if(i%3===0)fs.writeBinary(path,Uint8Array.of(i,255-i));else fs.writeText(path,'revision '+i);}
      assert.deepEqual(b.snapshot(),a.snapshot());assert.equal(eventsB,eventsA);
      for(let j=0;j<7;j++)assert.equal(b.getRevision('/file'+j+'.js'),a.getRevision('/file'+j+'.js'));
    }
    for(const fs of [a,b]){const snapshot=fs.snapshot();fs.mkdir('/empty');fs.restore(snapshot);}
    assert.deepEqual(b.snapshot(),a.snapshot());assert.equal(eventsB,eventsA);
  }
});

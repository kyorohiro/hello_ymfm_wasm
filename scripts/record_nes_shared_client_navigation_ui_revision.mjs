/** Record only the reviewed passive NES shared-client implementation link. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {restoreMixerCalibrationScspNavigationRevision} from './mixer_calibration_scsp_navigation_revision.mjs';
import {NES_NAVIGATION_REVISION_PATH as path,NES_NAVIGATION_REVISION_BASE_COMMIT as baseCommit,
  NES_NAVIGATION_REVISION_RECEIPT_PATH as destination,NES_NAVIGATION_REVISION_INSERTION as removedText,
  NES_NAVIGATION_PREDECESSOR_RECEIPT_PATH,NES_NAVIGATION_PREDECESSOR_RECEIPT_OBJECT_SHA256} from './mixer_calibration_nes_navigation_revision.mjs';
import {MEASURED_POLICY_REVISION_RECEIPT_PATH,MEASURED_POLICY_REVISION_RECEIPT_OBJECT_SHA256} from './mixer_calibration_measured_policy_revision.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const record=bytes=>({bytes:bytes.length,sha256:sha(bytes)});
const historical=name=>execFileSync('git',['show',baseCommit+':'+name],{cwd:root,maxBuffer:4*1024*1024});
export async function createNesSharedClientNavigationUiReceipt({readSource=readFile}={}){
  const before=historical('docs/'+path),after=restoreMixerCalibrationScspNavigationRevision(path,await readSource(resolve(root,'docs/'+path)));
  const offset=after.indexOf(removedText);
  assert(offset>=0&&after.indexOf(removedText,offset+1)===-1,'One exact passive insertion is required');
  assert.deepEqual(Buffer.concat([after.subarray(0,offset),after.subarray(offset+Buffer.byteLength(removedText))]),before,
    'Only the reviewed NES source-navigation lines may change');
  const predecessorBytes=await readSource(resolve(root,NES_NAVIGATION_PREDECESSOR_RECEIPT_PATH));
  assert.deepEqual(predecessorBytes,historical(NES_NAVIGATION_PREDECESSOR_RECEIPT_PATH),'The predecessor receipt must remain unchanged');
  const predecessor=JSON.parse(predecessorBytes);
  assert.equal(sha(JSON.stringify(predecessor)),NES_NAVIGATION_PREDECESSOR_RECEIPT_OBJECT_SHA256);
  assert.deepEqual(record(before),predecessor.after,'The complete predecessor must match its independent receipt');
  const measured=JSON.parse(await readSource(resolve(root,MEASURED_POLICY_REVISION_RECEIPT_PATH),'utf8'));
  assert.equal(sha(JSON.stringify(measured)),MEASURED_POLICY_REVISION_RECEIPT_OBJECT_SHA256);
  assert.deepEqual(measured.reports,predecessor.reports);
  for(const [name,expected]of Object.entries(measured.reports)){
    const bytes=await readSource(resolve(root,name));
    assert.deepEqual(bytes,historical(name),'Original measurements must remain unchanged');
    assert.deepEqual(record(bytes),expected,'Measurement must match its independent receipt');
    assert.deepEqual(JSON.parse(bytes).sources[path],predecessor.before,'Every measured source must match the preceding navigation layer');
  }
  return{schemaVersion:1,scope:'nes-passive-shared-client-source-navigation',path,baseCommit,
    before:record(before),after:record(after),reports:measured.reports,afterOffset:offset,removedText};
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  const args=process.argv.slice(2);
  if(args.length!==1||!['--write','--check'].includes(args[0]))throw Error('Usage: node scripts/record_nes_shared_client_navigation_ui_revision.mjs --write | --check');
  const receipt=await createNesSharedClientNavigationUiReceipt(),text=JSON.stringify(receipt,null,2)+'\n';
  if(args[0]==='--write')await writeFile(resolve(root,destination),text);
  else assert.equal(await readFile(resolve(root,destination),'utf8'),text,'NES navigation receipt differs');
  console.log('NES shared-client navigation receipt object SHA256 '+sha(JSON.stringify(receipt)));
}

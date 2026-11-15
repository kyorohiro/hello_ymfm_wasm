/** Record the reviewed ASWAN source-navigation additions and their predecessor. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {ASWAN_NAVIGATION_REVISION_PATH as path,ASWAN_NAVIGATION_REVISION_BASE_COMMIT as baseCommit,
  ASWAN_NAVIGATION_REVISION_RECEIPT_PATH as destination,ASWAN_NAVIGATION_REVISION_INSERTIONS,
  ASWAN_NAVIGATION_PREDECESSOR_RECEIPT_PATH,ASWAN_NAVIGATION_PREDECESSOR_RECEIPT_OBJECT_SHA256} from './mixer_calibration_aswan_navigation_revision.mjs';
import {MEASURED_POLICY_REVISION_RECEIPT_PATH,MEASURED_POLICY_REVISION_RECEIPT_OBJECT_SHA256} from './mixer_calibration_measured_policy_revision.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const record=bytes=>({bytes:bytes.length,sha256:sha(bytes)});
const historical=name=>execFileSync('git',['show',baseCommit+':'+name],{cwd:root,maxBuffer:4*1024*1024});
export async function createAswanSharedClientNavigationUiReceipt(){
  const before=historical('docs/'+path),after=await readFile(resolve(root,'docs/'+path));
  const insertions=ASWAN_NAVIGATION_REVISION_INSERTIONS.map(removedText=>{
    const afterOffset=after.indexOf(removedText);
    assert(afterOffset>=0&&after.indexOf(removedText,afterOffset+1)===-1,'One occurrence of each reviewed insertion is required');
    return{afterOffset,removedText};
  });
  let restored=Buffer.from(after);
  for(const {afterOffset,removedText}of [...insertions].reverse())
    restored=Buffer.concat([restored.subarray(0,afterOffset),restored.subarray(afterOffset+Buffer.byteLength(removedText))]);
  assert.deepEqual(restored,before,'Only the reviewed ASWAN source-navigation lines may change');
  const predecessorBytes=await readFile(resolve(root,ASWAN_NAVIGATION_PREDECESSOR_RECEIPT_PATH));
  assert.deepEqual(predecessorBytes,historical(ASWAN_NAVIGATION_PREDECESSOR_RECEIPT_PATH),'The predecessor receipt must match its historical bytes');
  const predecessor=JSON.parse(predecessorBytes);
  assert.equal(sha(JSON.stringify(predecessor)),ASWAN_NAVIGATION_PREDECESSOR_RECEIPT_OBJECT_SHA256);
  assert.deepEqual(record(before),predecessor.after,'The complete predecessor must match its independent receipt');
  const measured=JSON.parse(await readFile(resolve(root,MEASURED_POLICY_REVISION_RECEIPT_PATH),'utf8'));
  assert.equal(sha(JSON.stringify(measured)),MEASURED_POLICY_REVISION_RECEIPT_OBJECT_SHA256);
  assert.deepEqual(measured.reports,predecessor.reports);
  for(const [name,expected]of Object.entries(measured.reports)){
    const bytes=await readFile(resolve(root,name));
    assert.deepEqual(bytes,historical(name),'Original measurements must match their historical bytes');
    assert.deepEqual(record(bytes),expected,'Measurement must match its independent receipt');
  }
  return{schemaVersion:1,scope:'aswan-passive-shared-client-source-navigation',path,baseCommit,
    before:record(before),after:record(after),reports:measured.reports,insertions};
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  const args=process.argv.slice(2);
  if(args.length!==1||!['--write','--check'].includes(args[0]))throw Error('Usage: node scripts/record_aswan_shared_client_navigation_ui_revision.mjs --write | --check');
  const receipt=await createAswanSharedClientNavigationUiReceipt(),text=JSON.stringify(receipt,null,2)+'\n';
  if(args[0]==='--write')await writeFile(resolve(root,destination),text);
  else assert.equal(await readFile(resolve(root,destination),'utf8'),text,'ASWAN navigation receipt differs');
  console.log('ASWAN shared-client navigation receipt object SHA256 '+sha(JSON.stringify(receipt)));
}

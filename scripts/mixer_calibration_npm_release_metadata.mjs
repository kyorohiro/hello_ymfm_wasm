// SPDX-License-Identifier: BSD-3-Clause
// Only reviewed npm 0.2.46 READMEs, version and payload-checker edits restore.
// Runtime, binary, measured gain and historical evidence bytes are untouched.
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {relative} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=new URL('../',import.meta.url);
export const NPM_RELEASE_METADATA_RECEIPT='docs/issues/npm_dmg_sid_release_metadata_20261121.json';
export const NPM_RELEASE_METADATA_PIN='fea65fab725c87f79f54587ec46556620cee6f67c66bbf3693e5e4685bff9359';
export const NPM_RELEASE_METADATA_BASE='33f71b326bdc51bc6d6be4e7f1394d5dc4f362e3';
export const NPM_RELEASE_METADATA_PATHS=Object.freeze(['packages/fm2612/package.json','packages/fm2612/README.md','packages/fm2612/examples/timed-registers/README.md','scripts/check_fm2612_package.mjs']);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const record=value=>value&&Number.isSafeInteger(value.bytes)&&value.bytes>0&&typeof value.sha256==='string'&&/^[a-f0-9]{64}$/.test(value.sha256);
const matches=(bytes,value)=>record(value)&&bytes.length===value.bytes&&sha(bytes)===value.sha256;
const fail=message=>{throw Error('served DSP/WASM source changed; remeasure: Unreviewed npm release metadata: '+message);};

function predecessor(bytes,entry){
  if(!record(entry?.before)||!record(entry.after)||!Array.isArray(entry.hunks)||!entry.hunks.length)fail('source pair');
  const parts=[];let cursor=0;
  for(const hunk of entry.hunks){
    if(!Number.isSafeInteger(hunk.afterOffset)||hunk.afterOffset<cursor||!Number.isSafeInteger(hunk.afterBytes)||hunk.afterBytes<0||hunk.afterOffset+hunk.afterBytes>bytes.length||typeof hunk.beforeBase64!=='string')fail('source hunk');
    const before=Buffer.from(hunk.beforeBase64,'base64');
    if(before.toString('base64')!==hunk.beforeBase64)fail('source hunk encoding');
    parts.push(bytes.subarray(cursor,hunk.afterOffset),before);cursor=hunk.afterOffset+hunk.afterBytes;
  }
  parts.push(bytes.subarray(cursor));const restored=Buffer.concat(parts);
  if(!matches(restored,entry.before))fail('predecessor identity');
  return restored;
}

/** A read-only predecessor view for non-renderer dependency checks. The only
 * accepted sources are exact pre-release bytes or this exact reviewed release;
 * neither arbitrary versions nor future README changes get a hash exemption. */
export function createNpmReleaseMetadataReadContext(readSource=url=>readFileSync(url)){
  let receipt;const restored=new Map();
  function evidence(){
    if(receipt)return receipt;
    const value=JSON.parse(readSource(new URL(NPM_RELEASE_METADATA_RECEIPT,root)));
    if(sha(JSON.stringify(value))!==NPM_RELEASE_METADATA_PIN||value.schemaVersion!==1||value.scope!=='npm-0.2.46-non-renderer-release-metadata'||value.baseCommit!==NPM_RELEASE_METADATA_BASE||value.fromVersion!=='0.2.45'||value.toVersion!=='0.2.46'||!value.sources)fail('receipt');
    const names=Object.keys(value.sources);
    if(names.length!==NPM_RELEASE_METADATA_PATHS.length||names.some(name=>!NPM_RELEASE_METADATA_PATHS.includes(name)))fail('source scope');
    for(const entry of Object.values(value.sources))if(!record(entry.before)||!record(entry.after))fail('source record');
    receipt=value;return value;
  }
  function restore(name,bytes){
    if(!NPM_RELEASE_METADATA_PATHS.includes(name))return bytes;
    const entry=evidence().sources[name];
    if(matches(bytes,entry.before))return bytes;
    if(!matches(bytes,entry.after))fail(name);
    if(!restored.has(name)){
      const previous=predecessor(Buffer.from(bytes),entry);
      if(name==='packages/fm2612/package.json'){
        const before=JSON.parse(previous),after=JSON.parse(bytes);
        if(before.name!=='tetorica-fm2612'||after.name!==before.name||before.version!=='0.2.45'||after.version!=='0.2.46')fail('package version');
        delete before.version;delete after.version;
        if(JSON.stringify(before)!==JSON.stringify(after))fail('package fields beyond version');
      }
      restored.set(name,previous);
    }
    return restored.get(name);
  }
  return{restore,readSource(url){
    const bytes=readSource(url);
    if(!(url instanceof URL)||url.protocol!=='file:')return bytes;
    const name=relative(fileURLToPath(root),fileURLToPath(url)).replaceAll('\\','/');
    return restore(name,bytes);
  }};
}

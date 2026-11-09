// SPDX-License-Identifier: BSD-3-Clause
// Restore metadata filenames omitted by npm, without overwriting user edits.
import assert from 'node:assert/strict';
import {readFile,writeFile,lstat} from 'node:fs/promises';
import {dirname,join,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const root=dirname(fileURLToPath(import.meta.url));
const manifest=JSON.parse(await readFile(join(root,'source-kit.json'),'utf8'));
assert.equal(manifest.npmStorage?.version,1,'Missing npm source storage map');
function pathAt(name){
  assert(typeof name==='string'&&!isAbsolute(name)&&!name.includes('\\')&&
    name.split('/').every(part=>part&&part!=='.'&&part!=='..'),'Invalid source path');
  return join(root,name);
}
async function verify(path,expected){
  assert(expected&&Number.isInteger(expected.bytes)&&typeof expected.sha256==='string');
  assert((await lstat(path)).isFile(),'Expected a regular source file');
  const bytes=await readFile(path);
  assert.equal(bytes.length,expected.bytes,path+' bytes');
  assert.equal(createHash('sha256').update(bytes).digest('hex'),expected.sha256,path+' SHA256');
  return bytes;
}
const pending=[];
for(const[logical,stored]of Object.entries(manifest.npmStorage.aliases)){
  const expected=manifest.sources[logical],bytes=await verify(pathAt(stored),expected);
  try{await verify(pathAt(logical),expected);}catch(error){
    if(error.code!=='ENOENT')throw error;
    pending.push([pathAt(logical),bytes]);
  }
}
for(const[path,bytes]of pending)await writeFile(path,bytes,{flag:'wx'});
for(const[name,expected]of Object.entries(manifest.compiledInputs))await verify(pathAt(name),expected);
console.log(`Restored ${pending.length} metadata files; verified ${Object.keys(manifest.compiledInputs).length} original build inputs.`);

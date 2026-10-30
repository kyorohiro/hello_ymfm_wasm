// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {copyScspSources} from './copy_scsp_sources.mjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
test('SCSP distribution retains authenticated SDK inputs, attribution, original build layout and generated pair identity',async t=>{
 const stage=await mkdtemp(join(tmpdir(),'scsp-source-'));t.after(()=>rm(stage,{recursive:true,force:true}));
 const result=await copyScspSources(stage),receipt=JSON.parse(await readFile(join(stage,'sources/SCSP.json')));
 assert.equal(result.inputs,19);assert.equal(result.files,24);assert.equal(receipt.sdk.manifestSha256,JSON.parse(await readFile(new URL('../third_party/soundchip-sdk.json',import.meta.url))).manifestSha256);
 for(const input of receipt.inputs){const bytes=await readFile(join(stage,input.path));assert.equal(bytes.length,input.bytes);assert.equal(sha(bytes),input.sha256);}
 assert.match(await readFile(join(stage,'licenses/mame-scsp/LICENSE'),'utf8'),/Redistribution/);
 assert.match(await readFile(join(stage,'sources/scsp-sdk/scripts/build_scsp_wasm.sh'),'utf8'),/ROOT_DIR\/vendor\/mame-scsp\/scsp.cpp/);
 for(const [name,record]of Object.entries(receipt.generated)){const bytes=await readFile(new URL('../docs/generated/'+name,import.meta.url));assert.equal(bytes.length,record.bytes);assert.equal(sha(bytes),record.sha256);}
 const before=await readFile(join(stage,'sources/SCSP.json'));await copyScspSources(stage);assert.deepEqual(await readFile(join(stage,'sources/SCSP.json')),before);
});

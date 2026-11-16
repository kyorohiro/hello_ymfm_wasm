// SPDX-License-Identifier: BSD-3-Clause
// Test-only archived source reconstruction. This is not a production freshness
// exemption: the live VAB receipt correctly rejects the newer AY WASM.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const receipt=JSON.parse(readFileSync(new URL('../../docs/issues/ps1_vab_public_api_source_revision_01.json',import.meta.url)));
assert.equal(sha(JSON.stringify(receipt)),'c6acbc62409a143a87b559c0e255395e294338fe19f1067eb664a947ce34c6c3');
function reconstruct(bytes,entry){
 if(!entry||bytes.length!==entry.after.bytes||sha(bytes)!==entry.after.sha256)return bytes;
 const chunks=[];let cursor=0;
 for(const hunk of entry.reverseHunks){assert(hunk.afterOffset>=cursor&&hunk.afterOffset+hunk.afterBytes<=bytes.length);chunks.push(bytes.subarray(cursor,hunk.afterOffset),Buffer.from(hunk.beforeText));cursor=hunk.afterOffset+hunk.afterBytes;}
 chunks.push(bytes.subarray(cursor));const before=Buffer.concat(chunks);
 assert.equal(before.length,entry.before.bytes);assert.equal(sha(before),entry.before.sha256);
 return before;
}
export function historicalVabSourceFixture(path,bytes){
 const name=path==='web/soundchip.js'?'tetorica_src/runtime/soundchip.js':path.startsWith('js/')||path.startsWith('playground/')?'docs/'+path:path;
 if(!Object.hasOwn(receipt.sources,name))return bytes;
 return reconstruct(reconstruct(bytes,receipt.sources[name]),receipt.priorSourceExport.sources[name]);
}

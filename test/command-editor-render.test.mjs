import test from 'node:test';
import assert from 'node:assert/strict';
import {readSource,renderSource} from '../cli/index.js';
import {CommandEditor} from '../docs/vgm_analyzer/command_editor.js';
test('editing SCC key data changes rendered audio while original remains playable',async()=>{
 const bytes=await readSource(new URL('./fixtures/msx-scc.vgz',import.meta.url)),editor=new CommandEditor(bytes);
 let count=0;
 for(let page=0;;page++){
  const {rows,more}=editor.page(page);
  for(const row of rows)if(row.op===0xd2 && bytes[row.offset+1]===3){editor.edit(row.offset,0);count++;}
  if(!more)break;
 }
 assert(count>0);
 const before=await renderSource(bytes,{maxSeconds:.02}),after=await renderSource(await editor.build(),{maxSeconds:.02});
 assert(before.bytes.subarray(44).some(v=>v!==0));assert(after.bytes.subarray(44).every(v=>v===0));
 editor.reset();assert.deepEqual(await editor.build(),bytes);
});

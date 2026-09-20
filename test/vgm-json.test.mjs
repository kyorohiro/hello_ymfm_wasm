import test from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync,readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {vgmToJson,jsonToVgm,decodeSource} from '../docs/vgm_analyzer/analyzer_core.js';
const fixtures=new URL('./fixtures/',import.meta.url);
test('every authored VGM fixture round-trips byte exactly through serialized JSON',()=>{
  const files=readdirSync(fixtures).filter(f=>f.endsWith('.vgm'));
  assert(files.length>10);
  for(const name of files){
    const bytes=new Uint8Array(readFileSync(new URL(name,fixtures)));
    assert.deepEqual(jsonToVgm(JSON.parse(JSON.stringify(vgmToJson(bytes)))),bytes,name);
    assert.deepEqual(jsonToVgm(vgmToJson(bytes,{comments:true})),bytes,name+' annotated');
  }
});
test('VGZ decoding produces the same lossless document as VGM',async()=>{
  const raw=readFileSync(new URL('nes-tone.vgm',fixtures));
  const decoded=await decodeSource(readFileSync(new URL('nes-tone.vgz',fixtures)));
  assert.deepEqual(vgmToJson(decoded),vgmToJson(raw));
});
test('register edits change only the selected byte; header, loop and tail survive',()=>{
  const original=new Uint8Array(readFileSync(new URL('nes-tone.vgm',fixtures)));
  const bytes=new Uint8Array(original.length+8);bytes.set(original);bytes.set([71,100,51,32,0,0,0,0],original.length);
  const view=new DataView(bytes.buffer);view.setUint32(0x14,original.length-0x14,true);view.setUint32(0x1c,256-0x1c,true);
  const doc=vgmToJson(bytes);
  const cmd=doc.commands.find(c=>c.hex.startsWith('b4'));
  cmd.hex=cmd.hex.slice(0,4)+'02';
  const expected=bytes.slice();expected[cmd.offset+2]=2;
  assert.deepEqual(jsonToVgm(doc),expected);
});
test('unknown and truncated commands are preserved opaquely without guessing boundaries',()=>{
  for(const tail of [[0x01,0x66,0x99],[0x67,0x66,0],[0x61,0]]){
    const bytes=new Uint8Array(64+tail.length);bytes.set([86,103,109,32]);new DataView(bytes.buffer).setUint32(8,0x150,true);bytes.set(tail,64);
    const doc=vgmToJson(bytes);assert.equal(doc.commands.length,0);assert(doc.warnings.length);
    assert.deepEqual(jsonToVgm(doc),bytes);
  }
});
test('invalid schema, hex, offsets, sizes and changed command boundaries are rejected',()=>{
  const original=vgmToJson(readFileSync(new URL('nes-tone.vgm',fixtures)));
  for(const mutate of [d=>d.schemaVersion=2,d=>d.headerHex='zz',d=>d.commands[0].offset++,d=>d.byteLength++,d=>d.commands[0].hex='66',d=>d.commands[0].hex='660000',d=>d.tail.offset--]){
    const doc=structuredClone(original);mutate(doc);assert.throws(()=>jsonToVgm(doc));
  }
});
test('CLI round trip preserves VGM and protects existing output',()=>{
  const dir=mkdtempSync(join(tmpdir(),'vgm-json-'));
  const run=(...args)=>spawnSync(process.execPath,['cli/main.js',...args],{encoding:'utf8'});
  try{
    const json=join(dir,'tone.json'),vgm=join(dir,'tone.vgm');
    let r=run('to-json',new URL('nes-tone.vgz',fixtures).pathname,'--output',json);assert.equal(r.status,0,r.stderr);
    r=run('from-json',json,'--output',vgm);assert.equal(r.status,0,r.stderr);
    assert.deepEqual(readFileSync(vgm),readFileSync(new URL('nes-tone.vgm',fixtures)));
    assert.equal(run('from-json',json,'--output',vgm).status,1);
    assert.equal(run('from-json',json,'--output',vgm,'--force').status,0);
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('optional comments explain commands without affecting restored bytes',()=>{
  const bytes=readFileSync(new URL('nes-tone.vgm',fixtures));
  const plain=vgmToJson(bytes),annotated=vgmToJson(bytes,{comments:true});
  assert(plain.commands.every(c=>!('comment' in c)));
  assert(annotated.commands.every(c=>typeof c.comment==='string'));
  assert.match(annotated.commands.find(c=>c.hex.startsWith('b4')).comment,/nes-apu.*register=.*value=/);
  assert.match(annotated.commands.at(-1).comment,/end/);
  annotated.commands[0].comment='Human note: changed explanation only';
  assert.deepEqual(jsonToVgm(annotated),new Uint8Array(bytes));
});

test('CLI --comments is opt-in and only accepted for to-json',()=>{
  const dir=mkdtempSync(join(tmpdir(),'vgm-comments-'));
  try {
    const path=join(dir,'tone.json');
    const result=spawnSync(process.execPath,['cli/main.js','to-json',new URL('nes-tone.vgz',fixtures).pathname,'--comments','--output',path],{encoding:'utf8'});
    assert.equal(result.status,0,result.stderr);
    assert(JSON.parse(readFileSync(path,'utf8')).commands[0].comment);
    const invalid=spawnSync(process.execPath,['cli/main.js','from-json',path,'--comments','--output',join(dir,'tone.vgm')],{encoding:'utf8'});
    assert.equal(invalid.status,1);
    assert.match(invalid.stderr,/not valid/);
  } finally {rmSync(dir,{recursive:true,force:true});}
});

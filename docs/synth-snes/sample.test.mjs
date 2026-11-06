// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {encodeBase64,decodeBase64,MAX_BRR_BYTES,MAX_PCM_FRAMES} from './sample.js';

test('portable BRR base64 retains all eight bits, padding and the full RAM budget',()=>{
  assert.equal(MAX_BRR_BYTES,64512);assert.equal(MAX_PCM_FRAMES,114688);
  for(const count of [0,1,2,3,4,12287,12288,12289,MAX_BRR_BYTES]) {
    const bytes=Uint8Array.from({length:count},(_,index)=>(index*17+5)&255);
    const data=encodeBase64(bytes);assert.equal(data,Buffer.from(bytes).toString('base64'));
    assert.deepEqual(decodeBase64(data),bytes);
  }
  assert.deepEqual([...decodeBase64('/wCB')],[255,0,129]);
});

test('encoding snapshots caller data and decoding caches only a borrowed read-only view',()=>{
  const bytes=Uint8Array.of(0,128,255),data=encodeBase64(bytes);bytes.fill(99);
  assert.deepEqual([...decodeBase64(data)],[0,128,255]);
  assert.equal(decodeBase64(data),decodeBase64(data));
});

test('malformed, noncanonical and oversized BRR payloads fail before being accepted',()=>{
  for(const data of [null,42,'A','AA','AAA','A===','====','AA=A','AA==\n','/x==','/wB=','_w==','ＡＡ==','AAAA=']) {
    assert.throws(()=>decodeBase64(data),/base64/);
  }
  assert.throws(()=>decodeBase64('A'.repeat(Math.ceil(MAX_BRR_BYTES/3)*4+4)),/64,512/);
  assert.throws(()=>encodeBase64(new Uint8Array(MAX_BRR_BYTES+1)),/64,512/);
  assert.throws(()=>encodeBase64([1,2,3]),/Uint8Array/);
});

test('the codec executes without browser base64 or Node globals in an AudioWorklet-like realm',async()=>{
  const source=(await readFile(new URL('./sample.js',import.meta.url),'utf8')).replaceAll('export ','');
  const result=vm.runInNewContext(source+"\nJSON.stringify([...decodeBase64(encodeBase64(Uint8Array.of(255,128,1,0)))]);",{});
  assert.equal(result,'[255,128,1,0]');
});

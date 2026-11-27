// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {writeBankSample} from './audio-bank.js';

test('replacing one phrase preserves shared audio and reuses space on later writes',()=>{
  const bytes=new Uint8Array(0x40000);
  bytes.set([0,4,0,0,4,3],0);
  bytes.copyWithin(8,0,6);
  bytes.set([1,2,3,4],0x400);
  const bank={bytes,names:['first','alias']};
  const clip={bytes:new Uint8Array(0x404),names:['new.wav']};
  clip.bytes.fill(9,0x400);
  const result=writeBankSample(bank,clip,0);
  assert.deepEqual([...result.bytes.slice(0,6)],[0,4,4,0,4,7]);
  assert.deepEqual(result.bytes.slice(8,14),bytes.slice(8,14));
  assert.deepEqual([...result.bytes.slice(0x400,0x408)],[1,2,3,4,9,9,9,9]);
  assert.deepEqual(writeBankSample(result,clip,0).bytes,result.bytes);
  assert.equal(writeBankSample(result,clip,127).names.length,128);
});

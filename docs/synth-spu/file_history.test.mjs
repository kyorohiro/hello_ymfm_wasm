import test from 'node:test';
import assert from 'node:assert/strict';
import {createSpuFileHistory} from './file_history.js';
test('session history evicts oldest entries, pops without Redo and clears',()=>{
  const h=createSpuFileHistory({maxEntries:2});assert.equal(h.peek(),null);
  h.push({id:1});h.push({id:2});h.push({id:3});assert.equal(h.read().entries,2);
  assert.equal(h.pop().id,3);assert.equal(h.pop().id,2);assert.equal(h.pop(),null);assert.equal(h.read().bytes,0);
  h.push({id:4});h.clear();assert.equal(h.peek(),null);assert.equal(h.read().bytes,0);
});
test('binary/text and instrument arrays count against the retained memory budget',()=>{
  const h=createSpuFileHistory({maxBytes:500});h.push({data:new Uint8Array(220)});h.push({data:new Uint8Array(220)});
  assert.equal(h.read().entries,1);assert(h.read().bytes<=500);
  assert.equal(h.push({sample:Array(100).fill(2)}),false);assert.equal(h.read().entries,0,'do not undo past an unretained operation');
  assert.equal(h.push({source:'x'.repeat(250)}),false);assert.equal(h.push({id:1}),true);
});
test('aliases are counted once and bounds reject invalid settings',()=>{
  const bytes=new Uint8Array(100),h=createSpuFileHistory({maxBytes:500});assert(h.push({a:bytes,b:bytes}));
  assert(h.read().bytes<300);assert.throws(()=>createSpuFileHistory({maxBytes:0}),/bounds/);assert.throws(()=>createSpuFileHistory({maxEntries:0}),/bounds/);
});

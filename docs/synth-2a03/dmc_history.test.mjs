// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {MAX_DPCM_BYTES} from './preset.js';
import {createDmcHistory} from './dmc_history.js';

test('empty baseline and byte edits have stable undo and redo endpoints', () => {
  const history = createDmcHistory();
  assert.deepEqual(history.read(),{canUndo:false,canRedo:false,undoCount:0,redoCount:0,bytes:0});
  assert.equal(history.undo(),null); assert.equal(history.redo(),null);
  assert.equal(history.push([]),false);
  assert.equal(history.push([1,2]),true);
  assert.equal(history.push([3]),true);
  assert.deepEqual(history.read(),{canUndo:true,canRedo:false,undoCount:2,redoCount:0,bytes:3});
  for (let repeat = 0; repeat < 50; repeat++) {
    assert.deepEqual(history.undo(),[1,2]); assert.deepEqual(history.undo(),[]);
    assert.equal(history.undo(),null);
    assert.deepEqual(history.redo(),[1,2]); assert.deepEqual(history.redo(),[3]);
    assert.equal(history.redo(),null);
  }
  assert.equal(history.read().bytes,3,'navigation does not allocate extra logical snapshots');
});

test('no-op edits keep redo; a changed edit after undo starts a new branch', () => {
  const history = createDmcHistory();
  history.reset([1]); history.push([2,3]); history.push([4,5,6]);
  assert.deepEqual(history.undo(),[2,3]);
  const before = history.read();
  assert.equal(history.push(Uint8Array.from([2,3])),false,'a cancelled or unchanged edit is not a commit');
  assert.deepEqual(history.read(),before);
  assert.deepEqual(history.redo(),[4,5,6]);
  history.undo();
  assert.equal(history.push([7,8,9,10]),true);
  assert.deepEqual(history.read(),{canUndo:true,canRedo:false,undoCount:2,redoCount:0,bytes:7});
  assert.equal(history.redo(),null);
  assert.deepEqual(history.undo(),[2,3]); assert.deepEqual(history.undo(),[1]);
});

test('reset clears both directions, including an unchanged baseline', () => {
  const history = createDmcHistory();
  history.reset([1]); history.push([2]); history.push([3]); history.undo();
  history.reset([2]);
  assert.deepEqual(history.read(),{canUndo:false,canRedo:false,undoCount:0,redoCount:0,bytes:1});
  assert.equal(history.undo(),null); assert.equal(history.redo(),null);
  history.reset(new Uint8Array());
  assert.equal(history.read().bytes,0);
  assert.equal(history.push(new Uint8Array()),false);
  history.push([255]); assert.deepEqual(history.undo(),[]);
});

test('input, navigation, and read results do not expose stored snapshot ownership', () => {
  const history = createDmcHistory(), baseline = [1,2], edit = Uint8Array.from([3,4]);
  history.reset(baseline); baseline[0] = 99;
  history.push(edit); edit[0] = 88;
  const previous = history.undo(); assert.deepEqual(previous,[1,2]); previous[0] = 77;
  const current = history.redo(); assert.deepEqual(current,[3,4]); current.push(5);
  const state = history.read(); state.bytes = 99; state.canUndo = false;
  assert.deepEqual(history.undo(),[1,2]); assert.deepEqual(history.redo(),[3,4]);
  assert.equal(history.read().bytes,4);
  assert.equal(history.push(Object.freeze([3,4])),false);
});

test('invalid bytes are fully rejected without removing either history branch', () => {
  const invalid = [undefined,null,{},'12',new Int8Array([1]),[1,-1],[1,256],[1,1.5],[1,NaN],[1,Infinity],new Array(2),[1,,3],new Array(MAX_DPCM_BYTES+1).fill(0)];
  invalid.push(Object.assign([1],{extra:2}),Object.assign(Uint8Array.from([1]),{extra:2}));
  const symbol = [1]; symbol[Symbol('extra')] = 2; invalid.push(symbol);
  const lateInvalid = new Array(MAX_DPCM_BYTES).fill(0); lateInvalid[MAX_DPCM_BYTES-1] = 256; invalid.push(lateInvalid);
  for (const data of invalid) {
    for (const method of ['push','reset']) {
      const history = createDmcHistory();
      history.reset([1]); history.push([2,3]); history.push([4,5,6]); history.undo();
      const before = history.read();
      assert.throws(() => history[method](data));
      assert.deepEqual(history.read(),before,`${method} must be atomic`);
      assert.deepEqual(history.undo(),[1]);
      assert.deepEqual(history.redo(),[2,3]); assert.deepEqual(history.redo(),[4,5,6]);
    }
  }
});

test('maxSteps evicts only oldest states and supports explicitly disabled undo', () => {
  const history = createDmcHistory({maxSteps:2});
  history.reset([1]); history.push([2]); history.push([3]); history.push([4]);
  assert.deepEqual(history.read(),{canUndo:true,canRedo:false,undoCount:2,redoCount:0,bytes:3});
  assert.deepEqual(history.undo(),[3]); assert.deepEqual(history.undo(),[2]); assert.equal(history.undo(),null);
  assert.deepEqual(history.redo(),[3]); assert.deepEqual(history.redo(),[4]);
  const disabled = createDmcHistory({maxSteps:0});
  disabled.reset([1]); assert.equal(disabled.push([2,3]),true);
  assert.deepEqual(disabled.read(),{canUndo:false,canRedo:false,undoCount:0,redoCount:0,bytes:2});
  assert.equal(disabled.undo(),null);
});

test('maxBytes counts past, current, and future DPCM bytes and retains the current sample', () => {
  const samples = [1,2,3,4].map(byte => new Uint8Array(MAX_DPCM_BYTES).fill(byte));
  const history = createDmcHistory({maxBytes:MAX_DPCM_BYTES*2});
  history.reset(samples[0]); history.push(samples[1]); history.push(samples[2]);
  assert.deepEqual(history.read(),{canUndo:true,canRedo:false,undoCount:1,redoCount:0,bytes:MAX_DPCM_BYTES*2});
  assert.deepEqual(history.undo(),Array.from(samples[1]));
  assert.equal(history.read().bytes,MAX_DPCM_BYTES*2,'the redo sample is still counted');
  assert.equal(history.undo(),null);
  history.push(samples[3]);
  assert.equal(history.read().bytes,MAX_DPCM_BYTES*2,'a new branch replaces future bytes');
  assert.deepEqual(history.undo(),Array.from(samples[1]));
  assert.deepEqual(history.redo(),Array.from(samples[3]));
  const minimal = createDmcHistory({maxBytes:MAX_DPCM_BYTES});
  minimal.reset(samples[0]); minimal.push(samples[1]);
  assert.equal(minimal.read().bytes,MAX_DPCM_BYTES); assert.equal(minimal.undo(),null);
  assert.equal(minimal.push(samples[1]),false,'current maximum-length sample remains retained');
  minimal.push([]); assert.deepEqual(minimal.undo(),Array.from(samples[1]));
});

test('default capacity limits retained undo steps and validates limit options', () => {
  const history = createDmcHistory();
  for (let byte = 0; byte < 100; byte++) history.push([byte]);
  assert.equal(history.read().undoCount,64); assert.equal(history.read().bytes,65);
  for (const maxSteps of [-1,1.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1,'64']) assert.throws(() => createDmcHistory({maxSteps}),RangeError);
  for (const maxBytes of [0,MAX_DPCM_BYTES-1,4081.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1,'8192']) assert.throws(() => createDmcHistory({maxBytes}),RangeError);
});

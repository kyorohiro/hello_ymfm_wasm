// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {fitDmcTargets} from './dmc_fit.js';
import {applyDmcTargets} from './dmc_draw.js';
import {decodeDpcm} from './dmc_decode.js';

function bitAt(data, bit) {return (data[bit >> 3] >> (bit & 7)) & 1;}
function differences(before, after) {
  return Array.from({length:before.length * 8},(_,bit) => bit).filter(bit => bitAt(before,bit) !== bitAt(after,bit));
}
function lexCompare(left, right) {
  for (let index = 0; index < left.length; index++) if (left[index] !== right[index]) return left[index] < right[index] ? -1 : 1;
  return 0;
}
function objective(source, data, targets, level, priorityBit) {
  const desired = new Map(targets.map(({bit,level}) => [bit,level])), original = decodeDpcm(source,{level}).levels, actual = decodeDpcm(data,{level}).levels;
  priorityBit ??= Math.max(...desired.keys());
  const cursorError = Math.max(0,Math.abs(actual[priorityBit + 1] - desired.get(priorityBit)) - 2) ** 2;
  const total = source.length * 8, reference = [], anchors = new Map(desired);
  if (!anchors.has(total - 1)) anchors.set(total - 1,original[total]);
  let left = -1, leftLevel = level;
  for (const [right,rightLevel] of [...anchors].sort(([a],[b]) => a - b)) {
    for (let bit = left + 1; bit <= right; bit++) reference[bit] = leftLevel + (rightLevel - leftLevel) * (bit - left) / (right - left);
    left = right; leftLevel = rightLevel;
  }
  const shapeError = reference.reduce((sum,target,bit) => sum + (actual[bit + 1] - target) ** 2,0), returnDistance = Math.abs(actual[total] - original[total]);
  return [cursorError,Math.max(0,returnDistance - 2) ** 2,shapeError,returnDistance ** 2,differences(source,data).length];
}

test('fitting matches exhaustive legal paths for cursor/recovery tolerance, interpolated shape, exact recovery, then flips', () => {
  const cases = [];
  for (const level of [0,1,64,65,126,127]) {
    for (const source of [0,0x55,0xaa,0xff]) {
      cases.push({source:[source],level,targets:[{bit:0,level:90.25},{bit:3,level:32},{bit:7,level:110}]});
      cases.push({source:[source],level,targets:[{bit:7,level:5},{bit:2,level:90},{bit:7,level:126.5}],priorityBit:2});
    }
  }
  for (const entry of cases) {
    const {source,level,targets,priorityBit} = entry, result = fitDmcTargets(source,targets,{level,priorityBit});
    let optimum = null;
    for (let byte = 0; byte < 256; byte++) {
      const cost = objective(source,[byte],targets,level,priorityBit);
      if (!optimum || lexCompare(cost,optimum) < 0) optimum = cost;
    }
    assert.deepEqual(objective(source,result.data,targets,level,priorityBit),optimum,JSON.stringify(entry));
    assert.deepEqual(fitDmcTargets(source,targets,{level,priorityBit}),result,'ties are deterministic');
  }
});

test('a single click reaches a distant legal height by rewriting its lead-in rather than just one bit', () => {
  const source = Array(17).fill(0xaa), targets = [{bit:30,level:110}];
  assert.equal(decodeDpcm(applyDmcTargets(source,targets)).levels[31],66);
  const result = fitDmcTargets(source,targets);
  assert.deepEqual(result.cursor,{bit:30,target:110,actual:110,error:0});
  assert.deepEqual(result.range,{startBit:0,endBit:93});
  assert(result.changedBefore > 0); assert(result.changedAfter > 0); assert(result.rejoined);
  assert.equal(result.data.length,source.length);
  assert.deepEqual(source,Array(17).fill(0xaa));
});

test('cursor priority is explicit and takes precedence over fitting an earlier target', () => {
  const source = [0xaa], targets = [{bit:0,level:0},{bit:7,level:127}];
  const last = fitDmcTargets(source,targets), first = fitDmcTargets(source,targets,{priorityBit:0});
  assert.deepEqual(last.cursor,{bit:7,target:127,actual:80,error:47});
  assert.deepEqual(first.cursor,{bit:0,target:0,actual:62,error:62});
  assert.equal(decodeDpcm(first.data).levels[8],64,'the earlier cursor permits recovery rather than prioritizing the later target');
  assert.equal(decodeDpcm(last.data).levels[1],66);
});

test('unreachable early clicks obey step distance and time parity rather than inventing DAC heights', () => {
  const source = Array(17).fill(0xaa);
  assert.deepEqual(fitDmcTargets(source,[{bit:0,level:127}]).cursor,{bit:0,target:127,actual:66,error:61});
  assert.deepEqual(fitDmcTargets(source,[{bit:0,level:0}]).cursor,{bit:0,target:0,actual:62,error:62});
  const temporal = fitDmcTargets(source,[{bit:31,level:110}]);
  assert.equal(temporal.cursor.error,2,'32 steps cannot reach level110 from64 without first reaching a boundary');
  assert([108,112].includes(temporal.cursor.actual));
  assert.equal(fitDmcTargets(source,[{bit:90,level:127}]).cursor.actual,126);
  assert.equal(fitDmcTargets(source,[{bit:90,level:0}],{level:65}).cursor.actual,1);
});

test('the four DAC boundaries hold correctly and stay within one step of dense flat targets', () => {
  for (const [level,target,original] of [[0,0,255],[1,0,255],[126,127,0],[127,127,0]]) {
    const targets = Array.from({length:16},(_,bit) => ({bit,level:target})), result = fitDmcTargets([original,original],targets,{level});
    const levels = decodeDpcm(result.data,{level}).levels.slice(0,17);
    assert(levels.slice(0,16).every(actual => actual === level),'holding at a boundary is a legal step');
    assert(levels.every(actual => actual % 2 === level % 2 && Math.abs(actual - target) <= 2));
    assert(result.cursor.error <= 2,'recovery may use one inward step at the final cursor');
  }
  const flat = Array.from({length:128},(_,bit) => ({bit,level:64})), source = Array(16).fill(0xaa);
  const unchanged = fitDmcTargets(source,flat);
  assert.deepEqual(unchanged.data,source); assert.equal(unchanged.changedBits,0); assert(unchanged.rejoined);
});

test('dense targets anticipate later shape instead of making greedy local choices', () => {
  const source = Array(33).fill(0xaa), targets = Array.from({length:128},(_,offset) => ({bit:64 + offset,level:80 + 24 * Math.sin(offset / 18)}));
  const result = fitDmcTargets(source,targets,{priorityBit:110}), levels = decodeDpcm(result.data).levels;
  assert.equal(result.cursor.bit,110);
  assert(result.cursor.error <= 1,'63 lead-in steps allow any state at the cursor');
  assert(result.changedBefore > 0); assert(result.changedAfter > 0);
  for (let index = 1; index <= source.length * 8; index++) {
    assert.equal(levels[index] % 2,0); assert(Math.abs(levels[index] - levels[index - 1]) <= 2);
  }
  const greedy = applyDmcTargets(source,targets), desired = new Map(targets.map(({bit,level}) => [bit,level]));
  const cursorCost = data => (decodeDpcm(data).levels[111] - desired.get(110)) ** 2;
  assert(cursorCost(result.data) <= cursorCost(greedy));
});

test('reverse strokes use the latest duplicate height and selected latest cursor', () => {
  const source = Object.freeze(Array(17).fill(0xaa));
  const targets = Object.freeze([{bit:90,level:120},{bit:70,level:20},{bit:90,level:72}].map(Object.freeze));
  const result = fitDmcTargets(source,targets,{priorityBit:70});
  assert.deepEqual(result,fitDmcTargets(source,[{bit:70,level:20},{bit:90,level:72}],{priorityBit:70}));
  assert.equal(result.cursor.bit,70); assert.equal(result.cursor.target,20); assert(result.cursor.error <= 2);
  assert.equal(fitDmcTargets(source,targets).cursor.bit,90,'default priority follows greatest addressed bit');
  assert.deepEqual(source,Array(17).fill(0xaa));
});

test('shape and recovery precede minimizing flips, and a joined tail retains all later DAC levels', () => {
  const small = fitDmcTargets([0xaa],[{bit:0,level:66}]);
  assert(small.rejoined); assert(small.changedBits > 2,'following the reference can need more flips than only restoring the tail');
  assert(lexCompare(objective([0xaa],small.data,[{bit:0,level:66}],64),objective([0xaa],[0xa9],[{bit:0,level:66}],64)) < 0);
  assert.equal(decodeDpcm(small.data).levels[8],64);
  const source = Array(33).fill(0xaa), result = fitDmcTargets(source,[{bit:130,level:110}]);
  assert.deepEqual(result.range,{startBit:68,endBit:193});
  assert(result.rejoined); assert.equal(result.cursor.error,0);
  const changed = differences(source,result.data);
  assert(changed.every(bit => bit >= 68 && bit <= 193));
  assert.equal(result.changedBits,changed.length);
  assert.equal(result.changedBefore,changed.filter(bit => bit < 130).length);
  assert.equal(result.changedAfter,changed.filter(bit => bit > 130).length);
  assert.deepEqual(decodeDpcm(result.data).levels.slice(194),decodeDpcm(source).levels.slice(194),'the untouched suffix and its DAC history are preserved');
  assert.deepEqual(fitDmcTargets(result.data,[{bit:130,level:110}]).data,result.data);
});

test('central clicks and nearby high targets do not use a DAC-boundary excursion to change time parity', () => {
  for (const level of [64,65]) {
    const source = Array(257).fill(0xaa), original = decodeDpcm(source,{level}).levels;
    for (const bit of [128,129,130,131]) {
      for (const target of [original[bit + 1],level,level - 2,80,96]) {
        const result = fitDmcTargets(source,[{bit,level:target}],{level}), levels = decodeDpcm(result.data,{level}).levels.slice(result.range.startBit,result.range.endBit + 2);
        assert(result.cursor.error <= 2,JSON.stringify({level,bit,target,cursor:result.cursor}));
        assert(Math.min(...levels) >= Math.min(level - 2,target) - 2);
        assert(Math.max(...levels) <= Math.max(level,target) + 2);
        assert(result.rejoined);
        if (target === original[bit + 1]) assert.equal(result.changedBits,0,'clicking the existing flat waveform keeps its bits');
      }
    }
  }
});

test('recovery permits one DAC step of suffix difference instead of forcing a boundary hold', () => {
  const source = Array(17).fill(0);
  for (let bit = 0; bit < 126; bit++) if (bit < 32 || (bit >= 63 && (bit - 63) % 2 === 0)) source[bit >> 3] |= 1 << (bit & 7);
  const original = decodeDpcm(source).levels;
  assert.equal(original[126],66);
  assert.equal(Math.max(...original.slice(0,127)),126,'the original window includes an upper-boundary hold');
  const result = fitDmcTargets(source,[{bit:62,level:64}]), levels = decodeDpcm(result.data).levels;
  assert.deepEqual(result.range,{startBit:0,endBit:125});
  assert(result.cursor.error <= 2);
  assert(Math.min(...levels.slice(0,127)) >= 62); assert(Math.max(...levels.slice(0,127)) <= 68);
  assert.equal(Math.abs(levels[126] - original[126]),2);
  assert.equal(result.rejoined,false,'a two-unit recovery difference is reported honestly');
  assert(differences(source,result.data).every(bit => bit <= 125),'suffix bits remain untouched even when levels have not rejoined');
});

test('a final-bit click keeps cursor accuracy when there is no time left to restore the tail', () => {
  const source = Array(17).fill(0xaa), bit = source.length * 8 - 1, result = fitDmcTargets(source,[{bit,level:127}]);
  assert.deepEqual(result.range,{startBit:bit - 62,endBit:bit});
  assert.equal(result.cursor.actual,126); assert.equal(result.cursor.error,1);
  assert.equal(result.changedAfter,0); assert.equal(result.rejoined,false);
  assert(differences(source,result.data).every(index => index >= bit - 62));
});

test('empty edits return detached data and null metadata', () => {
  const source = Uint8Array.from([0x81,0xaa]), result = fitDmcTargets(source,[]);
  assert.deepEqual(result,{data:[0x81,0xaa],range:null,changedBits:0,changedBefore:0,changedAfter:0,cursor:null,rejoined:true});
  result.data[0] = 0; assert.equal(source[0],0x81);
  assert.deepEqual(fitDmcTargets([],[]),{data:[],range:null,changedBits:0,changedBefore:0,changedAfter:0,cursor:null,rejoined:true});
});

test('the full 4081-byte editable sample remains bounded and keeps original ownership', () => {
  const source = new Uint8Array(4081).fill(0xaa), total = source.length * 8;
  const targets = Array.from({length:total},(_,bit) => ({bit,level:64})), result = fitDmcTargets(source,targets);
  assert.equal(result.data.length,4081);
  assert.deepEqual(result.range,{startBit:0,endBit:total - 1});
  assert.deepEqual(result.data,Array.from(source)); assert.equal(result.changedBits,0); assert(result.rejoined);
  assert.equal(result.cursor.bit,total - 1); assert.equal(result.cursor.actual,64);
  result.data[0] = 0; assert.equal(source[0],0xaa);
});

test('invalid data, targets, priority, and excessive input fail atomically', () => {
  for (const source of [null,{},'ff',[256],[-1],[NaN],[1.5],new Array(1),Array(4082).fill(0),new Uint16Array(1)]) assert.throws(() => fitDmcTargets(source,[]));
  const extra = [0]; extra.note = 1; assert.throws(() => fitDmcTargets(extra,[]));
  const typedExtra = new Uint8Array(1); typedExtra.note = 1; assert.throws(() => fitDmcTargets(typedExtra,[]));
  const symbolExtra = [0]; symbolExtra[Symbol('extra')] = 1; assert.throws(() => fitDmcTargets(symbolExtra,[]));
  const source = [0x55,0xaa], original = [...source];
  for (const targets of [null,{},'x',[null],[{bit:0}],[{bit:-1,level:64}],[{bit:1.5,level:64}],[{bit:16,level:64}],
    [{bit:0,level:-1}],[{bit:0,level:128}],[{bit:0,level:NaN}],[{bit:0,level:Infinity}],[{bit:'0',level:64}],
    [{bit:0,level:100},{bit:1,level:'64'}]]) {
    assert.throws(() => fitDmcTargets(source,targets)); assert.deepEqual(source,original);
  }
  for (const level of [-1,128,NaN,1.5]) assert.throws(() => fitDmcTargets(source,[],{level}));
  for (const priorityBit of [-1,16,1.5,NaN,'0',1]) assert.throws(() => fitDmcTargets(source,[{bit:0,level:64}],{priorityBit}));
  assert.throws(() => fitDmcTargets(source,[],{priorityBit:0}));
  function* excessive() {for (let count = 0; count <= 4081 * 8; count++) yield {bit:0,level:64};}
  assert.throws(() => fitDmcTargets(source,excessive()),/target points/);
  function* interrupted() {yield {bit:0,level:127}; throw new Error('target source failed');}
  assert.throws(() => fitDmcTargets(source,interrupted()),/target source failed/);
  assert.deepEqual(source,original);
});

// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {readMorph,morphPcm,morphShape,morphShapeName} from './spu_synth_morph.js';
test('Software morph has exact endpoints, bounded interpolation, independent copies and custom PCM',()=>{
  const settings=readMorph();assert(!settings.enabled);
  assert.deepEqual(morphPcm(settings),settings.a);
  assert.deepEqual(morphPcm({...settings,amount:1}),settings.b);
  const middle=morphPcm({...settings,amount:.5});assert(middle.every((x,i)=>x===Math.fround((settings.a[i]+settings.b[i])/2)));
  for(const shape of ['sine','triangle','saw','square'])assert.equal(morphShapeName(morphShape(shape)),shape);
  assert.equal(morphShapeName(Array(112).fill(.2)),'custom');
  assert.deepEqual(morphPcm({amount:1,a:Array(112).fill(1),b:Array(112).fill(1e-40)}),readMorph({b:Array(112).fill(1e-40)}).b,'B endpoint is exact even after large cancellation');
  settings.a[0]=1;assert.notEqual(readMorph().a[0],1);
  for(const bad of [{amount:NaN},{a:[0]},{b:Array(112).fill(2)},{a:Array(112).fill(null)},{enabled:1},{unknown:1}])assert.throws(()=>readMorph(bad),/Morph|morph/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {FM2608_OUTPUT_MIX_DEFAULTS,readFm2608OutputMix,resolveFm2608OutputMix} from './output_mix.js';

const source = entries => ({sourceChip:'ym2203',compatibility:{extraVolumeEntries:entries}});
const relative = (section,multiplier) => ({section,chipIndex:0,relative:true,multiplier,absolute:null});
const absolute = (section,value) => ({section,chipIndex:0,relative:false,multiplier:null,absolute:value});

test('software mixer defaults keep unity output and partial edits retain companion controls',()=>{
  assert.deepEqual(readFm2608OutputMix(),{fm:1,ssg:1,ym2203Mode:false});
  const first = readFm2608OutputMix({fm:1.5,ym2203Mode:true});
  assert.deepEqual(readFm2608OutputMix({ssg:.5},first),{fm:1.5,ssg:.5,ym2203Mode:true});
  assert.deepEqual(FM2608_OUTPUT_MIX_DEFAULTS,{fm:1,ssg:1,ym2203Mode:false});
  assert.deepEqual(resolveFm2608OutputMix(first).effective,{fm:1.5,ssg:.75});
});
test('YM2203 mode composes source correction, VGM relative volume and user faders once',()=>{
  const opn = source([relative('ssg',1.6015625)]);
  const result = resolveFm2608OutputMix({fm:2,ssg:.5,ym2203Mode:true},opn);
  assert.deepEqual(result.correction,{fm:1,ssg:.75});
  assert.deepEqual(result.file,{fm:1,ssg:1.6015625});
  assert.deepEqual(result.effective,{fm:2,ssg:.6005859375});
  assert.equal(result.volumeAdjustmentsApplied,true);
  const bypass = resolveFm2608OutputMix({fm:2,ssg:.5,ym2203Mode:false},opn);
  assert.deepEqual(bypass.effective,{fm:2,ssg:.5});
  assert.equal(bypass.volumeAdjustmentsApplied,false);
  assert.deepEqual(resolveFm2608OutputMix({ym2203Mode:true},{...opn,sourceChip:'ym2608'}).file,{fm:1,ssg:1});
});
test('VGM absolute levels use source default levels, first matching entry, zero and full range',()=>{
  const result = resolveFm2608OutputMix({ym2203Mode:true},source([
    absolute('fm',384),absolute('ssg',64),relative('ssg',4),
  ]));
  assert.deepEqual(result.file,{fm:1.5,ssg:.5});
  assert.deepEqual(result.effective,{fm:1.5,ssg:.375});
  assert.deepEqual(result.fileVolumeEntries.map(entry=>entry.applied),[true,true,false]);
  assert.equal(resolveFm2608OutputMix({ym2203Mode:true},source([absolute('ssg',0)])).effective.ssg,0);
  const full = resolveFm2608OutputMix({ssg:3.8,ym2203Mode:true},source([absolute('ssg',32767)]));
  assert(full.effective.ssg > 128 && full.effective.ssg < 1024);
});
test('invalid controls reject atomically without changing the previous mixer settings',()=>{
  const previous = readFm2608OutputMix({fm:1.5,ssg:.2});
  for (const input of [null,[],{fm:NaN},{fm:Infinity},{ssg:-1},{ssg:3.81},{ym2203Mode:1},{other:1}]) {
    assert.throws(()=>readFm2608OutputMix(input,previous));
    assert.deepEqual(previous,{fm:1.5,ssg:.2,ym2203Mode:false});
  }
});

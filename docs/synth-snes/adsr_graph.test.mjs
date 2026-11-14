import test from 'node:test';
import assert from 'node:assert/strict';
import {adsrGraphLayout,adsrGraphEdit} from './adsr_graph.js';
const e={attack:8,decay:3,sustainLevel:4,sustainRate:12};
test('ADSR guide coordinates order stages, hold sustain at rate zero and use a fixed release endpoint',()=>{
 const p=adsrGraphLayout({...e,sustainRate:0});assert(p.attack.x<p.decay.x&&p.decay.x<p.sustain.x&&p.sustain.x<p.release.x);assert.equal(p.sustain.y,p.decay.y);assert.deepEqual(p.release,{x:.98,y:.88});assert(adsrGraphLayout({...e,attack:15}).attack.x<adsrGraphLayout({...e,attack:0}).attack.x);assert.equal(adsrGraphLayout({...e,sustainRate:31}).sustain.y,.88);
});
test('graph handles round-trip every register-code value without changing unrelated envelope fields',()=>{
 for(let attack=0;attack<16;attack++)for(let decay=0;decay<8;decay++)for(let sustainLevel=0;sustainLevel<8;sustainLevel++)for(let sustainRate=0;sustainRate<32;sustainRate++){
  const env={attack,decay,sustainLevel,sustainRate},p=adsrGraphLayout(env);
  assert.deepEqual(adsrGraphEdit('attack',p.attack.x,p.attack.y,env),{attack});assert.deepEqual(adsrGraphEdit('decay',p.decay.x,p.decay.y,env),{decay,sustainLevel});assert.deepEqual(adsrGraphEdit('sustain',p.sustain.x,p.sustain.y,env),{sustainRate});
  for(const point of Object.values(p))assert(point.x>=0&&point.x<=1&&point.y>=0&&point.y<=1);
 }
});
test('dragging outside the graph clamps to hardware code ranges',()=>{
 assert.deepEqual(adsrGraphEdit('attack',-10,0,e),{attack:15});assert.deepEqual(adsrGraphEdit('attack',10,0,e),{attack:0});assert.deepEqual(adsrGraphEdit('decay',-10,-10,e),{decay:7,sustainLevel:7});assert.deepEqual(adsrGraphEdit('decay',10,10,e),{decay:0,sustainLevel:0});assert.deepEqual(adsrGraphEdit('sustain',10,0,e),{sustainRate:0});assert.throws(()=>adsrGraphEdit('release',0,0,e),RangeError);
});

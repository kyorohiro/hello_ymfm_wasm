import test from 'node:test';
import assert from 'node:assert/strict';
import {createSpuLiveHighlighter,getSpuLiveHighlightControls} from './live_highlight.js';
class Element{
  constructor(){this.classes=new Set();this.events=new Map();this.writes=0;this.classList={add:name=>{this.writes++;this.classes.add(name);},remove:name=>{this.writes++;this.classes.delete(name);}};}
  addEventListener(name,fn){this.events.set(name,fn);}removeEventListener(name){this.events.delete(name);}
  finish(){this.events.get('animationend')?.({target:this,animationName:'synth-live-change'});}
  get offsetWidth(){assert.fail('No forced layout');}getBoundingClientRect(){assert.fail('No layout measurements');}
}
const lit=node=>node.classes.has('is-live-changed');
const view=(values,extra={})=>({snapshot:{nativeFrames:100,values},owner:'renderer',origin:'code',epoch:1,channel:0,following:true,visible:true,...extra});
function fixture(){const nodes=[new Element(),new Element()],visible=[true,true],reads=[0,0];
  const h=createSpuLiveHighlighter({controls:nodes.map((element,i)=>({element,read:s=>{reads[i]++;return s.values[i];},available:()=>visible[i]}))});return{h,nodes,visible,reads};}
test('scalar changes pulse only changed controls, without restarting active animations',()=>{
  const {h,nodes}=fixture();h.update(view([1,false]));assert(nodes.every(n=>!lit(n)));
  h.update(view([2,false]));assert(lit(nodes[0]));assert(!lit(nodes[1]));const writes=nodes[0].writes;
  h.update(view([3,false]));assert.equal(nodes[0].writes,writes);nodes[0].finish();assert(!lit(nodes[0]));
  h.update(view([3,true]));assert(lit(nodes[1]));h.dispose();assert(!lit(nodes[1]));
});
test('Off examines neither view, availability nor values and re-enabling starts fresh',()=>{
  const {h,nodes,reads}=fixture();h.update(view([1,2]));h.update(view([2,2]));h.setEnabled(false);assert(!lit(nodes[0]));
  const count=reads.slice();h.update(new Proxy({},{get(){assert.fail('Off must not inspect view');}}));assert.deepEqual(reads,count);
  h.setEnabled(true);h.update(view([9,9]));assert(nodes.every(n=>!lit(n)));h.dispose();
});
test('hidden, focused and unknown fields reset individually without masking other visible changes',()=>{
  const {h,nodes,visible}=fixture();h.update(view([1,2]));visible[0]=false;h.update(view([8,3]));assert(!lit(nodes[0]));assert(lit(nodes[1]));
  nodes[1].finish();visible[0]=true;h.update(view([8,3]));assert(!lit(nodes[0]));
  h.update(view([undefined,3]));h.update(view([20,3]));assert(!lit(nodes[0]));h.dispose();
});
test('CH/source/session, Pause, Seek/wait/error, hidden page and frame rollback reset baselines',()=>{
  for(const change of [{channel:1},{origin:'psf'},{epoch:2},{owner:'new-renderer'},
    {paused:true},{waiting:true},{error:true},{visible:false},{following:false},
    {snapshot:{nativeFrames:0,values:[9,9]}},{snapshot:{nativeFrames:50,values:[9,9]}}]){
    const {h,nodes}=fixture();h.update(view([1,2]));h.update(view([9,9],change));assert(nodes.every(n=>!lit(n)),JSON.stringify(change));
    if(change.snapshot?.nativeFrames!==50){h.update(view([99,99]));assert(nodes.every(n=>!lit(n)));}else{h.update(view([10,9]));assert(lit(nodes[0]));}h.dispose();
  }
});
test('arrays and duplicate bindings reject, and disposed highlights do no work',()=>{
  const {h,nodes}=fixture();assert.throws(()=>h.update(view([[1,2],3])),/scalar/);assert(nodes.every(n=>!lit(n)));h.dispose();
  h.update(new Proxy({},{get(){assert.fail('disposed');}}));
  assert.throws(()=>createSpuLiveHighlighter({controls:[{element:nodes[0],read:()=>1},{element:nodes[0],read:()=>2}]}),/distinct/);
});
test('cached DOM bindings skip hidden ancestors and focused inputs, but include disabled observable values',()=>{
  const parent={hidden:false,parentElement:null},element=new Element();element.hidden=false;element.parentElement=parent;
  const doc={activeElement:null},input={hidden:false,parentElement:element,disabled:true,closest:()=>element};
  const root={ownerDocument:doc,querySelector:selector=>selector==='[data-chip-control="ps1-release-rate"]'?input:null};
  const bindings=getSpuLiveHighlightControls(root);assert.equal(bindings.length,1);assert(bindings[0].available());
  assert.equal(bindings[0].read({channels:[{envelopeParameters:{releaseRate:8}}]}),8);
  parent.hidden=true;assert(!bindings[0].available());parent.hidden=false;doc.activeElement=input;assert(!bindings[0].available());
});

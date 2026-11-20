import test from 'node:test';
import assert from 'node:assert/strict';
import {createSidLiveHighlighter} from './live_highlight.js';

class Element{
  constructor(){
    this.classes=new Set();this.listeners=new Map();this.writes=0;
    this.classList={add:name=>{this.writes++;this.classes.add(name);},remove:name=>{this.writes++;this.classes.delete(name);}};
  }
  addEventListener(name,callback){this.listeners.set(name,callback);}
  removeEventListener(name,callback){if(this.listeners.get(name)===callback)this.listeners.delete(name);}
  finish({target=this,animationName='synth-live-change'}={}){this.listeners.get('animationend')?.({target,animationName});}
  get offsetWidth(){assert.fail('Highlights must not force layout');}
  getBoundingClientRect(){assert.fail('Highlights must not measure layout');}
}
const lit=element=>element.classes.has('is-live-changed');
const view=(values,extra={})=>({owner:'renderer',origin:'code',epoch:1,channel:0,following:true,visible:true,
  snapshot:{model:'6581',sampleRate:48000,clockHz:985248,positionFrames:100,values},...extra});
function fixture({enabled=true}={}){
  const nodes=[new Element(),new Element()],available=[true,true],reads=[0,0],availabilityReads=[0,0];
  const h=createSidLiveHighlighter({enabled,controls:nodes.map((element,index)=>({element,
    read:snapshot=>{reads[index]++;return snapshot.values[index];},
    available:()=>{availabilityReads[index]++;return available[index];}}))});
  return{h,nodes,available,reads,availabilityReads};
}

test('only changed scalars pulse; repeated changes do not restart an active animation',()=>{
  const {h,nodes}=fixture();
  h.update(view([1,false]));assert(nodes.every(node=>!lit(node)),'first observation establishes a baseline');
  h.update(view([2,false]));assert(lit(nodes[0]));assert(!lit(nodes[1]));
  const writes=nodes[0].writes;
  h.update(view([3,false]));assert.equal(nodes[0].writes,writes,'rapid changes keep one bounded CSS pulse');
  nodes[0].finish({animationName:'another-animation'});assert(lit(nodes[0]));
  nodes[0].finish({target:nodes[1]});assert(lit(nodes[0]));
  nodes[0].finish();assert(!lit(nodes[0]));
  h.update(view([3,true]));assert(!lit(nodes[0]));assert(lit(nodes[1]));
  h.update(view([4,true]));assert(lit(nodes[0]),'a later change can start a new pulse');
  h.dispose();assert(nodes.every(node=>!lit(node)));
});

test('Off neither inspects the view nor reads availability or scalars; re-enable starts fresh',()=>{
  const {h,nodes,reads,availabilityReads}=fixture();
  h.update(view([1,2]));h.update(view([2,2]));h.setEnabled(false);assert(!lit(nodes[0]));
  const before={reads:reads.slice(),availability:availabilityReads.slice()};
  h.update(new Proxy({},{get(){assert.fail('Off must not inspect the view');}}));
  assert.deepEqual({reads,availability:availabilityReads},before);
  h.setEnabled(true);h.update(view([99,99]));assert(nodes.every(node=>!lit(node)));
  h.update(view([100,99]));assert(lit(nodes[0]));h.dispose();
});

test('initial Off avoids every field getter',()=>{
  const {h,reads,availabilityReads}=fixture({enabled:false});
  h.update(new Proxy({},{get(){assert.fail('Initially disabled view access');}}));
  assert.deepEqual(reads,[0,0]);assert.deepEqual(availabilityReads,[0,0]);h.dispose();
});

test('unavailable hidden/focused controls reset individually while other visible values keep highlighting',()=>{
  const {h,nodes,available,reads}=fixture();h.update(view([1,2]));
  available[0]=false;const count=reads[0];h.update(view([8,3]));
  assert.equal(reads[0],count,'an unavailable field is not inspected');assert(!lit(nodes[0]));assert(lit(nodes[1]));
  nodes[1].finish();available[0]=true;h.update(view([8,3]));assert(!lit(nodes[0]),'opening or unfocusing creates a baseline');
  for(const unknown of [undefined,NaN,Infinity,-Infinity]){
    h.update(view([unknown,3]));h.update(view([20,3]));assert(!lit(nodes[0]));
  }
  h.update(view([21,4]));assert(nodes.every(lit));h.dispose();
});

test('source/session/channel/renderer switches reset every baseline',()=>{
  for(const extra of [{owner:{}},{origin:'song'},{epoch:2},{channel:1}]){
    const {h,nodes}=fixture();h.update(view([1,2]));h.update(view([9,9],extra));
    assert(nodes.every(node=>!lit(node)));h.dispose();
  }
  for(const changed of [{model:'8580'},{sampleRate:44100},{clockHz:1022727}]){
    const {h,nodes}=fixture(),next=view([9,9]);Object.assign(next.snapshot,changed);
    h.update(view([1,2]));h.update(next);assert(nodes.every(node=>!lit(node)));h.dispose();
  }
});

test('Pause, waiting/error, frozen/hidden views and invalid startup frames clear then establish a new baseline',()=>{
  for(const extra of [{paused:true},{waiting:true},{error:true},{following:false},{visible:false},
    {snapshot:null},{snapshot:{positionFrames:0}},{snapshot:{positionFrames:-1}},{snapshot:{positionFrames:NaN}}]){
    const {h,nodes}=fixture();h.update(view([1,2]));h.update(view([2,2]));assert(lit(nodes[0]));
    h.update(view([9,9],extra));assert(nodes.every(node=>!lit(node)),JSON.stringify(extra));
    h.update(view([99,99]));assert(nodes.every(node=>!lit(node)),'resume is a baseline, not a change');h.dispose();
  }
});

test('backward frames start fresh, while same-frame manual edits and forward frames compare normally',()=>{
  const {h,nodes}=fixture();h.update(view([1,2]));
  const back=view([9,9]);back.snapshot.positionFrames=50;h.update(back);assert(nodes.every(node=>!lit(node)));
  h.update({...back,snapshot:{...back.snapshot,values:[10,9]}});assert(lit(nodes[0]),'same-frame changes remain observable');
  nodes[0].finish();const next=view([10,10]);next.snapshot.positionFrames=200;h.update(next);assert(lit(nodes[1]));h.dispose();
});

test('nonscalars reject and clear partial pulses; malformed/duplicate bindings reject',()=>{
  for(const value of [[],{},()=>{},Symbol('value'),1n]){
    const {h,nodes}=fixture();h.update(view([1,2]));
    assert.throws(()=>h.update(view([3,value])),/scalar/);assert(nodes.every(node=>!lit(node)));h.dispose();
  }
  const node=new Element();
  assert.throws(()=>createSidLiveHighlighter({controls:[{element:node,read:()=>1},{element:node,read:()=>2}]}),/distinct/);
  assert.throws(()=>createSidLiveHighlighter({controls:[{element:node,read:()=>1,available:true}]}),/distinct/);
  assert.throws(()=>createSidLiveHighlighter({controls:[],enabled:1}),/enabled/);
});

test('dispose is idempotent, removes listeners and ignores late observation getters',()=>{
  const {h,nodes,reads}=fixture();h.update(view([1,2]));h.update(view([2,2]));
  h.dispose();h.dispose();assert(nodes.every(node=>!lit(node)));assert(nodes.every(node=>node.listeners.size===0));
  const before=reads.slice();h.update(new Proxy({},{get(){assert.fail('Disposed view access');}}));
  assert.deepEqual(reads,before);h.setEnabled(false);
  assert.throws(()=>h.setEnabled('off'),/boolean/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {createHuc6280LiveHighlighter} from './live_highlight.js';

function node() {
  const classes=new Set(),listeners=new Map(),writes=[];
  const element={classList:{add:value=>{classes.add(value);writes.push(['add',value]);},remove:value=>{classes.delete(value);writes.push(['remove',value]);},contains:value=>classes.has(value)},
    addEventListener(type,listener){if(!listeners.has(type))listeners.set(type,new Set());listeners.get(type).add(listener);},
    removeEventListener(type,listener){listeners.get(type)?.delete(listener);},
    finish(event={}){for(const listener of listeners.get('animationend')??[])listener({target:element,animationName:'synth-live-change',...event});},
    getBoundingClientRect(){assert.fail('Highlight must not read layout');},get offsetWidth(){assert.fail('Highlight must not read layout');},
    writes,listeners};
  return element;
}
const owner={};
const view=(revision=1,preset={volume:9,source:'wave',noise:3},options={})=>({physical:true,origin:'Code',channel:0,preset,
  snapshot:{positionFrames:128,revision},following:true,visible:true,owner,epoch:1,...options});
function fixture({enabled=true}={}) {
  const nodes=[node(),node(),node()],reads=[0,0,0],availability=[true,true,true];let availabilityReads=0;
  const controls=['volume','source','noise'].map((path,index)=>({element:nodes[index],path,
    read:preset=>{reads[index]++;return preset[path];},available:()=>{availabilityReads++;return availability[index];}}));
  const highlighter=createHuc6280LiveHighlighter({controls,enabled});
  return{highlighter,nodes,reads,availability,get availabilityReads(){return availabilityReads;}};
}
const lit=element=>element.classList.contains('is-live-changed');
const litCount=f=>f.nodes.filter(lit).length;

test('first observation establishes baselines, only changed scalars pulse and repeated revisions skip readers',()=>{
  const f=fixture();f.highlighter.update(view());assert.equal(litCount(f),0);assert.deepEqual(f.reads,[1,1,1]);
  for(let frame=256;frame<1000;frame+=128)f.highlighter.update(view(1,{}, {snapshot:{positionFrames:frame,revision:1}}));
  assert.deepEqual(f.reads,[1,1,1]);
  f.highlighter.update(view(2,{volume:10,source:'wave',noise:3},{snapshot:{revision:2,positionFrames:1024}}));assert.deepEqual(f.nodes.map(lit),[true,false,false]);
  for(let revision=3;revision<20;revision++)f.highlighter.update(view(revision,{volume:revision,source:'wave',noise:3},{snapshot:{revision,positionFrames:1024+revision*128}}));
  assert.deepEqual(f.nodes[0].writes,[['add','is-live-changed']],'rapid updates share one bounded pulse');
  f.nodes[0].finish();assert.equal(litCount(f),0);f.highlighter.dispose();
});

test('Code snapshots without revisions still compare scalar values at existing updates',()=>{
  const f=fixture(),first=view(),next=view(2,{volume:10,source:'wave',noise:3});delete first.snapshot.revision;delete next.snapshot.revision;
  f.highlighter.update(first);f.highlighter.update(next);assert(lit(f.nodes[0]));f.highlighter.dispose();
});

test('Off and disposed updates do not inspect a view or control availability/readers',()=>{
  const f=fixture({enabled:false}),unreadable=new Proxy({}, {get(){assert.fail('Off must not inspect the view');}});
  f.highlighter.update(unreadable);assert.equal(f.availabilityReads,0);assert.deepEqual(f.reads,[0,0,0]);
  f.highlighter.setEnabled(true);f.highlighter.update(view());f.highlighter.update(view(2,{volume:10,source:'wave',noise:3}));assert(lit(f.nodes[0]));
  f.highlighter.setEnabled(false);assert.equal(litCount(f),0);const reads=[...f.reads],available=f.availabilityReads;
  f.highlighter.update(unreadable);assert.deepEqual(f.reads,reads);assert.equal(f.availabilityReads,available);
  f.highlighter.setEnabled(true);f.highlighter.update(view(100,{volume:31,source:'noise',noise:20}));assert.equal(litCount(f),0);
  f.highlighter.dispose();f.highlighter.update(unreadable);assert.deepEqual(f.reads,[reads[0]+1,reads[1]+1,reads[2]+1]);
});

test('frame-zero initialization reads no fields; origin/channel/run/owner/frame regression rebase every control',()=>{
  for(const options of [{origin:'VGM'},{channel:1},{epoch:2},{owner:{}},{snapshot:{revision:3,positionFrames:64}}]) {
    const f=fixture();f.highlighter.update(view(1,undefined,{snapshot:{revision:1,positionFrames:0}}));assert.deepEqual(f.reads,[0,0,0]);
    f.highlighter.update(view());f.highlighter.update(view(2,{volume:10,source:'wave',noise:3}));assert(lit(f.nodes[0]));
    f.highlighter.update(view(3,{volume:20,source:'noise',noise:7},options));assert.equal(litCount(f),0);
    f.highlighter.dispose();
  }
});

test('Pause, frozen following, waiting/error, hidden views, interaction and Auto exit clear and rebase',()=>{
  for(const options of [{paused:true},{following:false},{waiting:true},{error:true},{visible:false},{interacting:true},{physical:false},{snapshot:null},null]) {
    const f=fixture();f.highlighter.update(view());f.highlighter.update(view(2,{volume:10,source:'wave',noise:3}));assert(lit(f.nodes[0]));
    f.highlighter.update(options===null?null:view(3,{volume:20,source:'noise',noise:7},options));assert.equal(litCount(f),0);
    f.highlighter.update(view(4,{volume:20,source:'noise',noise:7}));assert.equal(litCount(f),0);f.highlighter.dispose();
  }
});

test('Auto update resumes beyond the retained frozen frame without a synthetic catch-up pulse',()=>{
  const f=fixture();
  const observation=(frame,volume,options={})=>view(frame,{volume,source:'wave',noise:3},{snapshot:{revision:frame,positionFrames:frame},...options});
  f.highlighter.update(observation(100,9));f.highlighter.update(observation(100,9,{following:false}));
  const reads=[...f.reads];f.highlighter.update(observation(100,9));assert.deepEqual(f.reads,reads,'retained stale snapshot is not compared');
  f.highlighter.update(observation(200,20));assert.equal(litCount(f),0,'first fresh observation is the resumed baseline');
  f.highlighter.update(observation(300,21));assert(lit(f.nodes[0]));
  for(const next of [{owner:{}},{origin:'VGM'},{channel:1},{epoch:2}]) {
    f.highlighter.update(observation(300,21,{following:false}));
    f.highlighter.update(observation(0,9,next));
    f.highlighter.update(observation(64,10,next));assert.equal(litCount(f),0,'a new scope starts at its own earlier frame');
  }
  f.highlighter.dispose();
});

test('hidden frozen snapshots retain the resume barrier until a fresh observation arrives',()=>{
  for(const concealed of [{visible:false},{paused:true},{interacting:true}]) {
    const f=fixture();
    const observation=(frame,volume,options={})=>view(frame,{volume,source:'wave',noise:3},{snapshot:{revision:frame,positionFrames:frame},...options});
    f.highlighter.update(observation(100,9));
    f.highlighter.update(observation(100,9,{following:false}));
    f.highlighter.update(observation(100,9,{following:false,...concealed}));
    const reads=[...f.reads];
    f.highlighter.update(observation(100,9,concealed));
    f.highlighter.update(observation(100,9));assert.deepEqual(f.reads,reads,'retained hidden stale snapshots never form a new baseline');
    f.highlighter.update(observation(200,20));assert.equal(litCount(f),0,'first visible fresh observation is the resumed baseline');
    f.highlighter.update(observation(300,21));assert(lit(f.nodes[0]));
    f.highlighter.update(observation(300,21,{following:false}));
    f.highlighter.update(observation(400,22,{visible:false}));
    f.highlighter.update(observation(400,22));assert.equal(litCount(f),0,'a fresh hidden observation may safely clear the barrier');
    f.highlighter.update(observation(500,23));assert(lit(f.nodes[0]));f.highlighter.dispose();
  }
});

test('unknown and closed/newly-visible controls rebase independently without suppressing known Source changes',()=>{
  const f=fixture();f.availability[2]=false;f.highlighter.update(view(1,undefined,{unknownFields:['volume']}));
  assert.deepEqual(f.reads,[0,1,0]);
  f.availability[2]=true;f.highlighter.update(view(2,{volume:31,source:'noise',noise:20}));
  assert.deepEqual(f.nodes.map(lit),[false,true,false],'Source changed; Volume is first-known and Noise is newly visible');
  f.nodes[1].finish();f.highlighter.update(view(3,{volume:30,source:'noise',noise:19}));assert.deepEqual(f.nodes.map(lit),[true,false,true]);
  f.highlighter.update(view(3,undefined,{unknownFields:['volume','noise']}));assert.equal(litCount(f),0,'known-status loss clears even at unchanged revision');
  f.highlighter.update(view(3,{volume:12,source:'noise',noise:9}));assert.equal(litCount(f),0,'first-known at the same revision starts without a flash');
  f.availability[0]=false;f.highlighter.update(view(4,{volume:13,source:'wave',noise:10}));assert.deepEqual(f.nodes.map(lit),[false,true,true]);
  f.availability[0]=true;f.highlighter.update(view(4,{volume:13,source:'wave',noise:10}));assert(!lit(f.nodes[0]));f.highlighter.dispose();
});

test('animation cleanup also handles a reduced-motion pulse; clear/dispose release all classes and listeners',()=>{
  const f=fixture();f.highlighter.update(view());f.highlighter.update(view(2,{volume:10,source:'noise',noise:4}));assert.equal(litCount(f),3);
  f.nodes[0].finish({animationName:'other-animation'});f.nodes[0].finish({target:node()});assert(lit(f.nodes[0]));
  f.nodes[0].finish();assert(!lit(f.nodes[0]),'the same CSS animationend clears a 1ms reduced-motion pulse');
  f.highlighter.clear();assert.equal(litCount(f),0);f.highlighter.update(view(2,{volume:10,source:'noise',noise:4}));assert.equal(litCount(f),0);
  f.highlighter.dispose();f.highlighter.dispose();assert(f.nodes.every(element=>[...element.listeners.values()].every(set=>set.size===0)));
});

test('invalid controls reject before adding listeners and object readers clear visual state',()=>{
  const element=node();
  assert.throws(()=>createHuc6280LiveHighlighter({controls:[{element,path:'volume',read:()=>1},{element,path:'source',read:()=>2}]}),/distinct/);
  assert.equal(element.listeners.size,0);
  assert.throws(()=>createHuc6280LiveHighlighter({controls:[{element,path:'',read:()=>1}]}),/field paths/);
  const good=node(),bad=node();let value=1;
  const highlighter=createHuc6280LiveHighlighter({controls:[{element:good,path:'volume',read:()=>value},{element:bad,path:'wave',read:()=>value===1?1:[]} ]});
  highlighter.update(view());value=2;assert.throws(()=>highlighter.update(view(2)),/scalar/);assert(!lit(good)&&!lit(bad));highlighter.dispose();
});

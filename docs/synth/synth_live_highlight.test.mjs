import test from 'node:test';
import assert from 'node:assert/strict';
import {createSynthLiveHighlighter} from './synth_live_highlight.js';

function element() {
  const classes=new Set(),listeners=new Map(),writes=[];
  const node={
    classList:{
      add(name){writes.push(['add',name]);classes.add(name);},
      remove(name){writes.push(['remove',name]);classes.delete(name);},
      contains:name=>classes.has(name),
    },
    addEventListener(name,handler){assert(!listeners.has(name));listeners.set(name,handler);},
    removeEventListener(name,handler){assert.equal(listeners.get(name),handler);listeners.delete(name);},
    dispatch(name,properties={}){listeners.get(name)?.({target:node,...properties});},
    get offsetWidth(){assert.fail('Highlight must not force layout');},
    getBoundingClientRect(){assert.fail('Highlight must not measure layout');},
    animate(){assert.fail('CSS owns the pulse; helper must not create animations');},
    writes,listeners,
  };
  return node;
}
const view=(revision,values,options={})=>({snapshot:{revision,values},channel:0,paused:false,following:true,...options});
function fixture({enabled=true}={}) {
  const nodes=[element(),element()],reads=[0,0];
  const highlighter=createSynthLiveHighlighter({enabled,controls:nodes.map((element,index)=>({element,read:view=>{reads[index]++;return view.snapshot.values[index];}}))});
  return {nodes,reads,highlighter};
}
const highlighted=node=>node.classList.contains('is-live-changed');
const finish=node=>node.dispatch('animationend',{animationName:'synth-live-change'});

test('initial Live values establish a baseline and only changed scalar controls pulse', () => {
  const {nodes,reads,highlighter}=fixture();
  highlighter.update(view(1,[7,false]));
  assert.deepEqual(reads,[1,1]);assert(nodes.every(node=>!highlighted(node)));
  highlighter.update(view(2,[5,false]));
  assert(highlighted(nodes[0]));assert(!highlighted(nodes[1]));
  assert.deepEqual(nodes[0].writes,[['add','is-live-changed']]);
  finish(nodes[0]);assert(!highlighted(nodes[0]));
  highlighter.update(view(3,[5,true]));
  assert(!highlighted(nodes[0]));assert(highlighted(nodes[1]));
  highlighter.dispose();
});

test('partial initialization at frame zero never flashes before the first audible baseline', () => {
  const {nodes,reads,highlighter}=fixture();
  for(let revision=1;revision<=5;revision++) {
    const initial=view(revision,[revision,revision]);initial.snapshot.frame=0;
    highlighter.update(initial);
  }
  assert.deepEqual(reads,[0,0]);assert(nodes.every(node=>!highlighted(node)));
  const audible=view(6,[7,9]);audible.snapshot.frame=128;highlighter.update(audible);
  assert(nodes.every(node=>!highlighted(node)),'the first completed audible settings are a baseline');
  const changed=view(7,[8,9]);changed.snapshot.frame=256;highlighter.update(changed);
  assert(highlighted(nodes[0]));assert(!highlighted(nodes[1]));
  highlighter.dispose();
});

test('unchanged revisions skip readers; rapid changes do not restart an active pulse', () => {
  const {nodes,reads,highlighter}=fixture();
  highlighter.update(view(1,[0,0]));
  for(let frame=1;frame<=100;frame++)highlighter.update({...view(1,[0,0]),snapshot:{revision:1,frame}});
  assert.deepEqual(reads,[1,1],'new frame objects without register changes have no comparison work');
  for(let revision=2;revision<=102;revision++)highlighter.update(view(revision,[revision,0]));
  assert.deepEqual(nodes[0].writes,[['add','is-live-changed']],'all rapid writes share the same CSS pulse');
  finish(nodes[0]);
  highlighter.update(view(103,[103,0]));
  assert.deepEqual(nodes[0].writes,[['add','is-live-changed'],['remove','is-live-changed'],['add','is-live-changed']]);
  highlighter.dispose();
});

test('Off performs no view reads, comparisons or DOM work and re-enabling starts without a flash', () => {
  const {nodes,reads,highlighter}=fixture({enabled:false});
  const unreadable=new Proxy({}, {get(){assert.fail('Disabled highlight must not inspect the view');}});
  for(let index=0;index<100;index++)highlighter.update(unreadable);
  assert.deepEqual(reads,[0,0]);assert(nodes.every(node=>node.writes.length===0));
  highlighter.setEnabled(true);highlighter.update(view(1,[3,false]));
  assert(nodes.every(node=>!highlighted(node)));
  highlighter.update(view(2,[4,false]));assert(highlighted(nodes[0]));
  highlighter.setEnabled(false);assert(!highlighted(nodes[0]));
  const previousReads=[...reads],previousWrites=nodes.map(node=>node.writes.length);
  for(let index=0;index<100;index++)highlighter.update(unreadable);
  assert.deepEqual(reads,previousReads);assert.deepEqual(nodes.map(node=>node.writes.length),previousWrites);
  highlighter.setEnabled(true);highlighter.update(view(10,[99,true]));
  assert(nodes.every(node=>!highlighted(node)),'changes while disabled do not flash when enabled');
  highlighter.update(view(11,[100,true]));assert(highlighted(nodes[0]));
  highlighter.dispose();
});

test('channel switch, Pause, frozen Live and Synth exit clear pulses and rebase the next Live view', () => {
  const {nodes,highlighter}=fixture();
  highlighter.update(view(1,[0,0]));highlighter.update(view(2,[1,0]));assert(highlighted(nodes[0]));
  highlighter.update(view(3,[7,9],{channel:1}));assert(nodes.every(node=>!highlighted(node)));
  highlighter.update(view(4,[8,9],{channel:1}));assert(highlighted(nodes[0]));
  highlighter.update(view(4,[8,9],{channel:1,paused:true}));assert(nodes.every(node=>!highlighted(node)));
  highlighter.update(view(5,[10,9],{channel:1}));assert(nodes.every(node=>!highlighted(node)),'Resume has no synthetic change pulse');
  highlighter.update(view(6,[11,9],{channel:1}));assert(highlighted(nodes[0]));
  highlighter.update(view(6,[11,9],{channel:1,following:false}));assert(nodes.every(node=>!highlighted(node)));
  highlighter.update(view(20,[20,9],{channel:1}));assert(nodes.every(node=>!highlighted(node)),'Live On rebaselines the observed instant');
  highlighter.update(view(21,[21,9],{channel:1}));assert(highlighted(nodes[0]));
  highlighter.update(null);assert(nodes.every(node=>!highlighted(node)));
  highlighter.update(view(1,[0,0]));assert(nodes.every(node=>!highlighted(node)),'a new song starts cleanly');
  highlighter.dispose();
});

test('only this element and animation finish its pulse; disposal removes classes and handlers', () => {
  const {nodes,reads,highlighter}=fixture();
  highlighter.update(view(1,[0,0]));highlighter.update(view(2,[1,1]));
  nodes[0].dispatch('animationend',{animationName:'other-animation'});
  nodes[0].dispatch('animationend',{animationName:'synth-live-change',target:element()});
  assert(nodes.every(highlighted));
  finish(nodes[0]);assert(!highlighted(nodes[0]));assert(highlighted(nodes[1]));
  highlighter.dispose();assert(nodes.every(node=>!highlighted(node)&&node.listeners.size===0));
  const previous=[...reads],writes=nodes.map(node=>node.writes.length);
  highlighter.update(view(3,[2,2]));highlighter.setEnabled(false);highlighter.setEnabled(true);highlighter.dispose();
  assert.deepEqual(reads,previous);assert.deepEqual(nodes.map(node=>node.writes.length),writes);
});

test('snapshots without a revision still compare scalars and share one listener per element', () => {
  const node=element();let value=0;
  const highlighter=createSynthLiveHighlighter({controls:[{element:node,read:()=>value},{element:node,read:()=>value}]});
  highlighter.update({snapshot:{},channel:0});value=1;
  highlighter.update({snapshot:{},channel:0});assert(highlighted(node));
  assert.equal(node.listeners.size,1);assert.deepEqual(node.writes,[['add','is-live-changed']]);
  highlighter.clear();assert(!highlighted(node));
  highlighter.dispose();
});

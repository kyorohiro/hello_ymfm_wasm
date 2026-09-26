import test from 'node:test';
import assert from 'node:assert/strict';
import {createFXMonitor} from './playground_fx_monitor.js';
test('monitor tab and page visibility cancel capture; slow display cannot enqueue requests',()=>{
 const saved={document:globalThis.document,setInterval:globalThis.setInterval,clearInterval:globalThis.clearInterval};
 const elements=new Map(),handlers={},messages=[];let tick;
 const element=()=>({value:'',textContent:'',replaceChildren(){},getContext(){return {clearRect(){}};}});
 globalThis.document={hidden:false,getElementById(id){if(!elements.has(id))elements.set(id,element());return elements.get(id);},addEventListener(k,f){handlers[k]=f;},createElement:element};
 globalThis.setInterval=fn=>{tick=fn;return 1;};globalThis.clearInterval=()=>{};
 try {
  const rack={node:{port:{postMessage:d=>messages.push(d)}}};
  const monitor=createFXMonitor(()=>rack);
  monitor.setVisible(true);
  const first=messages.at(-1);assert.equal(first.enabled,true);
  tick();tick();assert.equal(messages.at(-1),first);
  rack.onMonitor({op:'fx-monitor',id:first.id,names:[]});
  tick();assert.notEqual(messages.at(-1).id,first.id);
  document.hidden=true;handlers.visibilitychange();assert.equal(messages.at(-1).enabled,false);
  const count=messages.length;tick();assert.equal(messages.length,count);
  document.hidden=false;handlers.visibilitychange();assert.equal(messages.at(-1).enabled,true);
  monitor.setVisible(false);assert.equal(messages.at(-1).enabled,false);
  const end=messages.length;tick();assert.equal(messages.length,end);
 }finally{Object.assign(globalThis,saved);}
});

test('snapshots keep option nodes stable; list changes defer while choosing and preserve selection',()=>{
 const saved={document:globalThis.document,setInterval:globalThis.setInterval,clearInterval:globalThis.clearInterval};
 const elements=new Map(),messages=[];let tick;
 const element=()=>({value:'',children:[],writes:0,replaceChildren(...nodes){this.children=nodes;this.writes++;},getContext(){return {clearRect(){}};}});
 globalThis.document={hidden:false,activeElement:null,getElementById(id){if(!elements.has(id))elements.set(id,element());return elements.get(id);},addEventListener(){},createElement:element};
 globalThis.setInterval=fn=>{tick=fn;return 1;};globalThis.clearInterval=()=>{};
 try{
  const rack={node:{port:{postMessage:d=>messages.push(d)}}};
  const monitor=createFXMonitor(()=>rack);monitor.setVisible(true);
  const select=elements.get('fxMonitorTarget');
  const receive=names=>rack.onMonitor({id:messages.at(-1).id,names});
  receive(['gain','filter']);
  assert.equal(select.writes,1);
  const nodes=select.children;
  select.value='filter';document.activeElement=select;
  for(let i=0;i<20;i++){tick();receive(['gain','filter']);}
  assert.equal(select.children,nodes);assert.equal(select.writes,1);assert.equal(select.value,'filter');
  tick();receive(['gain','filter','delay']);assert.equal(select.writes,1);
  select.onchange();assert.equal(messages.at(-1).name,'filter');
  document.activeElement=null;select.onblur();
  assert.equal(select.writes,2);assert.equal(select.value,'filter');
  tick();receive(['gain']);assert.equal(select.value,'gain');
  tick();receive([]);assert.equal(select.children.length,0);
  monitor.setVisible(false);
 }finally{Object.assign(globalThis,saved);}
});

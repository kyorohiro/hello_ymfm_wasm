import test from 'node:test';
import assert from 'node:assert/strict';
import {mountScoreGroups,getScoreGroups} from './score_group_ui.js';

// Minimal DOM harness exercises the actual button handlers and per-source state.
class Element {
 constructor(tag='div'){this.tag=tag;this.children=[];this.value='';this.checked=false;this.handlers={};this.style={};}
 append(...items){this.children.push(...items);}
 replaceChildren(...items){this.children=items;}
 addEventListener(name,fn){this.handlers[name]=fn;}
 showModal(){this.open=true;}
 querySelector(selector){return this.fields[selector];}
 querySelectorAll(selector){const all=this.children.flatMap(c=>c instanceof Element?[c,...c.querySelectorAll('*')]:[]);return selector==='*'?all:all.filter(c=>c.tag==='input'&&(selector!=='input:checked'||c.checked));}
 click(){(this.onclick??this.handlers.click)();}
}
test('Group dialog creates, edits, removes, merges and rejects stale source changes',()=>{
 const previous=globalThis.document,dialog=new Element(),open=new Element('button');
 dialog.fields=Object.fromEntries(['channels','groups','name','error','save','all','clear'].map(k=>['[data-'+k+']',new Element()]));
 globalThis.document={getElementById:()=>dialog,querySelectorAll:()=>[open],createElement:t=>new Element(t),createTextNode:t=>t};
 try {
  let source=new Uint8Array(1),changes=0,status='';
  const channels=[{name:'YMF262 CH1',notes:[]},{name:'YMF262 CH5',notes:[]}];
  mountScoreGroups({getTrack:()=>({buffer:source}),getAnalysis:()=>({channels}),onChange:()=>changes++,setStatus:s=>status=s});
  const field=k=>dialog.fields['[data-'+k+']'];
  open.click();assert.equal(dialog.open,true);
  field('channels').querySelectorAll('input')[0].checked=true;field('name').value='Lead';field('save').click();
  assert.equal(getScoreGroups(source)[0].name,'Lead');
  field('groups').children[0].children[1].click(); // Edit
  field('channels').querySelectorAll('input')[1].checked=true;field('name').value='Piano';field('save').click();
  assert.equal(getScoreGroups(source).length,1);assert.equal(getScoreGroups(source)[0].channels.length,2);
  field('groups').children[0].children[2].click(); // Remove
  assert.equal(getScoreGroups(source).length,0);
  field('all').click();assert.equal(getScoreGroups(source)[0].channels.length,2);
  const old=source;source=new Uint8Array(1);
  field('groups').children[0].children[2].click();assert.match(status,/Track changed/);
  assert.equal(getScoreGroups(old).length,1);assert.equal(getScoreGroups(source).length,0);
  open.click();field('all').click();field('clear').click();assert.equal(getScoreGroups(source).length,0);
  assert.equal(changes,6);
 }finally{globalThis.document=previous;}
});

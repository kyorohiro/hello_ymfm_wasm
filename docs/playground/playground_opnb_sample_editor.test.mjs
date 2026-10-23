import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlaygroundOpnbSampleEditor} from './playground_opnb_sample_editor.js';
class Element{
  constructor(doc){this.ownerDocument=doc;this.children=[];this.dataset={};this.events={};this.value='';this.checked=false;}
  append(...nodes){this.children.push(...nodes);}addEventListener(name,fn){(this.events[name]??=[]).push(fn);}fire(name){for(const fn of this.events[name]??[])fn({target:this});}
  change(value){if(typeof value==='boolean')this.checked=value;else this.value=String(value);this.fire('change');}setCustomValidity(value){this.error=value;}
}
function setup(){const doc={createElement:()=>new Element(doc)},root=new Element(doc),writes=[],targets=[];
  const editor=createPlaygroundOpnbSampleEditor({root,onEdit:(method,args)=>writes.push({method,args}),onTargetChange:()=>targets.push(editor.getSelectedTarget())});const controls={};function visit(n){if(n.dataset.opnbControl)controls[n.dataset.opnbControl]=n;for(const c of n.children)visit(c);}visit(root);
  const registers=[Array(256).fill(0),Array(256).fill(0)];Object.assign(registers[1],{1:45,8:0x93,13:0x51,0x10:2,0x20:3,0x15:4,0x25:5});Object.assign(registers[0],{0x11:0xc0,0x12:7,0x14:8,0x19:0x34,0x1a:0x12,0x1b:127});
  const snapshot={registers,romBytes:[4096,8192],romAllocatedBytes:[65536,65536],statusHi:128};editor.update(snapshot);return {doc,root,editor,controls,writes,targets,snapshot};
}
test('OPNB observes separate ROM sources and applied ranges without writes or retriggers',()=>{
  const f=setup(),c=f.controls;assert.equal(c['a-global'].value,'45');assert.equal(c['a-level'].value,'19');assert.equal(c['a-start'].value,'512');assert.equal(c['a-end'].value,'1024');assert.equal(c['a-left'].checked,true);assert.equal(c['a-right'].checked,false);
  assert.equal(c['b-start'].value,'1792');assert.equal(c['b-end'].value,'2304');assert.equal(c['b-delta'].value,'4660');assert.equal(c['b-level'].value,'127');assert.deepEqual(f.writes,[]);
  assert.match(f.root.children.at(-1).textContent,/A 4096 \/ B 8192/);assert.match(f.root.children.at(-1).textContent,/allocated: A 65536 \/ B 65536/);
});
test('ADPCM-A voice ranges and ADPCM-B controls edit their own APIs and Keyboard targets',()=>{
  const f=setup(),c=f.controls;c['a-voice'].change(5);assert.equal(f.editor.getSelectedTarget(),'adpcm-a:5');assert.equal(c['a-start'].value,'1024');assert.equal(c['a-level'].value,'17');c['a-level'].change(12);assert.deepEqual(f.writes.at(-1),{method:'adpcmA.setVoice',args:[5,{volume:12}]});
  c['a-start'].change(768);assert.deepEqual(f.writes.at(-1),{method:'adpcmA.setSample',args:[5,{start:768,end:1536}]});c['b-level'].fire('focus');assert.equal(f.editor.getSelectedTarget(),'adpcm-b:0');c['b-level'].change(200);assert.deepEqual(f.writes.at(-1),{method:'adpcmB.setVolume',args:[200]});
  c['b-left'].change(false);assert.deepEqual(f.writes.at(-1),{method:'adpcmB.setPan',args:[false,true]});c['b-end'].change(0x1000000);assert.deepEqual(f.writes.at(-1),{method:'adpcmB.setSample',args:[{start:1792,end:0x1000000}]});
});
test('range validation rejects unaligned, empty and ADPCM-A one-MiB ranges before any edit',()=>{
  const f=setup(),c=f.controls;c['a-start'].change(513);assert.equal(f.writes.length,0);assert(c['a-start'].error);c['a-start'].value='0';c['a-end'].change(0x100000);assert.equal(f.writes.length,0);
  c['a-end'].change(0x100000-256);assert.deepEqual(f.writes.at(-1),{method:'adpcmA.setSample',args:[0,{start:0,end:0x100000-256}]});c['b-start'].change(2304);c['b-delta'].change(0);assert.equal(f.writes.length,1);
});
test('snapshot refresh preserves focused user input and disposal fences stale editors',()=>{
  const f=setup(),c=f.controls;f.doc.activeElement=c['b-delta'];c['b-delta'].value='3000';f.editor.update(f.snapshot);assert.equal(c['b-delta'].value,'3000');
  f.editor.dispose();const count=f.targets.length;c['a-voice'].change(5);c['b-level'].fire('focus');c['b-level'].change(255);assert.equal(f.targets.length,count);assert.deepEqual(f.writes,[]);
});

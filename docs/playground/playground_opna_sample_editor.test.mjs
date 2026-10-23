import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlaygroundOpnaSampleEditor} from './playground_opna_sample_editor.js';
class Element{
  constructor(doc){this.ownerDocument=doc;this.children=[];this.dataset={};this.events={};this.value='';this.checked=false;}
  append(...nodes){this.children.push(...nodes);}
  addEventListener(name,fn){(this.events[name]??=[]).push(fn);}
  fire(name){for(const fn of this.events[name]??[])fn({target:this});}
  change(value){if(typeof value==='boolean')this.checked=value;else this.value=String(value);this.fire('change');}
  setCustomValidity(value){this.error=value;}
}
function setup(){const doc={createElement:()=>new Element(doc)},root=new Element(doc),writes=[],targets=[];
  const editor=createPlaygroundOpnaSampleEditor({root,onEdit:(method,args)=>writes.push({method,args}),onTargetChange:()=>targets.push(editor.getSelectedTarget())});
  const controls={};function visit(n){if(n.dataset.opnaControl)controls[n.dataset.opnaControl]=n;for(const child of n.children)visit(child);}visit(root);
  const registers=[Array(256).fill(0),Array(256).fill(0)];Object.assign(registers[0],{0x11:45,0x18:0x93,0x1d:0x51});Object.assign(registers[1],{1:0xc2,2:2,4:3,9:0x34,10:0x12,11:127});
  const snapshot={registers,romLoaded:true,adpcmMemoryBytes:1024,statusHi:32};editor.update(snapshot);return {editor,controls,writes,targets,snapshot};
}
test('OPNA sample view reads applied registers without changing audio or retriggering voices',()=>{
  const f=setup();assert.equal(f.controls['rhythm-global'].value,'45');assert.equal(f.controls['rhythm-level'].value,'19');assert.equal(f.controls['rhythm-left'].checked,true);assert.equal(f.controls['rhythm-right'].checked,false);
  assert.equal(f.controls['adpcm-start'].value,'64');assert.equal(f.controls['adpcm-end'].value,'128');assert.equal(f.controls['adpcm-delta'].value,'4660');assert.equal(f.controls['adpcm-level'].value,'127');assert.deepEqual(f.writes,[]);
});
test('rhythm voice and ADPCM controls publish their own Keyboard targets and API edits',()=>{
  const f=setup();f.controls['rhythm-voice'].change(5);assert.equal(f.editor.getSelectedTarget(),'rhythm:5');assert.equal(f.controls['rhythm-level'].value,'17');
  f.controls['rhythm-level'].change(12);assert.deepEqual(f.writes.at(-1),{method:'rhythm.setVoice',args:[5,{volume:12}]});
  f.controls['adpcm-level'].fire('focus');assert.equal(f.editor.getSelectedTarget(),'adpcm-b:0');f.controls['adpcm-level'].change(200);assert.deepEqual(f.writes.at(-1),{method:'adpcm.setVolume',args:[200]});
  f.controls['adpcm-left'].change(false);assert.deepEqual(f.writes.at(-1),{method:'adpcm.setPan',args:[false,true]});
});
test('sample range validates both aligned boundaries before submitting an edit',()=>{
  const f=setup();f.controls['adpcm-start'].change(65);assert.deepEqual(f.writes,[]);assert(f.controls['adpcm-start'].error);
  f.controls['adpcm-start'].change(32);assert.deepEqual(f.writes,[{method:'adpcm.setSample',args:[{start:32,end:128}]}]);assert.equal(f.controls['adpcm-start'].error,'');
  f.controls['adpcm-end'].change(32);assert.equal(f.writes.length,1);f.controls['adpcm-delta'].change(0);assert.equal(f.writes.length,1);
});
test('disposed controls cannot redirect Keyboard or edit a replacement source',()=>{
  const f=setup();f.editor.dispose();const count=f.targets.length;f.controls['rhythm-voice'].change(5);f.controls['adpcm-level'].fire('focus');f.controls['adpcm-level'].change(255);assert.equal(f.targets.length,count);assert.deepEqual(f.writes,[]);
});

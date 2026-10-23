import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlaygroundOpnSsgEditor} from './playground_opn_ssg_editor.js';
class Element {
  constructor(doc){this.ownerDocument=doc;this.children=[];this.dataset={};this.events={};this.value='';this.checked=false;}
  append(...nodes){this.children.push(...nodes);}
  addEventListener(name,fn){this.events[name]=fn;}
  change(value){if(typeof value==='boolean')this.checked=value;else this.value=String(value);this.events.change?.();}
  setCustomValidity(message){this.error=message;}
}
function setup(){const doc={createElement:()=>new Element(doc)},root=new Element(doc),writes=[],targets=[];
  const editor=createPlaygroundOpnSsgEditor({root,onEdit:(method,args)=>writes.push({method,args}),onTargetChange:()=>targets.push(editor.getSelectedChannel())});
  const controls={};function visit(node){if(node.dataset.ssgControl)controls[node.dataset.ssgControl]=node;for(const child of node.children)visit(child);}visit(root);
  const registers=[Array(256).fill(0)];Object.assign(registers[0],{0:123,1:2,6:17,7:0x38,8:0,11:4,12:3,13:14});
  const snapshot={registers,ssgLevels:[12,16,0],held:['ssg:0']};return {editor,controls,writes,targets,snapshot};
}
test('SSG applied view preserves retained silent levels and never writes on refresh',()=>{
  const f=setup();f.editor.update(f.snapshot);assert.equal(f.controls.period.value,'635');assert.equal(f.controls.volume.value,'12');assert.equal(f.controls.tone.checked,true);assert.equal(f.controls.noise.checked,false);assert.equal(f.controls['noise-period'].value,'17');assert.deepEqual(f.writes,[]);
  f.controls.channel.change(1);assert.equal(f.controls.envelope.checked,true);assert.deepEqual(f.targets,[1]);assert.deepEqual(f.writes,[]);
});
test('SSG period edits preserve envelope phase; explicit shape edits retrigger shared envelope',()=>{
  const f=setup();f.editor.update(f.snapshot);f.controls['envelope-period'].change(1025);
  assert.deepEqual(f.writes,[{method:'ssg.write',args:[11,1]},{method:'ssg.write',args:[12,4]}]);
  f.controls['envelope-shape'].change(10);assert.deepEqual(f.writes.at(-1),{method:'ssg.setEnvelope',args:[{period:1025,shape:10}]});
  f.controls.channel.change(2);f.controls.volume.change(7);assert.deepEqual(f.writes.at(-1),{method:'ssg.setVolume',args:[2,7,false]});
});
test('invalid or disposed SSG controls cannot submit audio edits',()=>{
  const f=setup();f.editor.update(f.snapshot);f.controls.period.change(4096);assert.deepEqual(f.writes,[]);assert(f.controls.period.error);
  f.controls.period.change(4095);assert.equal(f.writes.length,1);assert.equal(f.controls.period.error,'');f.editor.dispose();f.controls.period.change(1);assert.equal(f.writes.length,1);
  const targets=f.targets.length;f.controls.channel.change(2);assert.equal(f.targets.length,targets);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {createParamControl} from './synth_controls.js';

function setup(options={}) {
 const previous=globalThis.document;
 globalThis.document={createElement(){const captures=new Set();return {
  children:[],listeners:{},classList:{add(){},remove(){},toggle(){}},
  setAttribute(){},appendChild(child){this.children.push(child);},
  addEventListener(name,fn){this.listeners[name]=fn;},
  setPointerCapture(id){captures.add(id);},hasPointerCapture:id=>captures.has(id),releasePointerCapture(id){captures.delete(id);this.listeners.lostpointercapture?.({pointerId:id});},
 };}};
 try {
  const changes=[];
  const control=createParamControl({label:'TL',min:0,max:127,step:1,value:8,onChange:v=>changes.push(v),...options});
  return {control,changes,buttons:control.element.children.filter(e=>e.className?.startsWith('param-')&&e.className!=='param-label')};
 } finally {globalThis.document=previous;}
}
test('external preset/channel updates set the current value for plus, minus and wheel without emitting edits',()=>{
 const {control,changes,buttons:[minus,value,plus]}=setup();
 control.updateVisual(32);
 assert.equal(value.textContent,'32');assert.deepEqual(changes,[]);
 plus.listeners.click();assert.equal(value.textContent,'33');
 minus.listeners.click();assert.equal(value.textContent,'32');
 control.updateVisual(2);minus.listeners.click();assert.equal(value.textContent,'1');
 control.updateVisual(127);plus.listeners.click();assert.equal(value.textContent,'127');
 control.updateVisual(0);minus.listeners.click();assert.equal(value.textContent,'0');
 control.updateVisual(20);
 control.element.listeners.wheel({deltaY:-1,preventDefault(){}});
 assert.equal(value.textContent,'21');
 assert.deepEqual(changes,[33,32,1,127,0,21]);
});

test('dynamic numeric bounds scale pointer motion to the loaded sample while +/- and wheel remain single-step',()=>{
 const {control,changes,buttons:[minus,value,plus]}=setup({min:0,max:65503,value:0});
 control.updateRange(0,255);
 value.listeners.pointerdown({pointerId:1,clientX:40});
 value.listeners.pointermove({pointerId:1,clientX:41});assert.equal(value.textContent,'2');
 value.listeners.pointermove({pointerId:1,clientX:48});assert.equal(value.textContent,'13');
 value.listeners.pointerup({pointerId:1});
 plus.listeners.click();minus.listeners.click();assert.equal(value.textContent,'13');
 control.element.listeners.wheel({deltaY:-1,preventDefault(){}});assert.equal(value.textContent,'14');
 assert.deepEqual(changes,[2,13,14,13,14]);
 control.updateRange(5,10);assert.equal(value.textContent,'10');assert.equal(changes.length,5,'changing legal bounds does not emit a user edit');
 assert.throws(()=>control.updateRange(10,5),/range/);assert.throws(()=>control.updateRange(0,NaN),/range/);
});

test('range replacement cancels old pointer ownership, unchanged bounds and visual refreshes preserve an active gesture',()=>{
 const {control,changes,buttons:[,value]}=setup({min:0,max:255,value:32});
 value.listeners.pointerdown({pointerId:3,clientX:0});value.listeners.pointermove({pointerId:3,clientX:10});
 assert.equal(value.textContent,'48');
 control.updateRange(0,255);control.updateVisual(48);
 value.listeners.pointermove({pointerId:3,clientX:20});assert.equal(value.textContent,'64');
 control.updateRange(0,127);assert.equal(value.hasPointerCapture(3),false);
 control.updateVisual(7);value.listeners.pointermove({pointerId:3,clientX:80});assert.equal(value.textContent,'7');
 value.listeners.pointerdown({pointerId:4,clientX:0});control.cancelDrag();
 value.listeners.pointermove({pointerId:4,clientX:100});assert.equal(value.textContent,'7');
 assert.deepEqual(changes,[48,64]);
});

test('a one-value interval stays fixed and read-only nonnumeric displays survive a bounds update',()=>{
 const {control,changes,buttons:[,value]}=setup({min:0,max:65503,value:0});
 control.updateRange(0,0);value.listeners.pointerdown({pointerId:1,clientX:0});
 value.listeners.pointermove({pointerId:1,clientX:100});assert.equal(value.textContent,'0');
 control.updateVisual('—');control.updateRange(1,100);assert.equal(value.textContent,'—');
 assert.deepEqual(changes,[0]);
});
test('externally synchronized boolean toggles from displayed value',()=>{
 const {control,changes,buttons:[value]}=setup({booleanMode:true,value:false,min:0,max:1});
 control.updateVisual(true);
 value.listeners.pointerdown({});
 assert.equal(value.textContent,'OFF');assert.deepEqual(changes,[false]);
});

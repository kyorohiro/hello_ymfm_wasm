import test from 'node:test';
import assert from 'node:assert/strict';
import {createParamControl} from './synth_controls.js';

function setup(options={}) {
 const previous=globalThis.document;
 globalThis.document={createElement(){return {
  children:[],listeners:{},classList:{add(){},remove(){},toggle(){}},
  setAttribute(){},appendChild(child){this.children.push(child);},
  addEventListener(name,fn){this.listeners[name]=fn;},
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
test('externally synchronized boolean toggles from displayed value',()=>{
 const {control,changes,buttons:[value]}=setup({booleanMode:true,value:false,min:0,max:1});
 control.updateVisual(true);
 value.listeners.pointerdown({});
 assert.equal(value.textContent,'OFF');assert.deepEqual(changes,[false]);
});

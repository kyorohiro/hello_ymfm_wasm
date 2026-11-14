// SPDX-License-Identifier: BSD-3-Clause
// Exercise the real editor with an inert DOM; no browser or audio is created.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createEditor} from './editor.js';
import {createDefaultPreset,waveShape} from './preset.js';

class Element {
  constructor(doc,tag='div'){
    Object.assign(this,{ownerDocument:doc,tagName:tag.toUpperCase(),children:[],dataset:{},attributes:{},listeners:new Map(),value:'',textContent:'',disabled:false,hidden:false,checked:false,clientWidth:320,clientHeight:180});
    const classes=new Set();this.classList={add:(...v)=>v.forEach(x=>classes.add(x)),remove:(...v)=>v.forEach(x=>classes.delete(x)),contains:x=>classes.has(x)};
  }
  append(...nodes){for(const node of nodes){node.parentElement=this;this.children.push(node);}}
  prepend(...nodes){for(const node of nodes)node.parentElement=this;this.children.unshift(...nodes);}
  remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(node=>node!==this);this.parentElement=null;}
  setAttribute(key,value){this.attributes[key]=String(value);}removeAttribute(key){delete this.attributes[key];}getAttribute(key){return this.attributes[key]??null;}
  addEventListener(type,fn){if(!this.listeners.has(type))this.listeners.set(type,new Set());this.listeners.get(type).add(fn);}
  removeEventListener(type,fn){this.listeners.get(type)?.delete(fn);}
  async fire(type,extra={}){if(this.disabled&&['click','pointerdown','keydown'].includes(type))return;
    const event={target:this,button:0,pointerId:1,clientX:10,clientY:10,preventDefault(){this.defaultPrevented=true;},stopPropagation(){},...extra};
    for(const fn of this.listeners.get(type)??[])await fn(event);return event;
  }
  focus(){this.ownerDocument.activeElement=this;}blur(){if(this.ownerDocument.activeElement===this)this.ownerDocument.activeElement=null;}
  setPointerCapture(id){this.capture=id;}hasPointerCapture(id){return this.capture===id;}releasePointerCapture(){this.capture=null;}
  querySelectorAll(selector){return walk(this).slice(1).filter(node=>selector==='button'&&node.tagName==='BUTTON');}
  getContext(){return null;}getBoundingClientRect(){return{left:0,top:0,width:320,height:180};}
}
const walk=node=>[node,...node.children.flatMap(walk)];
function fixture(t){
  const doc={activeElement:null},root=new Element(doc),changes=[],errors=[];
  doc.defaultView=new Element(doc);doc.createElement=tag=>new Element(doc,tag);doc.getElementById=id=>walk(root).find(node=>node.id===id);
  const editor=createEditor({root,onChange:value=>changes.push(value),onError:error=>errors.push(error)});t.after(()=>editor.dispose());
  return{editor,root,changes,errors,get:id=>doc.getElementById(id),choice:(id,value)=>walk(root).find(node=>node.dataset.choiceFor===id&&node.dataset.choiceValue===value),step:(id,delta)=>walk(root).find(node=>node.dataset.stepperFor===id&&node.dataset.stepperDelta===String(delta))};
}
const live=(channel=0,extra={})=>({physical:true,readOnly:false,origin:'VGM',channel,waveKnown:true,lfoWaveKnown:true,unknownFields:[],...extra});

test('playing VGM keeps hardware controls editable while software Envelope, PCM source and follow-mode remain unavailable',async t=>{
  const f=fixture(t),preset=createDefaultPreset();preset.lfo.enabled=true;f.editor.update(preset,live());
  assert.equal(f.step('volume',1).disabled,false);assert.equal(f.get('envelopeEnabled').disabled,true);
  assert(f.get('lfoMode').querySelectorAll('button').every(button=>button.disabled));
  assert.equal(f.choice('source','dda').disabled,true);assert.equal(f.choice('source','noise').disabled,true);
  await f.step('volume',1).fire('click');assert.equal(f.changes.at(-1).volume,preset.volume+1);
  f.editor.update(preset,{physical:true,origin:'Code',channel:0});
  assert.equal(f.get('envelopeEnabled').disabled,false);assert.equal(f.choice('source','dda').disabled,false);
  assert.equal(f.errors.length,0);
});

test('source keyboard navigation skips unsupported live DDA and early-channel Noise choices',async t=>{
  const f=fixture(t),preset=createDefaultPreset();f.editor.update(preset,live(0));
  await f.get('source').fire('keydown',{key:'End'});assert.equal(f.changes.length,0,'CH1 cannot navigate into Noise or DDA');
  f.editor.update(preset,live(4));await f.get('source').fire('keydown',{key:'End'});assert.equal(f.changes.at(-1).source,'noise');
  const dda=createDefaultPreset();dda.source='dda';f.editor.update(dda,live(4));
  assert.equal(f.choice('source','dda').disabled,true);assert.equal(f.choice('source','wave').tabIndex,0,'a readable DDA indicator does not remove keyboard access to valid source choices');
  await f.get('source').fire('keydown',{key:'Home'});assert.equal(f.changes.at(-1).source,'wave');assert.equal(f.errors.length,0);
});

test('Synth view keeps its software controls and source choices while a VGM is playing',async t=>{
  const f=fixture(t),preset=createDefaultPreset();
  f.editor.update(preset,live(0));assert.equal(f.get('envelopeEnabled').disabled,true);
  f.editor.update(preset,live(null,{physical:false}));
  assert.equal(f.get('envelopeEnabled').disabled,false);assert.equal(f.choice('source','noise').disabled,false);assert.equal(f.choice('source','dda').disabled,false);
  preset.source='dda';f.editor.update(preset,live(0));assert.equal(f.get('loadDdaAudio').parentElement.hidden,true);
  f.editor.update(preset,live(null,{physical:false}));assert.equal(f.get('loadDdaAudio').parentElement.hidden,false);assert.equal(f.get('ddaLoadStatus').hidden,false);
  await f.get('envelopeEnabled').fire('change');assert.equal(f.errors.length,0);
});

test('unknown live fields stay disabled and unknown Wave RAM cannot be filled by a partial mouse stroke',async t=>{
  const f=fixture(t),preset=createDefaultPreset();preset.wave.fill(0);f.editor.update(preset,live(0,{waveKnown:false,unknownFields:['volume','pan.left','pan.right']}));
  assert.equal(f.step('volume',1).disabled,true);assert.equal(f.get('volume').textContent,'—');assert.equal(f.step('panLeft',1).disabled,true);
  await f.get('waveCanvas').fire('pointerdown');await f.get('waveCanvas').fire('pointerup');assert.equal(f.changes.length,0);
  await walk(f.root).find(node=>node.dataset.waveShape==='sine').fire('click');assert.deepEqual(f.changes.at(-1).wave,waveShape('sine'),'an explicit complete replacement is allowed');
  f.editor.update(preset,live(0,{readOnly:true}));assert.equal(f.step('volume',1).disabled,true);assert(walk(f.root).filter(node=>node.dataset.waveShape).every(node=>node.disabled));assert.equal(f.errors.length,0);
});

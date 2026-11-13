import test from 'node:test';
import assert from 'node:assert/strict';
import {setupSynthPcmControls} from './synth_pcm_controls.js';
import {createPcmPreset,createSynthPcmVoice,PCM_ENCODING} from './synth_pcm.js';

class Element {
  constructor(tag='div') {
    this.tagName=tag.toUpperCase();this.children=[];this.listeners=new Map();this.dataset={};this.attributes={};this.className='';this.hidden=false;this.inert=false;
    const names=new Set();this.classList={add:(...args)=>args.forEach(name=>names.add(name)),remove:name=>names.delete(name),contains:name=>names.has(name),toggle:(name,on)=>{on??=!names.has(name);on?names.add(name):names.delete(name);return on;}};
    this.captures=new Set();
  }
  appendChild(child){child.parentElement=this;this.children.push(child);return child;}
  setAttribute(name,value){this.attributes[name]=String(value);}
  getAttribute(name){return this.attributes[name]??null;}
  addEventListener(type,handler){if(!this.listeners.has(type))this.listeners.set(type,new Set());this.listeners.get(type).add(handler);}
  removeEventListener(type,handler){this.listeners.get(type)?.delete(handler);}
  fire(type,details={}) {const event={button:0,pointerId:1,clientX:0,clientY:0,preventDefault(){},stopPropagation(){},...details};for(const handler of this.listeners.get(type)??[])handler(event);}
  replaceWith(node){const parent=this.parentElement;parent.children.splice(parent.children.indexOf(this),1,node);node.parentElement=parent;}
  matches(selector){return selector.startsWith('.')?this.className.split(' ').includes(selector.slice(1)):selector==='button'?this.tagName==='BUTTON':selector.startsWith('[')?Object.hasOwn(this.dataset,selector.slice(6,-1).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())):this.tagName.toLowerCase()===selector;}
  querySelectorAll(selector){return this.children.flatMap(child=>[...(child.matches(selector)?[child]:[]),...child.querySelectorAll(selector)]);}
  querySelector(selector){return this.querySelectorAll(selector)[0]??null;}
  closest(selector){return this.matches(selector)?this:this.parentElement?.closest(selector)??null;}
  contains(node){return node===this||this.children.some(child=>child.contains(node));}
  setPointerCapture(id){this.captures.add(id);}
  hasPointerCapture(id){return this.captures.has(id);}
  releasePointerCapture(id){this.captures.delete(id);this.fire('lostpointercapture',{pointerId:id});}
  focus(){}blur(){}click(){this.fire('click');}
}
const sample=(frames,settings={})=>createPcmPreset({sample:{name:`${frames} source`,sampleRate:22050,encoding:PCM_ENCODING,
  data:Buffer.from(Uint8Array.from({length:frames},(_,i)=>128+i%127)).toString('base64')},settings});
function harness(frames=256,settings={}) {
  const previous=new Map(['document','window'].map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)]));
  const body=new Element(),editor=body.appendChild(new Element());editor.className='synth-editor';editor.setAttribute('aria-busy','false');
  const root=editor.appendChild(new Element());root.id='synthChipPcm';const placeholders=new Map();
  const find=(node,id)=>node.id===id?node:node.children.map(child=>find(child,id)).find(Boolean);
  const byId=id=>find(body,id)??(()=>{const node=root.appendChild(new Element());node.id=id;placeholders.set(id,node);return node;})();
  const canvas=byId('synthPcmCanvas');canvas.width=640;canvas.height=180;
  canvas.getContext=()=>new Proxy({measureText:text=>({width:text.length*7})},{get:(target,name)=>target[name]??(()=>{})});
  canvas.getBoundingClientRect=()=>({left:0,top:0,width:640,height:180});
  const document=new Element();document.body=body;document.getElementById=byId;document.createElement=tag=>new Element(tag);document.hidden=false;
  globalThis.document=document;globalThis.window=new Element();
  const voice=createSynthPcmVoice({getPcm:()=>null,preset:sample(frames,settings)}),patches=[],observations=[];
  const controls=setupSynthPcmControls({voice,onSettingsChange:patch=>{patches.push(patch);voice.setSettings(patch);},onObservationEdit:patch=>observations.push(patch)});
  const value=name=>byId('synthPcm'+name),gesture=(name,delta)=>{const node=value(name);node.fire('pointerdown',{clientX:100});node.fire('pointermove',{clientX:100+delta});node.fire('pointerup');return Number(node.textContent);};
  return {voice,controls,patches,observations,value,gesture,byId,cleanup(){controls.dispose();for(const [name,descriptor]of previous)descriptor?Object.defineProperty(globalThis,name,descriptor):delete globalThis[name];}};
}

test('PCM frame drags use the actual short and long sample interval, not shared RAM capacity',()=>{
  for(const frames of [1,128,256,4096]) {
    const h=harness(frames);
    try {
      const start=h.gesture('LoopStart',2);assert.equal(start,Math.round(2*(frames-1)/160));
      assert(start<frames);if(frames>1)assert(start>0&&start<frames-1);
      const end=h.gesture('LoopEnd',-2);assert.equal(end,frames+Math.round(-2*(frames-start-1)/160));
      assert(end>start&&end<=frames);if(frames>1)assert(end<frames);
      assert.equal(h.voice.getState().frames,frames);assert.equal(h.value('LoopEnd').textContent,String(end));
      if(frames===1)assert.deepEqual(h.patches,[],'single-frame boundaries do not fabricate edits');
    }finally{h.cleanup();}
  }
});

test('moving the other loop endpoint updates legal numeric bounds and buttons remain single-frame edits',()=>{
  const h=harness(4096,{loopStart:1000,loopEnd:3000});
  try {
    assert.equal(h.gesture('LoopStart',8),1150);
    const end=h.gesture('LoopEnd',-8);assert.equal(end,2853);
    const start=h.gesture('LoopStart',8);assert.equal(start,1293);
    const node=h.value('LoopStart'),buttons=node.parentElement.querySelectorAll('button');
    buttons[2].click();assert.equal(h.voice.getSettings().loopStart,start+1);buttons[0].click();assert.equal(h.voice.getSettings().loopStart,start);
    assert.equal(h.voice.getSettings().loopEnd,end);
  }finally{h.cleanup();}
});

test('preset replacement cancels an old numeric gesture even for the same sample length and subsequent drags use the new length',()=>{
  const h=harness(256);
  try {
    for(const frames of [256,1021,128]) {
      const node=h.value('LoopStart');node.fire('pointerdown',{clientX:0});assert(node.hasPointerCapture(1));
      const next=sample(frames,{loopStart:7,loopEnd:frames-3});next.sample.name+=' replacement';
      h.voice.setPreset(next);h.controls.update();assert.equal(node.hasPointerCapture(1),false);
      const count=h.patches.length;node.fire('pointermove',{clientX:80});assert.equal(h.patches.length,count);assert.equal(node.textContent,'7');
      const value=h.gesture('LoopStart',8);assert.equal(value,7+Math.round(8*(frames-4)/160));
      assert.equal(h.voice.getState().frames,frames);
    }
  }finally{h.cleanup();}
});

test('read-only physical RAM addresses and missing end markers stay visible without clamping to authored sample bounds',()=>{
  const h=harness(128);
  try {
    const node=h.value('LoopStart');node.fire('pointerdown',{clientX:0});
    h.controls.update({channel:7,frames:128,preset:h.voice.getPreset(),volume:20,panLeft:2,panRight:3,step:1024,
      sourceStart:8192,sourceLoopStart:8208,sourceEnd:null,sampleRateHz:22050,editable:true});
    assert.equal(node.hasPointerCapture(1),false);assert.equal(node.textContent,'8208');assert.equal(h.value('LoopEnd').textContent,'—');
    const count=h.patches.length;node.fire('pointermove',{clientX:80});assert.equal(h.patches.length,count);
    h.controls.update(null);assert.equal(node.textContent,'0');assert.equal(h.value('LoopEnd').textContent,'128');
    assert.equal(h.gesture('LoopStart',8),6);
  }finally{h.cleanup();}
});

test('live source RAM changes preserve an active editable hardware volume gesture',()=>{
  const h=harness(128);
  try {
    const display={channel:7,frames:128,preset:sample(128,{volume:20}),volume:20,panLeft:2,panRight:3,step:1024,
      sourceStart:8192,sourceLoopStart:8208,sourceEnd:null,sampleRateHz:22050,editable:true};
    h.controls.update(display);
    const node=h.value('Volume');node.fire('pointerdown',{clientX:0});
    const next=structuredClone(display);next.preset.sample.data=Buffer.from(new Uint8Array(128).fill(170)).toString('base64');
    h.controls.update(next);assert(node.hasPointerCapture(1));
    node.fire('pointermove',{clientX:8});assert.deepEqual(h.observations,[{volume:33}]);
    assert.deepEqual(h.patches,[],'source edits never mutate the authored sample');
  }finally{h.cleanup();}
});

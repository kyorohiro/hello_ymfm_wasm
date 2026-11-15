// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlaygroundScspVoicePanel} from '../playground/playground_scsp_voice_panel.js';

class Node {
  constructor(tag,doc){this.tagName=tag;this.ownerDocument=doc;this.children=[];this.dataset={};this.style={};this.events=new Map();this.value='';this.textContent='';}
  append(...children){this.children.push(...children);}
  replaceChildren(...children){this.children=[...children];}
  setAttribute(){}
  addEventListener(name,handler){this.events.set(name,handler);}
  removeEventListener(name){this.events.delete(name);}
  fire(name,event={}){return this.events.get(name)?.(event);}
  blur(){}
  reportValidity(){return true;}
  setPointerCapture(){}
  getBoundingClientRect(){return {left:0,top:0,width:800,height:180};}
  getContext(){return {clearRect(){},beginPath(){},moveTo(){},lineTo(){},stroke(){}};}
}
function rig(){
  const doc={createElement:tag=>new Node(tag,doc),addEventListener(){},removeEventListener(){},defaultView:{addEventListener(){},removeEventListener(){}}};
  const root=new Node('div',doc),calls=[],requests=[];
  const sample=bankId=>({bankId,id:1,bits:16,length:8,rootFrequencyHz:440,sourceSampleRate:44100,loopStartSamples:0});
  const channel=bankId=>({sample:sample(bankId),frequencyHz:440,envelope:{},lfo:{},modulation:{}});
  const state=bankId=>({ramUsedBytes:16,samples:[sample(bankId)],channels:Array.from({length:32},()=>channel(bankId))});
  const panel=createPlaygroundScspVoicePanel({root,invoke(name,args){calls.push({name,args});
    if(name==='getPCM')return new Promise(resolve=>requests.push(resolve));
    if(name==='applyPCM')return Promise.resolve(sample(2));
    return Promise.resolve();
  }});
  const all=node=>[node,...node.children.flatMap(all)];
  const control=name=>all(root).find(node=>node.dataset.chipControl==='scsp-'+name);
  const action=name=>all(root).find(node=>node.dataset.chipAction==='scsp-'+name);
  return {root,panel,calls,requests,state,sample,control,action,all};
}

test('unapplied PCM survives passive-bank migration and a late getPCM response, then applies normally',async()=>{
  const r=rig();
  assert.equal(r.panel.captureDraft(),null);
  r.panel.update(r.state(1));r.panel.setConnected(true);
  r.requests.shift()({pcm:Int16Array.from([0,1,2,3,4,5,6,7]),sample:r.sample(1)});
  await Promise.resolve();
  assert.equal(r.panel.captureDraft(),null);
  const canvas=r.control('waveform');
  canvas.fire('pointerdown',{button:0,pointerId:1,clientX:200,clientY:20,preventDefault(){}});
  canvas.fire('pointerup');
  for(const [key,value]of Object.entries({root:'147',rate:'22050',loop:'3',bits:'8','modulation-padding':'4'}))r.control(key).value=value;
  const checkpoint=r.panel.captureDraft(),expected=checkpoint.pcm.slice();
  assert.notEqual(expected[2],2);
  checkpoint.pcm[0]=123;checkpoint.sample.rootFrequencyHz=999;
  const detached=r.panel.captureDraft();
  assert.equal(detached.pcm[0],0);assert.equal(detached.sample.rootFrequencyHz,440);
  r.panel.update(r.state(2));
  assert.equal(r.panel.captureDraft(),null);
  assert.equal(r.panel.restoreDraft(detached),true);
  assert.equal(r.action('apply').disabled,false);
  r.requests.shift()({pcm:new Int16Array(8),sample:r.sample(2)});
  await Promise.resolve();
  assert.deepEqual(r.panel.captureDraft().pcm,expected);
  assert.equal(r.control('root').value,'147');
  await r.action('apply').fire('click');
  const applied=r.calls.find(call=>call.name==='applyPCM');
  assert.equal(applied.args[0],0);
  assert.deepEqual(applied.args[1],Int8Array.from(expected,value=>Math.max(-128,Math.min(127,Math.round(value/256)))));
  assert.deepEqual(applied.args[2],{baseFrequencyHz:147,sourceSampleRate:22050,loopStartSamples:3,modulationDepth:4});
  assert.equal(r.panel.captureDraft(),null);
  r.panel.dispose();
});

test('checkpoint restoration rejects a different slot or unavailable sample without applying PCM',async()=>{
  const r=rig();r.panel.update(r.state(1));r.panel.setConnected(true);
  r.requests.shift()({pcm:new Int16Array(8),sample:r.sample(1)});await Promise.resolve();
  await r.action('sine').fire('click');const saved=r.panel.captureDraft();
  const slot=r.all(r.root).find(node=>node.dataset.scspSlot==='1');slot.fire('click');
  assert.equal(r.panel.restoreDraft(saved),false);
  r.panel.update(null);assert.equal(r.panel.restoreDraft({...saved,slot:1}),false);
  assert.equal(r.calls.some(call=>call.name==='applyPCM'),false);
  r.panel.dispose();assert.equal(r.panel.captureDraft(),null);assert.equal(r.panel.restoreDraft(saved),false);
});

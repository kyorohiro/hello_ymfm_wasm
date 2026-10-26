import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createPlaygroundWonderSwanVoicePanel,wonderswanNoteMidi,wonderswanVoiceCode} from './playground_wonderswan_voice_panel.js';

class Events {
  constructor(){this.listeners=new Map();}
  addEventListener(name,callback){if(!this.listeners.has(name))this.listeners.set(name,new Set());this.listeners.get(name).add(callback);}
  removeEventListener(name,callback){this.listeners.get(name)?.delete(callback);}
  async fire(type,extra={}){await Promise.all([...this.listeners.get(type)??[]].map(callback=>callback({type,target:this,preventDefault(){},...extra})));await flush();}
}
class Element extends Events {
  constructor(doc,tag){super();this.ownerDocument=doc;this.tagName=tag;this.children=[];this.dataset={};this.attributes={};this.value='';this.textContent='';this.hidden=false;this.checked=false;}
  appendChild(node){this.children.push(node);node.parentNode=this;return node;}
  setAttribute(name,value){this.attributes[name]=String(value);}
  getAttribute(name){return this.attributes[name];}
  setCustomValidity(value){this.validityMessage=value;}
  reportValidity(){}
  getContext(){return null;}
  getBoundingClientRect(){return{left:0,top:0,width:800,height:160};}
  setPointerCapture(){}
}
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const walk=root=>[root,...root.children.flatMap(walk)];
const control=(root,name)=>walk(root).find(node=>node.dataset.chipControl===`ws-${name}`);
const action=(root,name)=>walk(root).find(node=>node.dataset.chipAction===`ws-${name}`);
const channel=(root,index)=>walk(root).find(node=>node.dataset.chipChannel===String(index));
const output=(root,name)=>walk(root).find(node=>node.dataset.chipOutput===`ws-${name}`);
const state=()=>({
  kind:'wonderswan',clock:3072000,sampleRate:48000,outputEnabled:true,voiceMode:false,pcmVolume:15,
  sweep:{enabled:false,step:-1,time:12},noise:{enabled:false,type:3},registers:Array(32).fill(0),
  channels:Array.from({length:4},(_,channel)=>({channel,active:channel===0,enabled:channel===0,type:'wave',pan:{left:15-channel,right:10+channel},period:218,frequencyRegister:1830,frequency:440.3669724770642,waveform:Array.from({length:32},(_,i)=>i>>1),waveformKnown:true})),
});
function fixture(options={}){
  const win=new Events();win.setTimeout=setTimeout;win.clearTimeout=clearTimeout;
  const doc=new Events();doc.defaultView=win;doc.activeElement=null;doc.hidden=false;doc.createElement=tag=>new Element(doc,tag);
  const root=new Element(doc,'div'),calls=[],targets=[],errors=[];
  const panel=createPlaygroundWonderSwanVoicePanel({root,invoke:async(...args)=>{calls.push(args);},onKeyboardTargetChange:target=>targets.push(target),onError:error=>errors.push(error),...options});
  panel.setConnected(true);panel.update(state());return{root,doc,win,calls,targets,errors,panel};
}


test('note entry validates standard MIDI names',()=>{
  assert.equal(wonderswanNoteMidi('A4'),69);assert.equal(wonderswanNoteMidi('C4'),60);
  assert.throws(()=>wonderswanNoteMidi('oops'),/note name/);assert.throws(()=>wonderswanNoteMidi('C20'),/MIDI/);
});

test('applied snapshots render four voices and four-bit stereo levels without writes',()=>{
  const{root,panel,calls,doc}=fixture();assert.equal(control(root,'note').value,'A4');assert.equal(control(root,'period').value,'1830');assert.equal(control(root,'pan-left').value,'15');
  assert.equal(walk(root).filter(node=>node.dataset.chipChannel!==undefined).length,4);assert.match(output(root,'clock').textContent,/3,072,000/);assert.match(output(root,'gate').textContent,/Enabled.*Wave/);assert.deepEqual(calls,[]);
  doc.activeElement=control(root,'period');control(root,'period').value='123';panel.update(state());assert.equal(control(root,'period').value,'123');panel.dispose();
});

test('partial voice edits validate raw register and stereo fields without triggering',async()=>{
  const{root,panel,calls}=fixture();for(const[name,value]of[['pan-left','2'],['pan-right','3'],['period','0'],['frequency','432.5']]){control(root,name).value=value;await control(root,name).fire('change');}
  control(root,'note').value='C4';await control(root,'note').fire('change');
  assert.deepEqual(calls,[['setVoice',[0,{pan:{left:2}}]],['setVoice',[0,{pan:{right:3}}]],['setVoice',[0,{frequencyRegister:0}]],['setFrequency',[0,432.5]],['setNote',[0,60]]]);
  for(const[name,value]of[['period','2048'],['pan-left','16'],['pan-right','2.5']]){control(root,name).value=value;await control(root,name).fire('change');}assert.equal(calls.length,5);panel.dispose();
});

test('waveform drag commits one complete four-bit update and cancellation never writes',async()=>{
  const{root,panel,calls}=fixture();const canvas=control(root,'waveform');await canvas.fire('pointerdown',{pointerId:1,button:0,clientX:0,clientY:160});await canvas.fire('pointermove',{pointerId:1,clientX:799,clientY:0});assert.deepEqual(calls,[]);
  await canvas.fire('pointerup',{pointerId:1});assert.equal(calls.length,1);const wave=calls[0][1][1];assert.equal(wave.length,32);assert.equal(wave[0],0);assert.equal(wave[31],15);assert(wave.every(value=>Number.isInteger(value)&&value>=0&&value<=15));
  await canvas.fire('pointerdown',{pointerId:2,button:0,clientX:10,clientY:20});panel.setVisible(false);await canvas.fire('pointerup',{pointerId:2});assert.equal(calls.length,1);panel.dispose();
});

test('shapes and numeric samples preserve 32 points within 0..15 on the selected voice',async()=>{
  const{root,panel,calls}=fixture();await channel(root,3).fire('click');control(root,'wave-index').value='31';await control(root,'wave-index').fire('change');control(root,'wave-value').value='7';await control(root,'wave-value').fire('change');assert.equal(calls[0][1][0],3);assert.equal(calls[0][1][1][31],7);
  for(const shape of ['sine','triangle','saw','square'])await action(root,`wave-${shape}`).fire('click');assert.equal(calls.length,5);for(const[,args]of calls){assert.equal(args[0],3);assert.equal(args[1].length,32);assert(args[1].every(value=>Number.isInteger(value)&&value>=0&&value<=15));}panel.dispose();
});

test('CH3 sweep and CH4 noise expose only their physical hardware controls',async()=>{
  const{root,panel,calls}=fixture();const card=name=>control(root,name).parentNode.parentNode.parentNode;
  assert.equal(card('noise-enabled').hidden,true);assert.equal(card('sweep-enabled').hidden,true);await channel(root,2).fire('click');assert.equal(card('sweep-enabled').hidden,false);
  control(root,'sweep-step').value='-128';await control(root,'sweep-step').fire('change');control(root,'sweep-time').value='31';await control(root,'sweep-time').fire('change');
  await channel(root,3).fire('click');assert.equal(card('noise-enabled').hidden,false);assert.equal(card('sweep-enabled').hidden,true);control(root,'noise-type').value='7';await control(root,'noise-type').fire('change');await action(root,'noise-reset').fire('click');
  assert.deepEqual(calls,[['setSweep',[{step:-128}]],['setSweep',[{time:31}]],['setNoise',[{type:7}]],['setNoise',[{reset:true}]]]);panel.dispose();
});

test('CH2 PCM disables chromatic audition and explicit changes release an owned note first',async()=>{
  const{root,panel,calls,targets}=fixture();await channel(root,1).fire('click');await action(root,'hold').fire('pointerdown',{pointerId:1,button:0});control(root,'voice-mode').checked=true;await control(root,'voice-mode').fire('change');assert.deepEqual(calls.map(([method])=>method),['auditionOn','auditionOff','setVoiceMode']);
  const pcm=state();pcm.voiceMode=true;panel.update(pcm);assert.equal(control(root,'pcm-volume').disabled,false);for(const name of ['hold','play','keyboard'])assert.equal(action(root,name).disabled,true);
  await action(root,'play').fire('click');await action(root,'hold').fire('pointerdown',{pointerId:2,button:0});await action(root,'keyboard').fire('click');assert.equal(calls.length,3);assert.deepEqual(targets,[]);panel.dispose();
});

test('Keyboard note IDs cannot release replacement bindings or another physical channel',async()=>{
  const{root,panel,calls,targets}=fixture();await action(root,'keyboard').fire('click');const first=targets.at(-1);assert.equal(first.owner,'wonderswan-voice-panel');first.noteOn({id:'press',midi:60});await flush();await channel(root,2).fire('click');const second=targets.at(-1);second.noteOn({id:'press',midi:67});first.noteOff({id:'press'});first.allNotesOff();first.noteOn({id:'late',midi:69});await flush();assert.deepEqual(calls.map(([method])=>method),['auditionOn','auditionOff','auditionOn']);assert.equal(calls[2][1][0],2);
  panel.setConnected(false);assert.equal(targets.at(-1),null);panel.dispose();
});

test('Hold and preview release on hiding or focus loss, while stale errors remain silent',async()=>{
  const{root,panel,calls,win}=fixture();await action(root,'hold').fire('pointerdown',{pointerId:1,button:0});await win.fire('blur');assert.equal(calls.at(-1)[0],'auditionOff');await action(root,'play').fire('click');panel.setVisible(false);assert.equal(calls.at(-1)[0],'auditionOff');panel.dispose();
  let rejectCommand;const f=fixture({invoke:()=>new Promise((resolve,reject)=>{rejectCommand=reject;})});control(f.root,'pan-left').value='2';const changing=control(f.root,'pan-left').fire('change');f.panel.setConnected(false);f.panel.setConnected(true);rejectCommand(new Error('Old chip'));await changing;assert.deepEqual(f.errors,[]);f.panel.dispose();for(const node of [...walk(f.root),f.doc,f.win])assert.equal([...node.listeners.values()].reduce((sum,entries)=>sum+entries.size,0),0);
});

test('voice JavaScript preserves exact frequency registers and CH-specific state',()=>{
  const snapshot=state(),code=wonderswanVoiceCode(snapshot,0);assert.match(code,/ws\.setWaveform\(0, \[0,0,1,1/);assert.match(code,/ws\.setVolume\(0, 15, 10\)/);assert.match(code,/ws\.writeRegister\(128, 38\)/);assert.match(code,/ws\.writeRegister\(129, 7\)/);
  snapshot.voiceMode=true;assert.match(wonderswanVoiceCode(snapshot,1),/ws\.setVoiceMode\(true\)/);assert.match(wonderswanVoiceCode(snapshot,1),/Direct PCM needs timed/);assert.match(wonderswanVoiceCode(snapshot,2),/ws\.setSweep\(/);assert.match(wonderswanVoiceCode(snapshot,3),/ws\.setNoise\(/);
});

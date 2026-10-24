import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlaygroundY8950AdpcmPanel} from './playground_y8950_adpcm_panel.js';

class Events{constructor(){this.listeners=new Map();}addEventListener(type,handler){if(!this.listeners.has(type))this.listeners.set(type,new Set());this.listeners.get(type).add(handler);}removeEventListener(type,handler){this.listeners.get(type)?.delete(handler);}async fire(type,extra={}){await Promise.all([...this.listeners.get(type)??[]].map(fn=>fn({type,target:this,preventDefault(){},...extra})));await flush();}}
class Element extends Events{constructor(doc,tag){super();Object.assign(this,{ownerDocument:doc,tagName:tag,children:[],dataset:{},attributes:{},value:'',checked:false,textContent:'',hidden:false});}appendChild(n){this.children.push(n);n.parentNode=this;return n;}setAttribute(k,v){this.attributes[k]=String(v);}getAttribute(k){return this.attributes[k];}setCustomValidity(v){this.validityMessage=v;}reportValidity(){}setPointerCapture(){}}
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const walk=root=>[root,...root.children.flatMap(walk)];
const control=(root,name)=>walk(root).find(n=>n.dataset.chipControl===`y8950-adpcm-${name}`);
const action=(root,name)=>walk(root).find(n=>n.dataset.chipAction===`y8950-adpcm-${name}`);
const output=(root,name)=>walk(root).find(n=>n.dataset.chipOutput===`y8950-adpcm-${name}`);
const snapshot=()=>({kind:'y8950',clock:3579545,held:[],adpcm:{start:32,end:96,deltaN:10545,playbackRate:8000,volume:180,repeat:false,playing:false,validRange:true,memorySize:128,memoryRevision:1,waveformKnown:true,waveform:[0,.5,-.25,0],sampleName:'Voice'}});
function deferred(){let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};}
function fixture(options={}){const win=new Events();Object.assign(win,{setTimeout,clearTimeout});const doc=new Events();Object.assign(doc,{defaultView:win,activeElement:null,hidden:false,createElement:tag=>new Element(doc,tag)});const root=new Element(doc,'div'),calls=[],targets=[],errors=[],selected=[];const panel=createPlaygroundY8950AdpcmPanel({root,invoke:async(...args)=>calls.push(args),onKeyboardTargetChange:t=>targets.push(t),onSelect:()=>selected.push(true),onError:e=>errors.push(e),...options});panel.setConnected(true);panel.update(snapshot());return{win,doc,root,calls,targets,errors,selected,panel};}

test('Y8950 ADPCM renders configured range, rate, mono waveform and gate without sending audio commands',()=>{
  const f=fixture();assert.equal(control(f.root,'start').value,'32');assert.equal(control(f.root,'end').value,'96');assert.equal(control(f.root,'delta').value,'10545');assert.equal(control(f.root,'rate').value,'8000');assert.equal(control(f.root,'volume').value,'180');assert.match(output(f.root,'memory').textContent,/Voice.*128/);assert.equal(output(f.root,'gate').textContent,'Gate off');assert.equal(action(f.root,'sample-editor').disabled,true);assert.deepEqual(f.calls,[]);
  const input=control(f.root,'volume');input.value='91';f.doc.activeElement=input;f.panel.update(snapshot());assert.equal(input.value,'91');assert.deepEqual(f.calls,[]);f.panel.dispose();
});

test('Y8950 ADPCM draws a new waveform only on state changes or becoming visible',()=>{
  const f=fixture(),wave=control(f.root,'waveform');let paints=0;wave.getContext=()=>({clearRect(){paints++;},fillRect(){},beginPath(){},moveTo(){},lineTo(){},stroke(){},fillText(){}});
  f.panel.setVisible(false);f.panel.setVisible(true);assert.equal(paints,1);f.panel.update(snapshot());assert.equal(paints,1);f.panel.update({...snapshot(),adpcm:{...snapshot().adpcm,waveform:[0,1,0]}});assert.equal(paints,2);assert.deepEqual(f.calls,[]);f.panel.dispose();
});

test('Y8950 ADPCM validates aligned range and numeric edits and changes Repeat without starting playback',async()=>{
  const f=fixture();for(const [name,value]of [['start','64'],['end','128'],['delta','1'],['rate','4321.5'],['volume','255']]){control(f.root,name).value=value;await control(f.root,name).fire('change');}
  control(f.root,'repeat').checked=true;await control(f.root,'repeat').fire('change');
  assert.deepEqual(f.calls,[['adpcm.setSample',[{start:64,end:96}]],['adpcm.setSample',[{start:64,end:128}]],['adpcm.setDeltaN',[1]],['adpcm.setPlaybackRate',[4321.5]],['adpcm.setVolume',[255]],['adpcm.setRepeat',[true]]]);
  for(const [name,value]of [['start','33'],['end','2097184'],['delta','0'],['delta','65536'],['volume','256'],['rate','-1']]){control(f.root,name).value=value;await control(f.root,name).fire('change');}assert.equal(f.calls.length,6);assert(f.selected.length>=6);f.panel.dispose();
});

test('Y8950 ADPCM disables triggering for absent or out-of-range material',async()=>{
  const f=fixture();for(const adpcm of [{memorySize:0},{validRange:false},{deltaN:0}]){f.panel.update({...snapshot(),adpcm:{...snapshot().adpcm,...adpcm}});assert.equal(action(f.root,'hold').disabled,true);await action(f.root,'hold').fire('pointerdown',{button:0,pointerId:1});await action(f.root,'keyboard').fire('click');}assert.deepEqual(f.calls,[]);assert.deepEqual(f.targets,[]);f.panel.dispose();
});

test('Y8950 ADPCM hold releases its lease on matching pointer, blur, hiding and disconnection',async()=>{
  const f=fixture(),hold=action(f.root,'hold');await hold.fire('pointerdown',{button:0,pointerId:1});assert.deepEqual(f.calls[0].slice(0,1),['auditionOn']);assert.equal(f.calls[0][1][0],'adpcm');await hold.fire('pointerup',{pointerId:2});assert.equal(f.calls.length,1);await hold.fire('pointercancel',{pointerId:1});assert.deepEqual(f.calls[1],['auditionOff',['adpcm',f.calls[0][1][2]]]);
  await hold.fire('keydown',{key:' ',repeat:true});assert.equal(f.calls.length,2);await hold.fire('keydown',{key:' ',repeat:false});await f.win.fire('blur');assert.equal(f.calls.at(-1)[0],'auditionOff');
  await hold.fire('pointerdown',{button:0,pointerId:3});f.panel.setVisible(false);assert.equal(f.calls.at(-1)[0],'auditionOff');f.panel.setVisible(true);await hold.fire('pointerdown',{button:0,pointerId:4});f.panel.setConnected(false);assert.equal(f.calls.at(-1)[0],'auditionOff');f.panel.dispose();
});

test('Y8950 ADPCM preview is bounded and hiding cancels its timer',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});const f=fixture();await action(f.root,'play').fire('click');t.mock.timers.tick(1000);await flush();assert.deepEqual(f.calls.map(([m])=>m),['auditionOn','auditionOff']);await action(f.root,'play').fire('click');f.panel.setVisible(false);t.mock.timers.tick(1000);await flush();assert.equal(f.calls.length,4);f.panel.dispose();
});

test('Y8950 ADPCM Keyboard is a configured-rate trigger and stale targets cannot address a reconnected instance',async()=>{
  const f=fixture();await action(f.root,'keyboard').fire('click');const old=f.targets.at(-1);f.panel.setVisible(false);old.noteOn({id:'low',midi:0});old.noteOn({id:'high',midi:127});await flush();assert.deepEqual(f.calls.slice(0,2).map(([,args])=>args.slice(0,2)),[['adpcm',60],['adpcm',60]]);
  old.noteOff({id:'low'});await flush();assert.equal(f.calls.at(-1)[1][1],f.calls[0][1][2]);f.panel.setConnected(false);f.panel.setConnected(true);f.panel.setVisible(true);await action(f.root,'keyboard').fire('click');const next=f.targets.at(-1),before=f.calls.length;old.noteOn({id:'stale',midi:69});old.allNotesOff();assert.equal(f.calls.length,before);next.noteOn({id:'new',midi:69});next.noteOff({id:'new'});await flush();assert.equal(f.calls.at(-1)[0],'auditionOff');f.panel.dispose();
});

test('Y8950 ADPCM opens the common Sample Editor explicitly and uploads its neutral PCM at the configured address',async()=>{
  const editorCalls=[],loads=[],pcm={name:'recording.wav',sampleRate:16000,channels:[new Float32Array([0,.1,-.1])]},f=fixture({openSampleEditor:async(...args)=>{editorCalls.push(args);return pcm;},loadSample:async(...args)=>loads.push(args)});
  assert.equal(editorCalls.length,0);assert.equal(loads.length,0);await action(f.root,'sample-editor').fire('click');assert.deepEqual(editorCalls[0][0],{title:'Y8950 ADPCM sample',target:'adpcm-b'});assert.equal(editorCalls[0][1].signal.aborted,false);assert.equal(loads[0][0],pcm);assert.equal(loads[0][1].address,32);assert.equal(loads[0][1].name,'recording.wav');assert.equal(loads[0][1].signal,editorCalls[0][1].signal);assert.deepEqual(f.calls,[]);assert.equal(f.errors.length,0);f.panel.dispose();
});

for(const change of ['hide','disconnect','dispose'])test(`Y8950 ADPCM cancels Sample Editor on ${change} and ignores its late result`,async()=>{
  const gate=deferred(),loads=[];let signal;const f=fixture({openSampleEditor:async(_options,context)=>{signal=context.signal;return gate.promise;},loadSample:async(...args)=>loads.push(args)}),opening=action(f.root,'sample-editor').fire('click');await flush();assert.equal(signal.aborted,false);
  if(change==='hide')f.panel.setVisible(false);if(change==='disconnect'){f.panel.setConnected(false);f.panel.setConnected(true);}if(change==='dispose')f.panel.dispose();assert.equal(signal.aborted,true);gate.resolve({sampleRate:16000,channels:[new Float32Array(32)]});await opening;assert.equal(loads.length,0);assert.equal(f.errors.length,0);f.panel.dispose();
});

test('Y8950 ADPCM window blur releases playback while the common file/microphone editor keeps its own lifecycle',async()=>{
  const gate=deferred();let signal;const f=fixture({openSampleEditor:(_options,context)=>{signal=context.signal;return gate.promise;},loadSample:async()=>{}}),opening=action(f.root,'sample-editor').fire('click');await flush();await f.win.fire('blur');assert.equal(signal.aborted,false,'OS file/microphone permission dialogs may blur the window');gate.resolve(null);await opening;f.panel.dispose();
});

test('Y8950 ADPCM disconnect suppresses stale errors and disposal removes all listeners',async()=>{
  let reject;const pending=new Promise((_,fail)=>{reject=fail;}),f=fixture({invoke:()=>pending});control(f.root,'volume').value='10';await control(f.root,'volume').fire('change');f.panel.setConnected(false);reject(Error('stale error'));await flush();assert.deepEqual(f.errors,[]);f.panel.dispose();for(const node of [...walk(f.root),f.doc,f.win])assert.equal([...node.listeners.values()].reduce((n,s)=>n+s.size,0),0);
});

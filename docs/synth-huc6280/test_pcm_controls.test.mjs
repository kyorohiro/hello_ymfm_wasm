// SPDX-License-Identifier: BSD-3-Clause
// Real widget event bindings with inert DOM and a deterministic timer clock.
import test from 'node:test';
import assert from 'node:assert/strict';
import {setupTestPcmControls} from './test_pcm_controls.js';

class Element {
  constructor(doc,tag='div'){
    Object.assign(this,{ownerDocument:doc,tagName:tag.toUpperCase(),children:[],dataset:{},attributes:{},listeners:new Map(),value:'',textContent:'',checked:false});
    const classes=new Set();this.classList={toggle:(name,on)=>on?classes.add(name):classes.delete(name),contains:name=>classes.has(name)};
  }
  append(...nodes){for(const node of nodes){node.parentElement=this;this.children.push(node);}}
  remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(node=>node!==this);this.parentElement=null;}
  setAttribute(name,value){this.attributes[name]=String(value);}getAttribute(name){return this.attributes[name]??null;}
  addEventListener(type,fn){if(!this.listeners.has(type))this.listeners.set(type,new Set());this.listeners.get(type).add(fn);}
  removeEventListener(type,fn){this.listeners.get(type)?.delete(fn);}
  fire(type,extra={}){const event={target:this,button:0,pointerId:1,clientX:30,clientY:30,preventDefault(){},...extra};for(const fn of this.listeners.get(type)??[])fn(event);}
  blur(){}getContext(){return null;}getBoundingClientRect(){return{left:0,top:0,width:320,height:150};}
  setPointerCapture(id){this.capture=id;}hasPointerCapture(id){return this.capture===id;}releasePointerCapture(){this.capture=null;}
}
const walk=node=>[node,...node.children.flatMap(walk)];
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
const deferred=()=>{let resolve,reject;const promise=new Promise((ok,no)=>{resolve=ok;reject=no;});return{promise,resolve,reject};};
function fixture(t,{save,preview,legacy=false}={}){
  const doc={},root=new Element(doc),win=new Element(doc),timers=new Map(),saved=[],applied=[],messages=[];let time=0,nextTimer=0;
  doc.defaultView=win;doc.createElement=tag=>new Element(doc,tag);win.devicePixelRatio=1;
  win.setTimeout=(callback,delay)=>{const id=++nextTimer;timers.set(id,{callback,at:time+delay});return id;};win.clearTimeout=id=>timers.delete(id);
  const saveWave=async(bytes,options)=>{saved.push({bytes,options});return save?save(bytes,options):'/samples/test.wav';};
  const apply=async(bytes,options)=>{applied.push({bytes,options});return preview?.(bytes,options);};
  const controls=setupTestPcmControls({root,id:'test',title:'Test',saveWave,loadWave:legacy?apply:()=>assert.fail('preview callback should be used'),...(legacy?{}:{previewWave:apply}),onStatus:(...args)=>messages.push(args)});
  const get=id=>walk(root).find(node=>node.id==='testTest'+id);
  const shape=name=>walk(root).find(node=>node.dataset.testShape===name);
  const input=(id,value)=>{const node=get(id);node.value=String(value);node.fire('input');return node;};
  const tick=async ms=>{
    const target=time+ms;
    for(;;){const entry=[...timers].sort((a,b)=>a[1].at-b[1].at)[0];if(!entry||entry[1].at>target)break;time=entry[1].at;timers.delete(entry[0]);entry[1].callback();await flush();}
    time=target;await flush();
  };
  t.after(()=>controls.dispose());
  return{root,win,controls,get,shape,input,tick,saved,applied,messages,timers};
}
function wav(bytes){const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);return{rate:view.getUint32(24,true),channels:view.getUint16(22,true),frames:view.getUint32(40,true)/4,peak:Math.max(...Array.from({length:(bytes.length-44)/4},(_,i)=>Math.abs(view.getInt16(44+i*4,true))/32767))};}

test('startup initializes the displayed Sine in memory once without a Files save',async t=>{
  const f=fixture(t);assert.equal(await f.controls.initialize(),true);
  assert.equal(f.applied.length,1);assert.equal(f.saved.length,0);assert.equal(f.messages.length,0);
  assert.match(f.applied[0].options.name,/sine.*440 Hz/);assert.equal(f.applied[0].options.path,undefined);
  const info=wav(f.applied[0].bytes);assert.equal(info.frames,44100);assert(Math.abs(info.peak-.5)<.0002);
  assert.match(f.get('Status').textContent,/Default Sine ready/);assert.equal(f.root.dataset.dirty,'false');
  assert.equal(await f.controls.initialize(),false);assert.equal(f.applied.length,1);
  f.input('Frequency',880).fire('change');await flush();assert.equal(f.saved.length,1);assert.equal(f.applied.length,2);
});

test('startup never supersedes a waveform edit already requested',async t=>{
  const f=fixture(t);f.input('Frequency',880);assert.equal(await f.controls.initialize(),false);
  await f.tick(120);assert.equal(f.applied.length,1);assert.match(f.applied[0].options.name,/880 Hz/);assert.equal(f.saved.length,0);
});

for(const action of ['reset','dispose'])test(`late default initialization is fenced by ${action}`,async t=>{
  const wait=deferred(),f=fixture(t,{preview:()=>wait.promise}),initial=f.controls.initialize();await flush();
  if(action==='reset')f.controls.cancel({reset:true});else f.controls.dispose();
  assert(f.applied[0].options.signal.aborted);wait.resolve();assert.equal(await initial,false);assert.equal(f.saved.length,0);
  if(action==='reset'){assert.equal(f.root.dataset.dirty,'true');assert.match(f.get('Status').textContent,/New test waveform/);}
  else assert.equal(f.root.children.length,0);
});

test('edits always preview within 120ms and save on change, with no manual Load or Auto mode control',async t=>{
  const f=fixture(t);assert.equal(f.saved.length,0);assert.equal(f.applied.length,0);
  assert.equal(f.get('Auto'),undefined);assert.equal(f.get('Load'),undefined);
  f.input('Frequency',1000);f.input('Frequency',1171);f.input('Level',.47);f.input('Duration',.5);
  await f.tick(119);assert.equal(f.applied.length,0);
  await f.tick(1);assert.equal(f.applied.length,1);assert.equal(f.saved.length,0);
  assert.match(f.applied[0].options.name,/1171 Hz/);assert.equal(f.applied[0].options.path,undefined);
  const info=wav(f.applied[0].bytes);assert.equal(info.rate,44100);assert.equal(info.channels,2);assert.equal(info.frames,22050);assert(Math.abs(info.peak-.47)<.0002);
  assert.match(f.get('Status').textContent,/Live test waveform updated/);
  f.get('Duration').fire('change');await flush();assert.equal(f.saved.length,1);assert.equal(f.applied.length,2);
  assert.deepEqual(f.saved[0].bytes,f.applied[1].bytes);assert.equal(f.applied[1].options.path,'/samples/test.wav');assert.equal(f.root.dataset.dirty,'false');
});

test('one in-flight update drains only the latest queued preview, then the final gesture save',async t=>{
  const waits=[];let active=0,maxActive=0;
  const f=fixture(t,{preview:async()=>{active++;maxActive=Math.max(maxActive,active);const wait=deferred();waits.push(wait);try{await wait.promise;}finally{active--;}}});
  f.input('Frequency',500);await f.tick(120);assert.equal(f.applied.length,1);
  f.input('Frequency',1000);await f.tick(120);f.input('Frequency',2000);await f.tick(120);f.input('Frequency',3000);await f.tick(120);
  assert.equal(f.applied.length,1);assert.equal(f.saved.length,0);
  waits[0].resolve();await flush();assert.equal(f.applied.length,2);assert.match(f.applied[1].options.name,/3000 Hz/);
  f.get('Frequency').fire('change');await flush();assert.equal(f.saved.length,0);
  waits[1].resolve();await flush();assert.equal(f.saved.length,1);assert.equal(f.applied.length,3);assert.match(f.applied[2].options.name,/3000 Hz/);
  waits[2].resolve();await flush();assert.equal(f.root.dataset.dirty,'false');assert.equal(maxActive,1);
});

test('shape selection and Smooth edges changes automatically save and apply',async t=>{
  const f=fixture(t);f.shape('square').fire('click');await flush();
  assert.equal(f.saved.length,1);assert.equal(f.applied.length,1);assert.match(f.applied[0].options.name,/square.*440 Hz/);
  f.get('Smooth').checked=false;f.get('Smooth').fire('change');await flush();
  assert.equal(f.saved.length,2);assert.equal(f.applied.length,2);
  const data=new DataView(f.saved[1].bytes.buffer);assert.notEqual(data.getInt16(44,true),0);
  assert.equal(f.root.dataset.dirty,'false');
});

test('a newer playback intent cancels an active preview and discards its late success',async t=>{
  const wait=deferred(),f=fixture(t,{preview:()=>wait.promise});
  f.input('Frequency',660);await f.tick(120);const signal=f.applied[0].options.signal;
  f.controls.cancel();assert(signal.aborted);
  wait.resolve();await flush();assert.equal(f.saved.length,0);assert.equal(f.root.dataset.dirty,'true');assert.equal(f.messages.length,0);
});

test('drawing previews without saving during the stroke, then pointerup persists the resulting cycle',async t=>{
  const f=fixture(t),canvas=f.get('Cycle');
  canvas.fire('pointerdown',{clientX:12,clientY:15});canvas.fire('pointermove',{clientX:200,clientY:125});await f.tick(120);
  assert.equal(f.applied.length,1);assert.equal(f.saved.length,0);assert.match(f.applied[0].options.name,/drawn/);
  canvas.fire('pointermove',{clientX:300,clientY:70});canvas.fire('pointerup');await flush();
  assert.equal(f.saved.length,1);assert.equal(f.applied.length,2);assert.deepEqual(f.saved[0].bytes,f.applied[1].bytes);assert.equal(f.root.dataset.dirty,'false');
});

for(const cancel of ['pointercancel','window blur'])test(`an unfinished gesture cannot apply later after ${cancel}`,async t=>{
  const f=fixture(t),canvas=f.get('Cycle');canvas.fire('pointerdown');canvas.fire('pointermove');await f.tick(60);
  if(cancel==='window blur')f.win.fire('blur');else canvas.fire('pointercancel');
  await f.tick(240);assert.equal(f.applied.length,0);assert.equal(f.saved.length,0);assert.equal(f.root.dataset.dirty,'true');
  canvas.fire('pointerdown');canvas.fire('pointerup');await flush();assert.equal(f.saved.length,1);assert.equal(f.applied.length,1);
});

test('reset fences a save awaiting Files readiness, resets defaults and permits a fresh load',async t=>{
  const wait=deferred();let count=0;const f=fixture(t,{save:()=>++count===1?wait.promise:'/samples/fresh.wav'});
  f.input('Frequency',880);const old=f.controls.load();await flush();assert.equal(f.saved.length,1);
  f.controls.cancel({reset:true});assert(f.saved[0].options.signal.aborted);assert.equal(f.get('Frequency').value,'440');assert.equal(f.get('Level').value,'.5');assert.equal(f.get('Duration').value,'1');
  wait.resolve('/samples/stale.wav');assert.equal(await old,false);await flush();assert.equal(f.applied.length,0);assert.match(f.get('Status').textContent,/New test waveform/);
  assert.equal(await f.controls.load(),true);assert.equal(f.applied.length,1);assert.equal(f.applied[0].options.path,'/samples/fresh.wav');assert.match(f.applied[0].options.name,/440 Hz/);
});

test('dispose cancels timers and active preview; late completion never changes status or saves',async t=>{
  const wait=deferred(),f=fixture(t,{preview:()=>wait.promise});f.input('Frequency',880);await f.tick(120);
  f.input('Frequency',990);assert.equal(f.timers.size,1);const previous=f.get('Status').textContent;
  f.controls.dispose();assert(f.applied[0].options.signal.aborted);assert.equal(f.timers.size,0);wait.resolve();await flush();await f.tick(500);
  assert.equal(f.applied.length,1);assert.equal(f.saved.length,0);assert.equal(f.root.children.length,0);assert.equal(f.messages.length,0);
  assert(previous.includes('Changed'));
});

test('failed automatic save keeps the source; the next parameter edit retries without a button',async t=>{
  let failing=true;const f=fixture(t,{save:()=>{if(failing)throw Error('Cassette budget exceeded');return'/samples/test.wav';}});
  f.shape('sine').fire('click');await flush();assert.equal(f.applied.length,0);assert.equal(f.get('Status').dataset.error,'true');assert.match(f.get('Status').textContent,/budget.*Adjust a control to retry/);
  failing=false;f.input('Frequency',880).fire('change');await flush();assert.equal(f.applied.length,1);assert.equal(f.get('Status').dataset.error,'false');assert.equal(f.root.dataset.dirty,'false');
});

test('legacy callback remains supported without previewWave',async t=>{
  const f=fixture(t,{legacy:true});f.shape('triangle').fire('click');await flush();
  assert.equal(f.saved.length,1);assert.equal(f.applied.length,1);assert.equal(f.applied[0].options.path,'/samples/test.wav');assert.match(f.get('Status').textContent,/Keyboard or Play/);
});

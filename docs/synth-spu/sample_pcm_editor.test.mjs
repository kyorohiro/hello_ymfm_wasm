// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {createSpuSamplePcmEditor} from './sample_pcm_editor.js';

const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
async function until(predicate){for(let i=0;i<200;i++){if(predicate())return;await Promise.resolve();}throw Error('Editor fixture did not settle');}
class Element {
  constructor(doc,tag='div'){this.ownerDocument=doc;this.tagName=tag.toUpperCase();this.children=[];this.dataset={};this.attributes={};this.hidden=false;this.value='';this.listeners=new Map();this.disabled=false;const classes=new Set();this.classList={add:name=>classes.add(name)};}
  append(...nodes){this.children.push(...nodes);}
  setAttribute(name,value){this.attributes[name]=String(value);}
  addEventListener(type,fn,capture=false){if(!this.listeners.has(type))this.listeners.set(type,[]);this.listeners.get(type).push({fn,capture});}
  removeEventListener(type,fn){this.listeners.set(type,(this.listeners.get(type)??[]).filter(item=>item.fn!==fn));}
  setCustomValidity(value){this.validityMessage=value;}
  reportValidity(){return !this.validityMessage;}
  fire(type,extra={}){const event={type,key:'',button:0,pointerId:1,clientX:0,clientY:0,stopped:false,preventDefault(){this.prevented=true;},stopImmediatePropagation(){this.stopped=true;},...extra};
    for(const entry of [...(this.listeners.get(type)??[])].sort((a,b)=>Number(b.capture)-Number(a.capture))){entry.fn(event);if(event.stopped)break;}return event;}
}
function sample({sampleId=24,token='original',packets=100}={}) {
  const adpcm=new Uint8Array(packets*16);for(let at=0;at<adpcm.length;at+=16){adpcm[at]=12;adpcm.fill(0x21,at+2,at+16);}
  adpcm[33]=4;adpcm[adpcm.length-15]=3;
  return {sampleId,token,adpcm,baseFrequencyHz:177.25,loopStartSamples:56};
}
function fixture(options={}) {
  const win=new Element(null),doc=new Element(null);doc.defaultView=win;doc.createElement=tag=>new Element(doc,tag);
  const element=doc.createElement('div'),canvas=doc.createElement('canvas'),strokes=[],text=[];canvas.width=100;canvas.height=100;
  const context={clearRect(){},fillRect(){},beginPath(){},moveTo(x,y){strokes.push([x,y,this.strokeStyle]);},lineTo(x,y){strokes.push([x,y,this.strokeStyle]);},stroke(){},fillText:value=>text.push(value)};
  canvas.getContext=()=>context;canvas.getBoundingClientRect=()=>({left:0,top:0,width:100,height:100});
  const captured=new Set();canvas.setPointerCapture=id=>captured.add(id);canvas.hasPointerCapture=id=>captured.has(id);canvas.releasePointerCapture=id=>captured.delete(id);
  let current=sample(),reads=0,decodes=0;const prepared=[],applied=[],errors=[],changes=[];
  const editor=createSpuSamplePcmEditor({element,canvas,readSample:async()=>{reads++;return current;},
    decode:source=>{decodes++;return Float32Array.from({length:source.adpcm.length/16*28},(_,i)=>Math.sin(i/19)*.6);},
    prepareSampleEdit:async(source,pcm,{signal})=>{prepared.push({source,pcm,signal});return {sourceSampleId:source.sampleId,sourceToken:source.token,adpcm:source.adpcm.slice()};},
    applySample:async payload=>{applied.push(payload);return true;},onError:error=>errors.push(error),onChange:state=>changes.push(state),...options});
  return {editor,element,canvas,doc,win,strokes,text,prepared,applied,errors,changes,get source(){return current;},set source(value){current=value;},get reads(){return reads;},get decodes(){return decodes;},
    show:()=>editor.update({source:current,active:true}),input(key,value){editor.controls[key].value=String(value);editor.controls[key].fire('change');},captured};
}

test('complete source is read and decoded once per token, with bounded canvas commands and no PCM in UI snapshots',async t=>{
  const f=fixture();t.after(()=>f.editor.dispose());f.source=sample({packets:32512});
  f.show();await until(()=>f.editor.read().ready);assert.equal(f.editor.read().frames,910336);assert.equal(f.reads,1);assert.equal(f.decodes,1);
  const marks=f.strokes.length;
  for(let i=0;i<20;i++)f.show();assert.equal(f.reads,1);assert.equal(f.decodes,1);assert.equal(f.strokes.length,marks);
  assert(marks<1000,'overview draws by canvas columns, not 910336 source points');
  const state=f.editor.read();assert.equal(state.loopStartSamples,56);assert.equal(state.token,'original');
  assert(!Object.values(state).some(value=>ArrayBuffer.isView(value)||Array.isArray(value)));
  f.source={...f.source,token:'reimported'};f.show();await until(()=>f.editor.read().ready&&f.editor.read().token==='reimported');assert.equal(f.reads,2);
});

test('numeric full-sample edits preserve untouched samples, source metadata and viewport across the canonical commit token',async t=>{
  let f;
  f=fixture({applySample:async payload=>{
    f.applied.push(payload);f.source={...f.source,sampleId:25,token:'edited'};f.show();return {sampleId:25,token:'edited'};
  }});t.after(()=>f.editor.dispose());const original=f.source.adpcm.slice();f.show();await until(()=>f.editor.read().ready);
  f.input('span',280);f.input('start',560);f.input('index',700);f.input('value',.75);
  await until(()=>f.editor.read().ready&&f.editor.read().token==='edited');
  assert.equal(f.prepared.length,1);assert.equal(f.applied.length,1);const request=f.prepared[0];
  assert.equal(request.pcm.length,2800);assert.equal(request.pcm[700],.75);assert.equal(request.pcm[0],Math.fround(Math.sin(0/19)*.6));
  assert.equal(request.pcm[2799],Math.fround(Math.sin(2799/19)*.6));assert.equal(request.source.baseFrequencyHz,177.25);assert.equal(request.source.loopStartSamples,56);
  assert.deepEqual(request.source.adpcm,original);assert.equal(f.editor.read().viewStart,560);assert.equal(f.editor.read().viewSpan,280);assert.equal(f.editor.read().index,700);
});

test('view controls change only the view and precise index; full-sample drawing applies once on release',async t=>{
  const f=fixture();t.after(()=>f.editor.dispose());f.show();await until(()=>f.editor.read().ready);
  f.input('span',280);f.input('start',112);f.editor.controls['zoom-in'].fire('click');assert.equal(f.editor.read().viewSpan,140);
  f.editor.controls['zoom-out'].fire('click');assert.equal(f.editor.read().viewSpan,280);
  f.input('start',112);let sharedEvents=0;f.canvas.addEventListener('pointerdown',()=>sharedEvents++);
  f.canvas.fire('pointerdown',{clientX:10,clientY:20});f.canvas.fire('pointermove',{clientX:50,clientY:30});
  assert.equal(f.prepared.length,0);assert.equal(f.applied.length,0);assert.equal(sharedEvents,0);
  f.canvas.fire('pointerup',{clientX:60,clientY:40});await until(()=>f.applied.length===1);
  assert.equal(f.prepared.length,1);assert.equal(f.prepared[0].pcm.length,2800);assert.equal(f.prepared[0].pcm[0],0);
  assert.equal(f.prepared[0].pcm[2799],Math.fround(Math.sin(2799/19)*.6));assert.equal(f.captured.size,0);
});

test('Cancelled drawing and worker encoding never publish a sample edit',async t=>{
  const encoding=deferred(),f=fixture({prepareSampleEdit:async(source,pcm,{signal})=>{f.prepared.push({source,pcm,signal});return encoding.promise;}});
  t.after(()=>f.editor.dispose());f.show();await until(()=>f.editor.read().ready);
  f.canvas.fire('pointerdown',{clientX:10,clientY:10});f.canvas.fire('pointercancel');assert.equal(f.prepared.length,0);assert.equal(f.applied.length,0);
  f.input('index',900);const old=f.editor.read().value;f.input('value',.8);await until(()=>f.editor.read().phase==='encoding');
  assert.equal(f.editor.controls.cancel.disabled,false);assert.equal(f.editor.controls.value.disabled,true);
  f.editor.controls.cancel.fire('click');assert.equal(f.prepared[0].signal.aborted,true);assert.equal(f.editor.read().phase,'ready');assert.equal(f.editor.read().value,old);
  encoding.resolve({adpcm:new Uint8Array(16)});for(let i=0;i<10;i++)await Promise.resolve();assert.equal(f.applied.length,0);assert.deepEqual(f.errors,[]);
});

test('source/view/disposal changes fence delayed reads and pending worker results',async()=>{
  for(const transition of ['view','source','dispose']) {
    const pending=deferred(),f=fixture({readSample:()=>pending.promise});f.show();
    if(transition==='view')f.editor.update({source:f.source,active:false});
    else if(transition==='source')f.editor.update({source:{sampleId:30,token:'new'},active:false});else f.editor.dispose();
    pending.resolve(f.source);for(let i=0;i<10;i++)await Promise.resolve();assert.equal(f.element.hidden,true);assert.equal(f.editor.read().frames,0);assert.deepEqual(f.errors,[]);f.editor.dispose();
  }
  const pending=deferred(),f=fixture({prepareSampleEdit:async()=>pending.promise});f.show();await until(()=>f.editor.read().ready);
  f.input('value',.8);f.editor.update({source:f.source,active:false});pending.resolve({adpcm:new Uint8Array(16)});
  for(let i=0;i<10;i++)await Promise.resolve();assert.equal(f.applied.length,0);assert.deepEqual(f.errors,[]);f.editor.dispose();
});

test('a read failure is display-only, a failed SET retains the original PCM, and zoomed one-sample data stays visible',async t=>{
  const bad=fixture({readSample:async()=>{throw Error('read failed');}});t.after(()=>bad.editor.dispose());bad.show();await until(()=>bad.editor.read().phase==='error');assert.equal(bad.applied.length,0);assert.match(bad.editor.read().message,/read failed/);
  const f=fixture({applySample:async()=>{throw Error('stale token');}});t.after(()=>f.editor.dispose());f.show();await until(()=>f.editor.read().ready);
  f.input('index',10);const before=f.editor.read().value;f.input('value',.9);await until(()=>f.editor.read().phase==='ready'&&f.editor.read().error);
  assert.equal(f.editor.read().value,before);assert.match(f.editor.read().message,/stale token/);
  const start=f.strokes.length;f.input('span',1);assert(f.strokes.length>start);assert.equal(f.editor.read().viewSpan,1);
  assert.deepEqual(f.strokes.slice(start).filter(point=>point[2]==='#7bbcf7').map(point=>point.slice(0,2)),[[0,50],[100,50]],'a single sample is a visible horizontal line');
  const short=f.strokes.length;f.input('span',28);const points=f.strokes.slice(short).filter(point=>point[2]==='#7bbcf7');
  assert.equal(points.length,28);assert.equal(points[0][0],0);assert.equal(points.at(-1)[0],100,'short samples form a connected full-width waveform');
  f.editor.controls.full.fire('click');assert.equal(f.editor.read().viewSpan,2800);assert.equal(f.editor.read().viewStart,0);
});

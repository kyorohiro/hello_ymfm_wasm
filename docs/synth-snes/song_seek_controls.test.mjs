import test from 'node:test';
import assert from 'node:assert/strict';
import {setupSnesSongSeekControls} from './song_seek_controls.js';
class Element{
 constructor(){this.listeners=new Map();this.value='0';this.style={setProperty:(k,v)=>this[k]=v};this.attrs={};}
 addEventListener(type,fn){this.listeners.set(type,fn);}removeEventListener(type){this.listeners.delete(type);}
 setAttribute(k,v){this.attrs[k]=v;}fire(type,extra={}){const event={preventDefault(){this.prevented=true;},stopPropagation(){this.stopped=true;},...extra};this.listeners.get(type)?.(event);return event;}
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(t,{seek}={}){
 const range=new Element(),time=new Element(),doc=new Element(),calls=[],errors=[];
 let state={loaded:true,busy:false,mode:'paused',playing:false,positionSeconds:2,source:{id:1,name:'same.spc',durationSeconds:120}};
 const player={read:()=>state,async seek(target){calls.push(target);if(seek)return seek(target);emit({mode:'paused',positionSeconds:target,seekTargetSeconds:null});}};
 const controls=setupSnesSongSeekControls({player,range,time,document:doc,onError:e=>errors.push(e)});
 function emit(next){state={...state,...next};controls.update(state);}t.after(()=>controls.dispose());
 const draft=value=>{range.fire('pointerdown');range.value=String(value);range.fire('input');};
 return{range,time,doc,calls,errors,controls,emit,draft};
}
test('drag holds the preview through playback polls; change/release/blur commits exactly once',async t=>{
 const f=fixture(t);f.draft(45);f.emit({positionSeconds:7});assert.equal(f.range.value,'45');assert.equal(f.time.textContent,'0:45 / 2:00 (tag)');assert.equal(f.range.attrs['aria-valuetext'],'0:45 of 2:00 (tag)');assert.deepEqual(f.calls,[]);
 f.range.fire('change');f.range.fire('pointerup');f.range.fire('blur');await tick();assert.deepEqual(f.calls,[45]);assert.equal(f.range['--seek-position'],'37.5%');
 f.draft(30);f.range.fire('pointerup');f.range.fire('change');await tick();assert.deepEqual(f.calls,[45,30]);
});
test('key repeat previews 1/10 second steps, clamps to endpoints and commits on keyup',async t=>{
 const f=fixture(t);for(let i=0;i<3;i++){const e=f.range.fire('keydown',{key:'ArrowRight'});assert(e.prevented&&e.stopped);}assert.deepEqual(f.calls,[]);assert.equal(f.range.value,'5');f.range.fire('keyup',{key:'ArrowRight'});await tick();assert.deepEqual(f.calls,[5]);
 f.range.fire('keydown',{key:'ArrowRight',shiftKey:true});f.range.fire('keyup',{key:'ArrowRight'});await tick();assert.equal(f.calls.at(-1),15);
 for(const [key,value]of [['End',120],['ArrowRight',120],['Home',0],['ArrowLeft',0],['PageUp',10],['PageDown',0]]){f.range.fire('keydown',{key});f.range.fire('keyup',{key});await tick();assert.equal(f.calls.at(-1),value);}
});
test('Escape, pointer cancellation, hidden page and source replacement discard drafts without a late change seek',async t=>{
 const f=fixture(t);for(const cancel of [()=>f.range.fire('keydown',{key:'Escape'}),()=>f.range.fire('pointercancel'),()=>{f.doc.hidden=true;f.doc.fire('visibilitychange');},()=>f.emit({source:{id:2,name:'same.spc',durationSeconds:120}}),()=>f.controls.cancelDraft()]){f.draft(90);cancel();f.range.fire('change');f.range.fire('pointerup');f.range.fire('keyup',{key:'ArrowRight'});await tick();assert.deepEqual(f.calls,[]);assert.equal(f.range.value,'2');}
});
test('seek target remains visible and a newer seek is available while seeking; Stop clears target/draft',async t=>{
 const f=fixture(t,{seek:async target=>f.emit({mode:'seeking',busy:true,seekTargetSeconds:target})});f.draft(60);f.range.fire('change');await tick();assert.equal(f.range.value,'60');assert.equal(f.range.disabled,false);f.draft(20);f.range.fire('change');await tick();assert.deepEqual(f.calls,[60,20]);assert.equal(f.range.value,'20');
 f.draft(90);f.emit({mode:'stopped',busy:false,positionSeconds:0,seekTargetSeconds:null});f.range.fire('change');await tick();assert.equal(f.range.value,'0');assert.deepEqual(f.calls,[60,20]);
});
test('unknown duration stays explicit, load is disabled, change-only accessibility input works',async t=>{
 const f=fixture(t);f.emit({source:{id:1,durationSeconds:null}});assert.equal(f.range.max,'3600');assert.equal(f.time.textContent,'0:02 / —');assert.match(f.range.attrs['aria-valuetext'],/duration unknown/);
 f.range.value='3.5';f.range.fire('change');await tick();assert.deepEqual(f.calls,[3.5]);f.emit({mode:'loading',busy:true});assert(f.range.disabled);f.range.fire('keydown',{key:'ArrowRight'});f.range.fire('change');await tick();assert.deepEqual(f.calls,[3.5]);
});
test('Space/Enter stay local and blur commits; disposal suppresses late failure and removes listeners',async t=>{
 let reject;const f=fixture(t,{seek:()=>new Promise((_,r)=>reject=r)});for(const key of [' ','Enter']){const e=f.range.fire('keydown',{key});assert(e.prevented&&e.stopped);}f.draft(8);f.range.fire('blur');assert.deepEqual(f.calls,[8]);f.controls.dispose();reject(Error('late'));await tick();assert.deepEqual(f.errors,[]);assert.equal(f.range.listeners.size,0);assert.equal(f.doc.listeners.size,0);
});

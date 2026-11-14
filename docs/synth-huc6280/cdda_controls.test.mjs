// Actual DOM event bindings with inert data providers. No audio or browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import {setupCddaControls} from './cdda_controls.js';

class Element extends EventTarget {
  constructor(){super();this.dataset={};this.children=[];this.value='';this.textContent='';this.hidden=false;}
  setAttribute(key,value){this[key]=String(value);}
  append(...nodes){this.children.push(...nodes);}
  replaceChildren(...nodes){this.children=[...nodes];}
  blur(){this.dispatchEvent(new Event('blur'));}
  fire(type,fields={}){this.dispatchEvent(Object.assign(new Event(type,{cancelable:true}),fields));}
}
function harness(){
  const ids=['cddaSourceSelect','cddaTrackSelect','cddaLoadSource','cddaPlay','cddaStop','cddaSeek','cddaSourceState','cddaSourceInfo','cddaSourceStatus','cddaPosition','cddaStorageNote','cddaSessionInput','cddaClearSession','cddaCancelLoad','cddaAddFiles','cddaOpenSession'];
  const nodes=new Map(ids.map(id=>[id,new Element()])),win=new EventTarget(),doc=new EventTarget(),root=new Element(),listeners=new Set(),seeks=[];
  Object.assign(doc,{hidden:false,defaultView:win,createElement:()=>new Element()});root.ownerDocument=doc;root.querySelector=selector=>nodes.get(selector.slice(1));
  const state={sourceId:'source',revision:1,asset:{name:'Album',path:'/album.json',tracks:[{number:3,title:'Track',file:'/a.wav'}]},selectedTrack:3,
    track:{number:3,title:'Track',file:'/a.wav',frames:441000,bytes:1764000},position:2,actual:null,state:'paused',busy:false,transportPending:false,error:null};
  const notify=()=>{for(const listener of listeners)listener();};
  const source={read:()=>state,subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);},cancelLoad(){},
    async seek(seconds){seeks.push(seconds);state.position=seconds;notify();}};
  const project={selectedPath:null,listEntries:()=>[],onDidChange:()=>()=>{},fs:{get:()=>null}},session={list:()=>[],subscribe:()=>()=>{}};
  const controls=setupCddaControls({root,source,project,session,addFiles:()=>{}}),seek=nodes.get('cddaSeek');
  const drag=value=>{seek.fire('pointerdown');seek.value=String(value);seek.fire('input');};
  return{win,doc,controls,seek,seeks,state,notify,drag};
}

for(const lose of ['window blur','control blur','document hidden','Escape','pointercancel'])test(`unfinished CDDA seek is cancelled on ${lose}; late change cannot move the cursor`,()=>{
  const h=harness();try{
    h.drag(7);assert.equal(h.seek.value,'7');assert.equal(h.state.position,2);
    if(lose==='window blur')h.win.dispatchEvent(new Event('blur'));
    else if(lose==='control blur')h.seek.blur();
    else if(lose==='document hidden'){h.doc.hidden=true;h.doc.dispatchEvent(new Event('visibilitychange'));}
    else if(lose==='Escape')h.seek.fire('keydown',{key:'Escape'});
    else h.seek.fire('pointercancel');
    h.controls.refresh();assert.equal(h.seek.value,'2');h.seek.fire('change');assert.deepEqual(h.seeks,[]);
    h.doc.hidden=false;h.drag(6);h.seek.fire('pointerup');h.seek.fire('change');assert.deepEqual(h.seeks,[6],'a fresh gesture commits once');
  }finally{h.controls.dispose();}
});

test('a Code track replacement revokes the old seek gesture without preventing a new gesture',()=>{
  const h=harness();try{
    h.drag(7);h.state.revision++;h.state.position=1;h.notify();
    h.seek.value='8';h.seek.fire('input');assert.equal(h.seek.value,'1');
    h.seek.fire('pointerup');h.seek.fire('change');assert.deepEqual(h.seeks,[]);
    h.drag(4);h.seek.fire('change');h.seek.fire('pointerup');assert.deepEqual(h.seeks,[4]);
  }finally{h.controls.dispose();}
});

test('keyboard Home/End use exact track frames and blur cannot replace the chosen endpoint',()=>{
  const h=harness();try{
    h.state.track.frames=441001;h.notify();h.seek.fire('keydown',{key:'End'});h.seek.fire('change');
    h.seek.fire('keydown',{key:'Home'});h.seek.fire('change');assert.deepEqual(h.seeks,[441001/44100,0]);
  }finally{h.controls.dispose();}
});

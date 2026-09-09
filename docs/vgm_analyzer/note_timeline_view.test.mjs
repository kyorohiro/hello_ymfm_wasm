import test from 'node:test';
import assert from 'node:assert/strict';
import {createNoteTimeline} from './note_timeline_view.js';

test('timeline defers analysis until opened and stops hidden viewport work',t=>{
 const originals=new Map();
 function global(name,value){originals.set(name,Object.getOwnPropertyDescriptor(globalThis,name));globalThis[name]=value;}
 t.after(()=>{for(const [name,descriptor] of originals)if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name];});
 let frames=0,resize;const workers=[];
 global('requestAnimationFrame',()=>++frames);global('cancelAnimationFrame',()=>{});
 global('devicePixelRatio',1);
 global('ResizeObserver',class{constructor(cb){resize=cb;}observe(){}});
 global('Worker',class{
   constructor(){this.messages=[];workers.push(this);}
   postMessage(m){this.messages.push(m);}
   terminate(){this.terminated=true;}
 });
 const nodes=new Map();
 function node(selector){
   if(!nodes.has(selector))nodes.set(selector,{
     style:{},clientWidth:700,scrollWidth:1000,scrollLeft:0,
     addEventListener(){},replaceChildren(){},getContext:()=>({setTransform(){}}),
   });
   return nodes.get(selector);
 }
 global('document',{createElement:()=>({style:{}})});
 const root={innerHTML:'',querySelector:node};
 const view=createNoteTimeline(root,{onSelect(){},onPlay(){},onPause(){},onCancel(){}});
 view.load(new ArrayBuffer(8));
 resize();
 assert.equal(workers.length,0);assert.equal(frames,0);
 view.active(true);
 assert.equal(workers.length,1);assert.equal(workers[0].messages[0].type,'load');
 workers[0].onmessage({data:{type:'ready',duration:441000,names:[]}});
 const requests=workers[0].messages.length;
 view.active(false);
 const frameCount=frames;
 resize();view.mode('detail');view.cursor(2000,true);
 assert.equal(workers[0].messages.length,requests);
 assert.equal(frames,frameCount);
 view.active(true);
 assert.equal(workers.length,1); // reuse parsed song when revisiting
 assert.ok(workers[0].messages.length>requests);
 view.active(false);view.load(new ArrayBuffer(16));
 assert.equal(workers[0].terminated,true);
 assert.equal(workers.length,1);
 view.active(true);assert.equal(workers.length,2);
 view.active(false);assert.equal(workers[1].terminated,true); // stop unfinished hidden analysis
 view.active(true);assert.equal(workers.length,3);
});

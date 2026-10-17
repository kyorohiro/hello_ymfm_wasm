import test from 'node:test';
import assert from 'node:assert/strict';
// Capture a local byte provider before the audio modules bind fetch. No network/audio device.
const originalFetch=globalThis.fetch;
globalThis.fetch=async()=>({ok:true,arrayBuffer:async()=>new ArrayBuffer(8)});
const {createPlaygroundRuntime}=await import('./playground_runtime.js');
globalThis.fetch=originalFetch;
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));

function setup(t, selectedChip='ym2612') {
 const saved={window:globalThis.window,AudioWorkletNode:globalThis.AudioWorkletNode};
 const nodes=[];let delay=false;
 globalThis.window={addEventListener(){},removeEventListener(){},setTimeout};
 globalThis.AudioWorkletNode=class {
  constructor(context,name){
   this.name=name;this.messages=[];this.disconnects=0;
   this.port={postMessage:message=>{this.messages.push(message);if(message.port){this.remote=message.port;message.port.onmessage=({data})=>{if(data.method==='dispose')message.port.close();};message.port.start();}},close(){}};
   nodes.push(this);if(!delay)queueMicrotask(()=>this.ready());
  }
  ready(){this.port.onmessage({data:{ready:true}});}
  connect(){} disconnect(){this.disconnects++;this.remote?.close();}
 };
 const media=()=>({stop(){},stopAll(){},pause(){},list:()=>[],unload(){}});
 const megaDrive={capabilities:{chip:selectedChip,fmChannels:6},audioContext:{sampleRate:44100,get currentTime(){return performance.now()/1000;},audioWorklet:{async addModule(){}}},audio:{masterInputNode:{}},fm:{setPreset(){},noteOff(){}},psg:{},sample:media(),stream:media(),async start(){},async resume(){},clearFXChain:()=>[]};
 const runtime=createPlaygroundRuntime({megaDrive,guardExecution:false});
 t.after(()=>{runtime.stop();Object.assign(globalThis,saved);});
 return {runtime,megaDrive,nodes,setDelay:value=>{delay=value;}};
}
for(const chip of ['rf5c164','ym2608','gameboy','ym2203','ym2610','ym2612','segapsg','ym2151','pwm','nes','dx7'])test(`Main managed ${chip} creates once, reuses on Run and recreates after Stop`,async t=>{
 const {runtime,nodes}=setup(t,chip==='ym2612'?'ym2203':'ym2612');
 const source=`const [a,b]=await Promise.all([useSoundChip('${chip}'),useSoundChip('${chip}')]);
 if(a!==b || (context.pcm && a!==context.pcm))throw Error('identity');context.pcm=a;
 if('${chip}'==='ym2608' && (typeof a.setClock!=='function'||typeof a.resetRegisters!=='function'))throw Error('Missing YM2608 import API');`;
 await runtime.playSource(source);await runtime.playSource(source);assert.equal(nodes.length,1);
 assert.equal(runtime.context.pcm.id,`${chip}:shared`);
 runtime.stop();assert.equal(nodes[0].disconnects,1);assert.equal(Object.keys(runtime.context).length,0);
 await runtime.playSource(source);assert.equal(nodes.length,2);
 assert.equal(runtime.context.pcm.id,`${chip}:shared`,'the logical cached source retains its mixer identity after Stop');
 await runtime.playSource(`const a=await useSoundChip('${chip}');a.dispose();const b=await useSoundChip('${chip}');if(a===b)throw Error('disposed instance');`);
 assert.equal(nodes.length,3);
});
test('Main disposes initialization completed after Stop and permits a new lookup',async t=>{
 const {runtime,nodes,setDelay}=setup(t);setDelay(true);
 const state=runtime.context;
 const running=runtime.playSource(`await useSoundChip('rf5c164');context.completed=true;`);
 for(let i=0;i<100 && !nodes.length;i++)await tick();assert.equal(nodes.length,1);
 runtime.stop();nodes[0].ready();await running;assert.equal(state.completed,undefined);assert.equal(nodes[0].disconnects,1);
 setDelay(false);await runtime.playSource(`await useSoundChip('rf5c164');`);assert.equal(nodes.length,2);
});

for (const name of ['ym2612','ym2203','ym2610','segapsg','ym2151','dx7']) test(`Main creates independent ${name} nodes and Stop disposes both`, async t => {
 const {runtime,nodes}=setup(t);
 await runtime.playSource(`const [a,b]=await Promise.all([createSoundChip('${name}'),createSoundChip('${name}')]);if(a===b||a===fm||a.id===b.id)throw Error('identity');if('${name}'==='segapsg'){a.tone(0,{note:'C4'});b.noiseOff();}else if('${name}'==='ym2151'){a.setNote(7,'A4');a.keyOn(7);b.keyOff(7);}else if('${name}'==='dx7'){a.noteOn(60,100);b.noteOff(60);}else{a.noteOn(0,4,600);b.noteOff(0);}context.a=a;`);
 assert.equal(nodes.length,2);
 runtime.stop();assert.ok(nodes.every(n=>n.disconnects===1));assert.equal(Object.keys(runtime.context).length,0);
});

for (const name of ['ym2612','ym2203','ym2610','segapsg','ym2151','nes','dx7']) test(`Main Stop during ${name} creation disposes the late node`, async t => {
 const {runtime,nodes,setDelay}=setup(t);setDelay(true);
 const state=runtime.context;
 const running=runtime.playSource(`await createSoundChip('${name}');context.completed=true;`);
 for(let i=0;i<100&&!nodes.length;i++)await tick();assert.equal(nodes.length,1);
 runtime.stop();nodes[0].ready();await running;
 assert.equal(state.completed,undefined);assert.equal(nodes[0].disconnects,1);
});

test('Main DX7 processor failure releases the cached endpoint and permits a fresh lookup', async t => {
 const {runtime,nodes}=setup(t);
 await runtime.playSource(`context.before=await useSoundChip('dx7');`);
 assert.equal(nodes.length,1);
 const before=runtime.context.before;
 nodes[0].port.onmessage({data:{fatal:true,error:'DX7 processor failed'}});
 assert.equal(nodes[0].disconnects,1);
 assert.throws(()=>before.noteOn(60,100),/disposed/);
 await runtime.playSource(`context.after=await useSoundChip('dx7');`);
 assert.equal(nodes.length,2);
 assert.notEqual(runtime.context.after,before);
});

test('Main custom host without a mixer removes manually disposed chips from the inspector',async t=>{
 const {runtime,nodes}=setup(t);
 await runtime.playSource(`context.psg=await useSoundChip('segapsg');`);
 assert.deepEqual(runtime.chipInspector.list().map(entry=>entry.id),['segapsg:shared']);
 runtime.context.psg.dispose();
 assert.deepEqual(runtime.chipInspector.list(),[]);assert.equal(nodes[0].disconnects,1);
 await runtime.playSource(`context.psg=await useSoundChip('segapsg');`);
 assert.equal(nodes.length,2);assert.deepEqual(runtime.chipInspector.list().map(entry=>entry.id),['segapsg:shared']);
 runtime.stop();assert.deepEqual(runtime.chipInspector.list(),[]);
});

test('Worker same-ID recreation waits for audible retirement without blocking other RPC, and Stop fences pending creation',async t=>{
 const {runtime,megaDrive,nodes}=setup(t),workers=[];
 const OriginalNode=globalThis.AudioWorkletNode,savedWorker=globalThis.Worker;
 let session;
 const addControls=port=>{
  const listeners=new Set(),post=port.postMessage.bind(port);
  port.addEventListener=(_,fn)=>listeners.add(fn);port.removeEventListener=(_,fn)=>listeners.delete(fn);port.start=()=>{};
  port.postMessage=message=>{
   if(message.type==='performance-start'){
    session=message.session;queueMicrotask(()=>{for(const fn of listeners)fn({data:{type:'performance-result',id:message.id}});});
   }else post(message);
  };
  return port;
 };
 globalThis.AudioWorkletNode=class extends OriginalNode {constructor(...args){super(...args);addControls(this.port);}};
 megaDrive.node={port:addControls({postMessage(){}})};megaDrive.audioContext.state='running';
 globalThis.Worker=class {
  constructor(){this.responses=[];workers.push(this);}
  postMessage(message){
   if(message.type==='run')queueMicrotask(()=>this.onmessage({data:{type:'complete',loopCount:1}}));
   if(message.type==='response')this.responses.push(message);
   if(message.type==='stop')queueMicrotask(()=>{this.onmessage({data:{type:'command',command:'audio.stopAll',args:[]}});this.onmessage({data:{type:'stopped'}});});
  }
  terminate(){}
  send(data){this.onmessage({data});}
 };
 t.after(()=>{globalThis.Worker=savedWorker;});
 await runtime.playSource('',{execution:'worker'});const worker=workers[0];
 const request=(id,command,args=[])=>worker.send({type:'request',id,command,args});
 const waitResponse=async id=>{for(let i=0;i<300;i++){const response=worker.responses.find(message=>message.id===id);if(response)return response;await tick();}assert.fail('Worker request did not settle: '+id);};
 const id='segapsg:shared';request(1,'pcm.create',['segapsg',{id}]);const first=await waitResponse(1);assert.equal(first.error,undefined);
 worker.send({type:'command',command:'pcm.dispose',args:[id],performance:{session,time:megaDrive.audioContext.currentTime+.08}});
 request(2,'pcm.create',['segapsg',{id}]);request(3,'getTiming');
 await waitResponse(3);assert.equal(worker.responses.some(message=>message.id===2),false,'same source must keep playing until its retirement position');
 const second=await waitResponse(2);assert.equal(second.error,undefined);assert.equal(nodes.length,2);assert.equal(nodes[0].disconnects,1);
 worker.send({type:'command',command:'pcm.dispose',args:[id],performance:{session,time:megaDrive.audioContext.currentTime+.5}});
 request(4,'pcm.create',['segapsg',{id}]);request(5,'getTiming');await waitResponse(5);
 runtime.stop();const stopped=await waitResponse(4);assert.match(stopped.error,/Run stopped/);assert.equal(nodes.length,2,'a late reconnect cannot reopen audio after Stop');
 first.value.port.close();second.value.port.close();
});

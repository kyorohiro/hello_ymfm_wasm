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
 const megaDrive={capabilities:{chip:selectedChip,fmChannels:6},audioContext:{get currentTime(){return performance.now()/1000;},audioWorklet:{async addModule(){}}},audio:{masterInputNode:{}},fm:{setPreset(){},noteOff(){}},psg:{},sample:media(),stream:media(),async start(){},async resume(){},clearFXChain:()=>[]};
 const runtime=createPlaygroundRuntime({megaDrive,guardExecution:false});
 t.after(()=>{runtime.stop();Object.assign(globalThis,saved);});
 return {runtime,nodes,setDelay:value=>{delay=value;}};
}
for(const chip of ['rf5c164','ym2608','gameboy','ym2203','ym2610','ym2612','segapsg','ym2151'])test(`Main managed ${chip} creates once, reuses on Run and recreates after Stop`,async t=>{
 const {runtime,nodes}=setup(t,chip==='ym2612'?'ym2203':'ym2612');
 const source=`const [a,b]=await Promise.all([useSoundChip('${chip}'),useSoundChip('${chip}')]);
 if(a!==b || (context.pcm && a!==context.pcm))throw Error('identity');context.pcm=a;
 if('${chip}'==='ym2608' && (typeof a.setClock!=='function'||typeof a.resetRegisters!=='function'))throw Error('Missing YM2608 import API');`;
 await runtime.playSource(source);await runtime.playSource(source);assert.equal(nodes.length,1);
 runtime.stop();assert.equal(nodes[0].disconnects,1);assert.equal(Object.keys(runtime.context).length,0);
 await runtime.playSource(source);assert.equal(nodes.length,2);
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

for (const name of ['ym2612','ym2203','ym2610','segapsg','ym2151']) test(`Main creates independent ${name} nodes and Stop disposes both`, async t => {
 const {runtime,nodes}=setup(t);
 await runtime.playSource(`const [a,b]=await Promise.all([createSoundChip('${name}'),createSoundChip('${name}')]);if(a===b||a===fm)throw Error('identity');if('${name}'==='segapsg'){a.tone(0,{note:'C4'});b.noiseOff();}else if('${name}'==='ym2151'){a.setNote(7,'A4');a.keyOn(7);b.keyOff(7);}else{a.noteOn(0,4,600);b.noteOff(0);}context.a=a;`);
 assert.equal(nodes.length,2);
 runtime.stop();assert.ok(nodes.every(n=>n.disconnects===1));assert.equal(Object.keys(runtime.context).length,0);
});

for (const name of ['ym2612','ym2203','ym2610','segapsg','ym2151']) test(`Main Stop during ${name} creation disposes the late node`, async t => {
 const {runtime,nodes,setDelay}=setup(t);setDelay(true);
 const state=runtime.context;
 const running=runtime.playSource(`await createSoundChip('${name}');context.completed=true;`);
 for(let i=0;i<100&&!nodes.length;i++)await tick();assert.equal(nodes.length,1);
 runtime.stop();nodes[0].ready();await running;
 assert.equal(state.completed,undefined);assert.equal(nodes[0].disconnects,1);
});

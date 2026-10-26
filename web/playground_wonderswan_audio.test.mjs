import test from 'node:test';
import assert from 'node:assert/strict';

let sequence=0;
async function harness(fetcher,run){
  const previous={fetch:globalThis.fetch,AudioWorkletNode:globalThis.AudioWorkletNode},nodes=[],modules=[];
  globalThis.fetch=fetcher;globalThis.AudioWorkletNode=class{constructor(context,name,options){this.name=name;this.options=options;this.port={postMessage(){},close:()=>this.closed=true};nodes.push(this);queueMicrotask(()=>this.port.onmessage?.({data:{ready:true}}));}connect(){this.connected=true;}disconnect(){this.disconnected=true;}};
  const listeners=new Map(),context={state:'suspended',audioWorklet:{addModule:async url=>modules.push(String(url))},addEventListener:(type,listener)=>listeners.set(type,listener),removeEventListener:(type,listener)=>{if(listeners.get(type)===listener)listeners.delete(type);}};
  try{const {createWonderSwanAudio}=await import(`./playground_wonderswan_audio.js?test=${++sequence}`);await run({createWonderSwanAudio,context,nodes,modules,listeners});}finally{globalThis.fetch=previous.fetch;globalThis.AudioWorkletNode=previous.AudioWorkletNode;}
}
test('WonderSwan audio setup fetches WASM before connecting and caches module registration per context',async()=>{
  const bytes=new Uint8Array([0,97,115,109]).buffer,requests=[];
  await harness(async(url,options)=>{requests.push({url:String(url),options});return {ok:true,arrayBuffer:async()=>bytes};},async({createWonderSwanAudio,context,nodes,modules})=>{
    const a=await createWonderSwanAudio(context,{}),b=await createWonderSwanAudio(context,null,{clock:4000000});try{assert.equal(nodes[0].name,'tetorica-wonderswan');assert.equal(nodes[0].options.processorOptions.wasmBinary,bytes);assert.equal(nodes[0].options.processorOptions.clock,3072000);assert.equal(nodes[1].options.processorOptions.clock,4000000);assert(nodes[0].connected);assert(!nodes[1].connected);assert.match(requests[0].url,/generated\/wonderswan_wasm\.wasm$/);assert.match(modules[0],/playground_wonderswan_worklet\.js$/);assert.equal(modules.length,1);}finally{a.dispose();a.dispose();b.dispose();assert(nodes.every(n=>n.closed&&n.disconnected));}
  });
});
test('WonderSwan failed/aborted WASM setup never creates an audio processor',async()=>{
  await harness(async()=>({ok:false,status:404}),async({createWonderSwanAudio,context,nodes})=>{await assert.rejects(createWonderSwanAudio(context,{}),/WASM HTTP 404/);assert.equal(nodes.length,0);});
  await harness(()=>new Promise(()=>{}),async({createWonderSwanAudio,context,nodes})=>{const controller=new AbortController(),pending=createWonderSwanAudio(context,{}, {signal:controller.signal});controller.abort();await assert.rejects(pending,/abort/i);assert.equal(nodes.length,0);});
});
test('WonderSwan validation precedes fetching and a closed context is rejected',async()=>{
  let fetched=0;await harness(async()=>{fetched++;throw new Error('unexpected fetch');},async({createWonderSwanAudio,context,nodes})=>{await assert.rejects(createWonderSwanAudio(context,{}, {clock:1}),/clock/);context.state='closed';await assert.rejects(createWonderSwanAudio(context,{}),/open AudioContext/);assert.equal(nodes.length,0);assert.equal(fetched,0);});
});

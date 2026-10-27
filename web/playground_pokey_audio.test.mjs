import test from 'node:test';
import assert from 'node:assert/strict';
let sequence=0;
async function harness(fetcher,run,{ready=true,moduleError}={}){
  const previous={fetch:globalThis.fetch,AudioWorkletNode:globalThis.AudioWorkletNode},nodes=[],modules=[];
  globalThis.fetch=fetcher;globalThis.AudioWorkletNode=class{constructor(context,name,options){this.name=name;this.options=options;this.port={postMessage:message=>{(this.sent??=[]).push(message);},close:()=>this.closed=true};nodes.push(this);if(ready)queueMicrotask(()=>this.port.onmessage?.({data:{ready:true}}));}connect(){this.connected=true;}disconnect(){this.disconnected=true;}};
  const listeners=new Set(),context={sampleRate:48000,state:'suspended',audioWorklet:{addModule:async url=>{modules.push(String(url));if(moduleError)throw moduleError;}},addEventListener:(type,listener)=>listeners.add(listener),removeEventListener:(type,listener)=>listeners.delete(listener)};
  try{const {createPokeyAudio}=await import(`./playground_pokey_audio.js?test=${++sequence}`);await run({createPokeyAudio,context,nodes,modules,listeners});}finally{globalThis.fetch=previous.fetch;globalThis.AudioWorkletNode=previous.AudioWorkletNode;}
}

test('POKEY setup uses actual host sample rate, independent clock profiles and shared module registration',async()=>{
  const bytes=new Uint8Array([0,97,115,109]).buffer,requests=[];
  await harness(async(url,options)=>{requests.push({url:String(url),options});return {ok:true,arrayBuffer:async()=>bytes};},async({createPokeyAudio,context,nodes,modules})=>{
    const a=await createPokeyAudio(context,{}),b=await createPokeyAudio(context,null,{clock:1789773});
    try{assert.equal(nodes[0].name,'tetorica-pokey');assert.equal(nodes[0].options.processorOptions.wasmBinary,bytes);assert.equal(nodes[0].options.processorOptions.clock,1789790);assert.equal(nodes[1].options.processorOptions.clock,1789773);assert(nodes[0].connected);assert(!nodes[1].connected);assert.match(requests[0].url,/generated\/pokey_wasm\.wasm$/);assert.match(modules[0],/playground_pokey_worklet\.js$/);assert.equal(modules.length,1);assert.notEqual(a.port,b.port);}finally{a.dispose();a.dispose();assert(!nodes[1].closed,'first disposal must leave second endpoint alive');b.dispose();assert(nodes.every(node=>node.closed&&node.disconnected));}
  });
});

test('POKEY asset failures and pre-fetch aborts never create an audio processor',async()=>{
  await harness(async()=>({ok:false,status:404}),async({createPokeyAudio,context,nodes})=>{await assert.rejects(createPokeyAudio(context,{}),/WASM HTTP 404/);assert.equal(nodes.length,0);});
  await harness(()=>new Promise(()=>{}),async({createPokeyAudio,context,nodes})=>{const controller=new AbortController(),pending=createPokeyAudio(context,{}, {signal:controller.signal});controller.abort();await assert.rejects(pending,/abort/i);assert.equal(nodes.length,0);});
  await harness(async()=>({ok:true,arrayBuffer:async()=>new ArrayBuffer(4)}),async({createPokeyAudio,context,nodes})=>{await assert.rejects(createPokeyAudio(context,{}),/module registration failed/);assert.equal(nodes.length,0);},{moduleError:new Error('module registration failed')});
});

test('POKEY validation precedes fetching and unsupported contexts do not allocate nodes',async()=>{
  let fetched=0;await harness(async()=>{fetched++;throw new Error('unexpected fetch');},async({createPokeyAudio,context,nodes})=>{
    await assert.rejects(createPokeyAudio(context,{}, {clock:1}),/clock/);context.sampleRate=0;await assert.rejects(createPokeyAudio(context,{}),/sample rate/);context.sampleRate=48000;context.state='closed';await assert.rejects(createPokeyAudio(context,{}),/open AudioContext/);assert.equal(nodes.length,0);assert.equal(fetched,0);
  });
});

test('POKEY post-ready processor failure retires only its endpoint and reports the failure once',async()=>{
  await harness(async()=>({ok:true,arrayBuffer:async()=>new ArrayBuffer(4)}),async({createPokeyAudio,context,nodes})=>{
    const errors=[],a=await createPokeyAudio(context,{}, {onError:error=>errors.push(error)}),b=await createPokeyAudio(context,{});
    try{nodes[0].onprocessorerror();assert(nodes[0].closed);assert(!nodes[1].closed);assert.equal(errors.length,1);assert.match(errors[0].message,/processor failed/);a.dispose();assert.equal(errors.length,1);}finally{a.dispose();b.dispose();}
  });
});

import test from 'node:test';
import assert from 'node:assert/strict';

let sequence=0;
async function harness(fetcher,run){
  const previous={fetch:globalThis.fetch,AudioWorkletNode:globalThis.AudioWorkletNode},nodes=[],modules=[];
  globalThis.fetch=fetcher;
  globalThis.AudioWorkletNode=class{
    constructor(context,name,options){this.options=options;this.messages=[];this.port={postMessage:message=>this.messages.push(message),close:()=>{this.closed=true;}};nodes.push(this);queueMicrotask(()=>this.port.onmessage?.({data:{ready:true,backend:'wasm'}}));}
    connect(){this.connected=true;}disconnect(){this.disconnected=true;}
  };
  const context={audioWorklet:{addModule:async url=>modules.push(String(url))}};
  try{const {createNesAudio}=await import(`./playground_nes_audio.js?test=${++sequence}`);await run({createNesAudio,context,nodes,modules});}
  finally{globalThis.fetch=previous.fetch;globalThis.AudioWorkletNode=previous.AudioWorkletNode;}
}

test('NES audio setup fetches WASM outside the processor and supplies bytes before connecting',async()=>{
  const bytes=new Uint8Array([0,97,115,109]).buffer,requests=[];
  await harness(async(url,options)=>{requests.push({url:String(url),options});return {ok:true,arrayBuffer:async()=>bytes};},async({createNesAudio,context,nodes,modules})=>{
    const endpoint=await createNesAudio(context,{}, {fds:true});
    try{assert.equal(nodes.length,1);assert.equal(nodes[0].options.processorOptions.wasmBinary,bytes);assert.equal(nodes[0].options.processorOptions.fds,true);assert.equal(nodes[0].connected,true);assert.match(requests[0].url,/generated\/nesapu_wasm\.wasm$/);assert.match(modules[0],/playground_nes_worklet\.js$/);}
    finally{endpoint.dispose();assert(nodes[0].disconnected);assert(nodes[0].closed);}
  });
});

test('failed NES WASM fetches never create an AudioWorklet or silently use JS synthesis',async()=>{
  await harness(async()=>({ok:false,status:404}),async({createNesAudio,context,nodes})=>{
    await assert.rejects(createNesAudio(context,{}),/NES WASM HTTP 404/);assert.equal(nodes.length,0);
  });
});

test('aborting pending NES WASM setup leaves no audio node or connected device',async()=>{
  await harness(()=>new Promise(()=>{}),async({createNesAudio,context,nodes})=>{
    const controller=new AbortController(),pending=createNesAudio(context,{}, {signal:controller.signal});controller.abort();
    await assert.rejects(pending,/abort/i);assert.equal(nodes.length,0);
  });
});

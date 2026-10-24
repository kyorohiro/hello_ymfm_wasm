import test from 'node:test';
import assert from 'node:assert/strict';

test('independent Browser YM2612 loads the selected engine once, contains no PSG, and preserves immutable physical metadata',async t=>{
  const previous={fetch:globalThis.fetch,AudioWorkletNode:globalThis.AudioWorkletNode};
  const requests=[],modules=[],nodes=[];
  globalThis.fetch=async url=>{requests.push(String(url));return {ok:true,arrayBuffer:async()=>new ArrayBuffer(8)};};
  globalThis.AudioWorkletNode=class {
    constructor(context,name,options){this.name=name;this.options=options;this.context=context;this.messages=[];this.connections=[];nodes.push(this);
      this.port={close(){},postMessage:message=>this.messages.push(message)};
      queueMicrotask(()=>this.port.onmessage({data:{ready:true}}));
    }
    connect(destination){this.connections.push(destination);}
    disconnect(){this.connections=[];this.disconnected=true;}
  };
  t.after(()=>{globalThis.fetch=previous.fetch;globalThis.AudioWorkletNode=previous.AudioWorkletNode;});
  const {createOpnAudio}=await import('./playground_opn_audio.js?engine-selection');
  const context={state:'running',audioWorklet:{async addModule(url){modules.push(String(url));}}},destination={};
  const endpoints=await Promise.all([undefined,'ymfm','nuked'].map(engine=>createOpnAudio(context,destination,'ym2612',{engine})));
  t.after(()=>endpoints.forEach(endpoint=>endpoint.dispose()));
  assert.deepEqual(endpoints.map(endpoint=>endpoint.engine),['ymfm','ymfm','nuked']);
  for(const endpoint of endpoints)assert.throws(()=>{endpoint.engine='other';},TypeError);
  assert.equal(requests.length,3);assert(requests[0].endsWith('/generated/ym2612_wasm.wasm'));assert(requests[1].endsWith('/generated/ym2612_wasm.wasm'));assert(requests[2].endsWith('/generated/nuked_opn2_wasm.wasm'));
  assert(modules.every(url=>url.endsWith('/playground_opn_worklet.js')));
  assert(nodes.every(node=>node.name==='tetorica-opn'&&node.options.numberOfInputs===0&&node.options.outputChannelCount[0]===2));
  assert.deepEqual(nodes.map(node=>node.options.processorOptions.engine),['ymfm','ymfm','nuked']);
  assert(!requests.some(url=>url.includes('psg')),'an extra YM2612 contains only its requested FM core');
  const requestsBefore=requests.length,nodesBefore=nodes.length;
  await assert.rejects(createOpnAudio(context,destination,'ym2612',{engine:'invalid'}),/engine/);
  assert.equal(requests.length,requestsBefore);assert.equal(nodes.length,nodesBefore);
  for(const endpoint of endpoints){endpoint.dispose();endpoint.dispose();}
  assert(nodes.every(node=>node.disconnected));assert(nodes.every(node=>node.messages.filter(message=>message.method==='dispose').length===1));
});

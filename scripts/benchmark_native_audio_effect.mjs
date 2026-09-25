// Node-only DSP timing, not a browser dropout or old-PC performance guarantee.
import {readFile} from 'node:fs/promises';
import {performance} from 'node:perf_hooks';
import {setChain,preset} from '../docs/native_audio_effect/graph.js';
const module=await WebAssembly.compile(await readFile(new URL('../docs/native_audio_effect/gain.wasm',import.meta.url)));
for(const mode of ['serial','extended']) {
  const api=new WebAssembly.Instance(module,{env:{emscripten_notify_memory_growth(){}}}).exports;
  api._initialize();api.graph_reset(48000);setChain(api,preset(mode));
  api.gate_set(-40,6,5,50,100,0);api.compressor_set(-18,4,10,150,0,0);api.reverb_set(0.25,0.6,0.4);
  if(mode==='extended') for(let kind=7;kind<=14;kind++) api.extra_set(kind,0,7,0);
  const cap=api.gain_capacity();
  const input=new Float32Array(api.memory.buffer,api.gain_input(),cap*2);
  for(let i=0;i<128;i++) input[i]=input[cap+i]=0.15*Math.sin(2*Math.PI*440*i/48000);
  for(let i=0;i<500;i++) api.graph_process(128);
  const times=[];
  for(let i=0;i<3750;i++) {const start=performance.now();api.graph_process(128);times.push(performance.now()-start);}
  times.sort((a,b)=>a-b);
  console.log(JSON.stringify({mode,sampleRate:48000,frames:128,blockBudgetMs:128/48,
    meanMs:times.reduce((a,b)=>a+b,0)/times.length,p99Ms:times[Math.floor(times.length*0.99)],maxMs:times.at(-1),
    wasmMemoryMiB:api.memory.buffer.byteLength/1048576}));
}

// Node DSP/control overhead only. This does not measure browser/device underruns.
import {readFile} from 'node:fs/promises';
import {performance} from 'node:perf_hooks';
import {NativeFXEngine} from '../web/native_fx_engine.js';
import {createNativeFXController} from '../web/native_fx.js';
const module=await WebAssembly.compile(await readFile(new URL('../web/native_audio_effect.wasm',import.meta.url)));
for(const scenario of ['ambient-reverb','eight-filter-ramps']){
 const engine=new NativeFXEngine(module,48000);
 const fx=createNativeFXController(command=>engine.command(structuredClone(command)));
 const units=scenario==='ambient-reverb'?[fx.reverb({mix:.24,tone:6200})]:Array.from({length:8},()=>fx.filter());
 fx.setChain(units);
 if(scenario==='eight-filter-ramps')for(const unit of units)unit.cutoff.rampTo(600,120);
 const input=[Float32Array.from({length:128},(_,i)=>.1*Math.sin(i*.03)),new Float32Array(128)];
 const output=[new Float32Array(128),new Float32Array(128)];
 for(let i=0;i<4000;i++)engine.process(input,output);
 const times=new Float64Array(15000);
 for(let i=0;i<times.length;i++){
  const start=performance.now();engine.process(input,output);times[i]=performance.now()-start;
 }
 times.sort();
 console.log(JSON.stringify({scenario,sampleRate:48000,frames:128,blockBudgetMs:128/48,
  meanMs:times.reduce((sum,value)=>sum+value,0)/times.length,p99Ms:times[Math.floor(times.length*.99)],maxMs:times.at(-1)}));
}

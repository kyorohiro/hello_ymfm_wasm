import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {performance,PerformanceObserver} from 'node:perf_hooks';
import inspector from 'node:inspector';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const args=Object.fromEntries(process.argv.slice(2).map(a=>{const [k,...v]=a.replace(/^--/,'').split('=');return [k,v.length?v.join('='):true];}));
const root=path.resolve(args.root||process.cwd()),out=path.resolve(args.out||path.dirname(fileURLToPath(import.meta.url)));
const {Huc6280AudioEngine}=await import(pathToFileURL(path.join(root,'web/huc6280audioengine.js')));
const {default:factory}=await import(pathToFileURL(path.join(root,'docs/generated/huc6280_wasm.js')));
const bytes=fs.readFileSync(path.join(root,'docs/generated/huc6280_wasm.wasm'));
const N=5000,WARMUP=1500,TRIALS=5,RATE=48000,QUANTUM=128;
async function make(variant,volume=1){
 const e=await Huc6280AudioEngine.create({moduleFactory:()=>factory({wasmBinary:bytes}),clock:3579545,outputSampleRate:RATE,masterVolume:volume});
 if(variant==='indexed')e.processFrames=function(frames){
  if(!Number.isInteger(frames)||frames<0||frames>0x1000000)throw new RangeError('Invalid frame count');if(!this.handle)throw Error('HuC6280 engine is disposed');
  if(!frames)return {left:new Float32Array(),right:new Float32Array()};
  if(frames>this.capacity){if(this.ptr)this.module._free(this.ptr);this.ptr=this.capacity=0;this.ptr=this.module._malloc(frames*8);if(!this.ptr)throw Error('HuC6280 output allocation failed');this.capacity=frames;}
  const rightPtr=this.ptr+this.capacity*4;this.module._huc6280_generate(this.handle,this.ptr,rightPtr,frames);const heap=this.module.HEAPF32,left=new Float32Array(frames),right=new Float32Array(frames),l=this.ptr/4,r=rightPtr/4;
  for(let i=0;i<frames;i++){left[i]=heap[l+i]*this.volume;right[i]=heap[r+i]*this.volume;}return {left,right};
 };
 const w=(r,v)=>e.writeHuc6280(r,v);w(1,255);w(0,0);w(4,64);w(4,0);for(let i=0;i<32;i++)w(6,i<16?31:0);w(2,254);w(3,0);w(5,255);w(4,159);return e;
}
function run(e,n,times){let checksum=0;for(let i=0;i<n;i++){const start=times?performance.now():0;const pcm=e.processFrames(QUANTUM);if(times)times[i]=performance.now()-start;checksum+=pcm.left[i%QUANTUM]+pcm.right[i%QUANTUM];}return checksum;}
function stats(xs){const a=[...xs].sort((x,y)=>x-y),q=p=>a[Math.floor((a.length-1)*p)]*1000;return {meanUs:xs.reduce((a,b)=>a+b,0)*1000/xs.length,p50Us:q(.5),p95Us:q(.95),p99Us:q(.99),maxUs:a.at(-1)*1000};}
async function correctness(variant,volume){const e=await make(variant,volume),hash=createHash('sha256');let frames=0,peak=0;for(let i=0;i<500;i++){const n=i<8?[0,1,127,128,257,4096,31,256][i]:QUANTUM;const pcm=e.processFrames(n);frames+=n;for(const side of [pcm.left,pcm.right]){hash.update(side);for(const value of side){if(!Number.isFinite(value))throw Error('nonfinite');peak=Math.max(peak,Math.abs(value));}}}e.dispose();return {sha256:hash.digest('hex'),frames,peak};}
const result={metadata:{dateUTC:new Date().toISOString(),node:process.version,v8:process.versions.v8,platform:process.platform,arch:process.arch,os:os.release(),cpu:os.cpus()[0]?.model,logicalCPUs:os.cpus().length,git:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),sampleRate:RATE,quantum:QUANTUM,warmupBlocks:WARMUP,measuredBlocks:N,trials:TRIALS,sameRealm:true,engine:'Huc6280AudioEngine direct ESM import with shipped WASM; no VM, browser, Worklet scheduler, UI, Worker or device',timing:'Two performance.now calls per block; sampling profiler is in a separate pass; interleaved AB/BA trial order',allocationLimit:'Approximate V8 sampling, not comprehensive external ArrayBuffer accounting. Both conditions allocate two owned Float32Array payloads = 5,120,000 bytes per 5,000 blocks, separately from sampled totals.',hashes:Object.fromEntries(['web/huc6280audioengine.js','docs/generated/huc6280_wasm.js','docs/generated/huc6280_wasm.wasm'].map(f=>[f,createHash('sha256').update(fs.readFileSync(path.join(root,f))).digest('hex')])),productionEdited:false},correctness:[],timing:{current:[],indexed:[]},allocations:{}};
for(const volume of [1,.7])for(const variant of ['current','indexed'])result.correctness.push({volume,variant,...await correctness(variant,volume)});
for(const volume of [1,.7])if(new Set(result.correctness.filter(r=>r.volume===volume).map(r=>r.sha256)).size!==1)throw Error('PCM differs');
const timer=new Float64Array(100000);for(let i=0;i<timer.length;i++){const s=performance.now();timer[i]=performance.now()-s;}result.metadata.timerControl=stats(timer);
for(let trial=0;trial<TRIALS;trial++)for(const variant of trial%2?['indexed','current']:['current','indexed']){
 const e=await make(variant);run(e,WARMUP);global.gc?.();await new Promise(r=>setTimeout(r,5));const gc=[];const observer=new PerformanceObserver(list=>{for(const x of list.getEntries())gc.push({startTime:x.startTime,durationMs:x.duration,kind:x.detail?.kind});});observer.observe({entryTypes:['gc']});const times=new Float64Array(N),start=performance.now(),checksum=run(e,N,times),end=performance.now();await new Promise(r=>setTimeout(r,5));observer.disconnect();result.timing[variant].push({trial:trial+1,...stats(times),wallMs:end-start,checksum,naturalGC:gc.filter(x=>x.startTime>=start&&x.startTime<end)});e.dispose();
}
for(const variant of ['current','indexed']){
 const e=await make(variant);run(e,WARMUP);let malloc=0,free=0,memoryChanges=0;const module=e.module,oldMalloc=module._malloc,oldFree=module._free,oldMemory=module.HEAPF32.buffer;module._malloc=function(...args){malloc++;return oldMalloc(...args);};module._free=function(...args){free++;return oldFree(...args);};
 const session=new inspector.Session();session.connect();const post=(method,params={})=>new Promise((r,j)=>session.post(method,params,(err,value)=>err?j(err):r(value)));global.gc?.();await post('HeapProfiler.startSampling',{samplingInterval:1024,includeObjectsCollectedByMajorGC:true,includeObjectsCollectedByMinorGC:true});const checksum=run(e,N);const profile=(await post('HeapProfiler.stopSampling')).profile;session.disconnect();if(module.HEAPF32.buffer!==oldMemory)memoryChanges++;const sites=[];function walk(node){if(node.selfSize)sites.push({bytes:node.selfSize,function:node.callFrame.functionName,url:node.callFrame.url,line:node.callFrame.lineNumber+1});for(const child of node.children||[])walk(child);}walk(profile.head);sites.sort((a,b)=>b.bytes-a.bytes);result.allocations[variant]={sampleIntervalBytes:1024,sampledAllocatedBytes:sites.reduce((a,b)=>a+b.bytes,0),sites:sites.slice(0,12),malloc,free,memoryChanges,checksum};e.dispose();
}
fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'huc-same-realm-results.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));

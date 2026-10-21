import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {performance,PerformanceObserver} from 'node:perf_hooks';
import inspector from 'node:inspector';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';

const args=Object.fromEntries(process.argv.slice(2).map(a=>{const [key,...v]=a.replace(/^--/,'').split('=');return [key,v.length?v.join('='):true];}));
const root=path.resolve(args.root||process.cwd()), out=path.resolve(args.out||path.dirname(fileURLToPath(import.meta.url)));
const RATE=48000,QUANTUM=128,N=Number(args.blocks||5000),WARMUP=Number(args.warmup||1500),TRIALS=Number(args.trials||5);
for(const value of [N,WARMUP,TRIALS])if(!Number.isSafeInteger(value)||value<=0)throw Error('blocks, warmup and trials must be positive integers');
const cases=[['ym2612','baseline'],['gameboy','current'],['gameboy','borrowed'],['ym2413','current'],['ym2413','direct'],['ym2413','borrowed'],['ym2413','both'],['huc6280','current'],['huc6280','borrowed'],['huc6280','indexed']];
const scripts={ym2612:'ym2612-worklet.js',gameboy:'playground_gameboy_worklet.js',ym2413:'playground_ym2413_worklet.js',huc6280:'playground_huc6280_worklet.js'};
const binaries={ym2612:'ym2612',gameboy:'gameboy_apu',ym2413:'ym2413',huc6280:'huc6280'};
const hashFile=f=>createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const factoryCache=new Map();
async function make(chip,variant){
 let Type,messages=0,readyResolve,readyReject;const ready=new Promise((r,j)=>{readyResolve=r;readyReject=j;});
 const scope={sampleRate:RATE,currentFrame:0,Float32Array,Float64Array,Int8Array,Int16Array,Int32Array,Uint8Array,Uint16Array,Uint32Array,ArrayBuffer,DataView,TextDecoder,TextEncoder,URL,console,WebAssembly,performance,
  AudioWorkletProcessor:class{constructor(){this.port={postMessage(data){messages++;if(data.ready||data.type==='ready')readyResolve();if(data.error)readyReject(Error(data.error));},close(){},start(){}};}},registerProcessor:(_name,T)=>Type=T};
 const context=vm.createContext(scope),cache=new Map();
 async function load(file){
  file=file.split('?')[0];if(cache.has(file))return cache.get(file);
  if(file.includes('/generated/')){
   const nativeFile=path.join(root,'docs/generated',path.basename(file));
   if(!factoryCache.has(nativeFile))factoryCache.set(nativeFile,await import(pathToFileURL(nativeFile)));
   const exports=factoryCache.get(nativeFile),mod=new vm.SyntheticModule(Object.keys(exports),function(){for(const key of Object.keys(exports))this.setExport(key,exports[key]);},{context,identifier:nativeFile});cache.set(file,mod);return mod;
  }
  const mod=new vm.SourceTextModule(fs.readFileSync(file,'utf8'),{context,identifier:file,initializeImportMeta(meta){meta.url=pathToFileURL(file).href;}});cache.set(file,mod);await Promise.all(mod.dependencySpecifiers.map(specifier=>load(path.resolve(path.dirname(file),specifier))));return mod;
 }
 const main=await load(path.join(root,'web',scripts[chip]));await main.link((specifier,ref)=>cache.get(path.resolve(path.dirname(ref.identifier),specifier).split('?')[0]));await main.evaluate();
 const wasmBinary=fs.readFileSync(path.join(root,'docs/generated',`${binaries[chip]}_wasm.wasm`));
 const p=chip==='ym2612'?new Type():new Type({processorOptions:{wasmBinary}});
 if(chip==='ym2612')await p.init(wasmBinary,fs.readFileSync(path.join(root,'docs/generated/segapsg_wasm.wasm')));
 await ready;const c=chip==='ym2612'?p.ym2612:p.chip;
 if(variant==='direct'||variant==='both'){
  if(!['gameboy','ym2413'].includes(chip))throw Error('No numeric intervention for this chip');
  c.api.generate=c.module[`_${binaries[chip]}_generate`].bind(c.module);
 }
 if(variant==='borrowed'||variant==='both'){
  // Diagnostic-only internal borrowed lifetime. Public owned API is not changed.
  const result={left:null,right:null};let buffer=null,lastLeft=0,lastRight=0,lastFrames=-1;
  const views=(frames,leftPtr,rightPtr)=>{
   const heap=c.module.HEAPF32.buffer;
   if(buffer!==heap||lastLeft!==leftPtr||lastRight!==rightPtr||lastFrames!==frames){buffer=heap;lastLeft=leftPtr;lastRight=rightPtr;lastFrames=frames;result.left=new Float32Array(heap,leftPtr,frames);result.right=new Float32Array(heap,rightPtr,frames);}
   return result;
  };
  if(chip==='gameboy')c.generateStereo=function(frames){
   this.assertAlive();if(!Number.isInteger(frames)||frames<0||frames>0x1000000)throw new RangeError('Invalid frame count');
   if(frames>this.capacity){const ptr=this.module._malloc(frames*8);if(!ptr)throw Error('allocation failed');if(this.ptr)this.module._free(this.ptr);this.ptr=ptr;this.capacity=frames;}
   const right=this.ptr+this.capacity*4;this.api.generate(this.handle,this.ptr,right,frames);return views(frames,this.ptr,right);
  };
  else if(chip==='ym2413')c.generateStereo=function(frames){
   if(!Number.isInteger(frames)||frames<0||frames>0x1000000)throw new RangeError('Invalid frame count');
   if(frames>this.bufferFrames){if(this.leftPtr)this.module._free(this.leftPtr);if(this.rightPtr)this.module._free(this.rightPtr);this.leftPtr=this.module._malloc(frames*4);this.rightPtr=this.module._malloc(frames*4);this.bufferFrames=frames;}
   this.api.generate(this.handle,this.leftPtr,this.rightPtr,frames);
   if(typeof this.api.getIrq==='function'&&typeof this.hooks.onIrq==='function'){const asserted=this.getIrq();if(this.lastIrqState!==asserted){this.lastIrqState=asserted;this.hooks.onIrq(asserted);}}
   return views(this.bufferFrames,this.leftPtr,this.rightPtr);
  };
  else if(chip==='huc6280'){
   if(c.volume!==1)throw Error('Borrowed HuC fixture requires default volume 1');
   c.processFrames=function(frames){
    if(!Number.isInteger(frames)||frames<0||frames>0x1000000)throw new RangeError('Invalid frame count');if(!this.handle)throw Error('disposed');
    if(frames>this.capacity){if(this.ptr)this.module._free(this.ptr);this.ptr=this.capacity=0;this.ptr=this.module._malloc(frames*8);if(!this.ptr)throw Error('allocation failed');this.capacity=frames;}
    const right=this.ptr+this.capacity*4;this.module._huc6280_generate(this.handle,this.ptr,right,frames);return views(frames,this.ptr,right);
   };
  }
 }
 if(variant==='indexed'){
  if(chip!=='huc6280')throw Error('Indexed fixture is HuC only');
  c.processFrames=function(frames){
   if(!Number.isInteger(frames)||frames<0||frames>0x1000000)throw new RangeError('Invalid frame count');if(!this.handle)throw Error('disposed');
   if(frames>this.capacity){if(this.ptr)this.module._free(this.ptr);this.ptr=this.capacity=0;this.ptr=this.module._malloc(frames*8);if(!this.ptr)throw Error('allocation failed');this.capacity=frames;}
   const rightPtr=this.ptr+this.capacity*4;this.module._huc6280_generate(this.handle,this.ptr,rightPtr,frames);const heap=this.module.HEAPF32,left=new Float32Array(frames),right=new Float32Array(frames),l=this.ptr/4,r=rightPtr/4;
   for(let i=0;i<frames;i++){left[i]=heap[l+i]*this.volume;right[i]=heap[r+i]*this.volume;}return {left,right};
  };
 }
 if(chip==='huc6280'&&args.volume!==undefined)c.setMasterVolume(Number(args.volume));
 const command=(register,value)=>p.apply({method:'writeRegister',args:[register,value]},p.port);
 if(chip==='ym2612'){
  const {YM2612Synth}=await import(pathToFileURL(path.join(root,'web/ym2612synth.js')));const {FM_PRESETS}=await import(pathToFileURL(path.join(root,'web/megasynth-fm-presets.js')));
  const fm=new YM2612Synth({transport:{write:(port,register,value)=>p.applyCommand({type:'write',port,register,value})}});fm.setPreset(0,FM_PRESETS['one-op-basic']);fm.noteOn(0,52);
 }else if(chip==='gameboy')for(const [r,v]of [[0x16,0x80],[0x14,0x77],[0x15,0x11],[0,0],[1,128],[2,240],[3,1750&255],[4,0x80|(1750>>8)]])command(r,v);
 else if(chip==='ym2413')for(const [r,v]of [[0x30,0x10],[0x10,0x80],[0x20,0x17]])command(r,v);
 else if(chip==='huc6280'){
  for(const [r,v]of [[1,255],[0,0],[4,64],[4,0]])command(r,v);for(let i=0;i<32;i++)command(6,i<16?31:0);for(const [r,v]of [[2,254],[3,0],[5,255],[4,159]])command(r,v);
 }
 const outputs=[[new Float32Array(QUANTUM),new Float32Array(QUANTUM)]],inputs=[];
 const step=()=>{const ok=p.process(inputs,outputs);if(!ok)throw Error('process returned false');scope.currentFrame+=outputs[0][0].length;};
 return {p,c,scope,step,outputs,get messages(){return messages;},dispose(){p.dispose?.();if(!p.dispose){p.ym2612?.dispose();p.psg?.dispose();}}};
}
const quantile=(xs,q)=>xs[Math.floor((xs.length-1)*q)];
function summarize(data){const sorted=[...data].sort((a,b)=>a-b);return {meanUs:data.reduce((a,b)=>a+b,0)*1000/data.length,p50Us:quantile(sorted,.5)*1000,p95Us:quantile(sorted,.95)*1000,p99Us:quantile(sorted,.99)*1000,maxUs:sorted.at(-1)*1000,overQuantumCount:data.filter(x=>x>QUANTUM/RATE*1000).length};}
async function pcm(chip,variant){const h=await make(chip,variant),hash=createHash('sha256');let peak=0,frames=0;for(let i=0;i<500;i++){if(i<8){const n=[1,127,128,257,4096,31,256,128][i];h.outputs[0]=[new Float32Array(n),new Float32Array(n)];}else if(i===8)h.outputs[0]=[new Float32Array(QUANTUM),new Float32Array(QUANTUM)];h.step();frames+=h.outputs[0][0].length;for(const side of h.outputs[0]){hash.update(side);for(const value of side){if(!Number.isFinite(value))throw Error('nonfinite PCM');peak=Math.max(peak,Math.abs(value));}}}h.dispose();if(!peak)throw Error('silent fixture');return {sha256:hash.digest('hex'),frames,peak};}
async function timing(chip,variant){const trials=[];for(let trial=0;trial<TRIALS;trial++){
 const h=await make(chip,variant);for(let i=0;i<WARMUP;i++)h.step();global.gc?.();await new Promise(r=>setTimeout(r,5));
 const gc=[];const observer=new PerformanceObserver(list=>{for(const e of list.getEntries())gc.push({durationMs:e.duration,kind:e.detail?.kind,startTime:e.startTime});});observer.observe({entryTypes:['gc']});const times=new Float64Array(N),start=performance.now();
 for(let i=0;i<N;i++){const t=performance.now();h.step();times[i]=performance.now()-t;}
 const end=performance.now();await new Promise(r=>setTimeout(r,5));observer.disconnect();trials.push({trial:trial+1,...summarize(times),wallMs:end-start,naturalGC:gc.filter(e=>e.startTime>=start&&e.startTime<end),messages:h.messages});h.dispose();
 }return {trials,trialMeanUs:summarize(trials.map(t=>t.meanUs/1000)),medianTrialP99Us:quantile(trials.map(t=>t.p99Us).sort((a,b)=>a-b),.5)};}
async function allocations(chip,variant){const h=await make(chip,variant);for(let i=0;i<WARMUP;i++)h.step();let malloc=0,free=0,generations=0,sourceFrames=0,memoryChanges=0,previousMemory=h.c.module.HEAPF32.buffer;const m=h.c.module,oldMalloc=m._malloc,oldFree=m._free;m._malloc=function(...args){malloc++;return oldMalloc(...args);};m._free=function(...args){free++;return oldFree(...args);};const name=chip==='huc6280'?'processFrames':chip==='ym2612'?'generateStereoView':'generateStereo',old=h.c[name];h.c[name]=function(frames){generations++;sourceFrames+=frames;const result=old.call(this,frames);if(previousMemory!==m.HEAPF32.buffer){memoryChanges++;previousMemory=m.HEAPF32.buffer;}return result;};
 const session=new inspector.Session();session.connect();const post=(method,params={})=>new Promise((r,j)=>session.post(method,params,(e,x)=>e?j(e):r(x)));
 global.gc?.();await post('HeapProfiler.startSampling',{samplingInterval:1024,includeObjectsCollectedByMajorGC:true,includeObjectsCollectedByMinorGC:true});for(let i=0;i<N;i++)h.step();const profile=(await post('HeapProfiler.stopSampling')).profile;session.disconnect();const sites=[];function walk(node){if(node.selfSize)sites.push({bytes:node.selfSize,function:node.callFrame.functionName,url:node.callFrame.url,line:node.callFrame.lineNumber+1});for(const ch of node.children||[])walk(ch);}walk(profile.head);sites.sort((a,b)=>b.bytes-a.bytes);const result={sampleIntervalBytes:1024,sampledAllocatedBytes:sites.reduce((sum,x)=>sum+x.bytes,0),sites:sites.slice(0,12),generations,sourceFrames,malloc,free,memoryChanges,notes:'Separate profiler pass, includes instrumentation wrappers; sampled allocation is approximate and is not the timing result. malloc/free counters exclude initialization and disposal.'};h.dispose();return result;}
const selected=args.case?cases.filter(([chip,variant])=>`${chip}:${variant}`===args.case):cases;
if(!selected.length)throw Error('Unknown case');
const smoke=!!args.smoke;
const metadata={dateUTC:new Date().toISOString(),node:process.version,v8:process.versions.v8,platform:process.platform,arch:process.arch,os:os.release(),cpu:os.cpus()[0]?.model,logicalCPUs:os.cpus().length,git:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),sampleRate:RATE,quantum:QUANTUM,warmupBlocks:WARMUP,blocksPerTrial:N,trials:TRIALS,hucMasterVolume:Number(args.volume??1),mode:'Main-equivalent no scheduled commands, real processor.process() in Node VM; no browser/device deadline inference',timingInstrumentation:'Two performance.now() calls per block; output arrays reused. Heap profiler and allocation instrumentation only in separate pass.',allocationLimit:'V8 sampling is approximate and does not account comprehensively for external ArrayBuffer backing-store bytes. PCM payload and copy bytes must be calculated separately from source-frame counts; do not treat sampled bytes as exact total heap traffic.',hashes:Object.fromEntries([...new Set([...selected.map(([c])=>binaries[c]),...(selected.some(([c])=>c==='ym2612')?['segapsg']:[])])].flatMap(name=>['js','wasm'].map(ext=>{const file=`docs/generated/${name}_wasm.${ext}`;return [file,hashFile(path.join(root,file))];}))),sourceHashes:Object.fromEntries([...new Set(selected.flatMap(([c])=>[`web/${scripts[c]}`,`web/${c==='huc6280'?'huc6280audioengine':c==='gameboy'?'gameboyapu':c}.js`]))].map(file=>[file,hashFile(path.join(root,file))])),productionEdited:false};
if(!smoke){const timerPairs=new Float64Array(100000);for(let i=0;i<timerPairs.length;i++){const start=performance.now();timerPairs[i]=performance.now()-start;}metadata.timerPairControl=summarize(timerPairs);}
fs.mkdirSync(out,{recursive:true});const results=[];
for(const [chip,variant]of selected){
 const correctness=await pcm(chip,variant);const result={chip,variant,pcm:correctness};if(!smoke){if(args.phase!=='alloc')result.timing=await timing(chip,variant);result.allocations=await allocations(chip,variant);}results.push(result);console.log(JSON.stringify(result));fs.writeFileSync(path.join(out,`${chip}-${variant}${smoke?'-smoke':''}.json`),JSON.stringify({metadata,result},null,2));
}
for(const chip of new Set(results.map(r=>r.chip))){const hashes=new Set(results.filter(r=>r.chip===chip).map(r=>r.pcm.sha256));if(hashes.size!==1)throw Error(`PCM differs for ${chip}`);}
fs.writeFileSync(path.join(out,`results${smoke?'-smoke':''}.json`),JSON.stringify({metadata,results},null,2));

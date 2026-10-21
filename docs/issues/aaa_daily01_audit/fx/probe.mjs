import {readFile,writeFile,mkdir,cp} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import inspector from 'node:inspector';
import {PerformanceObserver,performance} from 'node:perf_hooks';
import {createHash} from 'node:crypto';
import os from 'node:os';
import {resolve,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
// Run from the repository root, or supply it as argv[3]. Artifacts stay beside this probe.
const root=resolve(process.argv[3]??process.cwd()),dir=dirname(fileURLToPath(import.meta.url));
const rate=48000,frames=128,warmup=5000,blocks=20000,trials=3;
const mode=process.argv[2]??'describe';
const jsFlavor=process.argv[4]??'helper-guard',tag=jsFlavor==='indexed'?'indexed-candidate':'candidate',artifactTag=jsFlavor==='indexed'?'-indexed':'';
if(mode==='prepare-js'){
 const custom=await readFile(root+'/web/custom_fx.js','utf8'),old='const input=channels.map(()=>new Float32Array(n)),output=channels.map(()=>new Float32Array(n));';
 if(!custom.includes(old))throw Error('LiveFX candidate anchor missing');
 const oldValidation='for(const value of channel)if(!Number.isFinite(value))';
 if(!custom.includes(oldValidation))throw Error('LiveFX validation candidate anchor missing');
 const candidateCustom=jsFlavor==='indexed'?custom.replace(oldValidation,'for(let i=0;i<channel.length;i++)if(!Number.isFinite(channel[i]))'):'const allocateChannels=(channels,n)=>channels.map(()=>new Float32Array(n));\n'+custom.replace(old,'const input=allocateChannels(channels,n),output=allocateChannels(channels,n);');
 await writeFile(dir+'/custom_fx.'+tag+'.mjs',candidateCustom);
 let engine=await readFile(root+'/web/native_fx_engine.js','utf8');
 const oldRamps='for(const r of this.ramps.values())';if(!engine.includes(oldRamps))throw Error('Ramp candidate anchor missing');
 if(jsFlavor!=='indexed')engine=engine.replace(oldRamps,'if(this.ramps.size>0)for(const r of this.ramps.values())');
 engine=engine.replace(/from '(\.\/[^']+)'/g,(_match,relative)=>'from '+JSON.stringify(pathToFileURL(relative==='./custom_fx.js'?dir+'/custom_fx.'+tag+'.mjs':resolve(root,'web',relative)).href));
 await writeFile(dir+'/native_fx_engine.'+tag+'.mjs',engine);
 const worklet=(await readFile(root+'/web/native-fx-worklet.js','utf8')).replace(/from '(\.\/[^']+)'/g,(_match,relative)=>'from '+JSON.stringify(pathToFileURL(relative==='./native_fx_engine.js'?dir+'/native_fx_engine.'+tag+'.mjs':resolve(root,'web',relative)).href));
 await writeFile(dir+'/native-fx-worklet.'+tag+'.mjs',worklet);
 console.log('Temporary JS candidates prepared; production unchanged.');process.exit(0);
}
if(mode==='build'){
 await cp(root+'/native/audio_effect',dir+'/candidate-c',{recursive:true});
 const path=dir+'/candidate-c/noise.c',source=await readFile(path,'utf8');
 const old='for(int s=0;s<VOICES;s++){Voice *v=&voices[s];if(!v->used)continue;';
 if(!source.includes(old))throw Error('Noise candidate anchor missing');
 await writeFile(path,source.replace(old,old+'\n if(!v->active){int changing=v->env.remaining;for(int p=0;p<6;p++)changing|=v->p[p].remaining;if(!changing)continue;}'));
 const script=await readFile(root+'/scripts/build_native_audio_effect.sh','utf8');
 const template=script.slice(script.indexOf('emcc '),script.indexOf('\n\n# Shared'));
 const compiler=spawnSync('emcc',['--version'],{encoding:'utf8'});
 if(compiler.status!==0)throw Error('Local emcc is required. This probe does not download toolchains/images.');
 await writeFile(dir+'/compiler.txt',compiler.stdout+compiler.stderr);
 for(const [name,sourceDir] of [['rebuilt-baseline',root+'/native/audio_effect'],['candidate',dir+'/candidate-c']]){
  const line=template.replaceAll('$ROOT_DIR/native/audio_effect',sourceDir).replace('$OUT_DIR/gain.wasm',dir+'/'+name+'.wasm');
  await writeFile(dir+'/build-'+name+'.sh',line+'\n');
  const result=spawnSync('/bin/sh',[dir+'/build-'+name+'.sh'],{encoding:'utf8'});
  process.stdout.write(result.stdout??'');process.stderr.write(result.stderr??'');
  if(result.status!==0)process.exit(result.status??1);
 }
 console.log('Temporary candidate built; production unchanged.');process.exit(0);
}
const allCases=['empty','native-gain','native-gain-ramp','native-filter-delay-reverb','live-gain-1','live-gain-8','noise-created-inactive-1','noise-created-inactive-32','noise-released-inactive-32','noise-active-1','noise-active-32'];
const cases=jsFlavor==='indexed'?allCases.filter(name=>!name.startsWith('noise-')):allCases;
if(mode==='describe'){console.log(JSON.stringify({rate,frames,warmup,blocks,trials,cases,notes:['Timing and allocation/GC passes separate.','20000 blocks / trial equals 53.33 seconds of audio.','Node actual NativeFXProcessor; preallocated IO, no browser/device deadline claim.']},null,2));process.exit(0);}
globalThis.sampleRate=rate;globalThis.currentFrame=0;let traffic=0;
globalThis.AudioWorkletProcessor=class{constructor(){this.port={postMessage(){traffic++;}};}};
globalThis.registerProcessor=()=>{};
const {NativeFXProcessor}=await import(root+'/web/native-fx-worklet.js');
const {NativeFXProcessor:CandidateJSProcessor}=await import(pathToFileURL(dir+'/native-fx-worklet.'+tag+'.mjs').href);
const baselineBytes=await readFile(root+'/web/native_audio_effect.wasm'),baseline=await WebAssembly.compile(baselineBytes);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const liveGain='function(input,output,state,context){for(let ch=0;ch<input.length;ch++)for(let i=0;i<input[ch].length;i++)output[ch][i]=input[ch][i]*context.gain;}';
function setup(module,name,Processor=NativeFXProcessor){
 const p=new Processor({processorOptions:{module}}),input=[new Float32Array(frames),new Float32Array(frames)],output=[new Float32Array(frames),new Float32Array(frames)];
 for(let i=0;i<frames;i++){input[0][i]=Math.sin(i*.05)*.1;input[1][i]=Math.cos(i*.037)*.09;}
 const add=(type,values)=>{const unit={type,slot:0,values};p.command({op:'create',unit});return unit;};
 if(name.startsWith('native-gain')){const unit=add('gain',{gain:.5});p.command({op:'chain',children:[{type:'gain',slot:0}],units:[unit]});if(name==='native-gain-ramp')p.command({op:'parameter',unit:{type:'gain',slot:0},key:'gain',value:.9,seconds:1000});}
 if(name==='native-filter-delay-reverb'){
  const units=[add('filter',{cutoff:1200,q:.707,mode:0,mix:1}),add('delay',{time:.125,feedback:.3,mix:.4}),add('reverb',{mix:.2,room:.7,damping:.4})];
  p.command({op:'chain',children:units.map(u=>({type:u.type,slot:u.slot})),units});
 }
 const liveCount=name==='live-gain-8'?8:name==='live-gain-1'?1:0;
 for(let i=0;i<liveCount;i++)p.command({op:'live-fx',action:'register',name:'gain'+i,source:liveGain,context:{gain:.95}});
 if(name.startsWith('noise-')){
  const count=Number(name.match(/-(\d+)$/)[1]);
  for(let slot=0;slot<count;slot++){
   p.command({op:'noise',action:'create',slot,type:0,token:slot+1,seed:slot+1});
   p.command({op:'noise',action:'parameter',slot,token:slot+1,param:0,value:.005,seconds:0});
   if(name.includes('active-')&&!name.includes('inactive-'))p.command({op:'noise',action:'start',slot,token:slot+1});
   if(name.includes('released')){p.command({op:'noise',action:'start',slot,token:slot+1});p.command({op:'noise',action:'stop',slot,token:slot+1});}
  }
 }
 const inputs=[input],outputs=[output];
 return {p,input,output,run(){p.process(inputs,outputs);globalThis.currentFrame+=frames;}};
}
function stats(times){const sorted=Float64Array.from(times).sort();let sum=0;for(const t of times)sum+=t;return{meanUs:sum/times.length*1000,p95Us:sorted[Math.floor(sorted.length*.95)]*1000,p99Us:sorted[Math.floor(sorted.length*.99)]*1000,maxUs:sorted.at(-1)*1000,minUs:sorted[0]*1000};}
const env={node:process.version,v8:process.versions.v8,platform:process.platform,arch:process.arch,cpu:os.cpus()[0].model,rate,frames,blockBudgetMs:frames/rate*1000,warmup,blocks,trials,jsCandidateFlavor:jsFlavor,wasmSha256:hash(baselineBytes)};
if(mode==='timing'){
 const candidateBytes=jsFlavor==='indexed'?null:await readFile(dir+'/candidate.wasm'),candidate=candidateBytes?await WebAssembly.compile(candidateBytes):baseline,rebuiltBytes=jsFlavor==='indexed'?null:await readFile(dir+'/rebuilt-baseline.wasm'),rebuilt=rebuiltBytes?await WebAssembly.compile(rebuiltBytes):baseline;
 const rows=[];
 // Rotate candidate/baseline ordering to reduce monotonic thermal/order bias.
 for(let trial=0;trial<trials;trial++)for(const name of cases){
  const variants=name.startsWith('noise-')?(trial%2?[['candidate',candidate],['rebuilt-baseline',rebuilt],['shipped',baseline]]:[['shipped',baseline],['rebuilt-baseline',rebuilt],['candidate',candidate]]):(trial%2?[['js-candidate',baseline,CandidateJSProcessor],['shipped',baseline]]:[['shipped',baseline],['js-candidate',baseline,CandidateJSProcessor]]);
  for(const [variant,module,Processor] of variants){
   const s=setup(module,name,Processor);for(let i=0;i<warmup;i++)s.run();global.gc?.();
   const times=new Float64Array(blocks);traffic=0;
   const refs={memory:s.p.api.memory.buffer,input:s.p.engine.input,left:s.p.engine.outputLeft,right:s.p.engine.outputRight};
   for(let i=0;i<blocks;i++){const start=performance.now();s.run();times[i]=performance.now()-start;}
   rows.push({name,variant,trial,...stats(times),messages:traffic,memoryChanged:refs.memory!==s.p.api.memory.buffer,pcmViewsChanged:refs.input!==s.p.engine.input||refs.left!==s.p.engine.outputLeft||refs.right!==s.p.engine.outputRight,outputViewCache:s.p.engine.outputViews.size,liveFxCache:s.p.liveFX.buffers.size});
  }
 }
 const timer=new Float64Array(blocks);for(let i=0;i<blocks;i++){const start=performance.now();timer[i]=performance.now()-start;}
 const result={env,rebuiltBaselineSha256:rebuiltBytes?hash(rebuiltBytes):null,candidateSha256:candidateBytes?hash(candidateBytes):null,timerOverhead:stats(timer),rows};await writeFile(dir+'/timing'+artifactTag+'.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}
if(mode==='alloc'){
 const rows=[];
 for(const name of cases)for(const [variant,Processor] of name.startsWith('noise-')?[['shipped',NativeFXProcessor]]:[['shipped',NativeFXProcessor],['js-candidate',CandidateJSProcessor]]){
  const s=setup(baseline,name,Processor);for(let i=0;i<warmup;i++)s.run();global.gc?.();await new Promise(r=>setTimeout(r,20));
  const session=new inspector.Session();session.connect();const post=(method,params={})=>new Promise((resolve,reject)=>session.post(method,params,(err,value)=>err?reject(err):resolve(value)));
  const gc=[];const observer=new PerformanceObserver(list=>{for(const e of list.getEntries())gc.push({durationMs:e.duration,kind:e.detail?.kind});});observer.observe({entryTypes:['gc']});
  await post('HeapProfiler.startSampling',{samplingInterval:1024,includeObjectsCollectedByMajorGC:true,includeObjectsCollectedByMinorGC:true});
  for(let i=0;i<50000;i++)s.run();
  const profile=(await post('HeapProfiler.stopSampling')).profile;session.disconnect();await new Promise(r=>setTimeout(r,20));observer.disconnect();
  const allocations=[];function walk(node){if(node.selfSize)allocations.push({bytes:node.selfSize,function:node.callFrame.functionName,url:node.callFrame.url,line:node.callFrame.lineNumber+1});for(const child of node.children??[])walk(child);}walk(profile.head);allocations.sort((a,b)=>b.bytes-a.bytes);
  const sampledAllocatedBytes=allocations.reduce((sum,row)=>sum+row.bytes,0),projectSampledAllocatedBytes=allocations.filter(row=>row.url.includes(root+'/web/')||row.url.includes(dir+'/custom_fx.')||row.url.includes(dir+'/native_fx_engine.')||row.url.includes(dir+'/native-fx-worklet.')).reduce((sum,row)=>sum+row.bytes,0);rows.push({name,variant,blocks:50000,sampledAllocatedBytes,sampledBytesPerBlock:sampledAllocatedBytes/50000,projectSampledAllocatedBytes,projectSampledBytesPerBlock:projectSampledAllocatedBytes/50000,gc,allocations:allocations.slice(0,15)});
 }
 const result={env,samplingInterval:1024,includeCollectedObjects:true,rows};await writeFile(dir+'/alloc'+artifactTag+'.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}
if(mode==='compare'){
 const candidateBytes=await readFile(dir+'/candidate.wasm'),candidate=await WebAssembly.compile(candidateBytes),rebuilt=await WebAssembly.compile(await readFile(dir+'/rebuilt-baseline.wasm'));
 const a=setup(rebuilt,'empty'),b=setup(candidate,'empty'),c=setup(baseline,'empty'),hasherA=createHash('sha256'),hasherB=createHash('sha256'),hasherC=createHash('sha256');let mismatch=0,shippedMismatch=0;
 const send=d=>{a.p.command(structuredClone(d));b.p.command(structuredClone(d));c.p.command(structuredClone(d));};
 for(let slot=0;slot<32;slot++){send({op:'noise',action:'create',slot,type:slot%5,token:slot+1,seed:slot+2});send({op:'noise',action:'parameter',slot,token:slot+1,param:0,value:.004,seconds:0});send({op:'noise',action:'parameter',slot,token:slot+1,param:5,value:.01,seconds:0});}
 for(let block=0;block<4000;block++){
  if([50,500,1500,2700].includes(block))for(let slot=0;slot<32;slot++)send({op:'noise',action:'start',slot,token:slot+1});
  if([250,1100,2400,3000].includes(block))for(let slot=0;slot<32;slot++)send({op:'noise',action:'stop',slot,token:slot+1});
  if([400,1200,2450].includes(block))for(let slot=0;slot<32;slot++){send({op:'noise',action:'parameter',slot,token:slot+1,param:2,value:1000+slot*77,seconds:.1});send({op:'noise',action:'parameter',slot,token:slot+1,param:1,value:slot/16-1,seconds:.1});}
  a.run();b.run();c.run();for(let ch=0;ch<2;ch++){const aa=Buffer.from(a.output[ch].buffer),bb=Buffer.from(b.output[ch].buffer),cc=Buffer.from(c.output[ch].buffer);if(!aa.equals(bb))mismatch++;if(!aa.equals(cc))shippedMismatch++;hasherA.update(aa);hasherB.update(bb);hasherC.update(cc);}
 }
 const result={env,blocks:4000,seconds:4000*frames/rate,conditions:'32 voices, all 5 noise types; long inactive intervals; start/stop/restart; release; cutoff+pan ramps while inactive',mismatchedChannels:mismatch,shippedVsRebuiltMismatchedChannels:shippedMismatch,rebuiltBaselinePcmSha256:hasherA.digest('hex'),candidatePcmSha256:hasherB.digest('hex'),shippedPcmSha256:hasherC.digest('hex')};await writeFile(dir+'/compare.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}
if(mode==='compare-js'){
 const rows=[];
 for(const name of cases){
  const a=setup(baseline,name),b=setup(baseline,name,CandidateJSProcessor),ha=createHash('sha256'),hb=createHash('sha256');let mismatch=0;
  const send=d=>{a.p.command(structuredClone(d));b.p.command(structuredClone(d));};
  for(let block=0;block<2000;block++){
   if(name==='empty'){
    if([10,200].includes(block))send({op:'live-fx',action:'register',name:'dynamic',source:liveGain,context:{gain:.5}});
    if(block===100)send({op:'live-fx',action:'remove',name:'dynamic'});
    if(block===400)send({op:'live-fx',action:'context',name:'dynamic',context:{gain:.25}});
   }
   if(name==='native-gain'&&block===300)send({op:'parameter',unit:{type:'gain',slot:0},key:'gain',value:.9,seconds:.1});
   a.run();b.run();for(let ch=0;ch<2;ch++){const aa=Buffer.from(a.output[ch].buffer),bb=Buffer.from(b.output[ch].buffer);if(!aa.equals(bb))mismatch++;ha.update(aa);hb.update(bb);}
  }
  rows.push({name,blocks:2000,mismatchedChannels:mismatch,shippedPcmSha256:ha.digest('hex'),candidatePcmSha256:hb.digest('hex'),sameHasProcessed:a.p.liveFX.hasProcessed===b.p.liveFX.hasProcessed});
 }
 const result={env,conditions:'All selected cases; empty→register5msfade→remove→re-register/context update; native gain ramp; source remains mixed in every block',rows};await writeFile(dir+'/compare-js'+artifactTag+'.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}

import fs from 'node:fs';
import vm from 'node:vm';
import zlib from 'node:zlib';
import path from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
const args=Object.fromEntries(process.argv.slice(2).map(v=>{const i=v.indexOf('=');return [v.slice(2,i),v.slice(i+1)];}));
const root=path.resolve(args.root??process.cwd()),out=path.resolve(args.out??path.dirname(fileURLToPath(import.meta.url)));
const runs=Number(args.runs??20),warmups=5;
const source=fs.readFileSync(`${root}/web/playground_audio_scheduler.js`,'utf8');
function replaceOnce(text,from,to){if(!text.includes(from)||text.indexOf(from)!==text.lastIndexOf(from))throw Error('Source anchor changed');return text.replace(from,to);}
function factory(text){const scope={result:null,setTimeout,clearTimeout};vm.runInNewContext(text.replace('export function createAudioScheduler','function createAudioScheduler')+'\nresult=createAudioScheduler;',scope);return scope.result;}
let empty=replaceOnce(source,'    enqueue(entries) {','    enqueue(entries) {\n      if (!entries.length) { flush(); return; }');
let head=replaceOnce(empty,'  let pending = [];','  let pending = [];\n  let head = 0;');
head=replaceOnce(head,'    while (count < pending.length && pending[count].time <= horizon) count++;\n    if (count) send(pending.splice(0, count));\n    if (pending.length) timer = setTimer(flush, timing.schedulerIntervalMs);',
`    while (head + count < pending.length && pending[head + count].time <= horizon) count++;
    if (count) { send(pending.slice(head, head + count)); head += count; }
    if (head === pending.length) { pending = []; head = 0; }
    else if (head >= 4096 && head * 2 >= pending.length) { pending = pending.slice(head); head = 0; }
    if (pending.length) timer = setTimer(flush, timing.schedulerIntervalMs);`);
head=replaceOnce(head,'      pending = pending.concat(entries);','      if (head) { pending = pending.slice(head); head = 0; }\n      pending = pending.concat(entries);');
head=replaceOnce(head,'      pending = [];','      pending = []; head = 0;');
const factories={original:factory(source),'probe-only-ignore-empty':factory(empty),'probe-only-ignore-empty-and-head':factory(head)};
const percentile=(xs,p)=>xs[Math.min(xs.length-1,Math.ceil(xs.length*p)-1)];
const summary=xs=>{const s=[...xs].sort((a,b)=>a-b);return {samples:s.length,meanUs:s.reduce((a,b)=>a+b,0)/s.length,medianUs:percentile(s,.5),p95Us:percentile(s,.95),p99Us:percentile(s,.99),maxUs:s.at(-1),minUs:s[0]};};
const tickTimes=duration=>Array.from({length:Math.ceil((duration+.02)/.01)},(_,i)=>(i+1)*.01);
const synthetic=()=>Array.from({length:80000},(_,i)=>({time:.25+Math.round(i*44100/8000)/44100,port:0,register:0x2a,value:i&255}));
let allEntries=synthetic();
const cases=[{name:'synthetic-8kHz-10s-explicit-raw-with-six-empty-tracks',duration:10.25,batches:[allEntries,[],[],[],[],[],[]]},
 {name:'synthetic-8kHz-10s-explicit-raw-single-batch',duration:10.25,batches:[allEntries]}];
if(args.vgm){
 const {exportYm2612VgmToPlaygroundJavaScript}=await import(pathToFileURL(`${root}/web/ym2612vgm.js`));
 const input=fs.readFileSync(args.vgm),sourceVgm=exportYm2612VgmToPlaygroundJavaScript(zlib.gunzipSync(input),{scheduled:true,splitChannels:true});
 const callbacks=[],batches=[];let duration=0;
 const scope={CH1:0,CH2:1,CH3:2,CH4:3,CH5:4,CH6:5,livePrepare(){},liveLoop(name,fn){callbacks.push(fn);},beginSampleSchedule(){return 0;},scheduleWritesSamples(start,entries){batches.push(Array.from(entries,([sample,port,register,value])=>({time:.25+sample/44100,port,register,value})));},sleepSamples:async n=>{duration=Math.max(duration,n/44100);},dac:{playStream(){}}};
 vm.runInNewContext(sourceVgm,scope);for(const callback of callbacks)await callback();cases.unshift({name:'actual-Popful-Mail-scheduled-FM-and-PSG',duration:duration+.25,batches});
}
function once(create,test){
 let clock=0,timer=null;const sent=[],flushes=[],enqueues=[];let timerCalls=0;
 const scheduler=create({now:()=>clock,send:batch=>sent.push(batch),setTimer(fn){timer=fn;timerCalls++;return timerCalls;},clearTimer(){timer=null;}});
 const start=process.hrtime.bigint();
 for(const batch of test.batches){const t=process.hrtime.bigint();scheduler.enqueue(batch);enqueues.push(Number(process.hrtime.bigint()-t)/1000);}
 for(const time of tickTimes(test.duration)){clock=time;if(timer){const fn=timer;timer=null;const t=process.hrtime.bigint();fn();flushes.push(Number(process.hrtime.bigint()-t)/1000);}}
 const totalUs=Number(process.hrtime.bigint()-start)/1000;
 const actual=sent.flat(),expected=test.batches.flat().sort((a,b)=>a.time-b.time);
 if(actual.length!==expected.length||actual.some((v,i)=>v!==expected[i]))throw Error('Event identity/order mismatch');
 scheduler.clear();
 return {totalUs,enqueues,flushes,messages:sent.length,timerCalls,events:actual.length};
}
const results=[];
for(const test of cases){
 for(const [name,create]of Object.entries(factories))for(let i=0;i<warmups;i++)once(create,test);
 const raw=Object.fromEntries(Object.keys(factories).map(k=>[k,[]]));
 // Alternate condition order to avoid all baseline runs preceding all variants.
 for(let i=0;i<runs;i++){const order=Object.entries(factories);if(i%2)order.reverse();for(const [name,create]of order)raw[name].push(once(create,test));}
 results.push({case:test.name,duration:test.duration,events:test.batches.flat().length,batches:test.batches.map(x=>x.length),variants:Object.fromEntries(Object.entries(raw).map(([name,data])=>[name,{total:summary(data.map(x=>x.totalUs)),enqueue:summary(data.flatMap(x=>x.enqueues)),flush:summary(data.flatMap(x=>x.flushes)),messages:data[0].messages,timerCalls:data[0].timerCalls,identityAndStableOrderMatch:true}]))});
}
const result={recordedAt:new Date().toISOString(),node:process.version,kind:'Node microbenchmark; virtual 10-ms scheduler ticks; no AudioContext/WASM/message clone/device',runs,warmups,
 instrumentation:'hrtime per enqueue/flush plus outer time. No GC forcing. Timings include send array sink and timer hooks; sub-microsecond values near instrumentation noise. Probe-only candidates preserve identity/order for these cases, not full API conformance.',results};
fs.mkdirSync(out,{recursive:true});fs.writeFileSync(`${out}/timings.json`,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
